import type {
  ProductRuntimeEvent,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldObjectiveStatusV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestDeadlineProjectionV1,
  TextOpenWorldQuestHistoryEntryV1,
  TextOpenWorldQuestInstanceV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldQuestTypeV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { projectTextOpenWorldPlayerMapV1 } from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { effectiveTextOpenWorldSceneLocationKeyV1 } from './scene-eligibility'
import {
  projectTextOpenWorldQuestDeadlineV1,
  projectTextOpenWorldQuestHistoryV1,
} from './quest-history'
import { projectTextOpenWorldQuestInstancesV1 } from './quests'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

export const TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_CATEGORIES_V1 = [
  'main', 'significant', 'ordinary', 'random',
] as const

export const TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_STATUSES_V1 = [
  'revealed', 'accepted', 'active', 'suspended',
  'completed', 'failed', 'expired', 'abandoned', 'withdrawn',
] as const

export const TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_TRACKING_FILTERS_V1 = [
  'all', 'tracked', 'primary', 'pinned', 'untracked',
] as const

export type TextOpenWorldPlayerQuestLogCategoryV1 =
  (typeof TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_CATEGORIES_V1)[number]

export type TextOpenWorldPlayerQuestLogStatusV1 =
  (typeof TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_STATUSES_V1)[number]

export type TextOpenWorldPlayerQuestLogTrackingFilterV1 =
  (typeof TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_TRACKING_FILTERS_V1)[number]

export interface TextOpenWorldPlayerQuestLogFilterV1 {
  categories: TextOpenWorldPlayerQuestLogCategoryV1[]
  statuses: TextOpenWorldPlayerQuestLogStatusV1[]
  tracking: TextOpenWorldPlayerQuestLogTrackingFilterV1
}

export interface TextOpenWorldPlayerQuestLogRegionV1 {
  regionKey: string
  title: string
  knowledge: 'unknown' | 'heard' | 'visited' | 'familiar'
  description: string | null
  theme: string | null
  levelBand: { minimum: number; maximum: number } | null
}

export type TextOpenWorldPlayerQuestLogLocationRoleV1 =
  | 'quest-owner' | 'quest-owner-actor' | 'quest-scene' | 'objective-action'

export interface TextOpenWorldPlayerQuestLogLocationV1 {
  locationKey: string
  regionKey: string
  regionTitle: string
  title: string
  knowledge: 'heard' | 'visited' | 'familiar'
  description: string | null
  current: boolean
  roles: TextOpenWorldPlayerQuestLogLocationRoleV1[]
  stageKeys: string[]
  objectiveKeys: string[]
  /** UI-only map focus. This is deliberately not an Action or travel target. */
  mapFocus: { kind: 'map-location'; locationKey: string }
}

export interface TextOpenWorldPlayerQuestLogObjectiveV1 {
  objectiveKey: string
  title: string
  required: boolean
  status: TextOpenWorldObjectiveStatusV1
  locations: Array<Pick<TextOpenWorldPlayerQuestLogLocationV1, 'locationKey' | 'title' | 'regionKey' | 'regionTitle' | 'knowledge' | 'current' | 'mapFocus'>>
}

export interface TextOpenWorldPlayerQuestKnownFactV1 {
  knowledgeKey: string
  title: string
  content: string
  visibility: 'rumor' | 'known'
}

export interface TextOpenWorldPlayerQuestLogStageV1 {
  stageKey: string
  title: string
  order: number
  position: 'past' | 'current'
  objectives: TextOpenWorldPlayerQuestLogObjectiveV1[]
}

export type TextOpenWorldPlayerQuestRewardPreviewModeV1 =
  | 'none'
  | 'fixed-preview'
  | 'random-hidden'
  | 'fixed-preview-and-random-hidden'

export interface TextOpenWorldPlayerQuestOwnerV1 {
  kind: QuestDefinition['ownerKind']
  key: string | null
  title: string
}

export interface TextOpenWorldPlayerQuestLogEntryV1 {
  instanceKey: string
  definitionKey: string
  category: TextOpenWorldPlayerQuestLogCategoryV1
  status: TextOpenWorldPlayerQuestLogStatusV1
  title: string
  description: string
  owner: TextOpenWorldPlayerQuestOwnerV1
  sourceKind: TextOpenWorldQuestInstanceV1['sourceKind']
  createdAtWorldMinute: number
  offeredAtWorldMinute: number
  acceptedAtWorldMinute: number | null
  terminalAtWorldMinute: number | null
  tracking: 'primary' | 'pinned' | null
  currentStage: { stageKey: string; title: string; order: number } | null
  /** Only disclosed past/current stages are materialized; future entities stay hidden. */
  stages: TextOpenWorldPlayerQuestLogStageV1[]
  deadline: TextOpenWorldQuestDeadlineProjectionV1
  lifecycle: {
    lifecyclePolicy: QuestDefinition['lifecyclePolicy']
    timePolicy: QuestDefinition['timePolicy']
    estimatedMinutes: number
    abandonment: 'protected' | 'restartable' | 'terminal'
    reofferWindow: 'not-restartable' | 'not-abandoned' | 'open' | 'expired'
  }
  regions: TextOpenWorldPlayerQuestLogRegionV1[]
  locations: TextOpenWorldPlayerQuestLogLocationV1[]
  /** Quest-bound facts that this Session has already learned; hidden claims never leave the projector. */
  knownFacts: TextOpenWorldPlayerQuestKnownFactV1[]
  reward: {
    contractKey: string | null
    title: string | null
    configured: boolean
    claimable: boolean
    claimed: boolean
    claimKey: string | null
    preview: {
      mode: TextOpenWorldPlayerQuestRewardPreviewModeV1
      /** Deterministic public reward outcomes only; random tables are never resolved here. */
      lines: string[]
    }
  }
  history: TextOpenWorldQuestHistoryEntryV1[]
  lifecycleEvidence: {
    failed: TextOpenWorldQuestHistoryEntryV1[]
    expired: TextOpenWorldQuestHistoryEntryV1[]
    abandoned: TextOpenWorldQuestHistoryEntryV1[]
    reoffered: TextOpenWorldQuestHistoryEntryV1[]
  }
}

export interface TextOpenWorldPlayerQuestLogProjectionV1 {
  historyStatus: 'ready' | 'awaiting-events'
  filter: TextOpenWorldPlayerQuestLogFilterV1
  visibleTotal: number
  filteredTotal: number
  facets: {
    categories: Record<TextOpenWorldPlayerQuestLogCategoryV1, number>
    statuses: Record<TextOpenWorldPlayerQuestLogStatusV1, number>
    primary: number
    pinned: number
    untracked: number
  }
  entries: TextOpenWorldPlayerQuestLogEntryV1[]
}

type QuestDefinition = TextOpenWorldParsedModulesV1['quests']['quests'][number]
type MapView = ReturnType<typeof projectTextOpenWorldPlayerMapV1>

const VISIBLE_STATUS_SET = new Set<TextOpenWorldQuestStatusV1>(TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_STATUSES_V1)
const TRACKABLE_STATUS_SET = new Set<TextOpenWorldQuestStatusV1>(['revealed', 'accepted', 'active', 'suspended'])
const LOCATION_ROLE_ORDER: TextOpenWorldPlayerQuestLogLocationRoleV1[] = [
  'quest-owner', 'quest-owner-actor', 'quest-scene', 'objective-action',
]
const STATUS_ORDER: Record<TextOpenWorldPlayerQuestLogStatusV1, number> = {
  active: 0,
  accepted: 1,
  revealed: 2,
  suspended: 3,
  completed: 4,
  failed: 5,
  expired: 6,
  abandoned: 7,
  withdrawn: 8,
}
const CATEGORY_ORDER: Record<TextOpenWorldPlayerQuestLogCategoryV1, number> = {
  main: 0,
  significant: 1,
  ordinary: 2,
  random: 3,
}

function fail(message: string): never { throw new Error(`[text-open-world-player-quest-log] ${message}`) }

function isVisibleStatus(value: TextOpenWorldQuestStatusV1): value is TextOpenWorldPlayerQuestLogStatusV1 {
  return VISIBLE_STATUS_SET.has(value)
}

function enumList<T extends string>(
  value: readonly unknown[] | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  if (value == null) return [...allowed]
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const allowedSet = new Set<string>(allowed)
  const parsed = value.map((item, index) => {
    if (typeof item !== 'string' || !allowedSet.has(item)) fail(`${label}[${index}]无效`)
    return item as T
  })
  if (new Set(parsed).size !== parsed.length) fail(`${label}不能重复`)
  return parsed
}

function parseFilter(value: Partial<TextOpenWorldPlayerQuestLogFilterV1> | undefined): TextOpenWorldPlayerQuestLogFilterV1 {
  const tracking = value?.tracking ?? 'all'
  if (!TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_TRACKING_FILTERS_V1.includes(tracking)) fail('filter.tracking无效')
  return {
    categories: enumList(value?.categories, TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_CATEGORIES_V1, 'filter.categories'),
    statuses: enumList(value?.statuses, TEXT_OPEN_WORLD_PLAYER_QUEST_LOG_STATUSES_V1, 'filter.statuses'),
    tracking,
  }
}

/** Maps the frozen runtime Quest vocabulary to the four player-facing tabs. */
export function classifyTextOpenWorldPlayerQuestLogCategoryV1(
  type: TextOpenWorldQuestTypeV1,
): TextOpenWorldPlayerQuestLogCategoryV1 {
  if (type === 'mainline') return 'main'
  if (type === 'significant') return 'significant'
  if (type === 'ordinary') return 'ordinary'
  if (type === 'template') return 'random'
  return fail(`未知任务类型:${String(type)}`)
}

function visibleEventPrefix(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1
  events: readonly ProductRuntimeEvent[]
}): { status: 'ready' | 'awaiting-events'; events: ProductRuntimeEvent[] } {
  if (input.events.length < input.projection.lastEventSequence) {
    // Runtime Projection and Event rows are read independently. During a
    // concurrent refresh, keep the authoritative task body and wait for the
    // matching event prefix instead of presenting partial or guessed history.
    return { status: 'awaiting-events', events: [] }
  }
  const visible = input.events.slice(0, input.projection.lastEventSequence)
  visible.forEach((event, index) => {
    if (event.sequence !== index + 1) fail(`事件序号不连续:${index + 1}->${String(event.sequence)}`)
    if (event.sessionId !== input.sessionId) fail(`事件流混入其他Session:${event.sessionId}`)
    if (typeof event.payloadJson !== 'string') fail(`事件${event.sequence}缺少payloadJson`)
  })
  return { status: 'ready', events: visible }
}

function instanceIsDisclosed(instance: TextOpenWorldQuestInstanceV1): instance is TextOpenWorldQuestInstanceV1 & {
  status: TextOpenWorldPlayerQuestLogStatusV1
  offeredAtWorldMinute: number
} {
  // An available fixed card and a locked future task are implementation facts,
  // not player knowledge. A withdrawn card is visible only if it was offered.
  return isVisibleStatus(instance.status) && instance.offeredAtWorldMinute != null
}

function presentationForInstance(
  instance: TextOpenWorldQuestInstanceV1,
  definition: QuestDefinition,
  modules: TextOpenWorldParsedModulesV1,
  directorHistory: TextOpenWorldSessionProjectionV1['state']['director']['history'],
): { title: string; description: string } {
  if (definition.type !== 'template' || instance.sourceKind !== 'director') {
    return { title: definition.title, description: definition.description }
  }
  const variantKey = directorHistory.find(entry => entry.questInstanceKey === instance.instanceKey)?.variantTextKey ?? null
  const variant = variantKey == null ? null : modules.presentation.taskTextVariants.find(candidate => candidate.key === variantKey)
  return variant ? { title: variant.title, description: variant.description } : {
    title: definition.title,
    description: definition.description,
  }
}

interface MutableLocationReference {
  roles: Set<TextOpenWorldPlayerQuestLogLocationRoleV1>
  stageKeys: Set<string>
  objectiveKeys: Set<string>
}

function locationReferences(input: {
  instance: TextOpenWorldQuestInstanceV1
  definition: QuestDefinition
  state: TextOpenWorldSessionProjectionV1['state']
  modules: TextOpenWorldParsedModulesV1
  mapView: MapView
  disclosedStageKeys: ReadonlySet<string>
}): TextOpenWorldPlayerQuestLogLocationV1[] {
  const references = new Map<string, MutableLocationReference>()
  const add = (
    locationKey: string | null,
    role: TextOpenWorldPlayerQuestLogLocationRoleV1,
    stageKey?: string,
    objectiveKey?: string,
  ) => {
    if (locationKey == null) return
    const current = references.get(locationKey) ?? { roles: new Set(), stageKeys: new Set(), objectiveKeys: new Set() }
    current.roles.add(role)
    if (stageKey) current.stageKeys.add(stageKey)
    if (objectiveKey) current.objectiveKeys.add(objectiveKey)
    references.set(locationKey, current)
  }

  if (input.definition.ownerKind === 'location') add(input.definition.ownerKey, 'quest-owner')
  if (input.definition.ownerKind === 'actor' && input.definition.ownerKey) {
    const actor = input.state.actors[input.definition.ownerKey]
      ?? fail(`任务Owner Actor缺少运行状态:${input.definition.ownerKey}`)
    add(actor.locationKey, 'quest-owner-actor')
  }

  for (const stageKey of input.definition.stageKeys.filter(stageKey => input.disclosedStageKeys.has(stageKey))) {
    const stage = input.modules.quests.stages.find(candidate => candidate.key === stageKey)
      ?? fail(`任务引用未知Stage:${stageKey}`)
    for (const objectiveKey of stage.objectiveKeys) {
      const objective = input.modules.quests.objectives.find(candidate => candidate.key === objectiveKey)
        ?? fail(`Stage引用未知Objective:${objectiveKey}`)
      objective.actionKeys.forEach(actionKey => {
        const action = input.modules.actions.actions.find(candidate => candidate.key === actionKey)
          ?? fail(`Objective引用未知Action:${actionKey}`)
        action.locationKeys.forEach(locationKey => add(locationKey, 'objective-action', stage.key, objective.key))
      })
    }
  }

  if (input.modules.narrative.version === 2) {
    input.modules.narrative.scenes
      .filter(scene => scene.questKey === input.definition.key && (
        scene.sourceKind === 'quest-offer'
        || scene.sourceKind === 'quest-objective'
          && scene.stageKey != null
          && input.disclosedStageKeys.has(scene.stageKey)
        || scene.sourceKind === 'quest-resolution'
          && input.instance.terminalAtWorldMinute != null
          && (scene.stageKey == null || input.disclosedStageKeys.has(scene.stageKey))
      ))
      .forEach(scene => add(
        effectiveTextOpenWorldSceneLocationKeyV1(scene, input.modules.actors.actors),
        'quest-scene',
        scene.stageKey ?? undefined,
        scene.objectiveKey ?? undefined,
      ))
  }

  const visibleLocations = new Map(input.mapView.locations.map(location => [location.locationKey, location]))
  const visibleRegions = new Map(input.mapView.regions.map(region => [region.regionKey, region]))
  return [...references.entries()].flatMap(([locationKey, reference]) => {
    const location = visibleLocations.get(locationKey)
    const region = location ? visibleRegions.get(location.regionKey) : null
    if (!location || !region) return []
    return [{
      locationKey,
      regionKey: location.regionKey,
      regionTitle: region.title,
      title: location.title,
      knowledge: location.knowledge,
      description: location.description,
      current: location.current,
      roles: LOCATION_ROLE_ORDER.filter(role => reference.roles.has(role)),
      stageKeys: [...reference.stageKeys].sort(),
      objectiveKeys: [...reference.objectiveKeys].sort(),
      mapFocus: { kind: 'map-location' as const, locationKey },
    }]
  }).sort((left, right) => Number(right.current) - Number(left.current)
    || left.title.localeCompare(right.title)
    || left.locationKey.localeCompare(right.locationKey))
}

function trackingFor(
  instance: TextOpenWorldQuestInstanceV1,
  projection: TextOpenWorldSessionProjectionV1,
): TextOpenWorldPlayerQuestLogEntryV1['tracking'] {
  if (!TRACKABLE_STATUS_SET.has(instance.status)) return null
  if (projection.state.quests.tracking.primaryInstanceKey === instance.instanceKey) return 'primary'
  if (projection.state.quests.tracking.pinnedInstanceKeys.includes(instance.instanceKey)) return 'pinned'
  return null
}

function ownerFor(
  definition: QuestDefinition,
  modules: TextOpenWorldParsedModulesV1,
): TextOpenWorldPlayerQuestOwnerV1 {
  const ownerKey = definition.ownerKey
  if (definition.ownerKind === 'global') {
    return { kind: 'global', key: null, title: definition.type === 'mainline' ? '主线' : '世界' }
  }
  if (ownerKey == null) return fail(`任务${definition.key}缺少Owner Key`)
  if (definition.ownerKind === 'actor') {
    const actor = modules.actors.actors.find(candidate => candidate.key === ownerKey)
      ?? fail(`任务${definition.key}引用未知Owner Actor:${ownerKey}`)
    return { kind: 'actor', key: ownerKey, title: actor.name }
  }
  if (definition.ownerKind === 'faction') {
    const faction = modules.actors.factions.find(candidate => candidate.key === ownerKey)
      ?? fail(`任务${definition.key}引用未知Owner Faction:${ownerKey}`)
    return { kind: 'faction', key: ownerKey, title: faction.title }
  }
  if (definition.ownerKind === 'region') {
    const region = modules.world.regions.find(candidate => candidate.key === ownerKey)
      ?? fail(`任务${definition.key}引用未知Owner Region:${ownerKey}`)
    return { kind: 'region', key: ownerKey, title: region.title }
  }
  const location = modules.world.locations.find(candidate => candidate.key === ownerKey)
    ?? fail(`任务${definition.key}引用未知Owner Location:${ownerKey}`)
  return { kind: 'location', key: ownerKey, title: location.title }
}

function fixedRewardLine(input: {
  effect: TextOpenWorldEffectDefinitionV1
  modules: TextOpenWorldParsedModulesV1
  mapView: MapView
  state: TextOpenWorldSessionProjectionV1['state']
}): string | null {
  const { effect, modules } = input
  const itemTitle = (itemKey: string) => modules.items.items.find(item => item.key === itemKey)?.title
    ?? fail(`奖励Effect引用未知物品:${itemKey}`)
  const skillTitle = (skillKey: string) => modules.progression.skills.find(skill => skill.key === skillKey)?.title
    ?? fail(`奖励Effect引用未知技能:${skillKey}`)
  const recipeTitle = (recipeKey: string) => modules.crafting.recipes.find(recipe => recipe.key === recipeKey)?.title
    ?? fail(`奖励Effect引用未知配方:${recipeKey}`)
  const factionTitle = (factionKey: string) => modules.actors.factions.find(faction => faction.key === factionKey)?.title
    ?? fail(`奖励Effect引用未知阵营:${factionKey}`)
  switch (effect.operation) {
    case 'claim-quest-reward': return null
    case 'grant-experience': return `获得${effect.payload.amount}点经验`
    case 'grant-item': return `获得${itemTitle(effect.payload.itemKey)} × ${effect.payload.quantity}`
    case 'learn-skill': return `学会技能：${skillTitle(effect.payload.skillKey)}`
    case 'learn-recipe': return `学会配方：${recipeTitle(effect.payload.recipeKey)}`
    case 'change-currency': return `${effect.payload.amount >= 0 ? '获得' : '扣除'}${Math.abs(effect.payload.amount)}${modules.economy.currency.label}`
    case 'change-morality': return `道德评价${effect.payload.amount >= 0 ? '提高' : '降低'}${Math.abs(effect.payload.amount)}`
    case 'change-faction-affinity': return `${factionTitle(effect.payload.factionKey)}亲合度${effect.payload.amount >= 0 ? '提高' : '降低'}${Math.abs(effect.payload.amount)}`
    case 'reveal-knowledge': {
      const entry = modules.knowledge.entries.find(candidate => candidate.key === effect.payload.knowledgeKey)
        ?? fail(`奖励Effect引用未知知识:${effect.payload.knowledgeKey}`)
      return input.state.knowledge.visibilityByKey[entry.key] === 'hidden' ? '获得一条新线索' : `获得线索：${entry.title}`
    }
    case 'reveal-location': {
      const location = input.mapView.locations.find(candidate => candidate.locationKey === effect.payload.locationKey)
      return location ? `发现地点：${location.title}` : '发现新地点'
    }
    case 'unlock-fast-travel': {
      const point = modules.world.fastTravelPoints.find(candidate => candidate.key === effect.payload.fastTravelPointKey)
        ?? fail(`奖励Effect引用未知快速旅行点:${effect.payload.fastTravelPointKey}`)
      const location = input.mapView.locations.find(candidate => candidate.locationKey === point.locationKey)
      return location ? `解锁快速旅行：${location.title}` : '解锁快速旅行点'
    }
    case 'set-world-flag': return '世界状态发生变化'
    case 'earn-achievement': {
      const achievement = modules.knowledge.achievements.find(candidate => candidate.key === effect.payload.achievementKey)
        ?? fail(`奖励Effect引用未知成就:${effect.payload.achievementKey}`)
      return `获得成就：${achievement.title}`
    }
    default: return fail(`RewardContract包含不可预览Effect:${effect.key}:${effect.operation}`)
  }
}

function rewardFor(input: {
  instance: TextOpenWorldQuestInstanceV1
  definition: QuestDefinition
  projection: TextOpenWorldSessionProjectionV1
  modules: TextOpenWorldParsedModulesV1
  mapView: MapView
}): TextOpenWorldPlayerQuestLogEntryV1['reward'] {
  if (input.definition.rewardContractKey == null) {
    return {
      contractKey: null, title: null, configured: false, claimable: false,
      claimed: false, claimKey: null,
      preview: { mode: 'none', lines: [] },
    }
  }
  const contract = input.modules.items.rewardContracts.find(candidate => candidate.key === input.definition.rewardContractKey)
    ?? fail(`任务${input.definition.key}引用未知RewardContract:${input.definition.rewardContractKey}`)
  const effectByKey = new Map(input.modules.actions.effects.map(effect => [effect.key, effect]))
  const lines = contract.effectKeys.flatMap(effectKey => {
    const effect = effectByKey.get(effectKey) ?? fail(`RewardContract引用未知Effect:${effectKey}`)
    const line = fixedRewardLine({ effect, modules: input.modules, mapView: input.mapView, state: input.projection.state })
    return line == null ? [] : [line]
  })
  const randomTableCount = contract.dropTableKeys.length
  const mode: TextOpenWorldPlayerQuestRewardPreviewModeV1 = lines.length
    ? randomTableCount ? 'fixed-preview-and-random-hidden' : 'fixed-preview'
    : randomTableCount ? 'random-hidden' : 'none'
  return {
    contractKey: contract.key,
    title: contract.title,
    configured: true,
    claimable: input.instance.status === 'completed' && input.instance.rewardClaimKey == null,
    claimed: input.instance.rewardClaimKey != null,
    claimKey: input.instance.rewardClaimKey,
    preview: { mode, lines },
  }
}

function projectEntry(input: {
  instance: TextOpenWorldQuestInstanceV1 & { status: TextOpenWorldPlayerQuestLogStatusV1; offeredAtWorldMinute: number }
  definition: QuestDefinition
  projection: TextOpenWorldSessionProjectionV1
  modules: TextOpenWorldParsedModulesV1
  mapView: MapView
  history: TextOpenWorldQuestHistoryEntryV1[]
}): TextOpenWorldPlayerQuestLogEntryV1 {
  const { instance, definition, projection, modules } = input
  const orderedStages = definition.stageKeys
    .map(stageKey => modules.quests.stages.find(stage => stage.key === stageKey) ?? fail(`任务引用未知Stage:${stageKey}`))
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
  const currentStageIndex = instance.currentStageKey == null
    ? -1
    : orderedStages.findIndex(stage => stage.key === instance.currentStageKey)
  if (instance.currentStageKey != null && currentStageIndex < 0) fail(`任务实例引用定义外Stage:${instance.currentStageKey}`)
  const disclosedStages = currentStageIndex < 0 ? [] : orderedStages.slice(0, currentStageIndex + 1)
  const disclosedStageKeys = new Set(disclosedStages.map(stage => stage.key))
  const locations = locationReferences({
    instance,
    definition,
    state: projection.state,
    modules,
    mapView: input.mapView,
    disclosedStageKeys,
  })
  const locationByObjectiveKey = new Map<string, TextOpenWorldPlayerQuestLogLocationV1[]>()
  locations.forEach(location => location.objectiveKeys.forEach(objectiveKey => {
    const current = locationByObjectiveKey.get(objectiveKey) ?? []
    current.push(location)
    locationByObjectiveKey.set(objectiveKey, current)
  }))
  const stages = disclosedStages.map((stage, stageIndex): TextOpenWorldPlayerQuestLogStageV1 => ({
    stageKey: stage.key,
    title: stage.title,
    order: stage.order,
    position: stageIndex < currentStageIndex ? 'past' : 'current',
    objectives: stage.objectiveKeys.map(objectiveKey => {
      const objective = modules.quests.objectives.find(candidate => candidate.key === objectiveKey)
        ?? fail(`Stage引用未知Objective:${objectiveKey}`)
      const status = instance.objectiveStatusByKey[objective.key]
      if (status == null) fail(`任务实例缺少Objective状态:${objective.key}`)
      return {
        objectiveKey: objective.key,
        title: objective.title,
        required: !objective.optional,
        status,
        locations: (locationByObjectiveKey.get(objective.key) ?? []).map(location => ({
          locationKey: location.locationKey,
          title: location.title,
          regionKey: location.regionKey,
          regionTitle: location.regionTitle,
          knowledge: location.knowledge,
          current: location.current,
          mapFocus: structuredClone(location.mapFocus),
        })),
      }
    }),
  }))
  const currentStage = currentStageIndex < 0 ? null : orderedStages[currentStageIndex]
  const presentation = presentationForInstance(instance, definition, modules, projection.state.director.history)
  const questKnowledgeKeys = new Set(modules.narrative.version === 2
    ? modules.narrative.scenes
      .filter(scene => scene.questKey === definition.key && (
        scene.sourceKind === 'quest-offer'
        || scene.sourceKind === 'quest-objective'
          && scene.stageKey != null
          && disclosedStageKeys.has(scene.stageKey)
        || scene.sourceKind === 'quest-resolution'
          && instance.terminalAtWorldMinute != null
          && (scene.stageKey == null || disclosedStageKeys.has(scene.stageKey))
      ))
      .flatMap(scene => scene.allowedKnowledgeClaimKeys)
    : [])
  const knownFacts = modules.knowledge.entries.flatMap(entry => {
    if (!questKnowledgeKeys.has(entry.key)) return []
    const visibility = projection.state.knowledge.visibilityByKey[entry.key] ?? 'hidden'
    if (visibility !== 'rumor' && visibility !== 'known') return []
    const rumor = visibility === 'rumor'
      ? [...modules.knowledge.rumors]
        .filter(candidate => candidate.knowledgeKey === entry.key
          && projection.state.knowledge.readRumorKeys.includes(candidate.key))
        .sort((left, right) => left.key.localeCompare(right.key))[0] ?? null
      : null
    // A rumor grants access only to its authored rumor wording. Falling back
    // to canonical Knowledge content here would label a spoiler as hearsay.
    if (visibility === 'rumor' && rumor == null) return []
    return [{
      knowledgeKey: entry.key,
      title: entry.title,
      content: rumor?.text ?? entry.content,
      visibility,
    }]
  }).sort((left, right) => left.title.localeCompare(right.title)
    || left.knowledgeKey.localeCompare(right.knowledgeKey))
  const visibleRegionKeys = new Set([
    ...locations.map(location => location.regionKey),
    ...definition.ownerKind === 'region' && definition.ownerKey ? [definition.ownerKey] : [],
  ])
  const history = input.history.filter(entry => entry.instanceKey === instance.instanceKey)
  const hasGovernedRestartAction = modules.actions.version >= 16
    && modules.actions.actions.some(action => (
      action.key === `action.restart.${definition.key}`
      && action.category === 'restart-quest'
    ))
  const abandonment = definition.lifecyclePolicy === 'protected-wait'
    ? 'protected' as const
    : definition.lifecyclePolicy === 'abandon-restart' && hasGovernedRestartAction
      ? 'restartable' as const
      : 'terminal' as const
  const reofferWindow = abandonment !== 'restartable'
    ? 'not-restartable' as const
    : instance.status !== 'abandoned'
      ? 'not-abandoned' as const
      : projectTextOpenWorldQuestDeadlineV1(instance, projection.state.time.worldMinute).expired
        ? 'expired' as const
        : 'open' as const
  return {
    instanceKey: instance.instanceKey,
    definitionKey: definition.key,
    category: classifyTextOpenWorldPlayerQuestLogCategoryV1(definition.type),
    status: instance.status,
    title: presentation.title,
    description: presentation.description,
    owner: ownerFor(definition, modules),
    sourceKind: instance.sourceKind,
    createdAtWorldMinute: instance.createdAtWorldMinute,
    offeredAtWorldMinute: instance.offeredAtWorldMinute,
    acceptedAtWorldMinute: instance.acceptedAtWorldMinute,
    terminalAtWorldMinute: instance.terminalAtWorldMinute,
    tracking: trackingFor(instance, projection),
    currentStage: currentStage ? { stageKey: currentStage.key, title: currentStage.title, order: currentStage.order } : null,
    stages,
    deadline: projectTextOpenWorldQuestDeadlineV1(instance, projection.state.time.worldMinute),
    lifecycle: {
      lifecyclePolicy: definition.lifecyclePolicy,
      timePolicy: definition.timePolicy,
      estimatedMinutes: definition.estimatedMinutes,
      abandonment,
      reofferWindow,
    },
    regions: input.mapView.regions.filter(region => visibleRegionKeys.has(region.regionKey)).map(region => ({
      regionKey: region.regionKey,
      title: region.title,
      knowledge: region.knowledge,
      description: region.description,
      theme: region.theme,
      levelBand: region.levelBand ? structuredClone(region.levelBand) : null,
    })),
    locations,
    knownFacts,
    reward: rewardFor({ instance, definition, projection, modules, mapView: input.mapView }),
    history,
    lifecycleEvidence: {
      failed: history.filter(entry => entry.kind === 'failed'),
      expired: history.filter(entry => entry.kind === 'expired'),
      abandoned: history.filter(entry => entry.kind === 'abandoned'),
      reoffered: history.filter(entry => entry.kind === 'reoffered'),
    },
  }
}

function sortEntries(
  left: TextOpenWorldPlayerQuestLogEntryV1,
  right: TextOpenWorldPlayerQuestLogEntryV1,
): number {
  const trackingRank = (entry: TextOpenWorldPlayerQuestLogEntryV1) => entry.tracking === 'primary' ? 0 : entry.tracking === 'pinned' ? 1 : 2
  return trackingRank(left) - trackingRank(right)
    || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    || CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category]
    || right.offeredAtWorldMinute - left.offeredAtWorldMinute
    || left.instanceKey.localeCompare(right.instanceKey)
}

function matchesTracking(entry: TextOpenWorldPlayerQuestLogEntryV1, filter: TextOpenWorldPlayerQuestLogTrackingFilterV1): boolean {
  if (filter === 'all') return true
  if (filter === 'tracked') return entry.tracking != null
  if (filter === 'untracked') return entry.tracking == null
  return entry.tracking === filter
}

/**
 * Complete, deterministic player task log derived from the frozen Release,
 * authoritative Session Projection and its visible canonical event prefix.
 * It owns no persistence and exposes map-focus references, never gameplay
 * commands, for disclosed locations only.
 */
export function projectTextOpenWorldPlayerQuestLogV1(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1 | unknown
  events: readonly ProductRuntimeEvent[]
  filter?: Partial<TextOpenWorldPlayerQuestLogFilterV1>
}): TextOpenWorldPlayerQuestLogProjectionV1 {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const mapView = projectTextOpenWorldPlayerMapV1({ runtimePackage: projection.runtimePackage, state: projection.state })
  const eventPrefix = visibleEventPrefix({ sessionId: input.sessionId, projection, events: input.events })
  const history = eventPrefix.status === 'ready'
    ? projectTextOpenWorldQuestHistoryV1({ runtimePackage: projection.runtimePackage, events: eventPrefix.events })
    : []
  const filter = parseFilter(input.filter)
  const allEntries = projectTextOpenWorldQuestInstancesV1(modules, projection.state.quests)
    .flatMap(({ instance, definition }) => instanceIsDisclosed(instance)
      ? [projectEntry({ instance, definition, projection, modules, mapView, history })]
      : [])
    .sort(sortEntries)
  const facets: TextOpenWorldPlayerQuestLogProjectionV1['facets'] = {
    categories: { main: 0, significant: 0, ordinary: 0, random: 0 },
    statuses: {
      revealed: 0, accepted: 0, active: 0, suspended: 0,
      completed: 0, failed: 0, expired: 0, abandoned: 0, withdrawn: 0,
    },
    primary: 0,
    pinned: 0,
    untracked: 0,
  }
  allEntries.forEach(entry => {
    facets.categories[entry.category] += 1
    facets.statuses[entry.status] += 1
    if (entry.tracking === 'primary') facets.primary += 1
    else if (entry.tracking === 'pinned') facets.pinned += 1
    else facets.untracked += 1
  })
  const categoryFilter = new Set(filter.categories)
  const statusFilter = new Set(filter.statuses)
  const entries = allEntries.filter(entry => categoryFilter.has(entry.category)
    && statusFilter.has(entry.status)
    && matchesTracking(entry, filter.tracking))
  return {
    historyStatus: eventPrefix.status,
    filter,
    visibleTotal: allEntries.length,
    filteredTotal: entries.length,
    facets,
    entries,
  }
}
