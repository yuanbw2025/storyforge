import { shareTtrpgOpenKnowledgeV1 } from '../../src/lib/ttrpg/runtime-commands'
import { hashTtrpgOpenKnowledgeShareConfirmationV1 } from '../../src/lib/ttrpg/open-knowledge-share'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { prepareTtrpgOpenPressureEffectV1, proposeTtrpgOpenPressureEffectV1, confirmTtrpgOpenPressureEffectV1,
  applyTtrpgOpenPressureEffectV1, readTtrpgOpenPressureEffectApprovalViewV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { currentTtrpgOpenPressureEffectReviewV1 } from '../../src/lib/ttrpg/open-pressure-effect'
import { setupPressureEffectFixtureV1 as fixture } from '../helpers/open-ttrpg-pressure-effect'
import { rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

type Fixture = Awaited<ReturnType<typeof fixture>>
function locate(f: Fixture, viewerKey = f.gmViewer) { return { ...f.command, viewerKey, cycleKey: f.cycleKey, workKey: f.workKey } }
async function envelope(f: Fixture, key: string, viewerKey = f.gmViewer) {
  const state = await readProductRuntimeState(f.command.sessionId)
  return { ...await openEnvelopeV1(f.command.sessionId, await ttrpgOpenOperationCommandIdV1(rt(state).sessionKey, f.command.operationKey, key)), ...locate(f, viewerKey) }
}
async function propose(f: Fixture, alternativeKey = 'small') {
  const request = { bindings: { actor: f.target }, alternativeKey }
  const review = await prepareTtrpgOpenPressureEffectV1({ ...locate(f), request })
  const input = { ...await envelope(f, `pressure.work.${f.workKey}.${review.reviewKey}.propose`), request, riskHash: review.riskHash, reviewKey: review.reviewKey }
  const event = await proposeTtrpgOpenPressureEffectV1(input)
  return { review, event, input }
}
async function confirm(f: Fixture, actorKey = f.target, decision: 'approve' | 'reject' = 'approve', viewerKey = OPEN_HUMAN_VIEWER) {
  const work = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0], review = currentTtrpgOpenPressureEffectReviewV1(work)!
  const input = { ...await envelope(f, `pressure.work.${f.workKey}.${review.reviewKey}.approval.${actorKey}`, viewerKey), actorKey, decision, riskHash: review.riskHash, reviewKey: review.reviewKey }
  const event = await confirmTtrpgOpenPressureEffectV1(input)
  return { event, input }
}
async function applyInput(f: Fixture) {
  const review = currentTtrpgOpenPressureEffectReviewV1(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0])!
  return { ...await envelope(f, `pressure.work.${f.workKey}.${review.reviewKey}.apply`, OPEN_HUMAN_VIEWER), reviewKey: review.reviewKey }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN5 real pressure effect consent and execution', { timeout: 20000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['small', 'large'])('waits for stakeholder consent and executes the exact %s option once through reload/retry', async alternative => {
    const f = await fixture(), before = await readProductRuntimeState(f.command.sessionId), amount = Number(before.entities.hero.attributes[`resource.${f.resource}`])
    const { review, input: proposalInput, event: proposal } = await propose(f, alternative)
    expect(await proposeTtrpgOpenPressureEffectV1(proposalInput)).toEqual(proposal)
    expect(review.requiredApprovals.map(a => a.actorKey)).toEqual(['gm', 'hero'])
    await expect(applyTtrpgOpenPressureEffectV1(await applyInput(f))).rejects.toThrow(/全部真人/)
    expect(Number((await readProductRuntimeState(f.command.sessionId)).entities.hero.attributes[`resource.${f.resource}`])).toBe(amount)
    const approved = await confirm(f)
    expect(await confirmTtrpgOpenPressureEffectV1(approved.input)).toEqual(approved.event)
    db.close(); await db.open()
    const input = await applyInput(f), event = await applyTtrpgOpenPressureEffectV1(input)
    expect(await applyTtrpgOpenPressureEffectV1(input)).toEqual(event)
    const final = await readProductRuntimeState(f.command.sessionId)
    expect(Number(final.entities.hero.attributes[`resource.${f.resource}`])).toBe(amount - (alternative === 'small' ? 1 : 2))
    expect(rt(final).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].completedRef).toEqual({ sessionKey: rt(final).sessionKey, sequence: event.sequence })
    await resumeTtrpgOpenPressureV1(f.command)
    const settled = await readProductRuntimeState(f.command.sessionId)
    expect(rt(settled).openRun!.operations[0].receipts.slice(-1)[0].stepKey).toBe('pressure.2')
    await resumeTtrpgOpenPressureV1(f.command)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(settled)
    await replay(f.command.sessionId)
  })
  it('distinguishes a human GM from the human player whose own resource is affected', async () => {
    const f = await fixture({ humanGm: true }), request = { bindings: { actor: f.target }, alternativeKey: 'small' }
    await expect(prepareTtrpgOpenPressureEffectV1({ ...locate(f, OPEN_HUMAN_VIEWER), request })).rejects.toThrow(/真人 GM/)
    await propose(f)
    const view = await readTtrpgOpenPressureEffectApprovalViewV1({ ...locate(f, OPEN_HUMAN_VIEWER), actorKey: 'hero' })
    expect(view.effects.every(effect => effect.targetRef === 'hero')).toBe(true)
    expect(Object.keys(view)).not.toContain('mechanicalStateJson')
    expect(Object.keys(view)).not.toContain('request')
    await expect(readTtrpgOpenPressureEffectApprovalViewV1({ ...locate(f, OPEN_HUMAN_VIEWER), actorKey: 'gm' })).rejects.toThrow(/只能读取/)
    await expect(confirm(f, 'hero', 'approve', f.gmViewer)).rejects.toThrow(/对应真人/)
    await confirm(f)
    expect(await resumeTtrpgOpenPressureV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'situations.2' })
    await replay(f.command.sessionId)
  })
  it('requires the actual human binding for an affected AI companion and never accepts AI self approval', async () => {
    const f = await fixture({ aiTarget: true })
    const { review } = await propose(f)
    expect(review.requiredApprovals).toMatchObject([{ actorKey: 'gm' }, { actorKey: 'companion.1', allowedSeatKeys: ['seat.hero'] }])
    await expect(confirm(f, 'companion.1', 'approve', 'viewer.seat.companion.1')).rejects.toThrow()
    await confirm(f, 'companion.1')
    await resumeTtrpgOpenPressureV1(f.command)
    await replay(f.command.sessionId)
  })
  it('preserves rejection and revision history without charging for either proposal', async () => {
    const f = await fixture(), before = await readProductRuntimeState(f.command.sessionId)
    await propose(f)
    await confirm(f, 'hero', 'reject')
    expect(await resumeTtrpgOpenPressureV1(f.command)).toMatchObject({ status: 'awaiting-consequence' })
    const revised = await propose(f, 'large')
    expect(revised.review.revision).toBe(2)
    const work = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0]
    expect(work.effectReviews!.map(r => r.status)).toEqual(['rejected', 'awaiting-approval'])
    expect((await readProductRuntimeState(f.command.sessionId)).entities).toEqual(before.entities)
    await confirm(f)
    await resumeTtrpgOpenPressureV1(f.command)
    await replay(f.command.sessionId)
  })
  it('requires a new explicit revision when live governed state changes after approval', async () => {
    const f = await fixture()
    await propose(f); await confirm(f)
    const state = await readProductRuntimeState(f.command.sessionId), source = rt(state).openRun!.knowledge[0]
    const e = await openEnvelopeV1(f.command.sessionId, 'pressure.scope.change')
    const request = { actorKey: 'hero', sourceKnowledgeKey: source.knowledgeKey, audience: 'private' as const,
      recipientActorKeys: ['companion.1'], publicFieldsHash: source.publicFieldsHash }
    await shareTtrpgOpenKnowledgeV1({ ...e, viewerKey: OPEN_HUMAN_VIEWER, request,
      confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey: OPEN_HUMAN_VIEWER,
        baseStateHash: e.baseStateHash, runtimeSourceHash: f.f.session.runtimeSourceHash }) })
    const changed = await readProductRuntimeState(f.command.sessionId)
    await expect(applyTtrpgOpenPressureEffectV1(await applyInput(f))).rejects.toThrow(/stale/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(changed)
    expect((await propose(f)).review.revision).toBe(2)
    await confirm(f)
    await resumeTtrpgOpenPressureV1(f.command)
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].effectReviews!.map(r => r.status)).toEqual(['stale', 'approved'])
    await replay(f.command.sessionId)
  })
  it('rejects invented bindings, implicit alternatives, changed risks and forged effect payloads without partial effects', async () => {
    const f = await fixture()
    for (const request of [{ bindings: { actor: 'invented' }, alternativeKey: 'small' }, { bindings: { actor: 'hero' }, alternativeKey: null }]) {
      await expect(prepareTtrpgOpenPressureEffectV1({ ...locate(f), request })).rejects.toThrow()
    }
    const request = { bindings: { actor: 'hero' }, alternativeKey: 'small' }, review = await prepareTtrpgOpenPressureEffectV1({ ...locate(f), request })
    await expect(proposeTtrpgOpenPressureEffectV1({ ...await envelope(f, `pressure.work.${f.workKey}.${review.reviewKey}.propose`), request, riskHash: 'f'.repeat(64), reviewKey: review.reviewKey })).rejects.toThrow(/风险/)
    await propose(f)
    await confirm(f)
    const before = await readProductRuntimeState(f.command.sessionId), event = await applyTtrpgOpenPressureEffectV1(await applyInput(f))
    const payload = JSON.parse(event.payloadJson); payload.effectPlan.effects[0].amount = 2
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/真人已批准/)
    await replay(f.command.sessionId)
  })
  it('keeps a failed resource payment pending without marking the work or pressure receipt complete', async () => {
    const f = await fixture({ impossible: true })
    await propose(f)
    await confirm(f)
    const before = await readProductRuntimeState(f.command.sessionId)
    await expect(applyTtrpgOpenPressureEffectV1(await applyInput(f))).rejects.toThrow()
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
    expect(rt(before).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].completedRef).toBeNull()
    const repaired = await propose(f, 'large')
    expect(repaired.review.revision).toBe(2)
    await confirm(f)
    await resumeTtrpgOpenPressureV1(f.command)
    const work = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0]
    expect(work.effectReviews!.map(r => r.status)).toEqual(['unpayable', 'approved'])
    expect(work.completedRef).not.toBeNull()
    await replay(f.command.sessionId)
  })
  it('renews authority for an approved-but-unapplied inherited effect and preserves both old and new consent', async () => {
    const f = await fixture()
    await propose(f); await confirm(f)
    const child = await forkAndStart(f.command.sessionId)
    await approve(child.sessionId, child.op.operationKey)
    const cf = { ...f, command: { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash } }
    await expect(applyTtrpgOpenPressureEffectV1(await applyInput(cf))).rejects.toThrow(/stale/)
    const renewed = await propose(cf)
    expect(renewed.review.revision).toBe(2)
    await confirm(cf)
    await resumeTtrpgOpenPressureV1(cf.command)
    const final = await readProductRuntimeState(child.sessionId), reviews = rt(final).openRun!.pressureCycles!.find(c => c.cycleKey === f.cycleKey)!.work[0].effectReviews!
    expect(reviews.map(r => r.status)).toEqual(['stale', 'approved'])
    const importedId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(importedId).toArray(), states = await Promise.all(sessions.map(s => readProductRuntimeState(s.id!)))
    expect(rt(states.find(s => rt(s).sessionKey === rt(final).sessionKey)!).openRun!.pressureCycles).toEqual(rt(final).openRun!.pressureCycles)
    await replay(child.sessionId)
  })
})
