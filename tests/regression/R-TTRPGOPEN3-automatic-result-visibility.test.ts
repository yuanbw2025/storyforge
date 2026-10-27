import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenInteractionV1 } from '../helpers/open-ttrpg-interaction'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { settleOpenPaidTurnsV1 } from '../helpers/open-ttrpg-paid-turns'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { proposeTtrpgOpenManualActionV1, confirmTtrpgOpenTableRiskV1, readTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenKpContextV1 } from '../../src/lib/ttrpg/open-kp-context'
import { parseTtrpgOpenRulePlanV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { changeTtrpgSituationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'

async function propose(x: Awaited<ReturnType<typeof seedOpenInteractionV1>>) {
  await proposeTtrpgOpenManualActionV1({ ...x.input, request: x.request, submissionKey: 'public.automatic.move', basisHash: x.catalog.basisHash, rawInput: '只移动本人；不授予秘密或访问权限。' })
  return (await readTtrpgOpenTableV1(x.input)).player!.operation!
}

describe('R-TTRPGOPEN3 public automatic result and private rolled result', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['party', 'public'] as const)('delivers an actual %s no-dice movement outcome to KP despite private dice defaults', async audience => {
    const x = await seedOpenInteractionV1('move', pkg => {
      pkg.ttrpg!.campaign.informationPolicy.hiddenDice = 'gm-only'
      const c = pkg.ttrpg!.campaign
      c.runtimePolicy.enabled = true
      c.effectPlanTemplates.find(t => t.planKey === 'interaction.move')!.audience = audience
      c.situationTemplates[0].obstacles = c.situationTemplates[0].obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 20 } }))
      c.situationTemplates[0].noInterventionOutcome.afterWorldTurns = 20
      c.situationTemplates[0].consequences = []
      c.fronts[0].escalationStages[0].atClockValue = c.clocks[0].maximum
    })
    await changeTtrpgSituationV1({ ...await openEnvelopeV1(x.f.sessionId, 'public.move.opening'), templateKey: x.f.campaign.openingSituationKeys[0], activationReason: 'opening', mode: 'activated' })
    x.catalog = await readTtrpgOpenManualActionCatalogV1(x.input)
    const op = await propose(x)
    expect(op.risk.privateRoll).toBe(false)
    for (const a of op.approvals) await confirmTtrpgOpenTableRiskV1({ ...x.input, operationKey: op.operationKey, riskHash: op.riskHash, actorKey: a.actorKey, decision: 'approve' })
    const planned = (await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.operations[0]
    expect(planned.plan.rollVisibility).toBe('public')
    const command = { ...x.input, operationKey: op.operationKey, frozenPlanHash: planned.planHash }
    await settleOpenPaidTurnsV1(command)
    expect(await resumeTtrpgOpenChecksV1(command)).toMatchObject({ nextStepKey: 'narration' })
    const state = await readProductRuntimeState(x.f.sessionId)
    expect(state.entities.hero.locationKey).toBe('market')
    expect(state.ttrpg!.openRun!.worldTime.worldTurn).toBe(2)
    expect(state.ttrpg!.openRun!.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic', check: null })
    const context = await loadTtrpgOpenKpContextV1({ scope: x.f.scope, sessionId: x.f.sessionId, actorKey: 'gm' })
    const packet = context.modernResources.find(row => row.suffix === 'kp-input.v3')!.value as { entries: Array<{ sourceKey: string; value: { result: string } }> }
    expect(packet.entries.find(row => row.sourceKey === 'action.receipt')!.value.result).toBe('automatic')
    expect(state.ttrpg!.openRun!.coordination.calls).toEqual([])
    await settleOpenPaidTurnsV1(command)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(state)
    const session = (await db.productRuntimeSessions.get(x.f.sessionId))!
    const events = await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(state)
    // Old stored plans remain literal snapshots, even when their public action was marked private.
    const legacy = { ...planned.plan, rollVisibility: 'gm-only' as const }
    expect(parseTtrpgOpenRulePlanV1(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy)
  })
  it.each(['gm', 'actor:hero'] as const)('keeps a no-dice action with explicit %s consequences private', async audience => {
    const x = await seedOpenInteractionV1('move', pkg => {
      pkg.ttrpg!.campaign.informationPolicy.hiddenDice = 'gm-only'
      pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.move')!.audience = audience
    })
    const op = await propose(x)
    expect(op.risk.privateRoll).toBe(true)
    expect((await readProductRuntimeState(x.f.sessionId)).ttrpg!.openRun!.operations[0].plan.rollVisibility).toBe('gm-only')
  })
  it.each([false, true])('keeps an actual private outcome out of the shared KP receipt, rolled %s', async rolled => {
    const x = await setupChecksFixtureV1({ cooperative: true, privateDiscovery: !rolled }, pkg => {
      if (rolled) {
        const rules = pkg.ttrpg!.rulePack.content, check = rules.checks[0]
        rules.actions[0].effects.unshift({ kind: 'check', checkKey: check.key, attributeKey: check.attributeKeys[0] })
      }
    }, async fixture => { if (rolled) Reflect.deleteProperty(fixture.request, 'discovery') })
    expect(await resumeTtrpgOpenChecksV1(x.command)).toMatchObject({ nextStepKey: 'narration' })
    const state = await readProductRuntimeState(x.f.sessionId), run = state.ttrpg!.openRun!
    expect(run.operations[0].plan.rollVisibility).toBe('gm-only')
    if (rolled) expect(run.ruleReceipts[0].result.check).not.toBeNull()
    else expect(run.ruleReceipts[0].result.check).toBeNull()
    if (rolled) expect(run.operations[0].plan.discoveryPlan).toBeUndefined()
    else expect(run.operations[0].plan.discoveryPlan!.recipientActorKeys).toEqual(['hero'])
    const context = await loadTtrpgOpenKpContextV1({ scope: x.f.scope, sessionId: x.f.sessionId, actorKey: 'gm' })
    const packet = context.modernResources.find(row => row.suffix === 'kp-input.v3')!.value as { entries: Array<{ sourceKey: string; value: { result: string } }> }
    expect(packet.entries.find(row => row.sourceKey === 'action.receipt')!.value.result).toBe('not-public')
  })
})
