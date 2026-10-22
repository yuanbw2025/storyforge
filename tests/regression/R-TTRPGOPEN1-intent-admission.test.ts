import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { generateTtrpgOpenIntentCandidateV1, readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1, startTtrpgOpenIntentCandidateOperationV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { parseProductRuntimeState, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { approve, forkAndStart, rt } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'

describe('R-TTRPGOPEN1 human-confirmed semantic candidates enter frozen rule admission', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function setup(badOutput = false, declaredAssumptions: string[] = []) {
    const fixture = await readyOpenTtrpgSessionV1('open candidate admission', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    const view = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
    const action = view.view.rules.actions.find(action => action.target === 'scene'
      && view.view.rules.core.actionCatalog.some(row => row.actionKey === action.actionKey && row.available))!
    expect(action).toBeTruthy()
    const rawInput = `${action.name}河港`
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'admit.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput })
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(fixture.sessionId, 'admit.generate'),
      scope: fixture.scope, actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1,
      runAI: async () => badOutput ? 'invalid raw response' : JSON.stringify({ goal: rawInput, method: action.name,
        targetRefs: [], declaredResources: [], declaredAssumptions, requestedOutcome: null }) })
    const input = async () => ({ ...await openEnvelopeV1(fixture.sessionId, 'admit.start'), viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey,
      candidateHash: generated.candidate.candidateHash, decision: 'start' as const })
    return { fixture, generated, action, input }
  }
  it('starts exactly one operation, retaining genuine response provenance and waiting for separate risk approval', async () => {
    const { fixture, generated, action, input } = await setup(false, ['这是角色的未核实猜测'])
    const before = await readProductRuntimeState(fixture.sessionId)
    const event = await startTtrpgOpenIntentCandidateOperationV1(await input())
    expect((await startTtrpgOpenIntentCandidateOperationV1(await input())).sequence).toBe(event.sequence)
    const state = await readProductRuntimeState(fixture.sessionId), operation = state.ttrpg!.openRun!.operations[0]
    expect(operation.status).toBe('awaiting-approval')
    expect(operation.approvals).toEqual([])
    expect(operation.plan.request).toMatchObject({ route: 'existing-action', ruleKey: action.actionKey, actorKey: 'hero', targetKey: null })
    expect(operation.intentEvidence!.sourceRef).toEqual(state.ttrpg!.openRun!.coordination.calls[0].terminalRef)
    expect(state.ttrpg!.openRun!.operations).toHaveLength(1)
    expect(state.ttrpg!.openRun!.ruleReceipts).toEqual([])
    expect(state.entities).toEqual(before.entities)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const retained = await readTtrpgOpenIntentCandidateV1({ scope: fixture.scope, sessionId: fixture.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey })
    expect(retained.artifact.assumptions).toMatchObject([{ text: '这是角色的未核实猜测', confidence: 'low', status: 'provisional' }])
    const session = await db.productRuntimeSessions.get(fixture.sessionId)
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session!.initialStateJson),
      await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence'))).toEqual(state)
  })
  it('refuses a manual-repair candidate without creating an operation', async () => {
    const { fixture, input } = await setup(true)
    await expect(startTtrpgOpenIntentCandidateOperationV1(await input())).rejects.toThrow(/修订|受阻/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.operations).toEqual([])
  })
  it('refuses stale safety authority after generation', async () => {
    const { fixture, input } = await setup()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'admit.pause'), status: 'paused',
      reason: '暂停', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    await expect(startTtrpgOpenIntentCandidateOperationV1(await input())).rejects.toThrow(/暂停|stale|安全/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.operations).toEqual([])
  })
  it('refuses a substituted candidate hash or a different viewer', async () => {
    const { fixture, input } = await setup()
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await input(), candidateHash: 'f'.repeat(64) })).rejects.toThrow(/版本/)
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await input(), viewerKey: 'viewer.someone-else' })).rejects.toThrow(/授权/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.operations).toEqual([])
  })
  it('requires the actual candidate bytes at submission', async () => {
    const { fixture, input } = await setup()
    const row = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'source-snapshot'
      && row.content.includes('"schema":"storyforge.ttrpg-open-intent-candidate"'))!
    await db.agentRunArtifacts.delete(row.id!)
    await expect(startTtrpgOpenIntentCandidateOperationV1(await input())).rejects.toThrow(/artifact|工件/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.operations).toEqual([])
  })
  it('keeps an admitted candidate in ancestor proof without cloning its live model call or rerolling in the child', async () => {
    const { fixture, input } = await setup()
    await startTtrpgOpenIntentCandidateOperationV1(await input())
    const operation = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.operations[0]
    await approve(fixture.sessionId, operation.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: fixture.sessionId, operationKey: operation.operationKey,
      frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    const parent = await readProductRuntimeState(fixture.sessionId)
    const branch = await forkAndStart(fixture.sessionId)
    expect(rt(await readProductRuntimeState(branch.sessionId)).branchLineage!.recoveryTasks[0].operation.intentEvidence).toEqual(operation.intentEvidence)
    expect(branch.op.intentEvidence).toBeUndefined()
    expect(rt(await readProductRuntimeState(branch.sessionId)).openRun!.coordination.calls).toEqual([])
    await approve(branch.sessionId, branch.op.operationKey)
    expect(await resumeTtrpgOpenOperationV1({ sessionId: branch.sessionId, operationKey: branch.op.operationKey,
      frozenPlanHash: branch.op.planHash, viewerKey: OPEN_HUMAN_VIEWER })).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const child = await readProductRuntimeState(branch.sessionId)
    expect(child.entities).toEqual(parent.entities)
    expect(rt(child).openRun!.worldTime.worldTurn).toBe(rt(parent).openRun!.worldTime.worldTurn)
    expect(await db.productRuntimeEvents.where('sessionId').equals(branch.sessionId).filter(event => event.type === 'ttrpg.rule.action.resolved').count()).toBe(0)
  })
})
