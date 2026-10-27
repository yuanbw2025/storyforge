import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,startTtrpgOpenIntentCandidateOperationV1,clarifyTtrpgOpenIntentCandidateV1,preauthorizeTtrpgOpenCompanionV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenIntentCandidateV1,generateTtrpgOpenCompanionCandidateV1,readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenTableIntentReviewV1 } from '../../src/lib/ttrpg/open-table-service'
import { applyTtrpgOpenOperationEventV1 } from '../../src/lib/ttrpg/open-operation-reducer'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { resolveTtrpgOpenIntentTargetV1,parseTtrpgOpenSceneScopeV1 } from '../../src/lib/ttrpg/open-rule-request-contract'
import { parseTtrpgOpenIntentClarificationV1 } from '../../src/lib/ttrpg/open-intent-clarification-contract'
import { parseTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation'

describe('R-TTRPGOPEN1 current-scene scope boundaries',() => {
  it.each([
    { targetRefs: ['some.other.place'],currentLocationRef: 'here' },
    { targetRefs: ['hero'],currentLocationRef: 'here' },
    { targetRefs: ['here'],currentLocationRef: null },
    { targetRefs: ['here','some.other.place'],currentLocationRef: 'here' },
  ])('refuses to erase an unproved scene target %j',input => {
    expect(() => resolveTtrpgOpenIntentTargetV1({ route: 'existing-action',actionTarget: 'scene',actorKey: 'hero',...input })).toThrow()
  })
  it('retains legacy empty scene scope and real character targets without inventing a location',() => {
    expect(resolveTtrpgOpenIntentTargetV1({ route: 'existing-action',actionTarget: 'scene',actorKey: 'hero',targetRefs: [],currentLocationRef: null })).toEqual({ targetKey: null })
    expect(resolveTtrpgOpenIntentTargetV1({ route: 'existing-action',actionTarget: 'single-ally',actorKey: 'hero',targetRefs: ['ally'],currentLocationRef: 'here' })).toEqual({ targetKey: 'ally' })
    expect(() => parseTtrpgOpenSceneScopeV1({ kind: 'any-scene',locationRef: 'here' })).toThrow()
    expect(() => parseTtrpgOpenSceneScopeV1({ kind: 'current-scene',locationRef: 'here',ignorePosition: true })).toThrow()
  })
})

describe('R-TTRPGOPEN1 lossless current scene scope from original semantic intent', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup(companion = false,wrongTarget = false) {
    const f = await readyOpenTtrpgSessionV1('explicit current place',p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
      if (companion) { const a = p.ttrpg!.rulePack.content.actions.find(a => a.key === 'investigate')!;a.effects = [];a.costResourceKey = null;a.costAmount = 0 }
    })
    const actorKey = companion ? 'companion.1' : 'hero',rawInput = '调查当前场景的公开信息，不预设已经发现线索'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'scene.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: companion ? 'continue-host' : 'submit-action',rawInput })
    const location = (await loadTtrpgOpenPlayerContextV1({ scope: f.scope,sessionId: f.sessionId,actorKey })).view.self.locationKey!
    const runAI = vi.fn(async () => JSON.stringify({ goal: rawInput,method: 'investigate',targetRefs: [wrongTarget ? actorKey : location],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }))
    const args = { ...await openEnvelopeV1(f.sessionId,'scene.generate'),scope: f.scope,actorKey,viewerKey: OPEN_HUMAN_VIEWER,rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI }
    const g = companion ? await generateTtrpgOpenCompanionCandidateV1(args) : await generateTtrpgOpenIntentCandidateV1(args)
    const base = async () => ({ ...await openEnvelopeV1(f.sessionId,'scene.confirm'),viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey,candidateHash: g.candidate.candidateHash })
    return { f,g,base,actorKey,location,runAI }
  }
  it('retains the original location reference while preparing the canonical scene request without executing it',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    const review = await readTtrpgOpenTableIntentReviewV1({ ...await x.base(),scope: x.f.scope })
    expect(review.canConfirm).toBe(true);expect(review.message).toContain('当前场景')
    const event = await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start' })
    const state = await readProductRuntimeState(x.f.sessionId),op = state.ttrpg!.openRun!.operations[0]
    expect(op.plan.request.targetKey).toBeNull();expect(op.intentEvidence!.sceneScope).toEqual({ kind: 'current-scene',locationRef: x.location })
    const forged = structuredClone(op);forged.plan.request.ruleKey = 'assist'
    expect(() => parseTtrpgOpenOperationV1(forged)).toThrow()
    expect(op.status).toBe('awaiting-approval');expect(op.approvals).toEqual([]);expect(state.entities).toEqual(before.entities)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime);expect(x.runAI).toHaveBeenCalledOnce()
    expect((await readTtrpgOpenIntentCandidateV1({ ...await x.base(),scope: x.f.scope }))!.intent!.targetRefs).toEqual([x.location])
    expect((await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start' })).sequence).toBe(event.sequence)
    const shifted = structuredClone(before);shifted.entities[x.actorKey].locationKey = 'another.location'
    expect(() => applyTtrpgOpenOperationEventV1(shifted,event,JSON.parse(event.payloadJson))).toThrow(/场景/)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(state)
  })
  it('never drops an actor target and permits a bounded explicit human repair to the real current scene',async () => {
    const x = await setup(false,true),before = await readProductRuntimeState(x.f.sessionId)
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start' })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    const review = await readTtrpgOpenTableIntentReviewV1({ ...await x.base(),scope: x.f.scope })
    expect(review).toMatchObject({ canConfirm: false,canClarify: true })
    await clarifyTtrpgOpenIntentCandidateV1({ ...await x.base(),expectedCount: 0,selection: { goal: '改为调查自身当前场景',method: 'investigate',targetRefs: [x.location],requestedOutcome: null } })
    const record = (await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].intentClarifications![0]
    expect(record.sceneScope).toEqual({ kind: 'current-scene',locationRef: x.location });expect(record.selection.targetRefs).toEqual([x.location]);expect(record.request!.targetKey).toBeNull()
    expect(() => parseTtrpgOpenIntentClarificationV1({ ...record,sceneScope: { kind: 'current-scene',locationRef: 'another.place' } })).toThrow()
    expect(() => parseTtrpgOpenIntentClarificationV1({ ...record,sceneScope: undefined })).toThrow()
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',clarificationHash: record.clarificationHash })
    const original = await readProductRuntimeState(x.f.sessionId),projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0],restored = await readProductRuntimeState(copy.id!)
    expect(restored.ttrpg!.openRun!.operations[0].intentEvidence!.sceneScope).toEqual(record.sceneScope)
    expect(restored.ttrpg!.openRun!.coordination.calls[0].intentClarifications).toEqual(original.ttrpg!.openRun!.coordination.calls[0].intentClarifications)
  })
  it('retains the actual AI actor and rechecks scope under the original Session Zero preauthorization',async () => {
    const x = await setup(true)
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start' })
    const before = await readProductRuntimeState(x.f.sessionId),op = before.ttrpg!.openRun!.operations[0]
    await preauthorizeTtrpgOpenCompanionV1({ ...await x.base(),...await operationInput(x.f.sessionId,op.operationKey,'preauthorization') })
    const state = await readProductRuntimeState(x.f.sessionId)
    expect(state.ttrpg!.openRun!.operations[0].status).toBe('executing');expect(state.ttrpg!.openRun!.operations[0].plan.request.actorKey).toBe(x.actorKey)
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime);expect(x.runAI).toHaveBeenCalledOnce()
  })
})
