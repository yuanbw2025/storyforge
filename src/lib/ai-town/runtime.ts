import type {
  AiTownDailyDigestV1,
  AiTownDaySlotV1,
  AiTownRuntimeContentV1,
  AiTownRuntimeStateV1,
  ProductRuntimeEvent,
} from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'

const DAY_SLOTS: readonly AiTownDaySlotV1[] = [
  'morning', 'late-morning', 'noon', 'afternoon', 'evening', 'midnight',
]
const EVENT_CATEGORIES = new Set([
  'ambient', 'resident-opportunity', 'resident-friction', 'community', 'festival', 'rare-crisis',
])
const MAJOR_CHANGE_KINDS = new Set([
  'death-or-permanent-incapacity', 'marriage-or-family', 'permanent-departure',
  'major-facility-change', 'world-rule-change',
])

function fail(message: string): never {
  throw new Error(`[ai-town] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function stableKey(value: unknown, label: string): string {
  const result = text(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail(`${label} 不是稳定 key`)
  return result
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 必须是 ${minimum}..${maximum} 的整数`)
  }
  return Number(value)
}

function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} 必须是 ${minimum}..${maximum} 的有限数值`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`)
  return value
}

function strings(value: unknown, label: string, maximum = 100, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) {
    fail(`${label} 必须是${allowEmpty ? '有界' : '非空有界'}数组`)
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不得重复`)
  return result
}

function keys(value: unknown, label: string, maximum = 100, allowEmpty = true): string[] {
  return strings(value, label, maximum, allowEmpty).map((item, index) => stableKey(item, `${label}[${index}]`))
}

function slot(value: unknown, label: string): AiTownDaySlotV1 {
  if (!DAY_SLOTS.includes(value as AiTownDaySlotV1)) fail(`${label} 不是合法时段`)
  return value as AiTownDaySlotV1
}

function uniqueBy<T>(items: readonly T[], read: (item: T) => string, label: string): void {
  const values = items.map(read)
  if (new Set(values).size !== values.length) fail(`${label} key 重复`)
}

function integerList(value: unknown, label: string, maximum: number, upperBound: number): number[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界整数数组`)
  return value.map((item, index) => integer(item, `${label}[${index}]`, 0, upperBound))
}

function exactRecordKeys(value: Record<string, unknown>, expected: Iterable<string>, label: string): void {
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail(`${label} key 集合与冻结内容不一致`)
  }
}

export function parseAiTownRuntimeContentV1(value: unknown): AiTownRuntimeContentV1 {
  const row = object(value, 'runtime content')
  exact(row, [
    'schema', 'version', 'title', 'premise', 'elapsedCanonDays', 'player', 'canonLocks', 'residents',
    'relationships', 'map', 'lifeThreads', 'eventSeeds', 'clock', 'offline', 'economy', 'cadence', 'safety',
  ], 'runtime content')
  if (row.schema !== 'storyforge.ai-town-runtime-content' || row.version !== 1) fail('runtime content schema/version 无效')

  const playerRow = object(row.player, 'player')
  exact(playerRow, ['role', 'name', 'homeConcept'], 'player')
  if (!['new-resident', 'caretaker'].includes(String(playerRow.role))) fail('player.role 无效')
  const player = {
    role: playerRow.role as 'new-resident' | 'caretaker',
    name: text(playerRow.name, 'player.name', 100),
    homeConcept: text(playerRow.homeConcept, 'player.homeConcept', 500),
  }

  if (!Array.isArray(row.canonLocks) || row.canonLocks.length > 200) fail('canonLocks 必须是有界数组')
  const canonLocks = row.canonLocks.map((raw, index) => {
    const item = object(raw, `canonLocks[${index}]`)
    exact(item, ['key', 'statement', 'evidenceRefs'], `canonLocks[${index}]`)
    return { key: stableKey(item.key, `canonLocks[${index}].key`), statement: text(item.statement, `canonLocks[${index}].statement`), evidenceRefs: keys(item.evidenceRefs, `canonLocks[${index}].evidenceRefs`, 100, false) }
  })
  uniqueBy(canonLocks, item => item.key, 'canonLocks')

  const mapRow = object(row.map, 'map')
  exact(mapRow, ['locations', 'routes', 'playerHomeLocationKey'], 'map')
  if (!Array.isArray(mapRow.locations) || mapRow.locations.length < 4 || mapRow.locations.length > 80) fail('map.locations 需要 4..80 项')
  const locations = mapRow.locations.map((raw, index) => {
    const item = object(raw, `locations[${index}]`)
    exact(item, ['key', 'title', 'description', 'parentKey', 'x', 'y', 'capacity', 'openSlots', 'tags'], `locations[${index}]`)
    const openSlots = Array.isArray(item.openSlots) ? item.openSlots.map((entry, slotIndex) => slot(entry, `locations[${index}].openSlots[${slotIndex}]`)) : fail('location.openSlots 必须是数组')
    if (!openSlots.length || new Set(openSlots).size !== openSlots.length) fail(`locations[${index}].openSlots 无效`)
    return {
      key: stableKey(item.key, `locations[${index}].key`),
      title: text(item.title, `locations[${index}].title`, 200),
      description: text(item.description, `locations[${index}].description`),
      parentKey: item.parentKey == null ? null : stableKey(item.parentKey, `locations[${index}].parentKey`),
      x: number(item.x, `locations[${index}].x`, 0, 100),
      y: number(item.y, `locations[${index}].y`, 0, 100),
      capacity: integer(item.capacity, `locations[${index}].capacity`, 1, 100),
      openSlots,
      tags: strings(item.tags, `locations[${index}].tags`, 30),
    }
  })
  uniqueBy(locations, item => item.key, 'locations')
  const locationKeys = new Set(locations.map(item => item.key))
  for (const location of locations) {
    if (location.parentKey === location.key || (location.parentKey && !locationKeys.has(location.parentKey))) fail(`地点 parentKey 无效:${location.key}`)
    const seen = new Set<string>([location.key])
    let parent = location.parentKey
    while (parent) {
      if (seen.has(parent)) fail(`地点层级形成循环:${location.key}`)
      seen.add(parent)
      parent = locations.find(item => item.key === parent)?.parentKey ?? null
    }
  }
  if (!Array.isArray(mapRow.routes) || mapRow.routes.length > 300) fail('map.routes 必须是有界数组')
  const routes = mapRow.routes.map((raw, index) => {
    const item = object(raw, `routes[${index}]`)
    exact(item, ['key', 'fromLocationKey', 'toLocationKey', 'bidirectional', 'travelSlots'], `routes[${index}]`)
    const fromLocationKey = stableKey(item.fromLocationKey, `routes[${index}].fromLocationKey`)
    const toLocationKey = stableKey(item.toLocationKey, `routes[${index}].toLocationKey`)
    if (fromLocationKey === toLocationKey || !locationKeys.has(fromLocationKey) || !locationKeys.has(toLocationKey)) fail(`route 端点无效:${index}`)
    return { key: stableKey(item.key, `routes[${index}].key`), fromLocationKey, toLocationKey, bidirectional: boolean(item.bidirectional, `routes[${index}].bidirectional`), travelSlots: integer(item.travelSlots, `routes[${index}].travelSlots`, 1, 6) }
  })
  uniqueBy(routes, item => item.key, 'routes')
  const playerHomeLocationKey = stableKey(mapRow.playerHomeLocationKey, 'map.playerHomeLocationKey')
  if (!locationKeys.has(playerHomeLocationKey)) fail('玩家住所不在地图内')
  const reachable = new Set<string>([playerHomeLocationKey])
  const queue = [playerHomeLocationKey]
  while (queue.length) {
    const current = queue.shift()!
    for (const route of routes) {
      const targets = route.fromLocationKey === current
        ? [route.toLocationKey]
        : route.bidirectional && route.toLocationKey === current ? [route.fromLocationKey] : []
      for (const target of targets) if (!reachable.has(target)) { reachable.add(target); queue.push(target) }
    }
  }
  if (locations.some(location => !reachable.has(location.key))) fail('地图包含从玩家住所不可达的地点')

  if (!Array.isArray(row.residents) || row.residents.length < 4 || row.residents.length > 8) fail('residents 需要 4..8 人')
  const residents = row.residents.map((raw, index) => {
    const item = object(raw, `residents[${index}]`)
    exact(item, ['residentKey', 'sourceCharacterResourceKey', 'name', 'summary', 'migrationReason', 'identityLocks', 'voiceRules', 'homeLocationKey', 'workLocationKey', 'schedule', 'startingKnowledge', 'goals'], `residents[${index}]`)
    const residentKey = stableKey(item.residentKey, `residents[${index}].residentKey`)
    const homeLocationKey = stableKey(item.homeLocationKey, `residents[${index}].homeLocationKey`)
    const workLocationKey = item.workLocationKey == null ? null : stableKey(item.workLocationKey, `residents[${index}].workLocationKey`)
    if (!locationKeys.has(homeLocationKey) || (workLocationKey && !locationKeys.has(workLocationKey))) fail(`居民地点无效:${residentKey}`)
    if (!Array.isArray(item.schedule) || item.schedule.length !== DAY_SLOTS.length) fail(`居民日程必须覆盖六时段:${residentKey}`)
    const schedule = item.schedule.map((rawEntry, entryIndex) => {
      const entry = object(rawEntry, `schedule[${index}][${entryIndex}]`)
      exact(entry, ['slot', 'locationKey', 'activity'], `schedule[${index}][${entryIndex}]`)
      const locationKey = stableKey(entry.locationKey, 'schedule.locationKey')
      if (!locationKeys.has(locationKey)) fail(`日程地点无效:${locationKey}`)
      const scheduleSlot = slot(entry.slot, 'schedule.slot')
      if (!locations.find(location => location.key === locationKey)?.openSlots.includes(scheduleSlot)) fail(`居民日程指向未开放地点:${residentKey}/${scheduleSlot}`)
      return { slot: scheduleSlot, locationKey, activity: text(entry.activity, 'schedule.activity', 300) }
    })
    if (new Set(schedule.map(entry => entry.slot)).size !== DAY_SLOTS.length) fail(`居民日程时段重复:${residentKey}`)
    if (!Array.isArray(item.startingKnowledge) || item.startingKnowledge.length > 100) fail('startingKnowledge 必须是有界数组')
    const startingKnowledge = item.startingKnowledge.map((rawKnowledge, knowledgeIndex) => {
      const knowledge = object(rawKnowledge, `startingKnowledge[${knowledgeIndex}]`)
      exact(knowledge, ['factKey', 'statement', 'visibility'], `startingKnowledge[${knowledgeIndex}]`)
      if (!['public', 'private', 'secret'].includes(String(knowledge.visibility))) fail('knowledge visibility 无效')
      return { factKey: stableKey(knowledge.factKey, 'knowledge.factKey'), statement: text(knowledge.statement, 'knowledge.statement'), visibility: knowledge.visibility as 'public' | 'private' | 'secret' }
    })
    uniqueBy(startingKnowledge, knowledge => knowledge.factKey, `${residentKey}.startingKnowledge`)
    return {
      residentKey,
      sourceCharacterResourceKey: stableKey(item.sourceCharacterResourceKey, `residents[${index}].sourceCharacterResourceKey`),
      name: text(item.name, `residents[${index}].name`, 200), summary: text(item.summary, `residents[${index}].summary`),
      migrationReason: text(item.migrationReason, `residents[${index}].migrationReason`),
      identityLocks: strings(item.identityLocks, `residents[${index}].identityLocks`, 50, false),
      voiceRules: text(item.voiceRules, `residents[${index}].voiceRules`), homeLocationKey, workLocationKey,
      schedule, startingKnowledge, goals: strings(item.goals, `residents[${index}].goals`, 20, false),
    }
  })
  uniqueBy(residents, item => item.residentKey, 'residents')
  uniqueBy(residents, item => item.sourceCharacterResourceKey, 'resident sources')
  const residentKeys = new Set(residents.map(item => item.residentKey))

  if (!Array.isArray(row.relationships) || row.relationships.length > 128) fail('relationships 必须是有界数组')
  const relationships = row.relationships.map((raw, index) => {
    const item = object(raw, `relationships[${index}]`)
    exact(item, ['key', 'fromResidentKey', 'toResidentKey', 'trust', 'intimacy', 'wariness', 'reason', 'evidenceRefs'], `relationships[${index}]`)
    const fromResidentKey = stableKey(item.fromResidentKey, 'relationship.fromResidentKey')
    const toResidentKey = stableKey(item.toResidentKey, 'relationship.toResidentKey')
    const validEndpoint = (key: string) => key === 'player' || residentKeys.has(key)
    if (fromResidentKey === toResidentKey || !validEndpoint(fromResidentKey) || !validEndpoint(toResidentKey)) fail(`关系端点无效:${index}`)
    return { key: stableKey(item.key, 'relationship.key'), fromResidentKey, toResidentKey, trust: integer(item.trust, 'relationship.trust', 0, 100), intimacy: integer(item.intimacy, 'relationship.intimacy', 0, 100), wariness: integer(item.wariness, 'relationship.wariness', 0, 100), reason: text(item.reason, 'relationship.reason'), evidenceRefs: keys(item.evidenceRefs, 'relationship.evidenceRefs', 100) }
  })
  uniqueBy(relationships, item => item.key, 'relationships')

  if (!Array.isArray(row.lifeThreads) || row.lifeThreads.length < residents.length || row.lifeThreads.length > 100) fail('lifeThreads 数量无效')
  const lifeThreads = row.lifeThreads.map((raw, index) => {
    const item = object(raw, `lifeThreads[${index}]`)
    exact(item, ['key', 'ownerResidentKey', 'title', 'description', 'initialStage', 'locationKeys', 'participantKeys'], `lifeThreads[${index}]`)
    const ownerResidentKey = stableKey(item.ownerResidentKey, 'lifeThread.ownerResidentKey')
    const selectedLocations = keys(item.locationKeys, 'lifeThread.locationKeys', 20)
    const participants = keys(item.participantKeys, 'lifeThread.participantKeys', 8)
    if (!residentKeys.has(ownerResidentKey) || selectedLocations.some(key => !locationKeys.has(key)) || participants.some(key => !residentKeys.has(key))) fail(`lifeThread 引用无效:${index}`)
    if (!['dormant', 'active'].includes(String(item.initialStage))) fail('lifeThread.initialStage 无效')
    return { key: stableKey(item.key, 'lifeThread.key'), ownerResidentKey, title: text(item.title, 'lifeThread.title', 200), description: text(item.description, 'lifeThread.description'), initialStage: item.initialStage as 'dormant' | 'active', locationKeys: selectedLocations, participantKeys: participants }
  })
  uniqueBy(lifeThreads, item => item.key, 'lifeThreads')
  const threadKeys = new Set(lifeThreads.map(item => item.key))

  if (!Array.isArray(row.eventSeeds) || row.eventSeeds.length < 3 || row.eventSeeds.length > 200) fail('eventSeeds 需要 3..200 项')
  const eventSeeds = row.eventSeeds.map((raw, index) => {
    const item = object(raw, `eventSeeds[${index}]`)
    exact(item, ['key', 'category', 'title', 'summary', 'intensity', 'minimumDay', 'cooldownDays', 'eligibleSlots', 'locationKeys', 'participantKeys', 'lifeThreadKeys'], `eventSeeds[${index}]`)
    if (!EVENT_CATEGORIES.has(String(item.category))) fail('eventSeed.category 无效')
    const selectedLocations = keys(item.locationKeys, 'eventSeed.locationKeys', 20, false)
    const participants = keys(item.participantKeys, 'eventSeed.participantKeys', 8, false)
    const selectedThreads = keys(item.lifeThreadKeys, 'eventSeed.lifeThreadKeys', 20)
    if (selectedLocations.some(key => !locationKeys.has(key)) || participants.some(key => !residentKeys.has(key)) || selectedThreads.some(key => !threadKeys.has(key))) fail(`eventSeed 引用无效:${index}`)
    if (!Array.isArray(item.eligibleSlots) || !item.eligibleSlots.length) fail('eventSeed.eligibleSlots 无效')
    return { key: stableKey(item.key, 'eventSeed.key'), category: item.category as AiTownRuntimeContentV1['eventSeeds'][number]['category'], title: text(item.title, 'eventSeed.title', 200), summary: text(item.summary, 'eventSeed.summary'), intensity: integer(item.intensity, 'eventSeed.intensity', 1, 5), minimumDay: integer(item.minimumDay, 'eventSeed.minimumDay', 1, 100_000), cooldownDays: integer(item.cooldownDays, 'eventSeed.cooldownDays', 0, 365), eligibleSlots: item.eligibleSlots.map((value, slotIndex) => slot(value, `eventSeed.eligibleSlots[${slotIndex}]`)), locationKeys: selectedLocations, participantKeys: participants, lifeThreadKeys: selectedThreads }
  })
  uniqueBy(eventSeeds, item => item.key, 'eventSeeds')

  const clockRow = object(row.clock, 'clock')
  exact(clockRow, ['slots', 'actionsPerDay'], 'clock')
  if (!Array.isArray(clockRow.slots) || clockRow.slots.length !== DAY_SLOTS.length
    || clockRow.slots.some((value, index) => slot(value, `clock.slots[${index}]`) !== DAY_SLOTS[index])) {
    fail('clock.slots 必须按固定顺序完整覆盖六时段')
  }
  const clock = { slots: [...DAY_SLOTS], actionsPerDay: integer(clockRow.actionsPerDay, 'clock.actionsPerDay', 1, 12) }
  const offlineRow = object(row.offline, 'offline')
  exact(offlineRow, ['enabled', 'maximumDays'], 'offline')
  const offline = { enabled: boolean(offlineRow.enabled, 'offline.enabled'), maximumDays: integer(offlineRow.maximumDays, 'offline.maximumDays', 1, 3) }

  const economyRow = object(row.economy, 'economy')
  exact(economyRow, ['resources', 'startingMoney', 'startingEnergy', 'maximumEnergy', 'sharedProject'], 'economy')
  if (!Array.isArray(economyRow.resources) || economyRow.resources.length < 1 || economyRow.resources.length > 3) fail('economy.resources 需要 1..3 项')
  const resources = economyRow.resources.map((raw, index) => {
    const item = object(raw, `resources[${index}]`)
    exact(item, ['key', 'title', 'initial', 'maximum'], `resources[${index}]`)
    const maximum = integer(item.maximum, 'resource.maximum', 1, 1_000_000)
    return { key: stableKey(item.key, 'resource.key'), title: text(item.title, 'resource.title', 100), initial: integer(item.initial, 'resource.initial', 0, maximum), maximum }
  })
  uniqueBy(resources, item => item.key, 'resources')
  const sharedProjectRow = object(economyRow.sharedProject, 'economy.sharedProject')
  exact(sharedProjectRow, ['key', 'title', 'description', 'targetProgress', 'milestoneLocationKey'], 'economy.sharedProject')
  const milestoneLocationKey = stableKey(sharedProjectRow.milestoneLocationKey, 'sharedProject.milestoneLocationKey')
  if (!locationKeys.has(milestoneLocationKey)) fail('sharedProject 地点无效')
  const maximumEnergy = integer(economyRow.maximumEnergy, 'economy.maximumEnergy', 1, 1_000)
  const economy = {
    resources,
    startingMoney: integer(economyRow.startingMoney, 'economy.startingMoney', 0, 1_000_000_000),
    startingEnergy: integer(economyRow.startingEnergy, 'economy.startingEnergy', 0, maximumEnergy), maximumEnergy,
    sharedProject: { key: stableKey(sharedProjectRow.key, 'sharedProject.key'), title: text(sharedProjectRow.title, 'sharedProject.title', 200), description: text(sharedProjectRow.description, 'sharedProject.description'), targetProgress: integer(sharedProjectRow.targetProgress, 'sharedProject.targetProgress', 1, 1_000_000), milestoneLocationKey },
  }

  const cadenceRow = object(row.cadence, 'cadence')
  exact(cadenceRow, ['dailyIntensityBudget', 'highIntensityStreakLimit', 'rareCrisisCooldownDays'], 'cadence')
  const cadence = { dailyIntensityBudget: integer(cadenceRow.dailyIntensityBudget, 'cadence.dailyIntensityBudget', 1, 20), highIntensityStreakLimit: integer(cadenceRow.highIntensityStreakLimit, 'cadence.highIntensityStreakLimit', 1, 5), rareCrisisCooldownDays: integer(cadenceRow.rareCrisisCooldownDays, 'cadence.rareCrisisCooldownDays', 1, 365) }

  const safetyRow = object(row.safety, 'safety')
  exact(safetyRow, ['boundaries', 'majorChangeKinds', 'romance'], 'safety')
  const majorChangeKinds = strings(safetyRow.majorChangeKinds, 'safety.majorChangeKinds', 5, false)
  if (majorChangeKinds.some(kind => !MAJOR_CHANGE_KINDS.has(kind))) fail('safety.majorChangeKinds 无效')
  if (!['off', 'canon-only', 'opt-in'].includes(String(safetyRow.romance))) fail('safety.romance 无效')

  return {
    schema: 'storyforge.ai-town-runtime-content', version: 1,
    title: text(row.title, 'title', 200), premise: text(row.premise, 'premise'), player,
    elapsedCanonDays: integer(row.elapsedCanonDays, 'elapsedCanonDays', 0, 1_000_000), canonLocks,
    residents, relationships, map: { locations, routes, playerHomeLocationKey }, lifeThreads, eventSeeds, clock, offline, economy, cadence,
    safety: { boundaries: strings(safetyRow.boundaries, 'safety.boundaries', 100), majorChangeKinds: majorChangeKinds as AiTownRuntimeContentV1['safety']['majorChangeKinds'], romance: safetyRow.romance as AiTownRuntimeContentV1['safety']['romance'] },
  }
}

function scheduleFor(content: AiTownRuntimeContentV1, residentKey: string, slotValue: AiTownDaySlotV1) {
  const resident = content.residents.find(item => item.residentKey === residentKey)
  return resident?.schedule.find(entry => entry.slot === slotValue) ?? null
}

export function createInitialAiTownStateV1(
  rawContent: AiTownRuntimeContentV1,
  contentHash: string,
): AiTownRuntimeStateV1 {
  const content = parseAiTownRuntimeContentV1(rawContent)
  if (!/^[0-9a-f]{64}$/.test(contentHash)) fail('contentHash 无效')
  const firstSlot: AiTownDaySlotV1 = 'morning'
  const residents = Object.fromEntries(content.residents.map(resident => {
    const schedule = scheduleFor(content, resident.residentKey, firstSlot)!
    return [resident.residentKey, {
      residentKey: resident.residentKey, residencyStatus: 'resident' as const, locationKey: schedule.locationKey, activity: schedule.activity,
      mood: 'calm' as const, energy: 80, activeGoal: resident.goals[0], lastSpokeDay: 0,
    }]
  }))
  const knowledge: AiTownRuntimeStateV1['knowledge'] = {}
  for (const resident of content.residents) {
    for (const seed of resident.startingKnowledge) {
      const existing = knowledge[seed.factKey]
      if (existing && (existing.statement !== seed.statement || existing.visibility !== seed.visibility)) fail(`起始知识定义冲突:${seed.factKey}`)
      const fact = existing ?? { factKey: seed.factKey, statement: seed.statement, visibility: seed.visibility, holders: {} }
      fact.holders[resident.residentKey] = { status: 'believed', evidenceSequence: 0 }
      knowledge[seed.factKey] = fact
    }
  }
  return {
    schema: 'storyforge.ai-town-runtime-state', version: 1, contentHash, content,
    day: 1, slot: firstSlot, actionsRemaining: content.clock.actionsPerDay, weatherKey: 'clear',
    player: { name: content.player.name, locationKey: content.map.playerHomeLocationKey, energy: content.economy.startingEnergy, maximumEnergy: content.economy.maximumEnergy, money: content.economy.startingMoney, resources: Object.fromEntries(content.economy.resources.map(resource => [resource.key, resource.initial])) },
    residents,
    relationships: Object.fromEntries(content.relationships.map(relationship => [relationship.key, {
      key: relationship.key,
      fromResidentKey: relationship.fromResidentKey,
      toResidentKey: relationship.toResidentKey,
      trust: relationship.trust,
      intimacy: relationship.intimacy,
      wariness: relationship.wariness,
      evidenceSequences: [],
    }])),
    knowledge, memories: [],
    lifeThreads: Object.fromEntries(content.lifeThreads.map(thread => [thread.key, { key: thread.key, stage: thread.initialStage, progress: 0, lastAdvancedDay: 0, evidenceSequences: [] }])),
    sharedProject: { key: content.economy.sharedProject.key, title: content.economy.sharedProject.title, progress: 0, targetProgress: content.economy.sharedProject.targetProgress, completed: false },
    cadence: { remainingIntensity: content.cadence.dailyIntensityBudget, highIntensityStreak: 0, lastRareCrisisDay: null, seedLastTriggeredDay: {} },
    pendingMajorChanges: [], dailyDigests: [], latestPublicEvents: [`你在${content.title}安顿下来。`], offlineDaysSimulated: 0, lastSequence: 0,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function payloadText(payload: ProductRuntimeJsonObjectV1, key: string, maximum = 4_000): string {
  return text(payload[key], `event.${key}`, maximum)
}

function parseDigest(value: unknown, sequence: number): AiTownDailyDigestV1 {
  const row = object(value, 'digest')
  exact(row, ['day', 'publicSummary', 'publicKnowledgeChanges', 'observableRelationshipChanges', 'tomorrowHints'], 'digest')
  return { day: integer(row.day, 'digest.day', 1, 1_000_000), publicSummary: strings(row.publicSummary, 'digest.publicSummary', 50), publicKnowledgeChanges: strings(row.publicKnowledgeChanges, 'digest.publicKnowledgeChanges', 50), observableRelationshipChanges: strings(row.observableRelationshipChanges, 'digest.observableRelationshipChanges', 50), tomorrowHints: strings(row.tomorrowHints, 'digest.tomorrowHints', 50), throughSequence: sequence }
}

function moveResidentsForSlot(state: AiTownRuntimeStateV1, content: AiTownRuntimeContentV1, nextSlot: AiTownDaySlotV1): void {
  const destinations = new Map<string, { locationKey: string; activity: string }>()
  for (const resident of content.residents) {
    if (state.residents[resident.residentKey]?.residencyStatus !== 'resident') continue
    const entry = scheduleFor(content, resident.residentKey, nextSlot)
    if (!entry) fail(`居民日程缺失:${resident.residentKey}/${nextSlot}`)
    destinations.set(resident.residentKey, { locationKey: entry.locationKey, activity: entry.activity })
  }
  for (const location of content.map.locations) {
    const residents = [...destinations.values()].filter(item => item.locationKey === location.key).length
    const player = state.player.locationKey === location.key ? 1 : 0
    if (residents + player > location.capacity) fail(`居民日程超过地点容量:${location.key}/${nextSlot}`)
  }
  for (const [residentKey, destination] of destinations) {
    state.residents[residentKey] = { ...state.residents[residentKey], ...destination }
  }
}

function advanceDailyAutonomy(
  state: AiTownRuntimeStateV1,
  sequence: number,
  simulatedDay: number,
): string | null {
  const eligible = state.content.lifeThreads.filter(definition => {
    const owner = state.residents[definition.ownerResidentKey]
    return owner?.residencyStatus === 'resident' && state.lifeThreads[definition.key]?.stage !== 'resolved'
  })
  if (!eligible.length) return null
  const definition = eligible[(simulatedDay - 1) % eligible.length]
  const thread = state.lifeThreads[definition.key]
  if (thread.stage === 'dormant' || thread.stage === 'resting') thread.stage = 'active'
  thread.progress = clamp(thread.progress + 4, 0, 100)
  thread.stage = thread.progress >= 100 ? 'resolved' : 'active'
  thread.lastAdvancedDay = simulatedDay
  appendBoundedEvidence(thread.evidenceSequences, sequence)
  const owner = state.content.residents.find(resident => resident.residentKey === definition.ownerResidentKey)!
  const ownerState = state.residents[definition.ownerResidentKey]
  ownerState.mood = thread.progress >= 80 ? 'bright' : simulatedDay % 5 === 0 ? 'tired' : 'calm'
  ownerState.energy = clamp(ownerState.energy + 8, 0, 100)
  const counterpartKey = definition.participantKeys.find(key => key !== definition.ownerResidentKey
    && state.residents[key]?.residencyStatus === 'resident')
  if (counterpartKey) {
    const relationship = Object.values(state.relationships).find(edge => (
      edge.fromResidentKey === definition.ownerResidentKey && edge.toResidentKey === counterpartKey
    )) ?? Object.values(state.relationships).find(edge => (
      edge.fromResidentKey === counterpartKey && edge.toResidentKey === definition.ownerResidentKey
    ))
    if (relationship) {
      relationship.trust = clamp(relationship.trust + 1, 0, 100)
      relationship.wariness = clamp(relationship.wariness - 1, 0, 100)
      appendBoundedEvidence(relationship.evidenceSequences, sequence)
    }
  }
  return `${owner.name}的生活线“${definition.title}”在自己的日程中继续推进。`
}

function weatherForDay(day: number): AiTownRuntimeStateV1['weatherKey'] {
  return (['clear', 'cloudy', 'clear', 'rain', 'clear', 'cloudy'] as const)[(day - 1) % 6]
}

function appendRecentPublicEvent(items: string[], value: string, maximum = 12): string[] {
  return [...items.filter(item => item !== value).slice(-(maximum - 1)), value]
}

function appendBoundedEvidence(items: number[], sequence: number, maximum = 2_000): void {
  if (items[items.length - 1] !== sequence) items.push(sequence)
  if (items.length > maximum) items.splice(0, items.length - maximum)
}

function appendTownMemory(
  state: AiTownRuntimeStateV1,
  memory: AiTownRuntimeStateV1['memories'][number],
): void {
  const ownerMemoryIndexes = state.memories
    .map((item, index) => item.ownerResidentKey === memory.ownerResidentKey ? index : -1)
    .filter(index => index >= 0)
  if (ownerMemoryIndexes.length >= 80) state.memories.splice(ownerMemoryIndexes[0], 1)
  state.memories.push(memory)
  if (state.memories.length > 480) state.memories.splice(0, state.memories.length - 480)
}

export function applyAiTownEventV1(
  current: AiTownRuntimeStateV1 | null,
  event: ProductRuntimeEvent,
  payload: ProductRuntimeJsonObjectV1,
): AiTownRuntimeStateV1 {
  if (!current) fail('事件缺少 AI 小镇状态')
  const state = structuredClone(current)
  const content = state.content
  if (event.sequence <= state.lastSequence) fail('AI 小镇事件序号必须前进')
  if (event.type === 'town.action.performed') {
    const summary = payloadText(payload, 'summary')
    const energyCost = integer(payload.energyCost, 'event.energyCost', 0, 100)
    if (state.player.energy < energyCost) fail('玩家精力不足')
    state.player.energy -= energyCost
    const moneyDelta = integer(payload.moneyDelta, 'event.moneyDelta', -1_000, 1_000)
    if (state.player.money + moneyDelta < 0 || state.player.money + moneyDelta > 1_000_000_000) fail('行动金钱变化越界')
    state.player.money += moneyDelta
    if (!Array.isArray(payload.resourceChanges) || payload.resourceChanges.length > content.economy.resources.length) fail('行动资源变化无效')
    const changedResources = new Set<string>()
    for (const [index, rawChange] of payload.resourceChanges.entries()) {
      const change = object(rawChange, `event.resourceChanges[${index}]`)
      exact(change, ['resourceKey', 'delta'], `event.resourceChanges[${index}]`)
      const resourceKey = stableKey(change.resourceKey, `event.resourceChanges[${index}].resourceKey`)
      const definition = content.economy.resources.find(item => item.key === resourceKey)
      if (!definition || changedResources.has(resourceKey)) fail('行动资源变化包含未知或重复资源')
      changedResources.add(resourceKey)
      const next = state.player.resources[resourceKey] + integer(change.delta, `event.resourceChanges[${index}].delta`, -100, 100)
      if (next < 0 || next > definition.maximum) fail(`行动资源变化越界:${resourceKey}`)
      state.player.resources[resourceKey] = next
    }
    state.actionsRemaining = Math.max(0, state.actionsRemaining - 1)
    state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, summary)
    const targetResidentKey = payload.targetResidentKey == null ? null : stableKey(payload.targetResidentKey, 'event.targetResidentKey')
    if (targetResidentKey) {
      const resident = state.residents[targetResidentKey]
      if (!resident) fail('行动目标居民不存在')
      if (resident.residencyStatus !== 'resident') fail('行动目标已不在小镇生活')
      if (resident.locationKey !== state.player.locationKey) fail('不能对不在场居民执行行动')
      resident.lastSpokeDay = state.day
      appendTownMemory(state, {
        memoryKey: `town.memory.shared.${event.sequence}.${targetResidentKey}`,
        ownerResidentKey: targetResidentKey,
        summary,
        visibility: 'shared',
        sourceSequences: [event.sequence],
        salience: 50,
        createdDay: state.day,
      })
    }
    if (payload.projectProgress != null) {
      const delta = integer(payload.projectProgress, 'event.projectProgress', 0, 20)
      const wasCompleted = state.sharedProject.completed
      state.sharedProject.progress = clamp(state.sharedProject.progress + delta, 0, state.sharedProject.targetProgress)
      state.sharedProject.completed = state.sharedProject.progress >= state.sharedProject.targetProgress
      if (!wasCompleted && state.sharedProject.completed) {
        state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, `共同建设“${state.sharedProject.title}”已经完成，居民开始围绕它安排新的生活。`)
        for (const resident of Object.values(state.residents)) {
          if (resident.residencyStatus === 'resident') resident.activeGoal = `让“${state.sharedProject.title}”真正融入共同体的新生活`
        }
      }
    }
    if (payload.relationshipKey != null) {
      const relationshipKey = stableKey(payload.relationshipKey, 'event.relationshipKey')
      const relationship = state.relationships[relationshipKey]
      if (!relationship) fail('行动关系不存在')
      relationship.trust = clamp(relationship.trust + integer(payload.trustDelta ?? 0, 'event.trustDelta', -5, 5), 0, 100)
      relationship.intimacy = clamp(relationship.intimacy + integer(payload.intimacyDelta ?? 0, 'event.intimacyDelta', -5, 5), 0, 100)
      relationship.wariness = clamp(relationship.wariness + integer(payload.warinessDelta ?? 0, 'event.warinessDelta', -5, 5), 0, 100)
      appendBoundedEvidence(relationship.evidenceSequences, event.sequence)
    }
    if (payload.nextSlot != null) {
      const nextSlot = slot(payload.nextSlot, 'event.nextSlot')
      const expected = nextAiTownSlotV1(state.slot)
      if (nextSlot !== expected) fail('行动只能推进一个语义时段')
      state.slot = nextSlot
      if (nextSlot === 'morning') {
        const digest = parseDigest(payload.digest, event.sequence)
        if (digest.day !== state.day) fail('行动日结日期无效')
        const autonomy = advanceDailyAutonomy(state, event.sequence, state.day)
        if (autonomy && !digest.publicSummary.includes(autonomy)) digest.publicSummary.push(autonomy)
        state.dailyDigests = [...state.dailyDigests.slice(-29), digest]
        state.day += 1
        state.weatherKey = weatherForDay(state.day)
        state.actionsRemaining = content.clock.actionsPerDay
        state.player.energy = state.player.maximumEnergy
        state.cadence.remainingIntensity = content.cadence.dailyIntensityBudget
      }
      moveResidentsForSlot(state, content, nextSlot)
    }
  } else if (event.type === 'town.player.moved') {
    const locationKey = stableKey(payload.locationKey, 'event.locationKey')
    state.player.locationKey = locationKey
    state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, payloadText(payload, 'summary'))
  } else if (event.type === 'town.time.advanced') {
    const fromSlot = slot(payload.fromSlot, 'event.fromSlot')
    const toSlot = slot(payload.toSlot, 'event.toSlot')
    if (fromSlot !== state.slot) fail('时间推进起点 stale')
    const expectedIndex = (DAY_SLOTS.indexOf(fromSlot) + 1) % DAY_SLOTS.length
    if (DAY_SLOTS[expectedIndex] !== toSlot) fail('时间只能推进一个语义时段')
    const wrapped = toSlot === 'morning'
    state.slot = toSlot
    if (wrapped) {
      const digest = parseDigest(payload.digest, event.sequence)
      if (digest.day !== state.day) fail('时间推进日结日期无效')
      const autonomy = advanceDailyAutonomy(state, event.sequence, state.day)
      if (autonomy && !digest.publicSummary.includes(autonomy)) digest.publicSummary.push(autonomy)
      state.dailyDigests = [...state.dailyDigests.slice(-29), digest]
      state.day += 1
      state.weatherKey = weatherForDay(state.day)
      state.actionsRemaining = content.clock.actionsPerDay
      state.player.energy = state.player.maximumEnergy
      state.cadence.remainingIntensity = content.cadence.dailyIntensityBudget
    }
    moveResidentsForSlot(state, content, toSlot)
  } else if (event.type === 'town.relationship.changed') {
    const relationshipKey = stableKey(payload.relationshipKey, 'event.relationshipKey')
    const relationship = state.relationships[relationshipKey]
    if (!relationship) fail('关系不存在')
    const trustDelta = integer(payload.trustDelta, 'event.trustDelta', -10, 10)
    const intimacyDelta = integer(payload.intimacyDelta, 'event.intimacyDelta', -10, 10)
    const warinessDelta = integer(payload.warinessDelta, 'event.warinessDelta', -10, 10)
    payloadText(payload, 'reason')
    relationship.trust = clamp(relationship.trust + trustDelta, 0, 100)
    relationship.intimacy = clamp(relationship.intimacy + intimacyDelta, 0, 100)
    relationship.wariness = clamp(relationship.wariness + warinessDelta, 0, 100)
    appendBoundedEvidence(relationship.evidenceSequences, event.sequence)
  } else if (event.type === 'town.knowledge.exposed') {
    const factKey = stableKey(payload.factKey, 'event.factKey')
    const holderKey = stableKey(payload.holderKey, 'event.holderKey')
    if (!state.residents[holderKey]) fail('知识接收者不存在')
    const fact = state.knowledge[factKey]
    if (!fact) fail('知识事实不存在')
    fact.holders[holderKey] = { status: 'witnessed', evidenceSequence: event.sequence }
  } else if (event.type === 'town.memory.recorded') {
    const memoryKey = stableKey(payload.memoryKey, 'event.memoryKey')
    const ownerResidentKey = stableKey(payload.ownerResidentKey, 'event.ownerResidentKey')
    if (!state.residents[ownerResidentKey] || state.memories.some(memory => memory.memoryKey === memoryKey)) fail('记忆 owner/key 无效')
    if (!['private', 'shared', 'public'].includes(String(payload.visibility))) fail('记忆可见性无效')
    appendTownMemory(state, { memoryKey, ownerResidentKey, summary: payloadText(payload, 'summary'), visibility: payload.visibility as 'private' | 'shared' | 'public', sourceSequences: [event.sequence], salience: integer(payload.salience, 'event.salience', 1, 100), createdDay: state.day })
  } else if (event.type === 'town.thread.progressed') {
    const threadKey = stableKey(payload.threadKey, 'event.threadKey')
    const thread = state.lifeThreads[threadKey]
    if (!thread) fail('生活线不存在')
    const delta = integer(payload.delta, 'event.delta', 1, 20)
    thread.progress = clamp(thread.progress + delta, 0, 100)
    thread.stage = thread.progress >= 100 ? 'resolved' : 'active'
    thread.lastAdvancedDay = state.day
    appendBoundedEvidence(thread.evidenceSequences, event.sequence)
  } else if (event.type === 'town.resource.changed') {
    const resourceKey = stableKey(payload.resourceKey, 'event.resourceKey')
    const delta = integer(payload.delta, 'event.delta', -1_000_000, 1_000_000)
    if (resourceKey === 'money') state.player.money = Math.max(0, state.player.money + delta)
    else if (resourceKey === 'energy') state.player.energy = clamp(state.player.energy + delta, 0, state.player.maximumEnergy)
    else if (Object.prototype.hasOwnProperty.call(state.player.resources, resourceKey)) {
      const maximum = content.economy.resources.find(item => item.key === resourceKey)?.maximum ?? fail('资源定义缺失')
      const next = state.player.resources[resourceKey] + delta
      if (next < 0 || next > maximum) fail('资源变化越界')
      state.player.resources[resourceKey] = next
    }
    else fail('未知资源')
  } else if (event.type === 'town.conversation.integrated') {
    const residentKey = stableKey(payload.residentKey, 'event.residentKey')
    const resident = state.residents[residentKey]
    if (!resident || resident.residencyStatus !== 'resident') fail('对话记忆居民已不在小镇')
    const memoryKey = stableKey(payload.memoryKey, 'event.memoryKey')
    if (state.memories.some(memory => memory.memoryKey === memoryKey)) fail('对话记忆 key 重复')
    const sourceSequences = integerList(payload.sourceSequences, 'event.sourceSequences', 8, event.sequence - 1)
    if (!sourceSequences.length) fail('对话记忆缺少运行证据')
    appendTownMemory(state, {
      memoryKey,
      ownerResidentKey: residentKey,
      summary: payloadText(payload, 'summary'),
      visibility: 'shared',
      sourceSequences,
      salience: integer(payload.salience, 'event.salience', 1, 100),
      createdDay: state.day,
    })
    const relationshipKey = stableKey(payload.relationshipKey, 'event.relationshipKey')
    const relationship = state.relationships[relationshipKey]
    if (!relationship || relationship.fromResidentKey !== residentKey || relationship.toResidentKey !== 'player') fail('对话关系与居民不匹配')
    relationship.trust = clamp(relationship.trust + integer(payload.trustDelta, 'event.trustDelta', 0, 3), 0, 100)
    relationship.intimacy = clamp(relationship.intimacy + integer(payload.intimacyDelta, 'event.intimacyDelta', 0, 3), 0, 100)
    appendBoundedEvidence(relationship.evidenceSequences, event.sequence)
    resident.lastSpokeDay = state.day
  } else if (event.type === 'town.event.resolved') {
    const seedKey = stableKey(payload.seedKey, 'event.seedKey')
    const intensity = integer(payload.intensity, 'event.intensity', 1, 5)
    const seed = content.eventSeeds.find(item => item.key === seedKey)
    if (!seed || seed.intensity !== intensity) fail('事件 seed/强度偏离冻结定义')
    if (state.day < seed.minimumDay || !seed.eligibleSlots.includes(state.slot)) fail('事件当前不符合冻结触发条件')
    const lastTriggeredDay = state.cadence.seedLastTriggeredDay[seedKey]
    if (lastTriggeredDay != null && state.day - lastTriggeredDay < seed.cooldownDays) fail('事件仍在冷却')
    if (intensity >= 4 && state.cadence.highIntensityStreak >= content.cadence.highIntensityStreakLimit) fail('高强度事件需要留出喘息期')
    if (seed.category === 'rare-crisis' && state.cadence.lastRareCrisisDay != null
      && state.day - state.cadence.lastRareCrisisDay < content.cadence.rareCrisisCooldownDays) fail('罕见危机仍在全局冷却')
    const participants = keys(payload.participants, 'event.participants', 8)
    if (participants.some(key => !seed.participantKeys.includes(key)
      || state.residents[key]?.residencyStatus !== 'resident')) fail('事件参与者超出冻结候选或已不在小镇')
    if (participants.some(key => state.residents[key].locationKey !== state.player.locationKey)) fail('事件参与者不在玩家可观察地点')
    if (!participants.length && !seed.locationKeys.includes(state.player.locationKey)) fail('当前地点无法观察此事件')
    if (intensity > state.cadence.remainingIntensity) fail('事件超过当日强度预算')
    state.cadence.remainingIntensity -= intensity
    state.cadence.seedLastTriggeredDay[seedKey] = state.day
    if (seed.category === 'rare-crisis') state.cadence.lastRareCrisisDay = state.day
    state.cadence.highIntensityStreak = intensity >= 4 ? state.cadence.highIntensityStreak + 1 : 0
    const summary = payloadText(payload, 'summary')
    state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, summary)
    for (const threadKey of seed.lifeThreadKeys) {
      const thread = state.lifeThreads[threadKey]
      if (!thread || thread.stage === 'resolved') continue
      thread.stage = 'active'
      thread.progress = clamp(thread.progress + intensity * 2, 0, 100)
      if (thread.progress >= 100) thread.stage = 'resolved'
      thread.lastAdvancedDay = state.day
      appendBoundedEvidence(thread.evidenceSequences, event.sequence)
    }
    for (const residentKey of participants) appendTownMemory(state, {
      memoryKey: `town.memory.event.${event.sequence}.${residentKey}`,
      ownerResidentKey: residentKey,
      summary,
      visibility: 'public',
      sourceSequences: [event.sequence],
      salience: clamp(30 + intensity * 10, 1, 100),
      createdDay: state.day,
    })
  } else if (event.type === 'town.major-change.proposed') {
    const eligibility = aiTownMajorChangeEligibilityV1(state)
    if (!eligibility.eligible) fail(eligibility.reason ?? '重大变化尚未达到提案门槛')
    const candidateKey = stableKey(payload.candidateKey, 'event.candidateKey')
    if (state.pendingMajorChanges.some(candidate => candidate.candidateKey === candidateKey)) fail('重大变化候选重复')
    if (!MAJOR_CHANGE_KINDS.has(String(payload.kind))
      || !content.safety.majorChangeKinds.includes(payload.kind as AiTownRuntimeStateV1['pendingMajorChanges'][number]['kind'])) fail('重大变化类型无效或未经 Brief 授权')
    const residentKeysValue = keys(payload.residentKeys, 'event.residentKeys', 8)
    if (residentKeysValue.some(key => !state.residents[key])) fail('重大变化居民无效')
    if ((payload.kind === 'permanent-departure' || payload.kind === 'death-or-permanent-incapacity')
      && (!residentKeysValue.length || residentKeysValue.some(key => state.residents[key].residencyStatus !== 'resident'))) fail('居民离场类变化必须指向当前居民')
    state.pendingMajorChanges = [
      ...state.pendingMajorChanges.filter(candidate => candidate.status === 'pending'),
      ...state.pendingMajorChanges.filter(candidate => candidate.status !== 'pending').slice(-198),
      { candidateKey, kind: payload.kind as AiTownRuntimeStateV1['pendingMajorChanges'][number]['kind'], title: payloadText(payload, 'title', 200), summary: payloadText(payload, 'summary'), residentKeys: residentKeysValue, evidenceSequences: [event.sequence], status: 'pending' as const },
    ]
  } else if (event.type === 'town.major-change.accepted' || event.type === 'town.major-change.rejected') {
    const candidateKey = stableKey(payload.candidateKey, 'event.candidateKey')
    const candidate = state.pendingMajorChanges.find(item => item.candidateKey === candidateKey)
    if (!candidate || candidate.status !== 'pending') fail('重大变化候选不存在或已处理')
    candidate.status = event.type.endsWith('accepted') ? 'accepted' : 'rejected'
    if (candidate.status === 'accepted') {
      const residencyStatus = candidate.kind === 'permanent-departure'
        ? 'departed'
        : candidate.kind === 'death-or-permanent-incapacity' ? 'inactive' : null
      if (residencyStatus) {
        for (const residentKey of candidate.residentKeys) state.residents[residentKey].residencyStatus = residencyStatus
      }
      state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, `重大变化已确认：${candidate.title}`)
    }
  } else if (event.type === 'town.day.closed') {
    const digest = parseDigest(payload.digest, event.sequence)
    if (digest.day !== state.day) fail('日结日期与当前日不一致')
    if (state.dailyDigests.some(item => item.day === digest.day)) fail('同一游戏日不得重复日结')
    state.dailyDigests = [...state.dailyDigests.slice(-29), digest]
  } else if (event.type === 'town.offline-batch.completed') {
    const days = integer(payload.days, 'event.days', 1, 3)
    if (!Array.isArray(payload.digests) || payload.digests.length !== days) fail('离线摘要数量不一致')
    const startDay = state.day
    const digests = payload.digests.map((digest, index) => {
      const simulatedDay = startDay + index
      const parsed = parseDigest({ ...(object(digest, `digests[${index}]`)), day: simulatedDay }, event.sequence)
      const autonomy = advanceDailyAutonomy(state, event.sequence, simulatedDay)
      if (autonomy && !parsed.publicSummary.includes(autonomy)) parsed.publicSummary.push(autonomy)
      return parsed
    })
    state.day += days
    state.weatherKey = weatherForDay(state.day)
    state.slot = 'morning'
    state.actionsRemaining = content.clock.actionsPerDay
    state.player.energy = state.player.maximumEnergy
    moveResidentsForSlot(state, content, 'morning')
    state.cadence.remainingIntensity = content.cadence.dailyIntensityBudget
    state.dailyDigests = [...state.dailyDigests, ...digests].slice(-30)
    state.offlineDaysSimulated += days
    state.latestPublicEvents = appendRecentPublicEvent(state.latestPublicEvents, `离开期间经过了 ${days} 个游戏日（第 ${startDay} 日至第 ${startDay + days - 1} 日）。`)
  } else if (event.type !== 'town.started') {
    fail(`未知 AI 小镇事件:${event.type}`)
  }
  state.lastSequence = event.sequence
  return state
}

export function parseAiTownStateV1(value: unknown): AiTownRuntimeStateV1 | null {
  if (value == null) return null
  const row = object(value, 'runtime state')
  exact(row, [
    'schema', 'version', 'contentHash', 'content', 'day', 'slot', 'actionsRemaining', 'weatherKey',
    'player', 'residents', 'relationships', 'knowledge', 'memories', 'lifeThreads', 'sharedProject',
    'cadence', 'pendingMajorChanges', 'dailyDigests', 'latestPublicEvents', 'offlineDaysSimulated',
    'lastSequence',
  ], 'runtime state')
  if (row.schema !== 'storyforge.ai-town-runtime-state' || row.version !== 1) fail('runtime state schema/version 无效')
  if (!/^[0-9a-f]{64}$/.test(String(row.contentHash))) fail('runtime state contentHash 无效')
  const day = integer(row.day, 'state.day', 1, 1_000_000)
  slot(row.slot, 'state.slot')
  const lastSequence = integer(row.lastSequence, 'state.lastSequence', 0, Number.MAX_SAFE_INTEGER)
  const content = parseAiTownRuntimeContentV1(row.content)
  integer(row.actionsRemaining, 'state.actionsRemaining', 0, content.clock.actionsPerDay)
  if (!['clear', 'cloudy', 'rain'].includes(String(row.weatherKey))) fail('state.weatherKey 无效')
  integer(row.offlineDaysSimulated, 'state.offlineDaysSimulated', 0, 1_000_000)

  const locationKeys = new Set(content.map.locations.map(item => item.key))
  const residentKeys = new Set(content.residents.map(item => item.residentKey))
  const relationshipKeys = new Set(content.relationships.map(item => item.key))
  const lifeThreadKeys = new Set(content.lifeThreads.map(item => item.key))
  const eventSeedKeys = new Set(content.eventSeeds.map(item => item.key))

  const player = object(row.player, 'state.player')
  exact(player, ['name', 'locationKey', 'energy', 'maximumEnergy', 'money', 'resources'], 'state.player')
  text(player.name, 'state.player.name', 100)
  const playerLocationKey = stableKey(player.locationKey, 'state.player.locationKey')
  if (!locationKeys.has(playerLocationKey)) fail('state.player.locationKey 不在冻结地图中')
  const maximumEnergy = integer(player.maximumEnergy, 'state.player.maximumEnergy', 1, 1_000)
  if (maximumEnergy !== content.economy.maximumEnergy) fail('state.player.maximumEnergy 偏离冻结规则')
  integer(player.energy, 'state.player.energy', 0, maximumEnergy)
  integer(player.money, 'state.player.money', 0, 1_000_000_000)
  const resources = object(player.resources, 'state.player.resources')
  exactRecordKeys(resources, content.economy.resources.map(item => item.key), 'state.player.resources')
  for (const definition of content.economy.resources) {
    integer(resources[definition.key], `state.player.resources.${definition.key}`, 0, definition.maximum)
  }

  const residents = object(row.residents, 'state.residents')
  exactRecordKeys(residents, residentKeys, 'state.residents')
  for (const residentKey of residentKeys) {
    const resident = object(residents[residentKey], `state.residents.${residentKey}`)
    exact(resident, ['residentKey', 'residencyStatus', 'locationKey', 'activity', 'mood', 'energy', 'activeGoal', 'lastSpokeDay'], `state.residents.${residentKey}`)
    if (stableKey(resident.residentKey, `state.residents.${residentKey}.residentKey`) !== residentKey) fail(`居民状态 key 错位:${residentKey}`)
    if (!['resident', 'departed', 'inactive'].includes(String(resident.residencyStatus))) fail(`居民状态无效:${residentKey}`)
    if (!locationKeys.has(stableKey(resident.locationKey, `state.residents.${residentKey}.locationKey`))) fail(`居民状态地点无效:${residentKey}`)
    text(resident.activity, `state.residents.${residentKey}.activity`, 300)
    if (!['calm', 'bright', 'tired', 'uneasy', 'upset'].includes(String(resident.mood))) fail(`居民情绪无效:${residentKey}`)
    integer(resident.energy, `state.residents.${residentKey}.energy`, 0, 100)
    text(resident.activeGoal, `state.residents.${residentKey}.activeGoal`, 500)
    integer(resident.lastSpokeDay, `state.residents.${residentKey}.lastSpokeDay`, 0, day)
  }

  const relationships = object(row.relationships, 'state.relationships')
  exactRecordKeys(relationships, relationshipKeys, 'state.relationships')
  for (const definition of content.relationships) {
    const relationship = object(relationships[definition.key], `state.relationships.${definition.key}`)
    exact(relationship, ['key', 'fromResidentKey', 'toResidentKey', 'trust', 'intimacy', 'wariness', 'evidenceSequences'], `state.relationships.${definition.key}`)
    if (stableKey(relationship.key, 'state.relationship.key') !== definition.key
      || stableKey(relationship.fromResidentKey, 'state.relationship.fromResidentKey') !== definition.fromResidentKey
      || stableKey(relationship.toResidentKey, 'state.relationship.toResidentKey') !== definition.toResidentKey) fail(`关系状态端点偏离冻结定义:${definition.key}`)
    integer(relationship.trust, 'state.relationship.trust', 0, 100)
    integer(relationship.intimacy, 'state.relationship.intimacy', 0, 100)
    integer(relationship.wariness, 'state.relationship.wariness', 0, 100)
    integerList(relationship.evidenceSequences, 'state.relationship.evidenceSequences', 2_000, lastSequence)
  }

  const knowledge = object(row.knowledge, 'state.knowledge')
  for (const [factKey, rawFact] of Object.entries(knowledge)) {
    if (stableKey(factKey, 'state.knowledge key') !== factKey) fail(`知识 key 无效:${factKey}`)
    const fact = object(rawFact, `state.knowledge.${factKey}`)
    exact(fact, ['factKey', 'statement', 'visibility', 'holders'], `state.knowledge.${factKey}`)
    if (stableKey(fact.factKey, `state.knowledge.${factKey}.factKey`) !== factKey) fail(`知识状态 key 错位:${factKey}`)
    text(fact.statement, `state.knowledge.${factKey}.statement`)
    if (!['public', 'private', 'secret'].includes(String(fact.visibility))) fail(`知识可见性无效:${factKey}`)
    const holders = object(fact.holders, `state.knowledge.${factKey}.holders`)
    for (const [holderKey, rawHolder] of Object.entries(holders)) {
      if (!residentKeys.has(holderKey)) fail(`知识持有者不在冻结居民中:${holderKey}`)
      const holder = object(rawHolder, `state.knowledge.${factKey}.holders.${holderKey}`)
      exact(holder, ['status', 'evidenceSequence'], `state.knowledge.${factKey}.holders.${holderKey}`)
      if (!['heard', 'believed', 'witnessed', 'disproved'].includes(String(holder.status))) fail(`知识状态无效:${factKey}/${holderKey}`)
      integer(holder.evidenceSequence, `state.knowledge.${factKey}.holders.${holderKey}.evidenceSequence`, 0, lastSequence)
    }
  }

  if (!Array.isArray(row.memories) || row.memories.length > 480) fail('state.memories 必须是有界数组')
  const memoryKeys = new Set<string>()
  row.memories.forEach((rawMemory, index) => {
    const memory = object(rawMemory, `state.memories[${index}]`)
    exact(memory, ['memoryKey', 'ownerResidentKey', 'summary', 'visibility', 'sourceSequences', 'salience', 'createdDay'], `state.memories[${index}]`)
    const memoryKey = stableKey(memory.memoryKey, `state.memories[${index}].memoryKey`)
    if (memoryKeys.has(memoryKey)) fail(`记忆 key 重复:${memoryKey}`)
    memoryKeys.add(memoryKey)
    if (!residentKeys.has(stableKey(memory.ownerResidentKey, `state.memories[${index}].ownerResidentKey`))) fail(`记忆 owner 无效:${memoryKey}`)
    text(memory.summary, `state.memories[${index}].summary`)
    if (!['private', 'shared', 'public'].includes(String(memory.visibility))) fail(`记忆可见性无效:${memoryKey}`)
    integerList(memory.sourceSequences, `state.memories[${index}].sourceSequences`, 100, lastSequence)
    integer(memory.salience, `state.memories[${index}].salience`, 1, 100)
    integer(memory.createdDay, `state.memories[${index}].createdDay`, 1, day)
  })

  const lifeThreads = object(row.lifeThreads, 'state.lifeThreads')
  exactRecordKeys(lifeThreads, lifeThreadKeys, 'state.lifeThreads')
  for (const definition of content.lifeThreads) {
    const thread = object(lifeThreads[definition.key], `state.lifeThreads.${definition.key}`)
    exact(thread, ['key', 'stage', 'progress', 'lastAdvancedDay', 'evidenceSequences'], `state.lifeThreads.${definition.key}`)
    if (stableKey(thread.key, 'state.lifeThread.key') !== definition.key) fail(`生活线状态 key 错位:${definition.key}`)
    if (!['dormant', 'active', 'resting', 'resolved'].includes(String(thread.stage))) fail(`生活线阶段无效:${definition.key}`)
    integer(thread.progress, 'state.lifeThread.progress', 0, 100)
    integer(thread.lastAdvancedDay, 'state.lifeThread.lastAdvancedDay', 0, day)
    integerList(thread.evidenceSequences, 'state.lifeThread.evidenceSequences', 2_000, lastSequence)
  }

  const sharedProject = object(row.sharedProject, 'state.sharedProject')
  exact(sharedProject, ['key', 'title', 'progress', 'targetProgress', 'completed'], 'state.sharedProject')
  if (stableKey(sharedProject.key, 'state.sharedProject.key') !== content.economy.sharedProject.key
    || text(sharedProject.title, 'state.sharedProject.title', 200) !== content.economy.sharedProject.title
    || integer(sharedProject.targetProgress, 'state.sharedProject.targetProgress', 1, 1_000_000) !== content.economy.sharedProject.targetProgress) fail('共同建设项目偏离冻结定义')
  const projectProgress = integer(sharedProject.progress, 'state.sharedProject.progress', 0, content.economy.sharedProject.targetProgress)
  if (typeof sharedProject.completed !== 'boolean'
    || sharedProject.completed !== (projectProgress >= content.economy.sharedProject.targetProgress)) fail('共同建设项目完成状态无效')

  const cadence = object(row.cadence, 'state.cadence')
  exact(cadence, ['remainingIntensity', 'highIntensityStreak', 'lastRareCrisisDay', 'seedLastTriggeredDay'], 'state.cadence')
  integer(cadence.remainingIntensity, 'state.cadence.remainingIntensity', 0, content.cadence.dailyIntensityBudget)
  integer(cadence.highIntensityStreak, 'state.cadence.highIntensityStreak', 0, 1_000_000)
  if (cadence.lastRareCrisisDay != null) integer(cadence.lastRareCrisisDay, 'state.cadence.lastRareCrisisDay', 1, day)
  const seedLastTriggeredDay = object(cadence.seedLastTriggeredDay, 'state.cadence.seedLastTriggeredDay')
  for (const [seedKey, lastDay] of Object.entries(seedLastTriggeredDay)) {
    if (!eventSeedKeys.has(seedKey)) fail(`事件冷却引用未知 seed:${seedKey}`)
    integer(lastDay, `state.cadence.seedLastTriggeredDay.${seedKey}`, 1, day)
  }

  if (!Array.isArray(row.pendingMajorChanges) || row.pendingMajorChanges.length > 200) fail('state.pendingMajorChanges 必须是有界数组')
  const candidateKeys = new Set<string>()
  row.pendingMajorChanges.forEach((rawCandidate, index) => {
    const candidate = object(rawCandidate, `state.pendingMajorChanges[${index}]`)
    exact(candidate, ['candidateKey', 'kind', 'title', 'summary', 'residentKeys', 'evidenceSequences', 'status'], `state.pendingMajorChanges[${index}]`)
    const candidateKey = stableKey(candidate.candidateKey, `state.pendingMajorChanges[${index}].candidateKey`)
    if (candidateKeys.has(candidateKey)) fail(`重大变化候选 key 重复:${candidateKey}`)
    candidateKeys.add(candidateKey)
    if (!MAJOR_CHANGE_KINDS.has(String(candidate.kind)) || !content.safety.majorChangeKinds.includes(candidate.kind as never)) fail(`重大变化候选类型无效:${candidateKey}`)
    text(candidate.title, `state.pendingMajorChanges[${index}].title`, 200)
    text(candidate.summary, `state.pendingMajorChanges[${index}].summary`)
    const selectedResidents = keys(candidate.residentKeys, `state.pendingMajorChanges[${index}].residentKeys`, 8)
    if (selectedResidents.some(key => !residentKeys.has(key))) fail(`重大变化候选居民无效:${candidateKey}`)
    integerList(candidate.evidenceSequences, `state.pendingMajorChanges[${index}].evidenceSequences`, 100, lastSequence)
    if (!['pending', 'accepted', 'rejected'].includes(String(candidate.status))) fail(`重大变化候选状态无效:${candidateKey}`)
  })

  if (!Array.isArray(row.dailyDigests) || row.dailyDigests.length > 30) fail('state.dailyDigests 必须是有界数组')
  const digestDays = new Set<number>()
  row.dailyDigests.forEach((rawDigest, index) => {
    const digest = object(rawDigest, `state.dailyDigests[${index}]`)
    exact(digest, ['day', 'publicSummary', 'publicKnowledgeChanges', 'observableRelationshipChanges', 'tomorrowHints', 'throughSequence'], `state.dailyDigests[${index}]`)
    const digestDay = integer(digest.day, `state.dailyDigests[${index}].day`, 1, day)
    if (digestDays.has(digestDay)) fail(`同一游戏日出现重复摘要:${digestDay}`)
    digestDays.add(digestDay)
    strings(digest.publicSummary, `state.dailyDigests[${index}].publicSummary`, 50)
    strings(digest.publicKnowledgeChanges, `state.dailyDigests[${index}].publicKnowledgeChanges`, 50)
    strings(digest.observableRelationshipChanges, `state.dailyDigests[${index}].observableRelationshipChanges`, 50)
    strings(digest.tomorrowHints, `state.dailyDigests[${index}].tomorrowHints`, 50)
    integer(digest.throughSequence, `state.dailyDigests[${index}].throughSequence`, 0, lastSequence)
  })
  strings(row.latestPublicEvents, 'state.latestPublicEvents', 50)
  return structuredClone(value as AiTownRuntimeStateV1)
}

export interface AiTownEventAvailabilityV1 {
  seed: AiTownRuntimeContentV1['eventSeeds'][number]
  available: boolean
  reason: string | null
  participantKeys: string[]
}

export interface AiTownMajorChangeEligibilityV1 {
  eligible: boolean
  reason: string | null
}

export function aiTownMajorChangeEligibilityV1(state: AiTownRuntimeStateV1): AiTownMajorChangeEligibilityV1 {
  if (state.day < 7) return { eligible: false, reason: '重大变化最早只能在第 7 个游戏日提出' }
  if (state.pendingMajorChanges.some(candidate => candidate.status === 'pending')) {
    return { eligible: false, reason: '已有重大变化等待确认' }
  }
  const hasAccumulatedPressure = state.sharedProject.progress > 0
    || Object.values(state.lifeThreads).some(thread => thread.progress > 0)
  if (!hasAccumulatedPressure) return { eligible: false, reason: '尚无可审计的长期生活线或共同建设积累' }
  return { eligible: true, reason: null }
}

export function availableAiTownEventSeedsV1(
  content: AiTownRuntimeContentV1,
  state: AiTownRuntimeStateV1,
): AiTownEventAvailabilityV1[] {
  return content.eventSeeds.map(seed => {
    const participantKeys = seed.participantKeys.filter(key => state.residents[key]?.residencyStatus === 'resident'
      && state.residents[key]?.locationKey === state.player.locationKey)
    const lastDay = state.cadence.seedLastTriggeredDay[seed.key]
    let reason: string | null = null
    if (state.day < seed.minimumDay) reason = `第 ${seed.minimumDay} 日后才可能发生`
    else if (!seed.eligibleSlots.includes(state.slot)) reason = '当前时段不符合事件条件'
    else if (lastDay != null && state.day - lastDay < seed.cooldownDays) reason = '事件仍在冷却'
    else if (seed.intensity > state.cadence.remainingIntensity) reason = '今日事件强度预算不足'
    else if (seed.intensity >= 4 && state.cadence.highIntensityStreak >= content.cadence.highIntensityStreakLimit) reason = '高强度事件需要留出喘息期'
    else if (seed.category === 'rare-crisis' && state.cadence.lastRareCrisisDay != null
      && state.day - state.cadence.lastRareCrisisDay < content.cadence.rareCrisisCooldownDays) reason = '罕见危机仍在全局冷却'
    else if (!participantKeys.length && !seed.locationKeys.includes(state.player.locationKey)) reason = '当前地点无法观察此事件'
    return { seed, available: reason == null, reason, participantKeys }
  })
}

export function nextAiTownSlotV1(current: AiTownDaySlotV1): AiTownDaySlotV1 {
  return DAY_SLOTS[(DAY_SLOTS.indexOf(current) + 1) % DAY_SLOTS.length]
}

export function rebaseAiTownStateForBranchV1(current: AiTownRuntimeStateV1): AiTownRuntimeStateV1 {
  const state = structuredClone(current)
  state.lastSequence = 0
  for (const relationship of Object.values(state.relationships)) relationship.evidenceSequences = []
  for (const thread of Object.values(state.lifeThreads)) thread.evidenceSequences = []
  for (const candidate of state.pendingMajorChanges) candidate.evidenceSequences = []
  for (const fact of Object.values(state.knowledge)) {
    for (const holder of Object.values(fact.holders)) holder.evidenceSequence = 0
  }
  state.memories = state.memories.map(memory => ({ ...memory, sourceSequences: [] }))
  state.dailyDigests = state.dailyDigests.map(digest => ({ ...digest, throughSequence: 0 }))
  return state
}

export function isAiTownLocationReachableV1(content: AiTownRuntimeContentV1, from: string, to: string): boolean {
  if (from === to) return true
  const locations = new Set(content.map.locations.map(location => location.key))
  if (!locations.has(from) || !locations.has(to)) return false
  const queue = [from]
  const seen = new Set(queue)
  while (queue.length) {
    const current = queue.shift()!
    for (const route of content.map.routes) {
      const targets = route.fromLocationKey === current
        ? [route.toLocationKey]
        : route.bidirectional && route.toLocationKey === current ? [route.fromLocationKey] : []
      for (const target of targets) {
        if (target === to) return true
        if (!seen.has(target)) { seen.add(target); queue.push(target) }
      }
    }
  }
  return false
}
