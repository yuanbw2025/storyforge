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
const SHA256 = /^[a-f0-9]{64}$/
const ACTION_CATEGORIES: TextOpenWorldActionCategoryV1[] = [
  'move', 'travel', 'fast-travel', 'observe', 'investigate', 'talk', 'take', 'use', 'equip', 'unequip', 'drop',
  'buy', 'sell', 'craft', 'accept-quest', 'restart-quest', 'abandon-quest', 'objective-action', 'quest-action', 'weather-action', 'actor-schedule-action', 'actor-state-action', 'claim-reward', 'attack-actor', 'steal', 'deceive', 'crime', 'start-combat', 'continue-combat', 'combat-state-action', 'escape',
  'director-action',
  'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'combat-reward-action',
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
function usesRelationshipCondition(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesRelationshipCondition)
  if (!value || typeof value !== 'object') return false
  const parsed = value as Record<string, unknown>
  if (['relation-faction-affinity', 'relation-attitude', 'relation-story-modifier'].includes(String(parsed.op))) return true
  if (parsed.op === 'player-number' && parsed.field === 'morality') return true
  return Object.values(parsed).some(usesRelationshipCondition)
}
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
function combatModifiers(value: unknown, label: string): Row[] {
  const modifiers = catalog(value, label, ['stat', 'operation', 'amount'])
  const stats = modifiers.map((modifier, index) => {
    const stat = enumValue(modifier.stat, ['attack', 'defense', 'skillPower', 'criticalChanceBasisPoints'], `${label}[${index}].stat`)
    if (modifier.operation !== 'add-flat') fail(`${label}[${index}].operation无效`)
    int(modifier.amount, `${label}[${index}].amount`, -1_000_000_000, 1_000_000_000)
    return stat
  })
  if (new Set(stats).size !== stats.length) fail(`${label}同一属性只能声明一个修正`)
  return modifiers
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

  const narrative = versioned(packageValue, 'narrative', [1, 2])
  const authoredNarrativeModule = narrative.version === 2
  exact(narrative, authoredNarrativeModule
    ? ['version', 'storylines', 'stages', 'endings', 'scenes', 'fixedChoices', 'randomEventPresentations']
    : ['version', 'storylines', 'stages', 'endings', 'scenes', 'fixedChoices'], 'narrative')
  const storylines = catalog(narrative.storylines, 'narrative.storylines', ['key', 'kind', 'ownerKind', 'ownerKey', 'title', 'summary', 'stageKeys', 'endingKeys'])
  const narrativeStages = catalog(narrative.stages, 'narrative.stages', ['key', 'storylineKey', 'order', 'title', 'summary', 'questKeys', 'sceneKeys', 'safeWaitPoint'])
  const endings = catalog(narrative.endings, 'narrative.endings', ['key', 'title', 'summary', 'conditionKeys'])
  const scenes = catalog(narrative.scenes, 'narrative.scenes', authoredNarrativeModule
    ? [
        'key', 'order', 'sourceKind', 'sourceKey', 'title', 'purpose', 'regionKey', 'locationKey', 'questKey', 'stageKey',
        'objectiveKey', 'actorKey', 'interactionKey', 'randomEventKey', 'participantKeys', 'openingText', 'bodyText',
        'successText', 'failureText', 'attitudeOpenings', 'allowedKnowledgeClaimKeys', 'forbiddenFutureObjectiveKeys',
        'availabilityConditionKeys', 'actionKeys', 'fixedChoiceKeys',
      ]
    : ['key', 'title', 'purpose', 'locationKey', 'participantKeys', 'actionKeys', 'fixedChoiceKeys'])
  const fixedChoices = catalog(narrative.fixedChoices, 'narrative.fixedChoices', ['key', 'sceneKey', 'label', 'description', 'actionKey'])
  const randomEventPresentations = authoredNarrativeModule
    ? catalog(narrative.randomEventPresentations, 'narrative.randomEventPresentations', [
        'key', 'order', 'randomEventKey', 'openingText', 'resolutionText', 'rumorKey', 'rumorRequirementKey',
        'rumorText', 'reliability', 'sourceClaimKeys',
      ])
    : []
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
  scenes.forEach((item, index) => {
    const label = `narrative.scenes[${index}]`
    text(item.title, `${label}.title`, 2_000); text(item.purpose, `${label}.purpose`); key(item.locationKey, `${label}.locationKey`)
    strings(item.participantKeys, `${label}.participantKeys`); strings(item.actionKeys, `${label}.actionKeys`)
    requireRefs(strings(item.fixedChoiceKeys, `${label}.fixedChoiceKeys`), choiceKeys, 'scene choice')
    if (!authoredNarrativeModule) return
    int(item.order, `${label}.order`, 1, 1_000_000)
    const sourceKind = enumValue(item.sourceKind, ['quest-offer', 'quest-objective', 'quest-resolution', 'actor-dialogue', 'location-interaction', 'random-event'], `${label}.sourceKind`)
    const sourceKey = key(item.sourceKey, `${label}.sourceKey`)
    key(item.regionKey, `${label}.regionKey`)
    const questKey = nullableKey(item.questKey, `${label}.questKey`)
    const stageKey = nullableKey(item.stageKey, `${label}.stageKey`)
    const objectiveKey = nullableKey(item.objectiveKey, `${label}.objectiveKey`)
    const actorKey = nullableKey(item.actorKey, `${label}.actorKey`)
    const interactionKey = nullableKey(item.interactionKey, `${label}.interactionKey`)
    const randomEventKey = nullableKey(item.randomEventKey, `${label}.randomEventKey`)
    const expectedSourceKey = sourceKind === 'quest-objective' ? objectiveKey
      : sourceKind === 'actor-dialogue' ? actorKey
        : sourceKind === 'location-interaction' ? interactionKey
          : sourceKind === 'random-event' ? randomEventKey : questKey
    if (!expectedSourceKey || sourceKey !== expectedSourceKey) fail(`${label}.sourceKey与sourceKind不一致`)
    if (sourceKind === 'quest-objective') {
      if (!questKey || !stageKey || !objectiveKey || actorKey || interactionKey || randomEventKey) fail(`${label}任务目标场景引用不完整`)
    } else if (sourceKind === 'quest-offer') {
      if (!questKey || stageKey || objectiveKey || interactionKey || randomEventKey) fail(`${label}任务委托场景引用不完整`)
    } else if (sourceKind === 'quest-resolution') {
      if (!questKey || !stageKey || objectiveKey || interactionKey || randomEventKey) fail(`${label}任务收束场景引用不完整`)
    } else if (sourceKind === 'actor-dialogue') {
      if (questKey || stageKey || objectiveKey || !actorKey || interactionKey || randomEventKey) fail(`${label}角色对话场景引用不完整`)
    } else if (sourceKind === 'location-interaction') {
      if (questKey || stageKey || objectiveKey || actorKey || !interactionKey || randomEventKey) fail(`${label}地点交互场景引用不完整`)
    } else if (questKey || stageKey || objectiveKey || actorKey || interactionKey || !randomEventKey) fail(`${label}随机事件场景引用不完整`)
    text(item.openingText, `${label}.openingText`); text(item.bodyText, `${label}.bodyText`); text(item.successText, `${label}.successText`)
    if (item.failureText != null) text(item.failureText, `${label}.failureText`)
    if (item.attitudeOpenings == null) {
      if (sourceKind === 'actor-dialogue') fail(`${label}角色对话必须提供三档态度开场`)
    } else {
      if (sourceKind !== 'actor-dialogue') fail(`${label}只有角色对话可以提供三档态度开场`)
      const attitudes = row(item.attitudeOpenings, `${label}.attitudeOpenings`)
      exact(attitudes, ['bad', 'neutral', 'good'], `${label}.attitudeOpenings`)
      ;['bad', 'neutral', 'good'].forEach(band => text(attitudes[band], `${label}.attitudeOpenings.${band}`, 2_000))
    }
    strings(item.allowedKnowledgeClaimKeys, `${label}.allowedKnowledgeClaimKeys`)
    strings(item.forbiddenFutureObjectiveKeys, `${label}.forbiddenFutureObjectiveKeys`)
    strings(item.availabilityConditionKeys, `${label}.availabilityConditionKeys`)
  })
  fixedChoices.forEach((item, index) => { requireRef(key(item.sceneKey, `narrative.fixedChoices[${index}].sceneKey`), sceneKeys, 'choice scene'); text(item.label, `narrative.fixedChoices[${index}].label`, 2_000); text(item.description, `narrative.fixedChoices[${index}].description`); key(item.actionKey, `narrative.fixedChoices[${index}].actionKey`) })
  if (authoredNarrativeModule) {
    const sceneOrders = scenes.map((item, index) => int(item.order, `narrative.scenes[${index}].order`, 1, 1_000_000))
    if (new Set(sceneOrders).size !== sceneOrders.length) fail('narrative.scenes.order不能重复')
    keysOf(randomEventPresentations, 'narrative.randomEventPresentations')
    const eventOrders = randomEventPresentations.map((item, index) => {
      const label = `narrative.randomEventPresentations[${index}]`
      const order = int(item.order, `${label}.order`, 1, 1_000_000)
      key(item.randomEventKey, `${label}.randomEventKey`)
      text(item.openingText, `${label}.openingText`); text(item.resolutionText, `${label}.resolutionText`)
      const rumorKey = nullableKey(item.rumorKey, `${label}.rumorKey`)
      const requirementKey = nullableKey(item.rumorRequirementKey, `${label}.rumorRequirementKey`)
      const rumorText = item.rumorText == null ? null : text(item.rumorText, `${label}.rumorText`)
      if ((rumorKey != null) !== (requirementKey != null) || (rumorKey != null) !== (rumorText != null)
        || (rumorKey != null) !== (item.reliability === 'uncertain'
          || item.reliability === 'likely' || item.reliability === 'confirmed')) fail(`${label}传闻字段必须成组出现`)
      strings(item.sourceClaimKeys, `${label}.sourceClaimKeys`)
      return order
    })
    if (new Set(eventOrders).size !== eventOrders.length) fail('narrative.randomEventPresentations.order不能重复')
  }

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
  // A world may place its first travel/respawn point away from the opening
  // scene. Combat still has the governed pre-battle retry checkpoint, while a
  // respawn destination becomes available only after the player has actually
  // visited and unlocked it. Requiring a default point here used to force
  // authors either to lie about a visit or to move the authored landmark.
  if (!travelPoints.some(item => item.canRespawn === true)) fail('至少需要一个可在到访后用于复活的快速旅行点')
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

  const actors = versioned(packageValue, 'actors', [1, 2, 3])
  const legacyActorModule = Number(actors.version) < 2
  const actorLifecycleModule = Number(actors.version) >= 3
  exact(actors, actorLifecycleModule
    ? ['version', 'player', 'factions', 'actors', 'schedules', 'serviceContinuity']
    : ['version', 'player', 'factions', 'actors', 'schedules'], 'actors')
  const player = playerDefinition(actors.player)
  const build = row(player.build, 'actors.player.build')
  const factions = catalog(actors.factions, 'actors.factions', ['key', 'title', 'description'])
  const actorRows = catalog(actors.actors, 'actors.actors', actorLifecycleModule
    ? ['key', 'tier', 'name', 'biography', 'portrayal', 'factionKey', 'homeLocationKey', 'protected', 'mortalityPolicy', 'serviceKeys', 'scheduleKey']
    : ['key', 'tier', 'name', 'biography', 'portrayal', 'factionKey', 'homeLocationKey', 'protected', 'serviceKeys', 'scheduleKey'])
    .map(item => actorLifecycleModule ? item : { ...item, mortalityPolicy: item.protected ? 'protected' : 'mortal' })
  const scheduleRows = catalog(actors.schedules, 'actors.schedules', ['key', 'actorKey', 'entries'])
  const serviceContinuityRows = actorLifecycleModule
    ? catalog(actors.serviceContinuity, 'actors.serviceContinuity', ['key', 'ownerActorKey', 'serviceKey', 'policy', 'replacementActorKey', 'replacementServiceKey'])
    : actorRows.flatMap(actor => strings(actor.serviceKeys, `actor ${String(actor.key)} serviceKeys`).map(serviceKey => ({
        key: `service-continuity.${serviceKey}`,
        ownerActorKey: actor.key,
        serviceKey,
        policy: 'disappear-on-owner-death',
        replacementActorKey: null,
        replacementServiceKey: null,
      })))
  const schedules: Row[] = scheduleRows.map((item, index) => ({
    ...item,
    entries: array(item.entries, `actors.schedules[${index}].entries`, 100).map((entry, entryIndex) => {
      const parsed = row(entry, `actors.schedules[${index}].entries[${entryIndex}]`)
      exact(parsed, legacyActorModule ? ['timePeriodKey', 'locationKey', 'activity'] : ['timePeriodKey', 'locationKey', 'activity', 'availableServiceKeys'], `actors.schedules[${index}].entries[${entryIndex}]`)
      return legacyActorModule
        ? { ...parsed, availableServiceKeys: structuredClone(actorRows.find(actor => actor.key === item.actorKey)?.serviceKeys ?? []) }
        : parsed
    }),
  }))
  const factionKeys = keysOf(factions, 'actors.factions'); const actorKeys = keysOf(actorRows, 'actors.actors'); const scheduleKeys = keysOf(schedules, 'actors.schedules')
  keysOf(serviceContinuityRows, 'actors.serviceContinuity')
  factions.forEach((item, index) => { text(item.title, `actors.factions[${index}].title`, 2_000); text(item.description, `actors.factions[${index}].description`) })
  actorRows.forEach((item, index) => {
    const tier = enumValue(item.tier, ['mainline', 'significant', 'resident', 'transient'], `actors.actors[${index}].tier`)
    text(item.name, `actors.actors[${index}].name`, 2_000); text(item.biography, `actors.actors[${index}].biography`); text(item.portrayal, `actors.actors[${index}].portrayal`)
    requireRef(nullableKey(item.factionKey, `actors.actors[${index}].factionKey`), factionKeys, 'actor faction'); requireRef(key(item.homeLocationKey, `actors.actors[${index}].homeLocationKey`), locationKeys, 'actor home')
    const protectedActor = bool(item.protected, `actors.actors[${index}].protected`)
    const mortalityPolicy = enumValue(item.mortalityPolicy, ['protected', 'story-only', 'mortal', 'despawn-on-resolution'], `actors.actors[${index}].mortalityPolicy`)
    if (protectedActor !== (mortalityPolicy === 'protected')) fail(`actors.actors[${index}] protected与mortalityPolicy不一致`)
    if (tier === 'mainline' && mortalityPolicy !== 'protected') fail(`主线关键Actor必须使用protected死亡策略:${String(item.key)}`)
    strings(item.serviceKeys, `actors.actors[${index}].serviceKeys`); requireRef(nullableKey(item.scheduleKey, `actors.actors[${index}].scheduleKey`), scheduleKeys, 'actor schedule')
  })
  schedules.forEach((item, index) => { requireRef(key(item.actorKey, `actors.schedules[${index}].actorKey`), actorKeys, 'schedule actor'); array(item.entries, `actors.schedules[${index}].entries`, 100).forEach((entry, entryIndex) => { const parsed = row(entry, `actors.schedules[${index}].entries[${entryIndex}]`); key(parsed.timePeriodKey, 'schedule timePeriodKey'); requireRef(key(parsed.locationKey, 'schedule locationKey'), locationKeys, 'schedule location'); text(parsed.activity, 'schedule activity', 2_000); strings(parsed.availableServiceKeys, `actors.schedules[${index}].entries[${entryIndex}].availableServiceKeys`) }) })
  actorRows.forEach((item, index) => {
    const scheduleKey = nullableKey(item.scheduleKey, `actors.actors[${index}].scheduleKey`)
    if (scheduleKey && schedules.find(schedule => schedule.key === scheduleKey)?.actorKey !== item.key) fail(`actor/schedule反向引用不一致:${String(item.key)}`)
  })
  schedules.forEach(item => {
    if (actorRows.find(actor => actor.key === item.actorKey)?.scheduleKey !== item.key) fail(`schedule/actor反向引用不一致:${String(item.key)}`)
  })

  const actions = versioned(packageValue, 'actions', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  const modernActionModule = Number(actions.version) >= 2
  const travelActionModule = Number(actions.version) >= 3
  const fastTravelActionModule = Number(actions.version) >= 4
  const timeWeatherActionModule = Number(actions.version) >= 5
  const actorScheduleActionModule = Number(actions.version) >= 6
  const actorLifecycleActionModule = Number(actions.version) >= 7
  const crimeActionModule = Number(actions.version) >= 8
  const combatStateActionModule = Number(actions.version) >= 9
  const combatOperationActionModule = Number(actions.version) >= 10
  const combatResolutionActionModule = Number(actions.version) >= 11
  const craftingActionModule = Number(actions.version) >= 12
  const economyActionModule = Number(actions.version) >= 13
  const directorActionModule = Number(actions.version) >= 14
  const inputBindingActionModule = Number(actions.version) >= 15
  const governedQuestLifecycleActionModule = Number(actions.version) >= 16
  const scaledCombatActionModule = Number(actions.version) >= 17
  const protectedStoryRevealActionModule = Number(actions.version) >= 18
  if (actorScheduleActionModule && legacyActorModule) fail('Action v6必须搭配Actor v2')
  if (actorLifecycleActionModule && !actorLifecycleModule) fail('Action v7必须搭配Actor v3')
  if (combatStateActionModule !== (packageValue.modules.combat.schemaVersion >= 2)) fail('Action v9+必须与Combat v2+一起发布')
  if (inputBindingActionModule && !authoredNarrativeModule) fail('Action v15必须与Narrative v2一起发布')
  exact(actions, inputBindingActionModule
    ? ['version', 'conditions', 'effects', 'actions', 'inputBindings']
    : ['version', 'conditions', 'effects', 'actions'], 'actions')
  const conditions = catalog(actions.conditions, 'actions.conditions', ['key', 'expression', 'failureMessage']); const effects = catalog(actions.effects, 'actions.effects', ['key', 'operation', 'payload']); const actionRows = catalog(actions.actions, 'actions.actions', ['key', 'category', 'label', 'description', 'actorScope', 'targetScope', 'locationKeys', 'requirementConditionKeys', 'costEffectKeys', 'successEffectKeys', 'failureEffectKeys', 'timeCostMinutes', 'confirmationPolicy', 'repeatPolicy', 'cooldownMinutes'])
  const conditionKeys = keysOf(conditions, 'actions.conditions'); const effectKeys = keysOf(effects, 'actions.effects'); const actionKeys = keysOf(actionRows, 'actions.actions')
  conditions.forEach((item, index) => { canonicalProductProductionJsonV2(item.expression); text(item.failureMessage, `actions.conditions[${index}].failureMessage`, 1_000) })
  normalizedWorld.edges.forEach((item, index) => requireRefs(item.conditionKeys, conditionKeys, `world.edges[${index}].conditionKeys`))
  effects.forEach((item, index) => { key(item.operation, `actions.effects[${index}].operation`); canonicalProductProductionJsonV2(item.payload) })
  actionRows.forEach((item, index) => { enumValue(item.category, ACTION_CATEGORIES, `actions.actions[${index}].category`); text(item.label, `actions.actions[${index}].label`, 2_000); text(item.description, `actions.actions[${index}].description`); enumValue(item.actorScope, ['player', 'system'], `actions.actions[${index}].actorScope`); enumValue(item.targetScope, ['none', 'actor', 'location', 'item', 'quest', 'vendor', 'encounter', 'combatant', 'recipe'], `actions.actions[${index}].targetScope`); requireRefs(strings(item.locationKeys, `actions.actions[${index}].locationKeys`), locationKeys, 'action location'); requireRefs(strings(item.requirementConditionKeys, `actions.actions[${index}].requirementConditionKeys`), conditionKeys, 'action condition'); requireRefs(strings(item.costEffectKeys, `actions.actions[${index}].costEffectKeys`), effectKeys, 'action cost effect'); requireRefs(strings(item.successEffectKeys, `actions.actions[${index}].successEffectKeys`), effectKeys, 'action success effect'); requireRefs(strings(item.failureEffectKeys, `actions.actions[${index}].failureEffectKeys`), effectKeys, 'action failure effect'); int(item.timeCostMinutes, `actions.actions[${index}].timeCostMinutes`, 0, 1_000_000); enumValue(item.confirmationPolicy, ['never', 'high-risk', 'always'], `actions.actions[${index}].confirmationPolicy`); const repeatPolicy = enumValue(item.repeatPolicy, ['once', 'repeatable', 'cooldown'], `actions.actions[${index}].repeatPolicy`); const cooldown = item.cooldownMinutes == null ? null : int(item.cooldownMinutes, `actions.actions[${index}].cooldownMinutes`, 1, 1_000_000); if ((repeatPolicy === 'cooldown') !== (cooldown != null)) fail(`actions.actions[${index}] cooldown策略不一致`) })
  if (!governedQuestLifecycleActionModule && actionRows.some(action => action.category === 'restart-quest')) {
    fail('restart-quest需要Action v16')
  }

  if (inputBindingActionModule) {
    const bindings = row(actions.inputBindings, 'actions.inputBindings')
    exact(bindings, ['sourceActionBindingsHash', 'actions', 'unmatchedNaturalLanguage', 'thresholds', 'governance'], 'actions.inputBindings')
    if (typeof bindings.sourceActionBindingsHash !== 'string' || !SHA256.test(bindings.sourceActionBindingsHash)) fail('actions.inputBindings.sourceActionBindingsHash无效')
    const bindingRows = catalog(bindings.actions, 'actions.inputBindings.actions', [
      'key', 'order', 'actionKey', 'actionDefinitionHash', 'actorScope', 'category', 'targetScope',
      'systemAction', 'fixedChoiceKeys', 'naturalLanguage', 'resultAuthority',
    ])
    keysOf(bindingRows, 'actions.inputBindings.actions')
    const bindingActionKeys = bindingRows.map((binding, index) => key(binding.actionKey, `actions.inputBindings.actions[${index}].actionKey`))
    if (new Set(bindingActionKeys).size !== bindingActionKeys.length) fail('actions.inputBindings.actions.actionKey不能重复')
    requireSameKeys(bindingActionKeys, [...actionKeys], 'Action input binding coverage')
    const orders = bindingRows.map((binding, index) => int(binding.order, `actions.inputBindings.actions[${index}].order`, 1, 1_000_000))
    if (new Set(orders).size !== orders.length) fail('actions.inputBindings.actions.order不能重复')
    const combatCategories = new Set<TextOpenWorldActionCategoryV1>([
      'start-combat', 'continue-combat', 'combat-state-action', 'combat-reward-action',
      'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'escape',
    ])
    const normalizedExamples = new Set<string>()
    bindingRows.forEach((binding, index) => {
      const label = `actions.inputBindings.actions[${index}]`
      const actionKey = key(binding.actionKey, `${label}.actionKey`)
      const action = actionRows.find(candidate => candidate.key === actionKey) ?? fail(`${label}引用未知Action`)
      if (typeof binding.actionDefinitionHash !== 'string' || !SHA256.test(binding.actionDefinitionHash)) fail(`${label}.actionDefinitionHash无效`)
      if (enumValue(binding.actorScope, ['player', 'system'], `${label}.actorScope`) !== action.actorScope
        || enumValue(binding.category, ACTION_CATEGORIES, `${label}.category`) !== action.category
        || enumValue(binding.targetScope, ['none', 'actor', 'location', 'item', 'quest', 'vendor', 'encounter', 'combatant', 'recipe'], `${label}.targetScope`) !== action.targetScope) {
        fail(`${label}没有精确绑定Action范围`)
      }
      const systemAction = row(binding.systemAction, `${label}.systemAction`)
      exact(systemAction, ['enabled', 'label', 'description', 'executionSource'], `${label}.systemAction`)
      const systemEnabled = bool(systemAction.enabled, `${label}.systemAction.enabled`)
      if (systemEnabled !== (action.actorScope === 'player') || systemAction.executionSource !== 'system-action'
        || text(systemAction.label, `${label}.systemAction.label`, 2_000) !== action.label
        || text(systemAction.description, `${label}.systemAction.description`) !== action.description) fail(`${label}.systemAction没有复用同一Action`)
      const bindingChoiceKeys = strings(binding.fixedChoiceKeys, `${label}.fixedChoiceKeys`)
      requireRefs(bindingChoiceKeys, choiceKeys, `${label}.fixedChoiceKeys`)
      requireSameKeys(bindingChoiceKeys, fixedChoices.filter(choice => choice.actionKey === actionKey).map(choice => String(choice.key)), `${label} fixed choices`)
      const naturalLanguage = row(binding.naturalLanguage, `${label}.naturalLanguage`)
      exact(naturalLanguage, [
        'mode', 'exampleUtterances', 'candidateMayOnlySelectThisAction', 'targetResolution', 'highConfidenceLowRisk',
        'highRiskOrIrreversible', 'lowConfidence', 'mayCreateAction', 'mayCreateQuest', 'mayCreateMapContent', 'mayWriteState',
      ], `${label}.naturalLanguage`)
      const mode = enumValue(naturalLanguage.mode, ['existing-action-candidate', 'disabled-system-only', 'disabled-combat-button-only'], `${label}.naturalLanguage.mode`)
      const expectedMode = action.actorScope === 'system' ? 'disabled-system-only'
        : combatCategories.has(action.category as TextOpenWorldActionCategoryV1) ? 'disabled-combat-button-only' : 'existing-action-candidate'
      if (mode !== expectedMode) fail(`${label}.naturalLanguage.mode与Action边界不一致`)
      const examples = strings(naturalLanguage.exampleUtterances, `${label}.naturalLanguage.exampleUtterances`, 'text')
      if ((mode === 'existing-action-candidate' && examples.length !== 2) || (mode !== 'existing-action-candidate' && examples.length !== 0)) fail(`${label}.naturalLanguage示例数量无效`)
      examples.forEach(example => {
        const normalized = example.toLocaleLowerCase('zh-CN')
        if (normalizedExamples.has(normalized)) fail(`自然语言示例存在跨Action歧义重复:${example}`)
        normalizedExamples.add(normalized)
      })
      if (naturalLanguage.candidateMayOnlySelectThisAction !== true
        || naturalLanguage.targetResolution !== 'current-projection-valid-targets-only'
        || naturalLanguage.highConfidenceLowRisk !== 'execute-after-runtime-validation'
        || naturalLanguage.highRiskOrIrreversible !== 'require-explicit-confirmation'
        || naturalLanguage.lowConfidence !== 'respond-and-recommend-formal-actions'
        || naturalLanguage.mayCreateAction !== false || naturalLanguage.mayCreateQuest !== false
        || naturalLanguage.mayCreateMapContent !== false || naturalLanguage.mayWriteState !== false) fail(`${label}.naturalLanguage越过首版自由演绎边界`)
      const authority = row(binding.resultAuthority, `${label}.resultAuthority`)
      exact(authority, ['artifactKey', 'collection', 'actionKey', 'actionDefinitionHash'], `${label}.resultAuthority`)
      if (authority.artifactKey !== 'text-open-world.quest-design-documents' || authority.collection !== 'actions'
        || authority.actionKey !== actionKey || authority.actionDefinitionHash !== binding.actionDefinitionHash) fail(`${label}.resultAuthority没有指向同一Action`)
    })
    const unmatched = row(bindings.unmatchedNaturalLanguage, 'actions.inputBindings.unmatchedNaturalLanguage')
    exact(unmatched, ['policy', 'impossibleActionPolicy', 'customSolutionPolicy', 'stateMutationAllowed'], 'actions.inputBindings.unmatchedNaturalLanguage')
    if (unmatched.policy !== 'natural-response-then-formal-action-redirect'
      || unmatched.impossibleActionPolicy !== 'explicit-decline-with-in-world-alternative'
      || unmatched.customSolutionPolicy !== 'future-extension-disabled' || unmatched.stateMutationAllowed !== false) fail('actions.inputBindings.unmatchedNaturalLanguage越过首版边界')
    const thresholds = row(bindings.thresholds, 'actions.inputBindings.thresholds')
    exact(thresholds, ['directExecutionMinimumConfidence', 'recommendationMinimumConfidence'], 'actions.inputBindings.thresholds')
    if (thresholds.directExecutionMinimumConfidence !== 0.9 || thresholds.recommendationMinimumConfidence !== 0.55) fail('actions.inputBindings.thresholds必须使用已批准阈值')
    const governance = row(bindings.governance, 'actions.inputBindings.governance')
    exact(governance, [
      'singleResultSource', 'allThreeInputsUseActionRegistry', 'modelCannotCreateActionOrResult', 'combatFreeTextDisabled',
      'lowConfidenceNeverExecutes', 'irreversibleActionsRequireConfirmation', 'runtimeProjectionValidationRequired',
    ], 'actions.inputBindings.governance')
    Object.entries(governance).forEach(([field, value]) => { if (value !== true) fail(`actions.inputBindings.governance.${field}必须为true`) })
  }

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

  if (actorScheduleActionModule) {
    const scheduleActions = actionRows.filter(action => action.category === 'actor-schedule-action')
    if (scheduleActions.length !== 1) fail('Action v6必须且只能定义一个角色日程结算Action')
    const action = scheduleActions[0]
    const successEffectKeys = strings(action.successEffectKeys, 'actor schedule action.successEffectKeys')
    const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (action.actorScope !== 'system' || action.targetScope !== 'none'
      || strings(action.locationKeys, 'actor schedule action.locationKeys').length
      || strings(action.requirementConditionKeys, 'actor schedule action.requirementConditionKeys').length
      || strings(action.costEffectKeys, 'actor schedule action.costEffectKeys').length
      || strings(action.failureEffectKeys, 'actor schedule action.failureEffectKeys').length
      || successEffects.length !== 1 || successEffects[0].operation !== 'settle-actor-schedules'
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('角色日程结算Action合同无效')
    const scheduleEffects = effects.filter(effect => effect.operation === 'settle-actor-schedules')
    if (scheduleEffects.length !== 1 || scheduleEffects[0].key !== successEffects[0].key) fail('角色日程结算Effect必须且只能属于角色日程结算Action')
    exact(row(scheduleEffects[0].payload, 'actor schedule effect.payload'), [], 'actor schedule effect.payload')
    actionRows.filter(candidate => candidate.key !== action.key).forEach(candidate => {
      const referenced = [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failures`)]
      if (referenced.includes(String(successEffects[0].key))) fail(`settle-actor-schedules只能由角色日程结算Action引用:${String(candidate.key)}`)
    })
  }

  if (actorLifecycleActionModule) {
    const lifecycleEffects = effects.filter(effect => effect.operation === 'change-actor-state')
    lifecycleEffects.forEach(effect => {
      const payload = row(effect.payload, `actor lifecycle effect ${String(effect.key)}.payload`)
      exact(payload, ['actorKey', 'alive', 'present', 'locationKey', 'cause'], `actor lifecycle effect ${String(effect.key)}.payload`)
      const actorKey = key(payload.actorKey, `actor lifecycle effect ${String(effect.key)}.actorKey`)
      requireRef(actorKey, actorKeys, 'actor lifecycle effect actor')
      if (payload.alive !== null) bool(payload.alive, `actor lifecycle effect ${String(effect.key)}.alive`)
      if (payload.present !== null) bool(payload.present, `actor lifecycle effect ${String(effect.key)}.present`)
      requireRef(nullableKey(payload.locationKey, `actor lifecycle effect ${String(effect.key)}.locationKey`), locationKeys, 'actor lifecycle effect location')
      const cause = enumValue(payload.cause, ['player-attack', 'story', 'random-event', 'resolution'], `actor lifecycle effect ${String(effect.key)}.cause`)
      const definition = actorRows.find(actor => actor.key === actorKey)!
      if (payload.alive === false) {
        if (definition.mortalityPolicy === 'protected') fail(`受保护Actor不能配置死亡Effect:${actorKey}`)
        if (definition.mortalityPolicy === 'story-only' && cause !== 'story') fail(`story-only Actor只能配置正式剧情死亡Effect:${actorKey}`)
        if (definition.mortalityPolicy === 'despawn-on-resolution') fail(`临时Actor不能配置死亡Effect:${actorKey}`)
        if (definition.mortalityPolicy === 'mortal' && cause === 'resolution') fail(`mortal Actor不能以事件退场原因写入死亡:${actorKey}`)
      }
      if (payload.alive !== false && payload.present === false) {
        if (definition.mortalityPolicy === 'protected') fail(`受保护Actor不能配置退场Effect:${actorKey}`)
        if (definition.mortalityPolicy === 'despawn-on-resolution' && cause !== 'resolution') fail(`临时Actor只能配置事件解决退场Effect:${actorKey}`)
        if (definition.mortalityPolicy !== 'despawn-on-resolution' && !['story', 'random-event'].includes(cause)) fail(`常驻Actor退场Effect原因无效:${actorKey}`)
      }
    })
    actionRows.forEach(action => {
      const referencedEffectKeys = [
        ...strings(action.costEffectKeys, `action ${String(action.key)} costs`),
        ...strings(action.successEffectKeys, `action ${String(action.key)} success`),
        ...strings(action.failureEffectKeys, `action ${String(action.key)} failures`),
      ]
      const referenced = referencedEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const lifecycle = referenced.filter(effect => effect.operation === 'change-actor-state')
      if (!lifecycle.length) {
        if (action.category === 'attack-actor' || action.category === 'actor-state-action') fail(`角色状态Action缺少change-actor-state Effect:${String(action.key)}`)
        return
      }
      if (lifecycle.length !== 1 || referenced.length !== 1 || !strings(action.successEffectKeys, `action ${String(action.key)} success`).includes(String(lifecycle[0].key))) {
        fail(`角色状态Action必须只在成功分支绑定唯一change-actor-state Effect:${String(action.key)}`)
      }
      const payload = row(lifecycle[0].payload, `action ${String(action.key)} actor state payload`)
      const actorKey = key(payload.actorKey, `action ${String(action.key)} actorKey`)
      const definition = actorRows.find(actor => actor.key === actorKey)!
      if (payload.cause === 'player-attack') {
        if (action.category !== 'attack-actor' || action.actorScope !== 'player' || action.targetScope !== 'actor'
          || action.confirmationPolicy !== 'always' || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null
          || definition.mortalityPolicy !== 'mortal' || payload.alive !== false) fail(`玩家攻击Actor Action合同无效:${String(action.key)}`)
      } else if (action.category !== 'actor-state-action' || action.actorScope !== 'system' || action.targetScope !== 'actor'
        || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) {
        fail(`剧情或事件Actor状态Action合同无效:${String(action.key)}`)
      }
    })
  }

  const quests = versioned(packageValue, 'quests', [1, 2])
  exact(quests, ['version', 'quests', 'stages', 'objectives'], 'quests')
  const legacyQuestModule = quests.version === 1
  if (governedQuestLifecycleActionModule && legacyQuestModule) fail('Action v16必须搭配Quest v2')
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
    if (governedQuestLifecycleActionModule && policy === 'abandon-restart'
      && (type !== 'ordinary' || timePolicy !== 'waits' || instantiationPolicy !== 'session-start')) {
      fail(`${label} Action v16只允许不限时固定普通任务重接`)
    }
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
  if (authoredNarrativeModule) {
    scenes.forEach((item, index) => {
      const label = `narrative.scenes[${index}]`
      const regionKey = key(item.regionKey, `${label}.regionKey`)
      const locationKey = key(item.locationKey, `${label}.locationKey`)
      requireRef(regionKey, regionKeys, `${label}.regionKey`)
      if (normalizedWorld.locations.find(location => location.key === locationKey)?.regionKey !== regionKey) fail(`${label}.regionKey与locationKey不一致`)
      const questKey = nullableKey(item.questKey, `${label}.questKey`)
      const stageKey = nullableKey(item.stageKey, `${label}.stageKey`)
      const objectiveKey = nullableKey(item.objectiveKey, `${label}.objectiveKey`)
      const actorKey = nullableKey(item.actorKey, `${label}.actorKey`)
      requireRef(questKey, questKeys, `${label}.questKey`); requireRef(stageKey, questStageKeys, `${label}.stageKey`)
      requireRef(objectiveKey, objectiveKeys, `${label}.objectiveKey`); requireRef(actorKey, actorKeys, `${label}.actorKey`)
      if (stageKey && questStages.find(stage => stage.key === stageKey)?.questKey !== questKey) fail(`${label}.stageKey不属于questKey`)
      if (objectiveKey && objectives.find(objective => objective.key === objectiveKey)?.stageKey !== stageKey) fail(`${label}.objectiveKey不属于stageKey`)
      if (actorKey && !strings(item.participantKeys, `${label}.participantKeys`).includes(actorKey)) fail(`${label}.actorKey必须进入participantKeys`)
      requireRefs(strings(item.forbiddenFutureObjectiveKeys, `${label}.forbiddenFutureObjectiveKeys`), objectiveKeys, `${label}.forbiddenFutureObjectiveKeys`)
      requireRefs(strings(item.availabilityConditionKeys, `${label}.availabilityConditionKeys`), conditionKeys, `${label}.availabilityConditionKeys`)
      requireSameKeys(
        strings(item.actionKeys, `${label}.actionKeys`),
        fixedChoices.filter(choice => choice.sceneKey === item.key).map(choice => String(choice.actionKey)),
        `${label} Action/Choice result source`,
      )
    })
    questRows.forEach(quest => {
      for (const sourceKind of ['quest-offer', 'quest-resolution'] as const) {
        if (scenes.filter(scene => scene.sourceKind === sourceKind && scene.questKey === quest.key).length !== 1) fail(`每个任务必须且只能有一个${sourceKind}场景:${String(quest.key)}`)
      }
    })
    objectives.forEach(objective => {
      if (scenes.filter(scene => scene.sourceKind === 'quest-objective' && scene.objectiveKey === objective.key).length !== 1) fail(`每个任务目标必须且只能有一个场景:${String(objective.key)}`)
    })
    actorRows.forEach(actor => {
      if (scenes.filter(scene => scene.sourceKind === 'actor-dialogue' && scene.actorKey === actor.key).length !== 1) fail(`每个Actor必须且只能有一个对话入口场景:${String(actor.key)}`)
    })
  }
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
  actionRows.filter(action => ['accept-quest', 'restart-quest', 'abandon-quest'].includes(String(action.category))).forEach(action => {
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
      const orderedStages = strings(definition.stageKeys, `${label}.definition.stageKeys`)
        .map(stageKey => questStages.find(stage => stage.key === stageKey)!)
        .sort((left, right) => Number(left.order) - Number(right.order))
      if (transitionPayloads.length !== 2 || transitionPayloads[0].status !== 'accepted' || transitionPayloads[0].stageKey != null
        || transitionPayloads[1].status !== 'active' || !strings(definition.stageKeys, `${label}.definition.stageKeys`).includes(String(transitionPayloads[1].stageKey))
        || (governedQuestLifecycleActionModule && transitionPayloads[1].stageKey !== orderedStages[0]?.key)) fail(`${label}必须依次accept并激活第一Stage`)
    } else if (action.category === 'restart-quest') {
      const orderedStages = strings(definition.stageKeys, `${label}.definition.stageKeys`)
        .map(stageKey => questStages.find(stage => stage.key === stageKey)!)
        .sort((left, right) => Number(left.order) - Number(right.order))
      const expected = [
        { status: 'available', stageKey: null }, { status: 'revealed', stageKey: null },
        { status: 'accepted', stageKey: null }, { status: 'active', stageKey: orderedStages[0]?.key ?? null },
      ]
      if (!governedQuestLifecycleActionModule
        || definition.type !== 'ordinary' || definition.lifecyclePolicy !== 'abandon-restart'
        || definition.timePolicy !== 'waits' || definition.instantiationPolicy !== 'session-start'
        || definition.initialStatus !== 'available'
        || canonicalProductProductionJsonV2(transitionPayloads.map(payload => ({ status: payload.status, stageKey: payload.stageKey })))
          !== canonicalProductProductionJsonV2(expected)) fail(`${label}必须原子重启不限时固定普通任务`)
    } else if (transitionPayloads.length !== 1 || transitionPayloads[0].status !== 'abandoned'
      || (transitionPayloads[0].stageKey != null
        && !strings(definition.stageKeys, `${label}.definition.stageKeys`).includes(String(transitionPayloads[0].stageKey)))
      || (transitionPayloads[0].stageKey == null && !governedQuestLifecycleActionModule)
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
    if (!['accept-quest', 'restart-quest', 'abandon-quest', 'quest-action'].includes(category)) fail(`任务迁移Effect只能由任务生命周期Action引用:${String(action.key)}`)
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
  if (governedQuestLifecycleActionModule && !legacyQuestModule) {
    const transitionPayloads = (action: Row) => strings(action.successEffectKeys, `lifecycle action ${String(action.key)} effects`)
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'transition-quest')
      .map(effect => row(effect.payload, `lifecycle action ${String(action.key)} payload`))
    questRows.filter(quest => quest.lifecyclePolicy !== 'protected-wait').forEach(quest => {
      const questKey = String(quest.key)
      const stageCoverage = actionRows.filter(action => action.category === 'abandon-quest')
        .flatMap(action => transitionPayloads(action))
        .filter(payload => payload.questKey === questKey && payload.status === 'abandoned')
        .map(payload => String(payload.stageKey ?? '__unstarted__'))
      requireSameKeys(stageCoverage, ['__unstarted__', ...strings(quest.stageKeys, `quest ${questKey} abandon stages`)], `可放弃任务${questKey} Stage覆盖`)
    })
    const restartableQuests = questRows.filter(quest => quest.type === 'ordinary'
      && quest.lifecyclePolicy === 'abandon-restart' && quest.timePolicy === 'waits'
      && quest.instantiationPolicy === 'session-start')
    const restartActions = actionRows.filter(action => action.category === 'restart-quest')
    requireSameKeys(
      restartActions.map(action => String(action.key)),
      restartableQuests.map(quest => `action.restart.${String(quest.key)}`),
      '可重接普通任务Action覆盖',
    )
    restartableQuests.forEach(quest => {
      const actionKey = `action.restart.${String(quest.key)}`
      const action = restartActions.find(candidate => candidate.key === actionKey)!
      const offerScene = scenes.find(scene => scene.sourceKind === 'quest-offer' && scene.questKey === quest.key)
        ?? fail(`可重接任务缺少原发布场景:${String(quest.key)}`)
      if (!strings(offerScene.actionKeys, `restart scene ${String(offerScene.key)} actions`).includes(actionKey)) {
        fail(`重接Action必须精确绑定原发布场景与地点:${String(quest.key)}`)
      }
      requireSameKeys(strings(action.locationKeys, `restart action ${actionKey} locations`), [String(offerScene.locationKey)], `重接Action ${actionKey} 原发布地点`)
    })
  }
  if (protectedStoryRevealActionModule && !legacyQuestModule) {
    const protectedQuests = questRows.filter(quest => (
      (quest.type === 'mainline' || quest.type === 'significant')
      && quest.lifecyclePolicy === 'protected-wait'
      && quest.timePolicy === 'waits'
      && quest.instantiationPolicy === 'session-start'
    ))
    const stageForQuest = (quest: Row): Row => {
      const matches = narrativeStages.filter(stage => (
        stage.storylineKey === quest.storylineKey
        && strings(stage.questKeys, `narrative stage ${String(stage.key)} questKeys`).includes(String(quest.key))
      ))
      if (matches.length !== 1) fail(`Action v18受保护任务必须唯一绑定叙事Stage:${String(quest.key)}`)
      return matches[0]!
    }
    const orderedStoryQuests = (storylineKey: string) => protectedQuests
      .filter(quest => quest.storylineKey === storylineKey)
      .sort((left, right) => Number(stageForQuest(left).order) - Number(stageForQuest(right).order)
        || String(left.key).localeCompare(String(right.key)))
    const mainlineKey = String(mainline.key)
    const mainlineQuests = orderedStoryQuests(mainlineKey)
    if (!mainlineQuests.length || mainlineQuests[0]!.initialStatus !== 'revealed'
      || strings(mainlineQuests[0]!.prerequisiteConditionKeys, `quest ${String(mainlineQuests[0]!.key)} prerequisites`).length
      || mainlineQuests.slice(1).some(quest => quest.initialStatus !== 'locked')
      || protectedQuests.filter(quest => quest.type === 'mainline').some(quest => quest.storylineKey !== mainlineKey)
      || protectedQuests.filter(quest => quest.type === 'significant').some(quest => quest.initialStatus !== 'locked')) {
      fail('Action v18受保护故事初始状态或主线顺序无效')
    }
    const expectedRevealQuests = protectedQuests.filter(quest => quest.initialStatus === 'locked')
    const transitionRowsFor = (action: Row) => strings(action.successEffectKeys, `reveal action ${String(action.key)} effects`)
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'transition-quest')
    const revealTransitionActions = actionRows.filter(action => {
      if (action.category !== 'quest-action' || action.actorScope !== 'system') return false
      return transitionRowsFor(action).some(effect => {
        const payload = row(effect.payload, `reveal transition ${String(effect.key)} payload`)
        return payload.status === 'available' || payload.status === 'revealed'
      })
    })
    requireSameKeys(
      revealTransitionActions.map(action => String(action.key)),
      expectedRevealQuests.map(quest => `action.reveal.${String(quest.key)}`),
      'Action v18受保护故事揭示Action覆盖',
    )
    expectedRevealQuests.forEach(quest => {
      const questKey = String(quest.key)
      const actionKey = `action.reveal.${questKey}`
      const action = revealTransitionActions.find(candidate => candidate.key === actionKey)
        ?? fail(`Action v18缺少受保护故事揭示Action:${questKey}`)
      const prerequisiteKeys = strings(quest.prerequisiteConditionKeys, `quest ${questKey} prerequisites`)
      const condition = prerequisiteKeys.length === 1
        ? conditions.find(candidate => candidate.key === prerequisiteKeys[0])
        : null
      const expression = condition ? row(condition.expression, `quest ${questKey} unlock expression`) : null
      if (prerequisiteKeys[0] !== `condition.unlock.${questKey}`
        || !expression || expression.op !== 'quest-status'
        || canonicalProductProductionJsonV2(expression.statuses) !== canonicalProductProductionJsonV2(['completed'])) {
        fail(`Action v18受保护任务必须由唯一已完成任务解锁:${questKey}`)
      }
      const sourceQuestKey = String(expression.questKey)
      const storyQuests = orderedStoryQuests(String(quest.storylineKey))
      const index = storyQuests.findIndex(candidate => candidate.key === quest.key)
      const expectedPrevious = index > 0 ? String(storyQuests[index - 1]!.key) : null
      if (quest.type === 'mainline') {
        if (!expectedPrevious || sourceQuestKey !== expectedPrevious) {
          fail(`Action v18后续主线必须由紧邻前序主线解锁:${questKey}`)
        }
      } else if (expectedPrevious ? sourceQuestKey !== expectedPrevious : !mainlineQuests.some(candidate => candidate.key === sourceQuestKey)) {
        fail(`Action v18重要故事必须由同线前序或主线窗口解锁:${questKey}`)
      }
      const expectedEffectKeys = [`effect.unlock.${questKey}`, `effect.reveal.${questKey}`]
      const transitionEffects = transitionRowsFor(action)
      const normalizedTransitions = transitionEffects.map(effect => ({
        key: String(effect.key),
        operation: String(effect.operation),
        payload: row(effect.payload, `reveal effect ${String(effect.key)} payload`),
      }))
      if (action.targetScope !== 'quest'
        || strings(action.locationKeys, `${actionKey}.locationKeys`).length
        || canonicalProductProductionJsonV2(strings(action.requirementConditionKeys, `${actionKey}.requirements`))
          !== canonicalProductProductionJsonV2(prerequisiteKeys)
        || strings(action.costEffectKeys, `${actionKey}.costs`).length
        || strings(action.failureEffectKeys, `${actionKey}.failures`).length
        || canonicalProductProductionJsonV2(strings(action.successEffectKeys, `${actionKey}.success`))
          !== canonicalProductProductionJsonV2(expectedEffectKeys)
        || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
        || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null
        || canonicalProductProductionJsonV2(normalizedTransitions) !== canonicalProductProductionJsonV2([
          { key: expectedEffectKeys[0], operation: 'transition-quest', payload: { questKey, status: 'available', stageKey: null } },
          { key: expectedEffectKeys[1], operation: 'transition-quest', payload: { questKey, status: 'revealed', stageKey: null } },
        ])) {
        fail(`Action v18受保护故事揭示合同无效:${questKey}`)
      }
    })
  }

  const progression = versioned(packageValue, 'progression', [1, 2])
  const structuredProgressionModule = progression.version === 2
  exact(progression, ['version', 'rules', 'levels', 'skills', 'statuses'], 'progression')
  const progressionRules = row(progression.rules, 'progression.rules'); exact(progressionRules, ['maximumLevel', 'automaticAttributeGrowth', 'levelUp', 'attributes', 'formulas'], 'progression.rules'); const maximumLevel = int(progressionRules.maximumLevel, 'progression.rules.maximumLevel', 1, 20); if (maximumLevel !== 20) fail('首版maximumLevel必须为20'); if (progressionRules.automaticAttributeGrowth !== true) fail('首版必须自动属性成长')
  const levelUp = row(progressionRules.levelUp, 'progression.rules.levelUp'); exact(levelUp, ['resourcePolicy', 'maximumLevelExperiencePolicy'], 'progression.rules.levelUp'); if (levelUp.resourcePolicy !== 'increase-by-cap-delta' || levelUp.maximumLevelExperiencePolicy !== 'cap-at-threshold') fail('progression.rules.levelUp不符合首版冻结策略')
  const attributeLabels = row(progressionRules.attributes, 'progression.rules.attributes'); exact(attributeLabels, ['power', 'vitality', 'agility'], 'progression.rules.attributes'); ['power', 'vitality', 'agility'].forEach(field => { const entry = row(attributeLabels[field], `progression.rules.attributes.${field}`); exact(entry, ['label'], `progression.rules.attributes.${field}`); text(entry.label, `progression.rules.attributes.${field}.label`, 100) })
  const formulas = row(progressionRules.formulas, 'progression.rules.formulas'); const formulaKeys = ['baseHealth', 'healthPerVitality', 'healthPerLevel', 'attackPerPower', 'defensePerVitality', 'baseCriticalChance', 'criticalChancePerAgility', 'criticalChanceCap', 'initiativePerAgility', 'baseSkillResource', 'skillResourcePerLevel']; exact(formulas, formulaKeys, 'progression.rules.formulas'); formulaKeys.forEach(field => numberValue(formulas[field], `progression.rules.formulas.${field}`, 0, 1_000_000))
  const baseCriticalChance = numberValue(formulas.baseCriticalChance, 'progression.rules.formulas.baseCriticalChance', 0, 1)
  numberValue(formulas.criticalChancePerAgility, 'progression.rules.formulas.criticalChancePerAgility', 0, 1)
  const criticalChanceCap = numberValue(formulas.criticalChanceCap, 'progression.rules.formulas.criticalChanceCap', 0, 1)
  if (baseCriticalChance > criticalChanceCap) fail('baseCriticalChance不能大于criticalChanceCap')
  const levels = catalog(progression.levels, 'progression.levels', ['level', 'cumulativeExperience', 'attributeGrowth', 'unlockedSkillKeys'])
  const rawSkills = catalog(progression.skills, 'progression.skills', structuredProgressionModule
    ? ['key', 'title', 'description', 'tags', 'mechanic', 'target', 'scalingAttribute', 'unlockSources', 'useConditionKeys', 'priority', 'resourceCost', 'cooldownTurns', 'effectKeys']
    : ['key', 'title', 'description', 'tags', 'activation', 'kind', 'target', 'scalingAttribute', 'unlockSources', 'useConditionKeys', 'priority', 'resourceCost', 'cooldownTurns', 'effectKeys'])
  const statuses = catalog(progression.statuses, 'progression.statuses', structuredProgressionModule
    ? ['key', 'title', 'description', 'polarity', 'duration', 'reapplyPolicy', 'maxStacks', 'modifiers']
    : ['key', 'title', 'description', 'polarity'])
  const skills = rawSkills.map((item, index) => {
    if (!structuredProgressionModule) return item
    const mechanic = row(item.mechanic, `progression.skills[${index}].mechanic`)
    const mechanicKind = enumValue(mechanic.kind, ['attack', 'recovery', 'resource', 'status', 'passive-static'], `progression.skills[${index}].mechanic.kind`)
    if (mechanicKind === 'attack') exact(mechanic, ['kind'], `progression.skills[${index}].mechanic`)
    if (mechanicKind === 'recovery' || mechanicKind === 'resource') {
      exact(mechanic, ['kind', 'baseAmount', 'scalingNumerator', 'scalingDenominator'], `progression.skills[${index}].mechanic`)
      int(mechanic.baseAmount, `progression.skills[${index}].mechanic.baseAmount`, 0, 1_000_000_000)
      int(mechanic.scalingNumerator, `progression.skills[${index}].mechanic.scalingNumerator`, 0, 100)
      int(mechanic.scalingDenominator, `progression.skills[${index}].mechanic.scalingDenominator`, 1, 100)
    }
    if (mechanicKind === 'status') {
      exact(mechanic, ['kind', 'statusKey'], `progression.skills[${index}].mechanic`)
      key(mechanic.statusKey, `progression.skills[${index}].mechanic.statusKey`)
    }
    if (mechanicKind === 'passive-static') {
      exact(mechanic, ['kind', 'modifiers'], `progression.skills[${index}].mechanic`)
      if (!combatModifiers(mechanic.modifiers, `progression.skills[${index}].mechanic.modifiers`).length) {
        fail(`progression.skills[${index}]被动技能必须至少提供一个静态修正`)
      }
    }
    return {
      ...structuredClone(item),
      mechanic: structuredClone(mechanic),
      activation: mechanicKind === 'passive-static' ? 'passive' : 'active',
      kind: mechanicKind === 'passive-static' ? 'status' : mechanicKind,
    }
  })
  const skillKeys = keysOf(skills, 'progression.skills'); const statusKeys = keysOf(statuses, 'progression.statuses')
  if (levels.length !== maximumLevel) fail('progression.levels必须覆盖1到maximumLevel')
  let previousExperience = -1
  levels.forEach((item, index) => { if (int(item.level, `progression.levels[${index}].level`, 1, maximumLevel) !== index + 1) fail('progression.levels必须连续有序'); const experience = int(item.cumulativeExperience, `progression.levels[${index}].cumulativeExperience`, 0, 1_000_000_000); if (experience <= previousExperience && index > 0) fail('累计经验必须递增'); previousExperience = experience; const growth = row(item.attributeGrowth, `progression.levels[${index}].attributeGrowth`); exact(growth, ['power', 'vitality', 'agility'], `progression.levels[${index}].attributeGrowth`); ['power', 'vitality', 'agility'].forEach(field => int(growth[field], `progression.levels[${index}].attributeGrowth.${field}`, 0, 10_000)); strings(item.unlockedSkillKeys, `progression.levels[${index}].unlockedSkillKeys`) })
  if (Number(levels[0].cumulativeExperience) !== 0 || canonicalProductProductionJsonV2(levels[0].attributeGrowth) !== canonicalProductProductionJsonV2({ power: 0, vitality: 0, agility: 0 })) fail('1级必须从0经验和零成长增量开始')
  skills.forEach((item, index) => {
    text(item.title, `progression.skills[${index}].title`, 2_000); text(item.description, `progression.skills[${index}].description`); strings(item.tags, `progression.skills[${index}].tags`, 'text')
    const activation = enumValue(item.activation, ['active', 'passive'], `progression.skills[${index}].activation`)
    const kind = enumValue(item.kind, ['attack', 'status', 'resource', 'recovery'], `progression.skills[${index}].kind`)
    const target = enumValue(item.target, ['self', 'single-enemy', 'all-enemies'], `progression.skills[${index}].target`)
    if (activation === 'active' && kind === 'attack' && target === 'self') fail(`progression.skills[${index}]主动攻击技能不能以自身为目标`)
    if (item.scalingAttribute != null) enumValue(item.scalingAttribute, ['power', 'vitality', 'agility'], `progression.skills[${index}].scalingAttribute`)
    if (scaledCombatActionModule && activation === 'active' && kind === 'attack' && item.scalingAttribute == null) {
      fail(`progression.skills[${index}] Action v17主动攻击技能必须声明scalingAttribute`)
    }
    if (structuredProgressionModule) {
      const mechanic = row(item.mechanic, `progression.skills[${index}].mechanic`)
      const mechanicKind = String(mechanic.kind)
      const numericMechanic = ['attack', 'recovery', 'resource'].includes(mechanicKind)
      if (numericMechanic !== (item.scalingAttribute != null)) fail(`progression.skills[${index}]数值机制必须且只能声明scalingAttribute`)
      if (mechanicKind === 'attack' && target === 'self') fail(`progression.skills[${index}]攻击机制不能以自身为目标`)
      if ((mechanicKind === 'recovery' || mechanicKind === 'resource' || mechanicKind === 'passive-static') && target !== 'self') {
        fail(`progression.skills[${index}]恢复、资源与被动机制只能以自身为目标`)
      }
      if (strings(item.effectKeys, `progression.skills[${index}].effectKeys`).length) {
        fail(`progression.skills[${index}] v2机制不能再通过effectKeys重复声明结果`)
      }
      if (mechanicKind === 'status') requireRef(key(mechanic.statusKey, `progression.skills[${index}].mechanic.statusKey`), statusKeys, 'status mechanic')
    }
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
  statuses.forEach((item, index) => {
    text(item.title, `progression.statuses[${index}].title`, 2_000); text(item.description, `progression.statuses[${index}].description`); enumValue(item.polarity, ['beneficial', 'harmful', 'neutral'], `progression.statuses[${index}].polarity`)
    if (!structuredProgressionModule) return
    const duration = row(item.duration, `progression.statuses[${index}].duration`)
    const clock = enumValue(duration.clock, ['target-turns', 'combat'], `progression.statuses[${index}].duration.clock`)
    exact(duration, clock === 'target-turns' ? ['clock', 'turns'] : ['clock'], `progression.statuses[${index}].duration`)
    if (clock === 'target-turns') int(duration.turns, `progression.statuses[${index}].duration.turns`, 1, 10_000)
    const reapplyPolicy = enumValue(item.reapplyPolicy, ['reject', 'refresh', 'stack'], `progression.statuses[${index}].reapplyPolicy`)
    const maxStacks = int(item.maxStacks, `progression.statuses[${index}].maxStacks`, 1, 100)
    if ((reapplyPolicy === 'stack') !== (maxStacks > 1)) fail(`progression.statuses[${index}]只有stack策略可以声明多层`)
    combatModifiers(item.modifiers, `progression.statuses[${index}].modifiers`)
  })
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
    const costEffectKeys = strings(action.costEffectKeys, `item ${String(item.key)} use cost effects`)
    const ownedEffects = [
      ...costEffectKeys,
      ...strings(action.successEffectKeys, `item ${String(item.key)} use success effects`),
      ...strings(action.failureEffectKeys, `item ${String(item.key)} use failure effects`),
    ].map(effectKey => effects.find(effect => effect.key === effectKey)!)
    const removeEffects = costEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'remove-item' && row(effect.payload, `item ${String(item.key)} remove payload`).reason === 'consume')
    const allRemoveEffects = ownedEffects
      .filter(effect => effect.operation === 'remove-item' && row(effect.payload, `item ${String(item.key)} owned remove payload`).reason === 'consume')
    const consumePayload = removeEffects.length === 1
      ? row(removeEffects[0].payload, `item ${String(item.key)} consume payload`)
      : null
    if (action.category !== 'use' || action.actorScope !== 'player' || action.targetScope !== 'item'
      || removeEffects.length !== 1 || allRemoveEffects.length !== 1
      || consumePayload?.itemKey !== item.key || consumePayload?.quantity !== 1) {
      fail(`物品${String(item.key)}的useAction必须由玩家固定消费一件自身`)
    }
    requireSameKeys(strings(action.successEffectKeys, `item ${String(item.key)} use success effects`), strings(item.effectKeys, `item ${String(item.key)} effects`), `item ${String(item.key)} use effects`)
  })
  itemRows.filter(item => item.kind === 'equipment').forEach(item => {
    for (const [mode, actionKeyField] of [['equip', 'equipActionKey'], ['unequip', 'unequipActionKey']] as const) {
      const actionKey = key(item[actionKeyField], `item ${String(item.key)} ${mode}ActionKey`)
      const action = actionRows.find(candidate => candidate.key === actionKey) ?? fail(`装备Action不存在:${actionKey}`)
      const successEffects = strings(action.successEffectKeys, `item ${String(item.key)} ${mode} success effects`)
        .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      const equipmentEffects = successEffects.filter(effect => effect.operation === `${mode}-item`)
      if (action.category !== mode || action.actorScope !== 'player' || action.targetScope !== 'item' || strings(action.costEffectKeys, `item ${String(item.key)} ${mode} costs`).length
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
  actionRows.filter(action => action.category === 'drop' || (!economyActionModule && action.category === 'sell')).forEach(action => {
    const reason = action.category === 'drop' ? 'drop' : 'sell'
    const costEffectKeys = strings(action.costEffectKeys, `item action ${String(action.key)} cost effects`)
    const removal = costEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'remove-item' && row(effect.payload, `item action ${String(action.key)} payload`).reason === reason)
    const allRemoval = [
      ...costEffectKeys,
      ...strings(action.successEffectKeys, `item action ${String(action.key)} success effects`),
      ...strings(action.failureEffectKeys, `item action ${String(action.key)} failure effects`),
    ].map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'remove-item'
        && row(effect.payload, `item action ${String(action.key)} owned payload`).reason === reason)
    if (action.targetScope !== 'item' || removal.length !== 1 || allRemoval.length !== 1) fail(`物品Action没有唯一${reason}移除Effect:${String(action.key)}`)
    const removalPayload = row(removal[0].payload, `item action ${String(action.key)} removal`)
    const itemKey = key(removalPayload.itemKey, `item action ${String(action.key)} itemKey`)
    const definition = itemRows.find(item => item.key === itemKey) ?? fail(`物品Action引用不存在:${itemKey}`)
    if ((reason === 'drop' && definition.droppable !== true) || (reason === 'sell' && definition.sellable !== true)) fail(`物品Action违反${reason}保护:${itemKey}`)
    if (reason === 'drop' && (action.actorScope !== 'player' || removalPayload.quantity !== 1
      || action.confirmationPolicy !== 'always')) {
      fail(`丢弃Action必须由玩家固定移除一件并二次确认:${String(action.key)}`)
    }
  })

  const combat = versioned(packageValue, 'combat', [1, 2, 3, 4])
  const legacyCombatModule = combat.version === 1
  const structuredStatusCombatModule = combat.version === 4
  const combatResolutionModule = combat.version === 3 || structuredStatusCombatModule
  if (scaledCombatActionModule !== structuredProgressionModule
    || structuredProgressionModule !== structuredStatusCombatModule) {
    fail('Action v17、Progression v2与Combat v4必须严格三联发布')
  }
  exact(combat, legacyCombatModule
    ? ['version', 'rules', 'enemies', 'encounters']
    : structuredStatusCombatModule
      ? ['version', 'rules', 'difficultyProfiles', 'resolution', 'skillResolutions', 'strategyProfiles', 'enemies', 'encounters']
      : combatResolutionModule
      ? ['version', 'rules', 'difficultyProfiles', 'resolution', 'skillResolutions', 'transientPlayerStatusKeys', 'strategyProfiles', 'enemies', 'encounters']
      : ['version', 'rules', 'difficultyProfiles', 'strategyProfiles', 'enemies', 'encounters'], 'combat')
  if (combatResolutionActionModule !== combatResolutionModule) fail('Action v11与Combat v3必须成对发布')
  const combatRules = row(combat.rules, 'combat.rules'); exact(combatRules, ['difficulty', 'defaultAttackHits', 'playerPartyLimit', 'allowFriendlyNpcCombatants', 'allowElements', 'allowEscape'], 'combat.rules'); if (combatRules.difficulty !== 'standard' || combatRules.defaultAttackHits !== true || combatRules.playerPartyLimit !== 1 || combatRules.allowFriendlyNpcCombatants !== false || combatRules.allowElements !== false || combatRules.allowEscape !== true) fail('combat.rules不符合首版冻结边界')
  const difficultyProfiles = legacyCombatModule ? [{
    key: 'standard', label: '标准', enemyHealthMultiplier: 1, enemyDamageMultiplier: 1, rewardMultiplier: 1,
  }] : catalog(combat.difficultyProfiles, 'combat.difficultyProfiles', [
    'key', 'label', 'enemyHealthMultiplier', 'enemyDamageMultiplier', 'rewardMultiplier',
  ])
  const difficultyProfileKeys = keysOf(difficultyProfiles, 'combat.difficultyProfiles')
  if (difficultyProfiles.length !== 1 || !difficultyProfileKeys.has('standard')) fail('首版必须且只能定义standard难度')
  difficultyProfiles.forEach((item, index) => {
    if (item.key !== 'standard') fail(`combat.difficultyProfiles[${index}].key只能为standard`)
    text(item.label, `combat.difficultyProfiles[${index}].label`, 100)
    if (item.enemyHealthMultiplier !== 1 || item.enemyDamageMultiplier !== 1 || item.rewardMultiplier !== 1) {
      fail('standard难度倍率必须固定为1')
    }
  })
  const resolution = combatResolutionModule ? row(combat.resolution, 'combat.resolution') : {
    algorithm: 'bounded-physical-v1', criticalRollMaximum: 10_000,
    criticalChanceCapBasisPoints: 5_000,
    criticalMultiplierNumerator: 3, criticalMultiplierDenominator: 2,
    minimumDamage: 1, maximumDamage: 1_000_000_000,
  }
  exact(resolution, ['algorithm', 'criticalRollMaximum', 'criticalChanceCapBasisPoints', 'criticalMultiplierNumerator', 'criticalMultiplierDenominator', 'minimumDamage', 'maximumDamage'], 'combat.resolution')
  if (resolution.algorithm !== 'bounded-physical-v1' || resolution.criticalRollMaximum !== 10_000) fail('combat.resolution算法或随机精度无效')
  int(resolution.criticalChanceCapBasisPoints, 'combat.resolution.criticalChanceCapBasisPoints', 0, 10_000)
  const criticalMultiplierNumerator = int(resolution.criticalMultiplierNumerator, 'combat.resolution.criticalMultiplierNumerator', 1, 100)
  const criticalMultiplierDenominator = int(resolution.criticalMultiplierDenominator, 'combat.resolution.criticalMultiplierDenominator', 1, 100)
  if (criticalMultiplierNumerator < criticalMultiplierDenominator) fail('暴击倍率不能低于普通伤害')
  const minimumDamage = int(resolution.minimumDamage, 'combat.resolution.minimumDamage', 0, 1_000_000_000)
  const maximumDamage = int(resolution.maximumDamage, 'combat.resolution.maximumDamage', 1, 1_000_000_000)
  if (minimumDamage > maximumDamage) fail('combat.resolution伤害上下界无效')
  const skillResolutions = combatResolutionModule
    ? catalog(combat.skillResolutions, 'combat.skillResolutions', ['skillKey', 'powerNumerator', 'powerDenominator', 'flatDamage'])
    : skills.filter(skill => skill.activation === 'active' && skill.kind === 'attack').map(skill => ({
        skillKey: skill.key, powerNumerator: 1, powerDenominator: 1, flatDamage: 0,
      }))
  const skillResolutionKeys = skillResolutions.map((item, index) => key(item.skillKey, `combat.skillResolutions[${index}].skillKey`))
  if (new Set(skillResolutionKeys).size !== skillResolutionKeys.length) fail('combat.skillResolutions.skillKey不能重复')
  skillResolutions.forEach((item, index) => {
    const skillKey = key(item.skillKey, `combat.skillResolutions[${index}].skillKey`)
    const skill = skills.find(candidate => candidate.key === skillKey)
    if (!skill || skill.activation !== 'active' || skill.kind !== 'attack') fail(`伤害公式只能绑定主动攻击技能:${skillKey}`)
    int(item.powerNumerator, `combat.skillResolutions[${index}].powerNumerator`, 0, 100)
    int(item.powerDenominator, `combat.skillResolutions[${index}].powerDenominator`, 1, 100)
    int(item.flatDamage, `combat.skillResolutions[${index}].flatDamage`, 0, maximumDamage)
  })
  requireSameKeys(skillResolutions.map(item => String(item.skillKey)), skills.filter(skill => skill.activation === 'active' && skill.kind === 'attack').map(skill => String(skill.key)), '主动攻击技能伤害公式覆盖')
  const transientPlayerStatusKeys = combat.version === 3 ? strings(combat.transientPlayerStatusKeys, 'combat.transientPlayerStatusKeys') : []
  requireRefs(transientPlayerStatusKeys, statusKeys, 'combat transient player status')
  const legacyEnemies = legacyCombatModule
    ? catalog(combat.enemies, 'combat.enemies', ['key', 'familyKey', 'title', 'level', 'maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'skillKeys', 'dropTableKey'])
    : []
  const strategyProfiles = legacyCombatModule ? legacyEnemies.map(item => ({
    key: `strategy.legacy.${String(item.key)}`, title: `${String(item.title)}旧版策略`, selection: 'ordered-skill-priority',
    prioritySkillKeys: strings(item.skillKeys, `combat enemy ${String(item.key)} skillKeys`),
    fallbackSkillKey: strings(item.skillKeys, `combat enemy ${String(item.key)} skillKeys`)[0],
  })) : catalog(combat.strategyProfiles, 'combat.strategyProfiles', ['key', 'title', 'selection', 'prioritySkillKeys', 'fallbackSkillKey'])
  const strategyProfileKeys = keysOf(strategyProfiles, 'combat.strategyProfiles')
  strategyProfiles.forEach((item, index) => {
    text(item.title, `combat.strategyProfiles[${index}].title`, 2_000)
    if (item.selection !== 'ordered-skill-priority') fail(`combat.strategyProfiles[${index}].selection无效`)
    const prioritySkillKeys = strings(item.prioritySkillKeys, `combat.strategyProfiles[${index}].prioritySkillKeys`)
    if (!prioritySkillKeys.length) fail(`combat.strategyProfiles[${index}]必须配置技能优先级`)
    requireRefs(prioritySkillKeys, skillKeys, 'combat strategy skill')
    const fallbackSkillKey = key(item.fallbackSkillKey, `combat.strategyProfiles[${index}].fallbackSkillKey`)
    if (!prioritySkillKeys.includes(fallbackSkillKey)) fail(`combat.strategyProfiles[${index}].fallbackSkillKey必须包含在优先级中`)
    prioritySkillKeys.forEach(skillKey => {
      if (skills.find(skill => skill.key === skillKey)?.activation !== 'active') fail(`敌人策略只能选择主动技能:${skillKey}`)
    })
  })
  const enemies: Row[] = legacyCombatModule ? legacyEnemies.map(item => ({
    ...structuredClone(item), description: String(item.title), tags: [],
    strategyProfileKey: `strategy.legacy.${String(item.key)}`,
    sourceRefs: [`legacy:combat:${String(item.key)}`], presentationRefs: [],
  })) : catalog(combat.enemies, 'combat.enemies', [
    'key', 'familyKey', 'title', 'description', 'tags', 'level', 'maximumHealth', 'attack', 'defense', 'criticalChance',
    'initiative', 'skillKeys', 'strategyProfileKey', 'dropTableKey', 'sourceRefs', 'presentationRefs',
  ])
  const enemyKeys = keysOf(enemies, 'combat.enemies')
  if (!enemyKeys.size) fail('首版至少需要一个敌人定义')
  const combatMediaSlotKeys = new Set(packageValue.mediaManifest.slotKeys)
  enemies.forEach((item, index) => {
    key(item.familyKey, `combat.enemies[${index}].familyKey`); text(item.title, `combat.enemies[${index}].title`, 2_000)
    text(item.description, `combat.enemies[${index}].description`); strings(item.tags, `combat.enemies[${index}].tags`, 'text')
    int(item.level, `combat.enemies[${index}].level`, 1, maximumLevel); int(item.maximumHealth, `combat.enemies[${index}].maximumHealth`, 1, 1_000_000_000)
    int(item.attack, `combat.enemies[${index}].attack`, 0, 1_000_000_000); int(item.defense, `combat.enemies[${index}].defense`, 0, 1_000_000_000)
    numberValue(item.criticalChance, `combat.enemies[${index}].criticalChance`, 0, 1)
    numberValue(item.initiative, `combat.enemies[${index}].initiative`, 0, 1_000_000)
    const enemySkillKeys = strings(item.skillKeys, `combat.enemies[${index}].skillKeys`)
    if (!enemySkillKeys.length) fail(`combat.enemies[${index}]必须配置至少一个技能`)
    requireRefs(enemySkillKeys, skillKeys, 'enemy skill')
    const strategyProfileKey = key(item.strategyProfileKey, `combat.enemies[${index}].strategyProfileKey`)
    requireRef(strategyProfileKey, strategyProfileKeys, 'enemy strategy profile')
    const strategy = strategyProfiles.find(profile => profile.key === strategyProfileKey)!
    requireRefs(strings(strategy.prioritySkillKeys, `enemy ${String(item.key)} strategy skills`), new Set(enemySkillKeys), `enemy ${String(item.key)} strategy skill`)
    requireRef(nullableKey(item.dropTableKey, `combat.enemies[${index}].dropTableKey`), dropTableKeys, 'enemy drop table')
    const sourceRefs = strings(item.sourceRefs, `combat.enemies[${index}].sourceRefs`, 'text')
    if (!sourceRefs.length) fail(`combat.enemies[${index}]必须说明来源`)
    requireRefs(strings(item.presentationRefs, `combat.enemies[${index}].presentationRefs`), combatMediaSlotKeys, 'enemy presentation slot')
  })
  if (!legacyCombatModule) strategyProfiles.forEach(profile => {
    if (!enemies.some(enemy => enemy.strategyProfileKey === profile.key)) fail(`敌人策略没有使用者:${String(profile.key)}`)
  })
  const legacyEncounters = legacyCombatModule
    ? catalog(combat.encounters, 'combat.encounters', ['key', 'title', 'locationKey', 'enemyKeys', 'recommendedLevel', 'intensity', 'escapeAllowed', 'victoryEffectKeys'])
    : []
  legacyEncounters.forEach((item, index) => requireRefs(strings(item.victoryEffectKeys, `combat.encounters[${index}].victoryEffectKeys`), effectKeys, 'legacy encounter victory effect'))
  const encounters: Row[] = legacyCombatModule ? legacyEncounters.map(item => ({
    key: item.key, title: item.title, description: String(item.title), locationKey: item.locationKey, questKeys: [],
    enemyGroups: strings(item.enemyKeys, `combat encounter ${String(item.key)} enemyKeys`).map((enemyKey, index) => ({
      key: `group.legacy.${String(item.key)}.${index + 1}`, enemyKey, count: 1, order: index + 1,
    })),
    recommendedLevel: item.recommendedLevel,
    levelBand: { minimum: item.recommendedLevel, maximum: item.recommendedLevel }, difficultyProfileKey: 'standard',
    intensity: item.intensity,
    escapePolicy: { allowed: item.escapeAllowed, failureConsumesTurn: true },
    defeatPolicy: { kind: 'retry-or-respawn', preservesWorldProgress: true }, rewardContractKey: null,
    openingText: String(item.title), victoryText: '你赢得了这场战斗。', defeatText: '你战败了，可以重试或返回复活点。',
    sourceRefs: [`legacy:combat:${String(item.key)}`], presentationRefs: [],
  })) : catalog(combat.encounters, 'combat.encounters', [
    'key', 'title', 'description', 'locationKey', 'questKeys', 'enemyGroups', 'recommendedLevel', 'levelBand',
    'difficultyProfileKey', 'intensity', 'escapePolicy', 'defeatPolicy', 'rewardContractKey', 'openingText', 'victoryText',
    'defeatText', 'sourceRefs', 'presentationRefs',
  ])
  const encounterKeys = keysOf(encounters, 'combat.encounters')
  if (!encounterKeys.size) fail('首版至少需要一个遭遇定义')
  const combatRewardOwners = new Map<string, string>()
  encounters.forEach((item, index) => {
    const label = `combat.encounters[${index}]`
    text(item.title, `${label}.title`, 2_000); text(item.description, `${label}.description`)
    requireRef(key(item.locationKey, `${label}.locationKey`), locationKeys, 'encounter location')
    requireRefs(strings(item.questKeys, `${label}.questKeys`), questKeys, 'encounter quest')
    const groups = catalog(item.enemyGroups, `${label}.enemyGroups`, ['key', 'enemyKey', 'count', 'order'])
    keysOf(groups, `${label}.enemyGroups`)
    if (!groups.length) fail(`${label}必须配置至少一个敌人组`)
    let totalEnemies = 0
    groups.forEach((group, groupIndex) => {
      requireRef(key(group.enemyKey, `${label}.enemyGroups[${groupIndex}].enemyKey`), enemyKeys, 'encounter enemy')
      totalEnemies += int(group.count, `${label}.enemyGroups[${groupIndex}].count`, 1, 8)
      const order = int(group.order, `${label}.enemyGroups[${groupIndex}].order`, 1, groups.length)
      if (order !== groupIndex + 1) fail(`${label}.enemyGroups.order必须按数组顺序从1连续递增`)
    })
    if (totalEnemies > 8) fail(`${label}首版敌人数不能超过8`)
    const recommendedLevel = int(item.recommendedLevel, `${label}.recommendedLevel`, 1, maximumLevel)
    const levelBand = row(item.levelBand, `${label}.levelBand`); exact(levelBand, ['minimum', 'maximum'], `${label}.levelBand`)
    const minimum = int(levelBand.minimum, `${label}.levelBand.minimum`, 1, maximumLevel)
    const maximum = int(levelBand.maximum, `${label}.levelBand.maximum`, 1, maximumLevel)
    if (minimum > maximum || recommendedLevel < minimum || recommendedLevel > maximum) fail(`${label}.levelBand与推荐等级不一致`)
    if (key(item.difficultyProfileKey, `${label}.difficultyProfileKey`) !== 'standard') fail(`${label}首版只能使用standard难度`)
    enumValue(item.intensity, ['ordinary', 'dangerous', 'boss'], `${label}.intensity`)
    const escapePolicy = row(item.escapePolicy, `${label}.escapePolicy`); exact(escapePolicy, ['allowed', 'failureConsumesTurn'], `${label}.escapePolicy`)
    const escapeAllowed = bool(escapePolicy.allowed, `${label}.escapePolicy.allowed`)
    if (escapePolicy.failureConsumesTurn !== true || (escapeAllowed && combatRules.allowEscape !== true)) fail(`${label}.escapePolicy不符合首版规则`)
    const defeatPolicy = row(item.defeatPolicy, `${label}.defeatPolicy`); exact(defeatPolicy, ['kind', 'preservesWorldProgress'], `${label}.defeatPolicy`)
    if (defeatPolicy.kind !== 'retry-or-respawn' || defeatPolicy.preservesWorldProgress !== true) fail(`${label}.defeatPolicy不符合首版失败恢复边界`)
    const rewardContractKey = nullableKey(item.rewardContractKey, `${label}.rewardContractKey`)
    const encounterDropTableKeys = [...new Set(groups.flatMap(group => {
      const enemy = enemies.find(candidate => candidate.key === group.enemyKey)!
      const dropTableKey = nullableKey(enemy.dropTableKey, `encounter ${String(item.key)} enemy drop table`)
      return dropTableKey ? [dropTableKey] : []
    }))]
    if (!legacyCombatModule) {
      if (!rewardContractKey) fail(`${label}必须绑定战斗RewardContract`)
      requireRef(rewardContractKey, rewardContractKeys, 'encounter reward contract')
      const priorOwner = combatRewardOwners.get(rewardContractKey)
      if (priorOwner) fail(`战斗RewardContract不能跨遭遇共享:${rewardContractKey}:${priorOwner}:${String(item.key)}`)
      combatRewardOwners.set(rewardContractKey, String(item.key))
      const reward = rewardContracts.find(candidate => candidate.key === rewardContractKey)!
      if (reward.sourceKind !== 'combat') fail(`遭遇RewardContract来源必须为combat:${rewardContractKey}`)
      requireSameKeys(strings(reward.dropTableKeys, `reward ${rewardContractKey} dropTableKeys`), encounterDropTableKeys, `encounter ${String(item.key)} drop tables`)
    }
    text(item.openingText, `${label}.openingText`); text(item.victoryText, `${label}.victoryText`); text(item.defeatText, `${label}.defeatText`)
    const sourceRefs = strings(item.sourceRefs, `${label}.sourceRefs`, 'text')
    if (!sourceRefs.length) fail(`${label}必须说明来源`)
    requireRefs(strings(item.presentationRefs, `${label}.presentationRefs`), combatMediaSlotKeys, 'encounter presentation slot')
  })
  if (!legacyCombatModule) rewardContracts.filter(reward => reward.sourceKind === 'combat').forEach(reward => {
    if (!combatRewardOwners.has(String(reward.key))) fail(`combat来源RewardContract必须绑定一个遭遇:${String(reward.key)}`)
  })
  const startCombatActions = actionRows.filter(action => action.category === 'start-combat')
  const expectedStartOperation = legacyCombatModule ? 'start-combat' : 'initialize-combat'
  startCombatActions.forEach(action => {
    const startEffects = strings(action.successEffectKeys, `start-combat ${String(action.key)} success effects`)
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === expectedStartOperation)
    if (action.actorScope !== 'player' || action.targetScope !== 'encounter' || startEffects.length !== 1
      || strings(action.successEffectKeys, `start-combat ${String(action.key)} success effects`).length !== 1
      || strings(action.costEffectKeys, `start-combat ${String(action.key)} costs`).length
      || strings(action.failureEffectKeys, `start-combat ${String(action.key)} failures`).length
      || action.confirmationPolicy !== 'never' || action.timeCostMinutes !== 0) fail(`start-combat Action必须绑定唯一遭遇目标:${String(action.key)}`)
    const encounterKey = key(row(startEffects[0].payload, `start-combat ${String(action.key)} payload`).encounterKey, `start-combat ${String(action.key)} encounterKey`)
    const encounter = encounters.find(item => item.key === encounterKey) ?? fail(`start-combat Action遭遇不存在:${encounterKey}`)
    requireSameKeys(strings(action.locationKeys, `start-combat ${String(action.key)} locationKeys`), [String(encounter.locationKey)], `start-combat ${String(action.key)} location`)
  })
  if (!legacyCombatModule) encounters.forEach(encounter => {
    const owners = startCombatActions.filter(action => strings(action.successEffectKeys, `start-combat ${String(action.key)} effects`).some(effectKey => {
      const effect = effects.find(candidate => candidate.key === effectKey)!
      return effect.operation === 'initialize-combat' && row(effect.payload, `start-combat effect ${effectKey}`).encounterKey === encounter.key
    }))
    if (owners.length !== 1) fail(`每个遭遇必须且只能由一个start-combat Action进入:${String(encounter.key)}`)
  })
  if (combatStateActionModule) {
    const settlementActions = actionRows.filter(action => action.category === 'combat-state-action')
    const settlementEffects = effects.filter(effect => effect.operation === 'settle-combat-state')
    if (settlementActions.length !== 1 || settlementEffects.length !== 1) fail('Action v9必须且只能定义一个战斗阶段Action/Effect')
    const action = settlementActions[0]
    const settlementActionEffectKeys = strings(action.successEffectKeys, 'combat state action success effects')
    if (action.actorScope !== 'system' || action.targetScope !== 'encounter'
      || strings(action.locationKeys, 'combat state action locations').length
      || strings(action.requirementConditionKeys, 'combat state action requirements').length
      || strings(action.costEffectKeys, 'combat state action costs').length
      || strings(action.failureEffectKeys, 'combat state action failures').length
      || settlementActionEffectKeys.length !== 1
      || settlementActionEffectKeys[0] !== settlementEffects[0].key
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('战斗阶段Action合同无效')
    const forbiddenLegacyEffects = effects.filter(effect => ['start-combat', 'resolve-combat'].includes(String(effect.operation)))
    if (forbiddenLegacyEffects.length) fail('Combat v2不能包含旧start-combat/resolve-combat Effect')
  } else if (effects.some(effect => ['initialize-combat', 'settle-combat-state'].includes(String(effect.operation)))) {
    fail('旧Action/Combat版本不能包含v2战斗Effect')
  }
  const performCombatEffects = effects.filter(effect => effect.operation === 'perform-combat-action')
  if (combatOperationActionModule) {
    const combatActionCategories = new Set(['combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'escape'])
    const combatActions = actionRows.filter(action => combatActionCategories.has(String(action.category)))
    const markerOwner = new Map<string, string>()
    const markerFor = (action: Row) => {
      const markerKeys = [...strings(action.costEffectKeys, `combat action ${String(action.key)} costs`), ...strings(action.successEffectKeys, `combat action ${String(action.key)} success`)]
        .filter(effectKey => effects.find(effect => effect.key === effectKey)?.operation === 'perform-combat-action')
      if (markerKeys.length !== 1) fail(`战斗操作必须绑定唯一perform-combat-action Effect:${String(action.key)}`)
      if (!strings(action.successEffectKeys, `combat action ${String(action.key)} success`).includes(markerKeys[0])) fail(`perform-combat-action必须属于成功Effect:${String(action.key)}`)
      const prior = markerOwner.get(markerKeys[0]); if (prior) fail(`perform-combat-action不能跨Action共享:${markerKeys[0]}:${prior}:${String(action.key)}`)
      markerOwner.set(markerKeys[0], String(action.key))
      const effect = effects.find(candidate => candidate.key === markerKeys[0])!
      const payload = row(effect.payload, `combat action ${String(action.key)} marker payload`)
      exact(payload, ['kind', 'skillKey', 'itemKey'], `combat action ${String(action.key)} marker payload`)
      return { effect, payload }
    }
    combatActions.forEach(action => {
      const actionKey = String(action.key); const category = String(action.category); const { effect, payload } = markerFor(action)
      const kind = enumValue(payload.kind, ['basic-attack', 'skill', 'item', 'escape', 'enemy-skill'], `combat action ${actionKey} kind`)
      const expectedCategory = kind === 'basic-attack' ? 'combat-basic-attack' : kind === 'skill' ? 'combat-skill' : kind === 'item' ? 'combat-item' : kind === 'enemy-skill' ? 'combat-enemy-skill' : 'escape'
      if (category !== expectedCategory || strings(action.locationKeys, `combat action ${actionKey} locations`).length
        || strings(action.failureEffectKeys, `combat action ${actionKey} failures`).length || action.timeCostMinutes !== 0
        || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail(`战斗操作Action基础合同无效:${actionKey}`)
      const costEffectKeys = strings(action.costEffectKeys, `combat action ${actionKey} costs`)
      const successEffectKeys = strings(action.successEffectKeys, `combat action ${actionKey} success`)
      if (kind === 'basic-attack' || kind === 'skill' || kind === 'enemy-skill') {
        const skillKey = key(payload.skillKey, `combat action ${actionKey} skillKey`); requireRef(skillKey, skillKeys, 'combat action skill')
        if (payload.itemKey != null) fail(`技能战斗Action不能绑定itemKey:${actionKey}`)
        const skill = skills.find(candidate => candidate.key === skillKey)!
        if (skill.activation !== 'active') fail(`战斗Action不能绑定被动技能:${actionKey}`)
        const systemEnemy = kind === 'enemy-skill'
        if (action.actorScope !== (systemEnemy ? 'system' : 'player')) fail(`战斗技能Action actorScope无效:${actionKey}`)
        const expectedTargetScope = systemEnemy || skill.target !== 'single-enemy' ? 'none' : 'combatant'
        if (action.targetScope !== expectedTargetScope) fail(`战斗技能Action targetScope无效:${actionKey}`)
        requireSameKeys(strings(action.requirementConditionKeys, `combat action ${actionKey} requirements`), systemEnemy ? [] : strings(skill.useConditionKeys, `skill ${skillKey} use conditions`), `combat action ${actionKey} conditions`)
        if (systemEnemy && Number(skill.resourceCost) !== 0) fail(`敌人首版不能使用消耗技能资源的技能:${skillKey}`)
        const resourceCosts = costEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
          .filter(effect => effect.operation === 'change-player-resource' && row(effect.payload, `combat skill cost ${effect.key}`).resource === 'skill-resource')
        if (systemEnemy || Number(skill.resourceCost) === 0) {
          if (costEffectKeys.length) fail(`无资源消耗的战斗技能不能声明cost:${actionKey}`)
        } else {
          if (costEffectKeys.length !== 1 || resourceCosts.length !== 1 || row(resourceCosts[0].payload, `combat skill cost ${resourceCosts[0].key}`).amount !== -Number(skill.resourceCost)) fail(`战斗技能资源cost不匹配:${actionKey}`)
        }
        requireSameKeys(successEffectKeys, [...strings(skill.effectKeys, `skill ${skillKey} effects`), String(effect.key)], `combat skill ${actionKey} success effects`)
        if (kind === 'basic-attack' && (Number(skill.resourceCost) !== 0 || Number(skill.cooldownTurns) !== 0)) fail('普通攻击必须绑定零消耗零冷却技能')
      } else if (kind === 'item') {
        const itemKey = key(payload.itemKey, `combat item ${actionKey} itemKey`); requireRef(itemKey, itemKeys, 'combat item')
        if (payload.skillKey != null || action.actorScope !== 'player' || action.targetScope !== 'item') fail(`战斗道具Action范围无效:${actionKey}`)
        const item = itemRows.find(candidate => candidate.key === itemKey)!
        if (item.consumable !== true) fail(`战斗道具必须是消耗品:${itemKey}`)
        const ordinaryUseAction = actionRows.find(candidate => candidate.key === item.useActionKey) ?? fail(`战斗道具缺少普通useAction:${itemKey}`)
        requireSameKeys(strings(action.requirementConditionKeys, `combat item ${actionKey} requirements`), strings(ordinaryUseAction.requirementConditionKeys, `item ${itemKey} use requirements`), `combat item ${actionKey} conditions`)
        const removals = costEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
          .filter(candidate => candidate.operation === 'remove-item' && row(candidate.payload, `combat item removal ${candidate.key}`).reason === 'consume')
        if (costEffectKeys.length !== 1 || removals.length !== 1 || row(removals[0].payload, `combat item removal ${removals[0].key}`).itemKey !== itemKey
          || row(removals[0].payload, `combat item removal ${removals[0].key}`).quantity !== 1) fail(`战斗道具必须精确消耗一个自身物品:${actionKey}`)
        requireSameKeys(successEffectKeys, [...strings(item.effectKeys, `item ${itemKey} effects`), String(effect.key)], `combat item ${actionKey} success effects`)
      } else {
        if (payload.skillKey != null || payload.itemKey != null || action.actorScope !== 'player' || action.targetScope !== 'none'
          || strings(action.requirementConditionKeys, `escape action ${actionKey} requirements`).length || costEffectKeys.length
          || successEffectKeys.length !== 1 || successEffectKeys[0] !== effect.key) fail(`逃跑Action合同无效:${actionKey}`)
      }
    })
    performCombatEffects.forEach(effect => { if (!markerOwner.has(String(effect.key))) fail(`perform-combat-action Effect没有唯一战斗Action owner:${String(effect.key)}`) })
    const markerRows = combatActions.map(action => ({ action, payload: row(effects.find(effect => markerOwner.get(String(effect.key)) === action.key)!.payload, `combat marker ${String(action.key)}`) }))
    if (markerRows.filter(row => row.payload.kind === 'basic-attack').length !== 1 || markerRows.filter(row => row.payload.kind === 'escape').length !== 1) fail('Action v10必须各有一个普通攻击和逃跑Action')
    const basicAttackSkillKey = String(markerRows.find(row => row.payload.kind === 'basic-attack')!.payload.skillKey)
    const activePlayerSkillKeys = skills.filter(skill => skill.activation === 'active' && skill.key !== basicAttackSkillKey).map(skill => String(skill.key))
    requireSameKeys(markerRows.filter(row => row.payload.kind === 'skill').map(row => String(row.payload.skillKey)), activePlayerSkillKeys, '玩家战斗技能Action覆盖')
    requireSameKeys(markerRows.filter(row => row.payload.kind === 'item').map(row => String(row.payload.itemKey)), itemRows.filter(item => item.consumable === true).map(item => String(item.key)), '玩家战斗道具Action覆盖')
    const enemySkillKeys = [...new Set(enemies.flatMap(enemy => strings(enemy.skillKeys, `enemy ${String(enemy.key)} skillKeys`)))]
    requireSameKeys(markerRows.filter(row => row.payload.kind === 'enemy-skill').map(row => String(row.payload.skillKey)), enemySkillKeys, '敌人战斗技能Action覆盖')
    strategyProfiles.forEach(strategy => {
      const fallbackSkill = skills.find(skill => skill.key === strategy.fallbackSkillKey)!
      if (Number(fallbackSkill.cooldownTurns) !== 0) fail(`敌人策略fallback技能必须零冷却:${String(strategy.key)}`)
    })
  } else if (performCombatEffects.length || actionRows.some(action => ['combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill'].includes(String(action.category)))) {
    fail('Action v1～v9不能包含正式战斗操作')
  }
  const combatRewardActions = actionRows.filter(action => action.category === 'combat-reward-action')
  if (combatResolutionActionModule) {
    if (combatRewardActions.length !== 1) fail('Action v11必须且只能定义一个战斗胜利奖励Action')
    const action = combatRewardActions[0]
    if (action.actorScope !== 'system' || action.targetScope !== 'encounter'
      || strings(action.locationKeys, 'combat reward action locations').length
      || strings(action.requirementConditionKeys, 'combat reward action requirements').length
      || strings(action.costEffectKeys, 'combat reward action costs').length
      || strings(action.successEffectKeys, 'combat reward action success').length
      || strings(action.failureEffectKeys, 'combat reward action failures').length
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('战斗胜利奖励Action合同无效')
  } else if (combatRewardActions.length) fail('Action v1～v10不能包含战斗胜利奖励Action')
  const normalizedCombat = {
    version: structuredStatusCombatModule ? 4 : combatResolutionModule ? 3 : 2,
    sourceVersion: legacyCombatModule ? 1 : structuredStatusCombatModule ? 4 : combatResolutionModule ? 3 : 2,
    rules: structuredClone(combatRules) as unknown as TextOpenWorldParsedModulesV1['combat']['rules'],
    difficultyProfiles: structuredClone(difficultyProfiles) as unknown as TextOpenWorldParsedModulesV1['combat']['difficultyProfiles'],
    resolution: structuredClone(resolution) as unknown as TextOpenWorldParsedModulesV1['combat']['resolution'],
    skillResolutions: structuredClone(skillResolutions) as unknown as TextOpenWorldParsedModulesV1['combat']['skillResolutions'],
    transientPlayerStatusKeys: structuredStatusCombatModule ? [] : [...transientPlayerStatusKeys],
    strategyProfiles: structuredClone(strategyProfiles) as unknown as TextOpenWorldParsedModulesV1['combat']['strategyProfiles'],
    enemies: structuredClone(enemies) as unknown as TextOpenWorldParsedModulesV1['combat']['enemies'],
    encounters: structuredClone(encounters) as unknown as TextOpenWorldParsedModulesV1['combat']['encounters'],
  } as unknown as TextOpenWorldParsedModulesV1['combat']

  const crafting = versioned(packageValue, 'crafting', [1, 2])
  const modernCrafting = Number(crafting.version) >= 2
  if (craftingActionModule !== modernCrafting) fail('Action v12与Crafting v2必须成对发布')
  exact(crafting, modernCrafting ? ['version', 'rules', 'recipes'] : ['version', 'recipes'], 'crafting')
  const craftingRules = modernCrafting ? row(crafting.rules, 'crafting.rules') : null
  if (craftingRules) {
    exact(craftingRules, ['successPolicy', 'maximumBatchQuantity', 'maximumTotalItemUnitsPerAction'], 'crafting.rules')
    if (craftingRules.successPolicy !== 'guaranteed') fail('首版制作只能100%成功')
    int(craftingRules.maximumBatchQuantity, 'crafting.rules.maximumBatchQuantity', 1, 1_000)
    int(craftingRules.maximumTotalItemUnitsPerAction, 'crafting.rules.maximumTotalItemUnitsPerAction', 1, 1_000_000)
  }
  const recipeFields = modernCrafting
    ? ['key', 'title', 'description', 'category', 'learnedByDefault', 'stationLocationKeys', 'requirementConditionKeys', 'ingredients', 'outputs', 'timeCostMinutes', 'presentationRefs']
    : ['key', 'title', 'description', 'learnedByDefault', 'stationLocationKeys', 'ingredients', 'outputs', 'timeCostMinutes']
  const recipes = catalog(crafting.recipes, 'crafting.recipes', recipeFields); const recipeKeys = keysOf(recipes, 'crafting.recipes')
  const normalizedRecipes = recipes.map((item, index) => {
    const label = `crafting.recipes[${index}]`
    text(item.title, `${label}.title`, 2_000); text(item.description, `${label}.description`); bool(item.learnedByDefault, `${label}.learnedByDefault`)
    const stationLocationKeys = strings(item.stationLocationKeys, `${label}.stationLocationKeys`); requireRefs(stationLocationKeys, locationKeys, 'recipe station')
    const requirementConditionKeys = modernCrafting ? strings(item.requirementConditionKeys, `${label}.requirementConditionKeys`) : []
    requireRefs(requirementConditionKeys, conditionKeys, 'recipe condition')
    const parseItems = (field: 'ingredients' | 'outputs') => {
      const entries = array(item[field], `${label}.${field}`, modernCrafting ? 128 : 20_000).map((entry, entryIndex) => {
        const parsed = row(entry, `${label}.${field}[${entryIndex}]`); exact(parsed, ['itemKey', 'quantity'], `${label}.${field}[${entryIndex}]`)
        const itemKey = key(parsed.itemKey, `${label}.${field}[${entryIndex}].itemKey`); requireRef(itemKey, itemKeys, 'recipe item')
        return { itemKey, quantity: int(parsed.quantity, `${label}.${field}[${entryIndex}].quantity`, 1, 1_000_000) }
      })
      if (modernCrafting && (!entries.length || new Set(entries.map(entry => entry.itemKey)).size !== entries.length)) fail(`${label}.${field}必须非空且物品不能重复`)
      return entries
    }
    const ingredients = parseItems('ingredients'); const outputs = parseItems('outputs')
    if (modernCrafting) {
      if (ingredients.some(entry => outputs.some(output => output.itemKey === entry.itemKey))) fail(`${label}输入与输出物品不能重叠`)
      ingredients.forEach(entry => {
        const definition = itemRows.find(candidate => candidate.key === entry.itemKey)!
        if (definition.critical) fail(`${label}不能消耗关键物品:${entry.itemKey}`)
        if (definition.stackPolicy !== 'stacked') fail(`${label}首版只能消耗可堆叠材料:${entry.itemKey}`)
      })
      outputs.forEach(entry => {
        const definition = itemRows.find(candidate => candidate.key === entry.itemKey)!
        if (definition.unique && entry.quantity !== 1) fail(`${label}唯一物品单次产出必须为1:${entry.itemKey}`)
      })
    }
    const timeCostMinutes = int(item.timeCostMinutes, `${label}.timeCostMinutes`, 0, 1_000_000)
    return {
      key: String(item.key), title: String(item.title), description: String(item.description),
      category: modernCrafting ? enumValue(item.category, ['consumable', 'equipment', 'tool', 'material'], `${label}.category`) : 'consumable' as const,
      learnedByDefault: Boolean(item.learnedByDefault), stationLocationKeys, requirementConditionKeys,
      ingredients, outputs, timeCostMinutes,
      presentationRefs: modernCrafting ? strings(item.presentationRefs, `${label}.presentationRefs`, 'text') : [],
    }
  })
  const performCraftEffects = effects.filter(effect => effect.operation === 'perform-crafting')
  if (craftingActionModule) {
    const maximumUnits = Number(craftingRules!.maximumTotalItemUnitsPerAction)
    normalizedRecipes.forEach(recipe => {
      const units = [...recipe.ingredients, ...recipe.outputs].reduce((sum, entry) => sum + entry.quantity, 0)
      if (units > maximumUnits) fail(`配方单份物品单位数超过事件上限:${recipe.key}`)
      recipe.outputs.forEach(output => {
        const definition = itemRows.find(candidate => candidate.key === output.itemKey)!
        if (definition.stackPolicy === 'stacked' && output.quantity > Number(definition.maximumStack)) fail(`配方单份产出超过物品堆叠上限:${recipe.key}:${output.itemKey}`)
      })
    })
    const reachableEffectKeys = new Set([
      ...actionRows.flatMap(action => [
        ...strings(action.costEffectKeys, `action ${String(action.key)} cost effects`),
        ...strings(action.successEffectKeys, `action ${String(action.key)} success effects`),
        ...strings(action.failureEffectKeys, `action ${String(action.key)} failure effects`),
      ]),
      ...rewardContracts.flatMap(reward => strings(reward.effectKeys, `reward ${String(reward.key)} effects`)),
    ])
    const learnedRecipeKeys = effects.filter(effect => effect.operation === 'learn-recipe' && reachableEffectKeys.has(String(effect.key))).map(effect => {
      const payload = row(effect.payload, `learn recipe effect ${String(effect.key)} payload`)
      exact(payload, ['recipeKey'], `learn recipe effect ${String(effect.key)} payload`)
      const recipeKey = key(payload.recipeKey, `learn recipe effect ${String(effect.key)} recipeKey`)
      requireRef(recipeKey, recipeKeys, 'learn recipe effect recipe')
      return recipeKey
    })
    normalizedRecipes.filter(recipe => !recipe.learnedByDefault).forEach(recipe => {
      if (!learnedRecipeKeys.includes(recipe.key)) fail(`非默认配方缺少learn-recipe解锁Effect:${recipe.key}`)
    })
    const craftActions = actionRows.filter(action => action.category === 'craft')
    if (craftActions.length !== normalizedRecipes.length) fail('Crafting v2必须为每个配方定义唯一制作Action')
    const ownedRecipeKeys = craftActions.map(action => {
      const label = `craft action ${String(action.key)}`
      const successEffectKeys = strings(action.successEffectKeys, `${label}.successEffectKeys`)
      const markers = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
        .filter(effect => effect.operation === 'perform-crafting')
      if (action.actorScope !== 'player' || action.targetScope !== 'recipe'
        || strings(action.costEffectKeys, `${label}.costEffectKeys`).length || strings(action.failureEffectKeys, `${label}.failureEffectKeys`).length
        || markers.length !== 1 || successEffectKeys.length !== 1 || action.timeCostMinutes !== 0
        || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail(`${label}合同无效`)
      const markerPayload = row(markers[0].payload, `${label}.marker.payload`); exact(markerPayload, ['recipeKey'], `${label}.marker.payload`)
      const recipeKey = key(markerPayload.recipeKey, `${label}.recipeKey`); requireRef(recipeKey, recipeKeys, 'craft action recipe')
      const recipe = normalizedRecipes.find(candidate => candidate.key === recipeKey)!
      requireSameKeys(strings(action.locationKeys, `${label}.locationKeys`), recipe.stationLocationKeys, `${label}制作地点`)
      requireSameKeys(strings(action.requirementConditionKeys, `${label}.requirementConditionKeys`), recipe.requirementConditionKeys, `${label}制作条件`)
      return recipeKey
    })
    requireSameKeys(ownedRecipeKeys, normalizedRecipes.map(recipe => recipe.key), '制作Action配方覆盖')
    if (performCraftEffects.length !== normalizedRecipes.length) fail('每个配方必须且只能拥有一个perform-crafting Effect')
  } else if (performCraftEffects.length || actionRows.some(action => action.targetScope === 'recipe')) fail('旧Action模块不能包含正式制作操作')
  const normalizedCrafting: TextOpenWorldParsedModulesV1['crafting'] = {
    version: 2,
    sourceVersion: modernCrafting ? 2 : 1,
    rules: modernCrafting ? {
      successPolicy: 'guaranteed',
      maximumBatchQuantity: Number(craftingRules!.maximumBatchQuantity),
      maximumTotalItemUnitsPerAction: Number(craftingRules!.maximumTotalItemUnitsPerAction),
    } : { successPolicy: 'guaranteed', maximumBatchQuantity: 100, maximumTotalItemUnitsPerAction: 100_000 },
    recipes: normalizedRecipes,
  }

  const economy = versioned(packageValue, 'economy', [1, 2])
  const modernEconomy = Number(economy.version) >= 2
  if (economyActionModule !== modernEconomy) fail('Action v13与Economy v2必须成对发布')
  exact(economy, modernEconomy ? ['version', 'currency', 'rules', 'vendors'] : ['version', 'currency', 'vendors'], 'economy')
  const currency = row(economy.currency, 'economy.currency'); exact(currency, ['key', 'label'], 'economy.currency')
  if (currency.key !== 'currency') fail('首版只允许currency单货币')
  text(currency.label, 'economy.currency.label', 100)
  const economyRules = modernEconomy ? row(economy.rules, 'economy.rules') : null
  if (economyRules) exact(economyRules, ['maximumTransactionQuantity', 'maximumTransactionTotal'], 'economy.rules')
  const maximumTransactionQuantity = modernEconomy
    ? int(economyRules!.maximumTransactionQuantity, 'economy.rules.maximumTransactionQuantity', 1, 1_000_000)
    : 100
  const maximumTransactionTotal = modernEconomy
    ? int(economyRules!.maximumTransactionTotal, 'economy.rules.maximumTransactionTotal', 1, 1_000_000_000)
    : 1_000_000_000
  const vendorRows = catalog(economy.vendors, 'economy.vendors', modernEconomy
    ? ['key', 'title', 'actorKey', 'locationKey', 'factionKey', 'buyPriceMultiplierBasisPoints', 'sellPriceMultiplierBasisPoints', 'buyCategories', 'sellCategories', 'inventoryEntries', 'availabilityConditionKeys', 'buyActionKey', 'sellActionKey']
    : ['key', 'title', 'actorKey', 'locationKey', 'factionKey', 'buyPriceMultiplier', 'sellPriceMultiplier', 'stock'])
  const vendorKeys = keysOf(vendorRows, 'economy.vendors')
  const tradeCategories = ['equipment', 'consumable', 'material', 'misc'] as const
  const normalizedVendors: TextOpenWorldParsedModulesV1['economy']['vendors'] = vendorRows.map((item, index) => {
    const label = `economy.vendors[${index}]`
    text(item.title, `${label}.title`, 2_000)
    const actorKey = key(item.actorKey, `${label}.actorKey`); requireRef(actorKey, actorKeys, 'vendor actor')
    const locationKey = key(item.locationKey, `${label}.locationKey`); requireRef(locationKey, locationKeys, 'vendor location')
    const factionKey = nullableKey(item.factionKey, `${label}.factionKey`); requireRef(factionKey, factionKeys, 'vendor faction')
    const actor = actorRows.find(candidate => candidate.key === actorKey) ?? fail(`${label}.actorKey不存在`)
    if (factionKey !== actor.factionKey) fail(`${label}.factionKey必须与商店角色阵营一致`)
    const buyPriceMultiplierBasisPoints = modernEconomy
      ? int(item.buyPriceMultiplierBasisPoints, `${label}.buyPriceMultiplierBasisPoints`, 100, 1_000_000)
      : Math.round(numberValue(item.buyPriceMultiplier, `${label}.buyPriceMultiplier`, 0.01, 100) * 10_000)
    const sellPriceMultiplierBasisPoints = modernEconomy
      ? int(item.sellPriceMultiplierBasisPoints, `${label}.sellPriceMultiplierBasisPoints`, 100, 1_000_000)
      : Math.round(numberValue(item.sellPriceMultiplier, `${label}.sellPriceMultiplier`, 0.01, 100) * 10_000)
    const legacyStock = modernEconomy ? [] : array(item.stock, `${label}.stock`)
    const buyCategories = modernEconomy
      ? strings(item.buyCategories, `${label}.buyCategories`).map(value => enumValue(value, tradeCategories, `${label}.buyCategory`))
      : [...new Set(legacyStock.map(entry => {
          const itemKey = key(row(entry, `${label}.stock entry`).itemKey, `${label}.stock itemKey`)
          return itemRows.find(candidate => candidate.key === itemKey)?.kind
        }).filter((value): value is typeof tradeCategories[number] => tradeCategories.includes(value as typeof tradeCategories[number])))]
    const sellCategories = modernEconomy
      ? strings(item.sellCategories, `${label}.sellCategories`).map(value => enumValue(value, tradeCategories, `${label}.sellCategory`))
      : [...new Set(itemRows.filter(candidate => candidate.sellable && candidate.kind !== 'quest').map(candidate => candidate.kind as typeof tradeCategories[number]))]
    if (!buyCategories.length || !sellCategories.length) fail(`${label}买卖类别不能为空`)
    if (modernEconomy) sellCategories.forEach(category => { if (!buyCategories.includes(category)) fail(`${label}首版只允许收购可重新出售的类别:${category}`) })
    const inventoryRows = modernEconomy
      ? catalog(item.inventoryEntries, `${label}.inventoryEntries`, ['itemKey', 'stockPolicy', 'initialQuantity'])
      : legacyStock.map((entry, entryIndex) => {
          const parsed = row(entry, `${label}.stock[${entryIndex}]`); exact(parsed, ['itemKey', 'quantity'], `${label}.stock[${entryIndex}]`)
          return { itemKey: parsed.itemKey, stockPolicy: parsed.quantity == null ? 'unlimited' : 'limited', initialQuantity: parsed.quantity }
        })
    if (!inventoryRows.length) fail(`${label}库存目录不能为空`)
    const inventoryKeys = inventoryRows.map((entry, entryIndex) => {
      const entryLabel = `${label}.inventoryEntries[${entryIndex}]`
      const itemKey = key(entry.itemKey, `${entryLabel}.itemKey`); requireRef(itemKey, itemKeys, 'vendor stock item')
      const definition = itemRows.find(candidate => candidate.key === itemKey)!
      const stockPolicy = enumValue(entry.stockPolicy, ['unlimited', 'limited'], `${entryLabel}.stockPolicy`)
      const initialQuantity = entry.initialQuantity == null ? null : int(entry.initialQuantity, `${entryLabel}.initialQuantity`, 0, 1_000_000)
      if ((stockPolicy === 'unlimited') !== (initialQuantity == null)) fail(`${entryLabel}库存策略与初始数量不一致`)
      if (definition.critical || definition.kind === 'quest' || Number(definition.baseValue) < 1) fail(`${entryLabel}不能出售关键、任务或零价值物品`)
      if (!buyCategories.includes(definition.kind as typeof tradeCategories[number])) fail(`${entryLabel}物品类别不在buyCategories中`)
      if (stockPolicy === 'unlimited' && definition.unique) fail(`${entryLabel}唯一物品不能无限供应`)
      return itemKey
    })
    if (new Set(inventoryKeys).size !== inventoryKeys.length) fail(`${label}.inventoryEntries物品不能重复`)
    const availabilityConditionKeys = modernEconomy ? strings(item.availabilityConditionKeys, `${label}.availabilityConditionKeys`) : []
    requireRefs(availabilityConditionKeys, conditionKeys, 'vendor availability condition')
    const buyActionKey = modernEconomy ? key(item.buyActionKey, `${label}.buyActionKey`) : null
    const sellActionKey = modernEconomy ? key(item.sellActionKey, `${label}.sellActionKey`) : null
    requireRef(buyActionKey, actionKeys, 'vendor buy Action'); requireRef(sellActionKey, actionKeys, 'vendor sell Action')
    return {
      key: key(item.key, `${label}.key`), title: String(item.title), actorKey, locationKey, factionKey,
      buyPriceMultiplierBasisPoints, sellPriceMultiplierBasisPoints,
      buyCategories, sellCategories,
      inventoryEntries: inventoryRows.map(entry => ({
        itemKey: String(entry.itemKey), stockPolicy: entry.stockPolicy as 'unlimited' | 'limited',
        initialQuantity: entry.initialQuantity == null ? null : Number(entry.initialQuantity),
      })),
      availabilityConditionKeys, buyActionKey, sellActionKey,
    }
  })
  const performTransactionEffects = effects.filter(effect => effect.operation === 'perform-transaction')
  if (modernEconomy) {
    const ownedActionKeys: string[] = []
    const ownedEffectKeys: string[] = []
    normalizedVendors.forEach(vendor => {
      for (const transactionKind of ['buy', 'sell'] as const) {
        const actionKey = transactionKind === 'buy' ? vendor.buyActionKey : vendor.sellActionKey
        const action = actionRows.find(candidate => candidate.key === actionKey) ?? fail(`商店交易Action不存在:${vendor.key}:${transactionKind}`)
        const successEffectKeys = strings(action.successEffectKeys, `vendor ${vendor.key} ${transactionKind} success effects`)
        const markers = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
          .filter(effect => effect.operation === 'perform-transaction')
        if (action.category !== transactionKind || action.actorScope !== 'player' || action.targetScope !== 'vendor'
          || strings(action.costEffectKeys, `vendor ${vendor.key} ${transactionKind} costs`).length
          || strings(action.failureEffectKeys, `vendor ${vendor.key} ${transactionKind} failures`).length
          || successEffectKeys.length !== 1 || markers.length !== 1 || Number(action.timeCostMinutes) !== 0
          || action.confirmationPolicy !== 'never' || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) {
          fail(`商店交易Action合同无效:${vendor.key}:${transactionKind}`)
        }
        requireSameKeys(strings(action.locationKeys, `vendor ${vendor.key} ${transactionKind} locations`), [vendor.locationKey], `vendor ${vendor.key} ${transactionKind}地点`)
        requireSameKeys(strings(action.requirementConditionKeys, `vendor ${vendor.key} ${transactionKind} conditions`), vendor.availabilityConditionKeys, `vendor ${vendor.key} ${transactionKind}条件`)
        const marker = row(markers[0].payload, `vendor ${vendor.key} ${transactionKind} marker`)
        exact(marker, ['kind', 'vendorKey'], `vendor ${vendor.key} ${transactionKind} marker`)
        if (marker.kind !== transactionKind || marker.vendorKey !== vendor.key) fail(`商店交易Effect与Vendor不一致:${vendor.key}:${transactionKind}`)
        ownedActionKeys.push(String(actionKey))
        ownedEffectKeys.push(String(markers[0].key))
      }
    })
    if (new Set(ownedActionKeys).size !== ownedActionKeys.length) fail('同一交易Action不能属于多个商店或交易方向')
    requireSameKeys(ownedActionKeys, actionRows.filter(action => action.category === 'buy' || action.category === 'sell').map(action => String(action.key)), '商店交易Action覆盖')
    requireSameKeys(ownedEffectKeys, performTransactionEffects.map(effect => String(effect.key)), '商店交易Effect覆盖')
    performTransactionEffects.forEach(effect => {
      const owners = actionRows.filter(action => [
        ...strings(action.costEffectKeys, `action ${String(action.key)} cost effects`),
        ...strings(action.successEffectKeys, `action ${String(action.key)} success effects`),
        ...strings(action.failureEffectKeys, `action ${String(action.key)} failure effects`),
      ].includes(String(effect.key)))
      if (owners.length !== 1) fail(`perform-transaction Effect必须且只能属于一个交易Action:${String(effect.key)}`)
    })
  } else if (performTransactionEffects.length) fail('旧Economy模块不能包含正式交易Effect')
  const normalizedEconomy: TextOpenWorldParsedModulesV1['economy'] = {
    version: 2, sourceVersion: modernEconomy ? 2 : 1,
    currency: { key: 'currency', label: String(currency.label) },
    rules: { maximumTransactionQuantity, maximumTransactionTotal },
    vendors: normalizedVendors,
  }
  actorRows.forEach((item, index) => requireRefs(strings(item.serviceKeys, `actors.actors[${index}].serviceKeys`), vendorKeys, 'actor service'))
  if (!legacyActorModule) {
    normalizedVendors.forEach(vendor => {
      const owners = actorRows.filter(actor => strings(actor.serviceKeys, `actor ${String(actor.key)} serviceKeys`).includes(String(vendor.key)))
      if (owners.length !== 1 || owners[0].key !== vendor.actorKey) fail(`vendor必须由actorKey对应角色唯一持有:${String(vendor.key)}`)
    })
  }
  if (actorLifecycleModule) {
    serviceContinuityRows.forEach((item, index) => {
      const label = `actors.serviceContinuity[${index}]`
      const ownerActorKey = key(item.ownerActorKey, `${label}.ownerActorKey`)
      const serviceKey = key(item.serviceKey, `${label}.serviceKey`)
      const owner = actorRows.find(actor => actor.key === ownerActorKey) ?? fail(`${label} ownerActorKey不存在`)
      const service = normalizedVendors.find(vendor => vendor.key === serviceKey) ?? fail(`${label} serviceKey不存在`)
      if (service.actorKey !== ownerActorKey || !strings(owner.serviceKeys, `actor ${ownerActorKey} serviceKeys`).includes(serviceKey)) fail(`${label}服务所有权不一致`)
      const policy = enumValue(item.policy, ['replace-on-owner-death', 'disappear-on-owner-death'], `${label}.policy`)
      const replacementActorKey = nullableKey(item.replacementActorKey, `${label}.replacementActorKey`)
      const replacementServiceKey = nullableKey(item.replacementServiceKey, `${label}.replacementServiceKey`)
      if (policy === 'disappear-on-owner-death') {
        if (replacementActorKey != null || replacementServiceKey != null) fail(`${label}消失策略不能配置替代者`)
        return
      }
      if (replacementActorKey == null || replacementServiceKey == null) fail(`${label}接管策略必须配置替代角色和服务`)
      if (replacementActorKey === ownerActorKey || replacementServiceKey === serviceKey) fail(`${label}替代关系不能指回原角色或原服务`)
      const replacementActor = actorRows.find(actor => actor.key === replacementActorKey) ?? fail(`${label} replacementActorKey不存在`)
      const replacementService = normalizedVendors.find(vendor => vendor.key === replacementServiceKey) ?? fail(`${label} replacementServiceKey不存在`)
      if (replacementService.actorKey !== replacementActorKey || !strings(replacementActor.serviceKeys, `actor ${replacementActorKey} serviceKeys`).includes(replacementServiceKey)) fail(`${label}替代服务所有权不一致`)
    })
    const ownedServiceKeys = actorRows.flatMap(actor => strings(actor.serviceKeys, `actor ${String(actor.key)} serviceKeys`)).sort()
    requireSameKeys(serviceContinuityRows.map(item => String(item.serviceKey)), ownedServiceKeys, 'Actor服务连续性规则覆盖')
    const replacementServiceKeys = serviceContinuityRows.flatMap(item => item.policy === 'replace-on-owner-death' ? [String(item.replacementServiceKey)] : [])
    if (new Set(replacementServiceKeys).size !== replacementServiceKeys.length) fail('同一替代服务不能接管多个原服务')
    const replacementTargets = new Set(replacementServiceKeys)
    serviceContinuityRows.filter(item => replacementTargets.has(String(item.serviceKey)) && item.policy === 'replace-on-owner-death')
      .forEach(item => fail(`首版不允许服务替代链:${String(item.serviceKey)}`))
  }

  const relationships = versioned(packageValue, 'relationships', [1, 2, 3])
  const modernRelationships = Number(relationships.version) >= 2
  const crimeRelationships = Number(relationships.version) >= 3
  exact(relationships, crimeRelationships
    ? ['version', 'morality', 'factionAffinity', 'attitude', 'storyModifiers', 'unaffiliatedMoralityMultiplier', 'factionMorality', 'attitudeBands', 'crimeActions']
    : modernRelationships
      ? ['version', 'morality', 'factionAffinity', 'attitude', 'storyModifiers', 'unaffiliatedMoralityMultiplier', 'factionMorality', 'attitudeBands']
      : ['version', 'morality', 'factionAffinity', 'attitude', 'storyModifiers'], 'relationships')
  for (const field of ['morality', 'factionAffinity']) { const meter = row(relationships[field], `relationships.${field}`); exact(meter, ['minimum', 'maximum', 'initial'], `relationships.${field}`); const minimum = numberValue(meter.minimum, `${field}.minimum`, -10_000, 10_000); const maximum = numberValue(meter.maximum, `${field}.maximum`, -10_000, 10_000); const initial = numberValue(meter.initial, `${field}.initial`, -10_000, 10_000); if (minimum >= maximum || initial < minimum || initial > maximum) fail(`${field}范围无效`) }
  const attitude = row(relationships.attitude, 'relationships.attitude'); exact(attitude, ['badMaximum', 'goodMinimum', 'moralityWeight', 'factionWeight', 'explicitStoryModifierCap'], 'relationships.attitude'); const bad = numberValue(attitude.badMaximum, 'attitude.badMaximum', -10_000, 10_000); const good = numberValue(attitude.goodMinimum, 'attitude.goodMinimum', -10_000, 10_000); const mw = numberValue(attitude.moralityWeight, 'attitude.moralityWeight', 0, 1); const fw = numberValue(attitude.factionWeight, 'attitude.factionWeight', 0, 1); if (bad >= good || Math.abs(mw + fw - 1) > 0.000001) fail('attitude阈值或权重无效'); numberValue(attitude.explicitStoryModifierCap, 'attitude.explicitStoryModifierCap', 0, 10_000)
  const storyModifiers = catalog(relationships.storyModifiers, 'relationships.storyModifiers', ['key', 'actorKey', 'value', 'sourceQuestKey']); keysOf(storyModifiers, 'relationships.storyModifiers'); storyModifiers.forEach((item, index) => { requireRef(key(item.actorKey, `relationships.storyModifiers[${index}].actorKey`), actorKeys, 'story modifier actor'); numberValue(item.value, `relationships.storyModifiers[${index}].value`, -10_000, 10_000); requireRef(key(item.sourceQuestKey, `relationships.storyModifiers[${index}].sourceQuestKey`), questKeys, 'story modifier quest') })
  const unaffiliatedMoralityMultiplier = modernRelationships
    ? numberValue(relationships.unaffiliatedMoralityMultiplier, 'relationships.unaffiliatedMoralityMultiplier', -1, 1)
    : 1
  if (![-1, 0, 1].includes(unaffiliatedMoralityMultiplier)) fail('unaffiliatedMoralityMultiplier只能是-1、0或1')
  const factionMorality = modernRelationships
    ? catalog(relationships.factionMorality, 'relationships.factionMorality', ['factionKey', 'moralityMultiplier'])
    : factions.map(faction => ({ factionKey: faction.key, moralityMultiplier: 1 }))
  factionMorality.forEach((item, index) => {
    requireRef(key(item.factionKey, `relationships.factionMorality[${index}].factionKey`), factionKeys, 'faction morality')
    const multiplier = numberValue(item.moralityMultiplier, `relationships.factionMorality[${index}].moralityMultiplier`, -1, 1)
    if (![-1, 0, 1].includes(multiplier)) fail(`relationships.factionMorality[${index}].moralityMultiplier只能是-1、0或1`)
  })
  requireSameKeys(factionMorality.map(item => String(item.factionKey)), [...factionKeys], '阵营道德解释覆盖')
  const attitudeBands = modernRelationships
    ? catalog(relationships.attitudeBands, 'relationships.attitudeBands', ['attitude', 'label', 'greetingTone', 'buyPriceMultiplier', 'sellPriceMultiplier', 'optionalInteractionPolicy'])
    : [
        { attitude: 'bad', label: '差', greetingTone: '冷淡而克制', buyPriceMultiplier: 1.15, sellPriceMultiplier: 0.85, optionalInteractionPolicy: 'may-refuse' },
        { attitude: 'neutral', label: '一般', greetingTone: '礼貌而保留', buyPriceMultiplier: 1, sellPriceMultiplier: 1, optionalInteractionPolicy: 'available' },
        { attitude: 'good', label: '好', greetingTone: '友善且愿意帮助', buyPriceMultiplier: 0.9, sellPriceMultiplier: 1.1, optionalInteractionPolicy: 'available' },
      ]
  attitudeBands.forEach((item, index) => {
    enumValue(item.attitude, ['bad', 'neutral', 'good'], `relationships.attitudeBands[${index}].attitude`)
    text(item.label, `relationships.attitudeBands[${index}].label`, 100); text(item.greetingTone, `relationships.attitudeBands[${index}].greetingTone`, 500)
    numberValue(item.buyPriceMultiplier, `relationships.attitudeBands[${index}].buyPriceMultiplier`, 0.01, 100)
    numberValue(item.sellPriceMultiplier, `relationships.attitudeBands[${index}].sellPriceMultiplier`, 0.01, 100)
    enumValue(item.optionalInteractionPolicy, ['available', 'may-refuse'], `relationships.attitudeBands[${index}].optionalInteractionPolicy`)
  })
  requireSameKeys(attitudeBands.map(item => String(item.attitude)), ['bad', 'neutral', 'good'], '三档态度定义覆盖')
  if (modernEconomy) {
    const roundedPrice = (baseValue: number, vendorBasisPoints: number, relationshipMultiplier: number, rounding: 'ceil' | 'floor') => {
      const relationshipBasisPoints = Math.round(relationshipMultiplier * 10_000)
      const numerator = BigInt(baseValue) * BigInt(vendorBasisPoints) * BigInt(relationshipBasisPoints)
      const denominator = 100_000_000n
      const result = rounding === 'ceil' ? (numerator + denominator - 1n) / denominator : numerator / denominator
      const positive = baseValue > 0 && result < 1n ? 1n : result
      if (positive > BigInt(maximumTransactionTotal)) fail('商店单价超过单次交易总额上限')
      return Number(positive)
    }
    normalizedVendors.forEach(vendor => {
      const offeredKeys = new Set(vendor.inventoryEntries.map(entry => entry.itemKey))
      itemRows.filter(item => (offeredKeys.has(String(item.key)) || vendor.sellCategories.includes(item.kind as never)) && item.sellable && vendor.sellCategories.includes(item.kind as never)).forEach(item => {
        attitudeBands.forEach(band => {
          const buyPrice = roundedPrice(Number(item.baseValue), vendor.buyPriceMultiplierBasisPoints, Number(band.buyPriceMultiplier), 'ceil')
          const sellPrice = roundedPrice(Number(item.baseValue), vendor.sellPriceMultiplierBasisPoints, Number(band.sellPriceMultiplier), 'floor')
          if (sellPrice > buyPrice) fail(`商店关系价格会形成无风险套利:${vendor.key}:${String(item.key)}:${String(band.attitude)}`)
        })
      })
    })
  }
  const crimeActions = crimeRelationships
    ? catalog(relationships.crimeActions, 'relationships.crimeActions', [
        'key', 'actionKey', 'kind', 'targetActorKey', 'locationKey', 'successConditionKeys',
        'witnessActorKeysOnSuccess', 'witnessActorKeysOnFailure', 'witnessedEffectKeys', 'failureMessage',
      ])
    : []
  keysOf(crimeActions, 'relationships.crimeActions')
  crimeActions.forEach((item, index) => {
    const label = `relationships.crimeActions[${index}]`
    requireRef(key(item.actionKey, `${label}.actionKey`), actionKeys, 'crime Action')
    enumValue(item.kind, ['steal', 'deceive', 'crime'], `${label}.kind`)
    requireRef(key(item.targetActorKey, `${label}.targetActorKey`), actorKeys, 'crime target Actor')
    requireRef(key(item.locationKey, `${label}.locationKey`), locationKeys, 'crime location')
    requireRefs(strings(item.successConditionKeys, `${label}.successConditionKeys`), conditionKeys, 'crime success condition')
    requireRefs(strings(item.witnessActorKeysOnSuccess, `${label}.witnessActorKeysOnSuccess`), actorKeys, 'crime success witness')
    requireRefs(strings(item.witnessActorKeysOnFailure, `${label}.witnessActorKeysOnFailure`), actorKeys, 'crime failure witness')
    requireRefs(strings(item.witnessedEffectKeys, `${label}.witnessedEffectKeys`), effectKeys, 'crime witnessed Effect')
    text(item.failureMessage, `${label}.failureMessage`, 2_000)
  })
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
  schedules.forEach((item, index) => {
    const actor = actorRows.find(candidate => candidate.key === item.actorKey)!
    const actorServiceKeys = new Set(strings(actor.serviceKeys, `actor ${String(actor.key)} serviceKeys`))
    const entries = array(item.entries, `actors.schedules[${index}].entries`)
    entries.forEach((entry, entryIndex) => {
      const parsed = row(entry, 'schedule entry')
      requireRef(key(parsed.timePeriodKey, `actors.schedules[${index}].entries[${entryIndex}].timePeriodKey`), periodKeys, 'schedule time period')
      const locationKey = key(parsed.locationKey, `actors.schedules[${index}].entries[${entryIndex}].locationKey`)
      strings(parsed.availableServiceKeys, `actors.schedules[${index}].entries[${entryIndex}].availableServiceKeys`).forEach(serviceKey => {
        if (!actorServiceKeys.has(serviceKey)) fail(`日程开放了不属于角色的服务:${String(actor.key)}:${serviceKey}`)
        if (normalizedVendors.find(vendor => vendor.key === serviceKey)?.locationKey !== locationKey) fail(`日程服务地点与vendor地点不一致:${serviceKey}`)
      })
    })
    if (!legacyActorModule) requireSameKeys(entries.map(entry => String(row(entry, 'schedule entry').timePeriodKey)), [...periodKeys], `schedule ${String(item.key)} time period coverage`)
  })

  const director = versioned(packageValue, 'director', [1, 2, 3])
  const legacyDirector = director.version === 1
  exact(director, legacyDirector
    ? ['version', 'rules', 'decks', 'templates', 'randomEvents']
    : ['version', 'rules', 'decks', 'templates', 'randomEvents', 'regionRules'], 'director')
  const rawDirectorRules = row(director.rules, 'director.rules')
  exact(rawDirectorRules, legacyDirector
    ? ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit']
    : ['globalMaximumRevealed', 'globalMaximumActive', 'maximumQuestInstances', 'highIntensityStreakLimit', 'historyLimit', 'maximumSettlementIntervals', 'systemActionKey'], 'director.rules')
  const baseDirectorRules = {
    globalMaximumRevealed: int(rawDirectorRules.globalMaximumRevealed, 'director.rules.globalMaximumRevealed', 1, 1_000),
    globalMaximumActive: int(rawDirectorRules.globalMaximumActive, 'director.rules.globalMaximumActive', 1, 1_000),
    maximumQuestInstances: int(rawDirectorRules.maximumQuestInstances, 'director.rules.maximumQuestInstances', 1, 10_000),
    highIntensityStreakLimit: int(rawDirectorRules.highIntensityStreakLimit, 'director.rules.highIntensityStreakLimit', 1, 20),
  }
  if (baseDirectorRules.globalMaximumActive > baseDirectorRules.globalMaximumRevealed) fail('director全局maximumActive不能大于maximumRevealed')
  const directorRules = {
    ...baseDirectorRules,
    historyLimit: legacyDirector ? 128 : int(rawDirectorRules.historyLimit, 'director.rules.historyLimit', 16, 1_000),
    maximumSettlementIntervals: legacyDirector ? 128 : int(rawDirectorRules.maximumSettlementIntervals, 'director.rules.maximumSettlementIntervals', 1, 1_000),
    systemActionKey: legacyDirector ? null : nullableKey(rawDirectorRules.systemActionKey, 'director.rules.systemActionKey'),
  }
  const rawDecks = catalog(director.decks, 'director.decks', legacyDirector
    ? ['regionKey', 'questKeys', 'templateKeys', 'randomEventKeys', 'maximumRevealed', 'maximumActive', 'cooldownMinutes', 'blankWeight']
    : ['regionKey', 'questKeys', 'templateKeys', 'randomEventKeys', 'triggerKinds', 'maximumRevealed', 'maximumActive', 'cooldownMinutes', 'blankWeight'])
  const decks: TextOpenWorldParsedModulesV1['director']['decks'] = rawDecks.map((item, index) => ({
    regionKey: key(item.regionKey, `director.decks[${index}].regionKey`),
    questKeys: strings(item.questKeys, `director.decks[${index}].questKeys`),
    templateKeys: strings(item.templateKeys, `director.decks[${index}].templateKeys`),
    randomEventKeys: strings(item.randomEventKeys, `director.decks[${index}].randomEventKeys`),
    triggerKinds: legacyDirector
      ? ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity']
      : strings(item.triggerKinds, `director.decks[${index}].triggerKinds`, 'key').map(trigger => enumValue(trigger, ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'], `director.decks[${index}].triggerKinds`)),
    maximumRevealed: int(item.maximumRevealed, `director.decks[${index}].maximumRevealed`, 1, 1_000),
    maximumActive: int(item.maximumActive, `director.decks[${index}].maximumActive`, 1, 1_000),
    cooldownMinutes: int(item.cooldownMinutes, `director.decks[${index}].cooldownMinutes`, 0, 1_000_000),
    blankWeight: int(item.blankWeight, `director.decks[${index}].blankWeight`, 0, 1_000_000),
  }))
  const rawTemplates = catalog(director.templates, 'director.templates', legacyDirector
    ? ['key', 'questKey', 'regionKeys', 'variantTextKeys', 'fingerprint', 'cooldownMinutes']
    : ['key', 'questKey', 'regionKeys', 'variantTextKeys', 'fingerprint', 'cooldownMinutes', 'conditionKeys', 'levelBand', 'category', 'intensity', 'weight'])
  const templates: TextOpenWorldParsedModulesV1['director']['templates'] = rawTemplates.map((item, index) => ({
    key: key(item.key, `director.templates[${index}].key`),
    questKey: key(item.questKey, `director.templates[${index}].questKey`),
    regionKeys: strings(item.regionKeys, `director.templates[${index}].regionKeys`),
    variantTextKeys: strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`),
    fingerprint: legacyDirector ? key(item.fingerprint, `director.templates[${index}].fingerprint`) : key(item.fingerprint, `director.templates[${index}].fingerprint`),
    cooldownMinutes: int(item.cooldownMinutes, `director.templates[${index}].cooldownMinutes`, 0, 1_000_000),
    conditionKeys: legacyDirector ? [] : strings(item.conditionKeys, `director.templates[${index}].conditionKeys`),
    levelBand: legacyDirector ? { minimum: 1, maximum: maximumLevel } : (() => {
      const band = row(item.levelBand, `director.templates[${index}].levelBand`); exact(band, ['minimum', 'maximum'], `director.templates[${index}].levelBand`)
      const minimum = int(band.minimum, `director.templates[${index}].levelBand.minimum`, 1, maximumLevel)
      const maximum = int(band.maximum, `director.templates[${index}].levelBand.maximum`, minimum, maximumLevel)
      return { minimum, maximum }
    })(),
    category: legacyDirector ? 'help' : enumValue(item.category, ['help', 'resource', 'exploration', 'conflict', 'mystery'], `director.templates[${index}].category`),
    intensity: legacyDirector ? 1 : int(item.intensity, `director.templates[${index}].intensity`, 1, 10),
    weight: legacyDirector ? 100 : int(item.weight, `director.templates[${index}].weight`, 1, 1_000_000),
  }))
  const locationBoundDirector = director.version === 3
  const rawRandomEvents = catalog(director.randomEvents, 'director.randomEvents', legacyDirector
    ? ['key', 'title', 'regionKeys', 'actionKeys', 'effectKeys', 'intensity', 'cooldownMinutes']
    : locationBoundDirector
      ? ['key', 'title', 'kind', 'regionKeys', 'locationKeys', 'actionKeys', 'effectKeys', 'conditionKeys', 'fingerprint', 'rumorKey', 'upgradeTemplateKey', 'intensity', 'weight', 'cooldownMinutes']
      : ['key', 'title', 'kind', 'regionKeys', 'actionKeys', 'effectKeys', 'conditionKeys', 'fingerprint', 'rumorKey', 'upgradeTemplateKey', 'intensity', 'weight', 'cooldownMinutes'])
  const randomEvents: TextOpenWorldParsedModulesV1['director']['randomEvents'] = rawRandomEvents.map((item, index) => ({
    key: key(item.key, `director.randomEvents[${index}].key`),
    title: text(item.title, `director.randomEvents[${index}].title`, 2_000),
    regionKeys: strings(item.regionKeys, `director.randomEvents[${index}].regionKeys`),
    locationKeys: locationBoundDirector ? strings(item.locationKeys, `director.randomEvents[${index}].locationKeys`) : [],
    actionKeys: strings(item.actionKeys, `director.randomEvents[${index}].actionKeys`),
    effectKeys: strings(item.effectKeys, `director.randomEvents[${index}].effectKeys`),
    intensity: int(item.intensity, `director.randomEvents[${index}].intensity`, 1, 10),
    cooldownMinutes: int(item.cooldownMinutes, `director.randomEvents[${index}].cooldownMinutes`, 0, 1_000_000),
    kind: legacyDirector ? 'atmosphere' : enumValue(item.kind, ['atmosphere', 'resource', 'encounter', 'clue', 'quest-upgrade'], `director.randomEvents[${index}].kind`),
    conditionKeys: legacyDirector ? [] : strings(item.conditionKeys, `director.randomEvents[${index}].conditionKeys`),
    fingerprint: legacyDirector ? `fingerprint.${String(item.key)}` : key(item.fingerprint, `director.randomEvents[${index}].fingerprint`),
    rumorKey: legacyDirector ? null : nullableKey(item.rumorKey, `director.randomEvents[${index}].rumorKey`),
    upgradeTemplateKey: legacyDirector ? null : nullableKey(item.upgradeTemplateKey, `director.randomEvents[${index}].upgradeTemplateKey`),
    weight: legacyDirector ? 100 : int(item.weight, `director.randomEvents[${index}].weight`, 1, 1_000_000),
  }))
  const regionRules = legacyDirector
    ? normalizedWorld.regions.map(region => ({ regionKey: region.key, settlementIntervalMinutes: 1440, initialPressure: 0, minimumPressure: 0, maximumPressure: 100, driftPerInterval: 0, stateBands: [{ key: 'stable', minimumPressure: 0 }] }))
    : catalog(director.regionRules, 'director.regionRules', ['regionKey', 'settlementIntervalMinutes', 'initialPressure', 'minimumPressure', 'maximumPressure', 'driftPerInterval', 'stateBands']).map((item, index) => {
        const minimumPressure = int(item.minimumPressure, `director.regionRules[${index}].minimumPressure`, -1_000_000, 1_000_000)
        const maximumPressure = int(item.maximumPressure, `director.regionRules[${index}].maximumPressure`, minimumPressure, 1_000_000)
        const stateBands = catalog(item.stateBands, `director.regionRules[${index}].stateBands`, ['key', 'minimumPressure'])
          .map((band, bandIndex) => ({ key: key(band.key, `director.regionRules[${index}].stateBands[${bandIndex}].key`), minimumPressure: int(band.minimumPressure, `director.regionRules[${index}].stateBands[${bandIndex}].minimumPressure`, minimumPressure, maximumPressure) }))
          .sort((left, right) => left.minimumPressure - right.minimumPressure)
        if (!stateBands.length || stateBands[0].minimumPressure !== minimumPressure || new Set(stateBands.map(band => band.key)).size !== stateBands.length || new Set(stateBands.map(band => band.minimumPressure)).size !== stateBands.length) fail(`director.regionRules[${index}]状态档位必须唯一并从minimumPressure开始`)
        return {
          regionKey: key(item.regionKey, `director.regionRules[${index}].regionKey`),
          settlementIntervalMinutes: int(item.settlementIntervalMinutes, `director.regionRules[${index}].settlementIntervalMinutes`, 1, 1_000_000),
          initialPressure: int(item.initialPressure, `director.regionRules[${index}].initialPressure`, minimumPressure, maximumPressure),
          minimumPressure, maximumPressure,
          driftPerInterval: int(item.driftPerInterval, `director.regionRules[${index}].driftPerInterval`, -1_000_000, 1_000_000),
          stateBands,
        }
      })
  const templateKeys = keysOf(templates, 'director.templates'); const randomEventKeys = keysOf(randomEvents, 'director.randomEvents')
  const deckRegions = decks.map((item, index) => key(item.regionKey, `director.decks[${index}].regionKey`)); if (new Set(deckRegions).size !== deckRegions.length) fail('director.decks.regionKey重复'); requireRefs(deckRegions, regionKeys, 'deck region')
  requireSameKeys(deckRegions, [...regionKeys], 'region director decks')
  requireSameKeys(regionRules.map(rule => rule.regionKey), [...regionKeys], 'region director rules')
  templates.forEach((item, index) => {
    const questKey = key(item.questKey, `director.templates[${index}].questKey`); requireRef(questKey, questKeys, 'template quest')
    if (questRows.find(quest => quest.key === questKey)?.type !== 'template') fail(`director template必须引用template任务:${questKey}`)
    requireRefs(strings(item.regionKeys, `director.templates[${index}].regionKeys`), regionKeys, 'template region')
    strings(item.variantTextKeys, `director.templates[${index}].variantTextKeys`); key(item.fingerprint, `director.templates[${index}].fingerprint`)
    int(item.cooldownMinutes, `director.templates[${index}].cooldownMinutes`, 0, 1_000_000)
    requireRefs(item.conditionKeys as string[], conditionKeys, 'director template condition')
  })
  questRows.filter(item => item.type === 'template').forEach(item => {
    if (templates.filter(template => template.questKey === item.key).length !== 1) fail(`模板任务必须且只能绑定一个Director模板:${String(item.key)}`)
  })
  randomEvents.forEach((item, index) => {
    text(item.title, `director.randomEvents[${index}].title`, 2_000)
    requireRefs(strings(item.regionKeys, `director.randomEvents[${index}].regionKeys`), regionKeys, 'random event region')
    requireRefs(item.locationKeys, locationKeys, 'random event location')
    item.locationKeys.forEach(locationKey => {
      const locationRegionKey = normalizedWorld.locations.find(location => location.key === locationKey)?.regionKey
      if (!item.regionKeys.includes(locationRegionKey ?? '')) {
        fail(`随机事件地点不属于事件地区:${String(item.key)}:${locationKey}`)
      }
    })
    requireRefs(strings(item.actionKeys, `director.randomEvents[${index}].actionKeys`), actionKeys, 'random event action')
    requireRefs(strings(item.effectKeys, `director.randomEvents[${index}].effectKeys`), effectKeys, 'random event effect')
    requireRefs(item.conditionKeys as string[], conditionKeys, 'random event condition')
    int(item.intensity, `director.randomEvents[${index}].intensity`, 1, 10); int(item.cooldownMinutes, `director.randomEvents[${index}].cooldownMinutes`, 0, 1_000_000)
    if (item.effectKeys.some(effectKey => effects.find(effect => effect.key === effectKey)?.operation === 'settle-director')) fail(`随机事件不能嵌套Director结算:${String(item.key)}`)
    const directorSafeOperations = new Set([
      'change-player-resource', 'grant-experience', 'apply-status', 'remove-status', 'grant-item', 'remove-item',
      'learn-skill', 'learn-recipe', 'change-currency', 'change-morality', 'change-faction-affinity',
      'set-story-modifier', 'reveal-knowledge', 'reveal-location', 'unlock-fast-travel', 'change-actor-state',
      'change-region-state', 'set-world-flag', 'earn-achievement', 'unlock-ending',
    ])
    item.effectKeys.forEach(effectKey => {
      const effect = effects.find(candidate => candidate.key === effectKey)!
      if (!directorSafeOperations.has(String(effect.operation))) fail(`随机事件Effect需要独立授权或会破坏受保护流程:${String(item.key)}:${effectKey}`)
    })
  })
  if (authoredNarrativeModule) {
    const presentedEventKeys = randomEventPresentations.map((item, index) => key(item.randomEventKey, `narrative.randomEventPresentations[${index}].randomEventKey`))
    if (new Set(presentedEventKeys).size !== presentedEventKeys.length) fail('每个随机事件只能有一个表现定义')
    requireSameKeys(presentedEventKeys, [...randomEventKeys], 'random event presentation coverage')
    const eventSceneKeys = scenes.filter(scene => scene.sourceKind === 'random-event').map((scene, index) => key(scene.randomEventKey, `narrative.randomEventScenes[${index}].randomEventKey`))
    if (new Set(eventSceneKeys).size !== eventSceneKeys.length) fail('每个随机事件只能有一个场景')
    requireSameKeys(eventSceneKeys, [...randomEventKeys], 'random event scene coverage')
    scenes.filter(scene => scene.sourceKind === 'random-event').forEach(scene => {
      const event = randomEvents.find(candidate => candidate.key === scene.randomEventKey) ?? fail(`随机事件场景引用未知事件:${String(scene.key)}`)
      if (!(event.regionKeys as string[]).includes(String(scene.regionKey))) fail(`随机事件场景地区不属于事件:${String(scene.key)}`)
      const declaredActions = new Set(event.actionKeys as string[])
      if (strings(scene.actionKeys, `random event scene ${String(scene.key)} actionKeys`).some(actionKey => !declaredActions.has(actionKey))) fail(`随机事件场景引用事件外Action:${String(scene.key)}`)
    })
  }
  const fingerprints = [...templates.map(item => String(item.fingerprint)), ...randomEvents.map(item => String(item.fingerprint))]
  if (new Set(fingerprints).size !== fingerprints.length) fail('Director模板与随机事件fingerprint不能重复')
  decks.forEach((item, index) => {
    const fixedQuestKeys = strings(item.questKeys, `director.decks[${index}].questKeys`); requireRefs(fixedQuestKeys, questKeys, 'deck quest')
    fixedQuestKeys.forEach(questKey => {
      const quest = questRows.find(candidate => candidate.key === questKey)!
      if (quest.type !== 'ordinary' || quest.instantiationPolicy !== 'session-start' || quest.initialStatus !== 'available' || !strings(quest.regionKeys, `director fixed quest ${questKey}.regionKeys`).includes(String(item.regionKey))) fail(`固定牌只能引用本地区available普通任务:${questKey}`)
    })
    const deckTemplateKeys = strings(item.templateKeys, `director.decks[${index}].templateKeys`); requireRefs(deckTemplateKeys, templateKeys, 'deck template')
    deckTemplateKeys.forEach(templateKey => { if (!templates.find(template => template.key === templateKey)!.regionKeys.includes(String(item.regionKey))) fail(`牌组模板不属于地区:${templateKey}`) })
    const deckEventKeys = strings(item.randomEventKeys, `director.decks[${index}].randomEventKeys`); requireRefs(deckEventKeys, randomEventKeys, 'deck event')
    deckEventKeys.forEach(eventKey => { if (!randomEvents.find(event => event.key === eventKey)!.regionKeys.includes(String(item.regionKey))) fail(`牌组随机事件不属于地区:${eventKey}`) })
    const maxRevealed = int(item.maximumRevealed, `director.decks[${index}].maximumRevealed`, 1, 1_000)
    const maxActive = int(item.maximumActive, `director.decks[${index}].maximumActive`, 1, 1_000)
    if (maxActive > maxRevealed || maxRevealed > directorRules.globalMaximumRevealed || maxActive > directorRules.globalMaximumActive) fail('deck任务预算不能超过局部或全局上限')
    int(item.cooldownMinutes, `director.decks[${index}].cooldownMinutes`, 0, 1_000_000); int(item.blankWeight, `director.decks[${index}].blankWeight`, 0, 1_000_000)
    if (!(item.triggerKinds as unknown[]).length) fail(`director.decks[${index}]至少需要一个触发类型`)
  })
  const normalizedDirector = {
    version: locationBoundDirector ? 3 as const : 2 as const,
    sourceVersion: legacyDirector ? 1 as const : locationBoundDirector ? 3 as const : 2 as const,
    rules: directorRules, decks, templates, randomEvents, regionRules,
  }
  if (directorActionModule !== !legacyDirector) fail('Action v14必须与Director v2一起发布')
  if (directorActionModule) {
    requireRef(directorRules.systemActionKey, actionKeys, 'director system Action')
    const action = actionRows.find(candidate => candidate.key === directorRules.systemActionKey) ?? fail('Director系统Action不存在')
    const successEffectKeys = strings(action.successEffectKeys, 'director system Action.successEffectKeys')
    const successEffects = successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!)
    if (action.category !== 'director-action' || action.actorScope !== 'system' || action.targetScope !== 'none'
      || strings(action.locationKeys, 'director system Action.locationKeys').length
      || strings(action.requirementConditionKeys, 'director system Action.requirementConditionKeys').length
      || strings(action.costEffectKeys, 'director system Action.costEffectKeys').length
      || strings(action.failureEffectKeys, 'director system Action.failureEffectKeys').length
      || successEffects.length !== 1 || successEffects[0].operation !== 'settle-director'
      || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
      || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes != null) fail('Director系统Action合同无效')
    const settlementEffects = effects.filter(effect => effect.operation === 'settle-director')
    if (settlementEffects.length !== 1 || settlementEffects[0].key !== successEffects[0].key) fail('settle-director Effect必须且只能属于Director系统Action')
    exact(row(settlementEffects[0].payload, 'director settlement effect.payload'), [], 'director settlement effect.payload')
    actionRows.filter(candidate => candidate.key !== action.key).forEach(candidate => {
      const referenced = [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failures`)]
      if (referenced.includes(String(settlementEffects[0].key))) fail(`settle-director只能由Director系统Action引用:${String(candidate.key)}`)
    })
  }

  const knowledge = versioned(packageValue, 'knowledge')
  exact(knowledge, ['version', 'entries', 'rumors', 'achievements'], 'knowledge'); const entries = catalog(knowledge.entries, 'knowledge.entries', ['key', 'kind', 'title', 'content', 'sourceRefs', 'initialPlayerVisibility', 'actorKeys']); const rumors = catalog(knowledge.rumors, 'knowledge.rumors', ['key', 'knowledgeKey', 'text', 'reliability']); const achievements = array(knowledge.achievements, 'knowledge.achievements').map((value, index) => { const item = row(value, `knowledge.achievements[${index}]`); const ownerAction = Object.prototype.hasOwnProperty.call(item, 'grantAuthority'); exact(item, ownerAction ? ['key', 'title', 'description', 'conditionKeys', 'grantAuthority'] : ['key', 'title', 'description', 'conditionKeys'], `knowledge.achievements[${index}]`); return item }); const knowledgeKeys = keysOf(entries, 'knowledge.entries'); const rumorKeys = keysOf(rumors, 'knowledge.rumors'); keysOf(achievements, 'knowledge.achievements')
  const ownerActionAchievementCount = achievements.filter(item => Object.prototype.hasOwnProperty.call(item, 'grantAuthority')).length
  if (ownerActionAchievementCount !== 0 && ownerActionAchievementCount !== achievements.length) fail('knowledge.achievements不能混用legacy与owner-action授予合同')
  entries.forEach((item, index) => { enumValue(item.kind, ['location', 'actor', 'faction', 'enemy', 'lore', 'quest-clue'], `knowledge.entries[${index}].kind`); text(item.title, `knowledge.entries[${index}].title`, 2_000); text(item.content, `knowledge.entries[${index}].content`); strings(item.sourceRefs, `knowledge.entries[${index}].sourceRefs`, 'text'); enumValue(item.initialPlayerVisibility, ['hidden', 'rumor', 'known'], `knowledge.entries[${index}].initialPlayerVisibility`); requireRefs(strings(item.actorKeys, `knowledge.entries[${index}].actorKeys`), actorKeys, 'knowledge actor') })
  rumors.forEach((item, index) => { requireRef(key(item.knowledgeKey, `knowledge.rumors[${index}].knowledgeKey`), knowledgeKeys, 'rumor knowledge'); text(item.text, `knowledge.rumors[${index}].text`); enumValue(item.reliability, ['uncertain', 'likely', 'confirmed'], `knowledge.rumors[${index}].reliability`) })
  achievements.forEach((item, index) => { text(item.title, `knowledge.achievements[${index}].title`, 2_000); text(item.description, `knowledge.achievements[${index}].description`); const achievementConditionKeys = strings(item.conditionKeys, `knowledge.achievements[${index}].conditionKeys`); requireRefs(achievementConditionKeys, conditionKeys, 'achievement condition'); if (Object.prototype.hasOwnProperty.call(item, 'grantAuthority') && (enumValue(item.grantAuthority, ['owner-action'], `knowledge.achievements[${index}].grantAuthority`) !== 'owner-action' || achievementConditionKeys.length)) fail(`knowledge.achievements[${index}] owner-action不能声明Director条件`) })
  randomEvents.forEach((item, index) => {
    requireRef(item.rumorKey as string | null, rumorKeys, `director.randomEvents[${index}].rumorKey`)
    requireRef(item.upgradeTemplateKey as string | null, templateKeys, `director.randomEvents[${index}].upgradeTemplateKey`)
    if (ownerActionAchievementCount > 0 && (item.effectKeys as string[]).some(effectKey => {
      const operation = effects.find(effect => effect.key === effectKey)?.operation
      return operation === 'reveal-knowledge' || operation === 'earn-achievement'
    })) fail(`owner-action Knowledge或成就Effect不能由Director事件执行:${String(item.key)}`)
    if (item.kind === 'atmosphere' && ((item.effectKeys as string[]).length || item.rumorKey != null || item.upgradeTemplateKey != null)) fail(`氛围事件只能留下已见历程:${String(item.key)}`)
    if (item.kind === 'clue' && (item.rumorKey == null || item.upgradeTemplateKey != null)) fail(`线索事件必须且只能绑定一条传闻:${String(item.key)}`)
    if (item.kind === 'quest-upgrade' && item.upgradeTemplateKey == null) fail(`升级事件必须绑定任务模板:${String(item.key)}`)
    if (item.kind !== 'quest-upgrade' && item.upgradeTemplateKey != null) fail(`非升级事件不能绑定任务模板:${String(item.key)}`)
    if (!['atmosphere', 'clue', 'quest-upgrade'].includes(String(item.kind)) && !(item.effectKeys as string[]).length && !(item.actionKeys as string[]).length) fail(`资源或遭遇事件必须包含Action或Effect:${String(item.key)}`)
  })
  if (ownerActionAchievementCount > 0) {
    const restAction = actionRows.find(action => action.key === 'action.rest.standard')
    if (!restAction || restAction.category !== 'rest' || restAction.actorScope !== 'player'
      || restAction.targetScope !== 'none'
      || strings(restAction.locationKeys, 'action.rest.standard.locationKeys').length
      || strings(restAction.requirementConditionKeys, 'action.rest.standard.requirementConditionKeys').length
      || restAction.repeatPolicy !== 'repeatable') {
      fail('受治理Knowledge缺少可在任意地点执行的编译器休息Action')
    }
    randomEvents.filter(event => event.rumorKey != null).forEach(event => {
      const propagationDecks = decks.filter(deck => deck.randomEventKeys.includes(event.key))
      if (!locationBoundDirector || event.regionKeys.length !== 1 || event.locationKeys.length !== 1
        || propagationDecks.length !== 1
        || propagationDecks[0]!.regionKey !== event.regionKeys[0]) {
        fail(`受治理传闻事件必须冻结唯一地点并唯一进入对应地区牌组:${event.key}`)
      }
      if (!propagationDecks[0]!.triggerKinds.includes('rest')) {
        fail(`受治理传闻地区牌组缺少编译器保证可达的rest触发:${event.key}`)
      }
    })
  }
  if (authoredNarrativeModule) randomEventPresentations.forEach((item, index) => {
    requireRef(nullableKey(item.rumorKey, `narrative.randomEventPresentations[${index}].rumorKey`), rumorKeys, 'random event presentation rumor')
    const event = randomEvents.find(candidate => candidate.key === item.randomEventKey) ?? fail(`随机事件表现引用未知事件:${String(item.key)}`)
    if (item.rumorKey !== event.rumorKey) fail(`随机事件表现与Director传闻引用不一致:${String(item.key)}`)
  })

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
    if (item.targetScope === 'vendor' && normalizedVendors.length === 0) fail(`actions.actions[${index}] 需要vendor但目录为空`)
  })
  effects.filter(effect => effect.operation === 'set-story-modifier').forEach(effect => {
    const payload = row(effect.payload, `story modifier effect ${String(effect.key)}.payload`)
    const actorKey = key(payload.actorKey, `story modifier effect ${String(effect.key)}.actorKey`)
    const value = numberValue(payload.value, `story modifier effect ${String(effect.key)}.value`, -10_000, 10_000)
    if (!storyModifiers.some(modifier => modifier.actorKey === actorKey && modifier.value === value)) {
      fail(`故事修正Effect必须匹配Release预制修正:${String(effect.key)}`)
    }
  })
  const relationshipConditionKeys = new Set(conditions.filter(condition => usesRelationshipCondition(condition.expression)).map(condition => String(condition.key)))
  const mainlineQuestKeys = new Set(questRows.filter(quest => quest.type === 'mainline').map(quest => String(quest.key)))
  questRows.filter(quest => mainlineQuestKeys.has(String(quest.key))).forEach(quest => {
    if (strings(quest.prerequisiteConditionKeys, `mainline quest ${String(quest.key)} prerequisites`).some(conditionKey => relationshipConditionKeys.has(conditionKey))) {
      fail(`主线任务不能由道德、阵营或态度条件锁定:${String(quest.key)}`)
    }
  })
  questStages.filter(stage => mainlineQuestKeys.has(String(stage.questKey))).forEach(stage => {
    if (strings(stage.completionConditionKeys, `mainline stage ${String(stage.key)} completion conditions`).some(conditionKey => relationshipConditionKeys.has(conditionKey))) {
      fail(`主线Stage不能由道德、阵营或态度条件锁定:${String(stage.key)}`)
    }
    array(stage.objectiveKeys, `mainline stage ${String(stage.key)} objectiveKeys`).forEach(objectiveKey => {
      const objective = objectives.find(item => item.key === objectiveKey)!
      if (objective.optional === true) return
      const objectiveActions = strings(objective.actionKeys, `mainline objective ${String(objective.key)} actionKeys`).map(actionKey => actionRows.find(action => action.key === actionKey)!)
      if (!objectiveActions.some(action => !strings(action.requirementConditionKeys, `mainline objective action ${String(action.key)} requirements`).some(conditionKey => relationshipConditionKeys.has(conditionKey)))) {
        fail(`主线必需Objective至少需要一条不受关系数值阻断的Action:${String(objective.key)}`)
      }
    })
  })
  actionRows.filter(action => ['accept-quest', 'quest-action'].includes(String(action.category))).forEach(action => {
    const touchesMainline = strings(action.successEffectKeys, `mainline lifecycle action ${String(action.key)} effects`)
      .map(effectKey => effects.find(effect => effect.key === effectKey)!)
      .some(effect => effect.operation === 'transition-quest' && mainlineQuestKeys.has(String(row(effect.payload, `mainline lifecycle effect ${String(effect.key)}.payload`).questKey)))
    if (touchesMainline && strings(action.requirementConditionKeys, `mainline lifecycle action ${String(action.key)} requirements`).some(conditionKey => relationshipConditionKeys.has(conditionKey))) {
      fail(`主线生命周期Action不能由道德、阵营或态度条件锁定:${String(action.key)}`)
    }
  })
  if (crimeActionModule !== crimeRelationships) fail('Action v8必须与Relationship v3一起发布')
  if (crimeActionModule) {
    const actionCrimeRows = actionRows.filter(action => ['steal', 'deceive', 'crime'].includes(String(action.category)))
    requireSameKeys(crimeActions.map(item => String(item.actionKey)), actionCrimeRows.map(item => String(item.key)), '犯罪定义与Action覆盖')
    const crimeActionKeys = new Set(actionCrimeRows.map(action => String(action.key)))
    const crimeEffectKeys = new Set(crimeActions.flatMap(crime => {
      const action = actionRows.find(item => item.key === crime.actionKey)!
      return [
        ...strings(action.costEffectKeys, `crime action ${String(crime.key)} costEffectKeys`),
        ...strings(action.successEffectKeys, `crime action ${String(crime.key)} successEffectKeys`),
        ...strings(action.failureEffectKeys, `crime action ${String(crime.key)} failureEffectKeys`),
        ...strings(crime.witnessedEffectKeys, `crime action ${String(crime.key)} witnessedEffectKeys`),
      ]
    }))
    actionRows.filter(action => !crimeActionKeys.has(String(action.key))).forEach(action => {
      const referencedEffectKeys = [
        ...strings(action.costEffectKeys, `action ${String(action.key)} costEffectKeys`),
        ...strings(action.successEffectKeys, `action ${String(action.key)} successEffectKeys`),
        ...strings(action.failureEffectKeys, `action ${String(action.key)} failureEffectKeys`),
      ]
      if (referencedEffectKeys.some(effectKey => crimeEffectKeys.has(effectKey))) {
        fail(`犯罪专用Effect不能被非犯罪Action引用:${String(action.key)}`)
      }
    })
    const witnessedEffectOwners = new Map<string, string>()
    crimeActions.forEach(crime => {
      const action = actionRows.find(item => item.key === crime.actionKey)!
      const label = `crime action ${String(crime.key)}`
      const locationKeys = strings(action.locationKeys, `${label}.locationKeys`)
      const costEffectKeys = strings(action.costEffectKeys, `${label}.costEffectKeys`)
      const successEffectKeys = strings(action.successEffectKeys, `${label}.successEffectKeys`)
      const failureEffectKeys = strings(action.failureEffectKeys, `${label}.failureEffectKeys`)
      const witnessedEffectKeys = strings(crime.witnessedEffectKeys, `${label}.witnessedEffectKeys`)
      if (action.category !== crime.kind || action.actorScope !== 'player' || action.targetScope !== 'actor'
        || locationKeys.length !== 1 || locationKeys[0] !== crime.locationKey
        || action.confirmationPolicy === 'never' || action.repeatPolicy !== 'once'
        || action.cooldownMinutes != null || action.timeCostMinutes !== 0
        || !successEffectKeys.length || !failureEffectKeys.length || !witnessedEffectKeys.length) fail(`${label}合同无效`)
      const allEffectKeys = [...costEffectKeys, ...successEffectKeys, ...failureEffectKeys, ...witnessedEffectKeys]
      if (new Set(allEffectKeys).size !== allEffectKeys.length) fail(`${label}各分支Effect不能重复`)
      const allowedOperations = new Set(['change-morality', 'change-faction-affinity', 'grant-item', 'set-world-flag', 'reveal-knowledge'])
      allEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!).forEach(effect => {
        if (!allowedOperations.has(String(effect.operation))) fail(`${label}包含首版犯罪边界外Effect:${String(effect.key)}`)
        if (effect.operation === 'change-morality' && Number(row(effect.payload, `${label}.${String(effect.key)}.payload`).amount) >= 0) {
          fail(`${label}不能通过犯罪提高或刷取道德:${String(effect.key)}`)
        }
      })
      for (const branch of [successEffectKeys, failureEffectKeys]) {
        if (!branch.map(effectKey => effects.find(effect => effect.key === effectKey)!).some(effect => effect.operation === 'change-morality')) {
          fail(`${label}成功和失败分支都必须记录负向道德后果`)
        }
      }
      if (crime.kind === 'steal' && !successEffectKeys.map(effectKey => effects.find(effect => effect.key === effectKey)!).some(effect => effect.operation === 'grant-item')) {
        fail(`${label}偷窃成功分支必须产生预制物品结果`)
      }
      witnessedEffectKeys.forEach(effectKey => {
        const operation = effects.find(effect => effect.key === effectKey)?.operation
        if (ownerActionAchievementCount > 0
          && (operation === 'reveal-knowledge' || operation === 'earn-achievement')) {
          fail(`owner-action Knowledge或成就Effect不能作为犯罪目击后果:${effectKey}`)
        }
        if (witnessedEffectOwners.has(effectKey)) fail(`目击后果Effect不能被多个犯罪定义共享:${effectKey}`)
        witnessedEffectOwners.set(effectKey, String(crime.key))
        if (actionRows.some(candidate => [...strings(candidate.costEffectKeys, `action ${String(candidate.key)} costs`), ...strings(candidate.successEffectKeys, `action ${String(candidate.key)} success`), ...strings(candidate.failureEffectKeys, `action ${String(candidate.key)} failure`)].includes(effectKey))) {
          fail(`目击后果Effect不能静态绑定到Action分支:${effectKey}`)
        }
      })
    })
  }
  if (!travelPointKeys.size) fail('首版至少需要一个快速旅行点')

  return {
    narrative: structuredClone(narrative) as unknown as TextOpenWorldParsedModulesV1['narrative'],
    world: normalizedWorld,
    actors: {
      ...structuredClone(actors), version: 3,
      actors: structuredClone(actorRows), schedules: structuredClone(schedules), serviceContinuity: structuredClone(serviceContinuityRows),
    } as unknown as TextOpenWorldParsedModulesV1['actors'],
    quests: { ...structuredClone(quests), version: 2, quests: structuredClone(questRows), stages: structuredClone(questStages) } as unknown as TextOpenWorldParsedModulesV1['quests'],
    actions: structuredClone(actions) as unknown as TextOpenWorldParsedModulesV1['actions'],
    progression: (structuredProgressionModule
      ? { ...structuredClone(progression), sourceVersion: 2, skills: structuredClone(skills), statuses: structuredClone(statuses) }
      : structuredClone(progression)) as unknown as TextOpenWorldParsedModulesV1['progression'],
    combat: normalizedCombat,
    items: structuredClone(items) as unknown as TextOpenWorldParsedModulesV1['items'],
    crafting: normalizedCrafting,
    economy: structuredClone(normalizedEconomy),
    relationships: {
      ...structuredClone(relationships), version: crimeRelationships ? 3 : 2, unaffiliatedMoralityMultiplier,
      factionMorality: structuredClone(factionMorality), attitudeBands: structuredClone(attitudeBands), crimeActions: structuredClone(crimeActions),
    } as unknown as TextOpenWorldParsedModulesV1['relationships'],
    'time-weather': { ...structuredClone(timeWeather), weatherUpdateIntervalMinutes } as unknown as TextOpenWorldParsedModulesV1['time-weather'],
    director: structuredClone(normalizedDirector),
    knowledge: structuredClone(knowledge) as unknown as TextOpenWorldParsedModulesV1['knowledge'],
    presentation: {
      ...structuredClone(presentation), version: 2, mapLayout,
    } as unknown as TextOpenWorldParsedModulesV1['presentation'],
  }
}
