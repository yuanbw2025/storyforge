import type {
  AdventureActionDefinition,
  AdventureCheckEvidence,
  AdventureContentV1,
  AdventureEffect,
  AdventureQuestStatus,
  AdventureRequirement,
  AdventureRule,
  SimulationAdventureState,
  SimulationEvent,
} from '../types'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/

function fail(message: string): never { throw new Error(`[adventure] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label}无效`)
  return value.trim()
}
function key(value: unknown, label: string): string {
  const result = text(value, label, 160)
  if (!STABLE_KEY.test(result)) fail(`${label}不是稳定 key`)
  return result
}
function integer(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}无效`)
  return Number(value)
}
function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label}无效`)
  return value
}
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) fail(`${label}必须是字符串数组`)
  const result = value.map(item => item.trim())
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}
function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label}不得重复`)
}
function questStatus(value: unknown): AdventureQuestStatus {
  if (!['locked', 'available', 'active', 'completed', 'failed'].includes(String(value))) fail('任务状态无效')
  return String(value) as AdventureQuestStatus
}

function requirement(value: unknown): AdventureRequirement {
  const row = record(value, '前置条件')
  const allowed = new Set(['itemKey', 'itemQuantity', 'resourceKey', 'resourceMinimum', 'abilityKey', 'abilityMinimum', 'conditionKey', 'conditionPresent', 'questKey', 'questStatus', 'narrativePath', 'narrativeEquals'])
  if (Object.keys(row).some(field => !allowed.has(field))) fail('前置条件包含未知字段')
  const result: AdventureRequirement = {}
  if (row.itemKey != null) result.itemKey = key(row.itemKey, '物品条件 key')
  if (row.itemQuantity != null) result.itemQuantity = integer(row.itemQuantity, '物品条件数量', 1, 1_000_000)
  if (row.resourceKey != null) result.resourceKey = key(row.resourceKey, '资源条件 key')
  if (row.resourceMinimum != null) result.resourceMinimum = finite(row.resourceMinimum, '资源条件值', -1_000_000, 1_000_000)
  if (row.abilityKey != null) result.abilityKey = key(row.abilityKey, '能力条件 key')
  if (row.abilityMinimum != null) result.abilityMinimum = finite(row.abilityMinimum, '能力条件值', -1_000_000, 1_000_000)
  if (row.conditionKey != null) result.conditionKey = key(row.conditionKey, '状态条件 key')
  if (row.conditionPresent != null) {
    if (typeof row.conditionPresent !== 'boolean') fail('状态条件 present 无效')
    result.conditionPresent = row.conditionPresent
  }
  if (row.questKey != null) result.questKey = key(row.questKey, '任务条件 key')
  if (row.questStatus != null) result.questStatus = questStatus(row.questStatus)
  if (row.narrativePath != null) result.narrativePath = key(row.narrativePath, '叙事变量路径')
  if (Object.prototype.hasOwnProperty.call(row, 'narrativeEquals')) {
    const scalar = row.narrativeEquals
    if (scalar !== null && !['string', 'number', 'boolean'].includes(typeof scalar)) fail('叙事变量条件必须是标量')
    result.narrativeEquals = scalar as string | number | boolean | null
  }
  if (!Object.keys(result).length) fail('前置条件不能为空')
  return result
}

function rule(value: unknown): AdventureRule {
  const row = record(value, '行动规则')
  const kind = String(row.kind ?? '')
  if (kind === 'automatic') return { kind }
  if (kind === 'threshold') return {
    kind, abilityKey: key(row.abilityKey, '门槛能力 key'), difficulty: finite(row.difficulty, '门槛难度', -1_000_000, 1_000_000),
  }
  if (kind === 'random') return {
    kind,
    abilityKey: key(row.abilityKey, '随机能力 key'),
    expression: text(row.expression, '随机表达式', 80),
    difficulty: finite(row.difficulty, '随机难度', -1_000_000, 1_000_000),
    costlySuccessFloor: row.costlySuccessFloor == null ? null : finite(row.costlySuccessFloor, '带代价成功下限', -1_000_000, 1_000_000),
  }
  if (kind === 'resource-payment') return {
    kind, resourceKey: key(row.resourceKey, '支付资源 key'), amount: finite(row.amount, '支付数量', 0.000001, 1_000_000),
  }
  fail('行动规则类型无效')
}

function effect(value: unknown): AdventureEffect {
  const row = record(value, '行动效果')
  switch (row.op) {
    case 'enter-location': return { op: row.op, locationKey: key(row.locationKey, '目标地点 key') }
    case 'gain-item': return { op: row.op, itemKey: key(row.itemKey, '获得物品 key'), quantity: integer(row.quantity, '获得数量', 1, 1_000_000), claimKey: key(row.claimKey, '领取 key') }
    case 'remove-item': return { op: row.op, itemKey: key(row.itemKey, '移除物品 key'), quantity: integer(row.quantity, '移除数量', 1, 1_000_000) }
    case 'transfer-item': return { op: row.op, itemKey: key(row.itemKey, '转移物品 key'), quantity: integer(row.quantity, '转移数量', 1, 1_000_000), toOwnerKey: key(row.toOwnerKey, '接收者 key') }
    case 'change-item-state': {
      if (row.state !== 'carried' && row.state !== 'equipped') fail('物品目标状态无效')
      return { op: row.op, itemKey: key(row.itemKey, '物品 key'), state: row.state }
    }
    case 'change-resource': return { op: row.op, resourceKey: key(row.resourceKey, '资源 key'), delta: finite(row.delta, '资源变化', -1_000_000, 1_000_000) }
    case 'change-ability': return { op: row.op, abilityKey: key(row.abilityKey, '能力 key'), delta: finite(row.delta, '能力变化', -1_000_000, 1_000_000) }
    case 'apply-condition': return { op: row.op, conditionKey: key(row.conditionKey, '状态 key'), duration: row.duration == null ? null : integer(row.duration, '状态持续', 1, 1_000_000) }
    case 'remove-condition': return { op: row.op, conditionKey: key(row.conditionKey, '状态 key') }
    case 'accept-quest': return { op: row.op, questKey: key(row.questKey, '任务 key') }
    case 'complete-objective': return { op: row.op, questKey: key(row.questKey, '任务 key'), objectiveKey: key(row.objectiveKey, '目标 key') }
    case 'fail-quest': return { op: row.op, questKey: key(row.questKey, '任务 key') }
    default: fail('行动效果类型无效')
  }
}

function action(value: unknown): AdventureActionDefinition {
  const row = record(value, '行动')
  const kind = String(row.kind ?? '') as AdventureActionDefinition['kind']
  if (!['look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action'].includes(kind)) fail('行动 kind 无效')
  if (typeof row.repeatable !== 'boolean') fail('行动 repeatable 无效')
  const interaction = row.interaction == null ? null : (() => {
    const binding = record(row.interaction, '交谈互动绑定')
    return {
      participantKey: key(binding.participantKey, '交谈角色 key'),
      sceneKey: key(binding.sceneKey, '交谈场景 key'),
      ruleKey: key(binding.ruleKey, '交谈规则 key'),
    }
  })()
  if (kind === 'talk' && !interaction) fail('talk 行动必须绑定共享角色互动场景与规则')
  if (kind !== 'talk' && interaction) fail('只有 talk 行动可以绑定共享角色互动')
  return {
    key: key(row.key, '行动 key'), kind, label: text(row.label, '行动名称', 240),
    description: text(row.description, '行动说明', 4_000), locationKey: key(row.locationKey, '行动地点 key'),
    targetKey: row.targetKey == null ? null : key(row.targetKey, '行动目标 key'),
    requirements: Array.isArray(row.requirements) ? row.requirements.map(requirement) : fail('行动前置条件必须是数组'),
    rule: rule(row.rule),
    successEffects: Array.isArray(row.successEffects) ? row.successEffects.map(effect) : fail('成功效果必须是数组'),
    costlySuccessEffects: Array.isArray(row.costlySuccessEffects) ? row.costlySuccessEffects.map(effect) : fail('代价效果必须是数组'),
    failureEffects: Array.isArray(row.failureEffects) ? row.failureEffects.map(effect) : fail('失败效果必须是数组'),
    successText: text(row.successText, '成功文本'), costlySuccessText: text(row.costlySuccessText, '代价成功文本'),
    failureText: text(row.failureText, '失败文本'), unavailableText: text(row.unavailableText, '不可用文本', 4_000),
    repeatable: row.repeatable,
    narrativeChoiceKey: row.narrativeChoiceKey == null ? null : key(row.narrativeChoiceKey, 'Narrative Choice key'),
    interaction,
  }
}

function validateExpression(value: string): void {
  if (!/^\d{1,3}d\d{1,4}(?:[+-]\d{1,7})?$/.test(value.trim().toLowerCase())) fail(`随机表达式无效:${value}`)
}

export interface AdventureContentReport {
  valid: boolean
  errors: string[]
  warnings: string[]
  unreachableLocationKeys: string[]
  unavailableQuestKeys: string[]
  sourceLessItemKeys: string[]
}

function narrativeProjectionKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * Player-visible deterministic projection consumed by the shared Narrative
 * condition DSL. Stable author keys are normalized only at this boundary so
 * content and event identities retain their original values.
 */
export function adventureNarrativeProjection(state: SimulationAdventureState): Record<string, unknown> {
  const keyed = <T>(values: readonly T[], getKey: (value: T) => string, getValue: (value: T) => unknown) => {
    const result: Record<string, unknown> = {}
    for (const value of values) {
      const key = narrativeProjectionKey(getKey(value))
      if (Object.prototype.hasOwnProperty.call(result, key)) fail(`Narrative 投影 key 冲突:${key}`)
      result[key] = getValue(value)
    }
    return result
  }
  return {
    currentLocationKey: state.currentLocationKey,
    visited: keyed(state.visitedLocationKeys, value => value, () => true),
    inventory: keyed(
      state.inventory.filter(item => item.ownerKey === 'player' && item.state !== 'transferred'),
      item => item.itemKey,
      item => item.quantity,
    ),
    resources: structuredClone(state.resources),
    abilities: structuredClone(state.abilities),
    conditions: keyed(state.conditions, item => item.conditionKey, item => item.duration ?? true),
    quests: keyed(state.quests, item => item.questKey, item => ({
      status: item.status,
      objectives: keyed(item.objectives, objective => objective.objectiveKey, objective => objective.completed),
    })),
  }
}

export function parseAdventureContent(value: string | AdventureContentV1): AdventureContentV1 {
  const source: unknown = typeof value === 'string' ? (() => { try { return JSON.parse(value) } catch { fail('内容不是合法 JSON') } })() : value
  const row = record(source, '冒险内容')
  if (row.version !== 1 || row.playerKey !== 'player') fail('内容版本或玩家 key 无效')
  const locations = (Array.isArray(row.locations) ? row.locations : fail('地点必须是数组')).map(raw => {
    const item = record(raw, '地点'); return { key: key(item.key, '地点 key'), title: text(item.title, '地点标题', 240), description: text(item.description, '地点说明', 8_000), tags: strings(item.tags, '地点标签') }
  })
  const objects = (Array.isArray(row.objects) ? row.objects : fail('交互物必须是数组')).map(raw => {
    const item = record(raw, '交互物'); return { key: key(item.key, '交互物 key'), locationKey: key(item.locationKey, '交互物地点 key'), title: text(item.title, '交互物标题', 240), description: text(item.description, '交互物说明', 8_000), tags: strings(item.tags, '交互物标签') }
  })
  const items = (Array.isArray(row.items) ? row.items : fail('物品必须是数组')).map(raw => {
    const item = record(raw, '物品'); if (typeof item.stackable !== 'boolean' || typeof item.consumable !== 'boolean') fail('物品布尔字段无效')
    return { key: key(item.key, '物品 key'), title: text(item.title, '物品标题', 240), description: text(item.description, '物品说明', 8_000), tags: strings(item.tags, '物品标签'), stackable: item.stackable, consumable: item.consumable }
  })
  const abilities = (Array.isArray(row.abilities) ? row.abilities : fail('能力必须是数组')).map(raw => {
    const item = record(raw, '能力'); const minimum = finite(item.minimum, '能力下限', -1_000_000, 1_000_000); const maximum = finite(item.maximum, '能力上限', minimum, 1_000_000)
    return { key: key(item.key, '能力 key'), title: text(item.title, '能力标题', 240), description: text(item.description, '能力说明', 8_000), initial: finite(item.initial, '能力初值', minimum, maximum), minimum, maximum }
  })
  const conditions = (Array.isArray(row.conditions) ? row.conditions : fail('状态必须是数组')).map(raw => {
    const item = record(raw, '状态'); return { key: key(item.key, '状态 key'), title: text(item.title, '状态标题', 240), description: text(item.description, '状态说明', 8_000) }
  })
  const resources = (Array.isArray(row.resources) ? row.resources : fail('资源必须是数组')).map(raw => {
    const item = record(raw, '资源'); const minimum = finite(item.minimum, '资源下限', -1_000_000, 1_000_000); const maximum = finite(item.maximum, '资源上限', minimum, 1_000_000)
    return { key: key(item.key, '资源 key'), title: text(item.title, '资源标题', 240), initial: finite(item.initial, '资源初值', minimum, maximum), minimum, maximum }
  })
  const actions = (Array.isArray(row.actions) ? row.actions : fail('行动必须是数组')).map(action)
  const quests = (Array.isArray(row.quests) ? row.quests : fail('任务必须是数组')).map(raw => {
    const item = record(raw, '任务')
    const objectives = (Array.isArray(item.objectives) ? item.objectives : fail('任务目标必须是数组')).map(rawObjective => {
      const objective = record(rawObjective, '任务目标'); if (typeof objective.optional !== 'boolean') fail('任务目标 optional 无效')
      return { key: key(objective.key, '目标 key'), title: text(objective.title, '目标标题', 500), optional: objective.optional, alternativeActionKeys: strings(objective.alternativeActionKeys, '目标替代行动') }
    })
    return { key: key(item.key, '任务 key'), title: text(item.title, '任务标题', 240), description: text(item.description, '任务说明', 8_000), initialStatus: questStatus(item.initialStatus), prerequisites: Array.isArray(item.prerequisites) ? item.prerequisites.map(requirement) : fail('任务前置必须是数组'), objectives, rewardEffects: Array.isArray(item.rewardEffects) ? item.rewardEffects.map(effect) : fail('任务奖励必须是数组'), completionNodeKey: item.completionNodeKey == null ? null : key(item.completionNodeKey, '任务完成节点'), failureNodeKey: item.failureNodeKey == null ? null : key(item.failureNodeKey, '任务失败节点') }
  })
  const initialInventory = (Array.isArray(row.initialInventory) ? row.initialInventory : fail('初始背包必须是数组')).map(raw => {
    const item = record(raw, '初始背包'); return { itemKey: key(item.itemKey, '初始物品 key'), quantity: integer(item.quantity, '初始物品数量', 1, 1_000_000) }
  })
  const result: AdventureContentV1 = { version: 1, initialLocationKey: key(row.initialLocationKey, '初始地点 key'), playerKey: 'player', locations, objects, items, abilities, conditions, resources, quests, actions, initialInventory }
  const report = validateAdventureContent(result)
  if (!report.valid) fail(report.errors.join('；'))
  return structuredClone(result)
}

export function validateAdventureContent(value: AdventureContentV1): AdventureContentReport {
  const errors: string[] = []; const warnings: string[] = []
  const error = (message: string) => errors.push(message)
  try {
    unique(value.locations.map(item => item.key), '地点 key'); unique(value.objects.map(item => item.key), '交互物 key')
    unique(value.items.map(item => item.key), '物品 key'); unique(value.abilities.map(item => item.key), '能力 key')
    unique(value.conditions.map(item => item.key), '状态 key'); unique(value.resources.map(item => item.key), '资源 key')
    unique(value.quests.map(item => item.key), '任务 key'); unique(value.actions.map(item => item.key), '行动 key')
    for (const quest of value.quests) unique(quest.objectives.map(item => item.key), `任务 ${quest.key} 目标 key`)
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)) }
  const locations = new Set(value.locations.map(item => item.key)); const objects = new Set(value.objects.map(item => item.key))
  const items = new Set(value.items.map(item => item.key)); const abilities = new Set(value.abilities.map(item => item.key))
  const conditions = new Set(value.conditions.map(item => item.key)); const resources = new Set(value.resources.map(item => item.key))
  const quests = new Map(value.quests.map(item => [item.key, item])); const actions = new Set(value.actions.map(item => item.key))
  if (!locations.has(value.initialLocationKey)) error(`初始地点不存在:${value.initialLocationKey}`)
  for (const object of value.objects) if (!locations.has(object.locationKey)) error(`交互物地点不存在:${object.key}`)
  const effects = value.actions.flatMap(item => [...item.successEffects, ...item.costlySuccessEffects, ...item.failureEffects])
    .concat(value.quests.flatMap(item => item.rewardEffects))
  const checkRequirement = (item: AdventureRequirement, owner: string) => {
    if (item.itemKey && !items.has(item.itemKey)) error(`${owner} 引用不存在物品:${item.itemKey}`)
    if (item.resourceKey && !resources.has(item.resourceKey)) error(`${owner} 引用不存在资源:${item.resourceKey}`)
    if (item.abilityKey && !abilities.has(item.abilityKey)) error(`${owner} 引用不存在能力:${item.abilityKey}`)
    if (item.conditionKey && !conditions.has(item.conditionKey)) error(`${owner} 引用不存在状态:${item.conditionKey}`)
    if (item.questKey && !quests.has(item.questKey)) error(`${owner} 引用不存在任务:${item.questKey}`)
  }
  for (const action of value.actions) {
    if (!locations.has(action.locationKey)) error(`行动地点不存在:${action.key}`)
    if (action.targetKey && !locations.has(action.targetKey) && !objects.has(action.targetKey)
      && !items.has(action.targetKey) && !action.targetKey.startsWith('character:')) {
      error(`行动目标不存在:${action.key}`)
    }
    action.requirements.forEach(item => checkRequirement(item, `行动 ${action.key}`))
    if ((action.rule.kind === 'threshold' || action.rule.kind === 'random') && !abilities.has(action.rule.abilityKey)) error(`行动规则能力不存在:${action.key}`)
    if (action.rule.kind === 'resource-payment' && !resources.has(action.rule.resourceKey)) error(`行动支付资源不存在:${action.key}`)
    if (action.rule.kind === 'random') try { validateExpression(action.rule.expression) } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)) }
    if (action.kind === 'move') {
      const entered = [...action.successEffects, ...action.costlySuccessEffects]
        .filter(effect => effect.op === 'enter-location')
      if (!entered.length) error(`移动行动没有进入地点效果:${action.key}`)
      if (action.targetKey && entered.some(effect => effect.op === 'enter-location' && effect.locationKey !== action.targetKey)) {
        error(`移动行动目标与进入地点不一致:${action.key}`)
      }
    }
    if (action.kind === 'talk' && !action.interaction) error(`talk 行动缺少共享角色互动绑定:${action.key}`)
    if (action.kind !== 'talk' && action.interaction) error(`非 talk 行动不能绑定角色互动:${action.key}`)
  }
  for (const quest of value.quests) {
    quest.prerequisites.forEach(item => checkRequirement(item, `任务 ${quest.key}`))
    if (!quest.objectives.length) error(`任务没有目标:${quest.key}`)
    for (const objective of quest.objectives) {
      if (!objective.alternativeActionKeys.length) error(`任务目标没有完成行动:${quest.key}.${objective.key}`)
      for (const actionKey of objective.alternativeActionKeys) {
        if (!actions.has(actionKey)) {
          error(`任务目标引用不存在行动:${actionKey}`)
          continue
        }
        const action = value.actions.find(item => item.key === actionKey)!
        const completesObjective = [...action.successEffects, ...action.costlySuccessEffects]
          .some(effect => effect.op === 'complete-objective'
            && effect.questKey === quest.key && effect.objectiveKey === objective.key)
        if (!completesObjective) error(`任务目标替代行动没有完成对应目标:${quest.key}.${objective.key}->${actionKey}`)
      }
    }
    for (const reward of quest.rewardEffects) {
      if (!['gain-item', 'change-resource', 'change-ability', 'apply-condition'].includes(reward.op)) {
        error(`任务奖励效果首期不支持:${quest.key}.${reward.op}`)
      }
    }
  }
  for (const item of value.initialInventory) if (!items.has(item.itemKey)) error(`初始背包物品不存在:${item.itemKey}`)
  for (const item of effects) {
    if ('locationKey' in item && !locations.has(item.locationKey)) error(`效果地点不存在:${item.locationKey}`)
    if ('itemKey' in item && !items.has(item.itemKey)) error(`效果物品不存在:${item.itemKey}`)
    if ('resourceKey' in item && !resources.has(item.resourceKey)) error(`效果资源不存在:${item.resourceKey}`)
    if ('abilityKey' in item && !abilities.has(item.abilityKey)) error(`效果能力不存在:${item.abilityKey}`)
    if ('conditionKey' in item && !conditions.has(item.conditionKey)) error(`效果状态不存在:${item.conditionKey}`)
    if ('questKey' in item) {
      const quest = quests.get(item.questKey); if (!quest) error(`效果任务不存在:${item.questKey}`)
      if (item.op === 'complete-objective' && quest && !quest.objectives.some(objective => objective.key === item.objectiveKey)) error(`效果任务目标不存在:${item.questKey}.${item.objectiveKey}`)
    }
  }
  const reachable = new Set([value.initialLocationKey]); let changed = true
  while (changed) {
    changed = false
    for (const action of value.actions) if (reachable.has(action.locationKey)) {
      for (const item of action.successEffects.concat(action.costlySuccessEffects, action.failureEffects)) if (item.op === 'enter-location' && !reachable.has(item.locationKey)) { reachable.add(item.locationKey); changed = true }
    }
  }
  const unreachableLocationKeys = value.locations.map(item => item.key).filter(item => !reachable.has(item))
  if (unreachableLocationKeys.length) error(`不可达地点:${unreachableLocationKeys.join(',')}`)
  const unavailableQuestKeys = value.quests.filter(item => item.initialStatus === 'locked' && !effects.some(effect => effect.op === 'accept-quest' && effect.questKey === item.key)).map(item => item.key)
  if (unavailableQuestKeys.length) error(`无法接受任务:${unavailableQuestKeys.join(',')}`)
  const sourceLessItemKeys = value.items.filter(item => !value.initialInventory.some(seed => seed.itemKey === item.key) && !effects.some(effect => effect.op === 'gain-item' && effect.itemKey === item.key)).map(item => item.key)
  if (sourceLessItemKeys.length) warnings.push(`无来源物品:${sourceLessItemKeys.join(',')}`)
  return { valid: errors.length === 0, errors, warnings, unreachableLocationKeys, unavailableQuestKeys, sourceLessItemKeys }
}

export function createInitialAdventureState(contentValue: AdventureContentV1, contentHash: string): SimulationAdventureState {
  const content = parseAdventureContent(contentValue)
  const inventory = content.initialInventory.map(item => ({ itemKey: item.itemKey, ownerKey: 'player', quantity: item.quantity, state: 'carried' as const, sourceEventSequence: 0 }))
  return parseAdventureState({
    schema: 'storyforge.text-adventure', version: 1, contentHash: key(contentHash, '内容 hash'), playerKey: 'player',
    currentLocationKey: content.initialLocationKey, visitedLocationKeys: [content.initialLocationKey], inventory,
    resources: Object.fromEntries(content.resources.map(item => [item.key, item.initial])), abilities: Object.fromEntries(content.abilities.map(item => [item.key, item.initial])),
    conditions: [], quests: content.quests.map(item => ({ questKey: item.key, status: item.initialStatus, objectives: item.objectives.map(objective => ({ objectiveKey: objective.key, optional: objective.optional, completed: false, completedSequence: null })), updatedSequence: 0 })),
    completedActionKeys: [], claimKeys: [], actionHistory: [], checks: [],
  })!
}

export function parseAdventureState(value: unknown): SimulationAdventureState | null {
  if (value == null) return null
  const row = record(value, '冒险状态')
  if (row.schema !== 'storyforge.text-adventure' || row.version !== 1 || row.playerKey !== 'player') fail('不支持的冒险状态')
  if (!Array.isArray(row.visitedLocationKeys) || !Array.isArray(row.inventory) || !Array.isArray(row.conditions) || !Array.isArray(row.quests) || !Array.isArray(row.completedActionKeys) || !Array.isArray(row.claimKeys) || !Array.isArray(row.actionHistory) || !Array.isArray(row.checks)) fail('冒险状态集合无效')
  const resources = record(row.resources, '冒险资源'); const abilities = record(row.abilities, '冒险能力')
  const result: SimulationAdventureState = {
    schema: 'storyforge.text-adventure', version: 1, contentHash: key(row.contentHash, '内容 hash'), playerKey: 'player', currentLocationKey: key(row.currentLocationKey, '当前地点'), visitedLocationKeys: strings(row.visitedLocationKeys, '已访问地点'),
    inventory: row.inventory.map(raw => { const item = record(raw, '背包'); const state = String(item.state); if (!['carried', 'equipped', 'transferred'].includes(state)) fail('物品状态无效'); return { itemKey: key(item.itemKey, '背包物品'), ownerKey: key(item.ownerKey, '物品拥有者'), quantity: integer(item.quantity, '物品数量', 1, 1_000_000), state: state as 'carried' | 'equipped' | 'transferred', sourceEventSequence: integer(item.sourceEventSequence, '物品来源序号', 0) } }),
    resources: Object.fromEntries(Object.entries(resources).map(([name, amount]) => [key(name, '资源 key'), finite(amount, '资源值', -1_000_000, 1_000_000)])),
    abilities: Object.fromEntries(Object.entries(abilities).map(([name, amount]) => [key(name, '能力 key'), finite(amount, '能力值', -1_000_000, 1_000_000)])),
    conditions: row.conditions.map(raw => { const item = record(raw, '冒险状态效果'); return { conditionKey: key(item.conditionKey, '状态 key'), duration: item.duration == null ? null : integer(item.duration, '状态持续', 1, 1_000_000), appliedSequence: integer(item.appliedSequence, '状态序号', 0) } }),
    quests: row.quests.map(raw => { const item = record(raw, '任务状态'); if (!Array.isArray(item.objectives)) fail('任务目标状态无效'); return { questKey: key(item.questKey, '任务 key'), status: questStatus(item.status), objectives: item.objectives.map(rawObjective => { const objective = record(rawObjective, '目标状态'); if (typeof objective.optional !== 'boolean' || typeof objective.completed !== 'boolean') fail('目标状态布尔字段无效'); return { objectiveKey: key(objective.objectiveKey, '目标 key'), optional: objective.optional, completed: objective.completed, completedSequence: objective.completedSequence == null ? null : integer(objective.completedSequence, '目标完成序号', 0) } }), updatedSequence: integer(item.updatedSequence, '任务更新序号', 0) } }),
    completedActionKeys: strings(row.completedActionKeys, '已完成行动'), claimKeys: strings(row.claimKeys, '领取 key'),
    actionHistory: row.actionHistory.map(raw => { const item = record(raw, '行动历史'); const kind = String(item.kind) as AdventureActionDefinition['kind']; const outcome = String(item.outcome) as AdventureCheckEvidence['outcome']; if (!['look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action'].includes(kind) || !['success', 'costly-success', 'failure', 'not-attempted'].includes(outcome)) fail('行动历史类型无效'); return { eventSequence: integer(item.eventSequence, '行动序号', 1), commandId: key(item.commandId, '行动 commandId'), actionKey: key(item.actionKey, '行动 key'), kind, outcome, narrative: text(item.narrative, '行动叙事'), resultingSequence: integer(item.resultingSequence, '行动终态序号', 1) } }),
    checks: row.checks.map(raw => { const item = record(raw, '判定证据'); const mode = String(item.mode) as AdventureRule['kind']; const outcome = String(item.outcome) as AdventureCheckEvidence['outcome']; if (!['automatic', 'threshold', 'random', 'resource-payment'].includes(mode) || !['success', 'costly-success', 'failure', 'not-attempted'].includes(outcome) || !Array.isArray(item.dice)) fail('判定证据无效'); return { eventSequence: integer(item.eventSequence, '判定序号', 1), actionKey: key(item.actionKey, '判定行动'), abilityKey: item.abilityKey == null ? null : key(item.abilityKey, '判定能力'), mode, expression: item.expression == null ? null : text(item.expression, '骰式', 80), dice: item.dice.map(die => integer(die, '骰点', 1, 1_000)), modifier: finite(item.modifier, '判定修正', -1_000_000, 1_000_000), total: finite(item.total, '判定合计', -1_000_000, 1_000_000), difficulty: finite(item.difficulty, '判定难度', -1_000_000, 1_000_000), outcome } }),
  }
  unique(result.visitedLocationKeys, '已访问地点'); unique(result.completedActionKeys, '已完成行动'); unique(result.claimKeys, '领取 key')
  unique(result.quests.map(item => item.questKey), '任务状态 key'); unique(result.conditions.map(item => item.conditionKey), '状态 key')
  return result
}

function eventPayload(event: SimulationEvent): Record<string, unknown> {
  try { return record(JSON.parse(event.payloadJson), '冒险事件载荷') } catch (cause) { if (cause instanceof SyntaxError) fail('冒险事件载荷不是 JSON'); throw cause }
}

export function applyAdventureEvent(value: SimulationAdventureState | null, event: SimulationEvent): SimulationAdventureState | null {
  if (!event.type.startsWith('adventure.')) return value
  const state = parseAdventureState(value) ?? fail('当前实例没有冒险状态')
  const body = eventPayload(event)
  switch (event.type) {
    case 'adventure.check.resolved': {
      const parsed = parseAdventureState({ ...state, checks: [...state.checks, body.evidence] })
      const evidence = parsed?.checks[parsed.checks.length - 1]
        ?? fail('判定证据无效')
      if (evidence.eventSequence !== event.sequence) fail('判定证据序号不一致')
      state.checks.push(evidence)
      break
    }
    case 'adventure.location.left': {
      const locationKey = key(body.locationKey, '离开地点 key')
      if (state.currentLocationKey !== locationKey) fail('离开地点与当前地点不一致')
      break
    }
    case 'adventure.location.entered': {
      const locationKey = key(body.locationKey, '进入地点 key')
      state.currentLocationKey = locationKey
      if (!state.visitedLocationKeys.includes(locationKey)) state.visitedLocationKeys.push(locationKey)
      break
    }
    case 'adventure.item.gained': {
      const itemKey = key(body.itemKey, '获得物品 key'); const claimKey = key(body.claimKey, '领取 key')
      const quantity = integer(body.quantity, '获得数量', 1, 1_000_000)
      if (state.claimKeys.includes(claimKey)) fail(`重复领取:${claimKey}`)
      state.claimKeys.push(claimKey)
      const current = state.inventory.find(item => item.itemKey === itemKey && item.ownerKey === 'player' && item.state !== 'transferred')
      if (current) current.quantity += quantity
      else state.inventory.push({ itemKey, ownerKey: 'player', quantity, state: 'carried', sourceEventSequence: event.sequence })
      break
    }
    case 'adventure.item.used':
    case 'adventure.item.transferred': {
      const itemKey = key(body.itemKey, '物品 key'); const quantity = integer(body.quantity, '物品数量', 1, 1_000_000)
      const current = state.inventory.find(item => item.itemKey === itemKey && item.ownerKey === 'player' && item.state !== 'transferred')
      if (!current || current.quantity < quantity) fail(`物品不足:${itemKey}`)
      current.quantity -= quantity
      if (current.quantity === 0) state.inventory.splice(state.inventory.indexOf(current), 1)
      if (event.type === 'adventure.item.transferred') {
        state.inventory.push({ itemKey, ownerKey: key(body.toOwnerKey, '接收者 key'), quantity, state: 'transferred', sourceEventSequence: event.sequence })
      }
      break
    }
    case 'adventure.item.state-changed': {
      const itemKey = key(body.itemKey, '物品 key'); const next = String(body.state)
      if (next !== 'carried' && next !== 'equipped') fail('物品目标状态无效')
      const current = state.inventory.find(item => item.itemKey === itemKey && item.ownerKey === 'player') ?? fail(`物品不存在:${itemKey}`)
      current.state = next
      break
    }
    case 'adventure.resource.changed': {
      const resourceKey = key(body.resourceKey, '资源 key'); const before = finite(body.before, '资源变化前', -1_000_000, 1_000_000); const after = finite(body.after, '资源变化后', -1_000_000, 1_000_000)
      if (state.resources[resourceKey] !== before) fail(`资源前值不一致:${resourceKey}`)
      state.resources[resourceKey] = after
      break
    }
    case 'adventure.ability.changed': {
      const abilityKey = key(body.abilityKey, '能力 key'); const before = finite(body.before, '能力变化前', -1_000_000, 1_000_000); const after = finite(body.after, '能力变化后', -1_000_000, 1_000_000)
      if (state.abilities[abilityKey] !== before) fail(`能力前值不一致:${abilityKey}`)
      state.abilities[abilityKey] = after
      break
    }
    case 'adventure.condition.applied': {
      const conditionKey = key(body.conditionKey, '状态 key'); const duration = body.duration == null ? null : integer(body.duration, '状态持续', 1, 1_000_000)
      const current = state.conditions.find(item => item.conditionKey === conditionKey)
      if (current) { current.duration = duration; current.appliedSequence = event.sequence }
      else state.conditions.push({ conditionKey, duration, appliedSequence: event.sequence })
      break
    }
    case 'adventure.condition.removed': {
      const conditionKey = key(body.conditionKey, '状态 key')
      if (!state.conditions.some(item => item.conditionKey === conditionKey)) fail(`状态不存在:${conditionKey}`)
      state.conditions = state.conditions.filter(item => item.conditionKey !== conditionKey)
      break
    }
    case 'adventure.quest.accepted': {
      const questKey = key(body.questKey, '任务 key'); const quest = state.quests.find(item => item.questKey === questKey) ?? fail(`任务不存在:${questKey}`)
      if (!['locked', 'available'].includes(quest.status)) fail(`任务不能重复接受:${questKey}`)
      quest.status = 'active'; quest.updatedSequence = event.sequence
      break
    }
    case 'adventure.quest.objective-updated': {
      const questKey = key(body.questKey, '任务 key'); const objectiveKey = key(body.objectiveKey, '目标 key')
      const quest = state.quests.find(item => item.questKey === questKey) ?? fail(`任务不存在:${questKey}`)
      if (quest.status !== 'active') fail(`任务目标不在进行中:${questKey}`)
      const objective = quest.objectives.find(item => item.objectiveKey === objectiveKey) ?? fail(`任务目标不存在:${objectiveKey}`)
      if (objective.completed) fail(`任务目标重复完成:${objectiveKey}`)
      objective.completed = true; objective.completedSequence = event.sequence; quest.updatedSequence = event.sequence
      break
    }
    case 'adventure.quest.completed':
    case 'adventure.quest.failed': {
      const questKey = key(body.questKey, '任务 key'); const quest = state.quests.find(item => item.questKey === questKey) ?? fail(`任务不存在:${questKey}`)
      if (quest.status !== 'active') fail(`任务不能变更终态:${questKey}`)
      if (event.type === 'adventure.quest.completed' && quest.objectives.some(item => !item.optional && !item.completed)) fail(`任务必选目标未完成:${questKey}`)
      quest.status = event.type === 'adventure.quest.completed' ? 'completed' : 'failed'; quest.updatedSequence = event.sequence
      break
    }
    case 'adventure.action.committed': {
      const commandId = key(body.commandId, '行动 commandId'); const actionKey = key(body.actionKey, '行动 key')
      const kind = String(body.kind) as AdventureActionDefinition['kind']; const outcome = String(body.outcome) as AdventureCheckEvidence['outcome']
      if (!['look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action'].includes(kind) || !['success', 'costly-success', 'failure', 'not-attempted'].includes(outcome)) fail('行动结果类型无效')
      if (body.repeatable !== true && body.repeatable !== false) fail('行动 repeatable 无效')
      if (!body.repeatable) {
        if (state.completedActionKeys.includes(actionKey)) fail(`行动已完成:${actionKey}`)
        state.completedActionKeys.push(actionKey)
      }
      state.actionHistory.push({ eventSequence: event.sequence, commandId, actionKey, kind, outcome, narrative: text(body.narrative, '行动叙事'), resultingSequence: event.sequence })
      break
    }
    case 'adventure.action.rejected':
      key(body.actionKey, '拒绝行动 key'); text(body.reason, '拒绝原因', 4_000)
      break
    default: fail(`未知冒险事件:${event.type}`)
  }
  return parseAdventureState(state)
}

export function adventureRequirementSatisfied(
  requirement: AdventureRequirement,
  state: SimulationAdventureState,
  narrativeVariables: Record<string, unknown> = {},
): boolean {
  if (requirement.itemKey && (state.inventory.find(item => item.itemKey === requirement.itemKey && item.ownerKey === 'player')?.quantity ?? 0) < (requirement.itemQuantity ?? 1)) return false
  if (requirement.resourceKey && (state.resources[requirement.resourceKey] ?? Number.NEGATIVE_INFINITY) < (requirement.resourceMinimum ?? 0)) return false
  if (requirement.abilityKey && (state.abilities[requirement.abilityKey] ?? Number.NEGATIVE_INFINITY) < (requirement.abilityMinimum ?? 0)) return false
  if (requirement.conditionKey && state.conditions.some(item => item.conditionKey === requirement.conditionKey) !== (requirement.conditionPresent ?? true)) return false
  if (requirement.questKey && state.quests.find(item => item.questKey === requirement.questKey)?.status !== requirement.questStatus) return false
  if (requirement.narrativePath) {
    let current: unknown = narrativeVariables
    for (const part of requirement.narrativePath.split('.')) current = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[part] : undefined
    if (current !== requirement.narrativeEquals) return false
  }
  return true
}

export function availableAdventureActions(content: AdventureContentV1, state: SimulationAdventureState, narrativeVariables: Record<string, unknown> = {}): Array<{ action: AdventureActionDefinition; available: boolean; reason: string }> {
  return content.actions.filter(action => action.locationKey === state.currentLocationKey).map(action => {
    const available = (action.repeatable || !state.completedActionKeys.includes(action.key)) && action.requirements.every(item => adventureRequirementSatisfied(item, state, narrativeVariables))
    return { action, available, reason: available ? '' : action.unavailableText }
  })
}

export function applyAdventureEffects(content: AdventureContentV1, stateValue: SimulationAdventureState, effects: AdventureEffect[], sequence: number): SimulationAdventureState {
  const state = structuredClone(stateValue)
  const pending = [...effects]
  while (pending.length) {
    const item = pending.shift()!
    if (item.op === 'enter-location') { state.currentLocationKey = item.locationKey; if (!state.visitedLocationKeys.includes(item.locationKey)) state.visitedLocationKeys.push(item.locationKey) }
    else if (item.op === 'gain-item') { if (state.claimKeys.includes(item.claimKey)) fail(`重复领取:${item.claimKey}`); state.claimKeys.push(item.claimKey); const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player' && row.state !== 'transferred'); if (current) current.quantity += item.quantity; else state.inventory.push({ itemKey: item.itemKey, ownerKey: 'player', quantity: item.quantity, state: 'carried', sourceEventSequence: sequence }) }
    else if (item.op === 'remove-item' || item.op === 'transfer-item') { const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player' && row.state !== 'transferred'); if (!current || current.quantity < item.quantity) fail(`物品不足:${item.itemKey}`); current.quantity -= item.quantity; if (current.quantity === 0) state.inventory.splice(state.inventory.indexOf(current), 1); if (item.op === 'transfer-item') state.inventory.push({ itemKey: item.itemKey, ownerKey: item.toOwnerKey, quantity: item.quantity, state: 'transferred', sourceEventSequence: sequence }) }
    else if (item.op === 'change-item-state') { const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player') ?? fail(`物品不存在:${item.itemKey}`); current.state = item.state }
    else if (item.op === 'change-resource') { const definition = content.resources.find(row => row.key === item.resourceKey) ?? fail(`资源不存在:${item.resourceKey}`); const before = state.resources[item.resourceKey] ?? fail(`运行资源不存在:${item.resourceKey}`); const after = before + item.delta; if (after < definition.minimum || after > definition.maximum) fail(`资源越界:${item.resourceKey}`); state.resources[item.resourceKey] = after }
    else if (item.op === 'change-ability') { const definition = content.abilities.find(row => row.key === item.abilityKey) ?? fail(`能力不存在:${item.abilityKey}`); const before = state.abilities[item.abilityKey] ?? fail(`运行能力不存在:${item.abilityKey}`); const after = before + item.delta; if (after < definition.minimum || after > definition.maximum) fail(`能力越界:${item.abilityKey}`); state.abilities[item.abilityKey] = after }
    else if (item.op === 'apply-condition') { const current = state.conditions.find(row => row.conditionKey === item.conditionKey); if (current) { current.duration = item.duration; current.appliedSequence = sequence } else state.conditions.push({ conditionKey: item.conditionKey, duration: item.duration, appliedSequence: sequence }) }
    else if (item.op === 'remove-condition') state.conditions = state.conditions.filter(row => row.conditionKey !== item.conditionKey)
    else {
      const quest = state.quests.find(row => row.questKey === item.questKey) ?? fail(`任务不存在:${item.questKey}`)
      if (item.op === 'accept-quest') {
        if (!['locked', 'available'].includes(quest.status)) fail(`任务不能重复接受:${item.questKey}`)
        quest.status = 'active'
      } else if (item.op === 'fail-quest') {
        if (quest.status !== 'active') fail(`任务不能失败:${item.questKey}`)
        quest.status = 'failed'
      } else {
        if (quest.status !== 'active') fail(`任务目标不在进行中:${item.questKey}`)
        const objective = quest.objectives.find(row => row.objectiveKey === item.objectiveKey)
          ?? fail(`任务目标不存在:${item.objectiveKey}`)
        if (objective.completed) fail(`任务目标重复完成:${item.objectiveKey}`)
        objective.completed = true
        objective.completedSequence = sequence
        if (quest.objectives.filter(row => !row.optional).every(row => row.completed)) {
          quest.status = 'completed'
          pending.unshift(...(content.quests.find(row => row.key === quest.questKey)?.rewardEffects ?? []))
        }
      }
      quest.updatedSequence = sequence
    }
  }
  return state
}
