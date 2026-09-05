import type {
  TextOpenWorldConditionDefinitionV1,
  TextOpenWorldConditionEvaluationContextV1,
  TextOpenWorldConditionEvaluationV1,
  TextOpenWorldConditionExpressionV1,
  TextOpenWorldNumberComparatorV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type Row = Record<string, unknown>
type ReferenceCatalog = ReturnType<typeof references>

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const COMPARATORS: TextOpenWorldNumberComparatorV1[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte']
const QUEST_STATUSES = ['locked', 'available', 'active', 'completed', 'failed', 'expired', 'abandoned'] as const
const MAX_DEPTH = 12
const MAX_NODES = 256
const MAX_GROUP_CHILDREN = 64

function fail(message: string): never { throw new Error(`[text-open-world-condition] ${message}`) }
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Row
}
function exact(value: Row, fields: readonly string[], label: string) {
  const expected = [...fields].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`)
}
function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label}不是稳定key`)
  return value
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(`${label}无效`)
  return value.trim()
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label}必须是boolean`); return value }
function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) fail(`${label}必须是有限数值`)
  return value
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}无效`)
  return value as T
}
function ref(value: unknown, set: ReadonlySet<string>, label: string): string {
  const parsed = key(value, label)
  if (!set.has(parsed)) fail(`${label}引用不存在:${parsed}`)
  return parsed
}
function scalar(value: unknown, label: string): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return numberValue(value, label)
  if (typeof value === 'string' && value.length <= 1000) return value.normalize('NFC')
  fail(`${label}必须是JSON标量`)
}

function references(modules: TextOpenWorldParsedModulesV1) {
  const set = (items: Array<{ key: string }>) => new Set(items.map(item => item.key))
  return {
    items: set(modules.items.items), recipes: set(modules.crafting.recipes), quests: set(modules.quests.quests),
    questStages: set(modules.quests.stages), objectives: set(modules.quests.objectives), locations: set(modules.world.locations),
    regions: set(modules.world.regions), travelPoints: set(modules.world.fastTravelPoints), edges: set(modules.world.edges),
    timePeriods: set(modules['time-weather'].timePeriods), weather: set(modules['time-weather'].weather),
    factions: set(modules.actors.factions), actors: set(modules.actors.actors), endings: set(modules.narrative.endings),
    knowledge: set(modules.knowledge.entries), rumors: set(modules.knowledge.rumors), achievements: set(modules.knowledge.achievements),
    questStageOwner: new Map(modules.quests.stages.map(item => [item.key, item.questKey])),
  }
}

function parseExpression(value: unknown, refs: ReferenceCatalog, depth: number, budget: { nodes: number }, label: string): TextOpenWorldConditionExpressionV1 {
  if (depth > MAX_DEPTH) fail(`${label}超过最大深度${MAX_DEPTH}`)
  budget.nodes += 1
  if (budget.nodes > MAX_NODES) fail(`${label}超过最大节点数${MAX_NODES}`)
  const parsed = row(value, label)
  const op = typeof parsed.op === 'string' ? parsed.op : fail(`${label}.op无效`)
  if (op === 'all' || op === 'any') {
    exact(parsed, ['op', 'conditions'], label)
    if (!Array.isArray(parsed.conditions) || parsed.conditions.length < 1 || parsed.conditions.length > MAX_GROUP_CHILDREN) fail(`${label}.conditions必须包含1到${MAX_GROUP_CHILDREN}项`)
    return { op, conditions: parsed.conditions.map((item, index) => parseExpression(item, refs, depth + 1, budget, `${label}.conditions[${index}]`)) }
  }
  if (op === 'not') {
    exact(parsed, ['op', 'condition'], label)
    return { op, condition: parseExpression(parsed.condition, refs, depth + 1, budget, `${label}.condition`) }
  }
  if (op === 'player-number') {
    exact(parsed, ['op', 'field', 'comparator', 'value'], label)
    return { op, field: enumValue(parsed.field, ['level', 'experience', 'health', 'maximum-health', 'morality', 'power', 'vitality', 'agility'], `${label}.field`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'player-status') {
    exact(parsed, ['op', 'statusKey', 'present'], label)
    return { op, statusKey: key(parsed.statusKey, `${label}.statusKey`), present: bool(parsed.present, `${label}.present`) }
  }
  if (op === 'inventory-quantity') {
    exact(parsed, ['op', 'itemKey', 'comparator', 'value'], label)
    return { op, itemKey: ref(parsed.itemKey, refs.items, `${label}.itemKey`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'inventory-currency') {
    exact(parsed, ['op', 'comparator', 'value'], label)
    return { op, comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'inventory-equipped') {
    exact(parsed, ['op', 'itemKey', 'equipped'], label)
    return { op, itemKey: ref(parsed.itemKey, refs.items, `${label}.itemKey`), equipped: bool(parsed.equipped, `${label}.equipped`) }
  }
  if (op === 'inventory-recipe-known') {
    exact(parsed, ['op', 'recipeKey', 'known'], label)
    return { op, recipeKey: ref(parsed.recipeKey, refs.recipes, `${label}.recipeKey`), known: bool(parsed.known, `${label}.known`) }
  }
  if (op === 'quest-status') {
    exact(parsed, ['op', 'questKey', 'statuses'], label)
    if (!Array.isArray(parsed.statuses) || parsed.statuses.length < 1 || parsed.statuses.length > 7) fail(`${label}.statuses无效`)
    const statuses = parsed.statuses.map((item, index) => enumValue(item, QUEST_STATUSES, `${label}.statuses[${index}]`))
    if (new Set(statuses).size !== statuses.length) fail(`${label}.statuses不能重复`)
    return { op, questKey: ref(parsed.questKey, refs.quests, `${label}.questKey`), statuses }
  }
  if (op === 'quest-stage') {
    exact(parsed, ['op', 'questKey', 'stageKey'], label)
    const questKey = ref(parsed.questKey, refs.quests, `${label}.questKey`)
    const stageKey = ref(parsed.stageKey, refs.questStages, `${label}.stageKey`)
    if (refs.questStageOwner.get(stageKey) !== questKey) fail(`${label}.stageKey不属于questKey`)
    return { op, questKey, stageKey }
  }
  if (op === 'quest-objective') {
    exact(parsed, ['op', 'objectiveKey', 'status'], label)
    return { op, objectiveKey: ref(parsed.objectiveKey, refs.objectives, `${label}.objectiveKey`), status: enumValue(parsed.status, ['inactive', 'active', 'completed', 'failed'], `${label}.status`) }
  }
  if (op === 'quest-result-tag') {
    exact(parsed, ['op', 'tag', 'present'], label)
    return { op, tag: key(parsed.tag, `${label}.tag`), present: bool(parsed.present, `${label}.present`) }
  }
  if (op === 'map-location') {
    exact(parsed, ['op', 'locationKey'], label)
    return { op, locationKey: ref(parsed.locationKey, refs.locations, `${label}.locationKey`) }
  }
  if (op === 'map-region-knowledge') {
    exact(parsed, ['op', 'regionKey', 'minimum'], label)
    return { op, regionKey: ref(parsed.regionKey, refs.regions, `${label}.regionKey`), minimum: enumValue(parsed.minimum, ['unknown', 'heard', 'visited', 'familiar'], `${label}.minimum`) }
  }
  if (op === 'map-fast-travel') {
    exact(parsed, ['op', 'fastTravelPointKey', 'unlocked'], label)
    return { op, fastTravelPointKey: ref(parsed.fastTravelPointKey, refs.travelPoints, `${label}.fastTravelPointKey`), unlocked: bool(parsed.unlocked, `${label}.unlocked`) }
  }
  if (op === 'map-edge') {
    exact(parsed, ['op', 'edgeKey', 'open'], label)
    return { op, edgeKey: ref(parsed.edgeKey, refs.edges, `${label}.edgeKey`), open: bool(parsed.open, `${label}.open`) }
  }
  if (op === 'time-number') {
    exact(parsed, ['op', 'field', 'comparator', 'value'], label)
    return { op, field: enumValue(parsed.field, ['world-minute', 'day'], `${label}.field`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'time-period') {
    exact(parsed, ['op', 'timePeriodKey'], label)
    return { op, timePeriodKey: ref(parsed.timePeriodKey, refs.timePeriods, `${label}.timePeriodKey`) }
  }
  if (op === 'time-weather') {
    exact(parsed, ['op', 'weatherKey'], label)
    return { op, weatherKey: ref(parsed.weatherKey, refs.weather, `${label}.weatherKey`) }
  }
  if (op === 'time-deadline') {
    exact(parsed, ['op', 'deadlineKey', 'relation'], label)
    return { op, deadlineKey: key(parsed.deadlineKey, `${label}.deadlineKey`), relation: enumValue(parsed.relation, ['before', 'at-or-before', 'after', 'at-or-after'], `${label}.relation`) }
  }
  if (op === 'relation-faction-affinity') {
    exact(parsed, ['op', 'factionKey', 'comparator', 'value'], label)
    return { op, factionKey: ref(parsed.factionKey, refs.factions, `${label}.factionKey`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'relation-attitude') {
    exact(parsed, ['op', 'actorKey', 'attitude'], label)
    return { op, actorKey: ref(parsed.actorKey, refs.actors, `${label}.actorKey`), attitude: enumValue(parsed.attitude, ['bad', 'neutral', 'good'], `${label}.attitude`) }
  }
  if (op === 'relation-story-modifier') {
    exact(parsed, ['op', 'actorKey', 'comparator', 'value'], label)
    return { op, actorKey: ref(parsed.actorKey, refs.actors, `${label}.actorKey`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'actor-boolean') {
    exact(parsed, ['op', 'actorKey', 'field', 'value'], label)
    return { op, actorKey: ref(parsed.actorKey, refs.actors, `${label}.actorKey`), field: enumValue(parsed.field, ['present', 'alive', 'protected'], `${label}.field`), value: bool(parsed.value, `${label}.value`) }
  }
  if (op === 'actor-schedule') {
    exact(parsed, ['op', 'actorKey', 'state'], label)
    return { op, actorKey: ref(parsed.actorKey, refs.actors, `${label}.actorKey`), state: text(parsed.state, `${label}.state`) }
  }
  if (op === 'world-flag') {
    exact(parsed, ['op', 'flagKey', 'value'], label)
    return { op, flagKey: key(parsed.flagKey, `${label}.flagKey`), value: scalar(parsed.value, `${label}.value`) }
  }
  if (op === 'world-region-pressure') {
    exact(parsed, ['op', 'regionKey', 'comparator', 'value'], label)
    return { op, regionKey: ref(parsed.regionKey, refs.regions, `${label}.regionKey`), comparator: enumValue(parsed.comparator, COMPARATORS, `${label}.comparator`), value: numberValue(parsed.value, `${label}.value`) }
  }
  if (op === 'world-faction-state') {
    exact(parsed, ['op', 'factionKey', 'state'], label)
    return { op, factionKey: ref(parsed.factionKey, refs.factions, `${label}.factionKey`), state: text(parsed.state, `${label}.state`) }
  }
  if (op === 'world-ending-eligible') {
    exact(parsed, ['op', 'endingKey', 'eligible'], label)
    return { op, endingKey: ref(parsed.endingKey, refs.endings, `${label}.endingKey`), eligible: bool(parsed.eligible, `${label}.eligible`) }
  }
  if (op === 'knowledge-visibility') {
    exact(parsed, ['op', 'knowledgeKey', 'minimum'], label)
    return { op, knowledgeKey: ref(parsed.knowledgeKey, refs.knowledge, `${label}.knowledgeKey`), minimum: enumValue(parsed.minimum, ['hidden', 'rumor', 'known'], `${label}.minimum`) }
  }
  if (op === 'knowledge-rumor-read') {
    exact(parsed, ['op', 'rumorKey', 'read'], label)
    return { op, rumorKey: ref(parsed.rumorKey, refs.rumors, `${label}.rumorKey`), read: bool(parsed.read, `${label}.read`) }
  }
  if (op === 'knowledge-achievement') {
    exact(parsed, ['op', 'achievementKey', 'earned'], label)
    return { op, achievementKey: ref(parsed.achievementKey, refs.achievements, `${label}.achievementKey`), earned: bool(parsed.earned, `${label}.earned`) }
  }
  fail(`${label}.op不在白名单:${op}`)
}

function compare(actual: number, comparator: TextOpenWorldNumberComparatorV1, expected: number): boolean {
  if (!Number.isFinite(actual)) return false
  if (comparator === 'eq') return actual === expected
  if (comparator === 'neq') return actual !== expected
  if (comparator === 'lt') return actual < expected
  if (comparator === 'lte') return actual <= expected
  if (comparator === 'gt') return actual > expected
  return actual >= expected
}

function evaluate(expression: TextOpenWorldConditionExpressionV1, context: TextOpenWorldConditionEvaluationContextV1): boolean {
  switch (expression.op) {
    case 'all': return expression.conditions.every(item => evaluate(item, context))
    case 'any': return expression.conditions.some(item => evaluate(item, context))
    case 'not': return !evaluate(expression.condition, context)
    case 'player-number': {
      const values = {
        level: context.player.level, experience: context.player.experience, health: context.player.health,
        'maximum-health': context.player.maximumHealth, morality: context.player.morality,
        power: context.player.attributes.power, vitality: context.player.attributes.vitality, agility: context.player.attributes.agility,
      }
      return compare(values[expression.field], expression.comparator, expression.value)
    }
    case 'player-status': return context.player.statusKeys.includes(expression.statusKey) === expression.present
    case 'inventory-quantity': return compare(context.inventory.itemQuantities[expression.itemKey] ?? 0, expression.comparator, expression.value)
    case 'inventory-currency': return compare(context.inventory.currency, expression.comparator, expression.value)
    case 'inventory-equipped': return context.inventory.equippedItemKeys.includes(expression.itemKey) === expression.equipped
    case 'inventory-recipe-known': return context.inventory.knownRecipeKeys.includes(expression.recipeKey) === expression.known
    case 'quest-status': return expression.statuses.includes(context.quests.statusByQuestKey[expression.questKey] ?? 'locked')
    case 'quest-stage': return context.quests.stageByQuestKey[expression.questKey] === expression.stageKey
    case 'quest-objective': return (context.quests.objectiveStatusByKey[expression.objectiveKey] ?? 'inactive') === expression.status
    case 'quest-result-tag': return context.quests.resultTags.includes(expression.tag) === expression.present
    case 'map-location': return context.map.currentLocationKey === expression.locationKey
    case 'map-region-knowledge': {
      const rank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
      return rank[context.map.regionKnowledgeByKey[expression.regionKey] ?? 'unknown'] >= rank[expression.minimum]
    }
    case 'map-fast-travel': return context.map.unlockedFastTravelPointKeys.includes(expression.fastTravelPointKey) === expression.unlocked
    case 'map-edge': return context.map.openEdgeKeys.includes(expression.edgeKey) === expression.open
    case 'time-number': {
      const value = expression.field === 'world-minute' ? context.time.worldMinute : Math.floor(context.time.worldMinute / context.time.minutesPerDay) + 1
      return compare(value, expression.comparator, expression.value)
    }
    case 'time-period': return context.time.timePeriodKey === expression.timePeriodKey
    case 'time-weather': return context.time.weatherKey === expression.weatherKey
    case 'time-deadline': {
      const deadline = context.time.deadlineWorldMinuteByKey[expression.deadlineKey]
      if (!Number.isFinite(deadline)) return false
      if (expression.relation === 'before') return context.time.worldMinute < deadline
      if (expression.relation === 'at-or-before') return context.time.worldMinute <= deadline
      if (expression.relation === 'after') return context.time.worldMinute > deadline
      return context.time.worldMinute >= deadline
    }
    case 'relation-faction-affinity': return compare(context.relations.factionAffinityByKey[expression.factionKey] ?? 0, expression.comparator, expression.value)
    case 'relation-attitude': return (context.relations.attitudeByActorKey[expression.actorKey] ?? 'neutral') === expression.attitude
    case 'relation-story-modifier': return compare(context.relations.storyModifierByActorKey[expression.actorKey] ?? 0, expression.comparator, expression.value)
    case 'actor-boolean': return context.actors[expression.actorKey] != null && context.actors[expression.actorKey][expression.field] === expression.value
    case 'actor-schedule': return context.actors[expression.actorKey]?.scheduleState === expression.state
    case 'world-flag': return Object.prototype.hasOwnProperty.call(context.world.flags, expression.flagKey) && Object.is(context.world.flags[expression.flagKey], expression.value)
    case 'world-region-pressure': return compare(context.world.regionPressureByKey[expression.regionKey] ?? 0, expression.comparator, expression.value)
    case 'world-faction-state': return context.world.factionStateByKey[expression.factionKey] === expression.state
    case 'world-ending-eligible': return Object.prototype.hasOwnProperty.call(context.world.endingEligibleByKey, expression.endingKey) && context.world.endingEligibleByKey[expression.endingKey] === expression.eligible
    case 'knowledge-visibility': {
      const rank = { hidden: 0, rumor: 1, known: 2 }
      return rank[context.knowledge.visibilityByKey[expression.knowledgeKey] ?? 'hidden'] >= rank[expression.minimum]
    }
    case 'knowledge-rumor-read': return context.knowledge.readRumorKeys.includes(expression.rumorKey) === expression.read
    case 'knowledge-achievement': return context.knowledge.earnedAchievementKeys.includes(expression.achievementKey) === expression.earned
  }
}

export interface TextOpenWorldConditionCatalogV1 {
  list(): TextOpenWorldConditionDefinitionV1[]
  get(conditionKey: string): TextOpenWorldConditionDefinitionV1 | null
  evaluate(conditionKey: string, context: TextOpenWorldConditionEvaluationContextV1): TextOpenWorldConditionEvaluationV1
  evaluateMany(conditionKeys: string[], context: TextOpenWorldConditionEvaluationContextV1): Record<string, TextOpenWorldConditionEvaluationV1>
}

export function createTextOpenWorldConditionCatalogV1(value: TextOpenWorldRuntimePackageV1 | string | unknown): TextOpenWorldConditionCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value)
  const refs = references(modules)
  const definitions = modules.actions.conditions.map((item, index) => ({
    key: item.key,
    expression: parseExpression(item.expression, refs, 1, { nodes: 0 }, `conditions[${index}].expression`),
    failureMessage: text(item.failureMessage, `conditions[${index}].failureMessage`),
  }))
  const byKey = new Map(definitions.map(item => [item.key, item]))
  const clone = (definition: TextOpenWorldConditionDefinitionV1) => structuredClone(definition)
  const evaluateOne = (conditionKey: string, context: TextOpenWorldConditionEvaluationContextV1): TextOpenWorldConditionEvaluationV1 => {
    const parsedKey = key(conditionKey, 'conditionKey')
    const definition = byKey.get(parsedKey)
    if (!definition) fail(`Condition不存在:${parsedKey}`)
    const satisfied = evaluate(definition.expression, context)
    return { conditionKey: parsedKey, satisfied, publicReason: satisfied ? null : definition.failureMessage }
  }
  return {
    list: () => definitions.map(clone),
    get: conditionKey => { const definition = byKey.get(key(conditionKey, 'conditionKey')); return definition ? clone(definition) : null },
    evaluate: evaluateOne,
    evaluateMany: (conditionKeys, context) => Object.fromEntries(conditionKeys.map(conditionKey => {
      const result = evaluateOne(conditionKey, context)
      return [result.conditionKey, result]
    })),
  }
}
