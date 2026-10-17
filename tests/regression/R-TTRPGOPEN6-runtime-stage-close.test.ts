import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { closeTtrpgOpenStageV1, advanceTtrpgOpenStageClosureV1, prepareTtrpgOpenStageEffectV1, proposeTtrpgOpenStageEffectV1, confirmTtrpgOpenStageEffectV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { setupChecksFixtureV1 as setup, approveChecksStageEffectV1 as approveEffect } from '../helpers/open-ttrpg-checks'
import { operationInput, rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
async function close(f: Awaited<ReturnType<typeof setup>>) {
  await resumeTtrpgOpenChecksV1(f.command)
  return closeTtrpgOpenStageV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '明确收束此阶段；保留当前证据和未完事项' })
}
describe('R-TTRPGOPEN6 actual E13 and separate completion consequences', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('closes only on explicit current authority, retains a private summary and true N/A gates without extra time or knowledge', async () => {
    const f = await setup({ closure: true }), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    await resumeTtrpgOpenChecksV1(f.command)
    const command = { ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '真人明确保留的阶段记录' }, event = await closeTtrpgOpenStageV1(command)
    expect(await closeTtrpgOpenStageV1(command)).toEqual(event)
    const closed = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(closed.stage).toMatchObject({ status: 'closed', closedAtWorldTurn: 1 }); expect(closed.stageClosures![0]).toMatchObject({ sourceRef: { sessionKey: rt(await readProductRuntimeState(f.command.sessionId)).sessionKey, sequence: event.sequence }, summary: { text: command.summary, audience: 'gm-only' }, triggerKey: 'dawn' })
    expect(closed.chaos.value).toBe(Math.max(1, before.chaos.value - 1)); expect(closed.worldTime).toEqual(before.worldTime); expect(closed.knowledge).toEqual(before.knowledge)
    expect(await resumeTtrpgOpenChecksV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(Object.values(run.gateReceipts![0].result.results).every(r => r.applicability === 'not-applicable' && r.passed === null)).toBe(true)
    expect(run.stageClosures![0].completedRef).not.toBeNull(); await replay(f.command.sessionId)
  })
  it('refuses ineligible closure, changed viewer, fabricated tick history and a changed summary on retry', async () => {
    const f = await setup(); await resumeTtrpgOpenChecksV1(f.command)
    await expect(closeTtrpgOpenStageV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '不能造一个收束' })).rejects.toThrow()
    const eligible = await setup({ closure: true }); await resumeTtrpgOpenChecksV1(eligible.command)
    const before = await readProductRuntimeState(eligible.command.sessionId), command = { ...await operationInput(eligible.command.sessionId, eligible.command.operationKey, 'stage.close'), summary: '原明确记录' }
    await expect(closeTtrpgOpenStageV1({ ...command, viewerKey: 'viewer.gm' })).rejects.toThrow()
    const event = await closeTtrpgOpenStageV1(command); await expect(closeTtrpgOpenStageV1({ ...command, summary: '静默改摘要' })).rejects.toThrow()
    const payload = JSON.parse(event.payloadJson); payload.closure.atWorldTurn = 9
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/实际时钟后果/)
  })
  it.each([false, true])('retains a closed stage cutpoint with settled=%s through child authority, backup and replay', async settled => {
    const f = await setup({ closure: true }); await close(f)
    if (settled) await resumeTtrpgOpenChecksV1(f.command)
    const child = await forkAndStart(f.command.sessionId); await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect(await resumeTtrpgOpenChecksV1(command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const state = await readProductRuntimeState(child.sessionId), run = rt(state).openRun!
    expect(run.stageClosures).toHaveLength(1); expect(run.stageClosures![0].sourceRef.sessionKey).not.toBe(rt(state).sessionKey)
    expect((await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()).some(e => e.type === 'ttrpg.open.stage.closed')).toBe(false)
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId)), restored = await Promise.all((await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).map(s => readProductRuntimeState(s.id!)))
    expect(rt(restored.find(s => rt(s).sessionKey === rt(state).sessionKey)!).openRun).toEqual(run); await replay(child.sessionId)
  })
  it('advances the frozen onStageClose amount in its own event and never repeats stage or clock chaos', async () => {
    const f = await setup({ closure: true, stageTick: 2 }), before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    await close(f)
    let state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    const closure = run.stageClosures![0]
    expect(run.clocks).toEqual(before.clocks); expect(closure.ticks).toMatchObject([{ clockKey: 'flood', before: 1, after: 3, completedRef: null }])
    const command = { ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.clock.flood'), cycleKey: closure.cycleKey }, event = await advanceTtrpgOpenStageClosureV1(command)
    expect(await advanceTtrpgOpenStageClosureV1(command)).toEqual(event)
    await resumeTtrpgOpenChecksV1(f.command)
    state = await readProductRuntimeState(f.command.sessionId); run = rt(state).openRun!
    expect(run.clocks[0].value).toBe(3); expect(run.worldTime).toEqual(before.worldTime); expect(run.chaos.value).toBe(Math.max(1, before.chaos.value - 1))
    expect(run.stageClosures![0].ticks[0].completedRef).not.toBeNull(); await replay(f.command.sessionId)
  })
  it('retains a crossed clock completion effect until exact stakeholder consent, applies it once and then joins real N/A gates', async () => {
    const f = await setup({ closure: true, stageTick: 2, stageMaximum: 3, stageEffect: true })
    const before = await readProductRuntimeState(f.command.sessionId), resource = f.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    await close(f)
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('awaiting-stage-consequence')
    let run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    const cycle = run.stageClosures![0], work = cycle.work[0]
    expect(run.clocks[0]).toMatchObject({ value: 3, completed: true }); expect(work.completedRef).toBeNull()
    expect(run.operations[0].businessRefs.some(r => r.stepKey === 'gates')).toBe(false)
    const locator = { ...f.command, cycleKey: cycle.cycleKey, workKey: work.workKey }, request = { bindings: { actor: 'hero' }, alternativeKey: null }
    const review = await prepareTtrpgOpenStageEffectV1({ ...locator, request })
    await proposeTtrpgOpenStageEffectV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, `stage.work.${work.workKey}.${review.reviewKey}.propose`), ...locator, request, riskHash: review.riskHash, reviewKey: review.reviewKey })
    expect((await resumeTtrpgOpenChecksV1(f.command)).status).toBe('awaiting-stage-consequence')
    await confirmTtrpgOpenStageEffectV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, `stage.work.${work.workKey}.${review.reviewKey}.approval.hero`), ...locator, actorKey: 'hero', decision: 'approve', riskHash: review.riskHash, reviewKey: review.reviewKey })
    expect(await resumeTtrpgOpenChecksV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const state = await readProductRuntimeState(f.command.sessionId);run = rt(state).openRun!
    expect(Number(state.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    expect(run.chaos.value).toBe(rt(before).openRun!.chaos.value); expect(run.stageClosures![0].work[0].completedRef).not.toBeNull()
    await resumeTtrpgOpenChecksV1(f.command);expect(await readProductRuntimeState(f.command.sessionId)).toEqual(state);await replay(f.command.sessionId)
  })
  it('does not reward an already full clock again on stage close', async () => {
    const f = await setup({ closure: true, stageTick: 2, stageMaximum: 2, initiallyAlmostFull: true })
    const before = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    await close(f);await resumeTtrpgOpenChecksV1(f.command)
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.clocks[0].value).toBe(2);expect(run.stageClosures![0].ticks).toEqual([]);expect(run.stageClosures![0].work).toEqual([])
    expect(run.chaos.value).toBe(Math.max(1, before.chaos.value - 1));await replay(f.command.sessionId)
  })
  it('rejects a changed inherited human summary or clock plan instead of treating any ancestor event as closure proof', async () => {
    const f = await setup({ closure: true, stageTick: 2 });await close(f)
    const child = await forkAndStart(f.command.sessionId);await approve(child.sessionId, child.op.operationKey)
    const state = await readProductRuntimeState(child.sessionId), runtime = rt(state)
    const changed = structuredClone(runtime);changed.openRun!.stageClosures![0].summary.text = '伪造父记录'
    expect(() => parseTtrpgRuntimeStateV2(changed)).toThrow(/不可改写已冻结祖先起源/)
    const badSource = structuredClone(runtime);badSource.openRun!.stageClosures![0].sourceRef.sequence = 1
    expect(() => parseTtrpgRuntimeStateV2(badSource)).toThrow(/不可改写已冻结祖先起源/)
  })
  it('requires new child consent for an approved but unapplied stage cost and never repeats the parent clock or E13', async () => {
    const f = await setup({ closure: true, stageTick: 2, stageMaximum: 3, stageEffect: true });await close(f)
    await resumeTtrpgOpenChecksV1(f.command);await approveEffect(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), resource = f.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    const child = await forkAndStart(f.command.sessionId);await approve(child.sessionId, child.op.operationKey)
    const command = { ...f.command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect((await resumeTtrpgOpenChecksV1(command)).status).toBe('awaiting-stage-consequence')
    await approveEffect(command)
    expect(await resumeTtrpgOpenChecksV1(command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const state = await readProductRuntimeState(child.sessionId), run = rt(state).openRun!
    expect(run.stageClosures![0].work[0].effectReviews!.map(r => r.status)).toEqual(['stale', 'approved'])
    expect(Number(state.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    expect(run.clocks).toEqual(rt(before).openRun!.clocks);expect(run.chaos).toEqual(rt(before).openRun!.chaos)
    const events = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()
    expect(events.some(e => ['ttrpg.open.stage.closed', 'ttrpg.open.stage.clock.advanced'].includes(e.type))).toBe(false);await replay(child.sessionId)
  })
  it('lets the actual human GM close a player-started eligible stage without impersonating the player or deadlocking that epoch', async () => {
    const f = await setup({ closure: true, humanGm: true, stageTick: 2 });await resumeTtrpgOpenChecksV1(f.command)
    const runtime = rt(await readProductRuntimeState(f.command.sessionId)), gmViewer = runtime.authorization!.seats.find(s => s.role === 'gm')!.viewerKey
    const input = { ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '当前真人 GM 明确阶段收束' }
    await expect(closeTtrpgOpenStageV1(input)).rejects.toThrow(/真人 GM/)
    await closeTtrpgOpenStageV1({ ...input, viewerKey: gmViewer })
    expect(await resumeTtrpgOpenChecksV1(f.command)).toEqual({ status: 'executing', nextStepKey: 'narration' })
    const run = rt(await readProductRuntimeState(f.command.sessionId)).openRun!
    expect(run.clocks[0].value).toBe(3);expect(run.stage.status).toBe('closed');await replay(f.command.sessionId)
  })
  it('never treats a closed main session as a new playable authorization window', async () => {
    const f = await setup({ closure: true }); await close(f)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.command.sessionId, 'illegal.reopen'), viewerKey: f.command.viewerKey, triggerKind: 'submit-action', rawInput: '继续耗时行动' })).rejects.toThrow()
    await replay(f.command.sessionId)
  })
})
