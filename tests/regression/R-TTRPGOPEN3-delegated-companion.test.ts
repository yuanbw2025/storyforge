import { beforeEach,afterEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1,startTtrpgOpenDelegatedCompanionOperationV1,
  startTtrpgOpenIntentCandidateOperationV1,preauthorizeTtrpgOpenCompanionV1,confirmTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { rt,operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN3 delegated companion proposal and actual safe admission', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup(options: { safe?: boolean;bound?: boolean } = {}) {
    const f = await readyOpenTtrpgSessionV1('有限委托的真实队友提案',p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true
      if (options.safe !== false) {
        const action = p.ttrpg!.rulePack.content.actions.find(a => a.key === 'investigate')!
        action.effects = [];action.description = '观察现场，不消耗资源。'
      }
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'delegated.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: '让队友在本轮已允许的范围内协作' })
    const epoch = rt(await readProductRuntimeState(f.sessionId)).openRun!.coordination.epochs[0]
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.sessionId,'delegated.grant'),epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch' })
    const permission = rt(await readProductRuntimeState(f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(f.sessionId,'delegated.candidate'),scope: f.scope,
      viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',rawInput: '依据自己的观察提出一次协作行动',maximumOutputTokens: 800,maximumCostUsd: 0.1,
      ...(options.bound === false ? {} : { hostingDelegationRef: permission.sourceRef }),
      runAI: async () => JSON.stringify({ goal: '观察港口',method: '调查',targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }) })
    const candidate = { viewerKey: OPEN_HUMAN_VIEWER,runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash }
    const input = async () => ({ ...await openEnvelopeV1(f.sessionId,'delegated.propose'),...candidate,hostingDelegationRef: permission.sourceRef })
    const stop = async () => stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.sessionId,'delegated.stop'),epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '我停止本轮自动继续' })
    return { f,epoch,permission,generated,candidate,input,stop }
  }
  async function proposal(x: Awaited<ReturnType<typeof setup>>) {
    const event = await startTtrpgOpenDelegatedCompanionOperationV1(await x.input())
    const op = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0]
    const command = { ...await operationInput(x.f.sessionId,op.operationKey,'preauthorization'),...x.candidate,hostingDelegationRef: x.permission.sourceRef,
      operationKey: op.operationKey,frozenPlanHash: op.planHash }
    return { event,op,command }
  }
  it('records system provenance, then applies real Session Zero permission and consumes one bounded actor action',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId),{ event,op,command } = await proposal(x)
    expect(await startTtrpgOpenDelegatedCompanionOperationV1(await x.input())).toEqual(event)
    expect(JSON.parse(event.payloadJson).intent).toMatchObject({ decision: 'delegate-proposal',hostingDelegationRef: x.permission.sourceRef })
    expect(op.intentEvidence!.hostingDelegationRef).toEqual(x.permission.sourceRef);expect(op.status).toBe('awaiting-approval');expect(op.approvals).toEqual([])
    expect((await readProductRuntimeState(x.f.sessionId)).entities).toEqual(before.entities)
    const prior = await readProductRuntimeState(x.f.sessionId),accepted = await preauthorizeTtrpgOpenCompanionV1(command)
    const afterPermission = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0]
    expect(afterPermission.preauthorization).toMatchObject({ basis: 'session-zero-policy',hostingDelegationRef: x.permission.sourceRef })
    expect(afterPermission.approvals).toEqual([])
    const forged = JSON.parse(accepted.payloadJson);forged.permission.hostingDelegationRef.sequence++
    expect(() => replayProductRuntimeEvents(prior,[{ ...accepted,payloadJson: JSON.stringify(forged) }])).toThrow()
    await settleOpenPaidTurnsV1(command)
    const after = await readProductRuntimeState(x.f.sessionId),run = rt(after).openRun!
    expect(run.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1']);expect(run.coordination.epochs[0].budget).toEqual(x.epoch.budget)
    expect(run.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic',check: null });expect(run.coordination.calls).toHaveLength(1)
    expect(await preauthorizeTtrpgOpenCompanionV1(command)).toEqual(accepted)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(after)
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const restored = rt(await readProductRuntimeState(copy.id!)).openRun!.operations[0]
    expect(restored.intentEvidence).toEqual(run.operations[0].intentEvidence);expect(restored.preauthorization).toEqual(run.operations[0].preauthorization)
  })
  it('keeps a risky proposal pending for actual humans without applying dice, resources or time',async () => {
    const x = await setup({ safe: false }),before = await readProductRuntimeState(x.f.sessionId),{ command } = await proposal(x)
    const proposed = await readProductRuntimeState(x.f.sessionId)
    await expect(preauthorizeTtrpgOpenCompanionV1(command)).rejects.toThrow(/预授权范围/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(proposed);expect(proposed.entities).toEqual(before.entities)
    expect(rt(proposed).openRun!.operations[0].status).toBe('awaiting-approval');expect(rt(proposed).openRun!.worldTime).toEqual(rt(before).openRun!.worldTime)
  })
  it('blocks a system proposal after revocation with zero operation writes',async () => {
    const x = await setup();await x.stop()
    const stopped = await readProductRuntimeState(x.f.sessionId)
    await expect(startTtrpgOpenDelegatedCompanionOperationV1(await x.input())).rejects.toThrow(/停止|过期/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(stopped);expect(rt(stopped).openRun!.operations).toEqual([])
  })
  it('blocks automatic execution after proposal revocation while preserving an explicit human decision path',async () => {
    const x = await setup(),{ op,command } = await proposal(x);await x.stop()
    const before = await readProductRuntimeState(x.f.sessionId)
    await expect(preauthorizeTtrpgOpenCompanionV1({ ...command,...await operationInput(x.f.sessionId,op.operationKey,'preauthorization') })).rejects.toThrow(/停止|过期/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await confirmTtrpgOpenOperationV1({ ...await operationInput(x.f.sessionId,op.operationKey,'approval.companion.1'),viewerKey: OPEN_HUMAN_VIEWER,
      operationKey: op.operationKey,frozenPlanHash: op.planHash,actorKey: 'companion.1',riskHash: op.riskHash,decision: 'approve' })
    expect(rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0].approvals[0].viewerKey).toBe(OPEN_HUMAN_VIEWER)
  })
  it('cannot borrow an unbound request and preserves the existing explicit human admission format',async () => {
    const x = await setup({ bound: false }),before = await readProductRuntimeState(x.f.sessionId)
    await expect(startTtrpgOpenDelegatedCompanionOperationV1(await x.input())).rejects.toThrow(/缺少同窗口/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(x.f.sessionId,'delegated.human-admit'),...x.candidate,decision: 'start' })
    const op = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0]
    expect(op.intentEvidence).not.toHaveProperty('hostingDelegationRef')
  })
  it('rejects replay that labels a system proposal as a human confirmation or substitutes the grant',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId),{ event } = await proposal(x),payload = JSON.parse(event.payloadJson)
    for (const mutate of [(p: typeof payload) => p.intent.decision = 'start',(p: typeof payload) => p.operation.intentEvidence.hostingDelegationRef.sequence++]) {
      const changed = structuredClone(payload);mutate(changed)
      expect(() => replayProductRuntimeEvents(before,[{ ...event,payloadJson: JSON.stringify(changed) }])).toThrow()
    }
  })
})
