import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, startTtrpgOpenIntentCandidateOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { rejectTtrpgOpenTableIntentV1, readTtrpgOpenTableV1, finishTtrpgOpenTableWindowV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import * as runStore from '../../src/lib/agent/run/event-store'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
describe('R-TTRPGOPEN3 actual player rejection and original cost evidence', () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  async function setup(invalid = false) {
    const f = await readyOpenTtrpgSessionV1('reject intent', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
    const rawInput = '调查港口'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    const runAI = vi.fn(async () => invalid ? 'invalid retained response' : JSON.stringify({ goal: rawInput, method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }))
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId, 'intent'), scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER, actorKey: 'hero', rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1, runAI })
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash }
    return { f, input, runAI }
  }
  it('recovers a committed rejection after a durable receipt interruption without changing the rejection or spending another request', async () => {
    const { f, input, runAI } = await setup(), interrupted = vi.spyOn(runStore, 'appendAgentRunEventV1').mockRejectedValueOnce(new Error('simulated receipt interruption'))
    await expect(rejectTtrpgOpenTableIntentV1(input)).rejects.toThrow(/interruption/);interrupted.mockRestore()
    const pending = await readTtrpgOpenTableV1(input)
    expect(pending.player!.candidates).toEqual([]);expect(pending.player!.pendingRejections).toHaveLength(1)
    const before = await readProductRuntimeState(f.sessionId)
    await rejectTtrpgOpenTableIntentV1(input)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect((await readTtrpgOpenTableV1(input)).player!.pendingRejections).toEqual([]);expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('allows only one winner when candidate admission races its rejection', async () => {
    const { f, input } = await setup(), command = { ...await openEnvelopeV1(f.sessionId, 'race.admit'), ...input, decision: 'start' as const }
    const results = await Promise.allSettled([startTtrpgOpenIntentCandidateOperationV1(command), rejectTtrpgOpenTableIntentV1(input)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const state = await readProductRuntimeState(f.sessionId), run = state.ttrpg!.openRun!, rejected = Boolean(run.coordination.calls[0].intentRejection)
    expect(run.operations).toHaveLength(rejected ? 0 : 1)
    const row = (await db.productRuntimeSessions.get(f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence'))).toEqual(state)
  })
  it.each([false, true])('records and replays one genuine rejection, retains request usage, and forbids later admission (invalid=%s)', async invalid => {
    const { f, input, runAI } = await setup(invalid), before = await readProductRuntimeState(f.sessionId)
    expect((await readTtrpgOpenTableV1(input)).player!.candidates).toHaveLength(1)
    await expect(rejectTtrpgOpenTableIntentV1({ ...input, viewerKey: 'viewer.someone-else' })).rejects.toThrow()
    await rejectTtrpgOpenTableIntentV1(input);await rejectTtrpgOpenTableIntentV1(input)
    const state = await readProductRuntimeState(f.sessionId), call = state.ttrpg!.openRun!.coordination.calls[0]
    expect(call.intentRejection!.candidateHash).toBe(input.candidateHash);expect(call.usage).toEqual(before.ttrpg!.openRun!.coordination.calls[0].usage)
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect((await readTtrpgOpenTableV1(input)).player!.candidates).toEqual([])
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(f.sessionId, 'admit'), ...input, decision: 'start' })).rejects.toThrow(/拒绝|修订/)
    expect((await readInstanceAgentRunV1(f.scope, input.runId)).projection.state).toBe('failed')
    await finishTtrpgOpenTableWindowV1(input);expect(runAI).toHaveBeenCalledTimes(1)
    const row = (await db.productRuntimeSessions.get(f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(f.sessionId))
  })
})
