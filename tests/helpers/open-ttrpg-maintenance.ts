import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { ttrpgOpenTurnCycleMatchesV1 } from '../../src/lib/ttrpg/open-turn-settlement'
/** Real frozen E11 fixture shared with isolated browser recovery. */
import { setupPressureFixtureV1 } from './open-ttrpg-pressure'
import { rt } from './open-ttrpg-branch-recovery'
import { ttrpgOpenScopedKeyV1 } from '../../src/lib/ttrpg/open-coordination'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { changeTtrpgSituationV1, advanceTtrpgOpenSituationsV1, ttrpgOpenOperationCommandIdV1, telegraphTtrpgOpenFrontV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { nextTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationCycleActionKeyV1 } from '../../src/lib/ttrpg/open-situation-cycle'
export async function setupMaintenanceFixtureV1(options: { resolve?: boolean; queue?: boolean; effect?: boolean; rejectQueue?: boolean; clockMaximum?: number; clockEffect?: boolean; cost?: boolean; chain?: boolean; inaccessibleChain?: boolean } = {}) {
  const f = await setupPressureFixtureV1({ turns: 2, maximum: options.clockMaximum ?? 8, effect: options.clockEffect }, pkg => {
    const campaign = pkg.ttrpg!.campaign, original = campaign.situationTemplates[0]
    original.obstacles = original.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: options.resolve && !options.rejectQueue ? 2 : 10 } }))
    original.noInterventionOutcome.afterWorldTurns = options.resolve && !options.rejectQueue ? 10 : 2
    if (!options.effect) original.consequences = []
    if (options.cost) {
      const template = campaign.effectPlanTemplates[0], resource = pkg.ttrpg!.rulePack.content.resources[0].key
      const effect = { effectKey: 'maintenance.cost', family: 'numeric' as const, operation: 'resource.spend' as const, targetRef: 'parameter:actor', valueKey: resource, amount: 1 }
      template.effects = []; template.alternatives = [{ alternativeKey: 'small', title: '承担一份代价', effects: [effect] }, { alternativeKey: 'large', title: '承担两份代价', effects: [{ ...effect, effectKey: 'maintenance.cost.large', amount: 2 }] }]
    }
    if (options.chain) {
      const next = structuredClone(original); next.templateKey = 'situation.actual-consequence'
      next.consequences = []; next.obstacles = next.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 10 } }))
      next.noInterventionOutcome.afterWorldTurns = 3
      next.evidence = next.evidence.map(e => ({ ...e, clueRef: `${e.clueRef}.consequence` }))
      if (options.inaccessibleChain) next.preconditions = [{ op: 'world-turn-at-least', value: 10 }]
      campaign.situationTemplates.push(next); original.consequences[0].nextSituationTemplateKey = next.templateKey
    }
    if (options.queue) for (let i = 1; i <= 6; i++) {
      const next = structuredClone(original); next.templateKey = `situation.queue.${i}`
      next.obstacles = next.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 10 } }))
      next.noInterventionOutcome.afterWorldTurns = i >= 5 ? 1 : 10
      next.evidence = next.evidence.map(e => ({ ...e, clueRef: `${e.clueRef}.queue.${i}` }))
      if (options.rejectQueue && i === 5) next.preconditions = [{ op: 'not', of: { op: 'clock-at-least', clockKey: 'flood', value: 3 } }]
      campaign.situationTemplates.push(next); if (i < 5) campaign.openingSituationKeys.push(next.templateKey)
    }
    if (options.queue) {
      campaign.fronts[0].escalationStages[0].atClockValue = 2
      campaign.fronts[0].escalationStages[0].newSituationTemplateKey = 'situation.queue.5'
      const second = structuredClone(campaign.fronts[0]); second.frontKey = 'storm.second'
      second.telegraph[0].telegraphKey = 'wind.second'
      second.escalationStages[0].newSituationTemplateKey = 'situation.queue.6'
      campaign.fronts.push(second)
    }
  }, async fixture => {
    if (options.queue) for (const [frontKey, telegraphKey] of [['storm', 'wind'], ['storm.second', 'wind.second']]) {
      const sessionKey = rt(await readProductRuntimeState(fixture.sessionId)).sessionKey
      await telegraphTtrpgOpenFrontV1({ ...await openEnvelopeV1(fixture.sessionId, await ttrpgOpenScopedKeyV1(sessionKey, 'pressure-signal', [frontKey, telegraphKey])), viewerKey: OPEN_HUMAN_VIEWER, frontKey, telegraphKey })
    }
    if (options.queue) for (const templateKey of fixture.campaign.openingSituationKeys.slice(1)) await changeTtrpgSituationV1({
      ...await openEnvelopeV1(fixture.sessionId, `opening.${templateKey}`), templateKey, activationReason: 'opening', mode: 'activated' })
  })
  await resumeTtrpgOpenOperationV1(f.command)
  await resumeTtrpgOpenPressureV1(f.command)
  await resumeTtrpgOpenSituationsV1(f.command)
  await resumeTtrpgOpenOperationV1(f.command)
  await resumeTtrpgOpenPressureV1(f.command)
  return f
}
export async function nextMaintenanceInputV1(command: Awaited<ReturnType<typeof setupMaintenanceFixtureV1>>['command']) {
  const state = await readProductRuntimeState(command.sessionId), runtime = rt(state), receipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === command.operationKey)!
  const operation = runtime.openRun!.operations.find(o => o.operationKey === command.operationKey)!
  const scope = nextTtrpgOpenOperationStepV1(operation)?.stepKey ?? 'situations'
  const cycle = runtime.openRun!.situationCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,receipt.inheritedFrom?.originalSourceRef ?? receipt.sourceRef,'situations'))
  const key = ttrpgOpenSituationCycleActionKeyV1(cycle ? nextTtrpgOpenSituationCycleActionV1(state, cycle) : null, cycle,scope)
  return { ...await openEnvelopeV1(command.sessionId, await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, command.operationKey, key)), ...command }
}
export async function maintenanceStepV1(command: Awaited<ReturnType<typeof setupMaintenanceFixtureV1>>['command']) {
  return advanceTtrpgOpenSituationsV1(await nextMaintenanceInputV1(command))
}

export async function approveMaintenanceEffectV1(command: Awaited<ReturnType<typeof setupMaintenanceFixtureV1>>['command'], decision: 'approve' | 'reject' = 'approve') {
  const api = await import('../../src/lib/ttrpg/runtime-commands')
  const run = rt(await readProductRuntimeState(command.sessionId)).openRun!, cycle = run.situationCycles!.find(c => !c.completedRef)!, work = cycle.work.find(w => !w.completedRef)!
  const locator = { ...command, cycleKey: cycle.cycleKey, workKey: work.workKey }, request = { bindings: { actor: 'hero' }, alternativeKey: 'small' }
  const review = await api.prepareTtrpgOpenSituationEffectV1({ ...locator, request })
  const envelope = async (suffix: string) => ({ ...await openEnvelopeV1(command.sessionId, await ttrpgOpenOperationCommandIdV1(rt(await readProductRuntimeState(command.sessionId)).sessionKey,
    command.operationKey, `situations.work.${work.workKey}.${review.reviewKey}.${suffix}`)), ...locator, riskHash: review.riskHash, reviewKey: review.reviewKey })
  const proposal = await api.proposeTtrpgOpenSituationEffectV1({ ...await envelope('propose'), request })
  const confirmation = await api.confirmTtrpgOpenSituationEffectV1({ ...await envelope('approval.hero'), actorKey: 'hero', decision })
  return { locator, review, proposal, confirmation }
}
