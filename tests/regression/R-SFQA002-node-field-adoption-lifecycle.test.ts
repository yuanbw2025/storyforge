import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { NodeRunRecord } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { adopt } from '../../src/lib/registry/adopt'
import { adoptAuthoringCandidate, readAuthoringFieldAdoptionViewsV1, recoverInterruptedAuthoringRun,
  reviseAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { confirmNodeFieldAdoptionIntentV1, prepareNodeFieldAdoptionCompletionV1,
  readNodeFieldAdoptionProofV1 } from '../../src/lib/node-authoring/field-adoption'
import { readAgentRunV1, verifyRecordedMemorySettlementV1 } from '../../src/lib/agent/run/event-store'
import { verifyVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import * as usageLog from '../../src/lib/ai/usage-log'
import { createQualityNodeFieldFlow, qualityNodeFieldRaw, type QualityNodeFieldFamily } from '../helpers/quality002-node-field'

async function allTables() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

describe.sequential('002 field author lifecycle through the actual public Node route', () => {
  let usage: Promise<unknown>[]
  beforeEach(async () => {
    await db.delete(); await db.open(); usage = []
    vi.stubGlobal('window', undefined)
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: '', model: 'isolated-node-lifecycle',
      baseUrl: 'http://127.0.0.1:9/v1', temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
    const original = usageLog.recordUsage
    vi.spyOn(usageLog, 'recordUsage').mockImplementation(function (this: unknown, input) {
      const pending = original.call(this, input); usage.push(pending); return pending
    })
  })
  afterEach(async () => { await Promise.allSettled(usage); vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() })

  async function fixture(family: QualityNodeFieldFamily, count = 2, unknownLast = false) {
    const f = await createQualityNodeFieldFlow(family, count), sends: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, request) => {
      if (String(url) !== 'http://127.0.0.1:9/v1/chat/completions' || request?.method !== 'POST') throw new Error('Unexpected external request')
      const index = sends.length; sends.push(String(request.body))
      if (index >= count) throw new Error('Unexpected model resend')
      if (unknownLast && index === count - 1) throw new TypeError('UNKNOWN_RESULT_AFTER_SEND')
      return new Response(JSON.stringify({ choices: [{ message: { content: qualityNodeFieldRaw(f.field, index) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }), { status: 200 })
    }))
    const generated = await runAuthoringGraph({ flow: f.flow }); await Promise.allSettled(usage)
    if (!generated.run.id) throw new Error('Real NodeRun is required')
    const draft = '\n ' + JSON.stringify({ field: f.field, value: '作者终稿 e\u0301🌙：原约必须兑现，不改模型原串。' }, null, 4) + '\n\t'
    const input = { scope: f.scope, flow: f.flow, runId: generated.run.id, nodeId: 'field', output: draft }
    const choice = { ...input, selectedVariantIndex: count - 1, draft }
    return { ...f, sends, generated, draft, input, choice }
  }
  async function producer(f: Awaited<ReturnType<typeof fixture>>, index: number) {
    const rows = await db.agentRuns.where('workId').equals(f.scope.workId)
      .filter(row => row.nodeRunId === f.input.runId && row.nodeProducerNodeId === 'field' && row.nodeProducerVariantIndex === index).toArray()
    if (rows.length !== 1 || !rows[0].id) throw new Error('Exactly one real producer tuple required')
    return readAgentRunV1(f.scope, rows[0].id)
  }
  async function edit(f: Awaited<ReturnType<typeof fixture>>) {
    return reviseAuthoringCandidate({ ...f.input, selectedVariantIndex: f.count - 1 })
  }

  it.each([{ family: 'world', count: 1 }, { family: 'world', count: 2 },
    { family: 'story', count: 1 }, { family: 'story', count: 2 }] as const)(
    '$family $count selects/edits once, completes actual receipt, and cold reads never write or send', async sample => {
      const f = await fixture(sample.family, sample.count); await edit(f)
      const originals = await db.agentRunArtifacts.toArray(), usageBefore = await db.aiUsageLog.toArray()
      const terminalTransactions: IDBTransaction[] = [], projectionTransactions: IDBTransaction[] = []
      const eventCreated = (_key: unknown, row: { type: string }) => {
        if (!['verification.accepted', 'memory.settlement.recorded'].includes(row.type)) return
        const native = Dexie.currentTransaction?.idbtrans
        if (!native || native.mode !== 'readwrite') throw new Error('Terminal requires a real native RW transaction')
        terminalTransactions.push(native)
      }
      const projectionUpdated = (mods: Partial<NodeRunRecord>) => {
        if (typeof mods.nodeResultsJson !== 'string' || JSON.parse(mods.nodeResultsJson).field.status !== 'adopted') return
        const native = Dexie.currentTransaction?.idbtrans
        if (!native || native.mode !== 'readwrite') throw new Error('Node projection requires a real native RW transaction')
        projectionTransactions.push(native)
      }
      db.agentRunEvents.hook('creating', eventCreated); db.nodeRuns.hook('updating', projectionUpdated)
      let result: Awaited<ReturnType<typeof adoptAuthoringCandidate>>
      try { result = await adoptAuthoringCandidate(f.input) }
      finally { db.agentRunEvents.hook('creating').unsubscribe(eventCreated); db.nodeRuns.hook('updating').unsubscribe(projectionUpdated) }
      expect(result.written).toHaveLength(1); expect(result.recovered).toBe(false)
      expect(terminalTransactions).toHaveLength(2); expect(projectionTransactions).toHaveLength(1)
      expect(new Set([...terminalTransactions, ...projectionTransactions]).size).toBe(1)
      expect([...terminalTransactions[0].objectStoreNames]).toEqual(expect.arrayContaining(['nodeRuns', 'agentRuns', 'agentRunEvents', 'agentRunArtifacts', 'agentRunCheckpoints', f.table]))
      const target = await db.table(f.table).get(result.written[0].id)
      expect(target[f.field]).toBe(JSON.parse(f.draft).value)
      const selected = await producer(f, sample.count - 1)
      expect(selected.projection.state).toBe('completed')
      expect((await verifyRecordedMemorySettlementV1({ scope: f.scope, snapshot: selected })).receipt.state).toBe('settled')
      expect(selected.events.filter(event => event.type === 'candidate.revised')).toHaveLength(1)
      expect(selected.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
      expect(selected.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
      const terminal = await prepareNodeFieldAdoptionCompletionV1(f.choice)
      expect(await verifyVerificationReceiptIntegrityV1(terminal.receipt)).toBe(true)
      expect(terminal.receipt.receiptHash).toBe(selected.projection.terminalReceiptHash)
      expect(terminal.receipt.criteria.map(value => value.id)).toEqual(['node-field.candidate', 'node-field.author', 'node-field.post-state'])
      const node = JSON.parse((await db.nodeRuns.get(f.input.runId))!.nodeResultsJson).field
      expect(node).toMatchObject({ status: 'adopted', output: f.draft, selectedVariantIndex: sample.count - 1 })
      expect(node.variants).toEqual(f.generated.candidates.field.variants)
      for (const original of originals) expect(await db.agentRunArtifacts.get(original.id!)).toEqual(original)
      expect(await db.aiUsageLog.toArray()).toEqual(usageBefore)
      for (let index = 0; index < sample.count - 1; index += 1) expect((await producer(f, index)).projection.state).toBe('awaiting_confirmation')
      db.close(); await db.open(); const before = await allTables()
      expect((await readAuthoringFieldAdoptionViewsV1(f.input)).field.completed).toBe(true)
      await recoverInterruptedAuthoringRun(f.input)
      const repeated = await adoptAuthoringCandidate(f.input)
      expect(repeated.written).toEqual([]); expect(repeated.recovered).toBe(true)
      expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(sample.count)
    })

  it.each(['world', 'story'] as const)('%s first intent freezes author choice, draft and reject in native CAS', async family => {
    const f = await fixture(family); await edit(f); await confirmNodeFieldAdoptionIntentV1(f.choice)
    const before = await allTables()
    for (const patch of [{ output: 'changed after intent' }, { selectedVariantIndex: 0 }, { reject: true }]) {
      await expect(reviseAuthoringCandidate({ ...f.input, ...patch })).rejects.toThrow('首次确认')
    }
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(2)
  })

  it.each(['node-projection', 'terminal-event'] as const)('%s failure keeps paid business proof; readonly refresh and explicit continue converge once', async boundary => {
    const f = await fixture('world'); await edit(f)
    const nodeFault = (mods: Partial<NodeRunRecord>) => {
      if (typeof mods.nodeResultsJson === 'string' && JSON.parse(mods.nodeResultsJson).field.status === 'adopted') throw new Error('NODE_PROJECTION_FAILED')
    }
    const eventFault = (_key: unknown, row: { type: string }) => {
      if (row.type === 'verification.accepted') throw new Error('TERMINAL_EVENT_FAILED')
    }
    if (boundary === 'node-projection') db.nodeRuns.hook('updating', nodeFault)
    else db.agentRunEvents.hook('creating', eventFault)
    try { await expect(adoptAuthoringCandidate(f.input)).rejects.toThrow(/NODE_PROJECTION_FAILED|TERMINAL_EVENT_FAILED/) }
    finally { db.nodeRuns.hook('updating').unsubscribe(nodeFault); db.agentRunEvents.hook('creating').unsubscribe(eventFault) }
    const proof = await readNodeFieldAdoptionProofV1(f.choice)
    expect(proof.state).toBe('committed')
    const interrupted = await producer(f, 1)
    expect(interrupted.projection.state).toBe('running')
    expect(interrupted.events.some(event => ['step.succeeded', 'verification.accepted', 'memory.settlement.recorded'].includes(event.type))).toBe(false)
    const targetBefore = await db.table(f.table).toArray()
    db.close(); await db.open(); const beforeRecovery = await allTables()
    await recoverInterruptedAuthoringRun(f.input)
    expect((await readAuthoringFieldAdoptionViewsV1(f.input)).field).toMatchObject({ locked: true, completed: false, canContinue: true })
    expect(await allTables()).toEqual(beforeRecovery)
    const continued = await adoptAuthoringCandidate(f.input)
    expect(continued.recovered).toBe(true); expect(continued.written).toEqual([])
    expect(await db.table(f.table).toArray()).toEqual(targetBefore)
    expect((await producer(f, 1)).projection.state).toBe('completed')
    expect(f.sends).toHaveLength(2)
  })

  it('a paid prefix with a later unknown request stays visible and cannot be re-signed or resent by adoption', async () => {
    const f = await fixture('world', 2, true)
    expect(f.generated.run.status).toBe('failed')
    const recovered = await recoverInterruptedAuthoringRun(f.input)
    const candidate = JSON.parse(recovered.nodeResultsJson).field
    expect(candidate.variants).toHaveLength(1); expect(candidate.signature).toBeUndefined()
    const before = await allTables()
    await expect(adoptAuthoringCandidate({ ...f.input, output: candidate.output })).rejects.toThrow('签名')
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(2)
    const unknown = await producer(f, 1)
    expect(unknown.projection.state).toBe('paused')
    expect(unknown.events.filter(event => event.type === 'model.responded')).toHaveLength(0)
  })

  it.each(['world', 'story'] as const)('%s changed source/target rejects before first intent without hiding raw evidence', async family => {
    const f = await fixture(family); await edit(f)
    await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, target: f.table,
      mode: 'replace', data: { [f.field]: '另一作者已确认的内容，不能覆盖。' } })
    const before = await allTables()
    await expect(adoptAuthoringCandidate(f.input)).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(2)
  })
})
