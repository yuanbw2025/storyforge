/** Versioned admission delegates all dice/resolution/ability algorithms to shared kernels. */
import type { ProductRuntimeState, TtrpgRuntimeCheck } from '../types'
import type { TtrpgOpenRulePlanV1 } from './open-rule-plan'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { resolveTtrpgRuleActionMechanicalV1, type TtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { resolveRulePackCheckV1 } from './rule-pack'
import { ttrpgDegreeSucceededV2 } from './runtime-state'

export async function resolveTtrpgOpenRuleMechanicalV1(input: {
  state: ProductRuntimeState; plan: TtrpgOpenRulePlanV1; seed: string; operationKey: string; sequence: number;
}): Promise<TtrpgMechanicalResultV1> {
  const { plan, state, sequence } = input, request = plan.request
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) throw new Error('[ttrpg] open mechanical runtime missing')
  if (request.route === 'existing-action') {
    const action = plan.rulePack.actions.find(action => action.key === request.ruleKey)!
    const skill = (actorKey: string) => ({ skillKey: action.key, skillValue: plan.skillValues[actorKey] ?? 0 })
    return resolveTtrpgRuleActionMechanicalV1({ state, rulePack: plan.rulePack, action,
      actorKey: request.actorKey, targetKey: request.targetKey, seed: input.seed, commandId: input.operationKey,
      sequence, currentRound: runtime.openRun.worldTime.worldTurn, advanceConditions: false,
      situationalModifier: 0, rollVisibility: plan.rollVisibility, actorSkill: skill(request.actorKey),
      opponentSkill: request.targetKey ? skill(request.targetKey) : null })
  }
  const definition = plan.genericCheck!
  const entity = state.entities[request.actorKey]
  const conditionModifier = (runtime.product.conditions[request.actorKey] ?? []).reduce((sum, condition) =>
    sum + (plan.rulePack.conditions.find(definition => definition.key === condition.conditionKey)?.checkModifier ?? 0) * condition.stacks, 0)
  const resolved = await resolveRulePackCheckV1({ rulePack: plan.rulePack, checkKey: definition.checkKey,
    attributeKey: definition.actorAttributeKey, attributes: Object.fromEntries([...plan.rulePack.attributes, ...plan.rulePack.derivedStats]
      .map(attribute => [attribute.key, Number(entity.attributes[attribute.key])])),
    seed: input.seed, nonce: `${input.operationKey}:rule`, difficulty: definition.difficulty,
    situationalModifier: conditionModifier, contestantRef: request.actorKey })
  const model = plan.rulePack.diceModels.find(model => model.key === resolved.diceModelKey)!
  const modifier = ['total-vs-target', 'opposed'].includes(resolved.mode) ? resolved.attributeModifier + resolved.situationalModifier : 0
  const check: TtrpgRuntimeCheck = { eventSequence: sequence, actorKey: request.actorKey, skill: definition.title,
    expression: `${resolved.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`,
    dice: resolved.keptDice, modifier, total: resolved.total, dc: resolved.difficulty,
    success: ttrpgDegreeSucceededV2(resolved.degree), visibility: plan.rollVisibility,
    rule: { actionKey: definition.checkKey, checkKey: resolved.checkKey, attributeKey: resolved.attributeKey,
      skillKey: definition.checkKey, skillValue: 0, diceModelKey: resolved.diceModelKey, rolledDice: resolved.dice,
      keptDice: resolved.keptDice, degree: resolved.degree, mode: resolved.mode, successes: resolved.successes,
      winnerRef: resolved.winnerRef, tiedRefs: resolved.tiedRefs, calculationTrace: resolved.calculationTrace,
      opponent: null, rollTrace: resolved.rollTrace, seedCommitment: resolved.seedCommitment,
      nonce: resolved.nonce, proofHash: resolved.proofHash, rulePackContentHash: plan.rulePackContentHash } }
  const resourceChanges = definition.resourceCosts.map(cost => {
    const before = Number(entity.attributes[`resource.${cost.resourceKey}`]), maximum = Number(entity.attributes[`resourceMax.${cost.resourceKey}`])
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(maximum) || before < cost.amount) throw new Error('[ttrpg] frozen generic resource cost unavailable')
    return { entityKey: request.actorKey, resourceKey: cost.resourceKey, before, delta: -cost.amount,
      after: before - cost.amount, maximum, proofHash: null }
  })
  return { outcome: resolved.degree, check, resourceChanges, conditionChanges: [], abilityChange: null }
}
