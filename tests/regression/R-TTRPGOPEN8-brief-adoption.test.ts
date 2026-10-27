import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, recordTtrpgOpenNarrativeMemoryV1, acceptTtrpgOpenBriefMemoryV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenBriefInputV1, prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenBriefRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { reconcileTtrpgOpenBriefMemoryRunV1, TtrpgOpenBriefMemoryReceiptPendingError } from '../../src/lib/ttrpg/open-brief-adoption'
import { parseTtrpgOpenMemoryReceiptV1 } from '../../src/lib/ttrpg/open-memory-contract'
import { parseTtrpgOpenModelMemoryReceiptV2 } from '../../src/lib/ttrpg/open-model-memory-contract'
import { readTtrpgOpenNarrativeMemoriesV1 } from '../../src/lib/ttrpg/open-memory-service'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession, replayProductRuntimeEvents, parseProductRuntimeState, hashProductRuntimeStateV1 } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { ttrpgOpenModelMemoryWindowBodyV2 } from '../../src/lib/ttrpg/open-memory-prefix-proof'

const rawInput = '复盘共同资料，保留英雄原来的猜测。'
async function sharedNote(sessionId: number, key: string) {
  const e = await openEnvelopeV1(sessionId, `note.${key}`)
  return recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey: OPEN_HUMAN_VIEWER, draft: { revisionKey: key, observerKey: 'hero', reliability: 'belief', audience: 'party', knownBy: [],
    summary: '英雄怀疑旧港的船被人动过。', fromEventSequence: 1, toEventSequence: e.baseSequence } })
}
async function setup() {
  const f = await readyOpenTtrpgSessionV1('Adopt model recap', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
  await sharedNote(f.sessionId, 'shared')
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'brief.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'request-brief', rawInput })
  const p = await prepareTtrpgOpenBriefInputV1({ ...await openEnvelopeV1(f.sessionId, 'brief.prepare'), scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER, rawInput,
    modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
  const id = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: p.runId, requestKey: p.requestKey }
  const result = await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => JSON.stringify({ paragraphs: [{ text: '英雄仍怀疑旧港的船被人动过，这还不是已确认事实。', sourceKeys: ['memory.shared'] }] }) })
  if (result.status !== 'candidate') throw new Error('missing candidate')
  return { f, p, id: { ...id, candidateHash: result.candidate.candidateHash }, candidate: result.candidate }
}
async function accept(s: Awaited<ReturnType<typeof setup>>) {
  return acceptTtrpgOpenBriefMemoryV1({ ...await openEnvelopeV1(s.f.sessionId, 'brief.confirm'), viewerKey: s.id.viewerKey,
    runId: s.id.runId, requestKey: s.id.requestKey, candidateHash: s.id.candidateHash })
}
describe('R-TTRPGOPEN8 exact model recap memory adoption', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('atomically saves one model-reviewed E15 and row, completes the durable receipt, and gives the next real input its original source basis', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), event = await accept(s)
    const receipt = parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(event.payloadJson).memory)
    expect(receipt).toMatchObject({ version: 2, origin: 'model-reviewed', draft: { observerKey: 'gm', reliability: 'hearsay', audience: 'party' },
      model: { candidateHash: s.id.candidateHash, rawResponseHash: s.candidate.rawResponseHash } })
    expect(receipt.model.attributions.find(row => row.citationKey === 'memory.shared')).toMatchObject({ observerKey: 'hero', reliability: 'belief', origin: 'human-authored' })
    expect(receipt.sourceWindow.eventCount).toBe(s.p.event.sequence - 1)
    expect(() => parseTtrpgOpenMemoryReceiptV1(receipt)).toThrow()
    expect((await accept(s)).id).toBe(event.id)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(2)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    const run = await readInstanceAgentRunV1(s.f.scope, s.id.runId)
    expect(run.projection.state).toBe('completed'); expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(run.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect((await readTtrpgOpenNarrativeMemoriesV1({ ...s.id })).entries.find(e => e.revisionKey === receipt.draft.revisionKey)?.origin).toBe('model-reviewed')
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'brief.done'), viewerKey: s.id.viewerKey, epochKey: s.candidate.epochKey, reason: '已审阅并保存复盘' })
    const action = '根据复盘继续调查旧港'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'next.action'), viewerKey: s.id.viewerKey, triggerKind: 'submit-action', rawInput: action })
    const next = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'next.prepare'), scope: s.f.scope, viewerKey: s.id.viewerKey, actorKey: 'hero', rawInput: action,
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const text = next.messages.map(m => m.content).join('\n')
    expect(text).toContain('model-reviewed'); expect(text).toContain('sourceAttributions'); expect(text).toContain('"reliability":"belief"'); expect(text).toContain('"observerKey":"hero"')
  })
  it('rolls back both E15 and head when the unique memory projection fails, then retries the same candidate once', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count()
    const spy = vi.spyOn(db.ttrpgNarrativeMemories, 'add').mockRejectedValueOnce(new Error('fixture model memory failure'))
    await expect(accept(s)).rejects.toThrow('fixture model memory failure'); spy.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(1)
    await accept(s); expect(await db.ttrpgNarrativeMemories.count()).toBe(2)
  })
  it('keeps the original hero belief as flat attribution when a later formal recap cites an earlier model recap', async () => {
    const s = await setup(), event = await accept(s), memory = parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(event.payloadJson).memory)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'first.brief.done'), viewerKey: s.id.viewerKey, epochKey: s.candidate.epochKey, reason: '已保存第一份复盘' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'second.brief.epoch'), viewerKey: s.id.viewerKey, triggerKind: 'request-brief', rawInput })
    const p = await prepareTtrpgOpenBriefInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'second.brief.prepare'), scope: s.f.scope, viewerKey: s.id.viewerKey, rawInput,
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const generated = await executeTtrpgOpenBriefRequestV1({ ...s.id, runId: p.runId, requestKey: p.requestKey,
      runAI: async () => JSON.stringify({ paragraphs: [{ text: '上一份回顾仍把船只问题记录为英雄的怀疑。', sourceKeys: [`memory.${memory.draft.revisionKey}`] }] }) })
    if (generated.status !== 'candidate') throw new Error('missing second candidate')
    const inherited = generated.candidate.attributions.find(source => source.citationKey === `memory.${memory.draft.revisionKey}`)
    expect(inherited).toMatchObject({ reliability: 'hearsay', observerKey: 'gm', origin: 'model-reviewed' })
    expect(inherited!.originalSources).toContainEqual(expect.objectContaining({ citationKey: 'memory.shared', reliability: 'belief', observerKey: 'hero', origin: 'human-authored' }))
    expect(inherited!.originalSources!.every(source => !('originalSources' in source))).toBe(true)
    const second = await acceptTtrpgOpenBriefMemoryV1({ ...await openEnvelopeV1(s.f.sessionId, 'second.brief.confirm'), viewerKey: s.id.viewerKey,
      runId: p.runId, requestKey: p.requestKey, candidateHash: generated.candidate.candidateHash })
    expect(parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(second.payloadJson).memory).model.attributions).toEqual(generated.candidate.attributions)
  })
  it('repairs a committed memory terminal interruption without duplicating the event, row or external response', async () => {
    const s = await setup()
    const spy = vi.spyOn(db.agentRunArtifacts, 'add').mockRejectedValueOnce(new Error('fixture terminal artifact failure'))
    await expect(accept(s)).rejects.toBeInstanceOf(TtrpgOpenBriefMemoryReceiptPendingError); spy.mockRestore()
    const count = await db.productRuntimeEvents.count(), rows = await db.ttrpgNarrativeMemories.toArray()
    const hash = await reconcileTtrpgOpenBriefMemoryRunV1(s.id)
    expect((await readInstanceAgentRunV1(s.f.scope, s.id.runId)).projection.terminalReceiptHash).toBe(hash)
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.ttrpgNarrativeMemories.toArray()).toEqual(rows)
    await accept(s); expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('rejects newly changed common memory and a different viewer before any E15 write', async () => {
    const s = await setup()
    await expect(acceptTtrpgOpenBriefMemoryV1({ ...await openEnvelopeV1(s.f.sessionId, 'wrong.viewer'), viewerKey: 'viewer.seat.companion.1', runId: s.id.runId,
      requestKey: s.id.requestKey, candidateHash: s.id.candidateHash })).rejects.toThrow()
    await sharedNote(s.f.sessionId, 'later')
    const count = await db.ttrpgNarrativeMemories.count()
    await expect(accept(s)).rejects.toThrow(/stale|情境|来源/)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(count)
  })
  it('does not adopt a declined candidate or relabel model provenance as manual authorship', async () => {
    const s = await setup(), snapshot = await readInstanceAgentRunV1(s.f.scope, s.id.runId)
    await appendAgentRunEventV1({ scope: s.f.scope, productRuntimeSessionId: s.f.sessionId, runId: s.id.runId, type: 'confirmation.recorded',
      payload: { stepId: 'ttrpg.open.brief', candidateHash: s.id.candidateHash, decision: 'reject' }, expectedLastSequence: snapshot.projection.lastSequence })
    await expect(accept(s)).rejects.toThrow(/拒绝/)
    await expect(recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(s.f.sessionId, 'fake.manual'), viewerKey: s.id.viewerKey,
      origin: 'model-reviewed', draft: { revisionKey: 'fake.manual', observerKey: 'gm', reliability: 'hearsay', audience: 'party', knownBy: [], summary: 'fake', fromEventSequence: 1, toEventSequence: 2 } } as any)).rejects.toThrow()
    expect(await db.ttrpgNarrativeMemories.count()).toBe(1)
  })
  it('rejects a forged compact source root even after its E15, projection and cached head are all rehashed consistently', async () => {
    const s = await setup(), event = await accept(s), payload = JSON.parse(event.payloadJson)
    const receipt = parseTtrpgOpenModelMemoryReceiptV2(payload.memory)
    receipt.sourceWindow.portableChainHash = '0'.repeat(64)
    receipt.derivedFromHash = await hashProductProductionValueV2(ttrpgOpenModelMemoryWindowBodyV2(receipt))
    const { receiptHash: _old, ...body } = receipt
    receipt.receiptHash = await hashProductProductionValueV2(body)
    payload.memory = receipt
    await db.productRuntimeEvents.update(event.id!, { payloadJson: JSON.stringify(payload) })
    const memory = (await db.ttrpgNarrativeMemories.where('sessionId').equals(s.f.sessionId).toArray()).find(row => row.revisionKey === receipt.draft.revisionKey)!
    await db.ttrpgNarrativeMemories.update(memory.id!, { derivedFromHash: receipt.derivedFromHash })
    const session = (await db.productRuntimeSessions.get(s.f.sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).sortBy('sequence')
    const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
    await db.productRuntimeSessions.update(s.f.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    await expect(readTtrpgOpenNarrativeMemoriesV1(s.id)).rejects.toThrow(/前缀/)
  })
  it('keeps only confirmed model memory across branch cuts, ancestor deletion and two complete imports with remapped physical IDs', async () => {
    const s = await setup(), event = await accept(s), original = parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(event.payloadJson).memory)
    const before = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence - 1, title: 'Before recap confirm' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence, title: 'After recap confirm' })
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(before.id!).count()).toBe(1)
    await expect(readTtrpgOpenNarrativeMemoriesV1({ scope: s.f.scope, sessionId: child.id!, viewerKey: s.id.viewerKey })).rejects.toThrow(/开团授权/)
    const childState = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.recap.zero'), viewerKey: s.id.viewerKey,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: childState.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.f.sessionId)
    const view = await readTtrpgOpenNarrativeMemoriesV1({ scope: s.f.scope, sessionId: child.id!, viewerKey: s.id.viewerKey })
    expect(view.entries.find(e => e.origin === 'model-reviewed')).toMatchObject({ historical: true, summary: original.draft.summary })
    for (let round = 0, projectId = s.f.scope.projectId; round < 2; round++) {
      projectId = await importProjectJSON(await exportProjectJSON(projectId))
      const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
      const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
      const restored = await readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: session.id!, viewerKey: s.id.viewerKey })
      expect(restored.entries.find(e => e.origin === 'model-reviewed')).toMatchObject({ historical: true, summary: original.draft.summary })
      const receipt = (await readProductRuntimeState(session.id!)).ttrpg!.openRun!.memoryReceipts!.find(r => r.version === 2)!
      expect(receipt).toEqual(original)
    }
  })
})
