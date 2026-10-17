import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, startTtrpgOpenIntentCandidateOperationV1, preauthorizeTtrpgOpenCompanionV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-candidate'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
const output = JSON.stringify({ goal: '调查河港', method: '观察岸边', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
describe('R-TTRPGOPEN3 real companion role purpose and owned source', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup(safe = false) {
    const fixture = await readyOpenTtrpgSessionV1('bounded companion', pkg => {
      const c = pkg.ttrpg!.campaign;c.runtimePolicy.enabled = true
      if (safe) { const a = pkg.ttrpg!.rulePack.content.actions.find(a => a.key === 'investigate')!;a.effects = [];a.description = '观察现场，不消耗资源。' }
      c.characterTemplates[0].playerProfile = { privateGoal: 'HUMAN-PRIVATE-GOAL', secret: 'HUMAN-PRIVATE-SECRET', portrayal: '谨慎' }
      c.characterTemplates[1].playerProfile = { privateGoal: 'AI-ONE-OWN-GOAL', secret: 'AI-ONE-OWN-SECRET', portrayal: '乐于观察' }
      c.characterTemplates[2].playerProfile = { privateGoal: 'AI-TWO-PRIVATE-GOAL', secret: 'AI-TWO-PRIVATE-SECRET', portrayal: '沉稳' }
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: 'HUMAN-PRIVATE-INTENT-MUST-NOT-AUTO-SHARE' })
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'companion.prepare'), scope: fixture.scope, viewerKey: OPEN_HUMAN_VIEWER,
      actorKey: 'companion.1', rawInput: '依据自己的已知资料，提出一次协作观察行动。', maximumOutputTokens: 800, maximumCostUsd: 0.1 }
    return { fixture, input }
  }
  it('uses one dedicated companion Skill request with its own goal and observations, excluding all other private profiles and original human intent', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.fixture.sessionId), runAI = vi.fn(async () => output)
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...f.input, runAI }), text = generated.prepared.messages.map(m => m.content).join('\n')
    expect(runAI).toHaveBeenCalledTimes(1);expect(text).toContain('AI-ONE-OWN-GOAL');expect(text).not.toContain('HUMAN-PRIVATE');expect(text).not.toContain('AI-TWO-PRIVATE')
    expect(generated.candidate.intent).toMatchObject({ actorKey: 'companion.1', source: 'companion:companion.1' })
    const state = await readProductRuntimeState(f.fixture.sessionId)
    expect(state.ttrpg!.openRun!.coordination.calls[0].skillId).toBe('prose.ttrpg-open-companion');expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await readTtrpgOpenIntentCandidateV1({ scope: f.fixture.scope, sessionId: f.fixture.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey })).toEqual(generated.candidate)
  })
  it('rejects requesting a human as an AI companion and refuses another proposal request for the same companion/window', async () => {
    const f = await setup(), runAI = vi.fn(async () => output)
    await expect(generateTtrpgOpenCompanionCandidateV1({ ...f.input, actorKey: 'hero', runAI })).rejects.toThrow(/AI\/hybrid/)
    await generateTtrpgOpenCompanionCandidateV1({ ...f.input, runAI })
    await expect(generateTtrpgOpenCompanionCandidateV1({ ...f.input, ...await openEnvelopeV1(f.fixture.sessionId, 'companion.again'), runAI })).rejects.toThrow(/已有请求/)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('derives only a real safe Session Zero permission, persists it once and replays without inventing human approvals', async () => {
    const f = await setup(true), generated = await generateTtrpgOpenCompanionCandidateV1({ ...f.input, runAI: async () => JSON.stringify({ goal: '观察港口', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(f.fixture.sessionId, 'safe.admit'), viewerKey: OPEN_HUMAN_VIEWER, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash, decision: 'start' })
    const before = await readProductRuntimeState(f.fixture.sessionId), operation = before.ttrpg!.openRun!.operations[0]
    const command = { ...await operationInput(f.fixture.sessionId, operation.operationKey, 'preauthorization'), viewerKey: OPEN_HUMAN_VIEWER, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash }
    await expect(preauthorizeTtrpgOpenCompanionV1({ ...command, viewerKey: 'viewer.someone-else' })).rejects.toThrow()
    const event = await preauthorizeTtrpgOpenCompanionV1(command);expect(await preauthorizeTtrpgOpenCompanionV1(command)).toEqual(event)
    const admitted = await readProductRuntimeState(f.fixture.sessionId), actual = admitted.ttrpg!.openRun!.operations[0]
    expect(actual.status).toBe('executing');expect(actual.approvals).toEqual([]);expect(actual.preauthorization!.authorizationRef).toEqual(admitted.ttrpg!.authorization!.sourceRef)
    expect(admitted.entities).toEqual(before.entities);expect(admitted.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await resumeTtrpgOpenOperationV1({ sessionId: f.fixture.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER })).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const state = await readProductRuntimeState(f.fixture.sessionId), row = (await db.productRuntimeSessions.get(f.fixture.sessionId))!
    expect(state.ttrpg!.openRun!.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1'])
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.fixture.sessionId).sortBy('sequence'))).toEqual(state)
  })
  it('retains actual resource consequences behind human approval even for an observation proposal', async () => {
    const f = await setup(), generated = await generateTtrpgOpenCompanionCandidateV1({ ...f.input, runAI: async () => JSON.stringify({ goal: '观察港口', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(f.fixture.sessionId, 'unsafe.admit'), viewerKey: OPEN_HUMAN_VIEWER, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash, decision: 'start' })
    const before = await readProductRuntimeState(f.fixture.sessionId), operation = before.ttrpg!.openRun!.operations[0]
    await expect(preauthorizeTtrpgOpenCompanionV1({ ...await operationInput(f.fixture.sessionId, operation.operationKey, 'preauthorization'), viewerKey: OPEN_HUMAN_VIEWER, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })).rejects.toThrow(/预授权范围/)
    expect(await readProductRuntimeState(f.fixture.sessionId)).toEqual(before)
  })
  it('continues through the same governed intent/risk path and never starts an action merely from model output', async () => {
    const f = await setup(), generated = await generateTtrpgOpenCompanionCandidateV1({ ...f.input, runAI: async () => output })
    expect((await readProductRuntimeState(f.fixture.sessionId)).ttrpg!.openRun!.operations).toEqual([])
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(f.fixture.sessionId, 'admit'), viewerKey: OPEN_HUMAN_VIEWER, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash, decision: 'start' })
    const state = await readProductRuntimeState(f.fixture.sessionId), operation = state.ttrpg!.openRun!.operations[0]
    expect(operation.plan.request).toMatchObject({ actorKey: 'companion.1', controllerMode: 'ai' });expect(operation.status).toBe('awaiting-approval');expect(operation.approvals).toEqual([])
    const row = (await db.productRuntimeSessions.get(f.fixture.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.fixture.sessionId).sortBy('sequence'))).toEqual(state)
  })
})
