import type {
  TtrpgOpenEffectPrimitiveV1, TtrpgOpenEffectPlanTemplateV1, TtrpgOpenDynamicEntityTemplateV1,
  TtrpgOpenEntityBindingV1, TtrpgOpenCompanionPolicyV1, TtrpgOpenStageClosurePolicyV1, TtrpgOpenRuntimePolicyV1,
} from './open-contract'
import * as p from './open-contract-parse'
import { parsePredicate, sourceField } from './open-content-predicates'
import { TTRPG_OPEN_STORY_EFFECT_OPERATIONS_V1 } from './open-contract'

const ENTITY_KINDS = ['actor', 'location', 'item'] as const
export function effect(value: unknown, label: string): TtrpgOpenEffectPrimitiveV1 {
  const r = p.object(value, label)
  const common = ['effectKey', 'family', 'operation', 'targetRef']
  const effectKey = p.key(r.effectKey, label), targetRef = p.key(r.targetRef, label)
  switch (r.family) {
    case 'numeric':
      p.exact(r, [...common, 'valueKey', 'amount'], label)
      return { effectKey, targetRef, family: r.family,
        operation: p.oneOf(r.operation, ['resource.gain', 'resource.spend', 'resource.set', 'damage', 'healing', 'stress', 'currency'], label),
        valueKey: p.key(r.valueKey, label), amount: p.number(r.amount, label) }
    case 'condition': {
      p.exact(r, [...common, 'conditionKey', 'stacks', 'duration'], label)
      const operation = p.oneOf(r.operation, ['condition.apply', 'condition.remove'], label)
      return { effectKey, targetRef, family: r.family, operation,
        conditionKey: p.key(r.conditionKey, label), stacks: p.integer(r.stacks, label, operation === 'condition.apply' ? 1 : 0, 100),
        duration: p.nullable(r.duration, (v, l) => p.integer(v, l, 1, 10_000), label) }
    }
    case 'item': {
      p.exact(r, [...common, 'itemDefinitionRef', 'itemInstanceRef', 'destinationRef', 'amount'], label)
      const result = { effectKey, targetRef, family: r.family, operation: p.oneOf(r.operation, ['item.grant', 'item.remove', 'item.transfer', 'item.use', 'item.damage', 'item.repair', 'item.equip'], label),
        itemDefinitionRef: p.nullable(r.itemDefinitionRef, p.key, label), itemInstanceRef: p.nullable(r.itemInstanceRef, p.key, label),
        destinationRef: p.nullable(r.destinationRef, p.key, label), amount: p.integer(r.amount, label, 1, 100_000) }
      if (result.operation === 'item.grant' ? result.itemDefinitionRef === null : result.itemInstanceRef === null) p.fail(`${label}: 缺物品定义/实例引用`)
      if ((result.operation === 'item.transfer') !== (result.destinationRef !== null)) p.fail(`${label}: transfer destination 无效`)
      return result
    }
    case 'ability': {
      p.exact(r, [...common, 'abilityKey', 'amount', 'clockRef'], label)
      const operation = p.oneOf(r.operation, ['ability.unlock', 'ability.disable', 'usage.consume', 'usage.restore', 'usage.reset', 'cooldown.start', 'cooldown.clear'], label)
      const amount = p.nullable(r.amount, (v, l) => p.integer(v, l, 0, 100_000), label), clockRef = p.nullable(r.clockRef, p.key, label)
      if ((operation === 'usage.consume' || operation === 'usage.restore') && (amount === null || amount < 1)) p.fail(`${label}: usage 必须有正 amount`)
      if (operation === 'cooldown.start' && clockRef === null) p.fail(`${label}: cooldown.start 缺 clockRef`)
      return { effectKey, targetRef, family: r.family, operation, abilityKey: p.key(r.abilityKey, label), amount, clockRef }
    }
    case 'advancement':
      p.exact(r, [...common, 'advancementKey', 'amount'], label)
      return { effectKey, targetRef, family: r.family, operation: p.oneOf(r.operation, ['xp', 'milestone', 'level', 'rank', 'attribute-points', 'skill-points', 'advancement.choice'], label),
        advancementKey: p.key(r.advancementKey, label), amount: p.integer(r.amount, label) }
    case 'social':
      p.exact(r, [...common, 'socialKey', 'amount'], label)
      return { effectKey, targetRef, family: r.family, operation: p.oneOf(r.operation, ['reputation', 'faction', 'relationship', 'wanted', 'debt'], label),
        socialKey: p.key(r.socialKey, label), amount: p.number(r.amount, label) }
    case 'story':
      p.exact(r, [...common, 'storyKey', 'value'], label)
      return { effectKey, targetRef, family: r.family,
        // Pressure clocks and evidence have their own owners in open content.
        operation: p.oneOf(r.operation, TTRPG_OPEN_STORY_EFFECT_OPERATIONS_V1, label),
        storyKey: p.key(r.storyKey, label), value: p.nullable(r.value, p.scalar, label) }
    case 'knowledge':
      p.exact(r, [...common, 'evidenceRef'], label)
      return { effectKey, targetRef, family: r.family, operation: p.literal(r.operation, 'knowledge.discover', label), evidenceRef: p.key(r.evidenceRef, label) }
    default: return p.fail(`${label}: 未知 effect family`)
  }
}
export function effectTemplate(value: unknown, label: string): TtrpgOpenEffectPlanTemplateV1 {
  const r = p.record(value, ['planKey', 'degree', 'ruleRef', 'reason', 'audience', 'parameters', 'effects', 'alternatives'], label)
  const parameters = p.list(r.parameters, label, (v, l) => {
    const a = p.record(v, ['parameterKey', 'entityKinds', 'allowedRefs', 'allowDynamicFromTemplateKeys', 'required'], l)
    const allowedRefs = p.keys(a.allowedRefs, l), allowDynamicFromTemplateKeys = p.keys(a.allowDynamicFromTemplateKeys, l)
    if (!allowedRefs.length && !allowDynamicFromTemplateKeys.length) p.fail(`${l}: 参数没有允许来源`)
    return { parameterKey: p.key(a.parameterKey, l),
      entityKinds: p.unique(p.list(a.entityKinds, l, (v, l) => p.oneOf(v, ENTITY_KINDS, l), 3, 1), l),
      allowedRefs, allowDynamicFromTemplateKeys, required: p.bool(a.required, l) }
  }, 32)
  p.unique(parameters.map(a => a.parameterKey), label)
  const effects = p.list(r.effects, label, effect, 100)
  const alternatives = p.list(r.alternatives, label, (v, l) => {
    const a = p.record(v, ['alternativeKey', 'title', 'effects'], l)
    const effects = p.list(a.effects, l, effect, 100, 1); p.unique(effects.map(e => e.effectKey), l)
    return { alternativeKey: p.key(a.alternativeKey, l), title: p.text(a.title, l, 300), effects }
  }, 20)
  if ((!effects.length && alternatives.length < 2) || (effects.length > 0 && alternatives.length > 0)) p.fail(`${label}: immediate effects 或至少两个 alternatives 必须二选一`)
  p.unique(effects.map(e => e.effectKey), label); p.unique(alternatives.map(a => a.alternativeKey), label)
  return { planKey: p.key(r.planKey, label), degree: p.oneOf(r.degree, p.DEGREES, label), ruleRef: p.key(r.ruleRef, label),
    reason: p.text(r.reason, label), audience: p.effectAudience(r.audience, label), parameters, effects, alternatives }
}
export function dynamicTemplate(value: unknown, label: string): TtrpgOpenDynamicEntityTemplateV1 {
  const r = p.record(value, ['templateKey', 'kind', 'characterTemplateKey', 'itemDefinitionKey', 'description', 'parameters', 'maximumNameLength', 'maximumInstances', 'audience', 'knownByActorKeys', 'sourceRefs'], label)
  const kind = p.oneOf(r.kind, ENTITY_KINDS, label)
  const characterTemplateKey = p.nullable(r.characterTemplateKey, p.key, label), itemDefinitionKey = p.nullable(r.itemDefinitionKey, p.key, label)
  if ((kind === 'actor') !== (characterTemplateKey !== null) || (kind === 'item') !== (itemDefinitionKey !== null)) p.fail(`${label}: 模板 kind/机械定义不一致`)
  const parameters = p.list(r.parameters, label, (v, l) => {
    const a = p.record(v, ['parameterKey', 'allowedValues', 'required'], l)
    return { parameterKey: p.key(a.parameterKey, l), allowedValues: p.texts(a.allowedValues, l, 100, 1), required: p.bool(a.required, l) }
  }, 32)
  p.unique(parameters.map(a => a.parameterKey), label)
  const audience = p.oneOf(r.audience, p.AUDIENCES, label), knownByActorKeys = p.keys(r.knownByActorKeys, label)
  p.recipients(audience, knownByActorKeys, label)
  return { templateKey: p.key(r.templateKey, label), kind, characterTemplateKey, itemDefinitionKey,
    description: p.text(r.description, label), parameters, maximumNameLength: p.integer(r.maximumNameLength, label, 1, 300),
    maximumInstances: p.integer(r.maximumInstances, label, 1, 100), audience, knownByActorKeys, sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
export function entityBinding(value: unknown, label: string): TtrpgOpenEntityBindingV1 {
  const r = p.record(value, ['bindingKey', 'sourceResourceRef', 'kind', 'templateKey', 'initialLocationRef', 'initialInventoryRefs', 'sourceFieldRefs', 'audience', 'knownByActorKeys'], label)
  const result: TtrpgOpenEntityBindingV1 = {
    bindingKey: p.key(r.bindingKey, label), sourceResourceRef: p.nullable(r.sourceResourceRef, p.key, label),
    kind: p.oneOf(r.kind, ENTITY_KINDS, label), templateKey: p.key(r.templateKey, label),
    initialLocationRef: p.nullable(r.initialLocationRef, p.key, label), initialInventoryRefs: p.keys(r.initialInventoryRefs, label),
    sourceFieldRefs: p.list(r.sourceFieldRefs, label, sourceField), audience: p.oneOf(r.audience, p.AUDIENCES, label),
    knownByActorKeys: p.keys(r.knownByActorKeys, label),
  }
  p.recipients(result.audience, result.knownByActorKeys, label)
  if (result.kind === 'actor' && result.initialLocationRef === null) p.fail(`${label}: actor 必须有初始地点`)
  if (result.kind !== 'actor' && result.initialInventoryRefs.length) p.fail(`${label}: 只有 actor 可以持有物品`)
  if (result.sourceResourceRef === null ? result.sourceFieldRefs.length > 0 : !result.sourceFieldRefs.some(f => f.resourceKey === result.sourceResourceRef)) p.fail(`${label}: sourceResourceRef/字段来源不闭合`)
  return result
}
export function companionPolicy(value: unknown, label: string): TtrpgOpenCompanionPolicyV1 {
  const r = p.record(value, ['minimumCompanions', 'maximumCompanions', 'preauthorizedActionKinds', 'confirmationRequiredKinds', 'approvalBindings'], label)
  const minimumCompanions = p.integer(r.minimumCompanions, label, 2, 5)
  const maximumCompanions = p.integer(r.maximumCompanions, label, minimumCompanions, 5)
  // A draft may have no bindings yet, but every supplied binding must be complete.
  const approvalBindings = p.list(r.approvalBindings, `${label}.approvalBindings`, (value, label) => {
    const binding = p.record(value, ['companionActorKey', 'approverSeatKeys', 'partyResourceApprovalAllowed'], label)
    return {
      companionActorKey: p.key(binding.companionActorKey, `${label}.companionActorKey`),
      approverSeatKeys: p.keys(binding.approverSeatKeys, `${label}.approverSeatKeys`, 20, 1),
      partyResourceApprovalAllowed: p.bool(binding.partyResourceApprovalAllowed, `${label}.partyResourceApprovalAllowed`),
    }
  }, maximumCompanions)
  p.unique(approvalBindings.map(binding => binding.companionActorKey), `${label}.approvalBindings`)
  return { minimumCompanions, maximumCompanions, approvalBindings,
    preauthorizedActionKinds: p.unique(p.list(r.preauthorizedActionKinds, label, (v, l) => p.oneOf(v, ['observe', 'talk', 'assist', 'move', 'low-risk-check'], l), 5), label),
    confirmationRequiredKinds: p.unique(p.list(r.confirmationRequiredKinds, label, (v, l) => p.oneOf(v, ['irreversible', 'resource-spend', 'party-relation-change', 'secret-reveal'], l), 4, 4), label) }
}
export function closurePolicy(value: unknown, label: string): TtrpgOpenStageClosurePolicyV1 {
  const r = p.record(value, ['triggers', 'maximumWorldTurns', 'continuation'], label)
  const maximumWorldTurns = p.integer(r.maximumWorldTurns, label, 10, 1000)
  const triggers = p.list(r.triggers, label, (v, l) => {
    const t = p.record(v, ['triggerKey', 'predicate', 'summaryPrompt'], l)
    return { triggerKey: p.key(t.triggerKey, l), predicate: parsePredicate(t.predicate, l), summaryPrompt: p.text(t.summaryPrompt, l) }
  }, 100, 1)
  p.unique(triggers.map(t => t.triggerKey), label)
  return { triggers, maximumWorldTurns, continuation: p.literal(r.continuation, 'author-confirmed-opening', label) }
}
export function runtimePolicy(value: unknown, label: string): TtrpgOpenRuntimePolicyV1 {
  const r = p.record(value, ['enabled', 'maximumCallsPerEpoch', 'maxAiActions', 'maximumOutputTokens', 'maximumEpochTokens', 'maximumEpochCostUsd', 'maximumRepairAttempts', 'failurePolicy', 'unknownResultPolicy', 'outputMode'], label)
  const maximumOutputTokens = p.integer(r.maximumOutputTokens, label, 1, 100_000)
  return { enabled: p.bool(r.enabled, label), maximumCallsPerEpoch: p.integer(r.maximumCallsPerEpoch, label, 1, 9),
    maxAiActions: p.integer(r.maxAiActions, label, 0, 5), maximumOutputTokens,
    maximumEpochTokens: p.integer(r.maximumEpochTokens, label, maximumOutputTokens, 1_000_000),
    maximumEpochCostUsd: p.number(r.maximumEpochCostUsd, label, 0, 1000), maximumRepairAttempts: p.integer(r.maximumRepairAttempts, label, 0, 3),
    failurePolicy: p.literal(r.failurePolicy, 'pause', label), unknownResultPolicy: p.literal(r.unknownResultPolicy, 'pause-and-reconcile', label),
    outputMode: p.literal(r.outputMode, 'text', label) }
}
