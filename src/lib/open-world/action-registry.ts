import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldActionCatalogEntryV1,
  TextOpenWorldActionProjectionContextV1,
  TextOpenWorldCommandEnvelopeV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldResolvedActionV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldCommandEnvelopeV1 } from './command-contract'
import { createTextOpenWorldConditionCatalogV1 } from './condition-dsl'

const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-actions] ${message}`) }

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) fail(`${label}无效`)
  return value
}

function finiteInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label}必须是非负安全整数`)
  return Number(value)
}

function uniqueKeys(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const parsed = value.map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label}不能重复`)
  return parsed
}

function buildEntries(modules: TextOpenWorldParsedModulesV1): TextOpenWorldActionCatalogEntryV1[] {
  return modules.actions.actions.map(action => ({
    action: structuredClone(action),
    consumers: {
      fixedChoiceKeys: modules.narrative.fixedChoices.filter(item => item.actionKey === action.key).map(item => item.key),
      questObjectiveKeys: modules.quests.objectives.filter(item => item.actionKeys.includes(action.key)).map(item => item.key),
      randomEventKeys: modules.director.randomEvents.filter(item => item.actionKeys.includes(action.key)).map(item => item.key),
      tutorialKeys: modules.presentation.tutorials.filter(item => item.triggerActionKey === action.key).map(item => item.key),
    },
  }))
}

function parseContext(value: TextOpenWorldActionProjectionContextV1, modules: TextOpenWorldParsedModulesV1): TextOpenWorldActionProjectionContextV1 {
  if (!value || typeof value !== 'object') fail('projection context无效')
  if (value.actorKey !== 'player' && value.actorKey !== 'system') fail('actorKey必须为player或system')
  const currentLocationKey = stableKey(value.currentLocationKey, 'currentLocationKey')
  if (!modules.world.locations.some(item => item.key === currentLocationKey)) fail('currentLocationKey不在Release中')
  const conditionKeys = new Set(modules.actions.conditions.map(item => item.key))
  const conditionResults: TextOpenWorldActionProjectionContextV1['conditionResults'] = {}
  for (const [conditionKey, result] of Object.entries(value.conditionResults ?? {})) {
    stableKey(conditionKey, 'conditionResults key')
    if (!conditionKeys.has(conditionKey)) fail(`conditionResults引用未知条件:${conditionKey}`)
    if (!result || typeof result !== 'object' || typeof result.satisfied !== 'boolean'
      || (result.publicReason != null && (typeof result.publicReason !== 'string' || result.publicReason.length > 1000))) {
      fail(`conditionResults.${conditionKey}无效`)
    }
    conditionResults[conditionKey] = { satisfied: result.satisfied, publicReason: result.publicReason?.trim() || null }
  }
  const completedOnceActionKeys = uniqueKeys(value.completedOnceActionKeys, 'completedOnceActionKeys')
  const actionKeys = new Set(modules.actions.actions.map(item => item.key))
  completedOnceActionKeys.forEach(actionKey => { if (!actionKeys.has(actionKey)) fail(`completedOnceActionKeys引用未知Action:${actionKey}`) })
  const cooldownUntilWorldMinuteByActionKey: Record<string, number> = {}
  for (const [actionKey, until] of Object.entries(value.cooldownUntilWorldMinuteByActionKey ?? {})) {
    stableKey(actionKey, 'cooldown actionKey')
    if (!actionKeys.has(actionKey)) fail(`cooldown引用未知Action:${actionKey}`)
    cooldownUntilWorldMinuteByActionKey[actionKey] = finiteInteger(until, `cooldown.${actionKey}`)
  }
  const validTargetKeysByScope: TextOpenWorldActionProjectionContextV1['validTargetKeysByScope'] = {}
  for (const scope of ['actor', 'location', 'item', 'quest', 'vendor', 'encounter'] as const) {
    if (value.validTargetKeysByScope?.[scope] != null) validTargetKeysByScope[scope] = uniqueKeys(value.validTargetKeysByScope[scope], `validTargetKeysByScope.${scope}`)
  }
  return {
    actorKey: value.actorKey,
    currentLocationKey,
    worldMinute: finiteInteger(value.worldMinute, 'worldMinute'),
    conditionResults,
    completedOnceActionKeys,
    cooldownUntilWorldMinuteByActionKey,
    validTargetKeysByScope,
  }
}

export interface TextOpenWorldActionRegistryV1 {
  list(): TextOpenWorldActionCatalogEntryV1[]
  get(actionKey: string): TextOpenWorldActionCatalogEntryV1 | null
  project(context: TextOpenWorldActionProjectionContextV1): TextOpenWorldActionAvailabilityV1[]
  resolve(input: {
    actionKey: string
    targetKey: string | null
    context: TextOpenWorldActionProjectionContextV1
  }): TextOpenWorldResolvedActionV1
  resolveCommand(input: {
    command: TextOpenWorldCommandEnvelopeV1 | unknown
    context: TextOpenWorldActionProjectionContextV1
  }): TextOpenWorldResolvedActionV1
}

export function createTextOpenWorldActionRegistryV1(value: TextOpenWorldRuntimePackageV1 | string | unknown): TextOpenWorldActionRegistryV1 {
  createTextOpenWorldConditionCatalogV1(value)
  const modules = parseTextOpenWorldModulesV1(value)
  const entries = buildEntries(modules)
  const byKey = new Map(entries.map(entry => [entry.action.key, entry]))
  const cloneEntry = (entry: TextOpenWorldActionCatalogEntryV1) => structuredClone(entry)

  const project = (rawContext: TextOpenWorldActionProjectionContextV1): TextOpenWorldActionAvailabilityV1[] => {
    const context = parseContext(rawContext, modules)
    return entries.map(entry => {
      const action = entry.action
      const unavailableReasons: TextOpenWorldActionAvailabilityV1['unavailableReasons'] = []
      if (action.actorScope !== context.actorKey) unavailableReasons.push({ code: 'actor-scope', message: '当前操作者不能执行该行动。', conditionKey: null })
      if (action.locationKeys.length && !action.locationKeys.includes(context.currentLocationKey)) unavailableReasons.push({ code: 'wrong-location', message: '该行动不能在当前位置执行。', conditionKey: null })
      for (const conditionKey of action.requirementConditionKeys) {
        const result = context.conditionResults[conditionKey]
        if (!result) unavailableReasons.push({ code: 'condition-unknown', message: '行动条件尚未完成校验。', conditionKey })
        else if (!result.satisfied) unavailableReasons.push({ code: 'condition-failed', message: result.publicReason || '当前条件不允许执行该行动。', conditionKey })
      }
      if (action.repeatPolicy === 'once' && context.completedOnceActionKeys.includes(action.key)) unavailableReasons.push({ code: 'once-consumed', message: '该行动已经执行过。', conditionKey: null })
      const cooldownUntil = context.cooldownUntilWorldMinuteByActionKey[action.key] ?? 0
      const cooldownRemainingMinutes = Math.max(0, cooldownUntil - context.worldMinute)
      if (action.repeatPolicy === 'cooldown' && cooldownRemainingMinutes > 0) unavailableReasons.push({ code: 'cooldown', message: `该行动还需等待${cooldownRemainingMinutes}分钟。`, conditionKey: null })
      const validTargetKeys = action.targetScope === 'none' ? [] : [...(context.validTargetKeysByScope[action.targetScope] ?? [])]
      if (action.targetScope !== 'none' && validTargetKeys.length === 0) unavailableReasons.push({ code: 'no-valid-target', message: '当前没有可作用的目标。', conditionKey: null })
      return {
        ...cloneEntry(entry),
        available: unavailableReasons.length === 0,
        unavailableReasons,
        targetScope: action.targetScope,
        validTargetKeys,
        confirmationRequired: action.confirmationPolicy !== 'never',
        cooldownRemainingMinutes,
      }
    })
  }

  const resolve = (input: {
    actionKey: string
    targetKey: string | null
    context: TextOpenWorldActionProjectionContextV1
  }): TextOpenWorldResolvedActionV1 => {
    const actionKey = stableKey(input.actionKey, 'actionKey')
    const availability = project(input.context).find(item => item.action.key === actionKey)
    if (!availability) fail(`Action不存在:${actionKey}`)
    if (!availability.available) fail(`Action不可用:${availability.unavailableReasons.map(item => item.code).join(',')}`)
    const targetKey = input.targetKey == null ? null : stableKey(input.targetKey, 'targetKey')
    if (availability.targetScope === 'none' && targetKey != null) fail('无目标Action不能提交targetKey')
    if (availability.targetScope !== 'none' && (targetKey == null || !availability.validTargetKeys.includes(targetKey))) fail('targetKey不在Action可用目标中')
    return { entry: cloneEntry(availability), targetKey, confirmationRequired: availability.confirmationRequired }
  }

  return {
    list: () => entries.map(cloneEntry),
    get: actionKey => {
      const entry = byKey.get(stableKey(actionKey, 'actionKey'))
      return entry ? cloneEntry(entry) : null
    },
    project,
    resolve,
    resolveCommand: input => {
      const command = parseTextOpenWorldCommandEnvelopeV1(input.command)
      if (command.actorKey !== input.context.actorKey) fail('Command操作者与Action投影上下文不一致')
      const rawTargetKey = command.payload.targetKey
      if (rawTargetKey !== undefined && rawTargetKey !== null && typeof rawTargetKey !== 'string') fail('Command payload.targetKey无效')
      return resolve({ actionKey: command.actionKey, targetKey: rawTargetKey ?? null, context: input.context })
    },
  }
}
