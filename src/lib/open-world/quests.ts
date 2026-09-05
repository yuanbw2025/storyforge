import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestInstanceV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldRuntimePackageV1 } from './runtime-package'

const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const QUEST_DEFINITION_KEY = /^[a-z][a-z0-9._:-]{0,79}$/
const INSTANCE_SOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function fail(message: string): never { throw new Error(`[text-open-world-quest] ${message}`) }
function stableKey(value: string, label: string, pattern = STABLE_KEY): string {
  if (!pattern.test(value)) fail(`${label}无效`)
  return value
}

/**
 * Encodes both definition and source with explicit lengths. This keeps IDs
 * deterministic without allowing delimiter ambiguity or mutable display text.
 */
export function createTextOpenWorldQuestInstanceKeyV1(input: {
  definitionKey: string
  sourceKind: 'release' | 'director'
  sourceInstanceKey: string
}): string {
  const definitionKey = stableKey(input.definitionKey, 'definitionKey', QUEST_DEFINITION_KEY)
  const sourceInstanceKey = stableKey(input.sourceInstanceKey, 'sourceInstanceKey', INSTANCE_SOURCE_KEY)
  if (input.sourceKind !== 'release' && input.sourceKind !== 'director') fail('sourceKind无效')
  return stableKey(`quest-instance.${definitionKey.length}.${definitionKey}.${input.sourceKind}.${sourceInstanceKey.length}.${sourceInstanceKey}`, 'instanceKey')
}

export function createInitialTextOpenWorldQuestInstancesV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
): Record<string, TextOpenWorldQuestInstanceV1> {
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(value)
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const worldMinute = modules['time-weather'].initialWorldMinute
  const sourceContentHash = runtimePackage.modules.quests.contentHash
  return Object.fromEntries(modules.quests.quests
    .filter(definition => definition.instantiationPolicy === 'session-start')
    .map(definition => {
      const instanceKey = createTextOpenWorldQuestInstanceKeyV1({
        definitionKey: definition.key, sourceKind: 'release', sourceInstanceKey: 'session-start',
      })
      const instance: TextOpenWorldQuestInstanceV1 = {
        instanceKey,
        definitionKey: definition.key,
        sourceKind: 'release',
        sourceInstanceKey: 'session-start',
        sourceContentHash,
        status: definition.initialStatus,
        currentStageKey: null,
        objectiveStatusByKey: Object.fromEntries(definition.stageKeys.flatMap(stageKey => {
          const stage = modules.quests.stages.find(candidate => candidate.key === stageKey)!
          return stage.objectiveKeys.map(objectiveKey => [objectiveKey, 'inactive' as const])
        })),
        createdAtWorldMinute: worldMinute,
        offeredAtWorldMinute: definition.initialStatus === 'revealed' ? worldMinute : null,
        acceptedAtWorldMinute: null,
        deadlineWorldMinute: null,
        terminalAtWorldMinute: null,
        rewardClaimKey: null,
        resultTag: null,
      }
      return [instanceKey, instance]
    }))
}

export function createTextOpenWorldDirectorQuestInstanceV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  input: { definitionKey: string; sourceInstanceKey: string; worldMinute: number },
): TextOpenWorldQuestInstanceV1 {
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(value)
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const definitionKey = stableKey(input.definitionKey, 'definitionKey', QUEST_DEFINITION_KEY)
  const definition = modules.quests.quests.find(candidate => candidate.key === definitionKey)
    ?? fail(`任务定义不存在:${definitionKey}`)
  if (definition.type !== 'template' || definition.instantiationPolicy !== 'director') fail(`Director只能实例化模板任务:${definitionKey}`)
  if (!Number.isSafeInteger(input.worldMinute) || input.worldMinute < 0) fail('worldMinute无效')
  const sourceInstanceKey = stableKey(input.sourceInstanceKey, 'sourceInstanceKey', INSTANCE_SOURCE_KEY)
  const instanceKey = createTextOpenWorldQuestInstanceKeyV1({ definitionKey, sourceKind: 'director', sourceInstanceKey })
  return {
    instanceKey,
    definitionKey,
    sourceKind: 'director',
    sourceInstanceKey,
    sourceContentHash: runtimePackage.modules.quests.contentHash,
    status: 'revealed',
    currentStageKey: null,
    objectiveStatusByKey: Object.fromEntries(definition.stageKeys.flatMap(stageKey => {
      const stage = modules.quests.stages.find(candidate => candidate.key === stageKey)!
      return stage.objectiveKeys.map(objectiveKey => [objectiveKey, 'inactive' as const])
    })),
    createdAtWorldMinute: input.worldMinute,
    offeredAtWorldMinute: input.worldMinute,
    acceptedAtWorldMinute: null,
    deadlineWorldMinute: definition.timePolicy === 'timed' ? input.worldMinute + definition.expirationMinutes! : null,
    terminalAtWorldMinute: null,
    rewardClaimKey: null,
    resultTag: null,
  }
}

const STATUS_PRIORITY: Record<TextOpenWorldQuestStatusV1, number> = {
  active: 11, accepted: 10, revealed: 9, available: 8, suspended: 7,
  completed: 6, failed: 5, expired: 4, abandoned: 3, withdrawn: 2, locked: 1,
}

/**
 * Conditions authored against immutable definition keys consume an aggregate
 * read model. Runtime Actions and UI should use instance keys directly.
 */
export function deriveTextOpenWorldQuestConditionProjectionV1(
  modules: TextOpenWorldParsedModulesV1,
  quests: TextOpenWorldEffectStateV1['quests'],
): {
  statusByQuestKey: Record<string, TextOpenWorldQuestStatusV1>
  stageByQuestKey: Record<string, string>
  objectiveStatusByKey: Record<string, TextOpenWorldQuestInstanceV1['objectiveStatusByKey'][string]>
} {
  const grouped = new Map<string, TextOpenWorldQuestInstanceV1[]>()
  Object.values(quests.instancesByKey).forEach(instance => {
    const list = grouped.get(instance.definitionKey) ?? []
    list.push(instance)
    grouped.set(instance.definitionKey, list)
  })
  const statusByQuestKey: Record<string, TextOpenWorldQuestStatusV1> = {}
  const stageByQuestKey: Record<string, string> = {}
  const objectiveStatusByKey: Record<string, TextOpenWorldQuestInstanceV1['objectiveStatusByKey'][string]> = {}
  for (const definition of modules.quests.quests) {
    const selected = [...(grouped.get(definition.key) ?? [])].sort((left, right) =>
      STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status]
      || right.createdAtWorldMinute - left.createdAtWorldMinute
      || right.instanceKey.localeCompare(left.instanceKey))[0]
    statusByQuestKey[definition.key] = selected?.status ?? 'locked'
    if (selected?.currentStageKey) stageByQuestKey[definition.key] = selected.currentStageKey
    if (selected) Object.assign(objectiveStatusByKey, selected.objectiveStatusByKey)
  }
  return { statusByQuestKey, stageByQuestKey, objectiveStatusByKey }
}

export function projectTextOpenWorldQuestInstancesV1(
  modules: TextOpenWorldParsedModulesV1,
  quests: TextOpenWorldEffectStateV1['quests'],
) {
  return Object.values(quests.instancesByKey).map(instance => ({
    instance,
    definition: modules.quests.quests.find(candidate => candidate.key === instance.definitionKey)
      ?? fail(`任务实例引用的定义不存在:${instance.definitionKey}`),
  })).sort((left, right) => left.instance.createdAtWorldMinute - right.instance.createdAtWorldMinute
    || left.instance.instanceKey.localeCompare(right.instance.instanceKey))
}
