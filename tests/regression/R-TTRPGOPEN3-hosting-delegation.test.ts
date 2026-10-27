import { beforeEach,afterEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1,changeTtrpgSafetyStatus,closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { assertTtrpgOpenHostingDelegationV1,assertTtrpgOpenHostingRequestV1 } from '../../src/lib/ttrpg/open-hosting-delegation'
import { parseTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/open-coordination'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { generateTtrpgOpenCompanionCandidateV1,executeTtrpgOpenCompanionRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenCompanionInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { ttrpgOpenCallBindingHashV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { seedOpenInteractionV1 } from '../helpers/open-ttrpg-interaction'
import { proposeTtrpgOpenManualActionV1 } from '../../src/lib/ttrpg/open-table-service'

describe('R-TTRPGOPEN3 durable bounded hosting permission', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup(enabled = true) {
    const f = await readyOpenTtrpgSessionV1('本轮有限主持',p => { p.ttrpg!.campaign.runtimePolicy.enabled = enabled; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 200000 })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'hosting.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: '我明确开始本轮有限主持' })
    const epoch = rt(await readProductRuntimeState(f.sessionId)).openRun!.coordination.epochs[0]
    const grantEnvelope = await openEnvelopeV1(f.sessionId,'hosting.grant')
    const grant = async (overrides = {}) => delegateTtrpgOpenHostingV1({ ...grantEnvelope,viewerKey: OPEN_HUMAN_VIEWER,
      epochKey: epoch.epochKey,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch',...overrides })
    return { f,epoch,grant }
  }
  it('saves one explicit authority receipt without time, state, model sends or budget resets and replays it exactly',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId),event = await x.grant()
    expect(await x.grant()).toEqual(event)
    const after = await readProductRuntimeState(x.f.sessionId),epoch = rt(after).openRun!.coordination.epochs[0],permission = epoch.hostingDelegation!
    expect(permission).toMatchObject({ viewerKey: OPEN_HUMAN_VIEWER,sourceRef: { sequence: event.sequence },maximumCostUsdPerCall: 0.1,
      capabilities: ['companion-proposal','safe-companion-action','kp-narration'],stoppedRef: null })
    expect(assertTtrpgOpenHostingDelegationV1(after,{ epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,delegationRef: permission.sourceRef }).permission).toEqual(permission)
    const request = { epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,delegationRef: permission.sourceRef,purpose: 'companion' as const,actorKey: 'companion.1',maximumCostUsd: 0.1 }
    expect(assertTtrpgOpenHostingRequestV1(after,request).permission).toEqual(permission)
    expect(() => assertTtrpgOpenHostingRequestV1(after,{ ...request,actorKey: 'hero' })).toThrow()
    expect(() => assertTtrpgOpenHostingRequestV1(after,{ ...request,maximumCostUsd: 0.2 })).toThrow()
    const runs = await db.agentRuns.count()
    await expect(prepareTtrpgOpenCompanionInputV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.over-limit'),scope: x.f.scope,
      viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',rawInput: '不得超出本轮每次调用上限',maximumOutputTokens: 800,maximumCostUsd: 0.2,
      hostingDelegationRef: permission.sourceRef,modelIdentity: { provider: 'test-adapter',model: 'injected' } })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(runs);expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    expect(after.entities).toEqual(before.entities);expect(rt(after).openRun!.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(epoch.budget).toEqual(x.epoch.budget);expect(epoch.successfulActorKeys).toEqual([]);expect(rt(after).openRun!.coordination.calls).toEqual([])
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(after)
    await expect(x.grant({ maximumCostUsdPerCall: 0.2 })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
  })
  it('refuses another viewer, enlarged budget, unconfirmed grant or wrong epoch with zero mutation',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    for (const change of [{ viewerKey: 'viewer.gm' },{ maximumCostUsdPerCall: x.epoch.budget.maximumCostUsd + 1 },{ decision: 'start' },{ epochKey: 'epoch.other' }]) {
      await expect(x.grant(change)).rejects.toThrow();expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    }
    expect(parseTtrpgOpenEpochV1(x.epoch)).not.toHaveProperty('hostingDelegation')
  })
  it('refuses a disabled author policy without manufacturing consent',async () => {
    const x = await setup(false),before = await readProductRuntimeState(x.f.sessionId)
    await expect(x.grant()).rejects.toThrow(/未允许/);expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('does not upgrade a manual-action-only epoch into model delegation',async () => {
    const x = await seedOpenInteractionV1('dialogue',p => { p.ttrpg!.campaign.runtimePolicy.enabled = true; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 200000 })
    await proposeTtrpgOpenManualActionV1({ ...x.input,request: x.request,submissionKey: 'hosting.manual',basisHash: x.catalog.basisHash,rawInput: '我只授权本人的人工行动' })
    const before = await readProductRuntimeState(x.f.sessionId)
    await expect(delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.manual.denied'),epochKey: rt(before).openRun!.coordination.activeEpochKey!,
      viewerKey: OPEN_HUMAN_VIEWER,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch' })).rejects.toThrow(/不能新授予/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
  it('revokes after an actual unknown model attempt without clearing the request or its usage',async () => {
    const x = await setup();await x.grant()
    const permission = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    await expect(generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.unknown.prepare'),scope: x.f.scope,sessionId: x.f.sessionId,
      viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',rawInput: '根据自己可见的资料协助调查',maximumOutputTokens: 800,maximumCostUsd: 0.1,hostingDelegationRef: permission.sourceRef,
      runAI: async () => { throw new Error('explicit simulated transport interruption') } })).rejects.toThrow(/interruption/)
    const before = await readProductRuntimeState(x.f.sessionId),calls = rt(before).openRun!.coordination.calls
    expect(calls[0].status).toBe('unknown')
    expect(() => assertTtrpgOpenHostingRequestV1(before,{ epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,
      delegationRef: rt(before).openRun!.coordination.epochs[0].hostingDelegation!.sourceRef,purpose: 'companion',actorKey: 'companion.2',maximumCostUsd: 0.1 })).toThrow(/等待原请求/)
    await stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.unknown.stop'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '结果未知，先停止自动继续' })
    const after = await readProductRuntimeState(x.f.sessionId)
    expect(rt(after).openRun!.coordination.calls).toEqual(calls);expect(after.entities).toEqual(before.entities)
    expect(rt(after).openRun!.coordination.epochs[0].actualCostUsd).toBe(rt(before).openRun!.coordination.epochs[0].actualCostUsd)
  })
  it('freezes exact delegation in the real RunContract and denies a send after permission was revoked',async () => {
    const x = await setup();await x.grant()
    const permission = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.prepare-bound'),scope: x.f.scope,
      viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',rawInput: '只依据自己的观察协助',maximumOutputTokens: 800,maximumCostUsd: 0.1,
      hostingDelegationRef: permission.sourceRef,modelIdentity: { provider: 'test-adapter',model: 'injected' } })
    const call = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.calls[0],run = await readInstanceAgentRunV1(x.f.scope,prepared.runId)
    expect(call.hostingDelegationRef).toEqual(permission.sourceRef)
    expect(call.intentRoutingVersion).toBe(2)
    expect(run.contract.runtimeBindingHash).toBe(await ttrpgOpenCallBindingHashV1({ actorKey: call.actorKey,authorizationEpochKey: call.authorizationEpochKey,
      intentRoutingVersion: 2,
      admissionStateHash: call.admissionStateHash,visibilityHash: call.visibilityHash,runtimeSourceHash: call.runtimeSourceHash,sessionKey: call.createdRef.sessionKey,hostingDelegationRef: permission.sourceRef }))
    expect(run.contract.runtimeBindingHash).not.toBe(await ttrpgOpenCallBindingHashV1({ actorKey: call.actorKey,authorizationEpochKey: call.authorizationEpochKey,
      admissionStateHash: call.admissionStateHash,visibilityHash: call.visibilityHash,runtimeSourceHash: call.runtimeSourceHash,sessionKey: call.createdRef.sessionKey,hostingDelegationRef: permission.sourceRef }))
    await stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.before-send.stop'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '尚未发送，撤销自动继续' })
    let sends = 0
    await expect(executeTtrpgOpenCompanionRequestV1({ scope: x.f.scope,sessionId: x.f.sessionId,viewerKey: OPEN_HUMAN_VIEWER,
      runId: prepared.runId,requestKey: prepared.requestKey,runAI: async () => { sends++;return '{}' } })).rejects.toThrow(/停止|过期/)
    expect(sends).toBe(0)
    const after = rt(await readProductRuntimeState(x.f.sessionId)).openRun!
    expect(after.coordination.calls[0]).toEqual(call);expect(after.operations).toEqual([])
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    expect(rt(await readProductRuntimeState(copy.id!)).openRun!.coordination.calls[0].hostingDelegationRef).toEqual(permission.sourceRef)
  })
  it('records actual completed usage after in-flight revocation but blocks adopting its late response',async () => {
    const x = await setup();await x.grant()
    const permission = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.in-flight'),scope: x.f.scope,
      viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',rawInput: '只依据自己的观察协助',maximumOutputTokens: 800,maximumCostUsd: 0.1,hostingDelegationRef: permission.sourceRef,
      runAI: async (_messages,_signal,result) => {
        await stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.in-flight.stop'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '停止后续自动行动' })
        result.usage = { inputTokens: 100,outputTokens: 50,totalTokens: 150 }
        return JSON.stringify({ goal: '观察现场',method: '调查',targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null })
      } })
    expect(generated.candidate.artifact.status).toBe('blocked');expect(generated.candidate.artifact.issues.some(i => i.code === 'ttrpg-open-intent-stale')).toBe(true)
    const state = rt(await readProductRuntimeState(x.f.sessionId)).openRun!
    expect(state.coordination.calls[0]).toMatchObject({ status: 'succeeded',usage: { inputTokens: 100,outputTokens: 50 } })
    expect(state.operations).toEqual([])
  })
  it('can revoke while paused, keeps original budget and cannot silently renew the same delegation',async () => {
    const x = await setup();await x.grant()
    const granted = await readProductRuntimeState(x.f.sessionId),permission = rt(granted).openRun!.coordination.epochs[0].hostingDelegation!
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(x.f.sessionId,'hosting.pause'),viewerKey: OPEN_HUMAN_VIEWER,status: 'paused',reason: '我需要暂停',changedBy: 'hero' })
    const paused = await readProductRuntimeState(x.f.sessionId)
    expect(() => assertTtrpgOpenHostingDelegationV1(paused,{ epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,delegationRef: permission.sourceRef })).toThrow()
    const command = { ...await openEnvelopeV1(x.f.sessionId,'hosting.stop'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '停止本轮自动继续' }
    const event = await stopTtrpgOpenHostingV1(command);expect(await stopTtrpgOpenHostingV1(command)).toEqual(event)
    const stopped = await readProductRuntimeState(x.f.sessionId),epoch = rt(stopped).openRun!.coordination.epochs[0]
    expect(epoch.hostingDelegation!.stoppedRef?.sequence).toBe(event.sequence);expect(epoch.budget).toEqual(x.epoch.budget)
    expect(() => assertTtrpgOpenHostingDelegationV1(stopped,{ epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,delegationRef: permission.sourceRef })).toThrow()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(x.f.sessionId,'hosting.resume'),viewerKey: OPEN_HUMAN_VIEWER,status: 'active',reason: '继续人工操作',changedBy: 'hero' })
    await expect(x.grant({ commandId: 'hosting.new-grant-same-epoch' })).rejects.toThrow()
  })
  it('keeps exact authority in complete backup and rejects forged capabilities, owner or source',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId),event = await x.grant(),payload = JSON.parse(event.payloadJson)
    for (const mutation of [(p: typeof payload) => p.permission.capabilities.push('player-decisions'),(p: typeof payload) => p.permission.viewerKey = 'viewer.other',
      (p: typeof payload) => p.permission.sourceRef.sequence++, (p: typeof payload) => p.permission.authorizationRef.sequence++]) {
      const changed = structuredClone(payload);mutation(changed)
      expect(() => replayProductRuntimeEvents(before,[{ ...event,payloadJson: JSON.stringify(changed) }])).toThrow()
    }
    const actual = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    expect(rt(await readProductRuntimeState(session.id!)).openRun!.coordination.epochs[0].hostingDelegation).toEqual(actual)
  })
  it('does not carry permission across a closed window into a new epoch',async () => {
    const x = await setup();await x.grant()
    const permission = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.close'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '本轮结束' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'hosting.next'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: '新的人工窗口' })
    const state = await readProductRuntimeState(x.f.sessionId),run = rt(state).openRun!
    expect(run.coordination.epochs[1]).not.toHaveProperty('hostingDelegation')
    expect(() => assertTtrpgOpenHostingDelegationV1(state,{ epochKey: run.coordination.activeEpochKey!,viewerKey: OPEN_HUMAN_VIEWER,delegationRef: permission.sourceRef })).toThrow()
  })
})
