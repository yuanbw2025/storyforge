import { ADVENTURE_V2_CORE_CAPABILITIES } from '../types'
import type {
  AdventureActionDefinition,
  AdventureCheckEvidence,
  AdventureContent,
  AdventureContentV1,
  AdventureContentV2,
  AdventureEffect,
  AdventureQuestStatus,
  AdventureRequirement,
  AdventureRule,
  AdventureRuntimeState,
  ProductRuntimeEvent,
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
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const allowed = [...expected].sort()
  if (actual.length !== allowed.length || allowed.some((field, index) => field !== actual[index])) {
    fail(`${label}字段不符合合同:${actual.join(',')}`)
  }
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
  const allowed = new Set(['itemKey', 'itemQuantity', 'itemState', 'resourceKey', 'resourceMinimum', 'abilityKey', 'abilityMinimum', 'conditionKey', 'conditionPresent', 'questKey', 'questStatus', 'narrativePath', 'narrativeEquals'])
  if (Object.keys(row).some(field => !allowed.has(field))) fail('前置条件包含未知字段')
  const result: AdventureRequirement = {}
  if (row.itemKey != null) result.itemKey = key(row.itemKey, '物品条件 key')
  if (row.itemQuantity != null) result.itemQuantity = integer(row.itemQuantity, '物品条件数量', 1, 1_000_000)
  if (row.itemState != null) {
    if (!['carried', 'equipped'].includes(String(row.itemState))) fail('物品条件状态无效')
    result.itemState = String(row.itemState) as 'carried' | 'equipped'
  }
  if ((result.itemQuantity != null || result.itemState != null) && !result.itemKey) {
    fail('物品数量或状态条件必须同时声明 itemKey')
  }
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
export function adventureNarrativeProjection(state: AdventureRuntimeState): Record<string, unknown> {
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
    version: state.version,
    currentLocationKey: state.currentLocationKey,
    visited: keyed(state.visitedLocationKeys, value => value, () => true),
    inventory: keyed(
      state.inventory.filter(item => item.ownerKey === 'player' && item.state !== 'transferred'),
      item => item.itemKey,
      item => item.quantity,
    ),
    resources: structuredClone(state.resources),
    abilities: structuredClone(state.abilities),
    equipped: keyed(
      state.inventory.filter(item => item.ownerKey === 'player' && item.state === 'equipped'),
      item => item.itemKey,
      () => true,
    ),
    conditions: keyed(state.conditions, item => item.conditionKey, item => item.duration ?? true),
    quests: keyed(state.quests, item => item.questKey, item => ({
      status: item.status,
      objectives: keyed(item.objectives, objective => objective.objectiveKey, objective => objective.completed),
    })),
  }
}

function parseAdventureContentV1(value: string | AdventureContentV1 | Record<string, unknown>): AdventureContentV1 {
  const source: unknown = typeof value === 'string' ? (() => { try { return JSON.parse(value) } catch { fail('内容不是合法 JSON') } })() : value
  const row = record(source, '冒险内容')
  if (row.version !== 1 || row.playerKey !== 'player') fail('内容版本或玩家 key 无效')
  const playerIdentity = row.playerIdentity == null ? null : (() => {
    const identity = record(row.playerIdentity, '玩家身份')
    return {
      name: text(identity.name, '玩家姓名', 240),
      description: text(identity.description, '玩家身份说明', 4_000),
    }
  })()
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
  const result: AdventureContentV1 = {
    version: 1,
    initialLocationKey: key(row.initialLocationKey, '初始地点 key'),
    playerKey: 'player',
    ...(playerIdentity ? { playerIdentity } : {}),
    locations,
    objects,
    items,
    abilities,
    conditions,
    resources,
    quests,
    actions,
    initialInventory,
  }
  const report = validateAdventureContent(result)
  if (!report.valid) fail(report.errors.join('；'))
  return structuredClone(result)
}

function optionalStableKey(value: unknown, label: string): string | null {
  return value == null ? null : key(value, label)
}

function assertV2RuleShape(value: unknown, label: string): void {
  const row = record(value, label)
  const fields = row.kind === 'automatic'
    ? ['kind']
    : row.kind === 'threshold'
      ? ['kind', 'abilityKey', 'difficulty']
      : row.kind === 'random'
        ? ['kind', 'abilityKey', 'expression', 'difficulty', 'costlySuccessFloor']
        : row.kind === 'resource-payment'
          ? ['kind', 'resourceKey', 'amount']
          : fail(`${label}类型无效`)
  exactKeys(row, fields, label)
}

function assertV2EffectShape(value: unknown, label: string): void {
  const row = record(value, label)
  const fields = row.op === 'enter-location'
    ? ['op', 'locationKey']
    : row.op === 'gain-item'
      ? ['op', 'itemKey', 'quantity', 'claimKey']
      : row.op === 'remove-item'
        ? ['op', 'itemKey', 'quantity']
        : row.op === 'transfer-item'
          ? ['op', 'itemKey', 'quantity', 'toOwnerKey']
          : row.op === 'change-item-state'
            ? ['op', 'itemKey', 'state']
            : row.op === 'change-resource'
              ? ['op', 'resourceKey', 'delta']
              : row.op === 'change-ability'
                ? ['op', 'abilityKey', 'delta']
                : row.op === 'apply-condition'
                  ? ['op', 'conditionKey', 'duration']
                  : row.op === 'remove-condition'
                    ? ['op', 'conditionKey']
                    : row.op === 'accept-quest' || row.op === 'fail-quest'
                      ? ['op', 'questKey']
                      : row.op === 'complete-objective'
                        ? ['op', 'questKey', 'objectiveKey']
                        : fail(`${label}类型无效`)
  exactKeys(row, fields, label)
}

function parseAdventureContentV2(source: Record<string, unknown>): AdventureContentV2 {
  if (source.schema !== 'storyforge.text-adventure.content' || source.version !== 2 || source.playerKey !== 'player') {
    fail('V2 内容 schema/version 或玩家 key 无效')
  }
  exactKeys(source, [
    'schema', 'version', 'recipeKey', 'playerKey', 'playerIdentity', 'capabilities',
    'regions', 'areas', 'initialLocationKey', 'locations', 'scenes', 'objects',
    'equipmentSlots', 'items', 'abilities', 'conditions', 'resources', 'progression',
    'clock', 'quests', 'actions', 'initialInventory', 'storylets', 'endings', 'media',
  ], 'V2 内容')
  exactKeys(record(source.playerIdentity, 'V2 玩家身份'), ['name', 'description'], 'V2 玩家身份')
  const rawActions = Array.isArray(source.actions) ? source.actions.map(item => record(item, 'V2 行动')) : fail('V2 行动必须是数组')
  for (const rawAction of rawActions) {
    exactKeys(rawAction, [
      'key', 'kind', 'label', 'description', 'locationKey', 'targetKey', 'requirements', 'rule',
      'successEffects', 'costlySuccessEffects', 'failureEffects', 'successText', 'costlySuccessText',
      'failureText', 'unavailableText', 'repeatable', 'narrativeChoiceKey', 'interaction',
    ], 'V2 行动')
    assertV2RuleShape(rawAction.rule, 'V2 行动规则')
    for (const field of ['successEffects', 'costlySuccessEffects', 'failureEffects'] as const) {
      const effects = Array.isArray(rawAction[field]) ? rawAction[field] : fail(`V2 行动 ${field} 必须是数组`)
      effects.forEach((value, index) => assertV2EffectShape(value, `V2 行动 ${field}[${index}]`))
    }
    if (rawAction.interaction != null) {
      exactKeys(record(rawAction.interaction, 'V2 交谈绑定'), ['participantKey', 'sceneKey', 'ruleKey'], 'V2 交谈绑定')
    }
  }
  const rawInitialInventory = Array.isArray(source.initialInventory)
    ? source.initialInventory.map(item => record(item, 'V2 初始背包'))
    : fail('V2 初始背包必须是数组')
  rawInitialInventory.forEach(item => exactKeys(item, ['itemKey', 'quantity'], 'V2 初始背包'))
  // TEXTADV-2 deliberately reuses the V1 deterministic action/effect
  // language. Parse that shared subset first so no second rules engine is
  // created for the richer product contract.
  const base = parseAdventureContentV1({ ...source, version: 1 })
  const rawLocations = Array.isArray(source.locations) ? source.locations.map(item => record(item, 'V2 地点')) : fail('V2 地点必须是数组')
  const rawObjects = Array.isArray(source.objects) ? source.objects.map(item => record(item, 'V2 交互物')) : fail('V2 交互物必须是数组')
  const rawItems = Array.isArray(source.items) ? source.items.map(item => record(item, 'V2 物品')) : fail('V2 物品必须是数组')
  const rawAbilities = Array.isArray(source.abilities) ? source.abilities.map(item => record(item, 'V2 属性能力')) : fail('V2 属性能力必须是数组')
  const rawConditions = Array.isArray(source.conditions) ? source.conditions.map(item => record(item, 'V2 状态')) : fail('V2 状态必须是数组')
  const rawResources = Array.isArray(source.resources) ? source.resources.map(item => record(item, 'V2 资源')) : fail('V2 资源必须是数组')
  const rawQuests = Array.isArray(source.quests) ? source.quests.map(item => record(item, 'V2 任务')) : fail('V2 任务必须是数组')
  const byKey = (rows: Record<string, unknown>[], target: string, label: string) => rows.find(row => key(row.key, `${label} key`) === target) ?? fail(`${label}缺失:${target}`)

  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : fail('V2 capabilities 必须是数组')).map(raw => {
    const row = record(raw, 'V2 capability')
    exactKeys(row, ['key', 'version', 'enabled', 'required'], 'V2 capability')
    if (typeof row.enabled !== 'boolean' || typeof row.required !== 'boolean') fail('V2 capability 开关无效')
    return { key: key(row.key, 'V2 capability key'), version: integer(row.version, 'V2 capability 版本', 1, 1_000), enabled: row.enabled, required: row.required }
  })
  const regions = (Array.isArray(source.regions) ? source.regions : fail('V2 大区域必须是数组')).map(raw => {
    const row = record(raw, 'V2 大区域')
    exactKeys(row, ['key', 'title', 'description', 'areaKeys', 'tags'], 'V2 大区域')
    return { key: key(row.key, '大区域 key'), title: text(row.title, '大区域标题', 240), description: text(row.description, '大区域说明', 8_000), areaKeys: strings(row.areaKeys, '大区域 areaKeys'), tags: strings(row.tags, '大区域标签') }
  })
  const areas = (Array.isArray(source.areas) ? source.areas : fail('V2 区域必须是数组')).map(raw => {
    const row = record(raw, 'V2 区域')
    exactKeys(row, ['key', 'regionKey', 'title', 'description', 'locationKeys', 'tags'], 'V2 区域')
    return { key: key(row.key, '区域 key'), regionKey: key(row.regionKey, '区域大区 key'), title: text(row.title, '区域标题', 240), description: text(row.description, '区域说明', 8_000), locationKeys: strings(row.locationKeys, '区域 locationKeys'), tags: strings(row.tags, '区域标签') }
  })
  const scenes = (Array.isArray(source.scenes) ? source.scenes : fail('V2 场景必须是数组')).map(raw => {
    const row = record(raw, 'V2 场景')
    exactKeys(row, ['key', 'locationKey', 'title', 'description', 'actionKeys', 'tags'], 'V2 场景')
    return { key: key(row.key, '场景 key'), locationKey: key(row.locationKey, '场景地点 key'), title: text(row.title, '场景标题', 240), description: text(row.description, '场景说明', 8_000), actionKeys: strings(row.actionKeys, '场景 actionKeys'), tags: strings(row.tags, '场景标签') }
  })
  const equipmentSlots = (Array.isArray(source.equipmentSlots) ? source.equipmentSlots : fail('V2 装备槽必须是数组')).map(raw => {
    const row = record(raw, 'V2 装备槽')
    exactKeys(row, ['key', 'title', 'acceptsTags'], 'V2 装备槽')
    return { key: key(row.key, '装备槽 key'), title: text(row.title, '装备槽标题', 240), acceptsTags: strings(row.acceptsTags, '装备槽标签') }
  })
  const progressionRow = record(source.progression, 'V2 成长配置')
  exactKeys(progressionRow, ['levelAbilityKey', 'experienceResourceKey', 'skillPointResourceKey', 'experienceThresholds'], 'V2 成长配置')
  const thresholds = Array.isArray(progressionRow.experienceThresholds)
    ? progressionRow.experienceThresholds.map((value, index) => integer(value, `经验阈值[${index}]`, 0, 1_000_000_000))
    : fail('经验阈值必须是数组')
  const progression = {
    levelAbilityKey: key(progressionRow.levelAbilityKey, '等级能力 key'),
    experienceResourceKey: key(progressionRow.experienceResourceKey, '经验资源 key'),
    skillPointResourceKey: key(progressionRow.skillPointResourceKey, '技能点资源 key'),
    experienceThresholds: thresholds,
  }
  const clockRow = record(source.clock, 'V2 时间配置')
  exactKeys(clockRow, ['resourceKey', 'dayLengthMinutes', 'startLabel'], 'V2 时间配置')
  const clock = {
    resourceKey: key(clockRow.resourceKey, '时间资源 key'),
    dayLengthMinutes: integer(clockRow.dayLengthMinutes, '一日分钟数', 1, 100_000),
    startLabel: text(clockRow.startLabel, '起始时间标签', 240),
  }
  const storylets = (Array.isArray(source.storylets) ? source.storylets : fail('V2 storylets 必须是数组')).map(raw => {
    const row = record(raw, 'V2 storylet')
    exactKeys(row, ['key', 'title', 'actionKeys', 'requirements', 'once', 'priority'], 'V2 storylet')
    return {
      key: key(row.key, 'storylet key'), title: text(row.title, 'storylet 标题', 240),
      actionKeys: strings(row.actionKeys, 'storylet actionKeys'),
      requirements: Array.isArray(row.requirements) ? row.requirements.map(requirement) : fail('storylet 前置必须是数组'),
      once: row.once === true ? true : row.once === false ? false : fail('storylet once 无效'),
      priority: integer(row.priority, 'storylet 优先级', 0, 1_000_000),
    }
  })
  const endings = (Array.isArray(source.endings) ? source.endings : fail('V2 endings 必须是数组')).map(raw => {
    const row = record(raw, 'V2 ending')
    exactKeys(row, ['key', 'title', 'narrativeNodeKey', 'requirements', 'priority'], 'V2 ending')
    return {
      key: key(row.key, 'ending key'), title: text(row.title, 'ending 标题', 240),
      narrativeNodeKey: key(row.narrativeNodeKey, 'ending 叙事节点 key'),
      requirements: Array.isArray(row.requirements) ? row.requirements.map(requirement) : fail('ending 前置必须是数组'),
      priority: integer(row.priority, 'ending 优先级', 0, 1_000_000),
    }
  })
  const mediaRow = record(source.media, 'V2 媒资策略')
  exactKeys(mediaRow, ['mode', 'fallback', 'assetKeys'], 'V2 媒资策略')
  if (!['text-only', 'key-illustrations', 'rich-illustrations'].includes(String(mediaRow.mode)) || mediaRow.fallback !== 'text-only') fail('V2 媒资策略无效')
  const media: AdventureContentV2['media'] = {
    mode: mediaRow.mode as AdventureContentV2['media']['mode'],
    fallback: 'text-only',
    assetKeys: strings(mediaRow.assetKeys, 'V2 媒资 assetKeys').map((value, index) => key(value, `V2 媒资 assetKey[${index}]`)),
  }
  const result: AdventureContentV2 = {
    ...base,
    schema: 'storyforge.text-adventure.content',
    version: 2,
    playerIdentity: base.playerIdentity ?? fail('V2 玩家身份不能为空'),
    recipeKey: key(source.recipeKey, 'V2 recipeKey'),
    capabilities,
    regions,
    areas,
    locations: base.locations.map(item => {
      const row = byKey(rawLocations, item.key, 'V2 地点')
      exactKeys(row, ['key', 'title', 'description', 'tags', 'areaKey', 'sceneKeys'], 'V2 地点')
      return { ...item, areaKey: key(row.areaKey, '地点区域 key'), sceneKeys: strings(row.sceneKeys, '地点 sceneKeys') }
    }),
    scenes,
    objects: base.objects.map(item => {
      const row = byKey(rawObjects, item.key, 'V2 交互物')
      exactKeys(row, ['key', 'locationKey', 'title', 'description', 'tags', 'sceneKey'], 'V2 交互物')
      return { ...item, sceneKey: optionalStableKey(row.sceneKey, '交互物场景 key') }
    }),
    items: base.items.map(item => {
      const row = byKey(rawItems, item.key, 'V2 物品')
      exactKeys(row, ['key', 'title', 'description', 'tags', 'stackable', 'consumable', 'category', 'equipmentSlotKey', 'modifiers', 'usableActionKey'], 'V2 物品')
      const category = String(row.category) as AdventureContentV2['items'][number]['category']
      if (!['consumable', 'equipment', 'quest', 'material', 'key', 'misc'].includes(category)) fail(`物品分类无效:${item.key}`)
      const modifiers = (Array.isArray(row.modifiers) ? row.modifiers : fail('装备修正必须是数组')).map(rawModifier => {
        const modifier = record(rawModifier, '装备修正')
        exactKeys(modifier, ['abilityKey', 'delta'], '装备修正')
        return { abilityKey: key(modifier.abilityKey, '装备修正能力 key'), delta: finite(modifier.delta, '装备修正值', -1_000_000, 1_000_000) }
      })
      return { ...item, category, equipmentSlotKey: optionalStableKey(row.equipmentSlotKey, '装备槽 key'), modifiers, usableActionKey: optionalStableKey(row.usableActionKey, '物品行动 key') }
    }),
    equipmentSlots,
    abilities: base.abilities.map(item => {
      const row = byKey(rawAbilities, item.key, 'V2 属性能力')
      exactKeys(row, ['key', 'title', 'description', 'initial', 'minimum', 'maximum', 'role', 'group'], 'V2 属性能力')
      const role = String(row.role)
      if (role !== 'stat' && role !== 'skill') fail(`能力 role 无效:${item.key}`)
      return { ...item, role, group: text(row.group, '能力分组', 240) }
    }),
    conditions: base.conditions.map(item => {
      const row = byKey(rawConditions, item.key, 'V2 状态')
      exactKeys(row, ['key', 'title', 'description', 'tags'], 'V2 状态')
      return { ...item, tags: strings(row.tags, '状态标签') }
    }),
    resources: base.resources.map(item => {
      const row = byKey(rawResources, item.key, 'V2 资源')
      exactKeys(row, ['key', 'title', 'initial', 'minimum', 'maximum', 'role', 'description'], 'V2 资源')
      const role = String(row.role) as AdventureContentV2['resources'][number]['role']
      if (!['health', 'mana', 'stamina', 'experience', 'skill-points', 'currency', 'clock', 'custom'].includes(role)) fail(`资源 role 无效:${item.key}`)
      return { ...item, role, description: text(row.description, '资源说明', 8_000) }
    }),
    quests: base.quests.map(item => {
      const row = byKey(rawQuests, item.key, 'V2 任务')
      exactKeys(row, ['key', 'title', 'description', 'initialStatus', 'prerequisites', 'category', 'stages', 'objectives', 'rewardEffects', 'completionNodeKey', 'failureNodeKey'], 'V2 任务')
      const category = String(row.category) as AdventureContentV2['quests'][number]['category']
      if (!['main', 'side', 'ambient'].includes(category)) fail(`任务分类无效:${item.key}`)
      const stages = (Array.isArray(row.stages) ? row.stages : fail('任务阶段必须是数组')).map(rawStage => {
        const stage = record(rawStage, '任务阶段')
        exactKeys(stage, ['key', 'title', 'objectiveKeys'], '任务阶段')
        return { key: key(stage.key, '任务阶段 key'), title: text(stage.title, '任务阶段标题', 500), objectiveKeys: strings(stage.objectiveKeys, '任务阶段目标') }
      })
      const rawObjectives = Array.isArray(row.objectives) ? row.objectives.map(value => record(value, 'V2 任务目标')) : fail('V2 任务目标必须是数组')
      rawObjectives.forEach(objective => exactKeys(objective, ['key', 'title', 'optional', 'stageKey', 'alternativeActionKeys'], 'V2 任务目标'))
      return {
        ...item,
        category,
        stages,
        objectives: item.objectives.map(objective => ({ ...objective, stageKey: key(byKey(rawObjectives, objective.key, 'V2 任务目标').stageKey, '任务目标阶段 key') })),
      }
    }),
    progression,
    clock,
    storylets,
    endings,
    media,
  }
  const report = validateAdventureContent(result)
  if (!report.valid) fail(report.errors.join('；'))
  return structuredClone(result)
}

export function parseAdventureContent(value: string | AdventureContent): AdventureContent {
  const source: unknown = typeof value === 'string' ? (() => { try { return JSON.parse(value) } catch { fail('内容不是合法 JSON') } })() : value
  const row = record(source, '冒险内容')
  return row.version === 2 ? parseAdventureContentV2(row) : parseAdventureContentV1(row)
}

export function validateAdventureContent(value: AdventureContent): AdventureContentReport {
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
  if (value.version === 2) {
    const regionKeys = new Set(value.regions.map(item => item.key))
    const areaKeys = new Set(value.areas.map(item => item.key))
    const sceneKeys = new Set(value.scenes.map(item => item.key))
    const slotKeys = new Set(value.equipmentSlots.map(item => item.key))
    try {
      unique(value.capabilities.map(item => item.key), 'V2 capability key')
      unique(value.regions.map(item => item.key), '大区域 key')
      unique(value.areas.map(item => item.key), '区域 key')
      unique(value.scenes.map(item => item.key), '场景 key')
      unique(value.equipmentSlots.map(item => item.key), '装备槽 key')
      unique(value.storylets.map(item => item.key), 'storylet key')
      unique(value.endings.map(item => item.key), 'ending key')
    } catch (cause) { error(cause instanceof Error ? cause.message : String(cause)) }
    for (const required of ADVENTURE_V2_CORE_CAPABILITIES) {
      const capability = value.capabilities.find(item => item.key === required)
      if (!capability?.enabled || !capability.required || capability.version < 1) error(`缺少必需 V2 capability:${required}`)
    }
    for (const region of value.regions) for (const areaKey of region.areaKeys) {
      if (!areaKeys.has(areaKey)) error(`大区域引用不存在区域:${region.key}.${areaKey}`)
      else if (value.areas.find(area => area.key === areaKey)?.regionKey !== region.key) error(`大区域与区域父引用不一致:${region.key}.${areaKey}`)
    }
    for (const area of value.areas) {
      if (!regionKeys.has(area.regionKey)) error(`区域引用不存在大区域:${area.key}.${area.regionKey}`)
      else if (!value.regions.find(region => region.key === area.regionKey)?.areaKeys.includes(area.key)) error(`区域未被父大区域收录:${area.key}.${area.regionKey}`)
      for (const locationKey of area.locationKeys) if (!locations.has(locationKey)) error(`区域引用不存在地点:${area.key}.${locationKey}`)
    }
    for (const location of value.locations) {
      if (!areaKeys.has(location.areaKey)) error(`地点引用不存在区域:${location.key}.${location.areaKey}`)
      else if (!value.areas.find(area => area.key === location.areaKey)?.locationKeys.includes(location.key)) error(`地点未被父区域收录:${location.key}.${location.areaKey}`)
      if (!location.sceneKeys.length) error(`地点没有场景:${location.key}`)
      for (const sceneKey of location.sceneKeys) {
        if (!sceneKeys.has(sceneKey)) error(`地点引用不存在场景:${location.key}.${sceneKey}`)
        else if (value.scenes.find(scene => scene.key === sceneKey)?.locationKey !== location.key) error(`地点与场景父引用不一致:${location.key}.${sceneKey}`)
      }
    }
    for (const scene of value.scenes) {
      if (!locations.has(scene.locationKey)) error(`场景引用不存在地点:${scene.key}.${scene.locationKey}`)
      else if (!value.locations.find(location => location.key === scene.locationKey)?.sceneKeys.includes(scene.key)) error(`场景未被父地点收录:${scene.key}.${scene.locationKey}`)
      for (const actionKey of scene.actionKeys) {
        if (!actions.has(actionKey)) error(`场景引用不存在行动:${scene.key}.${actionKey}`)
        else if (value.actions.find(action => action.key === actionKey)?.locationKey !== scene.locationKey) error(`场景行动不属于同一地点:${scene.key}.${actionKey}`)
      }
    }
    for (const action of value.actions) if (!value.scenes.some(scene => scene.locationKey === action.locationKey && scene.actionKeys.includes(action.key))) error(`V2 行动未被地点场景收录:${action.key}`)
    for (const action of value.actions) {
      const successfulEffects = [...action.successEffects, ...action.costlySuccessEffects]
      if (action.kind === 'take' && !successfulEffects.some(effect => effect.op === 'gain-item')) {
        error(`V2 取得行动没有物品入包效果:${action.key}`)
      }
      if (action.kind === 'give' && !successfulEffects.some(effect => (
        effect.op === 'transfer-item' || effect.op === 'remove-item'
      ))) error(`V2 交付行动没有物品转移效果:${action.key}`)
      if (action.kind === 'use' && !action.requirements.some(requirement => requirement.itemKey)) {
        error(`V2 使用行动没有物品前置条件:${action.key}`)
      }
    }
    for (const object of value.objects) if (object.sceneKey) {
      const scene = value.scenes.find(candidate => candidate.key === object.sceneKey)
      if (!scene) error(`交互物引用不存在场景:${object.key}.${object.sceneKey}`)
      else if (scene.locationKey !== object.locationKey) error(`交互物场景与地点不一致:${object.key}.${object.sceneKey}`)
    }
    for (const item of value.items) {
      if (item.category === 'equipment' && !item.equipmentSlotKey) error(`装备缺少装备槽:${item.key}`)
      if (item.category === 'equipment' && item.stackable) error(`装备不能堆叠:${item.key}`)
      if (item.category !== 'equipment' && item.equipmentSlotKey) error(`非装备物品不能占用装备槽:${item.key}`)
      if (item.category !== 'equipment' && item.modifiers.length) error(`非装备物品不能携带装备修正:${item.key}`)
      if (item.equipmentSlotKey && !slotKeys.has(item.equipmentSlotKey)) error(`物品引用不存在装备槽:${item.key}.${item.equipmentSlotKey}`)
      if (item.equipmentSlotKey) {
        const slot = value.equipmentSlots.find(candidate => candidate.key === item.equipmentSlotKey)
        if (slot?.acceptsTags.length && !item.tags.some(tag => slot.acceptsTags.includes(tag))) {
          error(`装备标签不满足槽位:${item.key}.${item.equipmentSlotKey}`)
        }
      }
      if (item.usableActionKey && !actions.has(item.usableActionKey)) error(`物品引用不存在使用行动:${item.key}.${item.usableActionKey}`)
      for (const modifier of item.modifiers) if (!abilities.has(modifier.abilityKey)) error(`装备修正引用不存在能力:${item.key}.${modifier.abilityKey}`)
    }
    if (!abilities.has(value.progression.levelAbilityKey)) error(`成长配置等级能力不存在:${value.progression.levelAbilityKey}`)
    if (!resources.has(value.progression.experienceResourceKey)) error(`成长配置经验资源不存在:${value.progression.experienceResourceKey}`)
    if (!resources.has(value.progression.skillPointResourceKey)) error(`成长配置技能点资源不存在:${value.progression.skillPointResourceKey}`)
    if (!resources.has(value.clock.resourceKey)) error(`时间配置资源不存在:${value.clock.resourceKey}`)
    const levelAbility = value.abilities.find(item => item.key === value.progression.levelAbilityKey)
    const experienceResource = value.resources.find(item => item.key === value.progression.experienceResourceKey)
    const skillPointResource = value.resources.find(item => item.key === value.progression.skillPointResourceKey)
    const clockResource = value.resources.find(item => item.key === value.clock.resourceKey)
    if (levelAbility?.role !== 'stat' || levelAbility?.initial !== levelAbility?.minimum) error('等级能力必须是从最小值开始的 stat')
    if (experienceResource?.role !== 'experience') error('成长配置经验资源 role 必须是 experience')
    if (skillPointResource?.role !== 'skill-points') error('成长配置技能点资源 role 必须是 skill-points')
    if (clockResource?.role !== 'clock') error('时间配置资源 role 必须是 clock')
    const singletonRoles = value.resources.filter(item => item.role !== 'custom').map(item => item.role)
    if (new Set(singletonRoles).size !== singletonRoles.length) error('非 custom 资源 role 不得重复')
    if (!value.progression.experienceThresholds.length
      || value.progression.experienceThresholds.some((threshold, index, all) => index > 0 && threshold <= all[index - 1])) {
      error('经验阈值必须严格递增')
    }
    if (value.progression.experienceThresholds[0] !== 0) error('经验阈值必须从 0 开始')
    if (value.progression.experienceThresholds.length > (levelAbility?.maximum ?? 0) - (levelAbility?.minimum ?? 0) + 1) error('经验阈值超过等级能力范围')
    if (effects.some(effect => effect.op === 'change-ability' && effect.abilityKey === value.progression.levelAbilityKey)) error('等级只能由经验阈值推进')
    if (effects.some(effect => effect.op === 'change-resource' && effect.resourceKey === value.progression.experienceResourceKey && effect.delta < 0)) error('经验资源不能减少')
    for (const quest of value.quests) {
      const objectiveKeys = new Set(quest.objectives.map(item => item.key))
      const stageKeys = new Set(quest.stages.map(item => item.key))
      if (!quest.stages.length) error(`V2 任务没有阶段:${quest.key}`)
      for (const stage of quest.stages) {
        if (!stage.objectiveKeys.length) error(`任务阶段没有目标:${quest.key}.${stage.key}`)
        for (const objectiveKey of stage.objectiveKeys) if (!objectiveKeys.has(objectiveKey)) error(`任务阶段引用不存在目标:${quest.key}.${stage.key}.${objectiveKey}`)
      }
      for (const objective of quest.objectives) if (!stageKeys.has(objective.stageKey)) error(`任务目标引用不存在阶段:${quest.key}.${objective.key}.${objective.stageKey}`)
    }
    for (const storylet of value.storylets) {
      if (!storylet.actionKeys.length) error(`storylet 没有行动:${storylet.key}`)
      for (const actionKey of storylet.actionKeys) if (!actions.has(actionKey)) error(`storylet 引用不存在行动:${storylet.key}.${actionKey}`)
      if (storylet.once && storylet.actionKeys.every(actionKey => value.actions.find(action => action.key === actionKey)?.repeatable !== false)) {
        error(`一次性 storylet 必须绑定至少一个不可重复行动:${storylet.key}`)
      }
      storylet.requirements.forEach(item => checkRequirement(item, `storylet ${storylet.key}`))
    }
    for (const ending of value.endings) {
      if (!ending.requirements.length) error(`结局必须具有可解释的状态条件:${ending.key}`)
      ending.requirements.forEach(item => checkRequirement(item, `ending ${ending.key}`))
    }
    const initialInventoryKeys = value.initialInventory.map(item => item.itemKey)
    if (new Set(initialInventoryKeys).size !== initialInventoryKeys.length) error('V2 初始背包物品不得重复')
    for (const entry of value.initialInventory) {
      const definition = value.items.find(item => item.key === entry.itemKey)
      if (definition && !definition.stackable && entry.quantity !== 1) error(`不可堆叠物品初始数量必须为 1:${entry.itemKey}`)
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

export function createInitialAdventureState(contentValue: AdventureContent, contentHash: string): AdventureRuntimeState {
  const content = parseAdventureContent(contentValue)
  const inventory = content.initialInventory.map(item => ({ itemKey: item.itemKey, ownerKey: 'player', quantity: item.quantity, state: 'carried' as const, sourceEventSequence: 0 }))
  return parseAdventureState({
    schema: 'storyforge.text-adventure', version: content.version, contentHash: key(contentHash, '内容 hash'), playerKey: 'player',
    currentLocationKey: content.initialLocationKey, visitedLocationKeys: [content.initialLocationKey], inventory,
    resources: Object.fromEntries(content.resources.map(item => [item.key, item.initial])), abilities: Object.fromEntries(content.abilities.map(item => [item.key, item.initial])),
    conditions: [], quests: content.quests.map(item => ({ questKey: item.key, status: item.initialStatus, objectives: item.objectives.map(objective => ({ objectiveKey: objective.key, optional: objective.optional, completed: false, completedSequence: null })), updatedSequence: 0 })),
    completedActionKeys: [], claimKeys: [], actionHistory: [], checks: [],
  })!
}

export function parseAdventureState(value: unknown): AdventureRuntimeState | null {
  if (value == null) return null
  const row = record(value, '冒险状态')
  if (row.schema !== 'storyforge.text-adventure' || (row.version !== 1 && row.version !== 2) || row.playerKey !== 'player') fail('不支持的冒险状态')
  if (!Array.isArray(row.visitedLocationKeys) || !Array.isArray(row.inventory) || !Array.isArray(row.conditions) || !Array.isArray(row.quests) || !Array.isArray(row.completedActionKeys) || !Array.isArray(row.claimKeys) || !Array.isArray(row.actionHistory) || !Array.isArray(row.checks)) fail('冒险状态集合无效')
  const resources = record(row.resources, '冒险资源'); const abilities = record(row.abilities, '冒险能力')
  const result: AdventureRuntimeState = {
    schema: 'storyforge.text-adventure', version: row.version, contentHash: key(row.contentHash, '内容 hash'), playerKey: 'player', currentLocationKey: key(row.currentLocationKey, '当前地点'), visitedLocationKeys: strings(row.visitedLocationKeys, '已访问地点'),
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

function eventPayload(event: ProductRuntimeEvent): Record<string, unknown> {
  try { return record(JSON.parse(event.payloadJson), '冒险事件载荷') } catch (cause) { if (cause instanceof SyntaxError) fail('冒险事件载荷不是 JSON'); throw cause }
}

export function applyAdventureEvent(value: AdventureRuntimeState | null, event: ProductRuntimeEvent): AdventureRuntimeState | null {
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
  state: AdventureRuntimeState,
  narrativeVariables: Record<string, unknown> = {},
  content?: AdventureContent,
): boolean {
  if (requirement.itemKey) {
    const item = state.inventory.find(candidate => (
      candidate.itemKey === requirement.itemKey && candidate.ownerKey === 'player'
      && candidate.state !== 'transferred'
    ))
    if ((item?.quantity ?? 0) < (requirement.itemQuantity ?? 1)) return false
    if (requirement.itemState != null && item?.state !== requirement.itemState) return false
  }
  if (requirement.resourceKey && (state.resources[requirement.resourceKey] ?? Number.NEGATIVE_INFINITY) < (requirement.resourceMinimum ?? 0)) return false
  if (requirement.abilityKey) {
    const value = content
      ? adventureEffectiveAbilityValue(content, state, requirement.abilityKey)
      : state.abilities[requirement.abilityKey] ?? Number.NEGATIVE_INFINITY
    if (value < (requirement.abilityMinimum ?? 0)) return false
  }
  if (requirement.conditionKey && state.conditions.some(item => item.conditionKey === requirement.conditionKey) !== (requirement.conditionPresent ?? true)) return false
  if (requirement.questKey && state.quests.find(item => item.questKey === requirement.questKey)?.status !== requirement.questStatus) return false
  if (requirement.narrativePath) {
    let current: unknown = narrativeVariables
    for (const part of requirement.narrativePath.split('.')) current = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[part] : undefined
    if (current !== requirement.narrativeEquals) return false
  }
  return true
}

/** Base ability plus deterministic modifiers from currently equipped items. */
export function adventureEffectiveAbilityValue(
  content: AdventureContent,
  state: AdventureRuntimeState,
  abilityKey: string,
): number {
  const base = state.abilities[abilityKey]
  if (base == null) fail(`能力不存在:${abilityKey}`)
  if (content.version !== 2) return base
  return state.inventory
    .filter(item => item.ownerKey === 'player' && item.state === 'equipped')
    .reduce((total, entry) => total + (content.items.find(item => item.key === entry.itemKey)?.modifiers
      .filter(modifier => modifier.abilityKey === abilityKey)
      .reduce((sum, modifier) => sum + modifier.delta, 0) ?? 0), base)
}

/**
 * Adds runtime-owned narrative position to the read-only condition context.
 * Product content cannot override this namespace; callers that omit the
 * narrative state fail closed for actions bound to a Narrative Choice.
 */
export function adventureNarrativeActionContext(
  narrative?: { currentNodeKey?: string | null; variables?: Record<string, unknown> } | null,
): Record<string, unknown> {
  return {
    ...(narrative?.variables ?? {}),
    __storyforge: { currentNarrativeNodeKey: narrative?.currentNodeKey ?? null },
  }
}

export function availableAdventureActions(content: AdventureContent, state: AdventureRuntimeState, narrativeVariables: Record<string, unknown> = {}): Array<{ action: AdventureActionDefinition; available: boolean; reason: string }> {
  return content.actions.filter(action => action.locationKey === state.currentLocationKey).map(action => {
    const available = (action.repeatable || !state.completedActionKeys.includes(action.key)) && action.requirements.every(item => adventureRequirementSatisfied(item, state, narrativeVariables, content))
    return { action, available, reason: available ? '' : action.unavailableText }
  })
}

export function availableAdventureStorylets(
  content: AdventureContent,
  state: AdventureRuntimeState,
  narrativeVariables: Record<string, unknown> = {},
): Array<AdventureContentV2['storylets'][number]> {
  if (content.version !== 2) return []
  const availableActions = new Set(availableAdventureActions(content, state, narrativeVariables)
    .filter(item => item.available)
    .map(item => item.action.key))
  return content.storylets
    .filter(storylet => storylet.requirements.every(item => adventureRequirementSatisfied(item, state, narrativeVariables, content)))
    .filter(storylet => storylet.actionKeys.some(actionKey => availableActions.has(actionKey)))
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
}

export function qualifiedAdventureEndings(
  content: AdventureContent,
  state: AdventureRuntimeState,
  narrativeVariables: Record<string, unknown> = {},
): Array<AdventureContentV2['endings'][number]> {
  if (content.version !== 2) return []
  return content.endings
    .filter(ending => ending.requirements.every(item => adventureRequirementSatisfied(item, state, narrativeVariables, content)))
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
}

/** Maps cumulative experience to a monotonic level. */
export function adventureProgressionLevel(
  content: AdventureContent,
  state: AdventureRuntimeState,
): number | null {
  if (content.version !== 2) return null
  const definition = content.abilities.find(item => item.key === content.progression.levelAbilityKey)
    ?? fail(`等级能力不存在:${content.progression.levelAbilityKey}`)
  const experience = state.resources[content.progression.experienceResourceKey]
    ?? fail(`经验资源不存在:${content.progression.experienceResourceKey}`)
  const reached = content.progression.experienceThresholds.filter(threshold => experience >= threshold).length
  const calculated = Math.min(definition.maximum, definition.minimum + Math.max(0, reached - 1))
  return Math.max(state.abilities[definition.key] ?? definition.minimum, calculated)
}

export function applyAdventureEffects(content: AdventureContent, stateValue: AdventureRuntimeState, effects: AdventureEffect[], sequence: number): AdventureRuntimeState {
  const state = structuredClone(stateValue)
  const pending = [...effects]
  while (pending.length) {
    const item = pending.shift()!
    if (item.op === 'enter-location') { state.currentLocationKey = item.locationKey; if (!state.visitedLocationKeys.includes(item.locationKey)) state.visitedLocationKeys.push(item.locationKey) }
    else if (item.op === 'gain-item') { if (state.claimKeys.includes(item.claimKey)) fail(`重复领取:${item.claimKey}`); state.claimKeys.push(item.claimKey); const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player' && row.state !== 'transferred'); const definition = content.items.find(row => row.key === item.itemKey) ?? fail(`物品不存在:${item.itemKey}`); if (content.version === 2 && !definition.stackable && (item.quantity !== 1 || current)) fail(`不可堆叠物品不能重复获得:${item.itemKey}`); if (current) current.quantity += item.quantity; else state.inventory.push({ itemKey: item.itemKey, ownerKey: 'player', quantity: item.quantity, state: 'carried', sourceEventSequence: sequence }) }
    else if (item.op === 'remove-item' || item.op === 'transfer-item') { const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player' && row.state !== 'transferred'); if (!current || current.quantity < item.quantity) fail(`物品不足:${item.itemKey}`); current.quantity -= item.quantity; if (current.quantity === 0) state.inventory.splice(state.inventory.indexOf(current), 1); if (item.op === 'transfer-item') state.inventory.push({ itemKey: item.itemKey, ownerKey: item.toOwnerKey, quantity: item.quantity, state: 'transferred', sourceEventSequence: sequence }) }
    else if (item.op === 'change-item-state') {
      const current = state.inventory.find(row => row.itemKey === item.itemKey && row.ownerKey === 'player') ?? fail(`物品不存在:${item.itemKey}`)
      if (item.state === 'equipped' && content.version === 2) {
        const definition = content.items.find(row => row.key === item.itemKey) ?? fail(`物品不存在:${item.itemKey}`)
        if (definition.category !== 'equipment' || !definition.equipmentSlotKey) fail(`物品不能装备:${item.itemKey}`)
        const occupied = state.inventory.find(row => row.ownerKey === 'player' && row.state === 'equipped'
          && content.items.find(candidate => candidate.key === row.itemKey)?.equipmentSlotKey === definition.equipmentSlotKey
          && row.itemKey !== item.itemKey)
        if (occupied) fail(`装备槽已占用:${definition.equipmentSlotKey}`)
      }
      current.state = item.state
    }
    else if (item.op === 'change-resource') { const definition = content.resources.find(row => row.key === item.resourceKey) ?? fail(`资源不存在:${item.resourceKey}`); const before = state.resources[item.resourceKey] ?? fail(`运行资源不存在:${item.resourceKey}`); const after = before + item.delta; if (after < definition.minimum || after > definition.maximum) fail(`资源越界:${item.resourceKey}`); state.resources[item.resourceKey] = after; const level = adventureProgressionLevel(content, state); if (content.version === 2 && level != null) state.abilities[content.progression.levelAbilityKey] = level }
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
