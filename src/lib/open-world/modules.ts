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
  'buy', 'sell', 'craft', 'accept-quest', 'abandon-quest', 'quest-action', 'start-combat', 'continue-combat', 'escape',
  'rest', 'read', 'track', 'untrack', 'save', 'load-branch',
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
function versioned(packageValue: TextOpenWorldRuntimePackageV1, moduleKey: TextOpenWorldRuntimeModuleKeyV1): Row {
  const payload = row(packageValue.modules[moduleKey].payload, `${moduleKey}.payload`)
  if (payload.version !== 1) fail(`${moduleKey}.payload.version 无效`)
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

  const world = versioned(packageValue, 'world')
  exact(world, ['version', 'initialLocationKey', 'regions', 'locations', 'edges', 'fastTravelPoints'], 'world')
  const regions = catalog(world.regions, 'world.regions', ['key', 'title', 'description', 'locationKeys', 'initialKnowledge'])
  const locations = catalog(world.locations, 'world.locations', ['key', 'regionKey', 'title', 'description', 'kind', 'tags'])
  const edges = catalog(world.edges, 'world.edges', ['key', 'fromLocationKey', 'toLocationKey', 'bidirectional', 'travelMinutes', 'conditionKeys'])
  const travelPoints = catalog(world.fastTravelPoints, 'world.fastTravelPoints', ['key', 'locationKey', 'unlockedByDefault'])
  const regionKeys = keysOf(regions, 'world.regions'); const locationKeys = keysOf(locations, 'world.locations'); keysOf(edges, 'world.edges'); const travelPointKeys = keysOf(travelPoints, 'world.fastTravelPoints')
  requireRef(key(world.initialLocationKey, 'world.initialLocationKey'), locationKeys, 'initial location')
  regions.forEach((item, index) => { text(item.title, `world.regions[${index}].title`, 2_000); text(item.description, `world.regions[${index}].description`); requireRefs(strings(item.locationKeys, `world.regions[${index}].locationKeys`), locationKeys, 'region location'); enumValue(item.initialKnowledge, ['unknown', 'heard', 'visited', 'familiar'], `world.regions[${index}].initialKnowledge`) })
  locations.forEach((item, index) => { requireRef(key(item.regionKey, `world.locations[${index}].regionKey`), regionKeys, 'location region'); text(item.title, `world.locations[${index}].title`, 2_000); text(item.description, `world.locations[${index}].description`); enumValue(item.kind, ['settlement', 'interior', 'wilderness', 'dungeon', 'landmark'], `world.locations[${index}].kind`); strings(item.tags, `world.locations[${index}].tags`, 'text') })
  for (const region of regions) for (const locationKey of strings(region.locationKeys, 'region.locationKeys')) if (locations.find(item => item.key === locationKey)?.regionKey !== region.key) fail(`region/location反向引用不一致:${region.key}:${locationKey}`)
  regions.forEach((item, index) => requireSameKeys(
    strings(item.locationKeys, `world.regions[${index}].locationKeys`),
    locations.filter(location => location.regionKey === item.key).map(location => String(location.key)),
    `region ${String(item.key)} locations`,
  ))
  edges.forEach((item, index) => { const from = key(item.fromLocationKey, `world.edges[${index}].fromLocationKey`); const to = key(item.toLocationKey, `world.edges[${index}].toLocationKey`); requireRef(from, locationKeys, 'edge from'); requireRef(to, locationKeys, 'edge to'); if (from === to) fail('edge不能自连'); bool(item.bidirectional, `world.edges[${index}].bidirectional`); int(item.travelMinutes, `world.edges[${index}].travelMinutes`, 1, 1_000_000); strings(item.conditionKeys, `world.edges[${index}].conditionKeys`) })
  travelPoints.forEach((item, index) => { requireRef(key(item.locationKey, `world.fastTravelPoints[${index}].locationKey`), locationKeys, 'fast travel location'); bool(item.unlockedByDefault, `world.fastTravelPoints[${index}].unlockedByDefault`) })

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

  const actions = versioned(packageValue, 'actions')
  exact(actions, ['version', 'conditions', 'effects', 'actions'], 'actions')
  const conditions = catalog(actions.conditions, 'actions.conditions', ['key', 'expression', 'failureMessage']); const effects = catalog(actions.effects, 'actions.effects', ['key', 'operation', 'payload']); const actionRows = catalog(actions.actions, 'actions.actions', ['key', 'category', 'label', 'description', 'actorScope', 'targetScope', 'locationKeys', 'requirementConditionKeys', 'costEffectKeys', 'successEffectKeys', 'failureEffectKeys', 'timeCostMinutes', 'confirmationPolicy', 'repeatPolicy', 'cooldownMinutes'])
  const conditionKeys = keysOf(conditions, 'actions.conditions'); const effectKeys = keysOf(effects, 'actions.effects'); const actionKeys = keysOf(actionRows, 'actions.actions')
  conditions.forEach((item, index) => { canonicalProductProductionJsonV2(item.expression); text(item.failureMessage, `actions.conditions[${index}].failureMessage`, 1_000) })
  effects.forEach((item, index) => { key(item.operation, `actions.effects[${index}].operation`); canonicalProductProductionJsonV2(item.payload) })
  actionRows.forEach((item, index) => { enumValue(item.category, ACTION_CATEGORIES, `actions.actions[${index}].category`); text(item.label, `actions.actions[${index}].label`, 2_000); text(item.description, `actions.actions[${index}].description`); enumValue(item.actorScope, ['player', 'system'], `actions.actions[${index}].actorScope`); enumValue(item.targetScope, ['none', 'actor', 'location', 'item', 'quest', 'vendor', 'encounter'], `actions.actions[${index}].targetScope`); requireRefs(strings(item.locationKeys, `actions.actions[${index}].locationKeys`), locationKeys, 'action location'); requireRefs(strings(item.requirementConditionKeys, `actions.actions[${index}].requirementConditionKeys`), conditionKeys, 'action condition'); requireRefs(strings(item.costEffectKeys, `actions.actions[${index}].costEffectKeys`), effectKeys, 'action cost effect'); requireRefs(strings(item.successEffectKeys, `actions.actions[${index}].successEffectKeys`), effectKeys, 'action success effect'); requireRefs(strings(item.failureEffectKeys, `actions.actions[${index}].failureEffectKeys`), effectKeys, 'action failure effect'); int(item.timeCostMinutes, `actions.actions[${index}].timeCostMinutes`, 0, 1_000_000); enumValue(item.confirmationPolicy, ['never', 'high-risk', 'always'], `actions.actions[${index}].confirmationPolicy`); const repeatPolicy = enumValue(item.repeatPolicy, ['once', 'repeatable', 'cooldown'], `actions.actions[${index}].repeatPolicy`); const cooldown = item.cooldownMinutes == null ? null : int(item.cooldownMinutes, `actions.actions[${index}].cooldownMinutes`, 1, 1_000_000); if ((repeatPolicy === 'cooldown') !== (cooldown != null)) fail(`actions.actions[${index}] cooldown策略不一致`) })

  const quests = versioned(packageValue, 'quests')
  exact(quests, ['version', 'quests', 'stages', 'objectives'], 'quests')
  const questRows = catalog(quests.quests, 'quests.quests', ['key', 'type', 'ownerKey', 'title', 'description', 'storylineKey', 'stageKeys', 'prerequisiteConditionKeys', 'rewardEffectKeys', 'lifecyclePolicy', 'expirationMinutes', 'repeatable']); const questStages = catalog(quests.stages, 'quests.stages', ['key', 'questKey', 'order', 'title', 'objectiveKeys', 'completionConditionKeys']); const objectives = catalog(quests.objectives, 'quests.objectives', ['key', 'stageKey', 'title', 'optional', 'actionKeys'])
  const questKeys = keysOf(questRows, 'quests.quests'); const questStageKeys = keysOf(questStages, 'quests.stages'); const objectiveKeys = keysOf(objectives, 'quests.objectives')
  questRows.forEach((item, index) => { const type = enumValue(item.type, QUEST_TYPES, `quests.quests[${index}].type`); nullableKey(item.ownerKey, `quests.quests[${index}].ownerKey`); text(item.title, `quests.quests[${index}].title`, 2_000); text(item.description, `quests.quests[${index}].description`); requireRef(nullableKey(item.storylineKey, `quests.quests[${index}].storylineKey`), storylineKeys, 'quest storyline'); requireRefs(strings(item.stageKeys, `quests.quests[${index}].stageKeys`), questStageKeys, 'quest stage'); requireRefs(strings(item.prerequisiteConditionKeys, `quests.quests[${index}].prerequisiteConditionKeys`), conditionKeys, 'quest condition'); requireRefs(strings(item.rewardEffectKeys, `quests.quests[${index}].rewardEffectKeys`), effectKeys, 'quest reward'); const policy = enumValue(item.lifecyclePolicy, QUEST_POLICIES, `quests.quests[${index}].lifecyclePolicy`); if ((type === 'mainline' || type === 'significant') && policy !== 'protected-wait') fail(`quests.quests[${index}] 重要任务必须protected-wait`); const expiration = item.expirationMinutes == null ? null : int(item.expirationMinutes, `quests.quests[${index}].expirationMinutes`, 1, 1_000_000_000); if (policy === 'protected-wait' && expiration != null) fail(`quests.quests[${index}] protected-wait不能过期`); const repeatable = bool(item.repeatable, `quests.quests[${index}].repeatable`); if ((type === 'mainline' || type === 'significant') && repeatable) fail(`quests.quests[${index}] 重要任务不能重复`) })
  questStages.forEach((item, index) => { requireRef(key(item.questKey, `quests.stages[${index}].questKey`), questKeys, 'quest stage owner'); int(item.order, `quests.stages[${index}].order`, 0, 10_000); text(item.title, `quests.stages[${index}].title`, 2_000); requireRefs(strings(item.objectiveKeys, `quests.stages[${index}].objectiveKeys`), objectiveKeys, 'quest objective'); requireRefs(strings(item.completionConditionKeys, `quests.stages[${index}].completionConditionKeys`), conditionKeys, 'quest completion condition') })
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

  const items = versioned(packageValue, 'items')
  exact(items, ['version', 'equipmentSlots', 'items', 'dropTables'], 'items')
  const slots = catalog(items.equipmentSlots, 'items.equipmentSlots', ['key', 'label']); const itemRows = catalog(items.items, 'items.items', ['key', 'title', 'description', 'kind', 'stackable', 'consumable', 'critical', 'baseValue', 'equipmentSlotKey', 'statModifiers', 'effectKeys']); const dropTables = catalog(items.dropTables, 'items.dropTables', ['key', 'entries'])
  const slotKeys = keysOf(slots, 'items.equipmentSlots'); if ([...slotKeys].sort().join(',') !== ['accessory', 'armor', 'weapon'].join(',')) fail('首版装备位必须为weapon/armor/accessory')
  slots.forEach((item, index) => text(item.label, `items.equipmentSlots[${index}].label`, 100)); const itemKeys = keysOf(itemRows, 'items.items'); const dropTableKeys = keysOf(dropTables, 'items.dropTables')
  const modifierFields = ['maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'skillPower', 'skillResource']
  itemRows.forEach((item, index) => { text(item.title, `items.items[${index}].title`, 2_000); text(item.description, `items.items[${index}].description`); const kind = enumValue(item.kind, ['equipment', 'consumable', 'material', 'quest', 'misc'], `items.items[${index}].kind`); const stackable = bool(item.stackable, `items.items[${index}].stackable`); const consumable = bool(item.consumable, `items.items[${index}].consumable`); const critical = bool(item.critical, `items.items[${index}].critical`); int(item.baseValue, `items.items[${index}].baseValue`, 0, 1_000_000_000); const slot = nullableKey(item.equipmentSlotKey, `items.items[${index}].equipmentSlotKey`); requireRef(slot, slotKeys, 'item slot'); if ((kind === 'equipment') !== (slot != null)) fail(`items.items[${index}] 装备类型/槽位不一致`); if (critical && (consumable || kind !== 'quest')) fail(`items.items[${index}] 关键物品必须为不可消耗quest物品`); if (!stackable && kind === 'material') fail(`items.items[${index}] 材料必须可堆叠`); const modifiers = row(item.statModifiers, `items.items[${index}].statModifiers`); if (Object.keys(modifiers).some(field => !modifierFields.includes(field))) fail(`items.items[${index}].statModifiers字段无效`); Object.entries(modifiers).forEach(([field, value]) => numberValue(value, `items.items[${index}].statModifiers.${field}`, -1_000_000, 1_000_000)); requireRefs(strings(item.effectKeys, `items.items[${index}].effectKeys`), effectKeys, 'item effect') })
  dropTables.forEach((item, index) => array(item.entries, `items.dropTables[${index}].entries`).forEach((entry, entryIndex) => { const parsed = row(entry, `items.dropTables[${index}].entries[${entryIndex}]`); exact(parsed, ['itemKey', 'minimum', 'maximum', 'weight'], `items.dropTables[${index}].entries[${entryIndex}]`); requireRef(key(parsed.itemKey, 'drop item'), itemKeys, 'drop item'); const minimum = int(parsed.minimum, 'drop minimum', 0, 1_000_000); const maximum = int(parsed.maximum, 'drop maximum', 0, 1_000_000); if (minimum > maximum) fail('drop minimum大于maximum'); numberValue(parsed.weight, 'drop weight', 0.000001, 1_000_000) }))
  requireRefs(strings(build.startingItemKeys, 'actors.player.build.startingItemKeys'), itemKeys, 'player starting item')

  const combat = versioned(packageValue, 'combat')
  exact(combat, ['version', 'rules', 'enemies', 'encounters'], 'combat')
  const combatRules = row(combat.rules, 'combat.rules'); exact(combatRules, ['difficulty', 'defaultAttackHits', 'playerPartyLimit', 'allowFriendlyNpcCombatants', 'allowElements', 'allowEscape'], 'combat.rules'); if (combatRules.difficulty !== 'standard' || combatRules.defaultAttackHits !== true || combatRules.playerPartyLimit !== 1 || combatRules.allowFriendlyNpcCombatants !== false || combatRules.allowElements !== false || combatRules.allowEscape !== true) fail('combat.rules不符合首版冻结边界')
  const enemies = catalog(combat.enemies, 'combat.enemies', ['key', 'familyKey', 'title', 'level', 'maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'skillKeys', 'dropTableKey']); const encounters = catalog(combat.encounters, 'combat.encounters', ['key', 'title', 'locationKey', 'enemyKeys', 'recommendedLevel', 'intensity', 'escapeAllowed', 'victoryEffectKeys']); const enemyKeys = keysOf(enemies, 'combat.enemies'); keysOf(encounters, 'combat.encounters')
  enemies.forEach((item, index) => { key(item.familyKey, `combat.enemies[${index}].familyKey`); text(item.title, `combat.enemies[${index}].title`, 2_000); int(item.level, `combat.enemies[${index}].level`, 1, maximumLevel); int(item.maximumHealth, `combat.enemies[${index}].maximumHealth`, 1, 1_000_000_000); int(item.attack, `combat.enemies[${index}].attack`, 0, 1_000_000_000); int(item.defense, `combat.enemies[${index}].defense`, 0, 1_000_000_000); numberValue(item.criticalChance, `combat.enemies[${index}].criticalChance`, 0, 1); numberValue(item.initiative, `combat.enemies[${index}].initiative`, 0, 1_000_000); requireRefs(strings(item.skillKeys, `combat.enemies[${index}].skillKeys`), skillKeys, 'enemy skill'); requireRef(nullableKey(item.dropTableKey, `combat.enemies[${index}].dropTableKey`), dropTableKeys, 'enemy drop table') })
  encounters.forEach((item, index) => { text(item.title, `combat.encounters[${index}].title`, 2_000); requireRef(key(item.locationKey, `combat.encounters[${index}].locationKey`), locationKeys, 'encounter location'); requireRefs(strings(item.enemyKeys, `combat.encounters[${index}].enemyKeys`), enemyKeys, 'encounter enemy'); int(item.recommendedLevel, `combat.encounters[${index}].recommendedLevel`, 1, maximumLevel); enumValue(item.intensity, ['ordinary', 'dangerous', 'boss'], `combat.encounters[${index}].intensity`); bool(item.escapeAllowed, `combat.encounters[${index}].escapeAllowed`); requireRefs(strings(item.victoryEffectKeys, `combat.encounters[${index}].victoryEffectKeys`), effectKeys, 'encounter victory effect') })

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

  const timeWeather = versioned(packageValue, 'time-weather')
  exact(timeWeather, ['version', 'initialWorldMinute', 'minutesPerDay', 'timePeriods', 'weather', 'regionWeatherTables'], 'time-weather'); const minutesPerDay = int(timeWeather.minutesPerDay, 'time-weather.minutesPerDay', 60, 100_000); int(timeWeather.initialWorldMinute, 'time-weather.initialWorldMinute', 0, 1_000_000_000)
  const periods = catalog(timeWeather.timePeriods, 'time-weather.timePeriods', ['key', 'label', 'startMinute', 'endMinute']); const weather = catalog(timeWeather.weather, 'time-weather.weather', ['key', 'label', 'description']); const weatherTables = catalog(timeWeather.regionWeatherTables, 'time-weather.regionWeatherTables', ['regionKey', 'entries']); const periodKeys = keysOf(periods, 'time-weather.timePeriods'); const weatherKeys = keysOf(weather, 'time-weather.weather')
  periods.forEach((item, index) => { text(item.label, `time-weather.timePeriods[${index}].label`, 100); const start = int(item.startMinute, `time-weather.timePeriods[${index}].startMinute`, 0, minutesPerDay - 1); const end = int(item.endMinute, `time-weather.timePeriods[${index}].endMinute`, 1, minutesPerDay); if (start >= end) fail('time period start必须小于end') })
  const orderedPeriods = [...periods].sort((left, right) => Number(left.startMinute) - Number(right.startMinute))
  if (!orderedPeriods.length || orderedPeriods[0].startMinute !== 0 || orderedPeriods[orderedPeriods.length - 1].endMinute !== minutesPerDay
    || orderedPeriods.some((item, index) => index > 0 && item.startMinute !== orderedPeriods[index - 1].endMinute)) {
    fail('timePeriods必须无重叠无空洞覆盖完整一天')
  }
  weather.forEach((item, index) => { text(item.label, `time-weather.weather[${index}].label`, 100); text(item.description, `time-weather.weather[${index}].description`) })
  const weatherRegionKeys = weatherTables.map((item, index) => key(item.regionKey, `time-weather.regionWeatherTables[${index}].regionKey`)); if (new Set(weatherRegionKeys).size !== weatherRegionKeys.length) fail('regionWeatherTables.regionKey重复'); requireRefs(weatherRegionKeys, regionKeys, 'weather region'); weatherTables.forEach((item, index) => { const entries = array(item.entries, `time-weather.regionWeatherTables[${index}].entries`); if (!entries.length) fail('weather table不能为空'); entries.forEach((entry, entryIndex) => { const parsed = row(entry, `weather entries[${entryIndex}]`); exact(parsed, ['weatherKey', 'weight'], 'weather entry'); requireRef(key(parsed.weatherKey, 'weatherKey'), weatherKeys, 'weather'); numberValue(parsed.weight, 'weather weight', 0.000001, 1_000_000) }) })
  requireSameKeys(weatherRegionKeys, [...regionKeys], 'region weather tables')
  schedules.forEach((item, index) => array(item.entries, `actors.schedules[${index}].entries`).forEach((entry, entryIndex) => requireRef(key(row(entry, 'schedule entry').timePeriodKey, `actors.schedules[${index}].entries[${entryIndex}].timePeriodKey`), periodKeys, 'schedule time period')))

  const director = versioned(packageValue, 'director')
  exact(director, ['version', 'rules', 'decks', 'templates', 'randomEvents'], 'director'); const directorRules = row(director.rules, 'director.rules'); exact(directorRules, ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit'], 'director.rules'); ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit'].forEach(field => int(directorRules[field], `director.rules.${field}`, 1, 1_000_000))
  const decks = catalog(director.decks, 'director.decks', ['regionKey', 'questKeys', 'templateKeys', 'randomEventKeys', 'maximumRevealed', 'maximumActive', 'cooldownMinutes', 'blankWeight']); const templates = catalog(director.templates, 'director.templates', ['key', 'questKey', 'regionKeys', 'variantTextKeys', 'fingerprint', 'cooldownMinutes']); const randomEvents = catalog(director.randomEvents, 'director.randomEvents', ['key', 'title', 'regionKeys', 'actionKeys', 'effectKeys', 'intensity', 'cooldownMinutes']); const templateKeys = keysOf(templates, 'director.templates'); const randomEventKeys = keysOf(randomEvents, 'director.randomEvents')
  const deckRegions = decks.map((item, index) => key(item.regionKey, `director.decks[${index}].regionKey`)); if (new Set(deckRegions).size !== deckRegions.length) fail('director.decks.regionKey重复'); requireRefs(deckRegions, regionKeys, 'deck region')
  requireSameKeys(deckRegions, [...regionKeys], 'region director decks')
  templates.forEach((item, index) => { const questKey = key(item.questKey, `director.templates[${index}].questKey`); requireRef(questKey, questKeys, 'template quest'); if (questRows.find(quest => quest.key === questKey)?.type !== 'template') fail(`director template必须引用template任务:${questKey}`); requireRefs(strings(item.regionKeys, `director.templates[${index}].regionKeys`), regionKeys, 'template region'); strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`); key(item.fingerprint, `director.templates[${index}].fingerprint`); int(item.cooldownMinutes, `director.templates[${index}].cooldownMinutes`, 0, 1_000_000) })
  randomEvents.forEach((item, index) => { text(item.title, `director.randomEvents[${index}].title`, 2_000); requireRefs(strings(item.regionKeys, `director.randomEvents[${index}].regionKeys`), regionKeys, 'random event region'); requireRefs(strings(item.actionKeys, `director.randomEvents[${index}].actionKeys`), actionKeys, 'random event action'); requireRefs(strings(item.effectKeys, `director.randomEvents[${index}].effectKeys`), effectKeys, 'random event effect'); int(item.intensity, `director.randomEvents[${index}].intensity`, 1, 10); int(item.cooldownMinutes, `director.randomEvents[${index}].cooldownMinutes`, 0, 1_000_000) })
  decks.forEach((item, index) => { requireRefs(strings(item.questKeys, `director.decks[${index}].questKeys`), questKeys, 'deck quest'); requireRefs(strings(item.templateKeys, `director.decks[${index}].templateKeys`), templateKeys, 'deck template'); requireRefs(strings(item.randomEventKeys, `director.decks[${index}].randomEventKeys`), randomEventKeys, 'deck event'); const maxRevealed = int(item.maximumRevealed, `director.decks[${index}].maximumRevealed`, 1, 1_000); const maxActive = int(item.maximumActive, `director.decks[${index}].maximumActive`, 1, 1_000); if (maxActive > maxRevealed) fail('deck maximumActive不能大于maximumRevealed'); int(item.cooldownMinutes, `director.decks[${index}].cooldownMinutes`, 0, 1_000_000); numberValue(item.blankWeight, `director.decks[${index}].blankWeight`, 0, 1_000_000) })

  const knowledge = versioned(packageValue, 'knowledge')
  exact(knowledge, ['version', 'entries', 'rumors', 'achievements'], 'knowledge'); const entries = catalog(knowledge.entries, 'knowledge.entries', ['key', 'kind', 'title', 'content', 'sourceRefs', 'initialPlayerVisibility', 'actorKeys']); const rumors = catalog(knowledge.rumors, 'knowledge.rumors', ['key', 'knowledgeKey', 'text', 'reliability']); const achievements = catalog(knowledge.achievements, 'knowledge.achievements', ['key', 'title', 'description', 'conditionKeys']); const knowledgeKeys = keysOf(entries, 'knowledge.entries'); keysOf(rumors, 'knowledge.rumors'); keysOf(achievements, 'knowledge.achievements')
  entries.forEach((item, index) => { enumValue(item.kind, ['location', 'actor', 'faction', 'enemy', 'lore', 'quest-clue'], `knowledge.entries[${index}].kind`); text(item.title, `knowledge.entries[${index}].title`, 2_000); text(item.content, `knowledge.entries[${index}].content`); strings(item.sourceRefs, `knowledge.entries[${index}].sourceRefs`, 'text'); enumValue(item.initialPlayerVisibility, ['hidden', 'rumor', 'known'], `knowledge.entries[${index}].initialPlayerVisibility`); requireRefs(strings(item.actorKeys, `knowledge.entries[${index}].actorKeys`), actorKeys, 'knowledge actor') })
  rumors.forEach((item, index) => { requireRef(key(item.knowledgeKey, `knowledge.rumors[${index}].knowledgeKey`), knowledgeKeys, 'rumor knowledge'); text(item.text, `knowledge.rumors[${index}].text`); enumValue(item.reliability, ['uncertain', 'likely', 'confirmed'], `knowledge.rumors[${index}].reliability`) })
  achievements.forEach((item, index) => { text(item.title, `knowledge.achievements[${index}].title`, 2_000); text(item.description, `knowledge.achievements[${index}].description`); requireRefs(strings(item.conditionKeys, `knowledge.achievements[${index}].conditionKeys`), conditionKeys, 'achievement condition') })

  const presentation = versioned(packageValue, 'presentation')
  exact(presentation, ['version', 'textStyle', 'mediaSlots', 'taskTextVariants', 'tutorials'], 'presentation'); const textStyle = row(presentation.textStyle, 'presentation.textStyle'); exact(textStyle, ['narrationTone', 'dialogueStyle', 'systemReceiptStyle'], 'presentation.textStyle'); ['narrationTone', 'dialogueStyle', 'systemReceiptStyle'].forEach(field => text(textStyle[field], `presentation.textStyle.${field}`))
  const mediaSlots = catalog(presentation.mediaSlots, 'presentation.mediaSlots', ['key', 'kind', 'consumerRef', 'required', 'assetKey', 'fallbackText', 'altText']); const variants = catalog(presentation.taskTextVariants, 'presentation.taskTextVariants', ['key', 'templateKey', 'title', 'description']); const tutorials = catalog(presentation.tutorials, 'presentation.tutorials', ['key', 'triggerActionKey', 'targetUiKey', 'title', 'body']); const mediaSlotKeys = keysOf(mediaSlots, 'presentation.mediaSlots'); const variantKeys = keysOf(variants, 'presentation.taskTextVariants'); keysOf(tutorials, 'presentation.tutorials')
  if ([...mediaSlotKeys].sort().join(',') !== [...packageValue.mediaManifest.slotKeys].sort().join(',')) fail('presentation.mediaSlots与根mediaManifest.slotKeys不一致')
  mediaSlots.forEach((item, index) => { enumValue(item.kind, ['map', 'portrait', 'background', 'item-icon', 'enemy-icon', 'audio'], `presentation.mediaSlots[${index}].kind`); text(item.consumerRef, `presentation.mediaSlots[${index}].consumerRef`, 1_000); const required = bool(item.required, `presentation.mediaSlots[${index}].required`); nullableKey(item.assetKey, `presentation.mediaSlots[${index}].assetKey`); text(item.fallbackText, `presentation.mediaSlots[${index}].fallbackText`, 5_000); text(item.altText, `presentation.mediaSlots[${index}].altText`, 2_000); if (required !== packageValue.mediaManifest.requiredSlotKeys.includes(String(item.key))) fail(`presentation.mediaSlots[${index}].required与根manifest不一致`) })
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
    if (ownerKey && !actorKeys.has(ownerKey) && !factionKeys.has(ownerKey) && !regionKeys.has(ownerKey)) fail(`quest owner不存在:${ownerKey}`)
  })
  actionRows.forEach((item, index) => {
    if (item.targetScope === 'vendor' && vendors.length === 0) fail(`actions.actions[${index}] 需要vendor但目录为空`)
  })
  if (!travelPointKeys.size) fail('首版至少需要一个快速旅行点')

  return {
    narrative: structuredClone(narrative) as unknown as TextOpenWorldParsedModulesV1['narrative'],
    world: structuredClone(world) as unknown as TextOpenWorldParsedModulesV1['world'],
    actors: structuredClone(actors) as unknown as TextOpenWorldParsedModulesV1['actors'],
    quests: structuredClone(quests) as unknown as TextOpenWorldParsedModulesV1['quests'],
    actions: structuredClone(actions) as unknown as TextOpenWorldParsedModulesV1['actions'],
    progression: structuredClone(progression) as unknown as TextOpenWorldParsedModulesV1['progression'],
    combat: structuredClone(combat) as unknown as TextOpenWorldParsedModulesV1['combat'],
    items: structuredClone(items) as unknown as TextOpenWorldParsedModulesV1['items'],
    crafting: structuredClone(crafting) as unknown as TextOpenWorldParsedModulesV1['crafting'],
    economy: structuredClone(economy) as unknown as TextOpenWorldParsedModulesV1['economy'],
    relationships: structuredClone(relationships) as unknown as TextOpenWorldParsedModulesV1['relationships'],
    'time-weather': structuredClone(timeWeather) as unknown as TextOpenWorldParsedModulesV1['time-weather'],
    director: structuredClone(director) as unknown as TextOpenWorldParsedModulesV1['director'],
    knowledge: structuredClone(knowledge) as unknown as TextOpenWorldParsedModulesV1['knowledge'],
    presentation: structuredClone(presentation) as unknown as TextOpenWorldParsedModulesV1['presentation'],
  }
}
