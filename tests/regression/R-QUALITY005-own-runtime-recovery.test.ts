import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { appendRuntimeCandidateAdoptedV1, readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { adoptOpenWorldRuntimeCandidateV1 } from '../../src/lib/open-world/harness'
import { appendProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { seedQuality005OwnRuntimeRecoveryV1 } from '../helpers/quality005-own-runtime-recovery'
import { snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import * as verification from '../../src/lib/agent/run/verification-receipt'
import * as runtime from '../../src/lib/product/runtime-core'
import * as previewSource from '../../src/lib/product-production/preview-source'
import { adoptOpenWorldEvolutionRuntimeCandidateV1, generateOpenWorldEvolutionRuntimeCandidateV1 } from '../../src/lib/open-world/evolution-harness'
import { seedQuality005LegacyHybridV1 } from '../helpers/quality005-legacy-hybrid'

describe('SFQA-005 · native own runtime adoption recovery preserves original authority', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  for (const mode of ['novel', 'world-release'] as const) {
    it.each(['adopted', 'step-succeeded', 'verifying'] as const)(`${mode}: fills only missing verification after the native %s interruption`, async stage => {
      const f = await seedQuality005OwnRuntimeRecoveryV1(mode, stage)
      const prior = await readInstanceAgentRunV1(f.scope, f.runId)
      const beforeEvents = await db.productRuntimeEvents.toArray(), beforeRuns = await db.agentRuns.count()
      const adopted = prior.events.filter(event => event.type === 'runtime.candidate.adopted')
      const result = await adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })
      expect(result.snapshot.projection.state).toBe('completed')
      expect(result.snapshot.events.filter(event => event.type === 'runtime.candidate.adopted')).toEqual(adopted)
      expect(result.snapshot.events.filter(event => event.type === 'model.requested')).toEqual(prior.events.filter(event => event.type === 'model.requested'))
      expect(await db.productRuntimeEvents.toArray()).toEqual(beforeEvents)
      expect(await db.agentRuns.count()).toBe(beforeRuns)
      const completed = await snapshotQuality005RowsV1()
      expect((await adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).receiptHash).toBe(result.receiptHash)
      expect(await snapshotQuality005RowsV1()).toEqual(completed)
    })

    it(`${mode}: returns the exact native old completed receipt without any write`, async () => {
      const f = await seedQuality005OwnRuntimeRecoveryV1(mode, 'completed')
      const before = await snapshotQuality005RowsV1()
      expect((await adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).receiptHash).toBe(f.receiptHash)
      expect(await snapshotQuality005RowsV1()).toEqual(before)
    })

    it(`${mode}: rejects any contradictory adopted hash, including a later matching event, with no verification write`, async () => {
      const f = await seedQuality005OwnRuntimeRecoveryV1(mode, 'adopted')
      let prior = await readInstanceAgentRunV1(f.scope, f.runId)
      const adopted = prior.events.find(event => event.type === 'runtime.candidate.adopted')!
      if (adopted.type !== 'runtime.candidate.adopted') throw new Error('native original adoption missing')
      prior = await appendRuntimeCandidateAdoptedV1({ scope: f.scope, runId: f.runId,
        expectedLastSequence: prior.projection.lastSequence, payload: { ...adopted.payload, adoptionHash: '0'.repeat(64) } })
      await appendRuntimeCandidateAdoptedV1({ scope: f.scope, runId: f.runId,
        expectedLastSequence: prior.projection.lastSequence, payload: adopted.payload })
      const before = await snapshotQuality005RowsV1()
      await expect(adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).rejects.toThrow(/采用|adoption|证据/)
      expect(await snapshotQuality005RowsV1()).toEqual(before)
    })
  }

  it('does not treat a real pending old novel candidate as already adopted', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('novel', 'pending')
    const before = await snapshotQuality005RowsV1()
    await expect(adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a stale actual World post-state before partially signing verification', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('world-release', 'adopted')
    await appendProductRuntimeEvent({ sessionId: f.sessionId, type: 'narrative.recorded', payload: { text: 'The World game has since advanced.' } })
    const before = await snapshotQuality005RowsV1()
    await expect(adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).rejects.toThrow(/变化|过期|证据/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('performs a final native post-state CAS if the real World game advances during receipt preparation', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('world-release', 'adopted')
    const before = await readInstanceAgentRunV1(f.scope, f.runId)
    const original = verification.createVerificationReceiptV1
    const prepare = vi.spyOn(verification, 'createVerificationReceiptV1').mockImplementation(async input => {
      const receipt = await original(input)
      await appendProductRuntimeEvent({ sessionId: f.sessionId, type: 'narrative.recorded', payload: { text: 'Concurrent canonical game event.' } })
      return receipt
    })
    await expect(adoptOpenWorldRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).rejects.toThrow(/post-state.*变化/)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(await readInstanceAgentRunV1(f.scope, f.runId)).toEqual(before)
    expect((await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).last())!.type).toBe('narrative.recorded')
  })

  it('rejects a changed Release between the real source verification result and prepared-source capture for an adopted Own run', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('world-release', 'adopted')
    const session = (await db.productRuntimeSessions.get(f.sessionId))!
    const release = (await db.productReleases.get(session.productReleaseId!))!
    const beforeRun = await readInstanceAgentRunV1(f.scope, f.runId), beforeEvents = await db.productRuntimeEvents.toArray()
    let injected = 0
    const actualSource = previewSource.verifyProductRuntimeSessionSourceV1
    vi.spyOn(previewSource, 'verifyProductRuntimeSessionSourceV1').mockImplementation(async input => {
      const result = await actualSource(input)
      if (!injected) {
        expect((await db.productReleases.get(release.id!))!.manifestJson).toBe(release.manifestJson)
        await db.productReleases.update(release.id!, { manifestJson: '{}' }); injected += 1
      }
      return result
    })
    const outcome = await runtime.verifyFormalRuntimeSourceV1(session, ['text-open-world'])
      .then(() => ({ ok: true, error: '' }), (error: unknown) => ({ ok: false, error: String(error) }))
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/Release.*变化/)
    expect(injected).toBe(1)
    expect(await readInstanceAgentRunV1(f.scope, f.runId)).toEqual(beforeRun)
    expect(await db.productRuntimeEvents.toArray()).toEqual(beforeEvents)
    expect((await db.productReleases.get(release.id!))!.manifestJson).toBe('{}')
  })

  it('does not permit foreign scope to use a native adopted candidate as a receipt-repair capability', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('novel', 'adopted')
    const before = await snapshotQuality005RowsV1()
    await expect(adoptOpenWorldRuntimeCandidateV1({ scope: { ...f.scope, workId: f.scope.workId + 1000 }, runId: f.runId })).rejects.toThrow()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it.each(['adopted', 'step-succeeded', 'verifying'] as const)('Evolution: resumes the actual old World %s window without repeating adoption or product events', async stage => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('world-release', stage, 'evolution')
    const before = await readInstanceAgentRunV1(f.scope, f.runId), productEvents = await db.productRuntimeEvents.toArray()
    const result = await adoptOpenWorldEvolutionRuntimeCandidateV1({ scope: f.scope, runId: f.runId })
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.snapshot.events.filter(event => event.type === 'runtime.candidate.adopted'))
      .toEqual(before.events.filter(event => event.type === 'runtime.candidate.adopted'))
    expect(result.snapshot.events.filter(event => event.type === 'model.requested'))
      .toEqual(before.events.filter(event => event.type === 'model.requested'))
    expect(await db.productRuntimeEvents.toArray()).toEqual(productEvents)
    const completed = await snapshotQuality005RowsV1()
    expect((await adoptOpenWorldEvolutionRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).receiptHash).toBe(result.receiptHash)
    expect(await snapshotQuality005RowsV1()).toEqual(completed)
  })

  it('Evolution: retains the exact old completed receipt as a read', async () => {
    const f = await seedQuality005OwnRuntimeRecoveryV1('world-release', 'completed', 'evolution')
    const before = await snapshotQuality005RowsV1()
    expect((await adoptOpenWorldEvolutionRuntimeCandidateV1({ scope: f.scope, runId: f.runId })).receiptHash).toBe(f.receiptHash)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('Evolution: denies a new old-novel hybrid Run before the existing empty-context path allocates or dispatches anything', async () => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'adventure')!
    const runAI = vi.fn(async () => 'must not dispatch'), before = await snapshotQuality005RowsV1()
    await expect(generateOpenWorldEvolutionRuntimeCandidateV1({ scope: f.scope,
      productRuntimeSessionId: Number(old.command.sessionId), skillId: 'prose.open-world-turn-briefing',
      objective: 'New legacy work is not authorized.', runAI })).rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(runAI).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })
})
