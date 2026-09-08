import type {
  ProductRuntimeEvent,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { projectTextOpenWorldActorsV1 } from './actors'
import { projectTextOpenWorldPlayerMapV1 } from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { projectTextOpenWorldPlayerInventoryV1 } from './player-inventory'
import {
  projectTextOpenWorldPlayerNotificationsV1,
  type TextOpenWorldPlayerNotificationCategoryV1,
} from './player-notifications'
import { projectTextOpenWorldRelationshipsV1 } from './relationships'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

export const TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1 = [
  'relationships',
  'encyclopedia',
  'rumors',
  'history',
  'achievements',
] as const

export type TextOpenWorldPlayerWorldRecordTabV1 =
  (typeof TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1)[number]

export type TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1 =
  | 'places' | 'people' | 'factions' | 'items' | 'lore' | 'enemies' | 'clues'

export interface TextOpenWorldPlayerWorldRecordProjectionV1 {
  relationships: {
    morality: { value: number; minimum: number; maximum: number }
    factions: Array<{ uiId: string; title: string; affinity: number }>
    actors: Array<{
      uiId: string
      name: string
      factionTitle: string | null
      attitude: 'bad' | 'neutral' | 'good'
      attitudeLabel: string
      greetingTone: string
      contextLabels: string[]
      knownReasonLabels: string[]
      optionalInteractionSummary: string
      tradeSummary: string | null
    }>
    recentChanges: Array<{
      uiId: string
      title: string
      detail: string | null
      timeLabel: string | null
    }>
  }
  encyclopedia: {
    categories: Array<{
      kind: TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1
      label: string
      count: number
    }>
    entries: Array<{
      uiId: string
      category: TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1
      categoryLabel: string
      title: string
      summary: string
      certainty: 'public-outline' | 'heard' | 'visited' | 'familiar' | 'known' | 'owned'
      certaintyLabel: string
      details: string[]
      /** Submission-only map target. The component must never render it. */
      mapFocus: { kind: 'map-location'; locationKey: string } | null
    }>
  }
  rumors: {
    entries: Array<{
      uiId: string
      text: string
      reliability: 'uncertain' | 'likely' | 'confirmed'
      reliabilityLabel: string
      relatedFactKnown: boolean
      relatedFactStatusLabel: string
      heardAtLabel: string | null
      regionTitle: string | null
    }>
  }
  history: {
    status: 'ready' | 'awaiting-events'
    eventEntries: Array<{
      uiId: string
      categoryLabel: string
      headline: string
      details: string[]
      timeLabel: string | null
      originLabel: string
    }>
    knowledgeEntries: Array<{
      uiId: string
      kindLabel: string
      headline: string
      details: string[]
      timeLabel: string
      regionTitle: string | null
    }>
  }
  achievements: {
    earnedCount: number
    totalCount: number
    lockedCount: number
    earned: Array<{
      uiId: string
      title: string
      description: string
      earnedAtLabel: string | null
      regionTitle: string | null
    }>
  }
}

const DISCLOSED_QUEST_STATUSES = new Set<TextOpenWorldQuestStatusV1>([
  'revealed', 'accepted', 'active', 'suspended', 'completed', 'failed',
  'expired', 'abandoned', 'withdrawn',
])

const ENCYCLOPEDIA_CATEGORY_LABELS: Record<TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1, string> = {
  places: '地点',
  people: '人物',
  factions: '势力',
  items: '物品',
  lore: '见闻',
  enemies: '敌人与威胁',
  clues: '线索',
}

const NOTIFICATION_CATEGORY_LABELS: Record<TextOpenWorldPlayerNotificationCategoryV1, string> = {
  player: '角色',
  inventory: '物品',
  quest: '任务',
  world: '世界',
  relationship: '关系',
  combat: '战斗',
  achievement: '成就',
  'random-event': '随机事件',
}

const RUMOR_RELIABILITY_LABELS = {
  uncertain: '未经证实',
  likely: '较为可信',
  confirmed: '来源可靠',
} as const

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function timeLabel(modules: TextOpenWorldParsedModulesV1, worldMinute: number): string {
  const minuteInDay = worldMinute % modules['time-weather'].minutesPerDay
  const period = modules['time-weather'].timePeriods.find(candidate => (
    minuteInDay >= candidate.startMinute && minuteInDay < candidate.endMinute
  ))
  return `第 ${Math.floor(worldMinute / modules['time-weather'].minutesPerDay) + 1} 天${period ? ` · ${period.label}` : ''}`
}

function disclosedQuestOwnerKeys(
  projection: TextOpenWorldSessionProjectionV1,
  modules: TextOpenWorldParsedModulesV1,
): { actorKeys: Set<string>; factionKeys: Set<string> } {
  const actorKeys = new Set<string>()
  const factionKeys = new Set<string>()
  Object.values(projection.state.quests.instancesByKey).forEach(instance => {
    // Keep this predicate aligned with the canonical player task log: locked
    // and merely available cards are production facts until they are offered.
    if (!DISCLOSED_QUEST_STATUSES.has(instance.status) || instance.offeredAtWorldMinute == null) return
    const definition = modules.quests.quests.find(candidate => candidate.key === instance.definitionKey)
    if (!definition?.ownerKey) return
    if (definition.ownerKind === 'actor') actorKeys.add(definition.ownerKey)
    if (definition.ownerKind === 'faction') factionKeys.add(definition.ownerKey)
  })
  return { actorKeys, factionKeys }
}

function knownEntityKeys(
  projection: TextOpenWorldSessionProjectionV1,
  modules: TextOpenWorldParsedModulesV1,
): {
  currentActorKeys: Set<string>
  questActorKeys: Set<string>
  actorKeys: string[]
  factionKeys: Set<string>
} {
  const currentActorKeys = new Set(modules.actors.actors.filter(actor => {
    const state = projection.state.actors[actor.key]
    return state?.alive && state.present && state.locationKey === projection.state.map.currentLocationKey
  }).map(actor => actor.key))
  const questOwners = disclosedQuestOwnerKeys(projection, modules)
  const actorKeySet = new Set([...currentActorKeys, ...questOwners.actorKeys])
  const actorKeys = modules.actors.actors.filter(actor => actorKeySet.has(actor.key)).map(actor => actor.key)
  const factionKeys = new Set(questOwners.factionKeys)
  actorKeys.forEach(actorKey => {
    const factionKey = modules.actors.actors.find(actor => actor.key === actorKey)?.factionKey
    if (factionKey) factionKeys.add(factionKey)
  })
  return { currentActorKeys, questActorKeys: questOwners.actorKeys, actorKeys, factionKeys }
}

function knowledgeCategory(
  kind: TextOpenWorldParsedModulesV1['knowledge']['entries'][number]['kind'],
): TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1 {
  if (kind === 'location') return 'places'
  if (kind === 'actor') return 'people'
  if (kind === 'faction') return 'factions'
  if (kind === 'enemy') return 'enemies'
  if (kind === 'quest-clue') return 'clues'
  return 'lore'
}

function projectKnowledgeHistory(input: {
  projection: TextOpenWorldSessionProjectionV1
  modules: TextOpenWorldParsedModulesV1
  visibleRegionTitleByKey: Map<string, string>
}): TextOpenWorldPlayerWorldRecordProjectionV1['history']['knowledgeEntries'] {
  const { projection, modules, visibleRegionTitleByKey } = input
  const entries = projection.state.knowledge.history.flatMap((history, index) => {
    const common = {
      uiId: `knowledge-history-${index + 1}`,
      timeLabel: timeLabel(modules, history.worldMinute),
      regionTitle: visibleRegionTitleByKey.get(history.regionKey) ?? null,
    }
    if (history.kind === 'knowledge-revealed') {
      const definition = modules.knowledge.entries.find(candidate => candidate.key === history.targetKey)
      const visibility = projection.state.knowledge.visibilityByKey[history.targetKey]
      if (!definition || visibility === 'hidden' || visibility == null) return []
      const pairedRumorRead = projection.state.knowledge.history.some(candidate => {
        if (candidate.kind !== 'rumor-read'
          || candidate.sourceKey !== history.sourceKey
          || candidate.regionKey !== history.regionKey
          || candidate.worldMinute !== history.worldMinute) return false
        return modules.knowledge.rumors.some(rumor => (
          rumor.key === candidate.targetKey && rumor.knowledgeKey === history.targetKey
        ))
      })
      // Director writes a rumor-read and a visibility transition together. The
      // rumor entry is the player-visible historical event; retaining the paired
      // transition would later rewrite that past moment with today's confirmed
      // truth and duplicate the timeline.
      if (pairedRumorRead) return []
      return [{
        ...common,
        kindLabel: '知识',
        headline: visibility === 'known' ? `知识已确认：${definition.title}` : '获得一条新线索',
        details: visibility === 'known' ? [definition.content] : ['这条线索仍待核实。'],
      }]
    }
    if (history.kind === 'rumor-read') {
      const rumor = modules.knowledge.rumors.find(candidate => candidate.key === history.targetKey)
      const visibility = rumor ? projection.state.knowledge.visibilityByKey[rumor.knowledgeKey] : null
      if (!rumor || !projection.state.knowledge.readRumorKeys.includes(rumor.key)
        || visibility === 'hidden' || visibility == null) return []
      return [{ ...common, kindLabel: '传闻', headline: '听闻一则传闻', details: [rumor.text] }]
    }
    if (history.kind === 'achievement-earned') {
      const achievement = modules.knowledge.achievements.find(candidate => candidate.key === history.targetKey)
      if (!achievement || !projection.state.knowledge.earnedAchievementKeys.includes(achievement.key)) return []
      return [{
        ...common,
        kindLabel: '成就',
        headline: `获得成就：${achievement.title}`,
        details: [achievement.description],
      }]
    }
    const event = modules.director.randomEvents.find(candidate => candidate.key === history.targetKey)
    const matchingDirectorHistory = projection.state.director.history.some(candidate => (
      candidate.outcomeKind === 'random-event'
        && candidate.sourceKey === history.targetKey
        && candidate.regionKey === history.regionKey
        && candidate.worldMinute === history.worldMinute
    ))
    if (!event || !projection.state.knowledge.seenRandomEventKeys.includes(event.key) || !matchingDirectorHistory) return []
    return [{ ...common, kindLabel: '随机事件', headline: `经历随机事件：${event.title}`, details: [] }]
  })
  return entries.slice(-100).reverse()
}

/**
 * Builds the only DTO consumed by the player-facing world record. It deliberately
 * strips stable content keys, hidden catalog rows, scoring weights and source
 * references; the one retained location key is an opaque map-navigation target.
 */
export function projectTextOpenWorldPlayerWorldRecordV1(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1 | unknown
  events: readonly ProductRuntimeEvent[]
}): TextOpenWorldPlayerWorldRecordProjectionV1 {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) {
    throw new Error('[text-open-world-player-world-record] sessionId无效')
  }
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const map = projectTextOpenWorldPlayerMapV1({ runtimePackage: projection.runtimePackage, state: projection.state })
  const inventory = projectTextOpenWorldPlayerInventoryV1(projection)
  const entityKeys = knownEntityKeys(projection, modules)
  const relationshipRules = projectTextOpenWorldRelationshipsV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
    actorKeys: entityKeys.actorKeys,
    factionKeys: [...entityKeys.factionKeys],
    parsedModules: modules,
  })
  const visibleRegionTitleByKey = new Map(map.regions.map(region => [region.regionKey, region.title]))
  const eventStatus = input.events.length < projection.lastEventSequence ? 'awaiting-events' : 'ready'
  const notifications = eventStatus === 'ready'
    ? projectTextOpenWorldPlayerNotificationsV1({
        sessionId: input.sessionId,
        projection,
        events: input.events,
        limit: 100,
      })
    : []

  const factionTitleByKey = new Map(modules.actors.factions.map(faction => [faction.key, faction.title]))
  const currentRuntimeActorByKey = new Map(projectTextOpenWorldActorsV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
    parsedModules: modules,
    locationKey: projection.state.map.currentLocationKey,
  }).map(actor => [actor.key, actor]))
  const actors = relationshipRules.actors.map((actor, index) => {
    const current = entityKeys.currentActorKeys.has(actor.actorKey)
    const questContact = entityKeys.questActorKeys.has(actor.actorKey)
    const lifecycle = projection.state.actors[actor.actorKey]
    const alive = lifecycle?.alive === true
    const present = lifecycle?.present === true
    const availableServiceKeys = new Set(
      currentRuntimeActorByKey.get(actor.actorKey)?.availableServices.map(service => service.key) ?? [],
    )
    const hasCurrentVendor = current && modules.economy.vendors.some(vendor => (
      vendor.actorKey === actor.actorKey
      && vendor.locationKey === projection.state.map.currentLocationKey
      && availableServiceKeys.has(vendor.key)
    ))
    return {
      uiId: `relationship-actor-${index + 1}`,
      name: actor.actorName,
      factionTitle: actor.factionKey ? factionTitleByKey.get(actor.factionKey) ?? null : null,
      attitude: actor.attitude,
      attitudeLabel: actor.label,
      greetingTone: actor.greetingTone,
      contextLabels: [
        current ? '当前位置人物' : null,
        questContact ? '已揭示任务联系人' : null,
        !alive ? '已经死亡' : questContact && !current ? present ? '不在当前位置' : '当前不在场' : null,
      ]
        .filter((value): value is string => value != null),
      knownReasonLabels: [
        actor.reasons.morality !== 0 ? '当前道德评价' : null,
        actor.reasons.factionAffinity !== 0 && actor.factionKey
          ? `${factionTitleByKey.get(actor.factionKey) ?? '所属势力'}亲合度`
          : null,
        actor.reasons.experiencedStory !== 0 ? '已经历故事' : null,
      ].filter((value): value is string => value != null),
      optionalInteractionSummary: !alive
        ? '该角色已经死亡，无法互动'
        : !current
          ? present ? '需要前往角色所在地点后互动' : '需要等待或寻找该角色后互动'
          : actor.optionalInteractionPolicy === 'may-refuse'
            ? '可能拒绝非关键互动'
            : '可以尝试互动',
      tradeSummary: hasCurrentVendor ? '当前位置可提供交易服务' : null,
    }
  })
  const factions = relationshipRules.factions
    .filter(faction => entityKeys.factionKeys.has(faction.key))
    .map((faction, index) => ({ uiId: `relationship-faction-${index + 1}`, title: faction.title, affinity: faction.affinity }))

  const encyclopediaEntries: TextOpenWorldPlayerWorldRecordProjectionV1['encyclopedia']['entries'] = []
  map.regions.forEach(region => {
    const visited = region.knowledge === 'visited' || region.knowledge === 'familiar'
    encyclopediaEntries.push({
      uiId: `encyclopedia-region-${encyclopediaEntries.length + 1}`,
      category: 'places', categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS.places,
      title: region.title,
      summary: visited ? region.description ?? '这个地区已经进入你的旅途记录。' : region.knowledge === 'heard' ? '听闻过这个地区。' : '公开地图轮廓。',
      certainty: region.knowledge === 'familiar'
        ? 'familiar'
        : region.knowledge === 'visited'
          ? 'visited'
          : region.knowledge === 'heard' ? 'heard' : 'public-outline',
      certaintyLabel: visited ? region.knowledge === 'familiar' ? '熟悉' : '到访' : region.knowledge === 'heard' ? '听闻' : '公开轮廓',
      details: visited && region.theme ? [`地区主题：${region.theme}`] : [],
      mapFocus: null,
    })
  })
  map.locations.forEach(location => {
    const visited = location.knowledge === 'visited' || location.knowledge === 'familiar'
    encyclopediaEntries.push({
      uiId: `encyclopedia-location-${encyclopediaEntries.length + 1}`,
      category: 'places', categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS.places,
      title: location.title,
      summary: visited ? location.description ?? '这个地点已经进入你的旅途记录。' : '听闻过这个地点，详情仍待探索。',
      certainty: location.knowledge,
      certaintyLabel: location.knowledge === 'familiar' ? '熟悉' : location.knowledge === 'visited' ? '到访' : '听闻',
      details: visited && location.functions?.length ? [`可见功能：${location.functions.join('、')}`] : [],
      mapFocus: { kind: 'map-location', locationKey: location.locationKey },
    })
  })
  actors.forEach(actor => encyclopediaEntries.push({
    uiId: `encyclopedia-person-${encyclopediaEntries.length + 1}`,
    category: 'people', categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS.people,
    title: actor.name,
    summary: `${actor.attitudeLabel} · ${actor.greetingTone}`,
    certainty: 'known', certaintyLabel: '已认识',
    details: [actor.factionTitle ? `所属势力：${actor.factionTitle}` : null, ...actor.contextLabels]
      .filter((value): value is string => value != null),
    mapFocus: null,
  }))
  factions.forEach(faction => encyclopediaEntries.push({
    uiId: `encyclopedia-faction-${encyclopediaEntries.length + 1}`,
    category: 'factions', categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS.factions,
    title: faction.title,
    summary: `当前亲合度 ${faction.affinity}`,
    certainty: 'known', certaintyLabel: '已接触', details: [], mapFocus: null,
  }))
  inventory.items.forEach(item => encyclopediaEntries.push({
    uiId: `encyclopedia-item-${encyclopediaEntries.length + 1}`,
    category: 'items', categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS.items,
    title: item.title, summary: item.description,
    certainty: 'owned', certaintyLabel: '当前持有',
    details: [`${item.category.label} · 数量 ${item.quantity}`, ...(item.equippedSlot ? [`已装备：${item.equippedSlot.label}`] : [])],
    mapFocus: null,
  }))
  modules.knowledge.entries.filter(entry => (
    projection.state.knowledge.visibilityByKey[entry.key] === 'known'
  )).forEach(entry => {
    const category = knowledgeCategory(entry.kind)
    encyclopediaEntries.push({
      uiId: `encyclopedia-knowledge-${encyclopediaEntries.length + 1}`,
      category, categoryLabel: ENCYCLOPEDIA_CATEGORY_LABELS[category],
      title: entry.title, summary: entry.content,
      certainty: 'known', certaintyLabel: '已确认', details: [], mapFocus: null,
    })
  })
  encyclopediaEntries.sort((left, right) => (
    compareText(left.category, right.category) || compareText(left.title, right.title) || compareText(left.uiId, right.uiId)
  ))
  const encyclopediaCategories = (Object.keys(ENCYCLOPEDIA_CATEGORY_LABELS) as TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1[])
    .map(kind => ({
      kind,
      label: ENCYCLOPEDIA_CATEGORY_LABELS[kind],
      count: encyclopediaEntries.filter(entry => entry.category === kind).length,
    }))
    .filter(category => category.count > 0)

  const rumors = projection.state.knowledge.readRumorKeys.flatMap((rumorKey, index) => {
    const rumor = modules.knowledge.rumors.find(candidate => candidate.key === rumorKey)
    const visibility = rumor ? projection.state.knowledge.visibilityByKey[rumor.knowledgeKey] : null
    if (!rumor || visibility === 'hidden' || visibility == null) return []
    const history = [...projection.state.knowledge.history].reverse().find(candidate => (
      candidate.kind === 'rumor-read' && candidate.targetKey === rumor.key
    ))
    return [{
      uiId: `rumor-${index + 1}`,
      text: rumor.text,
      reliability: rumor.reliability,
      reliabilityLabel: RUMOR_RELIABILITY_LABELS[rumor.reliability],
      relatedFactKnown: visibility === 'known',
      relatedFactStatusLabel: visibility === 'known' ? '关联事实已有正式条目' : '关联事实尚待核实',
      heardAtLabel: history ? timeLabel(modules, history.worldMinute) : null,
      regionTitle: history ? visibleRegionTitleByKey.get(history.regionKey) ?? null : null,
    }]
  })

  const earnedAchievements = modules.knowledge.achievements.filter(achievement => (
    projection.state.knowledge.earnedAchievementKeys.includes(achievement.key)
  )).map((achievement, index) => {
    const history = [...projection.state.knowledge.history].reverse().find(candidate => (
      candidate.kind === 'achievement-earned' && candidate.targetKey === achievement.key
    ))
    return {
      uiId: `achievement-${index + 1}`,
      title: achievement.title,
      description: achievement.description,
      earnedAtLabel: history ? timeLabel(modules, history.worldMinute) : null,
      regionTitle: history ? visibleRegionTitleByKey.get(history.regionKey) ?? null : null,
    }
  })

  const allKnowledgeHistory = projectKnowledgeHistory({ projection, modules, visibleRegionTitleByKey })
  const knowledgeHistoryCount = Math.min(allKnowledgeHistory.length, 50)
  let eventHistoryCount = Math.min(notifications.length, 100 - knowledgeHistoryCount)
  const finalKnowledgeHistoryCount = Math.min(allKnowledgeHistory.length, 100 - eventHistoryCount)
  eventHistoryCount = Math.min(notifications.length, 100 - finalKnowledgeHistoryCount)
  const eventEntries = notifications.slice(-eventHistoryCount).reverse().map((notification, index) => ({
    uiId: `event-history-${index + 1}`,
    categoryLabel: NOTIFICATION_CATEGORY_LABELS[notification.category],
    headline: notification.headline,
    details: [...notification.details],
    timeLabel: notification.worldMinute == null ? null : timeLabel(modules, notification.worldMinute),
    originLabel: notification.origin === 'player' ? '玩家行动' : '世界演化',
  }))
  const knowledgeEntries = allKnowledgeHistory.slice(0, finalKnowledgeHistoryCount)
  const recentChanges = notifications.filter(notification => notification.category === 'relationship')
    .slice(-3).reverse().map((notification, index) => ({
      uiId: `relationship-change-${index + 1}`,
      title: notification.headline,
      detail: notification.details[0] ?? null,
      timeLabel: notification.worldMinute == null ? null : timeLabel(modules, notification.worldMinute),
    }))

  return {
    relationships: {
      morality: structuredClone(relationshipRules.morality),
      factions,
      actors,
      recentChanges,
    },
    encyclopedia: { categories: encyclopediaCategories, entries: encyclopediaEntries },
    rumors: { entries: rumors },
    history: { status: eventStatus, eventEntries, knowledgeEntries },
    achievements: {
      earnedCount: earnedAchievements.length,
      totalCount: modules.knowledge.achievements.length,
      lockedCount: Math.max(0, modules.knowledge.achievements.length - earnedAchievements.length),
      earned: earnedAchievements,
    },
  }
}
