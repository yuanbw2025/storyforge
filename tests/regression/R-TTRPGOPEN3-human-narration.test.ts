import { branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { assertTtrpgOpenHumanHostV1 } from '../../src/lib/ttrpg/open-authorization'
import * as artifacts from '../../src/lib/memory/artifact-store'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { cancelTtrpgOpenPreparedRequestV1 } from '../../src/lib/ttrpg/open-request-cancellation'
import { readTtrpgOpenTableV1, repairTtrpgOpenTableHumanNarrationV1 } from '../../src/lib/ttrpg/open-table-service'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { operationInput, rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { recordTtrpgOpenHumanNarrationV1, acceptTtrpgOpenKpNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenKpCandidateV1, executeTtrpgOpenKpRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenKpInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { loadTtrpgOpenKpContextV1 } from '../../src/lib/ttrpg/open-kp-context'
import { parseTtrpgOpenNarrationReceiptV1 } from '../../src/lib/ttrpg/open-kp-receipt'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
async function setup() {
  const f = await setupChecksFixtureV1({ ai: true });await resumeTtrpgOpenPlayV1(f.command)
  const input = { ...await openEnvelopeV1(f.command.sessionId, 'kp'), scope: f.f.scope, viewerKey: f.command.viewerKey,
    rawInput: '只依据全队已知的实际结算', maximumOutputTokens: 800, maximumCostUsd: 0.1 }
  const manualCommand = async () => ({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), text: '你们确认了本次调查的结果。', reason: 'host-authored' as const })
  return { ...f, input, manualCommand }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 real human narration recovery', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  it('saves an explicitly human receipt once, changes no mechanics/facts/knowledge/time and finishes the original owner chain', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId), command = await f.manualCommand()
    const event = await recordTtrpgOpenHumanNarrationV1(command);expect(await recordTtrpgOpenHumanNarrationV1(command)).toEqual(event)
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!, receipt = run.narrations![0]
    expect(receipt).toMatchObject({ sourceKind: 'human', basis: { previousRequests: [] }, binding: { operationKey: f.command.operationKey } })
    expect(receipt).not.toHaveProperty('rawResponseHash');expect(receipt).not.toHaveProperty('runContractHash');expect(run.coordination).toEqual(rt(before).openRun!.coordination)
    expect(state.entities).toEqual(before.entities);expect(run.knowledge).toEqual(rt(before).openRun!.knowledge);expect(run.factLedger).toEqual(rt(before).openRun!.factLedger);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect((await resumeTtrpgOpenPlayV1(f.command)).status).toBe('completed')
    await expect(loadTtrpgOpenKpContextV1({ scope: f.f.scope, sessionId: f.command.sessionId, actorKey: 'gm' })).rejects.toThrow()
    await replay(f.command.sessionId)
  })
  it('preserves a genuinely unknown provider result and its reserved budget when the human completes the prose', async () => {
    const f = await setup(), runAI = vi.fn(async () => { throw new Error('simulated interrupted transport') })
    await expect(generateTtrpgOpenKpCandidateV1({ ...f.input, runAI })).rejects.toThrow(/interrupted/)
    const before = await readProductRuntimeState(f.command.sessionId)
    await recordTtrpgOpenHumanNarrationV1({ ...await f.manualCommand(), reason: 'model-unavailable' })
    const result = await resumeTtrpgOpenPlayV1(f.command), state = await readProductRuntimeState(f.command.sessionId), receipt = rt(state).openRun!.narrations![0]
    expect(result).toEqual({ status: 'completed', nextStepKey: null, handoff: { kind: 'model-recovery', actorKey: null } })
    expect(receipt).toMatchObject({ sourceKind: 'human', basis: { previousRequests: [{ status: 'unknown', responseArtifactHash: null }] } })
    expect(rt(state).openRun!.coordination).toEqual(rt(before).openRun!.coordination);expect(runAI).toHaveBeenCalledTimes(1);await replay(f.command.sessionId)
  })
  it('refuses a manual overwrite while a real original request is still prepared', async () => {
    const f = await setup();await prepareTtrpgOpenKpInputV1({ ...f.input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const before = await readProductRuntimeState(f.command.sessionId)
    await expect(recordTtrpgOpenHumanNarrationV1(await f.manualCommand())).rejects.toThrow(/原请求/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
  })
  it('lets exactly one of a model candidate and a manual narrative become the canonical receipt', async () => {
    const f = await setup(), generated = await generateTtrpgOpenKpCandidateV1({ ...f.input, runAI: async () => JSON.stringify({ paragraphs: [{ text: '本次行动留下了可核对的结果。', sourceKeys: ['action.receipt'] }] }) }), command = await f.manualCommand()
    const results = await Promise.allSettled([recordTtrpgOpenHumanNarrationV1({ ...command, reason: 'replace-candidate' }), acceptTtrpgOpenKpNarrationV1({ ...command, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.narrations).toHaveLength(1)
    expect(await executeTtrpgOpenKpRequestV1({ ...f.input, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, runAI: async () => { throw new Error('must not send') } })).toEqual({ status: 'not-sent' })
    await replay(f.command.sessionId)
  })
  it('requires the actual human GM in human-host mode, and host authority itself does not depend on AI advice consent', async () => {
    const f = await setupChecksFixtureV1({ humanGm: true });await resumeTtrpgOpenPlayV1(f.command)
    const runtime = rt(await readProductRuntimeState(f.command.sessionId)), gm = runtime.authorization!.seats.find(s => s.role === 'gm')!
    await expect(recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), text: '玩家不能冒充真人主持。', reason: 'host-authored' })).rejects.toThrow(/真人 GM/)
    const authority = structuredClone(runtime.authorization!);authority.seats.find(s => s.role === 'gm')!.consent.aiAdviceAllowed = false
    expect(assertTtrpgOpenHumanHostV1(authority, gm.viewerKey).seatKey).toBe(gm.seatKey)
    await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), viewerKey: gm.viewerKey, text: '真人主持描述本次已完成的调查。', reason: 'host-authored' })
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.narrations![0].binding.viewerKey).toBe(gm.viewerKey)
    await replay(f.command.sessionId)
  })
  it('cancels a genuinely prepared request without sending, retains its counted slot, and permits manual completion', async () => {
    const f = await setup(), prepared = await prepareTtrpgOpenKpInputV1({ ...f.input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const input = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
    await expect(cancelTtrpgOpenPreparedRequestV1({ ...input, viewerKey: 'viewer.someone-else' })).rejects.toThrow()
    const event = await cancelTtrpgOpenPreparedRequestV1(input);expect(await cancelTtrpgOpenPreparedRequestV1(input)).toEqual(event)
    const before = await readProductRuntimeState(f.command.sessionId), call = rt(before).openRun!.coordination.calls[0]
    expect(call).toMatchObject({ status: 'failed', dispatchRef: null, usage: { inputTokens: 0, outputTokens: 0, actualCostUsd: 0 } })
    expect((await readInstanceAgentRunV1(f.f.scope, prepared.runId)).projection.state).toBe('cancelled')
    await recordTtrpgOpenHumanNarrationV1({ ...await f.manualCommand(), reason: 'model-unavailable' })
    expect((await resumeTtrpgOpenPlayV1(f.command)).status).toBe('completed')
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.coordination.calls).toEqual(rt(before).openRun!.coordination.calls)
    const runAI = vi.fn(async () => 'must not send')
    expect(await executeTtrpgOpenKpRequestV1({ ...input, runAI })).toEqual({ status: 'not-sent' });expect(runAI).not.toHaveBeenCalled();await replay(f.command.sessionId)
  })
  it('replaces an unusable genuine KP candidate and repairs an interrupted durable stop receipt without another model request', async () => {
    const f = await setup(), runAI = vi.fn(async () => 'invalid retained KP response'), generated = await generateTtrpgOpenKpCandidateV1({ ...f.input, runAI })
    const write = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockRejectedValueOnce(new Error('simulated replacement receipt interruption'))
    const input = { ...await f.manualCommand(), reason: 'replace-candidate' as const }
    await expect(recordTtrpgOpenHumanNarrationV1(input)).rejects.toThrow(/人工叙述已保存/);write.mockRestore()
    const before = await readProductRuntimeState(f.command.sessionId), tableInput = { scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey, operationKey: f.command.operationKey }
    expect((await readTtrpgOpenTableV1(tableInput)).player!.humanNarrationRepairs).toEqual([f.command.operationKey])
    await repairTtrpgOpenTableHumanNarrationV1(tableInput)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
    const snapshot = await readInstanceAgentRunV1(f.f.scope, generated.prepared.runId)
    expect(snapshot.projection.state).toBe('failed');expect(snapshot.projection.steps['ttrpg.open.kp'].confirmation).toBe('reject')
    expect((await readTtrpgOpenTableV1(tableInput)).player!.humanNarrationRepairs).toEqual([])
    expect(runAI).toHaveBeenCalledTimes(1);await replay(f.command.sessionId)
  })
  it('preserves human provenance through a branch and project backup without importing live model authority', async () => {
    const f = await setup();await recordTtrpgOpenHumanNarrationV1(await f.manualCommand());await resumeTtrpgOpenPlayV1(f.command)
    const parent = await readProductRuntimeState(f.command.sessionId), child = await branchProductRuntimeSession({ parentSessionId: f.command.sessionId,
      title: 'human narrative lineage', throughSequence: (await openEnvelopeV1(f.command.sessionId, 'cut')).baseSequence })
    const before = rt(await readProductRuntimeState(child.id!)), importedId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(r => rt(parseProductRuntimeState(r.initialStateJson)).sessionKey === before.sessionKey)!
    expect(rt(await readProductRuntimeState(copy.id!)).openRun!.narrations).toEqual(before.openRun!.narrations)
    expect(rt(await readProductRuntimeState(copy.id!)).authorization).toBeNull();expect(rt(await readProductRuntimeState(copy.id!)).openRun!.coordination.calls).toEqual([])
    await replay(copy.id!);expect(await readProductRuntimeState(f.command.sessionId)).toEqual(parent)
  })
  it('rejects model-proof fields attached to an explicitly human record', () => {
    expect(() => parseTtrpgOpenNarrationReceiptV1({ sourceKind: 'human', rawResponseHash: 'a'.repeat(64) })).toThrow()
  })
})
