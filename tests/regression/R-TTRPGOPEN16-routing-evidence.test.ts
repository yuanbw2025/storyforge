import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenIntentCandidateV1,readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1,startTtrpgOpenIntentCandidateOperationV1,clarifyTtrpgOpenIntentCandidateV1,clarifyTtrpgOpenIntentCandidateV2 } from '../../src/lib/ttrpg/runtime-commands'
import { inspectTtrpgOpenIntentRoutingV1,inspectTtrpgOpenIntentRoutingV2 } from '../../src/lib/ttrpg/open-intent-clarification'
import { ttrpgOpenIntentRoutingVersionForRunV1,ttrpgOpenIntentRoutingVersionForSkillV1 } from '../../src/lib/ttrpg/open-intent-routing-policy'
import { verifyTtrpgOpenModelCallEvidenceV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { parseTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/open-model-calls'
import { assertTtrpgOpenOperationIntentCallV1 } from '../../src/lib/ttrpg/open-operation'
import { parseTtrpgOpenIntentClarificationV1 } from '../../src/lib/ttrpg/open-intent-clarification-contract'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { approve,forkAndStart,rt } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { preparedOpenTtrpgCallV1 } from '../helpers/open-ttrpg-call'

describe('R-TTRPGOPEN16 original frozen routing and explicit clarification evidence',{ timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() })
  afterEach(() => { vi.restoreAllMocks();db.close() })
  async function setup(legacy = false,ambiguous = false) {
    const f = await readyOpenTtrpgSessionV1('versioned explicit method',p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    })
    const rawInput = '在行动之前先明确方法'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'method.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'submit-action',rawInput })
    const check = f.runtimePackage.ttrpg!.rulePack.content.genericChecks[0]
    const output = { goal: ambiguous ? '尚需明确的方法与对象' : '调查公开线索时先核对自己的状态',method: ambiguous ? null : check.checkKey,
      targetRefs: ambiguous ? [] : ['hero'],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }
    const runAI = vi.fn(async () => JSON.stringify(output)),actualSkill = skills.getAgentSkillV1
    // Prepare a real frozen v5 contract, then restore today's registry. No receipt or Run is forged.
    const old = legacy ? vi.spyOn(skills,'getAgentSkillV1').mockImplementation(id => {
      const skill = actualSkill(id)
      return id === 'prose.ttrpg-open-intent' ? { ...skill,promptVersion: 'ttrpg-open-intent-v5' } : skill
    }) : null
    let g: Awaited<ReturnType<typeof generateTtrpgOpenIntentCandidateV1>>
    try { g = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId,'method.generate'),scope: f.scope,
      actorKey: 'hero',viewerKey: OPEN_HUMAN_VIEWER,rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI }) }
    finally { old?.mockRestore() }
    const base = async () => ({ ...await openEnvelopeV1(f.sessionId,'method.admit'),viewerKey: OPEN_HUMAN_VIEWER,
      runId: g.prepared.runId,requestKey: g.prepared.requestKey,candidateHash: g.candidate.candidateHash })
    const review = async () => inspectTtrpgOpenIntentRoutingV1({ scope: f.scope,session: (await db.productRuntimeSessions.get(f.sessionId))!,
      state: await readProductRuntimeState(f.sessionId),content: f.runtimePackage.ttrpg!,viewerKey: OPEN_HUMAN_VIEWER,candidate: g.candidate })
    return { f,g,base,review,runAI,check,output }
  }
  it('binds a fresh exact check to its original v6 Run and admits it without changing the goal, target or raw response',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId),call = rt(before).openRun!.coordination.calls[0]
    const snapshot = await readInstanceAgentRunV1(x.f.scope,x.g.prepared.runId)
    expect(call.intentRoutingVersion).toBe(2);expect(await ttrpgOpenIntentRoutingVersionForRunV1(snapshot.run,call)).toBe(2)
    expect(snapshot.contract.executionBindings![0].promptVersion).toBe('ttrpg-open-intent-v6')
    expect((await x.review()).preview).toMatchObject({ route: 'generic-check',routeDetail: { checkKey: x.check.checkKey } })
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',effectBindings: { 'plan.success': { actor: 'hero' } } })
    const after = await readProductRuntimeState(x.f.sessionId),op = rt(after).openRun!.operations[0]
    expect(op).toMatchObject({ status: 'awaiting-approval',approvals: [],intentEvidence: { routingVersion: 2,rawResponseHash: x.g.candidate.rawResponseHash } })
    expect(op.plan.request).toMatchObject({ route: 'generic-check',ruleKey: x.check.checkKey,targetKey: 'hero' })
    expect(rt(after).openRun!.coordination.calls).toEqual(rt(before).openRun!.coordination.calls)
    expect(after.entities).toEqual(before.entities);expect(rt(after).openRun!.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect((await readTtrpgOpenIntentCandidateV1({ ...await x.base(),scope: x.f.scope })).intent).toEqual(x.g.candidate.intent)
    expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('keeps an archived v5 candidate on legacy routing after the live registry changes',async () => {
    const x = await setup(true),inspected = await x.review(),snapshot = await readInstanceAgentRunV1(x.f.scope,x.g.prepared.runId)
    expect(skills.getAgentSkillV1('prose.ttrpg-open-intent').promptVersion).toBe('ttrpg-open-intent-v6')
    expect(inspected.call).not.toHaveProperty('intentRoutingVersion')
    expect(await ttrpgOpenIntentRoutingVersionForRunV1(snapshot.run,inspected.call)).toBe(1)
    expect(inspected.preview.route).toBe('existing-action')
    expect(x.g.candidate.intent?.goal).toBe(x.output.goal);expect(x.g.candidate.intent?.method).toBe(x.check.checkKey)
    await verifyTtrpgOpenModelCallEvidenceV1({ scope: x.f.scope,sessionId: x.f.sessionId,runId: x.g.prepared.runId,call: inspected.call,mode: 'finish' })
  })
  it('keeps the original V1 execution contract on V1 even when its API prepares against today\'s registry',async () => {
    const x = await preparedOpenTtrpgCallV1(),event = await x.reserve(),call = JSON.parse(event.payloadJson).call
    expect(x.snapshot().contract.executionBindings![0].version).toBe(1)
    expect(x.snapshot().contract.executionBindings![0].promptVersion).toBe('ttrpg-open-intent-v6')
    expect(await ttrpgOpenIntentRoutingVersionForRunV1(x.snapshot().run,call)).toBe(1)
    expect(call).not.toHaveProperty('intentRoutingVersion')
    await expect(ttrpgOpenIntentRoutingVersionForRunV1(x.snapshot().run,{ ...call,intentRoutingVersion: 2 })).rejects.toThrow(/原冻结/)
  })
  it('requires explicit binding review for a recognized method and permits human changes only through the new API',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    expect((await x.review()).review).toMatchObject({ canConfirm: true,canClarify: false })
    const inspected = await inspectTtrpgOpenIntentRoutingV2({ scope: x.f.scope,session: (await db.productRuntimeSessions.get(x.f.sessionId))!,
      state: before,content: x.f.runtimePackage.ttrpg!,viewerKey: OPEN_HUMAN_VIEWER,candidate: x.g.candidate })
    expect(inspected.review).toMatchObject({ canConfirm: false,canClarify: true,route: 'generic-check' })
    const selection = { goal: x.output.goal,method: x.check.checkKey,targetRefs: ['hero'],requestedOutcome: null }
    const input = { ...await x.base(),selection,expectedCount: 0,effectBindings: { 'plan.success': { actor: 'hero' } } }
    await expect(clarifyTtrpgOpenIntentCandidateV1(input)).rejects.toThrow(/原澄清线程/)
    await expect(clarifyTtrpgOpenIntentCandidateV2({ ...input,selection: { ...selection,targetRefs: ['secret.actor'] } })).rejects.toThrow(/对象/)
    await expect(clarifyTtrpgOpenIntentCandidateV2({ ...input,effectBindings: { 'plan.success': { actor: 'secret.actor' } } })).rejects.toThrow(/对象/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await clarifyTtrpgOpenIntentCandidateV2(input)
    const reviewed = await x.review(),record = reviewed.call.intentClarifications![0]
    expect(record).toMatchObject({ version: 2,selection,request: { effectBindings: input.effectBindings } })
    await expect(clarifyTtrpgOpenIntentCandidateV2({ ...input,...await x.base(),selection: { ...selection,goal: '另一个标签页的修改' } })).rejects.toThrow(/线程已变化|进度/)
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',clarificationHash: record.clarificationHash })
    expect(rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0].plan.request).toEqual(record.request)
    expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('lets an explicit v2 clarification resolve an old candidate without upgrading its request, raw bytes or v1 API',async () => {
    const x = await setup(true,true),before = await readProductRuntimeState(x.f.sessionId)
    const selection = { goal: '调查公开线索时先核对自己的状态',method: x.check.checkKey,targetRefs: ['hero'],requestedOutcome: null }
    const input = { ...await x.base(),selection,expectedCount: 0,effectBindings: { 'plan.success': { actor: 'hero' } } }
    await expect(clarifyTtrpgOpenIntentCandidateV1(input)).rejects.toThrow(/场景行动只能指向行动者的当前场景/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    const event = await clarifyTtrpgOpenIntentCandidateV2(input)
    expect((await clarifyTtrpgOpenIntentCandidateV2(input)).sequence).toBe(event.sequence)
    const inspected = await x.review(),record = inspected.call.intentClarifications![0]
    expect(record).toMatchObject({ version: 2,selection,request: { route: 'generic-check',ruleKey: x.check.checkKey } })
    expect(() => parseTtrpgOpenIntentClarificationV1(record)).toThrow(/version/)
    const { intentClarifications: _records,...sameCall } = inspected.call
    expect(sameCall).toEqual(rt(before).openRun!.coordination.calls[0]);expect(x.g.candidate.intent?.method).toBeNull()
    const session = (await db.productRuntimeSessions.get(x.f.sessionId))!,events = await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')
    const edited = JSON.parse(event.payloadJson);delete edited.intent.routingVersion
    expect(() => replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson),events.map(e => e.sequence === event.sequence ? { ...e,payloadJson: JSON.stringify(edited) } : e))).toThrow()
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',clarificationHash: record.clarificationHash })
    const state = await readProductRuntimeState(x.f.sessionId),op = rt(state).openRun!.operations[0]
    expect(op.intentEvidence?.routingVersion).toBe(2);expect(op.plan.request).toEqual(record.request)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(state)
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const copied = await readProductRuntimeState(copy.id!)
    expect(rt(copied).openRun!.coordination.calls[0].intentClarifications).toEqual(inspected.call.intentClarifications)
    expect(rt(copied).openRun!.coordination.calls[0]).not.toHaveProperty('intentRoutingVersion')
    expect(rt(copied).openRun!.operations[0].intentEvidence).toEqual(op.intentEvidence)
    expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('rejects a missing or forged request marker, unsupported versions and a marker on another purpose',async () => {
    const x = await setup(),{ call } = await x.review(),snapshot = await readInstanceAgentRunV1(x.f.scope,x.g.prepared.runId)
    const noMarker = structuredClone(call);delete noMarker.intentRoutingVersion
    await expect(ttrpgOpenIntentRoutingVersionForRunV1(snapshot.run,noMarker)).rejects.toThrow(/原冻结/)
    await expect(verifyTtrpgOpenModelCallEvidenceV1({ scope: x.f.scope,sessionId: x.f.sessionId,runId: x.g.prepared.runId,call: noMarker,mode: 'finish' })).rejects.toThrow(/原冻结/)
    expect(() => parseTtrpgOpenModelCallV1({ ...call,intentRoutingVersion: 3 })).toThrow()
    expect(() => parseTtrpgOpenModelCallV1({ ...call,skillId: 'prose.ttrpg-open-kp' })).toThrow(/行动识别/)
    for (const promptVersion of ['ttrpg-open-intent-v0','ttrpg-open-intent-v7','unrelated-v6']) expect(() => ttrpgOpenIntentRoutingVersionForSkillV1({ id: call.skillId,promptVersion })).toThrow(/版本/)
    const legacy = await setup(true),old = await legacy.review(),oldRun = await readInstanceAgentRunV1(legacy.f.scope,legacy.g.prepared.runId)
    await expect(ttrpgOpenIntentRoutingVersionForRunV1(oldRun.run,{ ...old.call,intentRoutingVersion: 2 })).rejects.toThrow(/原冻结/)
  })
  it('rejects a forged or dropped operation routing witness in deterministic replay',async () => {
    const x = await setup()
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',effectBindings: { 'plan.success': { actor: 'hero' } } })
    const state = await readProductRuntimeState(x.f.sessionId),run = rt(state).openRun!,op = structuredClone(run.operations[0])
    delete op.intentEvidence!.routingVersion
    expect(() => assertTtrpgOpenOperationIntentCallV1(op,run.coordination.calls)).toThrow(/行动识别版本/)
    const original = (await db.productRuntimeSessions.get(x.f.sessionId))!,events = await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')
    const event = events.find(e => e.type === 'ttrpg.open.operation.started')!,payload = JSON.parse(event.payloadJson)
    delete payload.operation.intentEvidence.routingVersion
    expect(() => replayProductRuntimeEvents(parseProductRuntimeState(original.initialStateJson),events.map(e => e === event ? { ...e,payloadJson: JSON.stringify(payload) } : e))).toThrow(/行动识别版本/)
  })
  it('retains the original routing in backup/import and ancestor evidence without another model or dice',async () => {
    const x = await setup()
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',effectBindings: { 'plan.success': { actor: 'hero' } } })
    const before = await readProductRuntimeState(x.f.sessionId),operation = rt(before).openRun!.operations[0]
    const copiedId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(copiedId).toArray())[0],copied = await readProductRuntimeState(copy.id!)
    expect(rt(copied).openRun!.coordination.calls).toEqual(rt(before).openRun!.coordination.calls)
    expect(rt(copied).openRun!.operations[0].intentEvidence).toEqual(operation.intentEvidence)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await approve(x.f.sessionId,operation.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: x.f.sessionId,operationKey: operation.operationKey,frozenPlanHash: operation.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const parent = await readProductRuntimeState(x.f.sessionId),branch = await forkAndStart(x.f.sessionId),child = rt(await readProductRuntimeState(branch.sessionId))
    expect(child.branchLineage!.recoveryTasks[0].operation.intentEvidence).toEqual(operation.intentEvidence)
    expect(child.openRun!.coordination.calls).toEqual([]);expect(branch.op.intentEvidence).toBeUndefined()
    await approve(branch.sessionId,branch.op.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: branch.sessionId,operationKey: branch.op.operationKey,frozenPlanHash: branch.op.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    expect((await readProductRuntimeState(branch.sessionId)).entities).toEqual(parent.entities)
    expect(await db.productRuntimeEvents.where('sessionId').equals(branch.sessionId).filter(e => e.type === 'ttrpg.rule.action.resolved').count()).toBe(0)
    expect(x.runAI).toHaveBeenCalledOnce()
  })
})
