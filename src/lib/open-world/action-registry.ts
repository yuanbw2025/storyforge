import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldActionCatalogEntryV1,
  TextOpenWorldActionProjectionContextV1,
  TextOpenWorldCommandEnvelopeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldResolvedActionV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldCommandEnvelopeV1 } from './command-contract'
import { createTextOpenWorldConditionCatalogV1 } from './condition-dsl'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'

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
function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${label}必须是非负有限数`)
  return value
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
  const playerHealth = finiteNumber(value.playerHealth, 'playerHealth')
  const combatStatus = value.combatStatus == null ? null : value.combatStatus
  if (combatStatus != null && !['active', 'victory', 'defeat', 'escaped'].includes(combatStatus)) fail('combatStatus无效')
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
  const edgeKeys = new Set(modules.world.edges.map(item => item.key))
  const openEdgeKeys = uniqueKeys(value.openEdgeKeys ?? [], 'openEdgeKeys')
  openEdgeKeys.forEach(edgeKey => { if (!edgeKeys.has(edgeKey)) fail(`openEdgeKeys引用未知道路:${edgeKey}`) })
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
  const questDefinitionKeyByInstanceKey: Record<string, string> = {}
  const questKeys = new Set(modules.quests.quests.map(item => item.key))
  for (const [instanceKey, definitionKey] of Object.entries(value.questDefinitionKeyByInstanceKey ?? {})) {
    stableKey(instanceKey, 'questDefinitionKeyByInstanceKey.instanceKey')
    const parsedDefinitionKey = stableKey(definitionKey, `questDefinitionKeyByInstanceKey.${instanceKey}`)
    if (!questKeys.has(parsedDefinitionKey)) fail(`任务实例映射引用未知定义:${parsedDefinitionKey}`)
    questDefinitionKeyByInstanceKey[instanceKey] = parsedDefinitionKey
  }
  const questStatusByInstanceKey = { ...(value.questStatusByInstanceKey ?? {}) }
  for (const [instanceKey, status] of Object.entries(questStatusByInstanceKey)) {
    stableKey(instanceKey, 'questStatusByInstanceKey.instanceKey')
    if (!['locked', 'available', 'revealed', 'accepted', 'active', 'suspended', 'completed', 'failed', 'expired', 'abandoned', 'withdrawn'].includes(status)) fail(`任务实例状态无效:${instanceKey}`)
  }
  const questStageKeyByInstanceKey: Record<string, string | null> = {}
  const questStageKeys = new Set(modules.quests.stages.map(item => item.key))
  for (const [instanceKey, stageKey] of Object.entries(value.questStageKeyByInstanceKey ?? {})) {
    stableKey(instanceKey, 'questStageKeyByInstanceKey.instanceKey')
    if (stageKey != null && !questStageKeys.has(stableKey(stageKey, `questStageKeyByInstanceKey.${instanceKey}`))) fail(`任务实例Stage映射引用未知定义:${stageKey}`)
    questStageKeyByInstanceKey[instanceKey] = stageKey
  }
  const questObjectiveStatusByInstanceKey: TextOpenWorldActionProjectionContextV1['questObjectiveStatusByInstanceKey'] = {}
  for (const [instanceKey, statuses] of Object.entries(value.questObjectiveStatusByInstanceKey ?? {})) {
    stableKey(instanceKey, 'questObjectiveStatusByInstanceKey.instanceKey')
    const parsed: Record<string, 'inactive' | 'active' | 'completed' | 'failed'> = {}
    for (const [objectiveKey, status] of Object.entries(statuses ?? {})) {
      if (!modules.quests.objectives.some(item => item.key === stableKey(objectiveKey, `questObjectiveStatusByInstanceKey.${instanceKey}.objectiveKey`))) fail(`任务目标状态引用未知Objective:${objectiveKey}`)
      if (!['inactive', 'active', 'completed', 'failed'].includes(status)) fail(`任务目标状态无效:${instanceKey}:${objectiveKey}`)
      parsed[objectiveKey] = status
    }
    questObjectiveStatusByInstanceKey[instanceKey] = parsed
  }
  const questRewardClaimKeyByInstanceKey: Record<string, string | null> = {}
  for (const [instanceKey, claimKey] of Object.entries(value.questRewardClaimKeyByInstanceKey ?? {})) {
    stableKey(instanceKey, 'questRewardClaimKeyByInstanceKey.instanceKey')
    questRewardClaimKeyByInstanceKey[instanceKey] = claimKey == null ? null : stableKey(claimKey, `questRewardClaimKeyByInstanceKey.${instanceKey}`)
  }
  const questDeadlineWorldMinuteByInstanceKey: Record<string, number | null> = {}
  for (const [instanceKey, deadline] of Object.entries(value.questDeadlineWorldMinuteByInstanceKey ?? {})) {
    stableKey(instanceKey, 'questDeadlineWorldMinuteByInstanceKey.instanceKey')
    questDeadlineWorldMinuteByInstanceKey[instanceKey] = deadline == null ? null : finiteInteger(deadline, `questDeadlineWorldMinuteByInstanceKey.${instanceKey}`)
  }
  const primaryTrackedQuestInstanceKey = value.primaryTrackedQuestInstanceKey == null
    ? null
    : stableKey(value.primaryTrackedQuestInstanceKey, 'primaryTrackedQuestInstanceKey')
  const pinnedQuestInstanceKeys = uniqueKeys(value.pinnedQuestInstanceKeys ?? [], 'pinnedQuestInstanceKeys')
  if (pinnedQuestInstanceKeys.length > 3) fail('pinnedQuestInstanceKeys最多3个')
  if (primaryTrackedQuestInstanceKey && !questDefinitionKeyByInstanceKey[primaryTrackedQuestInstanceKey]) fail('主追踪任务实例不存在')
  if (primaryTrackedQuestInstanceKey && pinnedQuestInstanceKeys.includes(primaryTrackedQuestInstanceKey)) fail('主追踪任务不能同时钉选')
  pinnedQuestInstanceKeys.forEach(instanceKey => { if (!questDefinitionKeyByInstanceKey[instanceKey]) fail(`钉选任务实例不存在:${instanceKey}`) })
  return {
    actorKey: value.actorKey,
    currentLocationKey,
    worldMinute: finiteInteger(value.worldMinute, 'worldMinute'),
    playerHealth,
    combatStatus,
    conditionResults,
    openEdgeKeys,
    completedOnceActionKeys,
    cooldownUntilWorldMinuteByActionKey,
    validTargetKeysByScope,
    questDefinitionKeyByInstanceKey,
    questStatusByInstanceKey,
    questStageKeyByInstanceKey,
    questObjectiveStatusByInstanceKey,
    questRewardClaimKeyByInstanceKey,
    questDeadlineWorldMinuteByInstanceKey,
    primaryTrackedQuestInstanceKey,
    pinnedQuestInstanceKeys,
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
  createTextOpenWorldEffectCatalogV1(value)
  const modules = parseTextOpenWorldModulesV1(value)
  const entries = buildEntries(modules)
  const byKey = new Map(entries.map(entry => [entry.action.key, entry]))
  const effectByKey = new Map(modules.actions.effects.map(effect => [effect.key, effect]))
  const cloneEntry = (entry: TextOpenWorldActionCatalogEntryV1) => structuredClone(entry)

  const project = (rawContext: TextOpenWorldActionProjectionContextV1): TextOpenWorldActionAvailabilityV1[] => {
    const context = parseContext(rawContext, modules)
    return entries.map(entry => {
      const action = entry.action
      const unavailableReasons: TextOpenWorldActionAvailabilityV1['unavailableReasons'] = []
      const defeated = context.playerHealth === 0 || context.combatStatus === 'defeat'
      if (defeated && !['respawn', 'load-branch'].includes(action.category)) unavailableReasons.push({ code: 'defeated', message: '战败后只能选择战前重试、读档或复活点恢复。', conditionKey: null })
      if (action.category === 'respawn' && context.combatStatus !== 'defeat') unavailableReasons.push({ code: 'combat-state', message: '只有战败后才能在复活点恢复。', conditionKey: null })
      if (!defeated && context.combatStatus === 'active' && !['continue-combat', 'escape', 'use'].includes(action.category)) unavailableReasons.push({ code: 'combat-state', message: '战斗中只能选择战斗、技能、道具或逃跑。', conditionKey: null })
      if (['continue-combat', 'escape'].includes(action.category) && context.combatStatus !== 'active') unavailableReasons.push({ code: 'combat-state', message: '当前没有进行中的战斗。', conditionKey: null })
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
      let validTargetKeys = action.targetScope === 'none' ? [] : [...(context.validTargetKeysByScope[action.targetScope] ?? [])]
      if (action.targetScope === 'location' && action.category === 'travel') {
        const start = action.successEffectKeys.map(effectKey => effectByKey.get(effectKey))
          .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'start-travel' }> => effect?.operation === 'start-travel')
        if (!start || !context.openEdgeKeys.includes(start.payload.edgeKey)) {
          unavailableReasons.push({ code: 'route-closed', message: '这条道路当前不能通行。', conditionKey: null })
          validTargetKeys = []
        } else validTargetKeys = validTargetKeys.filter(locationKey => locationKey === start.payload.destinationLocationKey)
      } else if (action.targetScope === 'location') {
        validTargetKeys = validTargetKeys.filter(locationKey => locationKey === context.currentLocationKey)
      }
      if (action.targetScope === 'item' && ['use', 'drop', 'sell'].includes(action.category)) {
        const reason = action.category === 'use' ? 'consume' : action.category
        const removal = action.costEffectKeys.map(effectKey => effectByKey.get(effectKey))
          .find(effect => effect?.operation === 'remove-item' && effect.payload.reason === reason)
        validTargetKeys = removal?.operation === 'remove-item'
          ? validTargetKeys.filter(itemKey => itemKey === removal.payload.itemKey)
          : []
      }
      if (action.targetScope === 'item' && ['equip', 'unequip'].includes(action.category)) {
        const equipment = action.successEffectKeys.map(effectKey => effectByKey.get(effectKey))
          .find(effect => effect?.operation === `${action.category}-item`)
        validTargetKeys = equipment?.operation === 'equip-item' || equipment?.operation === 'unequip-item'
          ? validTargetKeys.filter(itemKey => itemKey === equipment.payload.itemKey)
          : []
      }
      if (action.targetScope === 'quest' && ['accept-quest', 'abandon-quest', 'quest-action'].includes(action.category)) {
        const transitionDefinitions = [...action.costEffectKeys, ...action.successEffectKeys]
          .map(effectKey => effectByKey.get(effectKey))
          .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'transition-quest' }> => effect?.operation === 'transition-quest')
        const questKeys = new Set(transitionDefinitions.map(effect => effect.payload.questKey))
        validTargetKeys = questKeys.size === 1
          ? validTargetKeys.filter(instanceKey => context.questDefinitionKeyByInstanceKey[instanceKey] === [...questKeys][0])
          : []
        if (action.category === 'accept-quest') validTargetKeys = validTargetKeys.filter(instanceKey => context.questStatusByInstanceKey[instanceKey] === 'revealed')
        if (action.category === 'abandon-quest') {
          const abandonedStageKey = transitionDefinitions[0]?.payload.stageKey ?? null
          validTargetKeys = validTargetKeys.filter(instanceKey => (
            ['active', 'suspended'].includes(context.questStatusByInstanceKey[instanceKey])
            && context.questStageKeyByInstanceKey[instanceKey] === abandonedStageKey
          ))
        }
        if (action.category === 'quest-action') {
          const ownerStage = modules.quests.stages.find(stage => stage.completionActionKey === action.key)
          if (ownerStage) {
            const requiredObjectiveKeys = ownerStage.objectiveKeys.filter(objectiveKey => !modules.quests.objectives.find(objective => objective.key === objectiveKey)!.optional)
            validTargetKeys = validTargetKeys.filter(instanceKey => (
              context.questStatusByInstanceKey[instanceKey] === 'active'
              && context.questStageKeyByInstanceKey[instanceKey] === ownerStage.key
              && requiredObjectiveKeys.every(objectiveKey => context.questObjectiveStatusByInstanceKey[instanceKey]?.[objectiveKey] === 'completed')
            ))
          } else {
            const expiration = transitionDefinitions.length === 1 && transitionDefinitions[0].payload.status === 'expired'
              ? transitionDefinitions[0]
              : null
            validTargetKeys = expiration
              ? validTargetKeys.filter(instanceKey => (
                  ['revealed', 'active', 'suspended'].includes(context.questStatusByInstanceKey[instanceKey])
                  && context.questStageKeyByInstanceKey[instanceKey] === expiration.payload.stageKey
                  && context.worldMinute >= (context.questDeadlineWorldMinuteByInstanceKey[instanceKey] ?? Number.MAX_SAFE_INTEGER)
                ))
              : []
          }
        }
      }
      if (action.targetScope === 'quest' && action.category === 'objective-action') {
        const completion = action.successEffectKeys.map(effectKey => effectByKey.get(effectKey))
          .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'complete-objective' }> => effect?.operation === 'complete-objective')
        const objective = completion ? modules.quests.objectives.find(item => item.key === completion.payload.objectiveKey) : null
        const stage = objective ? modules.quests.stages.find(item => item.key === objective.stageKey) : null
        validTargetKeys = objective && stage
          ? validTargetKeys.filter(instanceKey => (
              context.questDefinitionKeyByInstanceKey[instanceKey] === stage.questKey
              && context.questStatusByInstanceKey[instanceKey] === 'active'
              && context.questStageKeyByInstanceKey[instanceKey] === stage.key
              && context.questObjectiveStatusByInstanceKey[instanceKey]?.[objective.key] === 'active'
            ))
          : []
      }
      if (action.targetScope === 'quest' && action.category === 'claim-reward') {
        const quest = modules.quests.quests.find(item => item.claimActionKey === action.key)
        validTargetKeys = quest
          ? validTargetKeys.filter(instanceKey => (
              context.questDefinitionKeyByInstanceKey[instanceKey] === quest.key
              && context.questStatusByInstanceKey[instanceKey] === 'completed'
              && context.questRewardClaimKeyByInstanceKey[instanceKey] == null
            ))
          : []
      }
      if (action.targetScope === 'quest' && (action.category === 'track' || action.category === 'untrack')) {
        const trackingEffect = action.successEffectKeys.map(effectKey => effectByKey.get(effectKey))
          .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'track-quest' | 'untrack-quest' }> => effect?.operation === 'track-quest' || effect?.operation === 'untrack-quest')
        if (!trackingEffect) validTargetKeys = []
        else if (action.category === 'track' && trackingEffect.payload.slot === 'primary') {
          validTargetKeys = validTargetKeys.filter(instanceKey => (
            ['revealed', 'accepted', 'active', 'suspended'].includes(context.questStatusByInstanceKey[instanceKey])
            && context.primaryTrackedQuestInstanceKey !== instanceKey
          ))
        } else if (action.category === 'track') {
          validTargetKeys = context.pinnedQuestInstanceKeys.length >= 3 ? [] : validTargetKeys.filter(instanceKey => (
            ['revealed', 'accepted', 'active', 'suspended'].includes(context.questStatusByInstanceKey[instanceKey])
            && context.primaryTrackedQuestInstanceKey !== instanceKey
            && !context.pinnedQuestInstanceKeys.includes(instanceKey)
          ))
        } else if (trackingEffect.payload.slot === 'primary') {
          validTargetKeys = context.primaryTrackedQuestInstanceKey ? [context.primaryTrackedQuestInstanceKey] : []
        } else validTargetKeys = [...context.pinnedQuestInstanceKeys]
      }
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
