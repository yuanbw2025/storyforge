import { settleTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationQueueCreditsV1 } from '../../src/lib/ttrpg/open-situation-cycle'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { advanceTtrpgOpenSituationsV1, prepareTtrpgOpenSituationEffectV1, readTtrpgOpenSituationEffectApprovalViewV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { setupMaintenanceFixtureV1 as setup, maintenanceStepV1 as step, nextMaintenanceInputV1 as input, approveMaintenanceEffectV1 as approveEffect } from '../helpers/open-ttrpg-maintenance'
import { rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN6 actual situation maintenance and FIFO', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('resolves from actual predicates, preserves evidence/knowledge, records cooldown and recedes chaos once', async () => {
    const f = await setup({ resolve: true }), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(await resumeTtrpgOpenSituationsV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!, terminal = run.situations.history![0].instance
    expect(terminal).toMatchObject({ status: 'resolved', resolutionKind: 'intervened', satisfiedObstacleKeys: f.f.campaign.situationTemplates[0].obstacles.map(o => o.obstacleKey), discoveredEvidenceRefs: before.situations.active[0].discoveredEvidenceRefs })
    expect(run.knowledge).toEqual(before.knowledge); expect(run.worldTime).toEqual(before.worldTime)
    expect(run.chaos.value).toBe(Math.max(1, before.chaos.value - 1)); expect(run.situations.cooldowns[terminal.templateKey]).toBe(5)
    expect(await resumeTtrpgOpenSituationsV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    await replay(f.command.sessionId)
  })
  it('expires only an active deadline, advances the authored clock exactly once and keeps factual knowledge', async () => {
    const f = await setup(), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    await step(f.command); await step(f.command)
    const expired = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(expired.situations.history![0].instance).toMatchObject({ status: 'expired', resolutionKind: 'no-intervention' })
    expect(expired.clocks).toEqual(before.clocks); expect(expired.situationCycles!.at(-1)!.work[0]).toMatchObject({ kind: 'clock', targetKey: 'flood', completedRef: null })
    const command = await input(f.command), event = await advanceTtrpgOpenSituationsV1(command)
    expect(await advanceTtrpgOpenSituationsV1(command)).toEqual(event)
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.clocks[0].value).toBe(before.clocks[0].value + 1)
    expect(await resumeTtrpgOpenSituationsV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.knowledge).toEqual(before.knowledge); expect(run.worldTime).toEqual(before.worldTime); expect(run.chaos).toEqual(before.chaos)
    await replay(f.command.sessionId)
  })
  it('dequeues one reservation per actual release, resets deadline at admission and never expires waiting rows', async () => {
    const f = await setup({ resolve: true, queue: true }), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(before.situations.queued).toHaveLength(2); expect(before.situations.queued[0].noInterventionDueWorldTurn).toBe(3)
    await resumeTtrpgOpenSituationsV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!, admitted = run.situations.active.find(i => i.templateKey === 'situation.queue.5')!
    expect(admitted).toMatchObject({ status: 'active', activatedAtWorldTurn: 2, noInterventionDueWorldTurn: 3, situationKey: before.situations.queued[0].situationKey })
    expect(run.situations.active).toHaveLength(5); expect(run.situations.queued).toEqual([before.situations.queued[1]])
    expect(run.situations.history).toHaveLength(1); expect(run.situationCycles!.at(-1)!.maintenanceRefs).toHaveLength(5)
    await replay(f.command.sessionId)
  })
  it('rejects a FIFO item whose real condition changed, then admits the next without spending the release twice', async () => {
    const f = await setup({ resolve: true, queue: true, rejectQueue: true })
    await resumeTtrpgOpenSituationsV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.situations.queued).toEqual([]); expect(run.situations.active.some(i => i.templateKey === 'situation.queue.5')).toBe(false)
    expect(run.situations.active.some(i => i.templateKey === 'situation.queue.6')).toBe(true)
    expect(run.failures.some(f => f.category === 'situation-rejected' && f.violatedRule.includes('I1:'))).toBe(true)
    await replay(f.command.sessionId)
  })
  it('retains the actual effect owner work and refuses to claim completion or fabricate an outcome', async () => {
    const f = await setup({ effect: true })
    const outcome = await resumeTtrpgOpenSituationsV1(f.command)
    expect(outcome).toMatchObject({ status: 'awaiting-consequence', nextStepKey: 'situations.2' })
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!, work = run.situationCycles!.at(-1)!.work.find(w => !w.completedRef)!
    expect(work).toMatchObject({ kind: 'effect', targetKey: 'plan.success', completedRef: null })
    expect(run.operations[0].businessRefs.some(r => r.stepKey === 'situations.2')).toBe(false)
    await expect(step(f.command)).rejects.toThrow(/真实 owner/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await replay(f.command.sessionId)
  })
  it('stops on clock-completion effect work with one true chaos change and no second tick on resume', async () => {
    const f = await setup({ clockMaximum: 3, clockEffect: true })
    const before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect((await resumeTtrpgOpenSituationsV1(f.command)).status).toBe('awaiting-consequence')
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(run.clocks[0]).toMatchObject({ value: 3, completed: true }); expect(run.chaos.value).toBe(Math.min(9, before.chaos.value + 1))
    expect(run.situationCycles!.at(-1)!.work.map(w => w.kind)).toEqual(['clock', 'effect'])
    await resumeTtrpgOpenSituationsV1(f.command); expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await replay(f.command.sessionId)
  })
  it('rejects wrong viewers and forged progress or changed frozen active lists without mutating the source', async () => {
    const f = await setup({ resolve: true }), command = await input(f.command), before = await readProductRuntimeState(f.command.sessionId)
    await expect(advanceTtrpgOpenSituationsV1({ ...command, viewerKey: 'viewer.gm' })).rejects.toThrow()
    const plan = await advanceTtrpgOpenSituationsV1(command), payload = JSON.parse(plan.payloadJson); payload.cycle.situationKeys = []
    expect(() => applyProductRuntimeEvent(before, { ...plan, payloadJson: JSON.stringify(payload) })).toThrow(/真实 active/)
    const start = await readProductRuntimeState(f.command.sessionId), event = await step(f.command), modified = JSON.parse(event.payloadJson)
    modified.result.instance.satisfiedObstacleKeys = ['invented']
    expect(() => applyProductRuntimeEvent(start, { ...event, payloadJson: JSON.stringify(modified) })).toThrow(/确定性结果/)
  })
  it('executes only the exact approved situation cost, then admits its actual next situation without another tick', async () => {
    const f = await setup({ effect: true, cost: true, chain: true })
    await resumeTtrpgOpenSituationsV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), resource = f.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    const { locator, review } = await approveEffect(f.command)
    const view = await readTtrpgOpenSituationEffectApprovalViewV1({ ...locator, actorKey: 'hero' })
    expect(Object.keys(view)).not.toContain('mechanicalStateJson'); expect(view.effects.every(e => e.targetRef === 'hero')).toBe(true)
    expect(review.requiredApprovals.map(a => a.actorKey)).toEqual(['gm', 'hero'])
    expect(await resumeTtrpgOpenSituationsV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(Number(state.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    expect(run.situations.active).toMatchObject([{ templateKey: 'situation.actual-consequence', activationReason: 'consequence', activatedAtWorldTurn: 2, noInterventionDueWorldTurn: 5 }])
    expect(run.situationCycles!.at(-1)!.work.map(w => [w.kind, Boolean(w.completedRef)])).toEqual([['clock', true], ['effect', true], ['activate', true]])
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    await resumeTtrpgOpenSituationsV1(f.command); expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state)
    await replay(f.command.sessionId)
  })
  it('preserves a human rejection, waits without charging, and permits a fresh explicit revision', async () => {
    const f = await setup({ effect: true, cost: true })
    await resumeTtrpgOpenSituationsV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId)
    await approveEffect(f.command, 'reject'); expect((await resumeTtrpgOpenSituationsV1(f.command)).status).toBe('awaiting-consequence')
    expect((await readProductRuntimeState(f.command.sessionId)).entities).toEqual(before.entities)
    await approveEffect(f.command); await resumeTtrpgOpenSituationsV1(f.command)
    const work = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.situationCycles!.at(-1)!.work.find(w => w.kind === 'effect')!
    expect(work.effectReviews!.map(r => r.status)).toEqual(['rejected', 'approved'])
    expect(work.completedRef).not.toBeNull(); await replay(f.command.sessionId)
  })
  it('records a rejected causal admission after the paid effect without inventing a new situation', async () => {
    const f = await setup({ effect: true, cost: true, chain: true, inaccessibleChain: true })
    await resumeTtrpgOpenSituationsV1(f.command); await approveEffect(f.command); await resumeTtrpgOpenSituationsV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.situations.active).toEqual([]); expect(run.failures.some(f => f.category === 'situation-rejected')).toBe(true)
    expect(run.situationCycles!.at(-1)!.work.every(w => w.completedRef)).toBe(true); await replay(f.command.sessionId)
  })
  it('renews branch authority for an approved-but-unapplied true situation effect instead of inheriting consent', async () => {
    const f = await setup({ effect: true, cost: true, chain: true })
    await resumeTtrpgOpenSituationsV1(f.command); await approveEffect(f.command)
    const child = await forkAndStart(f.command.sessionId); await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect((await resumeTtrpgOpenSituationsV1(command)).status).toBe('awaiting-consequence')
    await approveEffect(command); expect(await resumeTtrpgOpenSituationsV1(command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const run = rt(await readProductRuntimeState(child.sessionId)).openRun!, work = run.situationCycles!.at(-1)!.work.find(w => w.kind === 'effect')!
    expect(work.effectReviews!.map(r => r.status)).toEqual(['stale', 'approved']); expect(run.situations.history).toHaveLength(1)
    await replay(child.sessionId)
  })
  it('does not accept an implicit effect alternative or an invented binding', async () => {
    const f = await setup({ effect: true, cost: true }); await resumeTtrpgOpenSituationsV1(f.command)
    const cycle = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.situationCycles!.at(-1)!, work = cycle.work.find(w => !w.completedRef)!
    const locator = { ...f.command, cycleKey: cycle.cycleKey, workKey: work.workKey }
    await expect(prepareTtrpgOpenSituationEffectV1({ ...locator, request: { bindings: { actor: 'hero' }, alternativeKey: null } })).rejects.toThrow(/明确选择/)
    await expect(prepareTtrpgOpenSituationEffectV1({ ...locator, request: { bindings: { actor: 'keeper' }, alternativeKey: 'small' } })).rejects.toThrow()
  })
  it('keeps a cooling FIFO reservation and later admits it from an existing vacancy with a fresh deadline', async () => {
    const f = await setup({ resolve: true, queue: true })
    await step(f.command); await step(f.command)
    const state = await readProductRuntimeState(f.command.sessionId), runtime = rt(state), run = runtime.openRun!, instance = run.situations.queued[0]
    // Pure temporal probe of a later maintenance window; it never mutates the persisted session.
    run.situations.cooldowns[instance.templateKey] = 5; state.ttrpg = runtime
    const cycle = run.situationCycles!.at(-1)!, operation = run.operations[0], action = { kind: 'queue' as const, situationKey: instance.situationKey }
    const held = settleTtrpgOpenSituationCycleActionV1({ state, cycle, operation, action, sequence: state.lastSequence + 1, instanceKey: null })
    expect(held.result).toMatchObject({ transition: 'retained', situationKey: instance.situationKey })
    expect(held.runtime.openRun!.situations.queued).toEqual(run.situations.queued); expect(held.cycle.queueCredits).toBe(0)
    held.runtime.openRun!.worldTime.worldTurn = 5
    held.state.ttrpg = held.runtime
    const later = { ...held.cycle, queueCredits: ttrpgOpenSituationQueueCreditsV1(held.state) }
    const admitted = settleTtrpgOpenSituationCycleActionV1({ state: held.state, cycle: later, operation, action, sequence: state.lastSequence + 2, instanceKey: null })
    expect(admitted.result).toMatchObject({ transition: 'activated', instance: { activatedAtWorldTurn: 5, noInterventionDueWorldTurn: 6 } })
    expect(admitted.runtime.openRun!.situations.active).toHaveLength(5)
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.situations.cooldowns[instance.templateKey]).toBeUndefined()
  })
  it.each(['plan', 'terminal', 'clock'])('recovers the real %s cutpoint in a child and backup without repeating terminal, chaos or clock effects', async cut => {
    const f = await setup(); await step(f.command)
    if (cut !== 'plan') await step(f.command)
    if (cut === 'clock') await step(f.command)
    const child = await forkAndStart(f.command.sessionId); await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect(await resumeTtrpgOpenSituationsV1(command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const state = await readProductRuntimeState(child.sessionId), run = rt(state).openRun!
    expect(run.situations.history).toHaveLength(1); expect(run.clocks[0].value).toBe(3)
    const events = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()
    expect(events.filter(e => e.type === 'ttrpg.open.situations.changed' && JSON.parse(e.payloadJson).result.transition === 'expired')).toHaveLength(cut === 'plan' ? 1 : 0)
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const restored = await Promise.all((await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).map(s => readProductRuntimeState(s.id!)))
    expect(rt(restored.find(s => rt(s).sessionKey === rt(state).sessionKey)!).openRun).toEqual(run)
    await replay(child.sessionId)
  })
})
