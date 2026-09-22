import type {
  TextOpenWorldObjectiveStatusV1,
  TextOpenWorldQuestDeadlineProjectionV1,
  TextOpenWorldQuestInstanceV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { projectTextOpenWorldQuestDeadlineV1 } from './quest-history'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'
import { projectTextOpenWorldClockWeatherV1 } from './weather'

type TextOpenWorldHudTrackableQuestStatusV1 = Extract<
  TextOpenWorldQuestStatusV1,
  'revealed' | 'accepted' | 'active' | 'suspended'
>

const HUD_TRACKABLE_QUEST_STATUSES = new Set<TextOpenWorldQuestStatusV1>([
  'revealed',
  'accepted',
  'active',
  'suspended',
])

function fail(message: string): never { throw new Error(`[text-open-world-player-hud] ${message}`) }
function isHudTrackableQuestStatus(value: TextOpenWorldQuestStatusV1): value is TextOpenWorldHudTrackableQuestStatusV1 {
  return HUD_TRACKABLE_QUEST_STATUSES.has(value)
}

export interface TextOpenWorldPlayerHudQuestV1 {
  instanceKey: string
  definitionKey: string
  type: 'mainline' | 'significant' | 'ordinary' | 'template'
  title: string
  status: TextOpenWorldHudTrackableQuestStatusV1
  currentStage: { key: string; title: string } | null
  nextRequiredObjective: {
    key: string
    title: string
    status: TextOpenWorldObjectiveStatusV1
  } | null
  deadline: TextOpenWorldQuestDeadlineProjectionV1
}

export interface TextOpenWorldPlayerHudProjectionV1 {
  player: {
    level: number
    health: number
    maximumHealth: number
    skillResource: number
    maximumSkillResource: number
  }
  location: {
    key: string
    title: string
    regionKey: string
    regionTitle: string
  }
  clockWeather: {
    worldMinute: number
    day: number
    timePeriodKey: string
    timePeriodLabel: string
    weatherKey: string
    weatherLabel: string
    weatherDescription: string
  }
  /** The explicit Session primary only. A pinned quest never substitutes for it. */
  primaryQuest: TextOpenWorldPlayerHudQuestV1 | null
  /** At most three explicit, still-trackable Session pins, in their stored order. */
  pinnedQuests: TextOpenWorldPlayerHudQuestV1[]
}

function projectQuest(
  instance: TextOpenWorldQuestInstanceV1,
  modules: ReturnType<typeof parseTextOpenWorldModulesV1>,
  worldMinute: number,
): TextOpenWorldPlayerHudQuestV1 | null {
  if (!isHudTrackableQuestStatus(instance.status)) return null
  const definition = modules.quests.quests.find(candidate => candidate.key === instance.definitionKey)
    ?? fail(`任务实例引用未知定义:${instance.definitionKey}`)
  const currentStage = instance.currentStageKey == null
    ? null
    : modules.quests.stages.find(candidate => candidate.key === instance.currentStageKey)
      ?? fail(`任务实例引用未知阶段:${instance.currentStageKey}`)
  const nextRequiredObjective = currentStage?.objectiveKeys
    .map(objectiveKey => modules.quests.objectives.find(candidate => candidate.key === objectiveKey)
      ?? fail(`任务阶段引用未知目标:${objectiveKey}`))
    .find(objective => !objective.optional && instance.objectiveStatusByKey[objective.key] !== 'completed')
    ?? null
  return {
    instanceKey: instance.instanceKey,
    definitionKey: definition.key,
    type: definition.type,
    title: definition.title,
    status: instance.status,
    currentStage: currentStage ? { key: currentStage.key, title: currentStage.title } : null,
    nextRequiredObjective: nextRequiredObjective
      ? {
          key: nextRequiredObjective.key,
          title: nextRequiredObjective.title,
          status: instance.objectiveStatusByKey[nextRequiredObjective.key],
        }
      : null,
    deadline: projectTextOpenWorldQuestDeadlineV1(instance, worldMinute),
  }
}

/**
 * Deterministic, read-only HUD projection. Gameplay facts remain owned by the
 * validated Session Projection and all display labels come from its frozen
 * RuntimePackage.
 */
export function projectTextOpenWorldPlayerHudV1(
  value: TextOpenWorldSessionProjectionV1 | unknown,
): TextOpenWorldPlayerHudProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const state = projection.state
  const clockWeather = projectTextOpenWorldClockWeatherV1({
    runtimePackage: projection.runtimePackage,
    state,
    parsedModules: modules,
  })
  const location = modules.world.locations.find(candidate => candidate.key === state.map.currentLocationKey)
    ?? fail(`当前位置不存在于冻结世界:${state.map.currentLocationKey}`)
  const region = modules.world.regions.find(candidate => candidate.key === location.regionKey)
    ?? fail(`当前位置引用未知地区:${location.regionKey}`)
  const instanceFor = (instanceKey: string | null) => instanceKey == null
    ? null
    : state.quests.instancesByKey[instanceKey] ?? fail(`任务追踪引用未知实例:${instanceKey}`)
  const primaryInstance = instanceFor(state.quests.tracking.primaryInstanceKey)
  const primaryQuest = primaryInstance ? projectQuest(primaryInstance, modules, state.time.worldMinute) : null
  const pinnedQuests = state.quests.tracking.pinnedInstanceKeys
    .map(instanceKey => projectQuest(instanceFor(instanceKey)!, modules, state.time.worldMinute))
    .filter((quest): quest is TextOpenWorldPlayerHudQuestV1 => quest != null)
    .slice(0, 3)

  return {
    player: {
      level: state.player.level,
      health: state.player.health,
      maximumHealth: state.player.maximumHealth,
      skillResource: state.player.skillResource,
      maximumSkillResource: state.player.maximumSkillResource,
    },
    location: {
      key: location.key,
      title: location.title,
      regionKey: region.key,
      regionTitle: region.title,
    },
    clockWeather: {
      worldMinute: state.time.worldMinute,
      day: clockWeather.day,
      timePeriodKey: clockWeather.timePeriodKey,
      timePeriodLabel: clockWeather.timePeriodLabel,
      weatherKey: clockWeather.weatherKey,
      weatherLabel: clockWeather.weatherLabel,
      weatherDescription: clockWeather.weatherDescription,
    },
    primaryQuest,
    pinnedQuests,
  }
}
