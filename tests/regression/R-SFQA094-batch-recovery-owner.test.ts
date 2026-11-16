import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run'
import {
  adoptOutlineGenerationCandidateV1,
  beginOutlineGenerationBatchAdoptionV1,
  recoverPendingOutlineGenerationAdoptionsV1,
  restoreLatestOutlineGenerationBatchV1,
} from '../../src/lib/outline/candidate-lifecycle'
import { OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1 } from '../../src/lib/authoring/content-revision'
import { createSfqa094BatchV1, sfqa094IntentV1 } from '../helpers/sfqa094-batch'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA094 · 恢复后的批次仍由批量确认入口负责写入', () => {
  it('仍报告损坏的原确认计划，且不写入任何章节', async () => {
    const fixture = await createSfqa094BatchV1()
    const entries = [...fixture.result.candidatesByVolume.values()].map((candidate, index) => ({
      candidate, intent: sfqa094IntentV1(candidate, fixture.volumes[index].id!),
    }))
    await beginOutlineGenerationBatchAdoptionV1(entries)
    const damaged = entries[0].candidate
    const plans = (await db.agentEvents.where('conversationId').equals(damaged.conversationId).toArray())
      .filter(row => row.kind === 'plan' && JSON.parse(row.payload ?? '{}').runId === damaged.runId)
    expect(plans).toHaveLength(1)
    for (const plan of plans) await db.agentEvents.delete(plan.id!)
    expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope)).toEqual({
      recoveredRunIds: [], failed: [{ runId: damaged.runId, reason: '批次恢复缺少原确认计划' }],
    })
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(0)
    expect(fixture.modelCalls()).toBe(2)
  })
  it.each(['proof', 'receipt'] as const)('%s 存储失败后背景恢复不抢先写入，原确认计划可明确继续一次', async target => {
    const fixture = await createSfqa094BatchV1(3)
    const candidates = [...fixture.result.candidatesByVolume.values()]
    const entries = candidates.map((candidate, index) => ({
      candidate, intent: sfqa094IntentV1(candidate, fixture.volumes[index].id!),
    }))
    await beginOutlineGenerationBatchAdoptionV1(entries)
    await adoptOutlineGenerationCandidateV1(entries[0])
    const second = candidates[1].runId
    let armed = true
    const proofFailure = (_key: unknown, row: { durableRunId?: number | null; payload?: string }) => {
      if (armed && row.durableRunId === second
        && JSON.parse(row.payload ?? '{}').type === OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1) {
        armed = false
        throw new Error('batch-recovery-owner-proof-failure')
      }
    }
    const receiptFailure = (_key: unknown, row: { runId?: number; type?: string }) => {
      if (armed && row.runId === second && row.type === 'verification.accepted') {
        armed = false
        throw new Error('batch-recovery-owner-receipt-failure')
      }
    }
    if (target === 'proof') db.agentEvents.hook('creating', proofFailure)
    else db.agentRunEvents.hook('creating', receiptFailure)
    try {
      await expect(adoptOutlineGenerationCandidateV1(entries[1])).rejects.toThrow(`batch-recovery-owner-${target}-failure`)
    } finally {
      db.agentEvents.hook('creating').unsubscribe(proofFailure)
      db.agentRunEvents.hook('creating').unsubscribe(receiptFailure)
    }
    const before = {
      chapters: await db.outlineNodes.where('type').equals('chapter').toArray(),
      runs: await db.agentRuns.toArray(),
      events: await db.agentRunEvents.toArray(),
    }
    expect(before.chapters).toHaveLength(target === 'proof' ? 2 : 4)
    db.close(); await db.open()
    // This is the other mounted controller's refresh path, not an author click.
    expect(await recoverPendingOutlineGenerationAdoptionsV1(fixture.scope)).toEqual({
      recoveredRunIds: [], failed: [],
    })
    expect({
      chapters: await db.outlineNodes.where('type').equals('chapter').toArray(),
      runs: await db.agentRuns.toArray(),
      events: await db.agentRunEvents.toArray(),
    }).toEqual(before)
    const restored = await restoreLatestOutlineGenerationBatchV1(fixture.scope)
    expect(restored?.candidates.map(candidate => candidate.runId)).toEqual(candidates.slice(1).map(candidate => candidate.runId))
    const remaining = restored!.candidates.map(candidate => {
      const intent = restored!.adoptionIntents?.get(candidate.runId)
      expect(intent).toEqual(entries[candidate.batch!.batchIndex].intent)
      if (!intent) throw new Error('original confirmed batch intent was not restored')
      return { candidate, intent }
    })
    await beginOutlineGenerationBatchAdoptionV1(remaining)
    for (const entry of remaining) await adoptOutlineGenerationCandidateV1(entry)
    const chapters = await db.outlineNodes.where('type').equals('chapter').toArray()
    expect(chapters).toHaveLength(6)
    for (const original of before.chapters) expect(chapters.find(row => row.id === original.id)).toEqual(original)
    for (const candidate of candidates) {
      const run = await readAgentRunV1(fixture.scope, candidate.runId)
      expect(run.projection.state).toBe('completed')
      expect(run.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
      expect(run.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    }
    expect(fixture.modelCalls()).toBe(3)
  })
})
