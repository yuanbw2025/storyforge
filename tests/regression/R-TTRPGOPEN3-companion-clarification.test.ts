import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1,clarifyTtrpgOpenIntentCandidateV1,
  startTtrpgOpenIntentCandidateOperationV1,preauthorizeTtrpgOpenCompanionV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenCompanionCandidateV1,readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { inspectTtrpgOpenIntentRoutingV1 } from '../../src/lib/ttrpg/open-intent-clarification'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN3 human clarification retains the actual AI owner', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup() {
    const f = await readyOpenTtrpgSessionV1('ambiguous original AI proposal',p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
      p.ttrpg!.campaign.characterTemplates[1].playerProfile!.secret = 'AI-PRIVATE-CLARIFICATION-SENTINEL'
      const action = p.ttrpg!.rulePack.content.actions.find(a => a.key === 'investigate')!;action.effects = [];action.description = '观察现场，不消耗资源。'
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ai.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: '请队友提出当前可做的协作' })
    const epoch = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs[0]
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ai.delegate'),epochKey: epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch' })
    const grant = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs[0].hostingDelegation!
    const runAI = vi.fn(async () => JSON.stringify({ goal: '在同伴行动时提供掩护，提出一次护援协作意图。',method: null,targetRefs: [],declaredResources: [],declaredAssumptions: ['协作对象尚待明确，不假定他人在场'],requestedOutcome: null }))
    const g = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(f.sessionId,'clarify-ai.generate'),scope: f.scope,viewerKey: OPEN_HUMAN_VIEWER,actorKey: 'companion.1',
      rawInput: '依据已知情况提出行动',maximumOutputTokens: 800,maximumCostUsd: 0.1,hostingDelegationRef: grant.sourceRef,runAI })
    const base = async () => ({ ...await openEnvelopeV1(f.sessionId,'clarify-ai.decide'),viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey,candidateHash: g.candidate.candidateHash })
    const selection = { goal: '暂不假定同伴在场，先独立观察公开情况',method: 'investigate',targetRefs: [],requestedOutcome: null }
    const review = async () => (await inspectTtrpgOpenIntentRoutingV1({ scope: f.scope,session: (await db.productRuntimeSessions.get(f.sessionId))!,state: await readProductRuntimeState(f.sessionId),content: f.runtimePackage.ttrpg!,viewerKey: OPEN_HUMAN_VIEWER,
      candidate: (await readTtrpgOpenIntentCandidateV1({ scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey }))! })).review
    return { f,g,runAI,epoch,base,selection,review }
  }
  it('allows an explicit human clarification after hosting stops, without another model or another actor',async () => {
    const x = await setup()
    await stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(x.f.sessionId,'clarify-ai.stop'),epochKey: x.epoch.epochKey,viewerKey: OPEN_HUMAN_VIEWER,reason: '先审查原建议' })
    const before = await readProductRuntimeState(x.f.sessionId),worlds = await db.worldReleases.toArray(),view = await x.review()
    expect(JSON.stringify(view)).not.toContain('AI-PRIVATE-CLARIFICATION-SENTINEL');expect(view).toMatchObject({ canConfirm: false,canClarify: true })
    await clarifyTtrpgOpenIntentCandidateV1({ ...await x.base(),expectedCount: 0,selection: x.selection })
    const entry = (await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].intentClarifications![0]
    expect(entry.actorKey).toBe('companion.1');expect(entry.viewerKey).toBe(OPEN_HUMAN_VIEWER);expect(entry.request?.controllerMode).toBe('ai')
    await startTtrpgOpenIntentCandidateOperationV1({ ...await x.base(),decision: 'start',clarificationHash: entry.clarificationHash })
    const state = await readProductRuntimeState(x.f.sessionId),op = state.ttrpg!.openRun!.operations[0]
    expect(op.plan.request).toMatchObject({ actorKey: 'companion.1',ruleKey: 'investigate',controllerMode: 'ai' });expect(op.approvals).toEqual([])
    expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    await preauthorizeTtrpgOpenCompanionV1({ ...await x.base(),...await operationInput(x.f.sessionId,op.operationKey,'preauthorization'),operationKey: op.operationKey,frozenPlanHash: op.planHash })
    await settleOpenPaidTurnsV1({ ...await operationInput(x.f.sessionId,op.operationKey,'settle'),operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const settled = await readProductRuntimeState(x.f.sessionId)
    expect(settled.ttrpg!.openRun!.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1']);expect(x.runAI).toHaveBeenCalledOnce()
    expect(await db.worldReleases.toArray()).toEqual(worlds)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(settled)
  })
  it('retains the clarification hash, raw candidate and stable references through the normal project backup roundtrip',async () => {
    const x = await setup();await clarifyTtrpgOpenIntentCandidateV1({ ...await x.base(),expectedCount: 0,selection: x.selection })
    const original = (await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const imported = (await readProductRuntimeState(copy.id!)).ttrpg!.openRun!.coordination.calls[0]
    expect(imported.intentClarifications).toEqual(original.intentClarifications);expect(imported.responseArtifactHash).toBe(original.responseArtifactHash)
    expect(imported.usage).toEqual(original.usage);expect(imported.reservedCostUsd).toBe(original.reservedCostUsd)
  })
  it('does not let the AI act as its human approver or borrow another candidate actor',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.sessionId)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await x.base(),viewerKey: 'viewer.companion.1',expectedCount: 0,selection: x.selection })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
  })
})
