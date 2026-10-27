import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1,startTtrpgOpenIntentCandidateOperationV1,confirmTtrpgOpenOperationV1,closeTtrpgOpenEpochV1,changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as adoption from '../../src/lib/ttrpg/open-runtime-adoption'
import * as table from '../../src/lib/ttrpg/open-table-service'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { approve,forkAndStart,rt } from '../helpers/open-ttrpg-branch-recovery'
import * as events from '../../src/lib/agent/run/event-store'
import { reconcileTtrpgOpenIntentRunV1 } from '../../src/lib/ttrpg/open-intent-adoption'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN1 original semantic proposal terminal receipts',{ timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  async function setup() {
    const f = await readyOpenTtrpgSessionV1('original semantic terminal',p => { p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    const rawInput = '调查当前地点的公开情况'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'receipt.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'submit-action',rawInput })
    const current = await readProductRuntimeState(f.sessionId),locationRef = current.entities.hero.locationKey!
    const runAI = vi.fn(async () => JSON.stringify({ goal: rawInput,method: 'investigate',targetRefs: [locationRef],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }))
    const g = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId,'receipt.generate'),scope: f.scope,actorKey: 'hero',viewerKey: OPEN_HUMAN_VIEWER,rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI })
    const read = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey,candidateHash: g.candidate.candidateHash }
    const input = async () => ({ ...await openEnvelopeV1(f.sessionId,'receipt.start'),...read,decision: 'start' as const })
    return { f,g,read,input,runAI }
  }
  it('finishes the generation Run on real admission while the action still awaits independent risk approval',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    const event = await startTtrpgOpenIntentCandidateOperationV1(await x.input())
    const after = await readProductRuntimeState(x.f.sessionId),snapshot = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    expect(snapshot.projection.state).toBe('completed');expect(snapshot.projection.terminalReceiptHash).toBeTruthy()
    expect(after.ttrpg!.openRun!.operations[0].status).toBe('awaiting-approval');expect(after.ttrpg!.openRun!.operations[0].approvals).toEqual([])
    expect(after.entities).toEqual(before.entities);expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.coordination.calls).toEqual(before.ttrpg!.openRun!.coordination.calls);expect(x.runAI).toHaveBeenCalledOnce()
    const rows = snapshot.events.filter(e => e.type === 'runtime.candidate.adopted');expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ candidateHash: x.read.candidateHash,commandIds: [event.commandId],resultingSequence: event.sequence })
    const retained = []
    for (const e of snapshot.events) if (e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot') {
      const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: x.f.scope.projectId,artifactKind: 'source-snapshot',contentHash: e.payload.contentHash }))
      if (body.schema === 'storyforge.ttrpg-intent-admission-verification') retained.push(body)
    }
    expect(retained).toHaveLength(1);expect(retained[0].receipt.criteria).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'intent.protocol',status: 'passed' }),expect.objectContaining({ id: 'intent.admission',status: 'passed' })]))
    expect((await startTtrpgOpenIntentCandidateOperationV1(await x.input())).sequence).toBe(event.sequence)
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).events).toEqual(snapshot.events)
  })
  it('retains the committed proposal through a receipt failure and explicitly repairs it without a second operation or provider',async () => {
    const x = await setup(),spy = vi.spyOn(adoption,'finalizeTtrpgOpenRuntimeAdoptionV1').mockRejectedValueOnce(new Error('receipt storage interrupted'))
    await expect(startTtrpgOpenIntentCandidateOperationV1(await x.input())).rejects.toMatchObject({ code: 'intent-committed-receipt-pending',message: expect.not.stringContaining('receipt storage interrupted') });spy.mockRestore()
    const before = await readProductRuntimeState(x.f.sessionId),pending = await table.readTtrpgOpenTableV1(x.read)
    expect(pending.player!.semanticIntentRepairs).toEqual([expect.objectContaining({ runId: x.read.runId,requestKey: x.read.requestKey,candidateHash: x.read.candidateHash })])
    await table.repairTtrpgOpenTableIntentV1(x.read)
    const snapshot = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    expect(snapshot.projection.state).toBe('completed');expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    expect((await table.readTtrpgOpenTableV1(x.read)).player!.semanticIntentRepairs).toEqual([])
    await table.repairTtrpgOpenTableIntentV1(x.read)
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).events).toEqual(snapshot.events);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('repairs historical admission after risk rejection, epoch closure and safety pause without granting new action authority',async () => {
    const x = await setup(),spy = vi.spyOn(adoption,'finalizeTtrpgOpenRuntimeAdoptionV1').mockRejectedValueOnce(new Error('terminal unavailable'))
    await expect(startTtrpgOpenIntentCandidateOperationV1(await x.input())).rejects.toThrow();spy.mockRestore()
    const admitted = await readProductRuntimeState(x.f.sessionId),op = admitted.ttrpg!.openRun!.operations[0]
    await confirmTtrpgOpenOperationV1({ ...await operationInput(x.f.sessionId,op.operationKey,'approval.hero'),actorKey: 'hero',riskHash: op.riskHash,decision: 'reject' })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId,'receipt.close'),viewerKey: OPEN_HUMAN_VIEWER,epochKey: op.authorizationEpochKey,reason: '明确结束原窗口' })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(x.f.sessionId,'receipt.pause'),viewerKey: OPEN_HUMAN_VIEWER,changedBy: 'hero',status: 'paused',reason: '检查原回执' })
    const before = await readProductRuntimeState(x.f.sessionId)
    await expect(table.repairTtrpgOpenTableIntentV1({ ...x.read,viewerKey: 'viewer.other' })).rejects.toThrow()
    await table.repairTtrpgOpenTableIntentV1(x.read)
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).projection.state).toBe('completed')
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before);expect(before.ttrpg!.openRun!.operations[0].status).toBe('rejected')
    expect(x.runAI).toHaveBeenCalledOnce()
  })
  it.each(['verification.started','verification.accepted'] as const)('repairs after interrupted %s without duplicating confirmation, adoption or receipt',async cut => {
    const x = await setup(),original = events.appendAgentRunEventV1
    const spy = vi.spyOn(events,'appendAgentRunEventV1').mockImplementation(async input => {
      if (input.type === cut) throw Error('interrupted original Run transition')
      return original(input)
    })
    await expect(startTtrpgOpenIntentCandidateOperationV1(await x.input())).rejects.toMatchObject({ code: 'intent-committed-receipt-pending' });spy.mockRestore()
    const before = await readProductRuntimeState(x.f.sessionId),partial = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    expect(partial.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    await reconcileTtrpgOpenIntentRunV1(x.read)
    const after = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    expect(after.projection.state).toBe('completed');expect(after.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect(after.events.filter(e => e.type === 'confirmation.recorded')).toHaveLength(1)
    expect(after.events.filter(e => e.type === 'verification.accepted')).toHaveLength(1)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('does not sign an uncommitted proposal, a substituted candidate or a damaged original admission event',async () => {
    const x = await setup(),original = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    await expect(reconcileTtrpgOpenIntentRunV1(x.read)).rejects.toThrow(/准入/)
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).events).toEqual(original.events)
    const spy = vi.spyOn(adoption,'finalizeTtrpgOpenRuntimeAdoptionV1').mockRejectedValueOnce(new Error('retain pending proof'))
    await expect(startTtrpgOpenIntentCandidateOperationV1(await x.input())).rejects.toThrow();spy.mockRestore()
    const pending = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    await expect(reconcileTtrpgOpenIntentRunV1({ ...x.read,candidateHash: 'f'.repeat(64) })).rejects.toThrow()
    const event = (await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).filter(e => e.type === 'ttrpg.open.operation.started').toArray())[0]
    const body = JSON.parse(event.payloadJson);body.intent.viewerKey = 'viewer.other'
    await db.productRuntimeEvents.update(event.id!,{ payloadJson: JSON.stringify(body) })
    await expect(reconcileTtrpgOpenIntentRunV1(x.read)).rejects.toThrow()
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).events).toEqual(pending.events);expect(x.runAI).toHaveBeenCalledOnce()
  })
  it('retains scene/admission proof in the ancestor and portable backup without giving the child or imported Run execution authority',async () => {
    const x = await setup();await startTtrpgOpenIntentCandidateOperationV1(await x.input())
    const op = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0]
    await approve(x.f.sessionId,op.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: x.f.sessionId,operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const parent = await readProductRuntimeState(x.f.sessionId),branch = await forkAndStart(x.f.sessionId),child = rt(await readProductRuntimeState(branch.sessionId))
    expect(child.branchLineage!.recoveryTasks[0].operation.intentEvidence).toEqual(op.intentEvidence)
    expect(op.intentEvidence!.sceneScope).toBeTruthy();expect(branch.op.intentEvidence).toBeUndefined()
    const snapshot = await readInstanceAgentRunV1(x.f.scope,x.read.runId)
    await expect(reconcileTtrpgOpenIntentRunV1({ ...x.read,sessionId: branch.sessionId })).rejects.toThrow()
    expect((await readInstanceAgentRunV1(x.f.scope,x.read.runId)).events).toEqual(snapshot.events)
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => !JSON.parse(s.initialStateJson).ttrpg?.branchLineage)!
    const state = await readProductRuntimeState(copy.id!),imported = (await db.agentRuns.where('productRuntimeSessionId').equals(copy.id!).toArray())[0]
    expect(rt(state).openRun!.operations[0].intentEvidence).toEqual(rt(parent).openRun!.operations[0].intentEvidence)
    expect(imported.portableRuntimeOriginJson).toBeTruthy()
    await expect(reconcileTtrpgOpenIntentRunV1({ ...x.read,scope: { projectId,worldId: copy.worldId!,workId: copy.workId! },sessionId: copy.id!,runId: imported.id! })).rejects.toThrow(/导入|历史/)
    expect(x.runAI).toHaveBeenCalledOnce()
  })
})
