import type { NarrativeCondition, NarrativeEffect, NarrativeScalar } from '../types'
import { parseNarrativeCondition, parseNarrativeEffects } from '../narrative/blueprint'
import { parseAvgInventoryPlanV1, avgInventoryStateSlotsV1, type AvgInventoryPlanV1 } from './inventory-contract'
import { avgBoolean, avgEnum, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

export type AvgVariableV1 = { key: string; optional: boolean } & (
  | { kind: 'boolean'; initial: boolean }
  | { kind: 'number'; initial: number; minimum: number; maximum: number; integer: boolean }
  | { kind: 'enum'; initial: string; values: string[] }
  | { kind: 'string'; initial: string; maxLength: number }
)
export interface AvgSystemPlanV1 {
  schema: 'storyforge.avg.system-plan'
  version: 1
  key: string
  title: string
  storyMode: 'linear' | 'branching'
  characters: Array<{ key: string; displayName: string }>
  variables: AvgVariableV1[]
  knowledge: Array<{ factKey: string; holderKey: string; initial: boolean }>
  relationships: Array<{ characterKey: string; dimensionKey: string; initial: number; minimum: number; maximum: number }>
  entrySceneKey: string
  scenes: Array<{ key: string; kind: 'entry' | 'scene' | 'choice' | 'ending'; title: string; enterWhen: NarrativeCondition; onEnter: NarrativeEffect[] }>
  actions: Array<{ key: string; fromSceneKey: string; toSceneKey: string; label: string; description: string; unavailableReason: string; visibleWhen: NarrativeCondition; enabledWhen: NarrativeCondition; effects: NarrativeEffect[] }>
}

export type AvgSystemPlanV2 = Omit<AvgSystemPlanV1, 'version'> & { version: 2; inventory: AvgInventoryPlanV1 }
export type AvgSystemPlan = AvgSystemPlanV1 | AvgSystemPlanV2

/** Paths are generated from semantic identities, never supplied by a model or UI. */
function segment(value: unknown, label: string): string {
  const key = avgKey(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key) || ['constructor','prototype'].includes(key)) throw new Error(`[avg-system] ${label} 必须是安全路径段`)
  return key
}
export function avgVariablePathV1(key: string): string { return `avg.variables.${segment(key, 'variableKey')}` }
export function avgKnowledgePathV1(holderKey: string, factKey: string): string { return `avg.knowledge.${segment(holderKey, 'holderKey')}.${segment(factKey, 'factKey')}` }
export function avgRelationshipPathV1(characterKey: string, dimensionKey: string): string { return `avg.relationships.${segment(characterKey, 'characterKey')}.${segment(dimensionKey, 'dimensionKey')}` }

export interface AvgStateSlotV1 { path: string; definition: AvgVariableV1 }
export function avgSystemStateSlotsV1(plan: AvgSystemPlan): AvgStateSlotV1[] {
  return [
    ...(plan.version === 2 ? avgInventoryStateSlotsV1(plan.inventory, plan.characters.map(c => c.key)) : []),
    ...plan.variables.map(definition => ({ path: avgVariablePathV1(definition.key), definition })),
    ...plan.knowledge.map(fact => ({ path: avgKnowledgePathV1(fact.holderKey, fact.factKey), definition: { key: fact.factKey, kind: 'boolean' as const, initial: fact.initial, optional: false } })),
    ...plan.relationships.map(relation => ({ path: avgRelationshipPathV1(relation.characterKey, relation.dimensionKey), definition: {
      key: relation.dimensionKey, kind: 'number' as const, initial: relation.initial, minimum: relation.minimum, maximum: relation.maximum, integer: false, optional: false,
    } })),
  ]
}
export function assertAvgSlotValueV1(definition: AvgVariableV1, value: unknown): void {
  if (definition.kind === 'boolean') avgBoolean(value, definition.key)
  else if (definition.kind === 'number') avgNumber(value, definition.key, definition.minimum, definition.maximum, definition.integer)
  else if (definition.kind === 'enum') avgEnum(value, definition.values, definition.key)
  else avgText(value, definition.key, definition.maxLength, true)
}
function variable(value: unknown): AvgVariableV1 {
  if (!value || typeof value !== 'object') throw new Error('[avg-system] variable 无效')
  const kind = avgEnum((value as Record<string, unknown>).kind, ['boolean','number','enum','string'] as const, 'variable.kind')
  const extra = kind === 'number' ? ['minimum','maximum','integer'] : kind === 'enum' ? ['values'] : kind === 'string' ? ['maxLength'] : []
  const row = avgRecord(value, ['key','kind','initial','optional',...extra], 'variable')
  const common = { key: segment(row.key, 'variableKey'), optional: avgBoolean(row.optional, 'optional') }
  let result: AvgVariableV1
  if (kind === 'boolean') result = { ...common, kind, initial: avgBoolean(row.initial, 'initial') }
  else if (kind === 'number') {
    const minimum = avgNumber(row.minimum, 'minimum', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false)
    const maximum = avgNumber(row.maximum, 'maximum', minimum, Number.MAX_SAFE_INTEGER, false)
    const integer = avgBoolean(row.integer, 'integer')
    if (integer && (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum))) throw new Error('[avg-system] 整数边界无效')
    result = { ...common, kind, initial: avgNumber(row.initial, 'initial', minimum, maximum, integer), minimum, maximum, integer }
  } else if (kind === 'enum') {
    const values = avgUnique(avgList(row.values, 'enum.values', (entry, label) => avgText(entry, label, 200), 100), entry => entry, 'enum.values')
    if (!values.length) throw new Error('[avg-system] enum.values 不能为空')
    result = { ...common, kind, initial: avgEnum(row.initial, values, 'initial'), values }
  } else {
    const maxLength = avgNumber(row.maxLength, 'maxLength', 1, 10_000)
    result = { ...common, kind, maxLength, initial: avgText(row.initial, 'initial', maxLength, true) }
  }
  return result
}
function condition(value: unknown): NarrativeCondition {
  // Bound recursion before passing through the existing finite predicate codec.
  let count = 0
  const pending = [{ value, depth: 0 }]
  while (pending.length) {
    const entry = pending.pop()!
    if (++count > 256 || entry.depth > 16) throw new Error('[avg-system] 条件复杂度超限')
    if (entry.value && typeof entry.value === 'object') {
      const row = entry.value as Record<string, unknown>
      for (const key of ['all','any']) if (Array.isArray(row[key])) pending.push(...row[key].map(value => ({ value, depth: entry.depth + 1 })))
      if ('not' in row) pending.push({ value: row.not, depth: entry.depth + 1 })
    }
  }
  return parseNarrativeCondition(JSON.stringify(value))
}
function effects(value: unknown): NarrativeEffect[] {
  return parseNarrativeEffects(JSON.stringify(avgList(value, 'effects', entry => entry, 100)))
}

/** Canonical rules codec only. It grants no AI/adoption or playable-package admission. */
export function parseAvgSystemPlanV1(value: unknown): AvgSystemPlanV1 {
  const plan = parseAvgSystemPlan(value)
  if (plan.version !== 1) throw new Error('[avg-system] V1 不接受其他规则版本')
  return plan
}
export function parseAvgSystemPlan(value: unknown): AvgSystemPlan {
  const header = avgProtocolBody(value) as Record<string, unknown> | null
  const version = header?.version
  if (version !== 1 && version !== 2) throw new Error('[avg-system] 未登记 system plan schema/version')
  const row = avgRecord(avgProtocolBody(value), ['schema','version','key','title','storyMode','characters','variables','knowledge','relationships','entrySceneKey','scenes','actions',...(version === 2 ? ['inventory'] : [])], 'system plan')
  if (row.schema !== 'storyforge.avg.system-plan' || row.version !== version) throw new Error('[avg-system] 未登记 system plan schema/version')
  const characters = avgUnique(avgList(row.characters, 'characters', value => {
    const char = avgRecord(value, ['key','displayName'], 'character')
    const key = segment(char.key, 'characterKey')
    if (key === 'player') throw new Error('[avg-system] player 为玩家知识保留身份')
    return { key, displayName: avgText(char.displayName, 'displayName', 200) }
  }, 200), char => char.key, 'characters')
  const characterKeys = new Set(characters.map(char => char.key))
  const variables = avgUnique(avgList(row.variables, 'variables', variable, 500), entry => entry.key, 'variables')
  const knowledge = avgUnique(avgList(row.knowledge, 'knowledge', value => {
    const fact = avgRecord(value, ['factKey','holderKey','initial'], 'knowledge')
    const holderKey = segment(fact.holderKey, 'holderKey')
    if (holderKey !== 'player' && !characterKeys.has(holderKey)) throw new Error('[avg-system] knowledge holder 不在角色目录')
    return { factKey: segment(fact.factKey, 'factKey'), holderKey, initial: avgBoolean(fact.initial, 'initial') }
  }, 1000), fact => avgKnowledgePathV1(fact.holderKey, fact.factKey), 'knowledge')
  const relationships = avgUnique(avgList(row.relationships, 'relationships', value => {
    const relation = avgRecord(value, ['characterKey','dimensionKey','initial','minimum','maximum'], 'relationship')
    const characterKey = segment(relation.characterKey, 'characterKey')
    if (!characterKeys.has(characterKey)) throw new Error('[avg-system] relationship character 不在角色目录')
    const minimum = avgNumber(relation.minimum, 'minimum', -1_000_000, 1_000_000, false)
    const maximum = avgNumber(relation.maximum, 'maximum', minimum, 1_000_000, false)
    return { characterKey, dimensionKey: segment(relation.dimensionKey, 'dimensionKey'), minimum, maximum, initial: avgNumber(relation.initial, 'initial', minimum, maximum, false) }
  }, 1000), entry => avgRelationshipPathV1(entry.characterKey, entry.dimensionKey), 'relationships')
  const scenes = avgUnique(avgList(row.scenes, 'scenes', value => {
    const scene = avgRecord(value, ['key','kind','title','enterWhen','onEnter'], 'scene')
    return { key: avgKey(scene.key, 'sceneKey'), kind: avgEnum(scene.kind, ['entry','scene','choice','ending'] as const, 'scene.kind'), title: avgText(scene.title, 'scene.title', 200), enterWhen: condition(scene.enterWhen), onEnter: effects(scene.onEnter) }
  }, 1000), entry => entry.key, 'scenes')
  const actions = avgUnique(avgList(row.actions, 'actions', value => {
    const action = avgRecord(value, ['key','fromSceneKey','toSceneKey','label','description','unavailableReason','visibleWhen','enabledWhen','effects'], 'action')
    return { key: avgKey(action.key, 'actionKey'), fromSceneKey: avgKey(action.fromSceneKey, 'fromSceneKey'), toSceneKey: avgKey(action.toSceneKey, 'toSceneKey'),
      label: avgText(action.label, 'action.label', 1000), description: avgText(action.description, 'action.description', 2000, true), unavailableReason: avgText(action.unavailableReason, 'unavailableReason', 1000, true),
      visibleWhen: condition(action.visibleWhen), enabledWhen: condition(action.enabledWhen), effects: effects(action.effects) }
  }, 5000), entry => entry.key, 'actions')
  const base: AvgSystemPlanV1 = { schema: 'storyforge.avg.system-plan', version: 1, key: avgKey(row.key, 'planKey'), title: avgText(row.title, 'title', 200), storyMode: avgEnum(row.storyMode, ['linear','branching'] as const, 'storyMode'), characters, variables, knowledge, relationships, entrySceneKey: avgKey(row.entrySceneKey, 'entrySceneKey'), scenes, actions }
  const plan: AvgSystemPlan = version === 1 ? base : { ...base, version: 2, inventory: parseAvgInventoryPlanV1(row.inventory, { condition, effects }) }
  const slots = new Map(avgSystemStateSlotsV1(plan).map(slot => [slot.path, slot.definition]))
  const sceneKeys = new Set(scenes.map(scene => scene.key))
  const actionKeys = new Set(actions.map(action => action.key))
  const validateCondition = (predicate: NarrativeCondition): void => {
    if ('all' in predicate) predicate.all.forEach(validateCondition)
    else if ('any' in predicate) predicate.any.forEach(validateCondition)
    else if ('not' in predicate) validateCondition(predicate.not)
    else if ('visited' in predicate) { if (!sceneKeys.has(predicate.visited)) throw new Error('[avg-system] visited 引用未知场景') }
    else if ('selected' in predicate) { if (!actionKeys.has(predicate.selected)) throw new Error('[avg-system] selected 引用未知行动') }
    else if ('path' in predicate) {
      const definition = slots.get(predicate.path)
      if (!definition) throw new Error(`[avg-system] 条件引用未声明状态:${predicate.path}`)
      const values: NarrativeScalar[] = 'eq' in predicate ? [predicate.eq] : 'in' in predicate ? predicate.in : []
      for (const value of values) assertAvgSlotValueV1(definition, value)
    }
  }
  const validateEffects = (list: NarrativeEffect[]) => {
    for (const effect of list) {
      const definition = slots.get(effect.path)
      if (!definition) throw new Error(`[avg-system] 效果写入未声明状态:${effect.path}`)
      if (effect.path.startsWith('avg.inventory.actions.') || effect.path.startsWith('avg.inventory.instances.') && effect.path.endsWith('.inspected')) throw new Error('[avg-inventory] 检查/操作回执由确定性系统维护')
      if (effect.op === 'set') assertAvgSlotValueV1(definition, effect.value)
      else if (effect.op === 'unset') { if (!definition.optional) throw new Error('[avg-system] 必需状态不得 unset') }
      else if (definition.kind !== 'number' || (definition.integer && !Number.isSafeInteger(effect.value))) throw new Error('[avg-system] increment 类型不匹配')
    }
  }
  for (const scene of scenes) { validateCondition(scene.enterWhen); validateEffects(scene.onEnter) }
  for (const action of actions) { validateCondition(action.visibleWhen); validateCondition(action.enabledWhen); validateEffects(action.effects) }
  for (const action of actions) if (Object.keys(action.enabledWhen).length && !action.unavailableReason.trim()) {
    throw new Error('[avg-system] 受限行动必须提供不可用原因')
  }
  if (plan.version === 2) {
    const inventory = plan.inventory
    for (const slot of avgInventoryStateSlotsV1(inventory, characters.map(c => c.key))) assertAvgSlotValueV1(slot.definition, slot.definition.initial)
    for (const i of inventory.instances) if ((i.quantity === 0) !== (i.holderKey === '@none')) throw new Error('[avg-inventory] 数量/持有人不一致')
    for (const item of inventory.items) { validateCondition(item.visibleWhen); item.variants.forEach(v => validateCondition(v.when)) }
    for (const a of inventory.actions) {
      if (a.sceneKeys.some(k => !sceneKeys.has(k))) throw new Error('[avg-inventory] 操作引用未知场景')
      if (a.target && !(a.target.kind === 'character' ? characterKeys.has(a.target.key) : a.target.kind === 'scene' ? sceneKeys.has(a.target.key) : inventory.instances.some(i => i.key === a.target!.key))) throw new Error('[avg-inventory] 操作引用未知目标')
      validateCondition(a.visibleWhen); validateCondition(a.enabledWhen); validateEffects(a.effects)
    }
  }
  return plan
}
