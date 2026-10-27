/** Shared deterministic mechanical resolution; scheduling and authority stay with the format owner. */
import type { ProductRuntimeState, RulePackV1, RuleActionDefinitionV1, TtrpgRuntimeCheck, TtrpgRuntimeRuleActionResultV1 } from '../types'
import { ttrpgAbilityStateKeyV2, consumeTtrpgAbilityV2 } from './ability-ledger'
import { resolveRulePackCheckV1, resolveRulePackDiceModelV1 } from './rule-pack'
import { ttrpgDegreeSucceededV2 } from './runtime-state'
import { assertTtrpgCheck } from './runtime-state'
import { parseTtrpgAbilityRuntimeStateV2, parseTtrpgUsagePoolStateV2 } from './ability-ledger'
import * as p from './open-contract-parse'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export type TtrpgMechanicalResultV1 = Pick<TtrpgRuntimeRuleActionResultV1, 'outcome' | 'check' | 'resourceChanges' | 'conditionChanges' | 'abilityChange'>

export function parseTtrpgMechanicalResultV1(value: unknown): TtrpgMechanicalResultV1 {
  const row = p.record(value, ['outcome', 'check', 'resourceChanges', 'conditionChanges', 'abilityChange'], 'mechanical result')
  const resourceChanges = p.list(row.resourceChanges, 'resource changes', value => {
    const r = p.record(value, ['entityKey', 'resourceKey', 'before', 'delta', 'after', 'maximum', 'proofHash'], 'resource change')
    const maximum = p.integer(r.maximum, 'resource maximum', 1, 1_000_000_000)
    return { entityKey: p.key(r.entityKey, 'resource entity'), resourceKey: p.key(r.resourceKey, 'resource key'),
      before: p.integer(r.before, 'resource before', 0, maximum), delta: p.integer(r.delta, 'resource delta', -1_000_000_000, 1_000_000_000),
      after: p.integer(r.after, 'resource after', 0, maximum), maximum, proofHash: p.nullable(r.proofHash, p.hash, 'proofHash') }
  }, 1000)
  const conditionChanges = p.list(row.conditionChanges, 'condition changes', value => {
    const r = p.record(value, ['entityKey', 'conditionKey', 'stacks', 'duration'], 'condition change')
    return { entityKey: p.key(r.entityKey, 'condition entity'), conditionKey: p.key(r.conditionKey, 'condition key'),
      stacks: p.integer(r.stacks, 'condition stacks', 0, 1000), duration: p.nullable(r.duration, (v, l) => p.integer(v, l, 0, 1_000_000), 'duration') }
  }, 1000)
  const abilityChange = row.abilityChange === null ? null : (() => {
    const r = p.record(row.abilityChange, ['stateKey', 'before', 'after', 'sharedPoolKey', 'sharedPoolBefore', 'sharedPoolAfter'], 'ability change')
    const before = parseTtrpgAbilityRuntimeStateV2(r.before), after = parseTtrpgAbilityRuntimeStateV2(r.after)
    const stateKey = ttrpgAbilityStateKeyV2(before.actorInstanceId, before.abilityKey)
    if (r.stateKey !== stateKey || after.actorInstanceId !== before.actorInstanceId || after.abilityKey !== before.abilityKey) p.fail('能力结果的复合身份不匹配')
    return { stateKey, before, after, sharedPoolKey: p.nullable(r.sharedPoolKey, p.key, 'shared pool key'),
      sharedPoolBefore: r.sharedPoolBefore === null ? null : parseTtrpgUsagePoolStateV2(r.sharedPoolBefore),
      sharedPoolAfter: r.sharedPoolAfter === null ? null : parseTtrpgUsagePoolStateV2(r.sharedPoolAfter) }
  })()
  return { outcome: p.oneOf(row.outcome, ['automatic', ...p.DEGREES], 'outcome'),
    check: row.check === null ? null : assertTtrpgCheck(row.check), resourceChanges, conditionChanges, abilityChange }
}

/** Mechanical owners alone receive final values; receipt/operation data are audit references. */
export function applyTtrpgMechanicalResultV1(state: ProductRuntimeState, result: TtrpgMechanicalResultV1): void {
  const product = state.ttrpg?.product
  if (!product?.sessionZero.completed) throw new Error('[ttrpg] mechanical state missing')
  for (const change of result.resourceChanges) {
    const entity = state.entities[change.entityKey]
    if (!entity) throw new Error(`正式规则资源目标不存在:${change.entityKey}`)
    if (entity.attributes[`resource.${change.resourceKey}`] !== change.before
      || entity.attributes[`resourceMax.${change.resourceKey}`] !== change.maximum
      || change.after !== Math.max(0, Math.min(change.maximum, change.before + change.delta))) throw new Error(`正式规则资源变化与当前状态不一致:${change.resourceKey}`)
    entity.attributes[`resource.${change.resourceKey}`] = change.after
    if (change.resourceKey === 'vigor') entity.attributes.hp = change.after
  }
  for (const change of result.conditionChanges) {
    if (!state.entities[change.entityKey]) throw new Error(`正式规则状态目标不存在:${change.entityKey}`)
    const without = (product.conditions[change.entityKey] ?? []).filter(condition => condition.conditionKey !== change.conditionKey)
    product.conditions[change.entityKey] = change.stacks > 0 ? [...without, {
      conditionKey: change.conditionKey, stacks: change.stacks, duration: change.duration }] : without
  }
  const change = result.abilityChange
  if (change) {
    if (stable(product.abilityStates[change.stateKey]) !== stable(change.before)) throw new Error('正式规则行动的能力账本基线不一致。')
    product.abilityStates[change.stateKey] = structuredClone(change.after)
    if (change.sharedPoolKey !== null) {
      if (stable(product.usagePools[change.sharedPoolKey]) !== stable(change.sharedPoolBefore) || !change.sharedPoolAfter) throw new Error('正式规则行动的共享次数池基线不一致。')
      product.usagePools[change.sharedPoolKey] = structuredClone(change.sharedPoolAfter)
    }
  }
}

export async function resolveTtrpgRuleActionMechanicalV1(input: {
  state: ProductRuntimeState
  rulePack: RulePackV1
  action: RuleActionDefinitionV1
  actorKey: string
  targetKey: string | null
  seed: string
  commandId: string
  sequence: number
  currentRound: number
  advanceConditions: boolean
  usageEventId?: string
  difficulty?: number
  situationalModifier: number
  rollVisibility: 'public' | 'gm-only'
  actorSkill: { skillKey: string; skillValue: number }
  opponentSkill: { skillKey: string; skillValue: number } | null
}): Promise<Omit<TtrpgMechanicalResultV1, 'abilityChange'> & { abilityChange: NonNullable<TtrpgMechanicalResultV1['abilityChange']> }> {
  const { state, rulePack, action, actorKey, sequence, difficulty, situationalModifier, rollVisibility, actorSkill, opponentSkill } = input
  const resolvedTargetKey = input.targetKey
  const actionKey = action.key
  const ttrpg = state.ttrpg
  const product = ttrpg?.product
  if (!ttrpg || !product?.sessionZero.completed) throw new Error('[ttrpg] mechanical resolution requires accepted Session Zero')

const resourceChanges: import("../types").TtrpgRuntimeRuleActionResultV1["resourceChanges"] =
  [];
const resourceCurrent = (
  entityKey: string,
  resourceKey: string,
): { current: number; maximum: number } => {
  const prior = [...resourceChanges]
    .reverse()
    .find(
      (item) =>
        item.entityKey === entityKey && item.resourceKey === resourceKey,
    );
  if (prior) return { current: prior.after, maximum: prior.maximum };
  const entity = state.entities[entityKey];
  const current = entity?.attributes[`resource.${resourceKey}`];
  const maximum = entity?.attributes[`resourceMax.${resourceKey}`];
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(maximum) ||
    Number(maximum) <= 0
  ) {
    throw new Error(
      `[ttrpg] 角色缺少规则资源:${entityKey}.${resourceKey}`,
    );
  }
  return { current: Number(current), maximum: Number(maximum) };
};
const addResourceChange = (
  entityKey: string,
  resourceKey: string,
  delta: number,
  proofHash: string | null,
) => {
  const { current, maximum } = resourceCurrent(entityKey, resourceKey);
  const after = Math.max(0, Math.min(maximum, current + delta));
  resourceChanges.push({
    entityKey,
    resourceKey,
    before: current,
    delta,
    after,
    maximum,
    proofHash,
  });
};
const abilityStateKey = ttrpgAbilityStateKeyV2(actorKey, actionKey);
const beforeAbility = product.abilityStates?.[abilityStateKey];
if (!beforeAbility)
  throw new Error(`[ttrpg] 角色缺少冻结能力次数账本:${abilityStateKey}`);
const sharedPoolKey = action.usage.sharedPoolKey;
const beforeSharedPool =
  sharedPoolKey == null
    ? null
    : (product.usagePools?.[sharedPoolKey] ?? null);
const abilityResource =
  action.usage.resourceKey == null
    ? null
    : resourceCurrent(actorKey, action.usage.resourceKey).current;
const abilityUse = consumeTtrpgAbilityV2({
  definition: {
    abilityKey: action.key,
    actionDefinitionKey: action.key,
    usage: action.usage,
  },
  state: beforeAbility,
  eventId: input.usageEventId ?? `event.${sequence}`,
  currentRound: input.currentRound,
  resourceCurrent: abilityResource,
  sharedPool: beforeSharedPool,
});
if (abilityUse.resourceDelta !== 0 && action.usage.resourceKey) {
  addResourceChange(
    actorKey,
    action.usage.resourceKey,
    abilityUse.resourceDelta,
    null,
  );
}
const abilityChange: import("../types").TtrpgRuntimeRuleActionResultV1["abilityChange"] =
  {
    stateKey: abilityStateKey,
    before: structuredClone(beforeAbility),
    after: abilityUse.state,
    sharedPoolKey,
    sharedPoolBefore:
      beforeSharedPool == null ? null : structuredClone(beforeSharedPool),
    sharedPoolAfter: abilityUse.sharedPool,
  };
if (action.costResourceKey && action.costAmount > 0) {
  const resource = resourceCurrent(actorKey, action.costResourceKey);
  if (resource.current < action.costAmount)
    throw new Error(`[ttrpg] ${action.name}所需资源不足。`);
  addResourceChange(
    actorKey,
    action.costResourceKey,
    -action.costAmount,
    null,
  );
}

const checkEffects = action.effects.filter(
  (effect): effect is Extract<typeof effect, { kind: "check" }> =>
    effect.kind === "check",
);
if (checkEffects.length > 1)
  throw new Error("[ttrpg] v1 规则行动最多包含一个检定效果。");
const activeConditions = product.conditions[actorKey] ?? [];
const conditionModifier = activeConditions.reduce((sum, condition) => {
  const definition = rulePack.conditions.find(
    (item) => item.key === condition.conditionKey,
  );
  return sum + (definition?.checkModifier ?? 0) * condition.stacks;
}, 0);
let check: TtrpgRuntimeCheck | null = null;
let outcome: import("../types").TtrpgRuntimeRuleActionResultV1["outcome"] =
  "automatic";
if (checkEffects[0]) {
  const effect = checkEffects[0];
  const resolution = await resolveRulePackCheckV1({
    rulePack,
    checkKey: effect.checkKey,
    attributeKey: effect.attributeKey,
    attributes: Object.fromEntries(
      [...rulePack.attributes, ...rulePack.derivedStats].map(
        (attribute) => [
          attribute.key,
          Number(state.entities[actorKey]?.attributes[attribute.key]),
        ],
      ),
    ),
    seed: input.seed,
    nonce: `${input.commandId}:${sequence}:${actionKey}`,
    difficulty,
    situationalModifier:
      situationalModifier + conditionModifier + actorSkill.skillValue,
    contestantRef: actorKey,
    opponent:
      resolvedTargetKey == null
        ? undefined
        : {
            contestantRef: resolvedTargetKey,
            attributeKey: effect.attributeKey,
            situationalModifier: opponentSkill?.skillValue ?? 0,
            attributes: Object.fromEntries(
              [...rulePack.attributes, ...rulePack.derivedStats].map(
                (attribute) => [
                  attribute.key,
                  Number(
                    state.entities[resolvedTargetKey]?.attributes[
                      attribute.key
                    ],
                  ),
                ],
              ),
            ),
          },
  });
  const model = rulePack.diceModels.find(
    (item) => item.key === resolution.diceModelKey,
  )!;
  const modifier = ["total-vs-target", "opposed"].includes(
    resolution.mode,
  )
    ? resolution.attributeModifier + resolution.situationalModifier
    : 0;
  const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
  outcome = resolution.degree;
  check = {
    eventSequence: sequence,
    actorKey,
    skill: action.name,
    expression,
    dice: resolution.keptDice,
    modifier,
    total: resolution.total,
    dc: resolution.difficulty,
    success: ttrpgDegreeSucceededV2(resolution.degree),
    visibility: rollVisibility,
    rule: {
      actionKey,
      checkKey: resolution.checkKey,
      attributeKey: resolution.attributeKey,
      skillKey: actorSkill.skillKey,
      skillValue: actorSkill.skillValue,
      diceModelKey: resolution.diceModelKey,
      rolledDice: resolution.dice,
      keptDice: resolution.keptDice,
      degree: resolution.degree,
      mode: resolution.mode,
      successes: resolution.successes,
      winnerRef: resolution.winnerRef,
      tiedRefs: resolution.tiedRefs,
      calculationTrace: resolution.calculationTrace,
      opponent:
        resolution.opponent == null
          ? null
          : {
              contestantRef: resolution.opponent.contestantRef,
              attributeKey: resolution.opponent.attributeKey,
              rolledDice: resolution.opponent.dice,
              keptDice: resolution.opponent.keptDice,
              attributeModifier: resolution.opponent.attributeModifier,
              total: resolution.opponent.total,
              degree: resolution.opponent.degree,
              rollTrace: resolution.opponent.rollTrace,
              proofHash: resolution.opponent.proofHash,
            },
      rollTrace: resolution.rollTrace,
      seedCommitment: resolution.seedCommitment,
      nonce: resolution.nonce,
      proofHash: resolution.proofHash,
      rulePackContentHash: product.rulePackContentHash,
    },
  };
}
const effectSucceeded = check == null || check.success;
const conditionChanges: import("../types").TtrpgRuntimeRuleActionResultV1["conditionChanges"] =
  [];
for (const [effectIndex, effect] of action.effects.entries()) {
  if (effect.kind === "check") continue;
  const shouldApply = effect.appliesOnDegrees
    ? effect.appliesOnDegrees.includes(outcome)
    : effectSucceeded;
  if (!shouldApply) continue;
  const effectTargetKey =
    effect.targetScope === "actor"
      ? actorKey
      : (resolvedTargetKey ?? actorKey);
  if (effect.kind === "resource") {
    addResourceChange(
      effectTargetKey,
      effect.resourceKey,
      effect.delta,
      null,
    );
  } else if (effect.kind === "damage") {
    const modifier =
      effect.modifierAttributeKey == null
        ? 0
        : Number(
            state.entities[actorKey].attributes[
              effect.modifierAttributeKey
            ],
          );
    if (!Number.isFinite(modifier))
      throw new Error(
        `[ttrpg] 伤害修正属性无效:${effect.modifierAttributeKey}`,
      );
    const damage = await resolveRulePackDiceModelV1({
      rulePack,
      diceModelKey: effect.diceModelKey,
      seed: input.seed,
      nonce: `${input.commandId}:${sequence}:${actionKey}:damage:${effectIndex}`,
      modifier,
    });
    addResourceChange(
      effectTargetKey,
      effect.resourceKey,
      -Math.max(0, damage.total),
      damage.proofHash,
    );
  } else if (effect.kind === "condition") {
    const definition = rulePack.conditions.find(
      (item) => item.key === effect.conditionKey,
    )!;
    const existing = product.conditions[effectTargetKey]?.find(
      (item) => item.conditionKey === effect.conditionKey,
    );
    const stacks =
      definition.stacking === "replace"
        ? Math.min(definition.maximumStacks, effect.stacks)
        : Math.min(
            definition.maximumStacks,
            (existing?.stacks ?? 0) + effect.stacks,
          );
    conditionChanges.push({
      entityKey: effectTargetKey,
      conditionKey: effect.conditionKey,
      stacks,
      duration: definition.defaultDurationRounds,
    });
  }
}
const completesTurn = input.advanceConditions;
if (completesTurn) {
  for (const condition of activeConditions) {
    if (condition.duration == null) continue;
    const duration = condition.duration - 1;
    conditionChanges.push({
      entityKey: actorKey,
      conditionKey: condition.conditionKey,
      stacks: duration > 0 ? condition.stacks : 0,
      duration: duration > 0 ? duration : null,
    });
  }
}
return { outcome, check, resourceChanges, conditionChanges, abilityChange }
}
