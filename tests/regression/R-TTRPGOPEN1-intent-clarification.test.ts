import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { generateTtrpgOpenIntentCandidateV1, readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1, startTtrpgOpenIntentCandidateOperationV1, clarifyTtrpgOpenIntentCandidateV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { parseProductRuntimeState, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { inspectTtrpgOpenIntentRoutingV1 } from '../../src/lib/ttrpg/open-intent-clarification'
import type { TtrpgOpenIntentSelectionV1 } from '../../src/lib/ttrpg/open-intent-clarification-contract'
import { approve,forkAndStart,rt } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { parseTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/open-model-calls'

describe('R-TTRPGOPEN1 durable human clarification of an original semantic candidate', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function setup() {
    const f = await readyOpenTtrpgSessionV1('human clarification', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true;p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    const rawInput = '在同伴行动时提供掩护，尚未确定具体方式与对象。'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId,'clarify.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'submit-action',rawInput })
    const runAI = vi.fn(async () => JSON.stringify({ goal: rawInput,method: null,targetRefs: [],declaredResources: [],declaredAssumptions: ['不假定其他角色在场'],requestedOutcome: null }))
    const g = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId,'clarify.generate'),scope: f.scope,actorKey: 'hero',viewerKey: OPEN_HUMAN_VIEWER,
      rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,runAI })
    const actor = await loadTtrpgOpenPlayerContextV1({ scope: f.scope,sessionId: f.sessionId,actorKey: 'hero' })
    const action = actor.view.rules.actions.find(a => a.target === 'scene')!
    const selection: TtrpgOpenIntentSelectionV1 = { goal: '先独立调查自己能接触的公开情况',method: action.actionKey,targetRefs: [],requestedOutcome: '取得可以复核的调查结果，不预设成功' }
    const base = async () => ({ ...await openEnvelopeV1(f.sessionId,'clarify.action'),viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey,candidateHash: g.candidate.candidateHash })
    const review = async () => inspectTtrpgOpenIntentRoutingV1({ scope: f.scope,session: (await db.productRuntimeSessions.get(f.sessionId))!,state: await readProductRuntimeState(f.sessionId),
      content: f.runtimePackage.ttrpg!,viewerKey: OPEN_HUMAN_VIEWER,candidate: (await readTtrpgOpenIntentCandidateV1({ scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER,
        runId: g.prepared.runId,requestKey: g.prepared.requestKey }))! })
    return { f,g,runAI,selection,base,review }
  }
  it('clarifies without another model, dice, resource cost or world time, then separately admits the reviewed version', async () => {
    const { f,g,runAI,selection,base,review } = await setup(),before = await readProductRuntimeState(f.sessionId)
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start' })).rejects.toThrow(/澄清/)
    expect((await review()).review).toMatchObject({ route: 'needs-clarification',canConfirm: false,canClarify: true,attempts: 0 })
    const event = await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })
    const after = await readProductRuntimeState(f.sessionId),entry = after.ttrpg!.openRun!.coordination.calls[0].intentClarifications![0]
    expect(entry).toMatchObject({ candidateHash: g.candidate.candidateHash,attempt: 1,selection })
    expect(after.entities).toEqual(before.entities);expect(after.ttrpg!.checks).toEqual(before.ttrpg!.checks)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime);expect(after.ttrpg!.openRun!.operations).toEqual([])
    const { intentClarifications: _entries,...unchangedCall } = after.ttrpg!.openRun!.coordination.calls[0]
    expect(unchangedCall).toEqual(before.ttrpg!.openRun!.coordination.calls[0]);expect(runAI).toHaveBeenCalledOnce()
    expect((await readTtrpgOpenIntentCandidateV1({ scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER,runId: g.prepared.runId,requestKey: g.prepared.requestKey }))?.intent?.method).toBeNull()
    expect((await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })).sequence).toBe(event.sequence)
    expect((await review()).review).toMatchObject({ canConfirm: true,attempts: 1,clarificationHash: entry.clarificationHash })
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start' })).rejects.toThrow(/明确确认/)
    const operationEvent = await startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start',clarificationHash: entry.clarificationHash })
    expect((await startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start',clarificationHash: entry.clarificationHash })).sequence).toBe(operationEvent.sequence)
    const state = await readProductRuntimeState(f.sessionId),op = state.ttrpg!.openRun!.operations[0]
    expect(op.status).toBe('awaiting-approval');expect(op.approvals).toEqual([]);expect(op.intentEvidence!.candidateHash).toBe(g.candidate.candidateHash)
    expect(op.intentEvidence!.clarificationRef).toEqual({ sourceRef: entry.sourceRef,clarificationHash: entry.clarificationHash })
    expect(op.plan.request).toEqual(entry.request);expect(state.entities).toEqual(before.entities)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 1 })).rejects.toThrow(/原行动候选|窗口已变化/)
    const session = (await db.productRuntimeSessions.get(f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence'))).toEqual(state)
  })
  it('persists a three-attempt limit, preserves the third valid answer and refuses an older confirmation', async () => {
    const { f,selection,base,review } = await setup()
    for (let i = 0;i < 3;i++) await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),expectedCount: i,selection: i === 2 ? selection : { ...selection,method: null,goal: `尚需补充的行动 ${i + 1}` } })
    const entries = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].intentClarifications!
    expect((await review()).review).toMatchObject({ attempts: 3,canClarify: false,canConfirm: true })
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 3 })).rejects.toThrow(/三次/)
    await expect(startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start',clarificationHash: entries[0].clarificationHash })).rejects.toThrow(/当前人工澄清/)
    await startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start',clarificationHash: entries[2].clarificationHash })
  })
  it('rejects a stale concurrent reply, another viewer and a substituted original candidate without incrementing the thread', async () => {
    const { f,selection,base } = await setup()
    await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })
    const before = await readProductRuntimeState(f.sessionId)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection: { ...selection,goal: '另一个标签页的新回复' },expectedCount: 0 })).rejects.toThrow(/线程已变化/)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 1,viewerKey: 'viewer.other' })).rejects.toThrow(/授权|真人|窗口/)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 1,candidateHash: 'f'.repeat(64) })).rejects.toThrow(/版本/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('does not use a hidden or invented target as a shortcut out of clarification', async () => {
    const { f,selection,base } = await setup(),before = await readProductRuntimeState(f.sessionId)
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection: { ...selection,targetRefs: ['secret.unread.actor'] },expectedCount: 0 })).rejects.toThrow(/对象|目标|澄清/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('does not clarify a paused original window', async () => {
    const { f,selection,base } = await setup()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId,'clarify.pause'),viewerKey: OPEN_HUMAN_VIEWER,changedBy: 'hero',reason: '先暂停',status: 'paused' })
    await expect(clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })).rejects.toThrow(/暂停|安全|状态/)
  })
  it('keeps human clarification in ancestor evidence while inheriting the committed result without another model or dice roll',async () => {
    const { f,selection,base,runAI } = await setup()
    await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })
    const record = rt(await readProductRuntimeState(f.sessionId)).openRun!.coordination.calls[0].intentClarifications![0]
    await startTtrpgOpenIntentCandidateOperationV1({ ...await base(),decision: 'start',clarificationHash: record.clarificationHash })
    const operation = rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0]
    await approve(f.sessionId,operation.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: f.sessionId,operationKey: operation.operationKey,frozenPlanHash: operation.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const parent = await readProductRuntimeState(f.sessionId),branch = await forkAndStart(f.sessionId),child = rt(await readProductRuntimeState(branch.sessionId))
    expect(child.branchLineage!.recoveryTasks[0].operation.intentEvidence).toEqual(operation.intentEvidence)
    expect(child.branchLineage!.ancestors.some(a => a.snapshot.openRun?.coordination.calls.some(c => c.intentClarifications?.some(r => r.clarificationHash === record.clarificationHash)))).toBe(true)
    expect(branch.op.intentEvidence).toBeUndefined();expect(child.openRun!.coordination.calls).toEqual([])
    await approve(branch.sessionId,branch.op.operationKey)
    await resumeTtrpgOpenOperationV1({ sessionId: branch.sessionId,operationKey: branch.op.operationKey,frozenPlanHash: branch.op.planHash,viewerKey: OPEN_HUMAN_VIEWER })
    const after = await readProductRuntimeState(branch.sessionId)
    expect(after.entities).toEqual(parent.entities);expect(rt(after).openRun!.worldTime.worldTurn).toBe(rt(parent).openRun!.worldTime.worldTurn)
    expect(await db.productRuntimeEvents.where('sessionId').equals(branch.sessionId).filter(e => e.type === 'ttrpg.rule.action.resolved').count()).toBe(0);expect(runAI).toHaveBeenCalledOnce()
  })
  it('rejects altered clarification ownership, source order and content before it can authorize an action',async () => {
    const { f,g,selection,base,review } = await setup()
    await clarifyTtrpgOpenIntentCandidateV1({ ...await base(),selection,expectedCount: 0 })
    const inspected = await review(),call = inspected.call
    for (const mutate of [
      (c: typeof call) => { c.intentClarifications![0].request!.controllerMode = 'ai' },
      (c: typeof call) => { c.intentClarifications![0].sourceRef.sequence = c.terminalRef!.sequence },
      (c: typeof call) => { c.intentClarifications![0].actorKey = 'companion.1' },
    ]) { const copy = structuredClone(call);mutate(copy);expect(() => parseTtrpgOpenModelCallV1(copy)).toThrow() }
    const state = await readProductRuntimeState(f.sessionId)
    state.ttrpg!.openRun!.coordination.calls[0].intentClarifications![0].selection.goal = '被替换的人工内容'
    await expect(inspectTtrpgOpenIntentRoutingV1({ scope: f.scope,session: (await db.productRuntimeSessions.get(f.sessionId))!,state,content: f.runtimePackage.ttrpg!,viewerKey: OPEN_HUMAN_VIEWER,
      candidate: g.candidate })).rejects.toThrow(/澄清证据/)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations).toEqual([])
  })
})
