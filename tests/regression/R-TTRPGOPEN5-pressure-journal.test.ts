import * as timingPlans from '../../src/lib/ttrpg/open-rule-plan'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { resolveTtrpgOracleV1 } from '../../src/lib/ttrpg/oracle'
import { setup as knowledgeSetup, start as startOperation } from '../helpers/open-ttrpg-knowledge'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { setupPressureFixtureV1, nextPressureInputV1 as nextInput } from '../helpers/open-ttrpg-pressure'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { advanceTtrpgOpenPressureV1, consultTtrpgOracleV1, resolveTtrpgOpenOperationRuleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { rt, forkAndStart, approve } from '../helpers/open-ttrpg-branch-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

// Pressure-only cases keep situation outcomes outside this ten-turn fixture;
// combined consequences have their own explicit consent and interleaving tests.
const fixture = (options: Parameters<typeof setupPressureFixtureV1>[0] = {},...rest: [Parameters<typeof setupPressureFixtureV1>[1]?,Parameters<typeof setupPressureFixtureV1>[2]?]) => setupPressureFixtureV1({ ...options,isolateSituations: true },...rest)
async function assertReplay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN5 actual durable pressure owner', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects pressure before mechanical/time receipts, then consumes every idle turn once and publishes a real signal', async () => {
    const { f, command } = await fixture()
    await expect(advanceTtrpgOpenPressureV1(await nextInput(command))).rejects.toThrow(/真实检定/)
    await resumeTtrpgOpenOperationV1(command)
    expect(await settleOpenPaidTurnsV1(command)).toEqual({ status: 'executing', nextStepKey: 'terminal' })
    const final = await readProductRuntimeState(f.sessionId), run = rt(final).openRun!
    expect(run.clocks[0].value).toBe(3)
    expect(run.worldTime.worldTurn).toBe(3)
    expect(run.pressureCycles!.flatMap(c => c.tickQueue).map(t => t.atWorldTurn)).toEqual([1, 2, 3])
    expect(run.fronts[0].stageKey).toBe('rising') // Turn 1 warning is real before turn 3 escalation.
    expect(run.fronts[0].telegraphWorldTurns).toEqual({ wind: 1 })
    expect(run.pressureCycles!.flatMap(c => c.frontReceipts).find(r => r.kind === 'telegraph')).toMatchObject({ kind: 'telegraph', audience: 'party', recipientActorKeys: ['hero', 'companion.1', 'companion.2'] })
    expect(run.pressureCycles![0].completedRef).not.toBeNull()
    await resumeTtrpgOpenPressureV1(command)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(final)
    await assertReplay(f.sessionId)
  })
  it('escalates after a genuinely published advance warning without exposing hidden stage/clock data to players', async () => {
    const { f, command } = await fixture({ prewarn: true })
    const before = rt(await readProductRuntimeState(f.sessionId)).openRun!
    expect(before.pressureSignals![0]).toMatchObject({ worldTurn: 0, signalText: '风更大了' })
    await resumeTtrpgOpenOperationV1(command)
    await settleOpenPaidTurnsV1(command)
    const run = rt(await readProductRuntimeState(f.sessionId)).openRun!
    expect(run.fronts[0].stageKey).toBe('rising')
    expect(run.chaos.value).toBe(6)
    expect(run.pressureCycles!.flatMap(c => c.frontReceipts)).toMatchObject([{ kind: 'advanced', definitionKey: 'rising', atWorldTurn: 3 }])
    const actor = await loadTtrpgOpenPlayerContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'hero' })
    expect(actor.view.pressureSignals).toMatchObject([{ signalText: '风更大了', atWorldTurn: 0, audience: 'party' }])
    expect(Object.keys(actor.view.pressureSignals[0])).not.toContain('frontKey')
    expect(Object.keys(actor.view.pressureSignals[0])).not.toContain('stageKey')
    await assertReplay(f.sessionId)
  })
  it('defeats only on true frozen predicates and decreases chaos once in a recoverable actual event', async () => {
    const { f, command } = await fixture({ turns: 10, maximum: 6 })
    await resumeTtrpgOpenOperationV1(command)
    await settleOpenPaidTurnsV1(command)
    const final = await readProductRuntimeState(f.sessionId), run = rt(final).openRun!
    expect(run.fronts[0].defeated).toBe(true)
    expect(run.chaos.value).toBe(6) // A prior escalation (+1), clock completion (+1), then defeat (-1).
    expect(run.pressureCycles!.flatMap(c => c.frontReceipts).filter(r => r.kind === 'defeated')).toMatchObject([{ kind: 'defeated' }])
    await resumeTtrpgOpenPressureV1(command)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(final)
    await assertReplay(f.sessionId)
  })
  it.each([true, false])('evaluates real per-turn condition receipts (legacy timing=%s)', async legacyTiming => {
    if (legacyTiming) {
      const create = timingPlans.createTtrpgOpenRulePlanV1
      vi.spyOn(timingPlans, 'createTtrpgOpenRulePlanV1').mockImplementation(async input => {
        const plan = await create(input); Reflect.deleteProperty(plan, 'conditionTiming'); return plan
      })
    }

    const { f, command } = await fixture({}, pkg => {
      const c = pkg.ttrpg!, condition = c.rulePack.content.conditions[0], available = c.rulePack.content.actions[1]
      condition.defaultDurationRounds = 2
      c.rulePack.content.actions[0].effects = [{ kind: 'condition', conditionKey: condition.key, stacks: 1, targetScope: 'actor' }]
      available.requirements = [{ kind: 'condition', conditionKey: condition.key, stacks: 1, operator: 'present' }]
      c.campaign.clocks[0].autoAdvance.onIdleWorldTurns = 0
      c.campaign.clocks[0].advanceTriggers = [{ triggerKey: 'temporary.ability', sceneKey: null, actionKey: null,
        condition: { op: 'ability-available', actorKey: 'hero', abilityKey: available.key }, amount: 1, reason: '限时能力推动时钟' }]
    })
    await settleOpenPaidTurnsV1(command)
    const before = rt(await readProductRuntimeState(f.sessionId)).openRun!
    expect(before.operations[0].pressureTurnConditions!.map(t => t.conditions.hero.length)).toEqual(legacyTiming ? [1, 0, 0] : [1, 1, 1])
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.product.conditions.hero).toHaveLength(legacyTiming ? 0 : 1)
    await resumeTtrpgOpenPressureV1(command)
    const final = rt(await readProductRuntimeState(f.sessionId)).openRun!
    expect(final.clocks[0].value).toBe(legacyTiming ? 1 : 3)
    expect(final.pressureCycles![0].tickQueue.map(t => t.atWorldTurn)).toEqual([1])
    await assertReplay(f.sessionId)
  })
  it('consumes a true negative Oracle once through pressure without changing chaos at consultation', async () => {
    const f = await knowledgeSetup({}, pkg => {
      pkg.ttrpg!.rulePack.content.timePolicy.existingAction = 3
      for (const t of pkg.ttrpg!.campaign.situationTemplates) { t.obstacles = t.obstacles.map(o => ({ ...o,predicate: { op: 'world-turn-at-least',value: 20 } }));t.noInterventionOutcome.afterWorldTurns = 20 }
      pkg.ttrpg!.campaign.clocks[0].autoAdvance.onIdleWorldTurns = 1
      pkg.ttrpg!.campaign.clocks[0].onCompleteEffectPlanRef = null
      pkg.ttrpg!.campaign.fronts[0].escalationStages[0].newSituationTemplateKey = null
    })
    let selected = ''
    for (let i = 0; i < 32; i++) {
      const commandId = `pressure.oracle.${i}`
      const result = await resolveTtrpgOracleV1({ rulePack: f.runtimePackage.ttrpg!.rulePack.content, oracleKey: 'oracle.yes', question: '潮水会退吗？',
        askedBy: 'player:hero', seed: f.session.seed, commandId, eventSequence: 1, likelihoodTierKey: 'even' })
      if (['no', 'no-but'].includes(String(result.outcome.rawResult))) { selected = commandId; break }
    }
    expect(selected).not.toBe('')
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, selected), viewerKey: OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '潮水会退吗？', likelihoodTierKey: 'even' })
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.chaos.value).toBe(5)
    const command = await startOperation(f)
    await resumeTtrpgOpenOperationV1(command)
    await settleOpenPaidTurnsV1(command)
    const final = await readProductRuntimeState(f.sessionId), run = rt(final).openRun!
    expect(run.clocks[0].value).toBe(4)
    expect(run.pressureCycles![0].consumedOracleRefs).toEqual([run.oracleReceipts![0].sourceRef])
    expect(run.pressureCycles!.flatMap(c => c.tickQueue).filter(t => t.triggerSource === 'auto-oracle-no')).toHaveLength(1)
    expect(run.chaos.value).toBe(6)
    await resumeTtrpgOpenPressureV1(command)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(final)
    await assertReplay(f.sessionId)
  })
  it('retains the legacy no-chaos rule event shape when the new recording flag is absent', async () => {
    const { f, command } = await fixture({ generic: true })
    const before = await readProductRuntimeState(f.sessionId)
    const event = await resolveTtrpgOpenOperationRuleV1(await operationInput(f.sessionId, command.operationKey, 'rule'))
    const payload = JSON.parse(event.payloadJson)
    expect(payload.recordChaos).toBe(true)
    delete payload.recordChaos
    const legacy = applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })
    expect(rt(legacy).openRun!.chaos).toEqual(rt(before).openRun!.chaos)
    expect(rt(legacy).openRun!.operations[0].pressureTurnConditions).toBeUndefined()
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.chaos.value).toBe(6)
  })
  it('changes chaos once for the actual failed rule and consumes that failure only once despite several paid turns', async () => {
    const { f, command } = await fixture({ generic: true })
    await resumeTtrpgOpenOperationV1(command)
    expect(rt(await readProductRuntimeState(f.sessionId)).openRun!.chaos.value).toBe(6)
    await settleOpenPaidTurnsV1(command)
    const run = rt(await readProductRuntimeState(f.sessionId)).openRun!
    expect(run.pressureCycles!.flatMap(c => c.tickQueue).filter(t => t.triggerSource === 'auto-failed-check')).toHaveLength(1)
    expect(run.clocks[0].value).toBe(4)
    expect(run.chaos.value).toBe(7)
    await assertReplay(f.sessionId)
  })
  it('crosses a maximum once, retains an exact frozen effect job and refuses to skip the missing owner', async () => {
    const { f, command } = await fixture({ maximum: 2, effect: true })
    await resumeTtrpgOpenOperationV1(command)
    const result = await settleOpenPaidTurnsV1(command)
    expect(result).toMatchObject({ status: 'awaiting-consequence', nextStepKey: 'pressure.2', workKeys: ['clock.flood.complete.effect'] })
    const before = await readProductRuntimeState(f.sessionId), run = rt(before).openRun!
    expect(run.clocks[0]).toMatchObject({ value: 2, completed: true })
    expect(run.chaos.value).toBe(6)
    expect(run.pressureCycles![1].work[0]).toMatchObject({ templateKey: 'plan.success', completedRef: null })
    await resumeTtrpgOpenPressureV1(command)
    await expect(advanceTtrpgOpenPressureV1(await nextInput(command))).rejects.toThrow(/后果 owner/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await assertReplay(f.sessionId)
  })
  it('returns the same tick on an exact retry and rejects a forged delta/result during real replay', async () => {
    const { f, command } = await fixture()
    await resumeTtrpgOpenOperationV1(command)
    await advanceTtrpgOpenPressureV1(await nextInput(command))
    const before = await readProductRuntimeState(f.sessionId), input = await nextInput(command)
    const tick = await advanceTtrpgOpenPressureV1(input)
    // The caller retries this exact command, rather than deriving the next command from the changed head.
    expect(await advanceTtrpgOpenPressureV1(input)).toEqual(tick)
    const payload = JSON.parse(tick.payloadJson); payload.result.delta += 1
    expect(() => applyProductRuntimeEvent(before, { ...tick, payloadJson: JSON.stringify(payload) })).toThrow(/冻结 tick/)
    await assertReplay(f.sessionId)
  })
  it('continues an imported partial cycle using real frozen source verification and rejects altered ancestor tick evidence', async () => {
    const { f, command } = await fixture()
    await resumeTtrpgOpenOperationV1(command)
    await advanceTtrpgOpenPressureV1(await nextInput(command))
    await advanceTtrpgOpenPressureV1(await nextInput(command))
    const before = await readProductRuntimeState(f.sessionId)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const importedSession = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const importedCommand = { ...command, sessionId: importedSession.id! }
    expect(await resumeTtrpgOpenPressureV1(importedCommand)).toEqual({ status: 'executing', nextStepKey: 'situations.1' })
    expect(rt(await readProductRuntimeState(importedSession.id!)).openRun!.worldTime.worldTurn).toBe(1)
    await settleOpenPaidTurnsV1(importedCommand)
    const resumed = await readProductRuntimeState(importedSession.id!)
    expect(rt(resumed).openRun!.clocks[0].value).toBe(3)
    expect(rt(before).openRun!.worldTime.worldTurn).toBe(1)
    expect(rt(resumed).openRun!.worldTime.worldTurn).toBe(3)
    expect(rt(resumed).openRun!.pressureCycles!.flatMap(c => c.tickRefs)).toHaveLength(3)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    const child = await forkAndStart(f.sessionId)
    const childState = await readProductRuntimeState(child.sessionId)
    childState.ttrpg!.openRun!.pressureCycles![0].tickRefs[0].sequence += 1
    expect(() => parseProductRuntimeState(childState)).toThrow(/祖先切点/)
    await assertReplay(importedSession.id!)
  })
  it.each([0, 1])('resumes an ancestor pressure plan at tick prefix %s without another roll or replaying inherited ticks', async count => {
    const { f, command } = await fixture()
    await resumeTtrpgOpenOperationV1(command)
    await advanceTtrpgOpenPressureV1(await nextInput(command))
    for (let i = 0; i < count; i++) await advanceTtrpgOpenPressureV1(await nextInput(command))
    const cut = await readProductRuntimeState(f.sessionId), child = await forkAndStart(f.sessionId)
    await approve(child.sessionId, child.op.operationKey)
    const childCommand = { ...command, sessionId: child.sessionId, operationKey: child.op.operationKey, frozenPlanHash: child.op.planHash }
    expect(await resumeTtrpgOpenPressureV1(childCommand)).toEqual({ status: 'executing', nextStepKey: 'situations.1' })
    await settleOpenPaidTurnsV1(childCommand)
    const final = await readProductRuntimeState(child.sessionId), run = rt(final).openRun!
    expect(run.clocks[0].value).toBe(3)
    expect(run.chaos.value).toBe(rt(cut).openRun!.chaos.value + 1) // The later actual warning permits one escalation.
    const events = await db.productRuntimeEvents.where('sessionId').equals(child.sessionId).toArray()
    expect(events.filter(e => e.type === 'ttrpg.rule.action.resolved')).toEqual([])
    expect(events.filter(e => e.type === 'ttrpg.clock.ticked')).toHaveLength(3 - count)
    const newProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(newProject).toArray()
    const states = await Promise.all(sessions.map(s => readProductRuntimeState(s.id!)))
    expect(rt(states.find(s => rt(s).sessionKey === rt(final).sessionKey)!).openRun!.pressureCycles).toEqual(run.pressureCycles)
    await assertReplay(child.sessionId)
  })
})
