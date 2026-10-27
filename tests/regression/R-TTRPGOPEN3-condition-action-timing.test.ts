import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenInteractionV1 } from '../helpers/open-ttrpg-interaction'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { changeTtrpgSituationV1, startTtrpgOpenEpochV1, startTtrpgOpenIntentCandidateOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readTtrpgOpenTableV1, confirmTtrpgOpenTableRiskV1, resumeTtrpgOpenTableV1, recordTtrpgOpenTableHumanNarrationV1, finishTtrpgOpenTableWindowV1, readTtrpgOpenManualActionCatalogV1, proposeTtrpgOpenManualActionV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { resolveTtrpgOpenRuleMechanicalV1 } from '../../src/lib/ttrpg/open-rule-resolution'
import * as plans from '../../src/lib/ttrpg/open-rule-plan'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
const lift = { key: 'fixture.ally-lift', name: '协助振奋', description: '下一次本人检定 +1', maximumStacks: 1, checkModifier: 1, defaultDurationRounds: 1, stacking: 'replace' as const }
async function approve(input: Parameters<typeof readTtrpgOpenTableV1>[0]) {
  const op = (await readTtrpgOpenTableV1(input)).player!.operation!
  for (const a of op.approvals) await confirmTtrpgOpenTableRiskV1({ ...input, operationKey: op.operationKey, riskHash: op.riskHash, actorKey: a.actorKey, decision: 'approve' })
  const plan = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.operations.find(o => o.operationKey === op.operationKey)!
  return { ...input, operationKey: op.operationKey, frozenPlanHash: plan.planHash }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
async function aid(checkTurns = 1) {
  const x = await seedOpenInteractionV1('assist', pkg => {
    const c = pkg.ttrpg!, campaign = c.campaign
    c.rulePack.content.conditions.push(lift)
    c.rulePack.content.actions[0].target = 'single-ally'
    c.rulePack.content.actions[0].effects = [{ kind: 'condition', conditionKey: lift.key, stacks: 1 }]
    campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.cost')!.parameters[0].allowedRefs = ['companion.1']
    campaign.runtimePolicy.enabled = true; campaign.runtimePolicy.maximumEpochTokens = 50000
    campaign.situationTemplates[0].obstacles = campaign.situationTemplates[0].obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 20 } }))
    campaign.situationTemplates[0].noInterventionOutcome.afterWorldTurns = 20
    campaign.situationTemplates[0].consequences = []
    campaign.fronts[0].escalationStages[0].atClockValue = campaign.clocks[0].maximum
    for (const check of c.rulePack.content.genericChecks) {
      check.timeCostWorldTurns = checkTurns
      for (const key of Object.keys(check.effectPlanByDegree) as Array<keyof typeof check.effectPlanByDegree>) check.effectPlanByDegree[key] = null
    }
  })
  await changeTtrpgSituationV1({ ...await openEnvelopeV1(x.f.sessionId, 'aid.opening'), templateKey: x.f.campaign.openingSituationKeys[0], activationReason: 'opening', mode: 'activated' })
  const rawInput = '请队友仅协助本人后续检定'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId, 'aid.epoch'), viewerKey: x.input.viewerKey, triggerKind: 'continue-host', rawInput })
  const runAI = vi.fn(async () => JSON.stringify({ goal: '协助同伴下一次检定', method: x.rule.interactionKey, targetRefs: ['hero'], declaredResources: [], declaredAssumptions: [], requestedOutcome: '同伴获得协助振奋' }))
  const g = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(x.f.sessionId, 'aid.candidate'), ...x.input, actorKey: 'companion.1', rawInput, maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
  await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(x.f.sessionId, 'aid.start'), viewerKey: x.input.viewerKey, ...g.prepared, candidateHash: g.candidate.candidateHash, decision: 'start', effectBindings: { 'interaction.cost': { actor: 'companion.1' } } })
  const command = await approve(x.input)
  await settleOpenPaidTurnsV1(command)
  return { ...x, command, runAI }
}
describe('R-TTRPGOPEN3 condition timing at the owning action boundary', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each([0, 1])('retains a real ally benefit through the helper turn, uses it for the recipients next check costing %s turns and consumes it once', async checkTurns => {
    const x = await aid(checkTurns), first = await readProductRuntimeState(x.f.sessionId)
    expect(first.ttrpg!.product.conditions.hero).toEqual([{ conditionKey: lift.key, stacks: 1, duration: 1 }])
    expect(first.ttrpg!.openRun!.worldTime.worldTurn).toBe(1)
    if (checkTurns === 1) {
      const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId))
      const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
      const imported = await readProductRuntimeState(copy.id!)
      expect(imported.ttrpg!.product.conditions.hero).toEqual(first.ttrpg!.product.conditions.hero)
      expect(imported.ttrpg!.openRun!.operations[0].plan.conditionTiming).toBe('actor-action-v1')
      await replay(copy.id!)
      expect(await readProductRuntimeState(x.f.sessionId)).toEqual(first)
    }
    await resumeTtrpgOpenTableV1({ ...x.input, operationKey: x.command.operationKey })
    await recordTtrpgOpenTableHumanNarrationV1({ ...x.input, operationKey: x.command.operationKey, text: '队友已支付资源并协助本人。', reason: 'host-authored' })
    await resumeTtrpgOpenTableV1({ ...x.input, operationKey: x.command.operationKey })
    await finishTtrpgOpenTableWindowV1(x.input)
    const catalog = await readTtrpgOpenManualActionCatalogV1(x.input), check = x.f.runtimePackage.ttrpg!.rulePack.content.genericChecks[0]
    await proposeTtrpgOpenManualActionV1({ ...x.input, basisHash: catalog.basisHash, submissionKey: 'aid.next-use', rawInput: '本人亲自进行下一次检定', request: { route: 'generic-check', ruleKey: check.checkKey, actorKey: 'hero', targetKey: 'hero', controllerMode: 'human', effectBindings: {} } })
    const command = await approve(x.input), before = await readProductRuntimeState(x.f.sessionId), op = before.ttrpg!.openRun!.operations.at(-1)!
    const without = structuredClone(before); without.ttrpg!.product.conditions.hero = []
    const baseline = await resolveTtrpgOpenRuleMechanicalV1({ state: without, plan: op.plan, seed: 'aid.counterfactual', operationKey: op.operationKey, sequence: before.lastSequence + 1 })
    await settleOpenPaidTurnsV1(command)
    const after = await readProductRuntimeState(x.f.sessionId), result = after.ttrpg!.openRun!.ruleReceipts.at(-1)!.result
    expect(result.check!.modifier).toBe(baseline.check!.modifier + 1)
    expect(after.ttrpg!.product.conditions.hero).toEqual([])
    expect(after.ttrpg!.openRun!.worldTime.worldTurn).toBe(1 + checkTurns)
    await settleOpenPaidTurnsV1(command); expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    expect(x.runAI).toHaveBeenCalledOnce(); await replay(x.f.sessionId)
  })
  it('preserves missing-policy legacy plan bytes and the original global-world-tick expiry on replay', async () => {
    const create = plans.createTtrpgOpenRulePlanV1
    vi.spyOn(plans, 'createTtrpgOpenRulePlanV1').mockImplementation(async input => { const plan = await create(input); Reflect.deleteProperty(plan, 'conditionTiming'); return plan })
    const x = await aid(), state = await readProductRuntimeState(x.f.sessionId), plan = state.ttrpg!.openRun!.operations[0].plan
    expect(Object.prototype.hasOwnProperty.call(plan, 'conditionTiming')).toBe(false)
    expect(plans.parseTtrpgOpenRulePlanV1(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
    expect(state.ttrpg!.product.conditions.hero).toEqual([])
    await replay(x.f.sessionId)
  })
  it.each([0, 2])('keeps a newly granted own status after the granting action costs %s world turns', async turns => {
    const x = await seedOpenInteractionV1('move', pkg => {
      const c = pkg.ttrpg!; c.rulePack.content.conditions.push(lift)
      c.rulePack.content.actions[0].effects = [{ kind: 'condition', conditionKey: lift.key, stacks: 1, targetScope: 'actor' }]
      c.rulePack.content.interactionBindings![0].timeCostWorldTurns = turns
    })
    await proposeTtrpgOpenManualActionV1({ ...x.input, basisHash: x.catalog.basisHash, submissionKey: 'new.status', rawInput: '只移动本人并获得冻结状态', request: x.request })
    const command = await approve(x.input); await settleOpenPaidTurnsV1(command)
    const state = await readProductRuntimeState(x.f.sessionId), plan = state.ttrpg!.openRun!.operations[0].plan
    expect(state.ttrpg!.product.conditions.hero).toEqual([{ conditionKey: lift.key, stacks: 1, duration: 1 }])
    expect(state.ttrpg!.openRun!.worldTime.worldTurn).toBe(turns)
    expect(() => plans.parseTtrpgOpenRulePlanV1({ ...plan, conditionTiming: 'unbounded' })).toThrow()
    await settleOpenPaidTurnsV1(command); expect(await readProductRuntimeState(x.f.sessionId)).toEqual(state)
    await replay(x.f.sessionId)
  })
})
