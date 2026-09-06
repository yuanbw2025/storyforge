import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldActionCategoryV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldPlayerCharacterDefinitionV1,
  TextOpenWorldQuestLifecyclePolicyV1,
  TextOpenWorldQuestTypeV1,
  TextOpenWorldRuntimeModuleKeyV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldRuntimePackageV1 } from './runtime-package'

type Row = Record<string, unknown>

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const ACTION_CATEGORIES: TextOpenWorldActionCategoryV1[] = [
  'move', 'travel', 'fast-travel', 'observe', 'investigate', 'talk', 'take', 'use', 'equip', 'unequip', 'drop',
  'buy', 'sell', 'craft', 'accept-quest', 'abandon-quest', 'objective-action', 'quest-action', 'weather-action', 'claim-reward', 'start-combat', 'continue-combat', 'escape',
  'rest', 'respawn', 'read', 'track', 'untrack', 'save', 'load-branch',
]
const QUEST_TYPES: TextOpenWorldQuestTypeV1[] = ['mainline', 'significant', 'ordinary', 'template']
const QUEST_POLICIES: TextOpenWorldQuestLifecyclePolicyV1[] = ['protected-wait', 'abandon-restart', 'abandon-terminal']

function fail(message: string): never { throw new Error(`[text-open-world-modules] ${message}`) }
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Row
}
function exact(value: Row, keys: readonly string[], label: string) {
  const expected = [...keys].sort(); const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) fail(`${label} 字段不符合合同:${actual.join(',')}`)
}
function text(value: unknown, label: string, maximum = 20_000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}
function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!KEY.test(parsed)) fail(`${label} 不是稳定key`)
  return parsed
}
function nullableKey(value: unknown, label: string): string | null { return value == null ? null : key(value, label) }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label} 必须是boolean`); return value }
function numberValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} 必须在${minimum}到${maximum}之间`)
  return value
}
function int(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = numberValue(value, label, minimum, maximum); if (!Number.isInteger(parsed)) fail(`${label} 必须是整数`); return parsed
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 无效`)
  return value as T
}
function array(value: unknown, label: string, maximum = 20_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  return value
}
function strings(value: unknown, label: string, kind: 'key' | 'text' = 'key'): string[] {
  const result = array(value, label).map((item, index) => kind === 'key' ? key(item, `${label}[${index}]`) : text(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}
function catalog(value: unknown, label: string, fields: readonly string[]): Row[] {
  return array(value, label).map((item, index) => { const parsed = row(item, `${label}[${index}]`); exact(parsed, fields, `${label}[${index}]`); return parsed })
}
function keysOf(rows: Row[], label: string): Set<string> {
  const values = rows.map((item, index) => key(item.key, `${label}[${index}].key`))
  if (new Set(values).size !== values.length) fail(`${label}.key 不能重复`)
  return new Set(values)
}
function requireRef(value: string | null, set: ReadonlySet<string>, label: string) {
  if (value != null && !set.has(value)) fail(`${label} 引用不存在:${value}`)
}
function requireRefs(values: readonly string[], set: ReadonlySet<string>, label: string) { values.forEach(value => requireRef(value, set, label)) }
function requireSameKeys(declared: readonly string[], actual: readonly string[], label: string) {
  const left = [...declared].sort()
  const right = [...actual].sort()
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    fail(`${label} 双向引用不一致:declared=${left.join(',')};actual=${right.join(',')}`)
  }
}
function versioned(packageValue: TextOpenWorldRuntimePackageV1, moduleKey: TextOpenWorldRuntimeModuleKeyV1, allowedVersions: number[] = [1]): Row {
  const payload = row(packageValue.modules[moduleKey].payload, `${moduleKey}.payload`)
  if (!allowedVersions.includes(Number(payload.version))) fail(`${moduleKey}.payload.version 无效`)
  if (packageValue.modules[moduleKey].schemaVersion !== payload.version) fail(`${moduleKey}.schemaVersion与payload.version不一致`)
  return payload
}

function playerDefinition(value: unknown): Row {
  const player = row(value, 'actors.player')
  exact(player, ['key', 'identity', 'build'], 'actors.player')
  if (player.key !== 'player') fail('actors.player.key必须为player')
  const identity = row(player.identity, 'actors.player.identity')
  exact(identity, [
    'name', 'pronouns', 'appearance', 'background', 'personality', 'publicKnowledge', 'privateKnowledge',
    'shortGoal', 'longGoal', 'portrayal', 'sourceRefs',
  ], 'actors.player.identity')
  ;[
    'name', 'pronouns', 'appearance', 'background', 'personality', 'publicKnowledge', 'privateKnowledge',
    'shortGoal', 'longGoal', 'portrayal',
  ].forEach(field => text(identity[field], `actors.player.identity.${field}`, 20_000, field !== 'name'))
  strings(identity.sourceRefs, 'actors.player.identity.sourceRefs', 'text')
  const build = row(player.build, 'actors.player.build')
  exact(build, [
    'progressionProfileKey', 'initialLevel', 'attributes', 'learnedSkillKeys', 'startingItemKeys', 'startingCurrency',
  ], 'actors.player.build')
  if (key(build.progressionProfileKey, 'actors.player.build.progressionProfileKey') !== 'progression.default') {
    fail('首版主角只能使用progression.default成长配置')
  }
  int(build.initialLevel, 'actors.player.build.initialLevel', 1, 20)
  int(build.startingCurrency, 'actors.player.build.startingCurrency', 0, 1_000_000_000)
  strings(build.learnedSkillKeys, 'actors.player.build.learnedSkillKeys')
  strings(build.startingItemKeys, 'actors.player.build.startingItemKeys')
  const attributes = row(build.attributes, 'actors.player.build.attributes')
  exact(attributes, ['power', 'vitality', 'agility'], 'actors.player.build.attributes')
  ;['power', 'vitality', 'agility'].forEach(field => int(attributes[field], `actors.player.build.attributes.${field}`, 0, 10_000))
  return player
}

/** Strict standalone parser used by the protagonist confirmation/compiler boundary. */
export function parseTextOpenWorldPlayerCharacterDefinitionV1(value: unknown): TextOpenWorldPlayerCharacterDefinitionV1 {
  return structuredClone(playerDefinition(value)) as unknown as TextOpenWorldPlayerCharacterDefinitionV1
}

/** Strictly validates every v1 logical module and all cross-module stable references. */
export function parseTextOpenWorldModulesV1(value: TextOpenWorldRuntimePackageV1 | string | unknown): TextOpenWorldParsedModulesV1 {
  const packageValue = parseTextOpenWorldRuntimePackageV1(value)

  const narrative = versioned(packageValue, 'narrative')
  exact(narrative, ['version', 'storylines', 'stages', 'endings', 'scenes', 'fixedChoices'], 'narrative')
  const storylines = catalog(narrative.storylines, 'narrative.storylines', ['key', 'kind', 'ownerKind', 'ownerKey', 'title', 'summary', 'stageKeys', 'endingKeys'])
  const narrativeStages = catalog(narrative.stages, 'narrative.stages', ['key', 'storylineKey', 'order', 'title', 'summary', 'questKeys', 'sceneKeys', 'safeWaitPoint'])
  const endings = catalog(narrative.endings, 'narrative.endings', ['key', 'title', 'summary', 'conditionKeys'])
  const scenes = catalog(narrative.scenes, 'narrative.scenes', ['key', 'title', 'purpose', 'locationKey', 'participantKeys', 'actionKeys', 'fixedChoiceKeys'])
  const fixedChoices = catalog(narrative.fixedChoices, 'narrative.fixedChoices', ['key', 'sceneKey', 'label', 'description', 'actionKey'])
  const storylineKeys = keysOf(storylines, 'narrative.storylines'); const narrativeStageKeys = keysOf(narrativeStages, 'narrative.stages')
  const endingKeys = keysOf(endings, 'narrative.endings'); const sceneKeys = keysOf(scenes, 'narrative.scenes'); const choiceKeys = keysOf(fixedChoices, 'narrative.fixedChoices')
  for (const [index, item] of storylines.entries()) {
    enumValue(item.kind, ['mainline', 'significant'], `narrative.storylines[${index}].kind`)
    const ownerKind = enumValue(item.ownerKind, ['core', 'character', 'faction', 'region'], `narrative.storylines[${index}].ownerKind`)
    if (ownerKind === 'core' ? item.ownerKey != null : item.ownerKey == null) fail(`narrative.storylines[${index}].ownerKey 与ownerKind不一致`)
    nullableKey(item.ownerKey, `narrative.storylines[${index}].ownerKey`); text(item.title, `narrative.storylines[${index}].title`, 2_000); text(item.summary, `narrative.storylines[${index}].summary`)
    requireRefs(strings(item.stageKeys, `narrative.storylines[${index}].stageKeys`), narrativeStageKeys, 'storyline stage')
    requireRefs(strings(item.endingKeys, `narrative.storylines[${index}].endingKeys`), endingKeys, 'storyline ending')
  }
  if (storylines.filter(item => item.kind === 'mainline').length !== 1) fail('必须且只能有一条mainline')
  storylines.forEach((item, index) => {
    const storylineKey = key(item.key, `narrative.storylines[${index}].key`)
    requireSameKeys(
      strings(item.stageKeys, `narrative.storylines[${index}].stageKeys`),
      narrativeStages.filter(stage => stage.storylineKey === storylineKey).map(stage => String(stage.key)),
      `storyline ${storylineKey} stages`,
    )
  })
  const mainline = storylines.find(item => item.kind === 'mainline')!
  if (strings(mainline.endingKeys, 'narrative.mainline.endingKeys').length !== packageValue.experienceContract.endingCount) {
    fail('主线结局数量与experienceContract.endingCount不一致')
  }
  narrativeStages.forEach((item, index) => {
    requireRef(key(item.storylineKey, `narrative.stages[${index}].storylineKey`), storylineKeys, 'stage storyline')
    int(item.order, `narrative.stages[${index}].order`, 0, 10_000); text(item.title, `narrative.stages[${index}].title`, 2_000); text(item.summary, `narrative.stages[${index}].summary`); bool(item.safeWaitPoint, `narrative.stages[${index}].safeWaitPoint`)
    strings(item.questKeys, `narrative.stages[${index}].questKeys`); requireRefs(strings(item.sceneKeys, `narrative.stages[${index}].sceneKeys`), sceneKeys, 'stage scene')
  })
  endings.forEach((item, index) => { text(item.title, `narrative.endings[${index}].title`, 2_000); text(item.summary, `narrative.endings[${index}].summary`); strings(item.conditionKeys, `narrative.endings[${index}].conditionKeys`) })
  scenes.forEach((item, index) => { text(item.title, `narrative.scenes[${index}].title`, 2_000); text(item.purpose, `narrative.scenes[${index}].purpose`); key(item.locationKey, `narrative.scenes[${index}].locationKey`); strings(item.participantKeys, `narrative.scenes[${index}].participantKeys`); strings(item.actionKeys, `narrative.scenes[${index}].actionKeys`); requireRefs(strings(item.fixedChoiceKeys, `narrative.scenes[${index}].fixedChoiceKeys`), choiceKeys, 'scene choice') })
  fixedChoices.forEach((item, index) => { requireRef(key(item.sceneKey, `narrative.fixedChoices[${index}].sceneKey`), sceneKeys, 'choice scene'); text(item.label, `narrative.fixedChoices[${index}].label`, 2_000); text(item.description, `narrative.fixedChoices[${index}].description`); key(item.actionKey, `narrative.fixedChoices[${index}].actionKey`) })

  const world = versioned(packageValue, 'world', [1, 2, 3])
  const legacyWorldModule = world.version === 1
  const worldHasLocationKnowledge = world.version === 3
  exact(world, ['version', 'initialLocationKey', 'regions', 'locations', 'edges', 'fastTravelPoints'], 'world')
  const regions = catalog(world.regions, 'world.regions', legacyWorldModule
    ? ['key', 'title', 'description', 'locationKeys', 'initialKnowledge']
    : ['key', 'title', 'description', 'theme', 'levelBand', 'knowledgePolicy', 'locationKeys', 'fastTravelPointKey', 'initialKnowledge', 'sourceRefs', 'presentationRefs'])
  const locations = catalog(world.locations, 'world.locations', legacyWorldModule
    ? ['key', 'regionKey', 'title', 'description', 'kind', 'tags']
    : worldHasLocationKnowledge
      ? ['key', 'regionKey', 'title', 'description', 'kind', 'tags', 'purpose', 'functions', 'earlyArrivalDescription', 'initialKnowledge', 'sourceRefs', 'presentationRefs']
      : ['key', 'regionKey', 'title', 'description', 'kind', 'tags', 'purpose', 'functions', 'earlyArrivalDescription', 'sourceRefs', 'presentationRefs'])
  const edges = catalog(world.edges, 'world.edges', legacyWorldModule
    ? ['key', 'fromLocationKey', 'toLocationKey', 'bidirectional', 'travelMinutes', 'conditionKeys']
    : ['key', 'fromLocationKey', 'toLocationKey', 'bidirectional', 'travelMinutes', 'conditionKeys', 'description', 'riskProfile', 'sourceRefs'])
  const travelPoints = catalog(world.fastTravelPoints, 'world.fastTravelPoints', ['key', 'locationKey', 'unlockedByDefault', 'canRespawn'])
  const regionKeys = keysOf(regions, 'world.regions'); const locationKeys = keysOf(locations, 'world.locations'); keysOf(edges, 'world.edges'); const travelPointKeys = keysOf(travelPoints, 'world.fastTravelPoints')
  const initialLocationKey = key(world.initialLocationKey, 'world.initialLocationKey')
  requireRef(initialLocationKey, locationKeys, 'initial location')
  regions.forEach((item, index) => {
    text(item.title, `world.regions[${index}].title`, 2_000); text(item.description, `world.regions[${index}].description`)
    const ownedLocations = strings(item.locationKeys, `world.regions[${index}].locationKeys`)
    requireRefs(ownedLocations, locationKeys, 'region location')
    enumValue(item.initialKnowledge, ['unknown', 'heard', 'visited', 'familiar'], `world.regions[${index}].initialKnowledge`)
    if (!legacyWorldModule) {
      text(item.theme, `world.regions[${index}].theme`)
      const levelBand = row(item.levelBand, `world.regions[${index}].levelBand`); exact(levelBand, ['minimum', 'maximum'], `world.regions[${index}].levelBand`)
      const minimum = int(levelBand.minimum, `world.regions[${index}].levelBand.minimum`, 1, 20)
      const maximum = int(levelBand.maximum, `world.regions[${index}].levelBand.maximum`, 1, 20)
      if (minimum > maximum) fail(`world.regions[${index}].levelBand范围倒置`)
      enumValue(item.knowledgePolicy, ['hidden-until-heard', 'title-on-heard', 'always-visible'], `world.regions[${index}].knowledgePolicy`)
      requireRef(key(item.fastTravelPointKey, `world.regions[${index}].fastTravelPointKey`), travelPointKeys, 'region fast travel point')
      if (!strings(item.sourceRefs, `world.regions[${index}].sourceRefs`, 'text').length) fail(`world.regions[${index}] 必须说明来源`)
      strings(item.presentationRefs, `world.regions[${index}].presentationRefs`)
    }
  })
  locations.forEach((item, index) => {
    requireRef(key(item.regionKey, `world.locations[${index}].regionKey`), regionKeys, 'location region')
    text(item.title, `world.locations[${index}].title`, 2_000); text(item.description, `world.locations[${index}].description`)
    enumValue(item.kind, ['settlement', 'interior', 'wilderness', 'dungeon', 'landmark'], `world.locations[${index}].kind`)
    strings(item.tags, `world.locations[${index}].tags`, 'text')
    if (!legacyWorldModule) {
      text(item.purpose, `world.locations[${index}].purpose`)
      if (!strings(item.functions, `world.locations[${index}].functions`, 'text').length) fail(`world.locations[${index}] 必须声明至少一种功能`)
      strings(item.functions, `world.locations[${index}].functions`, 'text').forEach((value, functionIndex) => enumValue(value, ['narrative', 'service', 'exploration', 'combat', 'crafting', 'travel'], `world.locations[${index}].functions[${functionIndex}]`))
      text(item.earlyArrivalDescription, `world.locations[${index}].earlyArrivalDescription`)
      if (worldHasLocationKnowledge) enumValue(item.initialKnowledge, ['unknown', 'heard', 'visited', 'familiar'], `world.locations[${index}].initialKnowledge`)
      if (!strings(item.sourceRefs, `world.locations[${index}].sourceRefs`, 'text').length) fail(`world.locations[${index}] 必须说明来源`)
      strings(item.presentationRefs, `world.locations[${index}].presentationRefs`)
    }
  })
  for (const region of regions) for (const locationKey of strings(region.locationKeys, 'region.locationKeys')) if (locations.find(item => item.key === locationKey)?.regionKey !== region.key) fail(`region/location反向引用不一致:${region.key}:${locationKey}`)
  regions.forEach((item, index) => requireSameKeys(
    strings(item.locationKeys, `world.regions[${index}].locationKeys`),
    locations.filter(location => location.regionKey === item.key).map(location => String(location.key)),
    `region ${String(item.key)} locations`,
  ))
  regions.forEach((item, index) => {
    if (!strings(item.locationKeys, `world.regions[${index}].locationKeys`).length) fail(`world.regions[${index}] 至少需要一个地点`)
  })
  edges.forEach((item, index) => {
    const from = key(item.fromLocationKey, `world.edges[${index}].fromLocationKey`); const to = key(item.toLocationKey, `world.edges[${index}].toLocationKey`)
    requireRef(from, locationKeys, 'edge from'); requireRef(to, locationKeys, 'edge to'); if (from === to) fail('edge不能自连')
    bool(item.bidirectional, `world.edges[${index}].bidirectional`); int(item.travelMinutes, `world.edges[${index}].travelMinutes`, 1, 1_000_000); strings(item.conditionKeys, `world.edges[${index}].conditionKeys`)
    if (!legacyWorldModule) {
      text(item.description, `world.edges[${index}].description`)
      enumValue(item.riskProfile, ['safe', 'ordinary', 'dangerous'], `world.edges[${index}].riskProfile`)
      if (!strings(item.sourceRefs, `world.edges[${index}].sourceRefs`, 'text').length) fail(`world.edges[${index}] 必须说明来源`)
    }
  })
  travelPoints.forEach((item, index) => { requireRef(key(item.locationKey, `world.fastTravelPoints[${index}].locationKey`), locationKeys, 'fast travel location'); bool(item.unlockedByDefault, `world.fastTravelPoints[${index}].unlockedByDefault`); bool(item.canRespawn, `world.fastTravelPoints[${index}].canRespawn`) })
  travelPoints.filter(item => item.unlockedByDefault === true).forEach(item => {
    const location = locations.find(candidate => candidate.key === item.locationKey)!
    const initiallyVisited = worldHasLocationKnowledge
      ? location.initialKnowledge === 'visited' || location.initialKnowledge === 'familiar'
      : location.key === initialLocationKey
    if (!initiallyVisited) fail(`默认解锁快速旅行点所属地点必须已到访:${String(item.key)}`)
  })
  if (!travelPoints.some(item => item.unlockedByDefault === true && item.canRespawn === true)) fail('至少需要一个默认解锁的复活点')
  if (!legacyWorldModule) {
    const declaredTravelPointKeys = regions.map((item, index) => key(item.fastTravelPointKey, `world.regions[${index}].fastTravelPointKey`))
    requireSameKeys(declaredTravelPointKeys, [...travelPointKeys], 'region fast travel points')
    regions.forEach((item, index) => {
      const point = travelPoints.find(candidate => candidate.key === item.fastTravelPointKey)!
      const pointRegionKey = locations.find(location => location.key === point.locationKey)?.regionKey
      if (pointRegionKey !== item.key) fail(`world.regions[${index}].fastTravelPointKey不在本地区`)
    })
  }
  const structurallyReachable = new Set<string>([initialLocationKey])
  const frontier = [initialLocationKey]
  while (frontier.length) {
    const current = frontier.shift()!
    for (const edge of edges) {
      const destination = edge.fromLocationKey === current
        ? String(edge.toLocationKey)
        : edge.bidirectional === true && edge.toLocationKey === current ? String(edge.fromLocationKey) : null
      if (destination && !structurallyReachable.has(destination)) { structurallyReachable.add(destination); frontier.push(destination) }
    }
  }
  const unreachableLocationKeys = [...locationKeys].filter(locationKey => !structurallyReachable.has(locationKey))
  if (unreachableLocationKeys.length) fail(`存在从初始地点结构不可达的地点:${unreachableLocationKeys.sort().join(',')}`)

  if (worldHasLocationKnowledge) {
    const rank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
    locations.forEach((item, index) => {
      const region = regions.find(candidate => candidate.key === item.regionKey)!
      if (rank[item.initialKnowledge as keyof typeof rank] > rank[region.initialKnowledge as keyof typeof rank]) {
        fail(`world.locations[${index}].initialKnowledge不能高于所属地区`)
      }
    })
    const initialLocation = locations.find(item => item.key === initialLocationKey)!
    if (!['visited', 'familiar'].includes(String(initialLocation.initialKnowledge))) fail('initialLocation必须初始已到访')
  }

  const normalizedWorld: TextOpenWorldParsedModulesV1['world'] = {
    version: 3,
    initialLocationKey,
    regions: regions.map(item => legacyWorldModule ? {
      key: String(item.key), title: String(item.title), description: String(item.description), theme: String(item.description),
      levelBand: { minimum: 1, maximum: 20 }, knowledgePolicy: 'title-on-heard',
      locationKeys: structuredClone(item.locationKeys) as string[],
      fastTravelPointKey: travelPoints.find(point => locations.find(location => location.key === point.locationKey)?.regionKey === item.key)?.key as string | undefined ?? null,
      initialKnowledge: item.initialKnowledge as TextOpenWorldParsedModulesV1['world']['regions'][number]['initialKnowledge'], sourceRefs: [], presentationRefs: [],
    } : structuredClone(item) as unknown as TextOpenWorldParsedModulesV1['world']['regions'][number]),
    locations: locations.map(item => legacyWorldModule ? {
      key: String(item.key), regionKey: String(item.regionKey), title: String(item.title), description: String(item.description),
      kind: item.kind as TextOpenWorldParsedModulesV1['world']['locations'][number]['kind'], tags: structuredClone(item.tags) as string[],
      purpose: String(item.description), functions: ['exploration'], earlyArrivalDescription: String(item.description),
      initialKnowledge: item.key === initialLocationKey ? 'visited' : 'unknown', sourceRefs: [], presentationRefs: [],
    } : worldHasLocationKnowledge
      ? structuredClone(item) as unknown as TextOpenWorldParsedModulesV1['world']['locations'][number]
      : {
          ...(structuredClone(item) as unknown as Omit<TextOpenWorldParsedModulesV1['world']['locations'][number], 'initialKnowledge'>),
          initialKnowledge: item.key === initialLocationKey ? 'visited' : 'unknown',
        }),
    edges: edges.map(item => legacyWorldModule ? {
      key: String(item.key), fromLocationKey: String(item.fromLocationKey), toLocationKey: String(item.toLocationKey),
      bidirectional: Boolean(item.bidirectional), travelMinutes: Number(item.travelMinutes), conditionKeys: structuredClone(item.conditionKeys) as string[],
      description: '由旧版地图迁移的道路。', riskProfile: 'ordinary', sourceRefs: [],
    } : structuredClone(item) as unknown as TextOpenWorldParsedModulesV1['world']['edges'][number]),
    fastTravelPoints: structuredClone(travelPoints) as unknown as TextOpenWorldParsedModulesV1['world']['fastTravelPoints'],
  }

  const actors = versioned(packageValue, 'actors')
  exact(actors, ['version', 'player', 'factions', 'actors', 'schedules'], 'actors')
  const player = playerDefinition(actors.player)
  const build = row(player.build, 'actors.player.build')
  const factions = catalog(actors.factions, 'actors.factions', ['key', 'title', 'description']); const actorRows = catalog(actors.actors, 'actors.actors', ['key', 'tier', 'name', 'biography', 'portrayal', 'factionKey', 'homeLocationKey', 'protected', 'serviceKeys', 'scheduleKey']); const schedules = catalog(actors.schedules, 'actors.schedules', ['key', 'actorKey', 'entries'])
  const factionKeys = keysOf(factions, 'actors.factions'); const actorKeys = keysOf(actorRows, 'actors.actors'); const scheduleKeys = keysOf(schedules, 'actors.schedules')
  factions.forEach((item, index) => { text(item.title, `actors.factions[${index}].title`, 2_000); text(item.description, `actors.factions[${index}].description`) })
  actorRows.forEach((item, index) => { enumValue(item.tier, ['mainline', 'significant', 'resident', 'transient'], `actors.actors[${index}].tier`); text(item.name, `actors.actors[${index}].name`, 2_000); text(item.biography, `actors.actors[${index}].biography`); text(item.portrayal, `actors.actors[${index}].portrayal`); requireRef(nullableKey(item.factionKey, `actors.actors[${index}].factionKey`), factionKeys, 'actor faction'); requireRef(key(item.homeLocationKey, `actors.actors[${index}].homeLocationKey`), locationKeys, 'actor home'); bool(item.protected, `actors.actors[${index}].protected`); strings(item.serviceKeys, `actors.actors[${index}].serviceKeys`); requireRef(nullableKey(item.scheduleKey, `actors.actors[${index}].scheduleKey`), scheduleKeys, 'actor schedule') })
  schedules.forEach((item, index) => { requireRef(key(item.actorKey, `actors.schedules[${index}].actorKey`), actorKeys, 'schedule actor'); array(item.entries, `actors.schedules[${index}].entries`, 100).forEach((entry, entryIndex) => { const parsed = row(entry, `actors.schedules[${index}].entries[${entryIndex}]`); exact(parsed, ['timePeriodKey', 'locationKey', 'activity'], `actors.schedules[${index}].entries[${entryIndex}]`); key(parsed.timePeriodKey, 'schedule timePeriodKey'); requireRef(key(parsed.locationKey, 'schedule locationKey'), locationKeys, 'schedule location'); text(parsed.activity, 'schedule activity', 2_000) }) })
  actorRows.forEach((item, index) => {
    const scheduleKey = nullableKey(item.scheduleKey, `actors.actors[${index}].scheduleKey`)
    if (scheduleKey && schedules.find(schedule => schedule.key === scheduleKey)?.actorKey !== item.key) fail(`actor/schedule反向引用不一致:${String(item.key)}`)
  })
  schedules.forEach(item => {
    if (actorRows.find(actor => actor.key === item.actorKey)?.scheduleKey !== item.key) fail(`schedule/actor反向引用不一致:${String(item.key)}`)
  })

  const actions = versioned(packageValue, 'actions', [1, 2, 3, 4, 5])
  const modernActionModule = Number(actions.version) >= 2
  const travelActionModule = Number(actions.version) >= 3
  const fastTravelActionModule = Number(actions.version) >= 4
  const timeWeatherActionModule = Number(actions.version) >= 5
  exact(actions, ['version', 'conditions', 'effects', 'actions'], 'actions')
  const conditions = catalog(actions.conditions, 'actions.conditions', ['key', 'expression', 'failureMessage']); const effects = catalog(actions.effects, 'actions.effects', ['key', 'operation', 'payload']); const actionRows = catalog(actions.actions, 'actions.actions', ['key', 'category', 'label', 'description', 'actorScope', 'targetScope', 'locationKeys', 'requirementConditionKeys', 'costEffectKeys', 'successEffectKeys', 'failureEffectKeys', 'timeCostMinutes', 'confirmationPolicy', 'repeatPolicy', 'cooldownMinutes'])
  const conditionKeys = keysOf(conditions, 'actions.conditions'); const effectKeys = keysOf(effects, 'actions.effects'); const actionKeys = keysOf(actionRows, 'actions.actions')
  conditions.forEach((item, index) => { canonicalProductProductionJsonV2(item.expression); text(item.failureMessage, `actions.conditions[${index}].failureMessage`, 1_000) })
  normalizedWorld.edges.forEach((item, index) => requireRefs(item.conditionKeys, conditionKeys, `world.edges[${index}].conditionKeys`))
  effects.forEach((item, index) => { key(item.operation, `actions.effects[${index}].operation`); canonicalProductProductionJsonV2(item.payload) })
  actionRows.forEach((item, index) => { enumValue(item.category, ACTION_CATEGORIES, `actions.actions[${index}].category`); text(item.label, `actions.actions[${index}].label`, 2_000); text(item.description, `actions.actions[${index}].description`); enumValue(item.actorScope, ['player', 'system'], `actions.actions[${index}].actorScope`); enumValue(item.targetScope, ['none', 'actor', 'location', 'item', 'quest', 'vendor', 'encounter'], `actions.actions[${index}].targetScope`); requireRefs(strings(item.locationKeys, `actions.actions[${index}].locationKeys`), locationKeys, 'action location'); requireRefs(strings(item.requirementConditionKeys, `actions.actions[${index}].requirementConditionKeys`), conditionKeys, 'action condition'); requireRefs(strings(item.costEffectKeys, `actions.actions[${index}].costEffectKeys`), effectKeys, 'action cost effect'); requireRefs(strings(item.successEffectKeys, `actions.actions[${index}].successEffectKeys`), effectKeys, 'action success effect'); requireRefs(strings(item.failureEffectKeys, `actions.actions[${index}].failureEffectKeys`), effectKeys, 'action failure effect'); int(item.timeCostMinutes, `actions.actions[${index}].timeCostMinutes`, 0, 1_000_000); enumValue(item.confirmationPolicy, ['never', 'high-risk', 'always'], `actions.actions[${index}].confirmationPolicy`); const repeatPolicy = enumValue(item.repeatPolicy, ['once', 'repeatable', 'cooldown'], `actions.actions[${index}].repeatPolicy`); const cooldown = item.cooldownMinutes == null ? null : int(item.cooldownMinutes, `actions.actions[${index}].cooldownMinutes`, 1, 1_000_000); if ((repeatPolicy === 'cooldown') !== (cooldown != null)) fail(`actions.actions[${index}] cooldown策略不一致`) })

  if (travelActionModule) {
    const travelActions = actionRows.filter(action => action.category === 'travel')
    const routeKeys = travelActions.map(action => {
      const label = `travel action ${String(action.key)}`
      const origins = strings(action.locationKeys, `${label}.locationKeys`)
      const successEffectKeys = strings(action.successEffectKeys, `${label}.successEffectKeys`)
      const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const operations = successEffects.map(effect => String(effect.operation))
      if (action.actorScope !== 'player' || action.targetScope !== 'location' || origins.length !== 1
        || strings(action.costEffectKeys, `${label}.costEffectKeys`).length
        || strings(action.failureEffectKeys, `${label}.failureEffectKeys`).length
        || operations.join(',') !== 'start-travel,advance-time,enter-location'
        || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable'
        || action.cooldownMinutes != null) fail(`${label}合同无效`)
      const startPayload = row(successEffects[0].payload, `${label}.start-travel`)
      const timePayload = row(successEffects[1].payload, `${label}.advance-time`)
      const enterPayload = row(successEffects[2].payload, `${label}.enter-location`)
      const edgeKey = key(startPayload.edgeKey, `${label}.edgeKey`)
      const edge = normalizedWorld.edges.find(candidate => candidate.key === edgeKey) ?? fail(`${label}道路不存在`)
      const originLocationKey = origins[0]
      const destinationLocationKey = key(startPayload.destinationLocationKey, `${label}.destinationLocationKey`)
      const directionAllowed = edge.fromLocationKey === originLocationKey && edge.toLocationKey === destinationLocationKey
        || edge.bidirectional && edge.toLocationKey === originLocationKey && edge.fromLocationKey === destinationLocationKey
      if (!directionAllowed || enterPayload.locationKey !== destinationLocationKey
        || timePayload.minutes !== edge.travelMinutes || action.timeCostMinutes !== edge.travelMinutes) fail(`${label}道路方向、目标或耗时不一致`)
      requireSameKeys(strings(action.requirementConditionKeys, `${label}.requirements`), edge.conditionKeys, `${label}道路条件`)
      return `${edgeKey}:${originLocationKey}->${destinationLocationKey}`
    })
    const expectedRouteKeys = normalizedWorld.edges.flatMap(edge => [
      `${edge.key}:${edge.fromLocationKey}->${edge.toLocationKey}`,
      ...(edge.bidirectional ? [`${edge.key}:${edge.toLocationKey}->${edge.fromLocationKey}`] : []),
    ])
    requireSameKeys(routeKeys, expectedRouteKeys, '普通旅行Action路线覆盖')
    effects.filter(effect => effect.operation === 'start-travel').forEach(effect => {
      const owners = travelActions.filter(action => strings(action.successEffectKeys, `travel action ${String(action.key)} effects`).includes(String(effect.key)))
      if (owners.length !== 1) fail(`start-travel Effect必须且只能属于一个普通旅行Action:${String(effect.key)}`)
    })
    actionRows.filter(action => action.category !== 'travel').forEach(action => {
      const referenced = [...strings(action.costEffectKeys, `action ${String(action.key)} costs`), ...strings(action.successEffectKeys, `action ${String(action.key)} success`), ...strings(action.failureEffectKeys, `action ${String(action.key)} failures`)]
        .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      if (referenced.some(effect => effect.operation === 'start-travel')) fail(`start-travel只能由普通旅行Action引用:${String(action.key)}`)
    })
  }

  if (fastTravelActionModule) {
    const fastTravelActions = actionRows.filter(action => action.category === 'fast-travel')
    if (fastTravelActions.length !== 1) fail('Action v4必须且只能定义一个快速旅行Action')
    const action = fastTravelActions[0]
    const successEffectKeys = strings(action.successEffectKeys, 'fast travel action.successEffectKeys')
    const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (action.actorScope !== 'player' || action.targetScope !== 'location'
      || strings(action.locationKeys, 'fast travel action.locationKeys').length
      || strings(action.costEffectKeys, 'fast travel action.costEffectKeys').length
      || strings(action.failureEffectKeys, 'fast travel action.failureEffectKeys').length
      || successEffects.length !== 1 || successEffects[0].operation !== 'fast-travel'
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('快速旅行Action合同无效')
    const payload = row(successEffects[0].payload, 'fast travel effect.payload')
    exact(payload, ['timeRatioNumerator', 'timeRatioDenominator', 'minimumMinutes'], 'fast travel effect.payload')
    const numerator = int(payload.timeRatioNumerator, 'fast travel effect.timeRatioNumerator', 1, 1_000_000)
    const denominator = int(payload.timeRatioDenominator, 'fast travel effect.timeRatioDenominator', 1, 1_000_000)
    int(payload.minimumMinutes, 'fast travel effect.minimumMinutes', 1, 1_000_000)
    if (numerator > denominator) fail('快速旅行耗时比例不能高于普通路线')
    const fastTravelEffects = effects.filter(effect => effect.operation === 'fast-travel')
    if (fastTravelEffects.length !== 1 || fastTravelEffects[0].key !== successEffects[0].key) fail('快速旅行Effect必须且只能属于快速旅行Action')
    actionRows.filter(candidate => candidate.key !== action.key).forEach(candidate => {
      const referenced = [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failures`)]
      if (referenced.includes(String(successEffects[0].key))) fail(`fast-travel只能由快速旅行Action引用:${String(candidate.key)}`)
    })
  }

  if (timeWeatherActionModule) {
    const weatherActions = actionRows.filter(action => action.category === 'weather-action')
    if (weatherActions.length !== 1) fail('Action v5必须且只能定义一个天气结算Action')
    const action = weatherActions[0]
    const successEffectKeys = strings(action.successEffectKeys, 'weather action.successEffectKeys')
    const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (action.actorScope !== 'system' || action.targetScope !== 'none'
      || strings(action.locationKeys, 'weather action.locationKeys').length
      || strings(action.requirementConditionKeys, 'weather action.requirementConditionKeys').length
      || strings(action.costEffectKeys, 'weather action.costEffectKeys').length
      || strings(action.failureEffectKeys, 'weather action.failureEffectKeys').length
      || successEffects.length !== 1 || successEffects[0].operation !== 'settle-weather'
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('天气结算Action合同无效')
    const weatherEffects = effects.filter(effect => effect.operation === 'settle-weather')
    if (weatherEffects.length !== 1 || weatherEffects[0].key !== successEffects[0].key) fail('天气结算Effect必须且只能属于天气结算Action')
    exact(row(weatherEffects[0].payload, 'weather effect.payload'), [], 'weather effect.payload')
    actionRows.filter(candidate => candidate.key !== action.key).forEach(candidate => {
      const referenced = [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failures`)]
      if (referenced.includes(String(successEffects[0].key))) fail(`settle-weather只能由天气结算Action引用:${String(candidate.key)}`)
    })
    actionRows.filter(candidate => candidate.category !== 'fast-travel' && candidate.category !== 'weather-action').forEach(candidate => {
      const successEffects = strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const nonSuccessEffects = [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failures`)]
        .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      if (nonSuccessEffects.some(effect => effect.operation === 'advance-time')) fail(`世界时间只能在Action成功Effect中推进:${String(candidate.key)}`)
      const timeEffects = successEffects.filter(effect => effect.operation === 'advance-time')
      const declaredMinutes = Number(candidate.timeCostMinutes)
      if (declaredMinutes === 0 && timeEffects.length) fail(`零耗时Action不能推进世界时间:${String(candidate.key)}`)
      if (declaredMinutes > 0) {
        if (timeEffects.length !== 1 || row(timeEffects[0].payload, `action ${String(candidate.key)} time payload`).minutes !== declaredMinutes) {
          fail(`Action声明耗时必须由唯一advance-time Effect落实:${String(candidate.key)}`)
        }
      }
    })
  }

  const quests = versioned(packageValue, 'quests', [1, 2])
  exact(quests, ['version', 'quests', 'stages', 'objectives'], 'quests')
  const legacyQuestModule = quests.version === 1
  const questRows = catalog(quests.quests, 'quests.quests', legacyQuestModule
    ? ['key', 'type', 'ownerKind', 'ownerKey', 'title', 'description', 'storylineKey', 'regionKeys', 'stageKeys', 'prerequisiteConditionKeys', 'rewardEffectKeys', 'lifecyclePolicy', 'timePolicy', 'expirationMinutes', 'repeatable', 'instantiationPolicy', 'initialStatus', 'estimatedMinutes', 'tags']
    : ['key', 'type', 'ownerKind', 'ownerKey', 'title', 'description', 'storylineKey', 'regionKeys', 'stageKeys', 'prerequisiteConditionKeys', 'rewardEffectKeys', 'rewardContractKey', 'claimActionKey', 'lifecyclePolicy', 'timePolicy', 'expirationMinutes', 'repeatable', 'instantiationPolicy', 'initialStatus', 'estimatedMinutes', 'tags'])
    .map(item => legacyQuestModule ? { ...item, rewardContractKey: null, claimActionKey: null } : item)
  const questStages = catalog(quests.stages, 'quests.stages', legacyQuestModule
    ? ['key', 'questKey', 'order', 'title', 'objectiveKeys', 'completionConditionKeys']
    : ['key', 'questKey', 'order', 'title', 'objectiveKeys', 'completionConditionKeys', 'completionActionKey'])
    .map(item => legacyQuestModule ? { ...item, completionActionKey: null } : item)
  const objectives = catalog(quests.objectives, 'quests.objectives', ['key', 'stageKey', 'title', 'optional', 'actionKeys'])
  const questKeys = keysOf(questRows, 'quests.quests'); const questStageKeys = keysOf(questStages, 'quests.stages'); const objectiveKeys = keysOf(objectives, 'quests.objectives')
  questRows.forEach((item, index) => {
    const label = `quests.quests[${index}]`
    const type = enumValue(item.type, QUEST_TYPES, `${label}.type`)
    if (String(item.key).length > 80) fail(`${label}.key超过任务实例稳定引用预算`)
    const ownerKind = enumValue(item.ownerKind, ['global', 'actor', 'faction', 'region', 'location'], `${label}.ownerKind`)
    const ownerKey = nullableKey(item.ownerKey, `${label}.ownerKey`)
    if (ownerKind === 'global') { if (ownerKey != null) fail(`${label}全局任务不能设置ownerKey`) }
    else {
      if (ownerKey == null) fail(`${label}.${ownerKind}任务必须设置ownerKey`)
      requireRef(ownerKey, ownerKind === 'actor' ? actorKeys : ownerKind === 'faction' ? factionKeys : ownerKind === 'region' ? regionKeys : locationKeys, `quest ${ownerKind} owner`)
    }
    text(item.title, `${label}.title`, 2_000); text(item.description, `${label}.description`)
    const storylineKey = nullableKey(item.storylineKey, `${label}.storylineKey`); requireRef(storylineKey, storylineKeys, 'quest storyline')
    if ((type === 'mainline' || type === 'significant') !== (storylineKey != null)) fail(`${label}故事线绑定与叙事等级不一致`)
    const ownedRegionKeys = strings(item.regionKeys, `${label}.regionKeys`); if (!ownedRegionKeys.length) fail(`${label}.regionKeys不能为空`); requireRefs(ownedRegionKeys, regionKeys, 'quest region')
    requireRefs(strings(item.stageKeys, `${label}.stageKeys`), questStageKeys, 'quest stage')
    requireRefs(strings(item.prerequisiteConditionKeys, `${label}.prerequisiteConditionKeys`), conditionKeys, 'quest condition')
    requireRefs(strings(item.rewardEffectKeys, `${label}.rewardEffectKeys`), effectKeys, 'quest reward')
    nullableKey(item.rewardContractKey, `${label}.rewardContractKey`)
    requireRef(nullableKey(item.claimActionKey, `${label}.claimActionKey`), actionKeys, 'quest claim Action')
    const policy = enumValue(item.lifecyclePolicy, QUEST_POLICIES, `${label}.lifecyclePolicy`)
    const timePolicy = enumValue(item.timePolicy, ['waits', 'timed'], `${label}.timePolicy`)
    const expiration = item.expirationMinutes == null ? null : int(item.expirationMinutes, `${label}.expirationMinutes`, 1, 1_000_000_000)
    if (policy === 'protected-wait' && expiration != null) fail(`${label} protected-wait不能过期`)
    if ((timePolicy === 'timed') !== (expiration != null)) fail(`${label}时间策略与expirationMinutes不一致`)
    if ((type === 'mainline' || type === 'significant') && (policy !== 'protected-wait' || timePolicy !== 'waits')) fail(`${label}重要任务必须受保护并等待玩家`)
    const repeatable = bool(item.repeatable, `${label}.repeatable`)
    const instantiationPolicy = enumValue(item.instantiationPolicy, ['session-start', 'director'], `${label}.instantiationPolicy`)
    const initialStatus = enumValue(item.initialStatus, ['locked', 'available', 'revealed'], `${label}.initialStatus`)
    if (type === 'template') {
      if (!repeatable || instantiationPolicy !== 'director' || initialStatus !== 'locked' || storylineKey != null) fail(`${label}模板任务必须由Director重复实例化且不能直接开放`)
    } else if (repeatable || instantiationPolicy !== 'session-start') fail(`${label}正式任务必须在Session开始时建立单一实例`)
    int(item.estimatedMinutes, `${label}.estimatedMinutes`, 1, 100_000)
    strings(item.tags, `${label}.tags`)
  })
  questStages.forEach((item, index) => { requireRef(key(item.questKey, `quests.stages[${index}].questKey`), questKeys, 'quest stage owner'); int(item.order, `quests.stages[${index}].order`, 0, 10_000); text(item.title, `quests.stages[${index}].title`, 2_000); requireRefs(strings(item.objectiveKeys, `quests.stages[${index}].objectiveKeys`), objectiveKeys, 'quest objective'); requireRefs(strings(item.completionConditionKeys, `quests.stages[${index}].completionConditionKeys`), conditionKeys, 'quest completion condition'); requireRef(nullableKey(item.completionActionKey, `quests.stages[${index}].completionActionKey`), actionKeys, 'quest stage completion Action') })
  objectives.forEach((item, index) => { requireRef(key(item.stageKey, `quests.objectives[${index}].stageKey`), questStageKeys, 'objective stage'); text(item.title, `quests.objectives[${index}].title`, 2_000); bool(item.optional, `quests.objectives[${index}].optional`); requireRefs(strings(item.actionKeys, `quests.objectives[${index}].actionKeys`), actionKeys, 'objective action') })
  questRows.forEach((item, index) => requireSameKeys(
    strings(item.stageKeys, `quests.quests[${index}].stageKeys`),
    questStages.filter(stage => stage.questKey === item.key).map(stage => String(stage.key)),
    `quest ${String(item.key)} stages`,
  ))
  questStages.forEach((item, index) => requireSameKeys(
    strings(item.objectiveKeys, `quests.stages[${index}].objectiveKeys`),
    objectives.filter(objective => objective.stageKey === item.key).map(objective => String(objective.key)),
    `quest stage ${String(item.key)} objectives`,
  ))
  narrativeStages.forEach((item, index) => requireRefs(strings(item.questKeys, `narrative.stages[${index}].questKeys`), questKeys, 'narrative stage quest'))
  endings.forEach((item, index) => requireRefs(strings(item.conditionKeys, `narrative.endings[${index}].conditionKeys`), conditionKeys, 'ending condition'))
  scenes.forEach((item, index) => { requireRef(key(item.locationKey, `narrative.scenes[${index}].locationKey`), locationKeys, 'scene location'); requireRefs(strings(item.participantKeys, `narrative.scenes[${index}].participantKeys`), actorKeys, 'scene participant'); requireRefs(strings(item.actionKeys, `narrative.scenes[${index}].actionKeys`), actionKeys, 'scene action') })
  fixedChoices.forEach((item, index) => requireRef(key(item.actionKey, `narrative.fixedChoices[${index}].actionKey`), actionKeys, 'fixed choice action'))
  scenes.forEach((item, index) => requireSameKeys(
    strings(item.fixedChoiceKeys, `narrative.scenes[${index}].fixedChoiceKeys`),
    fixedChoices.filter(choice => choice.sceneKey === item.key).map(choice => String(choice.key)),
    `scene ${String(item.key)} choices`,
  ))
  narrativeStages.forEach(item => {
    const storyline = storylines.find(candidate => candidate.key === item.storylineKey)
    strings(item.questKeys, `narrative stage ${String(item.key)} questKeys`).forEach(questKey => {
      const quest = questRows.find(candidate => candidate.key === questKey)
      if (!quest || !storyline || quest.storylineKey !== storyline.key || quest.type !== storyline.kind) fail(`叙事阶段与任务故事线不一致:${String(item.key)}:${questKey}`)
    })
  })
  questRows.filter(item => item.type === 'mainline' || item.type === 'significant').forEach(item => {
    const owners = narrativeStages.filter(stage => strings(stage.questKeys, `narrative stage ${String(stage.key)} questKeys`).includes(String(item.key)))
    if (owners.length !== 1) fail(`重要任务必须且只能属于一个叙事阶段:${String(item.key)}`)
  })
  const orderedMainQuestKeys = storylines.filter(item => item.kind === 'mainline').flatMap(storyline =>
    narrativeStages.filter(stage => stage.storylineKey === storyline.key).sort((left, right) => Number(left.order) - Number(right.order))
      .flatMap(stage => strings(stage.questKeys, `narrative stage ${String(stage.key)} questKeys`)))
  const initiallyRevealedMainQuestKeys = questRows.filter(item => item.type === 'mainline' && item.initialStatus === 'revealed').map(item => String(item.key))
  if (orderedMainQuestKeys.length && (initiallyRevealedMainQuestKeys.length !== 1 || initiallyRevealedMainQuestKeys[0] !== orderedMainQuestKeys[0])) {
    fail('严格顺序主线必须只揭示第一个任务定义')
  }
  if (!legacyQuestModule) {
    objectives.forEach(objective => {
      const completers = strings(objective.actionKeys, `objective ${String(objective.key)} actionKeys`).map(actionKey => actionRows.find(action => action.key === actionKey)!)
        .filter(action => action.category === 'objective-action')
      if (!completers.length) fail(`Objective必须至少绑定一个完成Action:${String(objective.key)}`)
      completers.forEach(action => {
        const successEffects = strings(action.successEffectKeys, `objective action ${String(action.key)} successEffectKeys`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
        const completionEffects = successEffects.filter(effect => effect.operation === 'complete-objective')
        if (action.actorScope !== 'player' || action.targetScope !== 'quest'
          || strings(action.costEffectKeys, `objective action ${String(action.key)} costEffectKeys`).length
          || strings(action.failureEffectKeys, `objective action ${String(action.key)} failureEffectKeys`).length
          || successEffects.length !== 1 || completionEffects.length !== 1
          || row(completionEffects[0].payload, `objective action ${String(action.key)} payload`).objectiveKey !== objective.key
          || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable') fail(`Objective完成Action合同无效:${String(action.key)}`)
      })
    })
    actionRows.filter(action => action.category === 'objective-action').forEach(action => {
      const owners = objectives.filter(objective => strings(objective.actionKeys, `objective ${String(objective.key)} actionKeys`).includes(String(action.key)))
      if (owners.length !== 1) fail(`Objective Action必须且只能属于一个Objective:${String(action.key)}`)
    })
    effects.filter(effect => effect.operation === 'complete-objective').forEach(effect => {
      const actionOwners = actionRows.filter(action => action.category === 'objective-action'
        && strings(action.successEffectKeys, `objective action ${String(action.key)} success effects`).includes(String(effect.key)))
      if (actionOwners.length !== 1) fail(`complete-objective Effect必须且只能属于一个Objective Action:${String(effect.key)}`)
    })
    actionRows.forEach(action => {
      const referencedEffects = [...strings(action.costEffectKeys, `action ${String(action.key)} costs`), ...strings(action.successEffectKeys, `action ${String(action.key)} success`), ...strings(action.failureEffectKeys, `action ${String(action.key)} failures`)]
        .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      if (referencedEffects.some(effect => effect.operation === 'complete-objective') && action.category !== 'objective-action') fail(`complete-objective只能由Objective Action引用:${String(action.key)}`)
    })
    questStages.forEach(stage => {
      const completionActionKey = key(stage.completionActionKey, `quest stage ${String(stage.key)} completionActionKey`)
      const action = actionRows.find(candidate => candidate.key === completionActionKey) ?? fail(`Stage完成Action不存在:${completionActionKey}`)
      const quest = questRows.find(candidate => candidate.key === stage.questKey)!
      const orderedStages = strings(quest.stageKeys, `quest ${String(quest.key)} stageKeys`).map(stageKey => questStages.find(candidate => candidate.key === stageKey)!)
        .sort((left, right) => Number(left.order) - Number(right.order))
      const stageIndex = orderedStages.findIndex(candidate => candidate.key === stage.key)
      const expectedStatus = stageIndex === orderedStages.length - 1 ? 'completed' : 'active'
      const expectedStageKey = stageIndex === orderedStages.length - 1 ? stage.key : orderedStages[stageIndex + 1].key
      const successEffects = strings(action.successEffectKeys, `stage action ${completionActionKey} successEffectKeys`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const transitions = successEffects.filter(effect => effect.operation === 'transition-quest')
      const payload = transitions.length === 1 ? row(transitions[0].payload, `stage action ${completionActionKey} payload`) : null
      if (!payload || action.category !== 'quest-action' || action.actorScope !== 'system' || action.targetScope !== 'quest'
        || successEffects.length !== 1 || transitions.length !== 1 || payload?.questKey !== quest.key
        || payload.status !== expectedStatus || payload.stageKey !== expectedStageKey) fail(`Stage完成Action没有推进相邻Stage或完成任务:${completionActionKey}`)
      requireSameKeys(strings(action.requirementConditionKeys, `stage action ${completionActionKey} requirements`), strings(stage.completionConditionKeys, `stage ${String(stage.key)} completion conditions`), `stage ${String(stage.key)} completion conditions`)
    })
  }
  actionRows.filter(action => ['accept-quest', 'abandon-quest'].includes(String(action.category))).forEach(action => {
    const label = `quest action ${String(action.key)}`
    if (action.actorScope !== 'player' || action.targetScope !== 'quest' || strings(action.costEffectKeys, `${label}.costEffectKeys`).length || strings(action.failureEffectKeys, `${label}.failureEffectKeys`).length) fail(`${label}必须是无cost/failure的玩家任务实例Action`)
    const transitions = strings(action.successEffectKeys, `${label}.successEffectKeys`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'transition-quest')
    if (transitions.length !== strings(action.successEffectKeys, `${label}.successEffectKeys`).length) fail(`${label}只能包含任务迁移Effect`)
    const transitionPayloads = transitions.map(effect => row(effect.payload, `${label}.${String(effect.key)}.payload`))
    const definitionKeys = new Set(transitionPayloads.map(payload => String(payload.questKey)))
    if (definitionKeys.size !== 1) fail(`${label}必须只绑定一个任务定义`)
    const definition = questRows.find(quest => quest.key === [...definitionKeys][0]) ?? fail(`${label}任务定义不存在`)
    if (action.category === 'accept-quest') {
      if (transitionPayloads.length !== 2 || transitionPayloads[0].status !== 'accepted' || transitionPayloads[0].stageKey != null
        || transitionPayloads[1].status !== 'active' || !strings(definition.stageKeys, `${label}.definition.stageKeys`).includes(String(transitionPayloads[1].stageKey))) fail(`${label}必须依次accept并激活合法Stage`)
    } else if (transitionPayloads.length !== 1 || transitionPayloads[0].status !== 'abandoned'
      || !strings(definition.stageKeys, `${label}.definition.stageKeys`).includes(String(transitionPayloads[0].stageKey))
      || ['mainline', 'significant'].includes(String(definition.type))) fail(`${label}不能违反任务保护策略`)
    if (action.confirmationPolicy !== (action.category === 'abandon-quest' ? 'always' : 'never') || action.repeatPolicy !== 'repeatable') fail(`${label}确认或重复策略无效`)
  })
  actionRows.forEach(action => {
    const allEffectKeys = [
      ...strings(action.costEffectKeys, `action ${String(action.key)}.costEffectKeys`),
      ...strings(action.successEffectKeys, `action ${String(action.key)}.successEffectKeys`),
      ...strings(action.failureEffectKeys, `action ${String(action.key)}.failureEffectKeys`),
    ]
    const transitions = allEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'transition-quest')
    if (!transitions.length) return
    const category = String(action.category)
    if (!['accept-quest', 'abandon-quest', 'quest-action'].includes(category)) fail(`任务迁移Effect只能由任务生命周期Action引用:${String(action.key)}`)
    if (category !== 'quest-action') return
    const label = `system quest action ${String(action.key)}`
    if (action.actorScope !== 'system' || action.targetScope !== 'quest'
      || strings(action.costEffectKeys, `${label}.costEffectKeys`).length
      || strings(action.failureEffectKeys, `${label}.failureEffectKeys`).length
      || transitions.length !== strings(action.successEffectKeys, `${label}.successEffectKeys`).length
      || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable') fail(`${label}合同无效`)
    const payloads = transitions.map(effect => row(effect.payload, `${label}.${String(effect.key)}.payload`))
    const definitionKeys = new Set(payloads.map(payload => String(payload.questKey)))
    if (definitionKeys.size !== 1) fail(`${label}必须只迁移一个任务定义`)
    const definition = questRows.find(quest => quest.key === [...definitionKeys][0]) ?? fail(`${label}任务定义不存在`)
    const targetStatuses = payloads.map(payload => String(payload.status))
    if (targetStatuses.includes('accepted') || targetStatuses.includes('abandoned')) fail(`${label}不能代替玩家接取或放弃`)
    if ((definition.type === 'mainline' || definition.type === 'significant')
      && targetStatuses.some(status => ['failed', 'expired', 'withdrawn'].includes(status))) fail(`${label}不能破坏受保护故事线`)
    if (targetStatuses.includes('expired') && definition.timePolicy !== 'timed') fail(`${label}不能使非限时任务过期`)
  })
  const trackingActions = actionRows.filter(action => action.category === 'track' || action.category === 'untrack')
  trackingActions.forEach(action => {
    const label = `quest tracking action ${String(action.key)}`
    const successEffects = strings(action.successEffectKeys, `${label}.successEffectKeys`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
    const expectedOperation = action.category === 'track' ? 'track-quest' : 'untrack-quest'
    if (action.actorScope !== 'player' || action.targetScope !== 'quest'
      || strings(action.requirementConditionKeys, `${label}.requirements`).length
      || strings(action.costEffectKeys, `${label}.costs`).length
      || strings(action.failureEffectKeys, `${label}.failures`).length
      || successEffects.length !== 1 || successEffects[0].operation !== expectedOperation
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail(`${label}合同无效`)
    const payload = row(successEffects[0].payload, `${label}.payload`)
    exact(payload, ['slot'], `${label}.payload`)
    enumValue(payload.slot, ['primary', 'pinned'], `${label}.slot`)
  })
  effects.filter(effect => effect.operation === 'track-quest' || effect.operation === 'untrack-quest').forEach(effect => {
    const owners = trackingActions.filter(action => strings(action.successEffectKeys, `tracking action ${String(action.key)} effects`).includes(String(effect.key)))
    if (owners.length !== 1) fail(`任务追踪Effect必须且只能属于一个追踪Action:${String(effect.key)}`)
  })
  actionRows.filter(action => action.category !== 'track' && action.category !== 'untrack').forEach(action => {
    const referenced = [...strings(action.costEffectKeys, `action ${String(action.key)} costs`), ...strings(action.successEffectKeys, `action ${String(action.key)} success`), ...strings(action.failureEffectKeys, `action ${String(action.key)} failures`)]
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (referenced.some(effect => effect.operation === 'track-quest' || effect.operation === 'untrack-quest')) fail(`任务追踪Effect只能由追踪Action引用:${String(action.key)}`)
  })
  if (modernActionModule) {
    const trackingModes = trackingActions.map(action => {
      const effect = effects.find(candidate => candidate.key === strings(action.successEffectKeys, `tracking action ${String(action.key)} effects`)[0])!
      return `${String(action.category)}:${String(row(effect.payload, `tracking action ${String(action.key)} payload`).slot)}`
    })
    requireSameKeys(trackingModes, ['track:primary', 'track:pinned', 'untrack:primary', 'untrack:pinned'], '任务追踪Action能力')
  }
  if (modernActionModule && !legacyQuestModule) {
    questRows.filter(quest => quest.timePolicy === 'timed').forEach(quest => {
      const questKey = String(quest.key)
      const expirationActions = actionRows.filter(action => {
        if (action.category !== 'quest-action' || action.actorScope !== 'system') return false
        const transitions = strings(action.successEffectKeys, `expiration action ${String(action.key)} effects`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
          .filter(effect => effect.operation === 'transition-quest')
        if (transitions.length !== 1) return false
        const payload = row(transitions[0].payload, `expiration action ${String(action.key)} payload`)
        return payload.questKey === questKey && payload.status === 'expired'
      })
      const stageCoverage = expirationActions.map(action => {
        if (strings(action.requirementConditionKeys, `expiration action ${String(action.key)} requirements`).length
          || strings(action.costEffectKeys, `expiration action ${String(action.key)} costs`).length
          || strings(action.failureEffectKeys, `expiration action ${String(action.key)} failures`).length
          || strings(action.successEffectKeys, `expiration action ${String(action.key)} effects`).length !== 1
          || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable'
          || action.cooldownMinutes != null || action.timeCostMinutes !== 0) fail(`限时任务过期Action合同无效:${String(action.key)}`)
        const effect = effects.find(candidate => candidate.key === strings(action.successEffectKeys, `expiration action ${String(action.key)} effects`)[0])!
        return String(row(effect.payload, `expiration action ${String(action.key)} payload`).stageKey ?? '__unstarted__')
      })
      requireSameKeys(stageCoverage, ['__unstarted__', ...strings(quest.stageKeys, `quest ${questKey} stageKeys`)], `限时任务${questKey}过期Stage覆盖`)
    })
  }

  const progression = versioned(packageValue, 'progression')
  exact(progression, ['version', 'rules', 'levels', 'skills', 'statuses'], 'progression')
  const progressionRules = row(progression.rules, 'progression.rules'); exact(progressionRules, ['maximumLevel', 'automaticAttributeGrowth', 'levelUp', 'attributes', 'formulas'], 'progression.rules'); const maximumLevel = int(progressionRules.maximumLevel, 'progression.rules.maximumLevel', 1, 20); if (maximumLevel !== 20) fail('首版maximumLevel必须为20'); if (progressionRules.automaticAttributeGrowth !== true) fail('首版必须自动属性成长')
  const levelUp = row(progressionRules.levelUp, 'progression.rules.levelUp'); exact(levelUp, ['resourcePolicy', 'maximumLevelExperiencePolicy'], 'progression.rules.levelUp'); if (levelUp.resourcePolicy !== 'increase-by-cap-delta' || levelUp.maximumLevelExperiencePolicy !== 'cap-at-threshold') fail('progression.rules.levelUp不符合首版冻结策略')
  const attributeLabels = row(progressionRules.attributes, 'progression.rules.attributes'); exact(attributeLabels, ['power', 'vitality', 'agility'], 'progression.rules.attributes'); ['power', 'vitality', 'agility'].forEach(field => { const entry = row(attributeLabels[field], `progression.rules.attributes.${field}`); exact(entry, ['label'], `progression.rules.attributes.${field}`); text(entry.label, `progression.rules.attributes.${field}.label`, 100) })
  const formulas = row(progressionRules.formulas, 'progression.rules.formulas'); const formulaKeys = ['baseHealth', 'healthPerVitality', 'healthPerLevel', 'attackPerPower', 'defensePerVitality', 'baseCriticalChance', 'criticalChancePerAgility', 'criticalChanceCap', 'initiativePerAgility', 'baseSkillResource', 'skillResourcePerLevel']; exact(formulas, formulaKeys, 'progression.rules.formulas'); formulaKeys.forEach(field => numberValue(formulas[field], `progression.rules.formulas.${field}`, 0, 1_000_000))
  const baseCriticalChance = numberValue(formulas.baseCriticalChance, 'progression.rules.formulas.baseCriticalChance', 0, 1)
  numberValue(formulas.criticalChancePerAgility, 'progression.rules.formulas.criticalChancePerAgility', 0, 1)
  const criticalChanceCap = numberValue(formulas.criticalChanceCap, 'progression.rules.formulas.criticalChanceCap', 0, 1)
  if (baseCriticalChance > criticalChanceCap) fail('baseCriticalChance不能大于criticalChanceCap')
  const levels = catalog(progression.levels, 'progression.levels', ['level', 'cumulativeExperience', 'attributeGrowth', 'unlockedSkillKeys']); const skills = catalog(progression.skills, 'progression.skills', ['key', 'title', 'description', 'tags', 'activation', 'kind', 'target', 'scalingAttribute', 'unlockSources', 'useConditionKeys', 'priority', 'resourceCost', 'cooldownTurns', 'effectKeys']); const statuses = catalog(progression.statuses, 'progression.statuses', ['key', 'title', 'description', 'polarity']); const skillKeys = keysOf(skills, 'progression.skills'); keysOf(statuses, 'progression.statuses')
  if (levels.length !== maximumLevel) fail('progression.levels必须覆盖1到maximumLevel')
  let previousExperience = -1
  levels.forEach((item, index) => { if (int(item.level, `progression.levels[${index}].level`, 1, maximumLevel) !== index + 1) fail('progression.levels必须连续有序'); const experience = int(item.cumulativeExperience, `progression.levels[${index}].cumulativeExperience`, 0, 1_000_000_000); if (experience <= previousExperience && index > 0) fail('累计经验必须递增'); previousExperience = experience; const growth = row(item.attributeGrowth, `progression.levels[${index}].attributeGrowth`); exact(growth, ['power', 'vitality', 'agility'], `progression.levels[${index}].attributeGrowth`); ['power', 'vitality', 'agility'].forEach(field => int(growth[field], `progression.levels[${index}].attributeGrowth.${field}`, 0, 10_000)); strings(item.unlockedSkillKeys, `progression.levels[${index}].unlockedSkillKeys`) })
  if (Number(levels[0].cumulativeExperience) !== 0 || canonicalProductProductionJsonV2(levels[0].attributeGrowth) !== canonicalProductProductionJsonV2({ power: 0, vitality: 0, agility: 0 })) fail('1级必须从0经验和零成长增量开始')
  skills.forEach((item, index) => {
    text(item.title, `progression.skills[${index}].title`, 2_000); text(item.description, `progression.skills[${index}].description`); strings(item.tags, `progression.skills[${index}].tags`, 'text')
    const activation = enumValue(item.activation, ['active', 'passive'], `progression.skills[${index}].activation`)
    enumValue(item.kind, ['attack', 'status', 'resource', 'recovery'], `progression.skills[${index}].kind`)
    const target = enumValue(item.target, ['self', 'single-enemy', 'all-enemies'], `progression.skills[${index}].target`)
    if (item.scalingAttribute != null) enumValue(item.scalingAttribute, ['power', 'vitality', 'agility'], `progression.skills[${index}].scalingAttribute`)
    const unlockSources = array(item.unlockSources, `progression.skills[${index}].unlockSources`, 100)
    if (!unlockSources.length) fail(`progression.skills[${index}]至少需要一个获得来源`)
    const sourceFingerprints = unlockSources.map((source, sourceIndex) => {
      const parsed = row(source, `progression.skills[${index}].unlockSources[${sourceIndex}]`); exact(parsed, ['kind', 'level', 'questKey'], `progression.skills[${index}].unlockSources[${sourceIndex}]`)
      const kind = enumValue(parsed.kind, ['initial', 'level', 'quest'], `progression.skills[${index}].unlockSources[${sourceIndex}].kind`)
      const level = parsed.level == null ? null : int(parsed.level, `progression.skills[${index}].unlockSources[${sourceIndex}].level`, 2, maximumLevel)
      const questKey = nullableKey(parsed.questKey, `progression.skills[${index}].unlockSources[${sourceIndex}].questKey`)
      if ((kind === 'level') !== (level != null) || (kind === 'quest') !== (questKey != null)) fail(`progression.skills[${index}].unlockSources[${sourceIndex}]字段与kind不一致`)
      return `${kind}:${level ?? questKey ?? 'initial'}`
    })
    if (new Set(sourceFingerprints).size !== sourceFingerprints.length) fail(`progression.skills[${index}].unlockSources不能重复`)
    requireRefs(strings(item.useConditionKeys, `progression.skills[${index}].useConditionKeys`), conditionKeys, 'skill use condition')
    int(item.priority, `progression.skills[${index}].priority`, 0, 10_000)
    const resourceCost = int(item.resourceCost, `progression.skills[${index}].resourceCost`, 0, 1_000_000); const cooldownTurns = int(item.cooldownTurns, `progression.skills[${index}].cooldownTurns`, 0, 10_000)
    requireRefs(strings(item.effectKeys, `progression.skills[${index}].effectKeys`), effectKeys, 'skill effect')
    if (activation === 'passive' && (target !== 'self' || resourceCost !== 0 || cooldownTurns !== 0)) fail(`progression.skills[${index}]被动技能不能主动选择或消耗资源`)
  })
  statuses.forEach((item, index) => { text(item.title, `progression.statuses[${index}].title`, 2_000); text(item.description, `progression.statuses[${index}].description`); enumValue(item.polarity, ['beneficial', 'harmful', 'neutral'], `progression.statuses[${index}].polarity`) })
  levels.forEach((item, index) => requireRefs(strings(item.unlockedSkillKeys, `progression.levels[${index}].unlockedSkillKeys`), skillKeys, 'level unlocked skill'))
  requireRefs(strings(build.learnedSkillKeys, 'actors.player.build.learnedSkillKeys'), skillKeys, 'player skill'); if (Number(build.initialLevel) > maximumLevel) fail('player initialLevel超过maximumLevel')
  const skillSources = new Map(skills.map((skill, skillIndex) => [String(skill.key), array(skill.unlockSources, `progression.skills[${skillIndex}].unlockSources`).map(source => row(source, 'skill unlock source'))]))
  const initialLevel = Number(build.initialLevel)
  const expectedInitialSkillKeys = skills.filter(skill => (skillSources.get(String(skill.key)) ?? []).some(source => source.kind === 'initial' || (source.kind === 'level' && Number(source.level) <= initialLevel))).map(skill => String(skill.key))
  requireSameKeys(strings(build.learnedSkillKeys, 'actors.player.build.learnedSkillKeys'), expectedInitialSkillKeys, 'initial player skills')
  requireSameKeys(strings(levels[0].unlockedSkillKeys, 'progression.levels[0].unlockedSkillKeys'), skills.filter(skill => skillSources.get(String(skill.key))?.some(source => source.kind === 'initial')).map(skill => String(skill.key)), 'level 1 initial skills')
  for (let level = 2; level <= maximumLevel; level += 1) {
    for (const skillKey of strings(levels[level - 1].unlockedSkillKeys, `progression.levels[${level - 1}].unlockedSkillKeys`)) {
      if (!skillSources.get(skillKey)?.some(source => source.kind === 'level' && source.level === level)) fail(`技能${skillKey}缺少level:${level}获得来源`)
    }
  }
  skills.forEach(skill => {
    const sourceRows = skillSources.get(String(skill.key)) ?? []
    sourceRows.filter(source => source.kind === 'level').forEach(source => {
      const level = Number(source.level)
      if (!strings(levels[level - 1].unlockedSkillKeys, `progression.levels[${level - 1}].unlockedSkillKeys`).includes(String(skill.key))) fail(`技能${String(skill.key)}的level来源没有进入等级曲线`)
    })
    sourceRows.filter(source => source.kind === 'quest').forEach(source => {
      const questKey = key(source.questKey, `skill ${String(skill.key)} quest source`); requireRef(questKey, questKeys, 'skill quest source')
      const quest = questRows.find(candidate => candidate.key === questKey)!
      const rewarded = strings(quest.rewardEffectKeys, `quest ${questKey} reward effects`).some(effectKey => {
        const effect = effects.find(candidate => candidate.key === effectKey)
        return effect?.operation === 'learn-skill' && row(effect.payload, `effect ${effectKey}.payload`).skillKey === skill.key
      })
      if (!rewarded) fail(`技能${String(skill.key)}的任务来源${questKey}没有对应学习Effect奖励`)
    })
  })
  actionRows.forEach((action, index) => {
    const category = String(action.category)
    const costEffectKeys = strings(action.costEffectKeys, `actions.actions[${index}].costEffectKeys`)
    const successEffectKeys = strings(action.successEffectKeys, `actions.actions[${index}].successEffectKeys`)
    const failureEffectKeys = strings(action.failureEffectKeys, `actions.actions[${index}].failureEffectKeys`)
    const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (category === 'respawn') {
      if (action.targetScope !== 'none' || costEffectKeys.length || failureEffectKeys.length || successEffects.length !== 1
        || successEffects[0].operation !== 'respawn' || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
        || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail(`actions.actions[${index}] 复活Action不符合无代价契约`)
    }
    if (category === 'rest') {
      const restEffects = successEffects.filter(effect => effect.operation === 'rest')
      const timeEffects = successEffects.filter(effect => effect.operation === 'advance-time')
      if (action.targetScope !== 'none' || costEffectKeys.length || failureEffectKeys.length || restEffects.length !== 1
        || timeEffects.length !== 1 || successEffects.length !== 2 || action.confirmationPolicy !== 'never'
        || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null || Number(action.timeCostMinutes) < 1
        || row(timeEffects[0].payload, `actions.actions[${index}] rest time payload`).minutes !== action.timeCostMinutes) fail(`actions.actions[${index}] 休息Action不符合恢复与时间契约`)
    }
  })

  const items = versioned(packageValue, 'items')
  exact(items, ['version', 'equipmentSlots', 'items', 'rewardContracts', 'dropTables'], 'items')
  const slots = catalog(items.equipmentSlots, 'items.equipmentSlots', ['key', 'label']); const itemRows = catalog(items.items, 'items.items', ['key', 'title', 'description', 'tags', 'kind', 'stackPolicy', 'maximumStack', 'unique', 'consumable', 'critical', 'droppable', 'sellable', 'baseValue', 'useActionKey', 'equipActionKey', 'unequipActionKey', 'equipConditionKeys', 'equipmentSlotKey', 'statModifiers', 'effectKeys', 'sourceRefs', 'presentationRefs']); const rewardContracts = catalog(items.rewardContracts, 'items.rewardContracts', ['key', 'title', 'sourceKind', 'claimPolicy', 'expectedMinutes', 'budgetClass', 'conditionKeys', 'effectKeys', 'dropTableKeys']); const dropTables = catalog(items.dropTables, 'items.dropTables', ['key', 'algorithm', 'rolls', 'conditionKeys', 'entries'])
  const slotKeys = keysOf(slots, 'items.equipmentSlots'); if ([...slotKeys].sort().join(',') !== ['accessory', 'armor', 'weapon'].join(',')) fail('首版装备位必须为weapon/armor/accessory')
  slots.forEach((item, index) => text(item.label, `items.equipmentSlots[${index}].label`, 100)); const itemKeys = keysOf(itemRows, 'items.items'); const rewardContractKeys = keysOf(rewardContracts, 'items.rewardContracts'); const dropTableKeys = keysOf(dropTables, 'items.dropTables')
  const modifierFields = ['maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'skillPower', 'skillResource']
  itemRows.forEach((item, index) => {
    text(item.title, `items.items[${index}].title`, 2_000); text(item.description, `items.items[${index}].description`); strings(item.tags, `items.items[${index}].tags`, 'text')
    const kind = enumValue(item.kind, ['equipment', 'consumable', 'material', 'quest', 'misc'], `items.items[${index}].kind`)
    const stackPolicy = enumValue(item.stackPolicy, ['stacked', 'instanced'], `items.items[${index}].stackPolicy`)
    const maximumStack = item.maximumStack == null ? null : int(item.maximumStack, `items.items[${index}].maximumStack`, 1, 1_000_000)
    const unique = bool(item.unique, `items.items[${index}].unique`); const consumable = bool(item.consumable, `items.items[${index}].consumable`); const critical = bool(item.critical, `items.items[${index}].critical`)
    const droppable = bool(item.droppable, `items.items[${index}].droppable`); const sellable = bool(item.sellable, `items.items[${index}].sellable`)
    int(item.baseValue, `items.items[${index}].baseValue`, 0, 1_000_000_000)
    const useActionKey = nullableKey(item.useActionKey, `items.items[${index}].useActionKey`); requireRef(useActionKey, actionKeys, 'item use Action')
    const equipActionKey = nullableKey(item.equipActionKey, `items.items[${index}].equipActionKey`); requireRef(equipActionKey, actionKeys, 'item equip Action')
    const unequipActionKey = nullableKey(item.unequipActionKey, `items.items[${index}].unequipActionKey`); requireRef(unequipActionKey, actionKeys, 'item unequip Action')
    requireRefs(strings(item.equipConditionKeys, `items.items[${index}].equipConditionKeys`), conditionKeys, 'item equip condition')
    const slot = nullableKey(item.equipmentSlotKey, `items.items[${index}].equipmentSlotKey`); requireRef(slot, slotKeys, 'item slot')
    if ((stackPolicy === 'stacked') !== (maximumStack != null) || (stackPolicy === 'instanced' && maximumStack != null)) fail(`items.items[${index}] stackPolicy/maximumStack不一致`)
    if (unique && stackPolicy !== 'instanced') fail(`items.items[${index}] 唯一物品必须实例化`)
    if ((kind === 'equipment') !== (slot != null) || (kind === 'equipment' && stackPolicy !== 'instanced')) fail(`items.items[${index}] 装备类型/槽位/实例策略不一致`)
    if ((kind === 'equipment') !== (equipActionKey != null && unequipActionKey != null)) fail(`items.items[${index}] 装备Action定义不完整`)
    if (kind !== 'equipment' && strings(item.equipConditionKeys, `items.items[${index}].equipConditionKeys`).length) fail(`items.items[${index}] 非装备不能声明装备条件`)
    if (kind === 'material' && stackPolicy !== 'stacked') fail(`items.items[${index}] 材料必须可堆叠`)
    if (critical && (!unique || consumable || kind !== 'quest' || droppable || sellable)) fail(`items.items[${index}] 关键物品保护策略无效`)
    if (consumable !== (kind === 'consumable') || consumable !== (useActionKey != null)) fail(`items.items[${index}] 消耗品/useAction不一致`)
    const modifiers = row(item.statModifiers, `items.items[${index}].statModifiers`); if (Object.keys(modifiers).some(field => !modifierFields.includes(field))) fail(`items.items[${index}].statModifiers字段无效`); Object.entries(modifiers).forEach(([field, value]) => numberValue(value, `items.items[${index}].statModifiers.${field}`, -1_000_000, 1_000_000))
    requireRefs(strings(item.effectKeys, `items.items[${index}].effectKeys`), effectKeys, 'item effect'); strings(item.sourceRefs, `items.items[${index}].sourceRefs`, 'text'); strings(item.presentationRefs, `items.items[${index}].presentationRefs`, 'text')
  })
  dropTables.forEach((item, index) => {
    if (item.algorithm !== 'weighted-item-then-quantity-v1' || item.rolls !== 1) fail(`items.dropTables[${index}] 算法或首版rolls无效`)
    requireRefs(strings(item.conditionKeys, `items.dropTables[${index}].conditionKeys`), conditionKeys, 'drop condition')
    const entryRows = array(item.entries, `items.dropTables[${index}].entries`)
    if (!entryRows.length || entryRows.length > 63) fail(`items.dropTables[${index}].entries数量无效`)
    const entryItemKeys = new Set<string>()
    entryRows.forEach((entry, entryIndex) => {
      const parsed = row(entry, `items.dropTables[${index}].entries[${entryIndex}]`)
      exact(parsed, ['itemKey', 'minimum', 'maximum', 'weight', 'uniquePolicy', 'quantityEffects'], `items.dropTables[${index}].entries[${entryIndex}]`)
      const itemKey = key(parsed.itemKey, 'drop item'); requireRef(itemKey, itemKeys, 'drop item')
      if (entryItemKeys.has(itemKey)) fail(`items.dropTables[${index}]不能重复物品:${itemKey}`); entryItemKeys.add(itemKey)
      const minimum = int(parsed.minimum, 'drop minimum', 1, 1_000_000); const maximum = int(parsed.maximum, 'drop maximum', 1, 1_000_000)
      if (minimum > maximum || maximum - minimum > 99) fail('drop数量范围无效')
      int(parsed.weight, 'drop weight', 1, 1_000_000); if (parsed.uniquePolicy !== 'reject') fail('首版唯一掉落策略只能reject')
      const quantityEffects = catalog(parsed.quantityEffects, `items.dropTables[${index}].entries[${entryIndex}].quantityEffects`, ['quantity', 'effectKey'])
      const quantities = quantityEffects.map((mapping, mappingIndex) => {
        const quantity = int(mapping.quantity, `drop quantityEffects[${mappingIndex}].quantity`, minimum, maximum)
        const effectKey = key(mapping.effectKey, `drop quantityEffects[${mappingIndex}].effectKey`); requireRef(effectKey, effectKeys, 'drop grant effect')
        const effect = effects.find(candidate => candidate.key === effectKey)!
        if (effect.operation !== 'grant-item') fail(`drop quantity effect必须是grant-item:${effectKey}`)
        const payload = row(effect.payload, `drop quantity effect ${effectKey}`)
        if (payload.itemKey !== itemKey || payload.quantity !== quantity) fail(`drop quantity effect与物品/数量不一致:${effectKey}`)
        return quantity
      })
      const expected = Array.from({ length: maximum - minimum + 1 }, (_, offset) => minimum + offset)
      requireSameKeys(quantities.map(String), expected.map(String), `drop ${itemKey} quantity coverage`)
    })
  })
  const rewardAllowed = new Set(['claim-quest-reward', 'grant-experience', 'grant-item', 'learn-skill', 'learn-recipe', 'change-currency', 'change-morality', 'change-faction-affinity', 'reveal-knowledge', 'reveal-location', 'unlock-fast-travel', 'set-world-flag', 'earn-achievement'])
  rewardContracts.forEach((reward, index) => {
    text(reward.title, `items.rewardContracts[${index}].title`, 2_000)
    enumValue(reward.sourceKind, ['quest', 'combat', 'exploration', 'crafting', 'system'], `items.rewardContracts[${index}].sourceKind`)
    if (reward.claimPolicy !== 'once-per-source') fail(`items.rewardContracts[${index}].claimPolicy无效`)
    int(reward.expectedMinutes, `items.rewardContracts[${index}].expectedMinutes`, 0, 100_000)
    enumValue(reward.budgetClass, ['minor', 'standard', 'major'], `items.rewardContracts[${index}].budgetClass`)
    requireRefs(strings(reward.conditionKeys, `items.rewardContracts[${index}].conditionKeys`), conditionKeys, 'reward condition')
    const directEffects = strings(reward.effectKeys, `items.rewardContracts[${index}].effectKeys`); requireRefs(directEffects, effectKeys, 'reward effect')
    directEffects.forEach(effectKey => { if (!rewardAllowed.has(String(effects.find(effect => effect.key === effectKey)!.operation))) fail(`reward包含非奖励Effect:${effectKey}`) })
    requireRefs(strings(reward.dropTableKeys, `items.rewardContracts[${index}].dropTableKeys`), dropTableKeys, 'reward drop table')
    if (!directEffects.length && !array(reward.dropTableKeys, `items.rewardContracts[${index}].dropTableKeys`).length) fail(`reward不能为空:${String(reward.key)}`)
  })
  if (!legacyQuestModule) {
    const questRewardOwners = new Map<string, string>()
    questRows.forEach(quest => {
      const questKey = String(quest.key)
      const rewardEffectKeys = strings(quest.rewardEffectKeys, `quest ${questKey} rewardEffectKeys`)
      const rewardContractKey = nullableKey(quest.rewardContractKey, `quest ${questKey} rewardContractKey`)
      const claimActionKey = nullableKey(quest.claimActionKey, `quest ${questKey} claimActionKey`)
      if (!rewardEffectKeys.length) {
        if (rewardContractKey != null || claimActionKey != null) fail(`无奖励任务不能声明RewardContract或领取Action:${questKey}`)
        return
      }
      if (!rewardContractKey || !claimActionKey) fail(`有奖励任务必须同时声明RewardContract与领取Action:${questKey}`)
      requireRef(rewardContractKey, rewardContractKeys, 'quest reward contract')
      const priorOwner = questRewardOwners.get(rewardContractKey)
      if (priorOwner) fail(`Quest RewardContract不能跨任务共享:${rewardContractKey}:${priorOwner}:${questKey}`)
      questRewardOwners.set(rewardContractKey, questKey)
      const reward = rewardContracts.find(candidate => candidate.key === rewardContractKey)!
      if (reward.sourceKind !== 'quest') fail(`任务RewardContract来源必须为quest:${rewardContractKey}`)
      requireSameKeys(strings(reward.effectKeys, `reward ${rewardContractKey} effectKeys`), rewardEffectKeys, `quest ${questKey} reward effects`)
      const claimEffects = rewardEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
        .filter(effect => effect.operation === 'claim-quest-reward')
      const claimPayload = claimEffects.length === 1 ? row(claimEffects[0].payload, `quest ${questKey} claim reward payload`) : null
      if (!claimPayload || claimPayload.questKey !== questKey || claimPayload.rewardKey !== rewardContractKey) fail(`任务奖励必须包含唯一且自洽的领取标记Effect:${questKey}`)
      const claimAction = actionRows.find(action => action.key === claimActionKey) ?? fail(`任务领取Action不存在:${claimActionKey}`)
      if (claimAction.category !== 'claim-reward' || claimAction.actorScope !== 'player' || claimAction.targetScope !== 'quest'
        || strings(claimAction.requirementConditionKeys, `claim action ${claimActionKey} requirements`).length
        || strings(claimAction.costEffectKeys, `claim action ${claimActionKey} costs`).length
        || strings(claimAction.successEffectKeys, `claim action ${claimActionKey} success`).length
        || strings(claimAction.failureEffectKeys, `claim action ${claimActionKey} failures`).length
        || claimAction.confirmationPolicy !== 'never' || claimAction.repeatPolicy !== 'repeatable'
        || claimAction.cooldownMinutes != null || claimAction.timeCostMinutes !== 0) fail(`任务领取Action合同无效:${claimActionKey}`)
    })
    rewardContracts.filter(reward => reward.sourceKind === 'quest').forEach(reward => {
      if (!questRewardOwners.has(String(reward.key))) fail(`quest来源RewardContract必须绑定一个任务:${String(reward.key)}`)
    })
    actionRows.filter(action => action.category === 'claim-reward').forEach(action => {
      const owners = questRows.filter(quest => quest.claimActionKey === action.key)
      if (owners.length !== 1) fail(`领取Action必须且只能属于一个任务:${String(action.key)}`)
    })
    effects.filter(effect => effect.operation === 'claim-quest-reward').forEach(effect => {
      const owners = rewardContracts.filter(reward => reward.sourceKind === 'quest'
        && strings(reward.effectKeys, `reward ${String(reward.key)} effects`).includes(String(effect.key)))
      if (owners.length !== 1) fail(`任务奖励领取标记Effect必须且只能属于一个RewardContract:${String(effect.key)}`)
    })
  }
  requireRefs(strings(build.startingItemKeys, 'actors.player.build.startingItemKeys'), itemKeys, 'player starting item')
  itemRows.filter(item => item.useActionKey != null).forEach(item => {
    const action = actionRows.find(candidate => candidate.key === item.useActionKey) ?? fail(`物品useAction不存在:${String(item.key)}`)
    const removeEffects = strings(action.costEffectKeys, `item ${String(item.key)} use cost effects`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'remove-item' && row(effect.payload, `item ${String(item.key)} remove payload`).reason === 'consume')
    if (action.category !== 'use' || action.targetScope !== 'item' || removeEffects.length !== 1
      || row(removeEffects[0].payload, `item ${String(item.key)} consume payload`).itemKey !== item.key) fail(`物品${String(item.key)}的useAction没有消费自身`)
    requireSameKeys(strings(action.successEffectKeys, `item ${String(item.key)} use success effects`), strings(item.effectKeys, `item ${String(item.key)} effects`), `item ${String(item.key)} use effects`)
  })
  itemRows.filter(item => item.kind === 'equipment').forEach(item => {
    for (const [mode, actionKeyField] of [['equip', 'equipActionKey'], ['unequip', 'unequipActionKey']] as const) {
      const actionKey = key(item[actionKeyField], `item ${String(item.key)} ${mode}ActionKey`)
      const action = actionRows.find(candidate => candidate.key === actionKey) ?? fail(`装备Action不存在:${actionKey}`)
      const successEffects = strings(action.successEffectKeys, `item ${String(item.key)} ${mode} success effects`)
        .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const equipmentEffects = successEffects.filter(effect => effect.operation === `${mode}-item`)
      if (action.category !== mode || action.targetScope !== 'item' || strings(action.costEffectKeys, `item ${String(item.key)} ${mode} costs`).length
        || strings(action.failureEffectKeys, `item ${String(item.key)} ${mode} failures`).length || successEffects.length !== 1
        || equipmentEffects.length !== 1 || row(equipmentEffects[0].payload, `item ${String(item.key)} ${mode} payload`).itemKey !== item.key
        || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable') fail(`物品${String(item.key)}的${mode}Action不符合装备事务`)
      if (mode === 'equip') {
        const requirements = new Set(strings(action.requirementConditionKeys, `item ${String(item.key)} equip requirements`))
        strings(item.equipConditionKeys, `item ${String(item.key)} equip conditions`).forEach(conditionKey => {
          if (!requirements.has(conditionKey)) fail(`物品${String(item.key)}的装备Action缺少条件:${conditionKey}`)
        })
      }
    }
  })
  actionRows.filter(action => ['drop', 'sell'].includes(String(action.category))).forEach(action => {
    const reason = action.category === 'drop' ? 'drop' : 'sell'
    const removal = strings(action.costEffectKeys, `item action ${String(action.key)} cost effects`).map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'remove-item' && row(effect.payload, `item action ${String(action.key)} payload`).reason === reason)
    if (action.targetScope !== 'item' || removal.length !== 1) fail(`物品Action没有唯一${reason}移除Effect:${String(action.key)}`)
    const itemKey = key(row(removal[0].payload, `item action ${String(action.key)} removal`).itemKey, `item action ${String(action.key)} itemKey`)
    const definition = itemRows.find(item => item.key === itemKey) ?? fail(`物品Action引用不存在:${itemKey}`)
    if ((reason === 'drop' && definition.droppable !== true) || (reason === 'sell' && definition.sellable !== true)) fail(`物品Action违反${reason}保护:${itemKey}`)
  })

  const combat = versioned(packageValue, 'combat')
  exact(combat, ['version', 'rules', 'enemies', 'encounters'], 'combat')
  const combatRules = row(combat.rules, 'combat.rules'); exact(combatRules, ['difficulty', 'defaultAttackHits', 'playerPartyLimit', 'allowFriendlyNpcCombatants', 'allowElements', 'allowEscape'], 'combat.rules'); if (combatRules.difficulty !== 'standard' || combatRules.defaultAttackHits !== true || combatRules.playerPartyLimit !== 1 || combatRules.allowFriendlyNpcCombatants !== false || combatRules.allowElements !== false || combatRules.allowEscape !== true) fail('combat.rules不符合首版冻结边界')
  const enemies = catalog(combat.enemies, 'combat.enemies', ['key', 'familyKey', 'title', 'level', 'maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'skillKeys', 'dropTableKey']); const encounters = catalog(combat.encounters, 'combat.encounters', ['key', 'title', 'locationKey', 'enemyKeys', 'recommendedLevel', 'intensity', 'escapeAllowed', 'victoryEffectKeys']); const enemyKeys = keysOf(enemies, 'combat.enemies'); keysOf(encounters, 'combat.encounters')
  enemies.forEach((item, index) => { key(item.familyKey, `combat.enemies[${index}].familyKey`); text(item.title, `combat.enemies[${index}].title`, 2_000); int(item.level, `combat.enemies[${index}].level`, 1, maximumLevel); int(item.maximumHealth, `combat.enemies[${index}].maximumHealth`, 1, 1_000_000_000); int(item.attack, `combat.enemies[${index}].attack`, 0, 1_000_000_000); int(item.defense, `combat.enemies[${index}].defense`, 0, 1_000_000_000); numberValue(item.criticalChance, `combat.enemies[${index}].criticalChance`, 0, 1); numberValue(item.initiative, `combat.enemies[${index}].initiative`, 0, 1_000_000); requireRefs(strings(item.skillKeys, `combat.enemies[${index}].skillKeys`), skillKeys, 'enemy skill'); requireRef(nullableKey(item.dropTableKey, `combat.enemies[${index}].dropTableKey`), dropTableKeys, 'enemy drop table') })
  encounters.forEach((item, index) => { text(item.title, `combat.encounters[${index}].title`, 2_000); requireRef(key(item.locationKey, `combat.encounters[${index}].locationKey`), locationKeys, 'encounter location'); requireRefs(strings(item.enemyKeys, `combat.encounters[${index}].enemyKeys`), enemyKeys, 'encounter enemy'); int(item.recommendedLevel, `combat.encounters[${index}].recommendedLevel`, 1, maximumLevel); enumValue(item.intensity, ['ordinary', 'dangerous', 'boss'], `combat.encounters[${index}].intensity`); bool(item.escapeAllowed, `combat.encounters[${index}].escapeAllowed`); requireRefs(strings(item.victoryEffectKeys, `combat.encounters[${index}].victoryEffectKeys`), effectKeys, 'encounter victory effect') })
  actionRows.filter(action => action.category === 'start-combat').forEach(action => {
    const startEffects = strings(action.successEffectKeys, `start-combat ${String(action.key)} success effects`)
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'start-combat')
    if (action.targetScope !== 'encounter' || startEffects.length !== 1) fail(`start-combat Action必须绑定唯一遭遇目标:${String(action.key)}`)
    const encounterKey = key(row(startEffects[0].payload, `start-combat ${String(action.key)} payload`).encounterKey, `start-combat ${String(action.key)} encounterKey`)
    const encounter = encounters.find(item => item.key === encounterKey) ?? fail(`start-combat Action遭遇不存在:${encounterKey}`)
    requireSameKeys(strings(action.locationKeys, `start-combat ${String(action.key)} locationKeys`), [String(encounter.locationKey)], `start-combat ${String(action.key)} location`)
  })

  const crafting = versioned(packageValue, 'crafting')
  exact(crafting, ['version', 'recipes'], 'crafting'); const recipes = catalog(crafting.recipes, 'crafting.recipes', ['key', 'title', 'description', 'learnedByDefault', 'stationLocationKeys', 'ingredients', 'outputs', 'timeCostMinutes']); keysOf(recipes, 'crafting.recipes')
  recipes.forEach((item, index) => { text(item.title, `crafting.recipes[${index}].title`, 2_000); text(item.description, `crafting.recipes[${index}].description`); bool(item.learnedByDefault, `crafting.recipes[${index}].learnedByDefault`); requireRefs(strings(item.stationLocationKeys, `crafting.recipes[${index}].stationLocationKeys`), locationKeys, 'recipe station'); for (const field of ['ingredients', 'outputs']) array(item[field], `crafting.recipes[${index}].${field}`).forEach((entry, entryIndex) => { const parsed = row(entry, `crafting.recipes[${index}].${field}[${entryIndex}]`); exact(parsed, ['itemKey', 'quantity'], `crafting.recipes[${index}].${field}[${entryIndex}]`); requireRef(key(parsed.itemKey, 'recipe item'), itemKeys, 'recipe item'); int(parsed.quantity, 'recipe quantity', 1, 1_000_000) }); int(item.timeCostMinutes, `crafting.recipes[${index}].timeCostMinutes`, 0, 1_000_000) })

  const economy = versioned(packageValue, 'economy')
  exact(economy, ['version', 'currency', 'vendors'], 'economy'); const currency = row(economy.currency, 'economy.currency'); exact(currency, ['key', 'label'], 'economy.currency'); if (currency.key !== 'currency') fail('首版只允许currency单货币'); text(currency.label, 'economy.currency.label', 100)
  const vendors = catalog(economy.vendors, 'economy.vendors', ['key', 'title', 'actorKey', 'locationKey', 'factionKey', 'buyPriceMultiplier', 'sellPriceMultiplier', 'stock']); const vendorKeys = keysOf(vendors, 'economy.vendors')
  vendors.forEach((item, index) => { text(item.title, `economy.vendors[${index}].title`, 2_000); requireRef(key(item.actorKey, `economy.vendors[${index}].actorKey`), actorKeys, 'vendor actor'); requireRef(key(item.locationKey, `economy.vendors[${index}].locationKey`), locationKeys, 'vendor location'); requireRef(nullableKey(item.factionKey, `economy.vendors[${index}].factionKey`), factionKeys, 'vendor faction'); numberValue(item.buyPriceMultiplier, `economy.vendors[${index}].buyPriceMultiplier`, 0.01, 100); numberValue(item.sellPriceMultiplier, `economy.vendors[${index}].sellPriceMultiplier`, 0.01, 100); array(item.stock, `economy.vendors[${index}].stock`).forEach((entry, entryIndex) => { const parsed = row(entry, `economy.vendors[${index}].stock[${entryIndex}]`); exact(parsed, ['itemKey', 'quantity'], `economy.vendors[${index}].stock[${entryIndex}]`); requireRef(key(parsed.itemKey, 'vendor stock item'), itemKeys, 'vendor stock item'); if (parsed.quantity != null) int(parsed.quantity, 'vendor stock quantity', 0, 1_000_000) }) })
  actorRows.forEach((item, index) => requireRefs(strings(item.serviceKeys, `actors.actors[${index}].serviceKeys`), vendorKeys, 'actor service'))

  const relationships = versioned(packageValue, 'relationships')
  exact(relationships, ['version', 'morality', 'factionAffinity', 'attitude', 'storyModifiers'], 'relationships')
  for (const field of ['morality', 'factionAffinity']) { const meter = row(relationships[field], `relationships.${field}`); exact(meter, ['minimum', 'maximum', 'initial'], `relationships.${field}`); const minimum = numberValue(meter.minimum, `${field}.minimum`, -10_000, 10_000); const maximum = numberValue(meter.maximum, `${field}.maximum`, -10_000, 10_000); const initial = numberValue(meter.initial, `${field}.initial`, -10_000, 10_000); if (minimum >= maximum || initial < minimum || initial > maximum) fail(`${field}范围无效`) }
  const attitude = row(relationships.attitude, 'relationships.attitude'); exact(attitude, ['badMaximum', 'goodMinimum', 'moralityWeight', 'factionWeight', 'explicitStoryModifierCap'], 'relationships.attitude'); const bad = numberValue(attitude.badMaximum, 'attitude.badMaximum', -10_000, 10_000); const good = numberValue(attitude.goodMinimum, 'attitude.goodMinimum', -10_000, 10_000); const mw = numberValue(attitude.moralityWeight, 'attitude.moralityWeight', 0, 1); const fw = numberValue(attitude.factionWeight, 'attitude.factionWeight', 0, 1); if (bad >= good || Math.abs(mw + fw - 1) > 0.000001) fail('attitude阈值或权重无效'); numberValue(attitude.explicitStoryModifierCap, 'attitude.explicitStoryModifierCap', 0, 10_000)
  const storyModifiers = catalog(relationships.storyModifiers, 'relationships.storyModifiers', ['key', 'actorKey', 'value', 'sourceQuestKey']); keysOf(storyModifiers, 'relationships.storyModifiers'); storyModifiers.forEach((item, index) => { requireRef(key(item.actorKey, `relationships.storyModifiers[${index}].actorKey`), actorKeys, 'story modifier actor'); numberValue(item.value, `relationships.storyModifiers[${index}].value`, -10_000, 10_000); requireRef(key(item.sourceQuestKey, `relationships.storyModifiers[${index}].sourceQuestKey`), questKeys, 'story modifier quest') })
  if (canonicalProductProductionJsonV2({ morality: relationships.morality, factionAffinity: relationships.factionAffinity, attitude: relationships.attitude })
    !== canonicalProductProductionJsonV2({ morality: packageValue.calibration.relationships.morality, factionAffinity: packageValue.calibration.relationships.factionAffinity, attitude: packageValue.calibration.relationships.attitude })) {
    fail('relationships模块与根calibration不一致')
  }

  const timeWeather = versioned(packageValue, 'time-weather', [1, 2])
  const modernTimeWeather = Number(timeWeather.version) >= 2
  exact(timeWeather, modernTimeWeather
    ? ['version', 'initialWorldMinute', 'minutesPerDay', 'weatherUpdateIntervalMinutes', 'timePeriods', 'weather', 'regionWeatherTables']
    : ['version', 'initialWorldMinute', 'minutesPerDay', 'timePeriods', 'weather', 'regionWeatherTables'], 'time-weather')
  const minutesPerDay = int(timeWeather.minutesPerDay, 'time-weather.minutesPerDay', 60, 100_000)
  int(timeWeather.initialWorldMinute, 'time-weather.initialWorldMinute', 0, 1_000_000_000)
  const weatherUpdateIntervalMinutes = modernTimeWeather
    ? int(timeWeather.weatherUpdateIntervalMinutes, 'time-weather.weatherUpdateIntervalMinutes', 1, 1_000_000)
    : minutesPerDay
  if (timeWeatherActionModule && !modernTimeWeather) fail('Action v5必须搭配TimeWeather v2')
  const periods = catalog(timeWeather.timePeriods, 'time-weather.timePeriods', ['key', 'label', 'startMinute', 'endMinute']); const weather = catalog(timeWeather.weather, 'time-weather.weather', ['key', 'label', 'description']); const weatherTables = catalog(timeWeather.regionWeatherTables, 'time-weather.regionWeatherTables', ['regionKey', 'entries']); const periodKeys = keysOf(periods, 'time-weather.timePeriods'); const weatherKeys = keysOf(weather, 'time-weather.weather')
  periods.forEach((item, index) => { text(item.label, `time-weather.timePeriods[${index}].label`, 100); const start = int(item.startMinute, `time-weather.timePeriods[${index}].startMinute`, 0, minutesPerDay - 1); const end = int(item.endMinute, `time-weather.timePeriods[${index}].endMinute`, 1, minutesPerDay); if (start >= end) fail('time period start必须小于end') })
  const orderedPeriods = [...periods].sort((left, right) => Number(left.startMinute) - Number(right.startMinute))
  if (!orderedPeriods.length || orderedPeriods[0].startMinute !== 0 || orderedPeriods[orderedPeriods.length - 1].endMinute !== minutesPerDay
    || orderedPeriods.some((item, index) => index > 0 && item.startMinute !== orderedPeriods[index - 1].endMinute)) {
    fail('timePeriods必须无重叠无空洞覆盖完整一天')
  }
  weather.forEach((item, index) => { text(item.label, `time-weather.weather[${index}].label`, 100); text(item.description, `time-weather.weather[${index}].description`) })
  if (modernTimeWeather && weather.length < 2) fail('TimeWeather v2至少需要两种天气')
  if (modernTimeWeather && weatherTables.length > 128) fail('TimeWeather v2最多支持128个地区的原子天气结算')
  const weatherRegionKeys = weatherTables.map((item, index) => key(item.regionKey, `time-weather.regionWeatherTables[${index}].regionKey`)); if (new Set(weatherRegionKeys).size !== weatherRegionKeys.length) fail('regionWeatherTables.regionKey重复'); requireRefs(weatherRegionKeys, regionKeys, 'weather region'); weatherTables.forEach((item, index) => { const entries = array(item.entries, `time-weather.regionWeatherTables[${index}].entries`, modernTimeWeather ? 128 : 20_000); if (!entries.length) fail('weather table不能为空'); const entryWeatherKeys: string[] = []; let totalWeight = 0; entries.forEach((entry, entryIndex) => { const parsed = row(entry, `weather entries[${entryIndex}]`); exact(parsed, ['weatherKey', 'weight'], 'weather entry'); const weatherKey = key(parsed.weatherKey, 'weatherKey'); requireRef(weatherKey, weatherKeys, 'weather'); entryWeatherKeys.push(weatherKey); const weight = modernTimeWeather ? int(parsed.weight, 'weather weight', 1, 1_000_000) : numberValue(parsed.weight, 'weather weight', 0.000001, 1_000_000); totalWeight += weight }); if (new Set(entryWeatherKeys).size !== entryWeatherKeys.length) fail(`weather table天气重复:${String(item.regionKey)}`); if (modernTimeWeather && (!Number.isSafeInteger(totalWeight) || totalWeight > 1_000_000_000)) fail(`weather table总权重越界:${String(item.regionKey)}`) })
  requireSameKeys(weatherRegionKeys, [...regionKeys], 'region weather tables')
  schedules.forEach((item, index) => array(item.entries, `actors.schedules[${index}].entries`).forEach((entry, entryIndex) => requireRef(key(row(entry, 'schedule entry').timePeriodKey, `actors.schedules[${index}].entries[${entryIndex}].timePeriodKey`), periodKeys, 'schedule time period')))

  const director = versioned(packageValue, 'director')
  exact(director, ['version', 'rules', 'decks', 'templates', 'randomEvents'], 'director'); const directorRules = row(director.rules, 'director.rules'); exact(directorRules, ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit'], 'director.rules'); ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit'].forEach(field => int(directorRules[field], `director.rules.${field}`, 1, 1_000_000))
  const decks = catalog(director.decks, 'director.decks', ['regionKey', 'questKeys', 'templateKeys', 'randomEventKeys', 'maximumRevealed', 'maximumActive', 'cooldownMinutes', 'blankWeight']); const templates = catalog(director.templates, 'director.templates', ['key', 'questKey', 'regionKeys', 'variantTextKeys', 'fingerprint', 'cooldownMinutes']); const randomEvents = catalog(director.randomEvents, 'director.randomEvents', ['key', 'title', 'regionKeys', 'actionKeys', 'effectKeys', 'intensity', 'cooldownMinutes']); const templateKeys = keysOf(templates, 'director.templates'); const randomEventKeys = keysOf(randomEvents, 'director.randomEvents')
  const deckRegions = decks.map((item, index) => key(item.regionKey, `director.decks[${index}].regionKey`)); if (new Set(deckRegions).size !== deckRegions.length) fail('director.decks.regionKey重复'); requireRefs(deckRegions, regionKeys, 'deck region')
  requireSameKeys(deckRegions, [...regionKeys], 'region director decks')
  templates.forEach((item, index) => { const questKey = key(item.questKey, `director.templates[${index}].questKey`); requireRef(questKey, questKeys, 'template quest'); if (questRows.find(quest => quest.key === questKey)?.type !== 'template') fail(`director template必须引用template任务:${questKey}`); requireRefs(strings(item.regionKeys, `director.templates[${index}].regionKeys`), regionKeys, 'template region'); strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`); key(item.fingerprint, `director.templates[${index}].fingerprint`); int(item.cooldownMinutes, `director.templates[${index}].cooldownMinutes`, 0, 1_000_000) })
  questRows.filter(item => item.type === 'template').forEach(item => {
    if (templates.filter(template => template.questKey === item.key).length !== 1) fail(`模板任务必须且只能绑定一个Director模板:${String(item.key)}`)
  })
  randomEvents.forEach((item, index) => { text(item.title, `director.randomEvents[${index}].title`, 2_000); requireRefs(strings(item.regionKeys, `director.randomEvents[${index}].regionKeys`), regionKeys, 'random event region'); requireRefs(strings(item.actionKeys, `director.randomEvents[${index}].actionKeys`), actionKeys, 'random event action'); requireRefs(strings(item.effectKeys, `director.randomEvents[${index}].effectKeys`), effectKeys, 'random event effect'); int(item.intensity, `director.randomEvents[${index}].intensity`, 1, 10); int(item.cooldownMinutes, `director.randomEvents[${index}].cooldownMinutes`, 0, 1_000_000) })
  decks.forEach((item, index) => { requireRefs(strings(item.questKeys, `director.decks[${index}].questKeys`), questKeys, 'deck quest'); requireRefs(strings(item.templateKeys, `director.decks[${index}].templateKeys`), templateKeys, 'deck template'); requireRefs(strings(item.randomEventKeys, `director.decks[${index}].randomEventKeys`), randomEventKeys, 'deck event'); const maxRevealed = int(item.maximumRevealed, `director.decks[${index}].maximumRevealed`, 1, 1_000); const maxActive = int(item.maximumActive, `director.decks[${index}].maximumActive`, 1, 1_000); if (maxActive > maxRevealed) fail('deck maximumActive不能大于maximumRevealed'); int(item.cooldownMinutes, `director.decks[${index}].cooldownMinutes`, 0, 1_000_000); numberValue(item.blankWeight, `director.decks[${index}].blankWeight`, 0, 1_000_000) })

  const knowledge = versioned(packageValue, 'knowledge')
  exact(knowledge, ['version', 'entries', 'rumors', 'achievements'], 'knowledge'); const entries = catalog(knowledge.entries, 'knowledge.entries', ['key', 'kind', 'title', 'content', 'sourceRefs', 'initialPlayerVisibility', 'actorKeys']); const rumors = catalog(knowledge.rumors, 'knowledge.rumors', ['key', 'knowledgeKey', 'text', 'reliability']); const achievements = catalog(knowledge.achievements, 'knowledge.achievements', ['key', 'title', 'description', 'conditionKeys']); const knowledgeKeys = keysOf(entries, 'knowledge.entries'); keysOf(rumors, 'knowledge.rumors'); keysOf(achievements, 'knowledge.achievements')
  entries.forEach((item, index) => { enumValue(item.kind, ['location', 'actor', 'faction', 'enemy', 'lore', 'quest-clue'], `knowledge.entries[${index}].kind`); text(item.title, `knowledge.entries[${index}].title`, 2_000); text(item.content, `knowledge.entries[${index}].content`); strings(item.sourceRefs, `knowledge.entries[${index}].sourceRefs`, 'text'); enumValue(item.initialPlayerVisibility, ['hidden', 'rumor', 'known'], `knowledge.entries[${index}].initialPlayerVisibility`); requireRefs(strings(item.actorKeys, `knowledge.entries[${index}].actorKeys`), actorKeys, 'knowledge actor') })
  rumors.forEach((item, index) => { requireRef(key(item.knowledgeKey, `knowledge.rumors[${index}].knowledgeKey`), knowledgeKeys, 'rumor knowledge'); text(item.text, `knowledge.rumors[${index}].text`); enumValue(item.reliability, ['uncertain', 'likely', 'confirmed'], `knowledge.rumors[${index}].reliability`) })
  achievements.forEach((item, index) => { text(item.title, `knowledge.achievements[${index}].title`, 2_000); text(item.description, `knowledge.achievements[${index}].description`); requireRefs(strings(item.conditionKeys, `knowledge.achievements[${index}].conditionKeys`), conditionKeys, 'achievement condition') })

  const presentation = versioned(packageValue, 'presentation', [1, 2])
  const legacyPresentationModule = presentation.version === 1
  exact(presentation, legacyPresentationModule
    ? ['version', 'textStyle', 'mediaSlots', 'taskTextVariants', 'tutorials']
    : ['version', 'textStyle', 'mapLayout', 'mediaSlots', 'taskTextVariants', 'tutorials'], 'presentation')
  const textStyle = row(presentation.textStyle, 'presentation.textStyle'); exact(textStyle, ['narrationTone', 'dialogueStyle', 'systemReceiptStyle'], 'presentation.textStyle'); ['narrationTone', 'dialogueStyle', 'systemReceiptStyle'].forEach(field => text(textStyle[field], `presentation.textStyle.${field}`))
  const sortedLayoutLocations = [...normalizedWorld.locations].sort((left, right) => left.key.localeCompare(right.key))
  const layoutColumns = Math.max(1, Math.ceil(Math.sqrt(sortedLayoutLocations.length)))
  const layoutRows = Math.max(1, Math.ceil(sortedLayoutLocations.length / layoutColumns))
  const fallbackLocationNodes = sortedLayoutLocations.map((location, index) => ({
    locationKey: location.key,
    x: Math.round(((index % layoutColumns) + 1) * 1000 / (layoutColumns + 1)),
    y: Math.round((Math.floor(index / layoutColumns) + 1) * 700 / (layoutRows + 1)),
  }))
  const fallbackMapLayout: TextOpenWorldParsedModulesV1['presentation']['mapLayout'] = {
    version: 1, coordinateSystem: 'normalized-1000', width: 1000, height: 700,
    source: 'deterministic-fallback', locationNodes: fallbackLocationNodes,
  }
  let mapLayout = fallbackMapLayout
  if (!legacyPresentationModule) {
    const layout = row(presentation.mapLayout, 'presentation.mapLayout')
    exact(layout, ['version', 'coordinateSystem', 'width', 'height', 'source', 'locationNodes'], 'presentation.mapLayout')
    if (layout.version !== 1 || layout.coordinateSystem !== 'normalized-1000'
      || layout.width !== 1000 || layout.height !== 700) fail('presentation.mapLayout坐标合同无效')
    const source = enumValue(layout.source, ['authored', 'deterministic-fallback'], 'presentation.mapLayout.source')
    const nodes = catalog(layout.locationNodes, 'presentation.mapLayout.locationNodes', ['locationKey', 'x', 'y']).map((item, index) => ({
      locationKey: key(item.locationKey, `presentation.mapLayout.locationNodes[${index}].locationKey`),
      x: int(item.x, `presentation.mapLayout.locationNodes[${index}].x`, 0, 1000),
      y: int(item.y, `presentation.mapLayout.locationNodes[${index}].y`, 0, 700),
    }))
    requireSameKeys(nodes.map(node => node.locationKey), [...locationKeys], 'map layout location nodes')
    if (new Set(nodes.map(node => `${node.x}:${node.y}`)).size !== nodes.length) fail('map layout地点坐标不能重叠')
    if (source === 'deterministic-fallback'
      && canonicalProductProductionJsonV2(nodes) !== canonicalProductProductionJsonV2(fallbackLocationNodes)) {
      fail('deterministic-fallback地图布局与规范算法不一致')
    }
    mapLayout = { version: 1, coordinateSystem: 'normalized-1000', width: 1000, height: 700, source, locationNodes: nodes }
  }
  const mediaSlots = catalog(presentation.mediaSlots, 'presentation.mediaSlots', ['key', 'kind', 'consumerRef', 'required', 'assetKey', 'fallbackText', 'altText']); const variants = catalog(presentation.taskTextVariants, 'presentation.taskTextVariants', ['key', 'templateKey', 'title', 'description']); const tutorials = catalog(presentation.tutorials, 'presentation.tutorials', ['key', 'triggerActionKey', 'targetUiKey', 'title', 'body']); const mediaSlotKeys = keysOf(mediaSlots, 'presentation.mediaSlots'); const variantKeys = keysOf(variants, 'presentation.taskTextVariants'); keysOf(tutorials, 'presentation.tutorials')
  if ([...mediaSlotKeys].sort().join(',') !== [...packageValue.mediaManifest.slotKeys].sort().join(',')) fail('presentation.mediaSlots与根mediaManifest.slotKeys不一致')
  mediaSlots.forEach((item, index) => { enumValue(item.kind, ['map', 'portrait', 'background', 'item-icon', 'enemy-icon', 'audio'], `presentation.mediaSlots[${index}].kind`); text(item.consumerRef, `presentation.mediaSlots[${index}].consumerRef`, 1_000); const required = bool(item.required, `presentation.mediaSlots[${index}].required`); nullableKey(item.assetKey, `presentation.mediaSlots[${index}].assetKey`); text(item.fallbackText, `presentation.mediaSlots[${index}].fallbackText`, 5_000); text(item.altText, `presentation.mediaSlots[${index}].altText`, 2_000); if (required !== packageValue.mediaManifest.requiredSlotKeys.includes(String(item.key))) fail(`presentation.mediaSlots[${index}].required与根manifest不一致`) })
  normalizedWorld.regions.forEach((item, index) => requireRefs(item.presentationRefs, mediaSlotKeys, `world.regions[${index}].presentationRefs`))
  normalizedWorld.locations.forEach((item, index) => requireRefs(item.presentationRefs, mediaSlotKeys, `world.locations[${index}].presentationRefs`))
  variants.forEach((item, index) => { requireRef(key(item.templateKey, `presentation.taskTextVariants[${index}].templateKey`), templateKeys, 'task text template'); text(item.title, `presentation.taskTextVariants[${index}].title`, 2_000); text(item.description, `presentation.taskTextVariants[${index}].description`) })
  templates.forEach((item, index) => requireRefs(strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`), variantKeys, 'template text variant'))
  templates.forEach((item, index) => {
    const templateKey = key(item.key, `director.templates[${index}].key`)
    const expectedCount = packageValue.calibration.randomTaskExpression.buildVariantsPerTemplate
    requireSameKeys(
      strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`),
      variants.filter(variant => variant.templateKey === templateKey).map(variant => String(variant.key)),
      `template ${templateKey} text variants`,
    )
    if (strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`).length !== expectedCount) {
      fail(`template ${templateKey} 必须提供${expectedCount}个构建期变体`)
    }
  })
  tutorials.forEach((item, index) => { requireRef(key(item.triggerActionKey, `presentation.tutorials[${index}].triggerActionKey`), actionKeys, 'tutorial action'); key(item.targetUiKey, `presentation.tutorials[${index}].targetUiKey`); text(item.title, `presentation.tutorials[${index}].title`, 2_000); text(item.body, `presentation.tutorials[${index}].body`) })

  // Cross-owner references that can only be checked after every catalog exists.
  storylines.forEach((item, index) => {
    const ownerKey = nullableKey(item.ownerKey, `narrative.storylines[${index}].ownerKey`)
    if (item.ownerKind === 'character') requireRef(ownerKey, actorKeys, 'character storyline owner')
    else if (item.ownerKind === 'faction') requireRef(ownerKey, factionKeys, 'faction storyline owner')
    else if (item.ownerKind === 'region') requireRef(ownerKey, regionKeys, 'region storyline owner')
  })
  questRows.forEach((item, index) => {
    const ownerKey = nullableKey(item.ownerKey, `quests.quests[${index}].ownerKey`)
    if (ownerKey && !actorKeys.has(ownerKey) && !factionKeys.has(ownerKey) && !regionKeys.has(ownerKey) && !locationKeys.has(ownerKey)) fail(`quest owner不存在:${ownerKey}`)
  })
  actionRows.forEach((item, index) => {
    if (item.targetScope === 'vendor' && vendors.length === 0) fail(`actions.actions[${index}] 需要vendor但目录为空`)
  })
  if (!travelPointKeys.size) fail('首版至少需要一个快速旅行点')

  return {
    narrative: structuredClone(narrative) as unknown as TextOpenWorldParsedModulesV1['narrative'],
    world: normalizedWorld,
    actors: structuredClone(actors) as unknown as TextOpenWorldParsedModulesV1['actors'],
    quests: { ...structuredClone(quests), version: 2, quests: structuredClone(questRows), stages: structuredClone(questStages) } as unknown as TextOpenWorldParsedModulesV1['quests'],
    actions: structuredClone(actions) as unknown as TextOpenWorldParsedModulesV1['actions'],
    progression: structuredClone(progression) as unknown as TextOpenWorldParsedModulesV1['progression'],
    combat: structuredClone(combat) as unknown as TextOpenWorldParsedModulesV1['combat'],
    items: structuredClone(items) as unknown as TextOpenWorldParsedModulesV1['items'],
    crafting: structuredClone(crafting) as unknown as TextOpenWorldParsedModulesV1['crafting'],
    economy: structuredClone(economy) as unknown as TextOpenWorldParsedModulesV1['economy'],
    relationships: structuredClone(relationships) as unknown as TextOpenWorldParsedModulesV1['relationships'],
    'time-weather': { ...structuredClone(timeWeather), weatherUpdateIntervalMinutes } as unknown as TextOpenWorldParsedModulesV1['time-weather'],
    director: structuredClone(director) as unknown as TextOpenWorldParsedModulesV1['director'],
    knowledge: structuredClone(knowledge) as unknown as TextOpenWorldParsedModulesV1['knowledge'],
    presentation: {
      ...structuredClone(presentation), version: 2, mapLayout,
    } as unknown as TextOpenWorldParsedModulesV1['presentation'],
  }
}
