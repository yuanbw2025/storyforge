import type {
  TtrpgAbilityDefinitionV2,
  TtrpgAbilityRuntimeStateV2,
  TtrpgResetTriggerV2,
  TtrpgUsagePoolStateV2,
  RulePackV1,
} from '../types'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const RESET_TRIGGERS = new Set<TtrpgResetTriggerV2>([
  'turn', 'round', 'scene', 'short-rest', 'long-rest', 'session', 'milestone', 'manual-gm',
])

function fail(message: string): never {
  throw new Error(`[ttrpg-ability] ${message}`)
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim()
  if (!KEY.test(result)) fail(`${label} 无效`)
  return result
}

export function ttrpgAbilityStateKeyV2(actorInstanceId: string, abilityKey: string): string {
  return `${key(actorInstanceId, 'actorInstanceId')}::${key(abilityKey, 'abilityKey')}`
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
  return value == null ? null : integer(value, label, minimum, maximum)
}

function nullableKey(value: unknown, label: string): string | null {
  return value == null ? null : key(value, label)
}

export function parseTtrpgAbilityDefinitionV2(value: unknown): TtrpgAbilityDefinitionV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('能力定义必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'abilityKey,actionDefinitionKey,usage') fail('能力定义字段不精确')
  if (!row.usage || typeof row.usage !== 'object' || Array.isArray(row.usage)) fail('usage 无效')
  const usage = row.usage as Record<string, unknown>
  const expected = ['mode', 'maximum', 'resourceKey', 'cost', 'sharedPoolKey', 'cooldownRounds', 'reset']
  if (Object.keys(usage).sort().join(',') !== expected.sort().join(',')) fail('usage 字段不精确')
  const mode = String(usage.mode) as TtrpgAbilityDefinitionV2['usage']['mode']
  if (!['unlimited', 'charges', 'resource-cost', 'cooldown', 'shared-pool'].includes(mode)) fail('usage.mode 无效')
  const maximum = nullableInteger(usage.maximum, 'usage.maximum', 1, 100_000)
  const resourceKey = nullableKey(usage.resourceKey, 'usage.resourceKey')
  const cost = nullableInteger(usage.cost, 'usage.cost', 1, 100_000)
  const sharedPoolKey = nullableKey(usage.sharedPoolKey, 'usage.sharedPoolKey')
  const cooldownRounds = nullableInteger(usage.cooldownRounds, 'usage.cooldownRounds', 1, 100_000)
  if (!Array.isArray(usage.reset) || usage.reset.length > 8) fail('usage.reset 无效')
  const reset = usage.reset.map((trigger, index) => {
    if (!RESET_TRIGGERS.has(trigger as TtrpgResetTriggerV2)) fail(`usage.reset[${index}] 无效`)
    return trigger as TtrpgResetTriggerV2
  })
  if (new Set(reset).size !== reset.length) fail('usage.reset 不允许重复')
  if ((mode === 'charges' && maximum == null)
    || (mode === 'resource-cost' && (resourceKey == null || cost == null))
    || (mode === 'shared-pool' && (sharedPoolKey == null || cost == null))
    || (mode === 'cooldown' && cooldownRounds == null)) fail(`usage.${mode} 缺少必要配置`)
  if (mode === 'unlimited' && [maximum, resourceKey, cost, sharedPoolKey, cooldownRounds].some(item => item != null)) {
    fail('unlimited 不接受次数、资源、共享池或冷却配置')
  }
  return {
    abilityKey: key(row.abilityKey, 'abilityKey'),
    actionDefinitionKey: key(row.actionDefinitionKey, 'actionDefinitionKey'),
    usage: { mode, maximum, resourceKey, cost, sharedPoolKey, cooldownRounds, reset },
  }
}

export function createTtrpgAbilityRuntimeStateV2(input: {
  actorInstanceId: string
  definition: TtrpgAbilityDefinitionV2
}): TtrpgAbilityRuntimeStateV2 {
  const definition = parseTtrpgAbilityDefinitionV2(input.definition)
  return {
    actorInstanceId: key(input.actorInstanceId, 'actorInstanceId'),
    abilityKey: definition.abilityKey,
    remainingUses: definition.usage.mode === 'charges' ? definition.usage.maximum : null,
    cooldownUntilRound: null,
    disabledReasons: [],
    lastUsedEventId: null,
  }
}

export function parseTtrpgAbilityRuntimeStateV2(value: unknown): TtrpgAbilityRuntimeStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('能力运行状态必须是对象')
  const row = value as Record<string, unknown>
  const expected = ['actorInstanceId', 'abilityKey', 'remainingUses', 'cooldownUntilRound', 'disabledReasons', 'lastUsedEventId']
  if (Object.keys(row).sort().join(',') !== expected.sort().join(',')) fail('能力运行状态字段不精确')
  if (!Array.isArray(row.disabledReasons) || row.disabledReasons.length > 100) fail('disabledReasons 无效')
  const disabledReasons = row.disabledReasons.map((reason, index) => key(reason, `disabledReasons[${index}]`))
  if (new Set(disabledReasons).size !== disabledReasons.length) fail('disabledReasons 不允许重复')
  return {
    actorInstanceId: key(row.actorInstanceId, 'actorInstanceId'),
    abilityKey: key(row.abilityKey, 'abilityKey'),
    remainingUses: nullableInteger(row.remainingUses, 'remainingUses', 0, 100_000),
    cooldownUntilRound: nullableInteger(row.cooldownUntilRound, 'cooldownUntilRound', 0, Number.MAX_SAFE_INTEGER),
    disabledReasons,
    lastUsedEventId: nullableKey(row.lastUsedEventId, 'lastUsedEventId'),
  }
}

export function parseTtrpgUsagePoolStateV2(value: unknown): TtrpgUsagePoolStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('共享次数池必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'lastChangedEventId,maximum,poolKey,remaining') fail('共享次数池字段不精确')
  const maximum = integer(row.maximum, 'maximum', 1, 100_000)
  const remaining = integer(row.remaining, 'remaining', 0, maximum)
  return {
    poolKey: key(row.poolKey, 'poolKey'), maximum, remaining,
    lastChangedEventId: nullableKey(row.lastChangedEventId, 'lastChangedEventId'),
  }
}

/** Open releases declare each pool maximum; legacy packs retain their existing policy. */
export function createTtrpgOpenUsagePoolsV1(actions: readonly RulePackV1['actions'][number][]): Record<string, TtrpgUsagePoolStateV2> {
  const pools: Record<string, TtrpgUsagePoolStateV2> = {}
  const resetPolicies = new Map<string, string>()
  for (const action of actions) {
    const usage = action.usage
    if (usage.mode !== 'shared-pool') continue
    if (usage.maximum === null || usage.sharedPoolKey === null || usage.cost === null || usage.cost > usage.maximum) {
      fail('open 共享次数池必须声明可支付的冻结 maximum/cost')
    }
    const reset = [...usage.reset].sort().join(',')
    const previous = pools[usage.sharedPoolKey]
    if (previous && (previous.maximum !== usage.maximum || resetPolicies.get(usage.sharedPoolKey) !== reset)) {
      fail('同一 open 共享次数池的 maximum/reset 必须一致')
    }
    pools[usage.sharedPoolKey] = { poolKey: usage.sharedPoolKey, maximum: usage.maximum,
      remaining: usage.maximum, lastChangedEventId: null }
    resetPolicies.set(usage.sharedPoolKey, reset)
  }
  return pools
}

export function consumeTtrpgAbilityV2(input: {
  definition: TtrpgAbilityDefinitionV2
  state: TtrpgAbilityRuntimeStateV2
  eventId: string
  currentRound: number
  resourceCurrent?: number | null
  sharedPool?: TtrpgUsagePoolStateV2 | null
}): {
  state: TtrpgAbilityRuntimeStateV2
  sharedPool: TtrpgUsagePoolStateV2 | null
  resourceDelta: number
  replayed: boolean
} {
  const definition = parseTtrpgAbilityDefinitionV2(input.definition)
  const eventId = key(input.eventId, 'eventId')
  const currentRound = integer(input.currentRound, 'currentRound', 0, Number.MAX_SAFE_INTEGER)
  const current = parseTtrpgAbilityRuntimeStateV2(input.state)
  const currentSharedPool = input.sharedPool == null ? null : parseTtrpgUsagePoolStateV2(input.sharedPool)
  if (current.abilityKey !== definition.abilityKey) fail('能力运行状态身份不匹配')
  if (current.lastUsedEventId === eventId) {
    return { state: current, sharedPool: currentSharedPool, resourceDelta: 0, replayed: true }
  }
  if (current.disabledReasons.length) fail(`能力已禁用:${current.disabledReasons.join(',')}`)
  const state = structuredClone(current)
  const sharedPool = currentSharedPool
  let resourceDelta = 0
  if (definition.usage.mode === 'charges') {
    if (state.remainingUses == null || state.remainingUses < 1) fail('能力次数已经耗尽')
    state.remainingUses -= 1
  } else if (definition.usage.mode === 'resource-cost') {
    const cost = definition.usage.cost!
    if (!Number.isFinite(input.resourceCurrent) || Number(input.resourceCurrent) < cost) fail('能力所需资源不足')
    resourceDelta = -cost
  } else if (definition.usage.mode === 'shared-pool') {
    const cost = definition.usage.cost!
    if (!sharedPool || sharedPool.poolKey !== definition.usage.sharedPoolKey || sharedPool.remaining < cost) {
      fail('共享次数池不足或身份不匹配')
    }
    sharedPool.remaining -= cost
    sharedPool.lastChangedEventId = eventId
  } else if (definition.usage.mode === 'cooldown') {
    if (state.cooldownUntilRound != null && currentRound < state.cooldownUntilRound) {
      fail(`能力冷却到第 ${state.cooldownUntilRound} 轮`)
    }
    state.cooldownUntilRound = currentRound + definition.usage.cooldownRounds!
  }
  state.lastUsedEventId = eventId
  return { state, sharedPool, resourceDelta, replayed: false }
}

export function resetTtrpgAbilityUsageV2(input: {
  definition: TtrpgAbilityDefinitionV2
  state: TtrpgAbilityRuntimeStateV2
  trigger: TtrpgResetTriggerV2
  eventId: string
}): TtrpgAbilityRuntimeStateV2 {
  const definition = parseTtrpgAbilityDefinitionV2(input.definition)
  const current = parseTtrpgAbilityRuntimeStateV2(input.state)
  if (!definition.usage.reset.includes(input.trigger)) return current
  const state = structuredClone(current)
  if (definition.usage.mode === 'charges') state.remainingUses = definition.usage.maximum
  if (definition.usage.mode === 'cooldown') state.cooldownUntilRound = null
  state.lastUsedEventId = key(input.eventId, 'eventId')
  return state
}
