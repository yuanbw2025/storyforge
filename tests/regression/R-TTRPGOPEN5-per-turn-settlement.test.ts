import { setupPerTurnConsequenceFixtureV1 } from '../helpers/open-ttrpg-per-turn'
import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents,applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { setupPressureFixtureV1,nextPressureInputV1 } from '../helpers/open-ttrpg-pressure'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { rt,forkAndStart,approve,operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { prepareTtrpgOpenPressureEffectV1,proposeTtrpgOpenPressureEffectV1,confirmTtrpgOpenPressureEffectV1,applyTtrpgOpenPressureEffectV1,advanceTtrpgWorldTurnV1,advanceTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import legacy from '../fixtures/ttrpg-open-paid-turn-legacy-v1.json'

async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!,events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),events)).toEqual(await readProductRuntimeState(sessionId))
}
const pendingEffect = setupPerTurnConsequenceFixtureV1

async function applyActualEffect(x: Awaited<ReturnType<typeof pendingEffect>>) {
  const locator = { ...x.command,cycleKey: x.cycle.cycleKey,workKey: x.work.workKey },request = { bindings: { actor: 'hero' },alternativeKey: null }
  const review = await prepareTtrpgOpenPressureEffectV1({ ...locator,request })
  await proposeTtrpgOpenPressureEffectV1({ ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.propose`),...locator,request,riskHash: review.riskHash,reviewKey: review.reviewKey })
  for (const a of review.requiredApprovals.filter(a => a.actorKey !== 'gm')) await confirmTtrpgOpenPressureEffectV1({ ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.approval.${a.actorKey}`),...locator,riskHash: review.riskHash,reviewKey: review.reviewKey,actorKey: a.actorKey,decision: 'approve' })
  const input = { ...await operationInput(locator.sessionId,locator.operationKey,`pressure.work.${locator.workKey}.${review.reviewKey}.apply`),...locator,reviewKey: review.reviewKey }
  const event = await applyTtrpgOpenPressureEffectV1(input)
  expect((await applyTtrpgOpenPressureEffectV1(input)).sequence).toBe(event.sequence)
}
describe('R-TTRPGOPEN5 actual per-worldTurn settlement', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('requires each real pressure and situation checkpoint before the next paid turn',async () => {
    const x = await setupPressureFixtureV1({ turns: 3,isolateSituations: true }),sessionId = x.f.sessionId
    await resumeTtrpgOpenOperationV1(x.command)
    const first = await readProductRuntimeState(sessionId),op = rt(first).openRun!.operations[0]
    expect(op.settlementOrder).toBe('per-world-turn-v1');expect(rt(first).openRun!.worldTime.worldTurn).toBe(1)
    await expect(advanceTtrpgWorldTurnV1({ ...await operationInput(sessionId,op.operationKey,'time.2'),stepKey: 'time.2',reason: 'game-action' })).rejects.toThrow()
    expect(await readProductRuntimeState(sessionId)).toEqual(first)
    const planned = await advanceTtrpgOpenPressureV1(await nextPressureInputV1(x.command)),payload = JSON.parse(planned.payloadJson)
    payload.cycle.operationStepKey = 'pressure.2'
    expect(() => applyProductRuntimeEvent(first,{ ...planned,payloadJson: JSON.stringify(payload) })).toThrow()
    await settleOpenPaidTurnsV1(x.command)
    const final = await readProductRuntimeState(sessionId),run = rt(final).openRun!
    expect(run.worldTime.worldTurn).toBe(3)
    expect(run.pressureCycles!.map(c => c.operationStepKey)).toEqual(['pressure.1','pressure.2','pressure.3'])
    expect(run.situationCycles!.map(c => c.operationStepKey)).toEqual(['situations.1','situations.2','situations.3'])
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const ticks = events.filter(e => e.type === 'ttrpg.world-turn.advanced')
    for (let i = 1;i < ticks.length;i++) expect(run.situationCycles![i - 1].completedRef!.sequence).toBeLessThan(ticks[i].sequence)
    await replay(sessionId)
  })
  it('stops on first-turn cost and applies its condition before evaluating the next turn',async () => {
    const x = await pendingEffect(),sessionId = x.f.sessionId
    expect(rt(x.state).openRun!.worldTime.worldTurn).toBe(1)
    await resumeTtrpgOpenOperationV1(x.command);await resumeTtrpgOpenPressureV1(x.command)
    expect(await readProductRuntimeState(sessionId)).toEqual(x.state)
    await applyActualEffect(x);await settleOpenPaidTurnsV1(x.command)
    const final = await readProductRuntimeState(sessionId),run = rt(final).openRun!
    expect(run.worldTime.worldTurn).toBe(3)
    expect(run.clocks.find(c => c.clockKey === 'temporary.ability')!.value).toBe(1)
    expect(run.operations[0].pressureTurnConditions!.map(t => (t.conditions.hero ?? []).length)).toEqual([0,1,0])
    expect(run.pressureCycles!.flatMap(c => c.tickQueue).filter(t => t.clockKey === 'temporary.ability').map(t => t.atWorldTurn)).toEqual([2])
    await replay(sessionId)
  })
  it('resumes a real inherited partial first-turn consequence and a complete backup without replaying paid time',async () => {
    const x = await pendingEffect();await applyActualEffect(x)
    const cut = await readProductRuntimeState(x.f.sessionId),child = await forkAndStart(x.f.sessionId)
    await approve(child.sessionId,child.op.operationKey)
    const command = { ...x.command,sessionId: child.sessionId,operationKey: child.op.operationKey,frozenPlanHash: child.op.planHash }
    expect(child.op.settlementOrder).toBe('per-world-turn-v1')
    await settleOpenPaidTurnsV1(command)
    const final = await readProductRuntimeState(child.sessionId),run = rt(final).openRun!
    expect(run.worldTime.worldTurn).toBe(3)
    expect(run.clocks.find(c => c.clockKey === 'temporary.ability')!.value).toBe(1)
    expect((await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()).filter(e => e.type === 'ttrpg.world-turn.advanced')).toHaveLength(2)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(cut)
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),rows = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    const copy = rows.find(r => JSON.parse(r.runtimeHeadStateJson).ttrpg.sessionKey === rt(final).sessionKey)
    expect(copy).toBeDefined();expect(await readProductRuntimeState(copy!.id!)).toEqual(final)
    await replay(child.sessionId)
  })
  it('restores the exact pre-change multi-turn journal and finishes its original batch checkpoint',async () => {
    const projectId = await importProjectJSON(legacy.projectJson),row = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const before = await readProductRuntimeState(row.id!),op = rt(before).openRun!.operations[0]
    expect(op.settlementOrder).toBeUndefined();expect(rt(before).openRun!.worldTime.worldTurn).toBe(3)
    expect(op.plannedSteps.map(s => s.stepKey)).toEqual(['rule','mechanics','knowledge','time.1','time.2','time.3','pressure','situations','terminal','gates','narration','handoff'])
    const command = { ...legacy.command,sessionId: row.id! }
    await resumeTtrpgOpenPressureV1(command)
    const final = await readProductRuntimeState(row.id!),run = rt(final).openRun!
    expect(run.operations[0].settlementOrder).toBeUndefined()
    expect(run.pressureCycles).toHaveLength(1);expect(run.pressureCycles![0].operationStepKey).toBeUndefined()
    expect(run.pressureCycles![0].tickQueue.map(t => t.atWorldTurn)).toEqual([1,2,3])
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    await replay(row.id!)
  })
})
