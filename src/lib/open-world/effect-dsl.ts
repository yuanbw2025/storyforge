import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import type {
  TextOpenWorldEffectChangeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectImpactDomainV1,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectReceiptV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldActorScheduleSettlementAuthorizationV1,
  TextOpenWorldFastTravelAuthorizationV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldObjectiveAuthorizationV1,
  TextOpenWorldQuestTransitionAuthorizationV1,
  TextOpenWorldQuestTrackingAuthorizationV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldWeatherSettlementAuthorizationV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { createTextOpenWorldObjectiveCatalogV1, type TextOpenWorldObjectiveCatalogV1 } from './objective-state'
import { createTextOpenWorldQuestTrackingCatalogV1, type TextOpenWorldQuestTrackingCatalogV1 } from './quest-tracking'
import {
  createTextOpenWorldItemInstanceIdV1,
  deriveTextOpenWorldEquippedItemKeysV1,
} from './inventory'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'
import { levelForTextOpenWorldExperienceV1 } from './progression'
import {
  createTextOpenWorldQuestTransitionCatalogV1,
  type TextOpenWorldQuestTransitionCatalogV1,
} from './quest-state-machine'
import { createTextOpenWorldQuestInstanceKeyV1 } from './quests'
import { createTextOpenWorldFastTravelCatalogV1, type TextOpenWorldFastTravelCatalogV1 } from './fast-travel'
import { createTextOpenWorldWeatherCatalogV1, type TextOpenWorldWeatherCatalogV1 } from './weather'
import {
  createTextOpenWorldActorLifecycleCatalogV1,
  createTextOpenWorldActorScheduleCatalogV1,
  type TextOpenWorldActorLifecycleCatalogV1,
  type TextOpenWorldActorScheduleCatalogV1,
} from './actors'
import { createTextOpenWorldCrimeCatalogV1 } from './crime'
import {
  createTextOpenWorldCombatStateMachineV1,
  validateTextOpenWorldCombatRuntimeStateV1,
} from './combat-state-machine'
import { createTextOpenWorldCombatActionCatalogV1 } from './combat-actions'
import { createTextOpenWorldCraftingCatalogV1 } from './crafting'
import { createTextOpenWorldEconomyCatalogV1 } from './economy'

type Row = Record<string, unknown>
type Refs = ReturnType<typeof references>

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const CLAIM_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const QUEST_STATUSES: TextOpenWorldQuestStatusV1[] = ['locked', 'available', 'revealed', 'accepted', 'active', 'suspended', 'completed', 'failed', 'expired', 'abandoned', 'withdrawn']

function fail(message: string): never { throw new Error(`[text-open-world-effect] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) {
  const expected = [...fields].sort(); const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`)
}
function key(value: unknown, label: string, pattern = KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(`${label}无效`); return value.trim() }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label}必须是boolean`); return value }
function boolOrNull(value: unknown, label: string): boolean | null { if (value !== null && typeof value !== 'boolean') fail(`${label}必须是boolean或null`); return value }
function numberValue(value: unknown, label: string, minimum = -1_000_000_000_000, maximum = 1_000_000_000_000): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label}数值无效`); return value }
function int(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const parsed = numberValue(value, label, minimum, maximum); if (!Number.isSafeInteger(parsed)) fail(`${label}必须是安全整数`); return parsed }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T { if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}无效`); return value as T }
function nullableRef(value: unknown, set: ReadonlySet<string>, label: string): string | null { if (value === null) return null; return ref(value, set, label) }
function ref(value: unknown, set: ReadonlySet<string>, label: string): string { const parsed = key(value, label); if (!set.has(parsed)) fail(`${label}引用不存在:${parsed}`); return parsed }
function scalar(value: unknown, label: string): string | number | boolean | null { if (value == null || typeof value === 'boolean') return value as boolean | null; if (typeof value === 'number') return numberValue(value, label); if (typeof value === 'string' && value.length <= 1000) return value.normalize('NFC'); fail(`${label}必须是JSON标量`) }

function references(modules: TextOpenWorldParsedModulesV1) {
  const set = (items: Array<{ key: string }>) => new Set(items.map(item => item.key))
  return {
    items: set(modules.items.items), skills: set(modules.progression.skills), statuses: set(modules.progression.statuses), recipes: set(modules.crafting.recipes),
    quests: set(modules.quests.quests), questStages: set(modules.quests.stages), objectives: set(modules.quests.objectives),
    locations: set(modules.world.locations), travelPoints: set(modules.world.fastTravelPoints),
    respawnPoints: set(modules.world.fastTravelPoints.filter(point => point.canRespawn)), edges: set(modules.world.edges),
    factions: set(modules.actors.factions), actors: set(modules.actors.actors), regions: set(modules.world.regions),
    encounters: set(modules.combat.encounters), knowledge: set(modules.knowledge.entries), endings: set(modules.narrative.endings), rewards: set(modules.items.rewardContracts), vendors: set(modules.economy.vendors),
    rumors: set(modules.knowledge.rumors), achievements: set(modules.knowledge.achievements), weather: set(modules['time-weather'].weather),
    questStageOwner: new Map(modules.quests.stages.map(item => [item.key, item.questKey])),
    actorLifecycle: modules.actions.version >= 7,
  }
}

function parseDefinition(value: unknown, refs: Refs, label: string): TextOpenWorldEffectDefinitionV1 {
  const definition = row(value, label); exact(definition, ['key', 'operation', 'payload'], label)
  const effectKey = key(definition.key, `${label}.key`); const operation = typeof definition.operation === 'string' ? definition.operation : fail(`${label}.operation无效`); const payload = row(definition.payload, `${label}.payload`)
  if (operation === 'change-player-resource') { exact(payload, ['resource', 'amount'], `${label}.payload`); return { key: effectKey, operation, payload: { resource: enumValue(payload.resource, ['health', 'skill-resource'], `${label}.resource`), amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'grant-experience') { exact(payload, ['amount'], `${label}.payload`); return { key: effectKey, operation, payload: { amount: int(payload.amount, `${label}.amount`, 1) } } }
  if (operation === 'apply-status' || operation === 'remove-status') { exact(payload, ['statusKey'], `${label}.payload`); return { key: effectKey, operation, payload: { statusKey: ref(payload.statusKey, refs.statuses, `${label}.statusKey`) } } }
  if (operation === 'grant-item') { exact(payload, ['itemKey', 'quantity'], `${label}.payload`); return { key: effectKey, operation, payload: { itemKey: ref(payload.itemKey, refs.items, `${label}.itemKey`), quantity: int(payload.quantity, `${label}.quantity`, 1, 1_000_000) } } }
  if (operation === 'remove-item') { exact(payload, ['itemKey', 'quantity', 'reason'], `${label}.payload`); return { key: effectKey, operation, payload: { itemKey: ref(payload.itemKey, refs.items, `${label}.itemKey`), quantity: int(payload.quantity, `${label}.quantity`, 1, 1_000_000), reason: enumValue(payload.reason, ['consume', 'drop', 'sell', 'craft'], `${label}.reason`) } } }
  if (operation === 'equip-item' || operation === 'unequip-item') { exact(payload, ['itemKey'], `${label}.payload`); return { key: effectKey, operation, payload: { itemKey: ref(payload.itemKey, refs.items, `${label}.itemKey`) } } }
  if (operation === 'learn-skill') { exact(payload, ['skillKey'], `${label}.payload`); return { key: effectKey, operation, payload: { skillKey: ref(payload.skillKey, refs.skills, `${label}.skillKey`) } } }
  if (operation === 'learn-recipe') { exact(payload, ['recipeKey'], `${label}.payload`); return { key: effectKey, operation, payload: { recipeKey: ref(payload.recipeKey, refs.recipes, `${label}.recipeKey`) } } }
  if (operation === 'change-currency') { exact(payload, ['amount'], `${label}.payload`); return { key: effectKey, operation, payload: { amount: int(payload.amount, `${label}.amount`, -1_000_000_000, 1_000_000_000) } } }
  if (operation === 'transition-quest') {
    exact(payload, ['questKey', 'status', 'stageKey'], `${label}.payload`); const questKey = ref(payload.questKey, refs.quests, `${label}.questKey`); const stageKey = nullableRef(payload.stageKey, refs.questStages, `${label}.stageKey`)
    if (stageKey && refs.questStageOwner.get(stageKey) !== questKey) fail(`${label}.stageKey不属于questKey`)
    return { key: effectKey, operation, payload: { questKey, status: enumValue(payload.status, QUEST_STATUSES, `${label}.status`), stageKey } }
  }
  if (operation === 'complete-objective') { exact(payload, ['objectiveKey'], `${label}.payload`); return { key: effectKey, operation, payload: { objectiveKey: ref(payload.objectiveKey, refs.objectives, `${label}.objectiveKey`) } } }
  if (operation === 'claim-quest-reward') { exact(payload, ['questKey', 'rewardKey'], `${label}.payload`); return { key: effectKey, operation, payload: { questKey: ref(payload.questKey, refs.quests, `${label}.questKey`), rewardKey: ref(payload.rewardKey, refs.rewards, `${label}.rewardKey`) } } }
  if (operation === 'track-quest' || operation === 'untrack-quest') { exact(payload, ['slot'], `${label}.payload`); return { key: effectKey, operation, payload: { slot: enumValue(payload.slot, ['primary', 'pinned'], `${label}.slot`) } } }
  if (operation === 'change-morality') { exact(payload, ['amount'], `${label}.payload`); return { key: effectKey, operation, payload: { amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'change-faction-affinity') { exact(payload, ['factionKey', 'amount'], `${label}.payload`); return { key: effectKey, operation, payload: { factionKey: ref(payload.factionKey, refs.factions, `${label}.factionKey`), amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'set-story-modifier') { exact(payload, ['actorKey', 'value'], `${label}.payload`); return { key: effectKey, operation, payload: { actorKey: ref(payload.actorKey, refs.actors, `${label}.actorKey`), value: numberValue(payload.value, `${label}.value`) } } }
  if (operation === 'reveal-knowledge') { exact(payload, ['knowledgeKey', 'visibility'], `${label}.payload`); return { key: effectKey, operation, payload: { knowledgeKey: ref(payload.knowledgeKey, refs.knowledge, `${label}.knowledgeKey`), visibility: enumValue(payload.visibility, ['rumor', 'known'], `${label}.visibility`) } } }
  if (operation === 'reveal-location' || operation === 'enter-location') { exact(payload, ['locationKey'], `${label}.payload`); return { key: effectKey, operation, payload: { locationKey: ref(payload.locationKey, refs.locations, `${label}.locationKey`) } } }
  if (operation === 'unlock-fast-travel') { exact(payload, ['fastTravelPointKey'], `${label}.payload`); return { key: effectKey, operation, payload: { fastTravelPointKey: ref(payload.fastTravelPointKey, refs.travelPoints, `${label}.fastTravelPointKey`) } } }
  if (operation === 'start-travel') { exact(payload, ['edgeKey', 'destinationLocationKey'], `${label}.payload`); return { key: effectKey, operation, payload: { edgeKey: ref(payload.edgeKey, refs.edges, `${label}.edgeKey`), destinationLocationKey: ref(payload.destinationLocationKey, refs.locations, `${label}.destinationLocationKey`) } } }
  if (operation === 'fast-travel') {
    exact(payload, ['timeRatioNumerator', 'timeRatioDenominator', 'minimumMinutes'], `${label}.payload`)
    const timeRatioNumerator = int(payload.timeRatioNumerator, `${label}.timeRatioNumerator`, 1, 1_000_000)
    const timeRatioDenominator = int(payload.timeRatioDenominator, `${label}.timeRatioDenominator`, 1, 1_000_000)
    if (timeRatioNumerator > timeRatioDenominator) fail(`${label}耗时比例不能高于普通路线`)
    return { key: effectKey, operation, payload: { timeRatioNumerator, timeRatioDenominator, minimumMinutes: int(payload.minimumMinutes, `${label}.minimumMinutes`, 1, 1_000_000) } }
  }
  if (operation === 'advance-time') { exact(payload, ['minutes'], `${label}.payload`); return { key: effectKey, operation, payload: { minutes: int(payload.minutes, `${label}.minutes`, 1, 1_000_000_000) } } }
  if (operation === 'settle-weather') { exact(payload, [], `${label}.payload`); return { key: effectKey, operation, payload: {} } }
  if (operation === 'settle-actor-schedules') { exact(payload, [], `${label}.payload`); return { key: effectKey, operation, payload: {} } }
  if (operation === 'start-combat') { exact(payload, ['encounterKey'], `${label}.payload`); return { key: effectKey, operation, payload: { encounterKey: ref(payload.encounterKey, refs.encounters, `${label}.encounterKey`) } } }
  if (operation === 'resolve-combat') { exact(payload, ['encounterKey', 'outcome'], `${label}.payload`); return { key: effectKey, operation, payload: { encounterKey: ref(payload.encounterKey, refs.encounters, `${label}.encounterKey`), outcome: enumValue(payload.outcome, ['victory', 'defeat', 'escaped'], `${label}.outcome`) } } }
  if (operation === 'initialize-combat') { exact(payload, ['encounterKey'], `${label}.payload`); return { key: effectKey, operation, payload: { encounterKey: ref(payload.encounterKey, refs.encounters, `${label}.encounterKey`) } } }
  if (operation === 'settle-combat-state') { exact(payload, [], `${label}.payload`); return { key: effectKey, operation, payload: {} } }
  if (operation === 'perform-combat-action') {
    exact(payload, ['kind', 'skillKey', 'itemKey'], `${label}.payload`)
    const kind = enumValue(payload.kind, ['basic-attack', 'skill', 'item', 'escape', 'enemy-skill'], `${label}.kind`)
    const skillKey = payload.skillKey == null ? null : ref(payload.skillKey, refs.skills, `${label}.skillKey`)
    const itemKey = payload.itemKey == null ? null : ref(payload.itemKey, refs.items, `${label}.itemKey`)
    if (['basic-attack', 'skill', 'enemy-skill'].includes(kind) !== (skillKey != null) || (kind === 'item') !== (itemKey != null)) fail(`${label}.payload与kind不一致`)
    return { key: effectKey, operation, payload: { kind, skillKey, itemKey } }
  }
  if (operation === 'perform-crafting') { exact(payload, ['recipeKey'], `${label}.payload`); return { key: effectKey, operation, payload: { recipeKey: ref(payload.recipeKey, refs.recipes, `${label}.recipeKey`) } } }
  if (operation === 'perform-transaction') { exact(payload, ['kind', 'vendorKey'], `${label}.payload`); return { key: effectKey, operation, payload: { kind: enumValue(payload.kind, ['buy', 'sell'], `${label}.kind`), vendorKey: ref(payload.vendorKey, refs.vendors, `${label}.vendorKey`) } } }
  if (operation === 'rest') { exact(payload, ['healthRatio', 'skillResourceRatio', 'clearHarmfulStatuses'], `${label}.payload`); return { key: effectKey, operation, payload: { healthRatio: numberValue(payload.healthRatio, `${label}.healthRatio`, 0.000001, 1), skillResourceRatio: numberValue(payload.skillResourceRatio, `${label}.skillResourceRatio`, 0, 1), clearHarmfulStatuses: bool(payload.clearHarmfulStatuses, `${label}.clearHarmfulStatuses`) } } }
  if (operation === 'respawn') { exact(payload, ['fastTravelPointKey', 'healthRatio'], `${label}.payload`); return { key: effectKey, operation, payload: { fastTravelPointKey: ref(payload.fastTravelPointKey, refs.respawnPoints, `${label}.fastTravelPointKey`), healthRatio: numberValue(payload.healthRatio, `${label}.healthRatio`, 0.000001, 1) } } }
  if (operation === 'change-actor-state') {
    exact(payload, refs.actorLifecycle
      ? ['actorKey', 'alive', 'present', 'locationKey', 'cause']
      : ['actorKey', 'alive', 'present', 'locationKey'], `${label}.payload`)
    const alive = boolOrNull(payload.alive, `${label}.alive`); const present = boolOrNull(payload.present, `${label}.present`); const locationKey = nullableRef(payload.locationKey, refs.locations, `${label}.locationKey`)
    if (alive == null && present == null && locationKey == null) fail(`${label}至少改变一个Actor字段`)
    const cause = refs.actorLifecycle
      ? enumValue(payload.cause, ['player-attack', 'story', 'random-event', 'resolution'], `${label}.cause`)
      : 'legacy-system'
    return { key: effectKey, operation, payload: { actorKey: ref(payload.actorKey, refs.actors, `${label}.actorKey`), alive, present, locationKey, cause } }
  }
  if (operation === 'change-region-state') { exact(payload, ['regionKey', 'state'], `${label}.payload`); return { key: effectKey, operation, payload: { regionKey: ref(payload.regionKey, refs.regions, `${label}.regionKey`), state: text(payload.state, `${label}.state`) } } }
  if (operation === 'set-world-flag') { exact(payload, ['flagKey', 'value'], `${label}.payload`); return { key: effectKey, operation, payload: { flagKey: key(payload.flagKey, `${label}.flagKey`), value: scalar(payload.value, `${label}.value`) } } }
  if (operation === 'earn-achievement') { exact(payload, ['achievementKey'], `${label}.payload`); return { key: effectKey, operation, payload: { achievementKey: ref(payload.achievementKey, refs.achievements, `${label}.achievementKey`) } } }
  if (operation === 'unlock-ending' || operation === 'reach-ending') { exact(payload, ['endingKey'], `${label}.payload`); return { key: effectKey, operation, payload: { endingKey: ref(payload.endingKey, refs.endings, `${label}.endingKey`) } } }
  fail(`${label}.operation不在白名单:${operation}`)
}

function addUnique(values: string[], value: string) { if (!values.includes(value)) values.push(value) }
function remove(values: string[], value: string) { const index = values.indexOf(value); if (index >= 0) values.splice(index, 1) }
function effectDomains(operation: TextOpenWorldEffectDefinitionV1['operation']): TextOpenWorldEffectImpactDomainV1[] {
  if (operation === 'perform-crafting') return ['inventory', 'time']
  if (operation === 'perform-transaction') return ['inventory', 'economy']
  if (operation === 'respawn') return ['combat', 'player', 'map']
  if (operation === 'resolve-combat' || operation === 'settle-combat-state' || operation === 'perform-combat-action') return ['combat', 'player']
  if (['change-player-resource', 'grant-experience', 'apply-status', 'remove-status', 'learn-skill', 'rest'].includes(operation)) return ['player']
  if (['grant-item', 'remove-item', 'equip-item', 'unequip-item', 'learn-recipe', 'change-currency'].includes(operation)) return ['inventory']
  if (['transition-quest', 'complete-objective', 'claim-quest-reward', 'track-quest', 'untrack-quest'].includes(operation)) return ['quests']
  if (operation === 'fast-travel') return ['map', 'time']
  if (['reveal-location', 'unlock-fast-travel', 'enter-location', 'start-travel'].includes(operation)) return ['map']
  if (operation === 'advance-time' || operation === 'settle-weather') return ['time']
  if (operation === 'settle-actor-schedules') return ['actors', 'time']
  if (['change-morality', 'change-faction-affinity', 'set-story-modifier'].includes(operation)) return ['relationships']
  if (operation === 'start-combat' || operation === 'initialize-combat') return ['combat']
  if (operation === 'change-actor-state') return ['actors']
  if (['change-region-state', 'set-world-flag'].includes(operation)) return ['world']
  if (operation === 'reveal-knowledge' || operation === 'earn-achievement') return ['knowledge']
  return ['endings']
}

function record(changes: TextOpenWorldEffectChangeV1[], effect: TextOpenWorldEffectDefinitionV1, summary: string, before: unknown, after: unknown) {
  changes.push({ effectKey: effect.key, domain: effectDomains(effect.operation)[0], operation: effect.operation, summary, before: structuredClone(before), after: structuredClone(after) })
}

function assertUniqueKnown(values: string[], known: ReadonlySet<string>, label: string) {
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  values.forEach(value => { if (!known.has(value)) fail(`${label}引用不存在:${value}`) })
}

export function validateTextOpenWorldEffectStateV1(state: TextOpenWorldEffectStateV1, modules: TextOpenWorldParsedModulesV1) {
  if (state.version !== 1) fail('EffectState版本无效')
  const refs = references(modules)
  const maxLevel = modules.progression.rules.maximumLevel
  int(state.player.level, 'player.level', 1, maxLevel); int(state.player.experience, 'player.experience'); numberValue(state.player.health, 'player.health', 0, state.player.maximumHealth); numberValue(state.player.maximumHealth, 'player.maximumHealth', 1); numberValue(state.player.skillResource, 'player.skillResource', 0, state.player.maximumSkillResource); numberValue(state.player.maximumSkillResource, 'player.maximumSkillResource', 0)
  Object.values(state.player.attributes).forEach(value => numberValue(value, 'player attribute', 0))
  const maximumExperience = modules.progression.levels[maxLevel - 1].cumulativeExperience
  if (state.player.experience > maximumExperience) fail('player.experience超过最高等级阈值')
  const expectedLevel = levelForTextOpenWorldExperienceV1(modules, state.player.experience)
  if (state.player.level !== expectedLevel) fail('player.level与经验阈值不一致')
  const expectedAttributes = structuredClone(modules.actors.player.build.attributes)
  for (let level = modules.actors.player.build.initialLevel + 1; level <= state.player.level; level += 1) {
    const growth = modules.progression.levels[level - 1].attributeGrowth
    expectedAttributes.power += growth.power; expectedAttributes.vitality += growth.vitality; expectedAttributes.agility += growth.agility
  }
  if (canonicalProductProductionJsonV2(state.player.attributes) !== canonicalProductProductionJsonV2(expectedAttributes)) fail('player.attributes与自动成长曲线不一致')
  const derivedStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes,
    equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory),
  })
  if (state.player.maximumHealth !== derivedStats.maximumHealth || state.player.maximumSkillResource !== derivedStats.maximumSkillResource) fail('player资源上限与Release公式不一致')
  assertUniqueKnown(state.player.learnedSkillKeys, refs.skills, 'player.learnedSkillKeys')
  assertUniqueKnown(state.player.statusKeys, refs.statuses, 'player.statusKeys')
  for (const [itemKey, value] of Object.entries(state.inventory.stackQuantities)) {
    ref(itemKey, refs.items, 'inventory stack itemKey'); const definition = modules.items.items.find(item => item.key === itemKey)!
    if (definition.stackPolicy !== 'stacked') fail(`实例物品不能进入stackQuantities:${itemKey}`)
    int(value, 'inventory stack quantity', 1, definition.maximumStack!)
  }
  const instanceCountByItemKey: Record<string, number> = {}
  for (const [instanceId, rawInstance] of Object.entries(state.inventory.itemInstances)) {
    if (!/^instance\.[A-Za-z0-9][A-Za-z0-9._:-]{0,259}$/.test(instanceId)) fail(`物品实例ID无效:${instanceId}`)
    const instance = row(rawInstance, `itemInstances.${instanceId}`); exact(instance, ['itemKey', 'acquiredByClaimKey', 'stateTags'], `itemInstances.${instanceId}`)
    const itemKey = ref(instance.itemKey, refs.items, `itemInstances.${instanceId}.itemKey`)
    const definition = modules.items.items.find(item => item.key === itemKey)!
    if (definition.stackPolicy !== 'instanced') fail(`堆叠物品不能进入itemInstances:${itemKey}`)
    key(instance.acquiredByClaimKey, `itemInstances.${instanceId}.acquiredByClaimKey`, CLAIM_KEY)
    const stateTags = Array.isArray(instance.stateTags) ? instance.stateTags.map(tag => key(tag, `itemInstances.${instanceId}.stateTag`)) : fail(`itemInstances.${instanceId}.stateTags无效`)
    if (new Set(stateTags).size !== stateTags.length) fail(`itemInstances.${instanceId}.stateTags不能重复`)
    instanceCountByItemKey[itemKey] = (instanceCountByItemKey[itemKey] ?? 0) + 1
  }
  for (const item of modules.items.items) if (item.unique && (instanceCountByItemKey[item.key] ?? 0) > 1) fail(`唯一物品重复持有:${item.key}`)
  const equippedInstanceIds = Object.values(state.inventory.equippedItemInstanceIdBySlot).filter((value): value is string => value != null)
  if (new Set(equippedInstanceIds).size !== equippedInstanceIds.length) fail('同一物品实例不能占据多个装备位')
  for (const [slot, instanceId] of Object.entries(state.inventory.equippedItemInstanceIdBySlot)) {
    if (!['weapon', 'armor', 'accessory'].includes(slot)) fail(`未知装备位:${slot}`)
    if (instanceId == null) continue
    const instance = state.inventory.itemInstances[instanceId]
    const definition = instance && modules.items.items.find(candidate => candidate.key === instance.itemKey)
    if (!definition || definition.kind !== 'equipment' || definition.equipmentSlotKey !== slot) fail(`装备状态无效:${slot}`)
  }
  assertUniqueKnown(state.inventory.knownRecipeKeys, refs.recipes, 'inventory.knownRecipeKeys')
  int(state.inventory.currency, 'inventory.currency', 0, 1_000_000_000)
  const economyState = row(state.economy, 'economy')
  exact(economyState, ['limitedStockQuantitiesByVendorKey'], 'economy')
  const limitedStockByVendor = row(state.economy.limitedStockQuantitiesByVendorKey, 'economy.limitedStockQuantitiesByVendorKey')
  if (canonicalProductProductionJsonV2(Object.keys(limitedStockByVendor).sort()) !== canonicalProductProductionJsonV2(modules.economy.vendors.map(vendor => vendor.key).sort())) fail('有限库存状态必须覆盖全部商店')
  modules.economy.vendors.forEach(vendor => {
    const vendorStock = row(limitedStockByVendor[vendor.key], `economy.${vendor.key}`)
    const requiredFiniteKeys = vendor.inventoryEntries.filter(entry => entry.stockPolicy === 'limited').map(entry => entry.itemKey)
    requiredFiniteKeys.forEach(itemKey => {
      if (!Object.prototype.hasOwnProperty.call(vendorStock, itemKey)) fail(`商店有限库存状态缺失:${vendor.key}:${itemKey}`)
    })
    for (const [itemKey, quantity] of Object.entries(vendorStock)) {
      ref(itemKey, refs.items, `economy.${vendor.key}.itemKey`)
      int(quantity, `economy.${vendor.key}.${itemKey}`, 0, 1_000_000)
      const item = modules.items.items.find(candidate => candidate.key === itemKey)!
      const entry = vendor.inventoryEntries.find(candidate => candidate.itemKey === itemKey)
      if (entry?.stockPolicy === 'unlimited') fail(`无限供应商品不能写入有限库存状态:${vendor.key}:${itemKey}`)
      if (!entry && (!item.sellable || item.critical || item.kind === 'quest' || !vendor.sellCategories.includes(item.kind as never))) fail(`商店运行库存包含不可收购物品:${vendor.key}:${itemKey}`)
    }
  })
  const questState = row(state.quests, 'quests'); exact(questState, ['instancesByKey', 'resultTags', 'tracking'], 'quests')
  const releaseInstanceCountByDefinition = new Map<string, number>()
  const sourceRefs = new Set<string>()
  const questInstances = row(state.quests.instancesByKey, 'quests.instancesByKey')
  for (const [instanceKey, rawInstance] of Object.entries(questInstances)) {
    const instance = row(rawInstance, `quests.instancesByKey.${instanceKey}`)
    exact(instance, ['instanceKey', 'definitionKey', 'sourceKind', 'sourceInstanceKey', 'sourceContentHash', 'status', 'currentStageKey', 'objectiveStatusByKey', 'createdAtWorldMinute', 'offeredAtWorldMinute', 'acceptedAtWorldMinute', 'deadlineWorldMinute', 'terminalAtWorldMinute', 'rewardClaimKey', 'resultTag'], `quests.instancesByKey.${instanceKey}`)
    if (instance.instanceKey !== instanceKey) fail(`任务实例记录键与instanceKey不一致:${instanceKey}`)
    const definitionKey = ref(instance.definitionKey, refs.quests, `quests.${instanceKey}.definitionKey`)
    const definition = modules.quests.quests.find(candidate => candidate.key === definitionKey)!
    const sourceKind = enumValue(instance.sourceKind, ['release', 'director'], `quests.${instanceKey}.sourceKind`)
    const sourceInstanceKey = key(instance.sourceInstanceKey, `quests.${instanceKey}.sourceInstanceKey`, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/)
    if (createTextOpenWorldQuestInstanceKeyV1({ definitionKey, sourceKind, sourceInstanceKey }) !== instanceKey) fail(`任务实例ID不是稳定派生值:${instanceKey}`)
    const sourceRef = sourceKind === 'release' ? `${sourceKind}:${definitionKey}:${sourceInstanceKey}` : `${sourceKind}:${sourceInstanceKey}`
    if (sourceRefs.has(sourceRef)) fail(`任务实例来源重复:${sourceRef}`)
    sourceRefs.add(sourceRef)
    if (typeof instance.sourceContentHash !== 'string' || !isSha256Hash(instance.sourceContentHash)) fail(`quests.${instanceKey}.sourceContentHash无效`)
    if (sourceKind === 'release') {
      if (definition.instantiationPolicy !== 'session-start' || sourceInstanceKey !== 'session-start') fail(`Release任务实例来源无效:${instanceKey}`)
      releaseInstanceCountByDefinition.set(definitionKey, (releaseInstanceCountByDefinition.get(definitionKey) ?? 0) + 1)
    } else if (definition.type !== 'template' || definition.instantiationPolicy !== 'director') fail(`Director只能实例化模板任务:${instanceKey}`)
    const status = enumValue(instance.status, QUEST_STATUSES, `quests.${instanceKey}.status`)
    const currentStageKey = instance.currentStageKey == null ? null : ref(instance.currentStageKey, refs.questStages, `quests.${instanceKey}.currentStageKey`)
    if (currentStageKey && refs.questStageOwner.get(currentStageKey) !== definitionKey) fail(`任务实例Stage归属无效:${instanceKey}`)
    const objectiveStates = row(instance.objectiveStatusByKey, `quests.${instanceKey}.objectiveStatusByKey`)
    const expectedObjectiveKeys = definition.stageKeys.flatMap(stageKey => modules.quests.stages.find(stage => stage.key === stageKey)!.objectiveKeys)
    if (canonicalProductProductionJsonV2(Object.keys(objectiveStates).sort()) !== canonicalProductProductionJsonV2([...expectedObjectiveKeys].sort())) fail(`任务实例Objective闭集不一致:${instanceKey}`)
    for (const [objectiveKey, objectiveStatus] of Object.entries(objectiveStates)) enumValue(objectiveStatus, ['inactive', 'active', 'completed', 'failed'], `quests.${instanceKey}.objective:${objectiveKey}`)
    const orderedStages = definition.stageKeys.map(stageKey => modules.quests.stages.find(stage => stage.key === stageKey)!).sort((left, right) => left.order - right.order)
    const currentStageIndex = currentStageKey == null ? -1 : orderedStages.findIndex(stage => stage.key === currentStageKey)
    if (currentStageKey != null && currentStageIndex < 0) fail(`任务实例currentStage不属于定义:${instanceKey}`)
    if (['locked', 'available', 'revealed', 'accepted'].includes(status)
      && Object.values(objectiveStates).some(objectiveStatus => objectiveStatus !== 'inactive')) fail(`未激活任务的Objective必须全部inactive:${instanceKey}`)
    orderedStages.forEach((stage, stageIndex) => {
      stage.objectiveKeys.forEach(objectiveKey => {
        const objectiveStatus = objectiveStates[objectiveKey]
        if (currentStageIndex >= 0 && stageIndex > currentStageIndex && objectiveStatus !== 'inactive') fail(`未来Stage的Objective必须inactive:${instanceKey}:${objectiveKey}`)
        if (['active', 'suspended'].includes(status) && stageIndex === currentStageIndex && objectiveStatus === 'inactive') fail(`当前Stage的Objective不能inactive:${instanceKey}:${objectiveKey}`)
        if (currentStageIndex >= 0 && stageIndex < currentStageIndex && !['completed', 'failed'].includes(String(objectiveStatus))) fail(`已通过Stage的Objective必须终结:${instanceKey}:${objectiveKey}`)
      })
    })
    if (status === 'completed') {
      if (currentStageIndex !== orderedStages.length - 1) fail(`completed任务必须停在最终Stage:${instanceKey}`)
      const required = orderedStages[currentStageIndex].objectiveKeys.filter(objectiveKey => !modules.quests.objectives.find(objective => objective.key === objectiveKey)!.optional)
      if (required.some(objectiveKey => objectiveStates[objectiveKey] !== 'completed')) fail(`completed任务仍有未完成必需Objective:${instanceKey}`)
    }
    const createdAt = int(instance.createdAtWorldMinute, `quests.${instanceKey}.createdAtWorldMinute`)
    const nullableMinute = (value: unknown, label: string) => value == null ? null : int(value, label)
    const offeredAt = nullableMinute(instance.offeredAtWorldMinute, `quests.${instanceKey}.offeredAtWorldMinute`)
    const acceptedAt = nullableMinute(instance.acceptedAtWorldMinute, `quests.${instanceKey}.acceptedAtWorldMinute`)
    const deadline = nullableMinute(instance.deadlineWorldMinute, `quests.${instanceKey}.deadlineWorldMinute`)
    const terminalAt = nullableMinute(instance.terminalAtWorldMinute, `quests.${instanceKey}.terminalAtWorldMinute`)
    if ([offeredAt, acceptedAt, terminalAt].some(value => value != null && (value < createdAt || value > state.time.worldMinute))) fail(`任务实例时间顺序无效:${instanceKey}`)
    if (deadline != null && deadline < createdAt) fail(`任务实例deadline早于创建时间:${instanceKey}`)
    if (['locked', 'available'].includes(status) && offeredAt != null) fail(`${status}任务不能已有offeredAt:${instanceKey}`)
    if (['revealed', 'accepted', 'active', 'suspended'].includes(status) && offeredAt == null) fail(`${status}任务缺少offeredAt:${instanceKey}`)
    if (['accepted', 'active', 'suspended'].includes(status) && acceptedAt == null) fail(`${status}任务缺少acceptedAt:${instanceKey}`)
    if (['active', 'suspended'].includes(status) && currentStageKey == null) fail(`${status}任务缺少Stage:${instanceKey}`)
    if (['locked', 'available', 'revealed'].includes(status) && acceptedAt != null) fail(`${status}任务不能已有acceptedAt:${instanceKey}`)
    if (['locked', 'available', 'revealed', 'accepted'].includes(status) && currentStageKey != null) fail(`${status}任务不能已有Stage:${instanceKey}`)
    if (!['completed', 'failed', 'expired', 'abandoned', 'withdrawn'].includes(status) && terminalAt != null) fail(`非终态任务不能已有terminalAt:${instanceKey}`)
    if (['completed', 'failed', 'expired', 'abandoned', 'withdrawn'].includes(status) && terminalAt == null) fail(`终态任务缺少terminalAt:${instanceKey}`)
    if (['completed', 'failed'].includes(status) && (offeredAt == null || acceptedAt == null || currentStageKey == null)) fail(`${status}任务缺少完整进行记录:${instanceKey}`)
    if (definition.timePolicy === 'waits' && deadline != null) fail(`等待玩家任务不能设置deadline:${instanceKey}`)
    if (definition.timePolicy === 'timed' && offeredAt != null && deadline == null) fail(`已揭示限时任务缺少deadline:${instanceKey}`)
    if (instance.rewardClaimKey != null) {
      key(instance.rewardClaimKey, `quests.${instanceKey}.rewardClaimKey`, CLAIM_KEY)
      if (status !== 'completed' || definition.rewardContractKey == null) fail(`只有完成且有奖励的任务能够记录领取凭证:${instanceKey}`)
    }
    if (instance.resultTag != null) key(instance.resultTag, `quests.${instanceKey}.resultTag`)
  }
  for (const definition of modules.quests.quests.filter(item => item.instantiationPolicy === 'session-start')) {
    if (releaseInstanceCountByDefinition.get(definition.key) !== 1) fail(`正式任务必须恰好有一个Release实例:${definition.key}`)
  }
  if (new Set(state.quests.resultTags).size !== state.quests.resultTags.length || state.quests.resultTags.some(tag => !KEY.test(tag))) fail('quests.resultTags无效')
  const tracking = row(state.quests.tracking, 'quests.tracking'); exact(tracking, ['primaryInstanceKey', 'pinnedInstanceKeys'], 'quests.tracking')
  const primaryInstanceKey = tracking.primaryInstanceKey == null ? null : key(tracking.primaryInstanceKey, 'quests.tracking.primaryInstanceKey')
  const pinnedInstanceKeys = Array.isArray(tracking.pinnedInstanceKeys)
    ? tracking.pinnedInstanceKeys.map((value, index) => key(value, `quests.tracking.pinnedInstanceKeys[${index}]`))
    : fail('quests.tracking.pinnedInstanceKeys必须是数组')
  if (pinnedInstanceKeys.length > 3 || new Set(pinnedInstanceKeys).size !== pinnedInstanceKeys.length) fail('HUD任务钉选必须唯一且最多3个')
  if (primaryInstanceKey && !state.quests.instancesByKey[primaryInstanceKey]) fail('主追踪任务实例不存在')
  if (primaryInstanceKey && pinnedInstanceKeys.includes(primaryInstanceKey)) fail('主追踪任务不能同时钉选')
  pinnedInstanceKeys.forEach(instanceKey => { if (!state.quests.instancesByKey[instanceKey]) fail(`钉选任务实例不存在:${instanceKey}`) })
  assertUniqueKnown(state.map.revealedLocationKeys, refs.locations, 'map.revealedLocationKeys')
  for (const [regionKey, knowledge] of Object.entries(state.map.regionKnowledgeByKey)) { ref(regionKey, refs.regions, 'region knowledge key'); enumValue(knowledge, ['unknown', 'heard', 'visited', 'familiar'], `region knowledge:${regionKey}`) }
  const locationKnowledgeEntries = Object.entries(state.map.locationKnowledgeByKey)
  if (locationKnowledgeEntries.length !== modules.world.locations.length) fail('locationKnowledgeByKey必须覆盖全部冻结地点')
  const knowledgeRank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
  for (const [locationKey, knowledge] of locationKnowledgeEntries) {
    ref(locationKey, refs.locations, 'location knowledge key')
    enumValue(knowledge, ['unknown', 'heard', 'visited', 'familiar'], `location knowledge:${locationKey}`)
    const regionKey = modules.world.locations.find(location => location.key === locationKey)!.regionKey
    if (knowledgeRank[knowledge] > knowledgeRank[state.map.regionKnowledgeByKey[regionKey] ?? 'unknown']) fail(`地点认知不能高于所属地区:${locationKey}`)
  }
  const expectedRevealedLocationKeys = locationKnowledgeEntries.filter(([, knowledge]) => knowledge !== 'unknown').map(([locationKey]) => locationKey).sort()
  if (canonicalProductProductionJsonV2([...state.map.revealedLocationKeys].sort()) !== canonicalProductProductionJsonV2(expectedRevealedLocationKeys)) fail('revealedLocationKeys必须由地点认知派生')
  assertUniqueKnown(state.map.unlockedFastTravelPointKeys, refs.travelPoints, 'map.unlockedFastTravelPointKeys')
  for (const pointKey of state.map.unlockedFastTravelPointKeys) {
    const locationKey = modules.world.fastTravelPoints.find(point => point.key === pointKey)!.locationKey
    if (knowledgeRank[state.map.locationKnowledgeByKey[locationKey] ?? 'unknown'] < knowledgeRank.visited) fail(`快速旅行点所属地点尚未到访:${pointKey}`)
  }
  assertUniqueKnown(state.map.openEdgeKeys, refs.edges, 'map.openEdgeKeys')
  int(state.time.worldMinute, 'time.worldMinute')
  const currentWeatherEpoch = Math.floor(state.time.worldMinute / modules['time-weather'].weatherUpdateIntervalMinutes)
  const lastWeatherSettlementEpoch = int(state.time.lastWeatherSettlementEpoch, 'time.lastWeatherSettlementEpoch')
  if (lastWeatherSettlementEpoch > currentWeatherEpoch) fail('最近天气结算周期不能晚于当前世界时间')
  const minuteInDay = state.time.worldMinute % modules['time-weather'].minutesPerDay
  const currentPeriod = modules['time-weather'].timePeriods.find(period => minuteInDay >= period.startMinute && minuteInDay < period.endMinute)
    ?? fail('当前世界时间无法映射时间段')
  const currentPeriodStart = Math.floor(state.time.worldMinute / modules['time-weather'].minutesPerDay) * modules['time-weather'].minutesPerDay + currentPeriod.startMinute
  const lastActorScheduleSettlementWorldMinute = int(state.time.lastActorScheduleSettlementWorldMinute, 'time.lastActorScheduleSettlementWorldMinute')
  if (lastActorScheduleSettlementWorldMinute > currentPeriodStart) fail('最近角色日程结算不能晚于当前时间段起点')
  if (canonicalProductProductionJsonV2(Object.keys(state.time.currentWeatherByRegionKey).sort()) !== canonicalProductProductionJsonV2(modules.world.regions.map(region => region.key).sort())) fail('currentWeatherByRegionKey必须覆盖全部冻结地区')
  for (const [regionKey, weatherKey] of Object.entries(state.time.currentWeatherByRegionKey)) { ref(regionKey, refs.regions, 'weather region key'); ref(weatherKey, refs.weather, 'weather key') }
  for (const [deadlineKey, deadline] of Object.entries(state.time.deadlineWorldMinuteByKey)) { key(deadlineKey, 'deadline key'); int(deadline, `deadline:${deadlineKey}`) }
  exact(row(state.relationships, 'relationships'), ['morality', 'factionAffinityByKey', 'storyModifierByActorKey'], 'relationships')
  numberValue(state.relationships.morality, 'relationships.morality', modules.relationships.morality.minimum, modules.relationships.morality.maximum)
  if (canonicalProductProductionJsonV2(Object.keys(state.relationships.factionAffinityByKey).sort()) !== canonicalProductProductionJsonV2(modules.actors.factions.map(faction => faction.key).sort())) fail('factionAffinityByKey必须覆盖全部冻结阵营')
  for (const [factionKey, value] of Object.entries(state.relationships.factionAffinityByKey)) { ref(factionKey, refs.factions, 'faction affinity key'); numberValue(value, 'faction affinity', modules.relationships.factionAffinity.minimum, modules.relationships.factionAffinity.maximum) }
  for (const [actorKey, value] of Object.entries(state.relationships.storyModifierByActorKey)) { ref(actorKey, refs.actors, 'story modifier actor'); numberValue(value, 'story modifier', -modules.relationships.attitude.explicitStoryModifierCap, modules.relationships.attitude.explicitStoryModifierCap) }
  if (state.combat) ref(state.combat.encounterKey, refs.encounters, 'combat encounterKey')
  validateTextOpenWorldCombatRuntimeStateV1({ modules, state })
  const defeated = state.combat?.status === 'defeat'
  const pendingDefeat = state.combat && 'version' in state.combat
    && state.combat.status === 'active' && state.combat.phase === 'action-resolved' && state.player.health === 0
  if ((state.player.health === 0) !== (defeated || Boolean(pendingDefeat))) fail('生命为0必须处于战败或待战败结算状态')
  for (const actorDefinition of modules.actors.actors) if (!state.actors[actorDefinition.key]) fail(`Actor运行状态缺失:${actorDefinition.key}`)
  for (const [actorKey, actor] of Object.entries(state.actors)) { ref(actorKey, refs.actors, 'actors key'); if (typeof actor.alive !== 'boolean' || typeof actor.present !== 'boolean' || (!actor.alive && actor.present)) fail(`actors.${actorKey}生存/在场状态无效`); ref(actor.locationKey, refs.locations, `actors.${actorKey}.locationKey`); text(actor.scheduleState, `actors.${actorKey}.scheduleState`) }
  for (const [regionKey, regionState] of Object.entries(state.world.regionStateByKey)) { ref(regionKey, refs.regions, 'region state key'); text(regionState, `region state:${regionKey}`) }
  for (const [regionKey, pressure] of Object.entries(state.world.regionPressureByKey)) { ref(regionKey, refs.regions, 'region pressure key'); numberValue(pressure, `region pressure:${regionKey}`) }
  for (const [factionKey, factionState] of Object.entries(state.world.factionStateByKey)) { ref(factionKey, refs.factions, 'faction state key'); text(factionState, `faction state:${factionKey}`) }
  for (const [endingKey, eligible] of Object.entries(state.world.endingEligibleByKey)) { ref(endingKey, refs.endings, 'ending eligible key'); if (typeof eligible !== 'boolean') fail(`ending eligible:${endingKey}必须是boolean`) }
  for (const [knowledgeKey, visibility] of Object.entries(state.knowledge.visibilityByKey)) { ref(knowledgeKey, refs.knowledge, 'knowledge key'); enumValue(visibility, ['hidden', 'rumor', 'known'], `knowledge visibility:${knowledgeKey}`) }
  assertUniqueKnown(state.knowledge.readRumorKeys, refs.rumors, 'knowledge.readRumorKeys')
  assertUniqueKnown(state.knowledge.earnedAchievementKeys, refs.achievements, 'knowledge.earnedAchievementKeys')
  assertUniqueKnown(state.endings.unlockedKeys, refs.endings, 'endings.unlockedKeys')
  if (state.endings.reachedKey != null && (!refs.endings.has(state.endings.reachedKey) || !state.endings.unlockedKeys.includes(state.endings.reachedKey))) fail('reached ending无效')
  if (new Set(state.appliedClaimKeys).size !== state.appliedClaimKeys.length || state.appliedClaimKeys.some(item => !CLAIM_KEY.test(item))) fail('appliedClaimKeys无效')
  for (const [instanceId, instance] of Object.entries(state.inventory.itemInstances)) {
    if (instance.acquiredByClaimKey !== 'initial-build' && !state.appliedClaimKeys.includes(instance.acquiredByClaimKey)) {
      fail(`物品实例获得来源没有正式claim证据:${instanceId}`)
    }
  }
  if (!modules.world.locations.some(item => item.key === state.map.currentLocationKey)) fail('currentLocationKey不存在')
  if (knowledgeRank[state.map.locationKnowledgeByKey[state.map.currentLocationKey] ?? 'unknown'] < knowledgeRank.visited) fail('当前位置必须已经到访')
  if (state.map.travel) {
    const edge = modules.world.edges.find(candidate => candidate.key === state.map.travel!.edgeKey) ?? fail('travel edgeKey不存在')
    const directionAllowed = edge.fromLocationKey === state.map.currentLocationKey && edge.toLocationKey === state.map.travel.destinationLocationKey
      || edge.bidirectional && edge.toLocationKey === state.map.currentLocationKey && edge.fromLocationKey === state.map.travel.destinationLocationKey
    if (!directionAllowed) fail('travel状态端点或方向无效')
  }
}

function synchronizePlayerResourceCaps(state: TextOpenWorldEffectStateV1, modules: TextOpenWorldParsedModulesV1) {
  const before = { maximumHealth: state.player.maximumHealth, maximumSkillResource: state.player.maximumSkillResource }
  const derived = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes,
    equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory),
  })
  state.player.health = Math.min(derived.maximumHealth, Math.max(0, state.player.health + derived.maximumHealth - before.maximumHealth))
  state.player.skillResource = Math.min(derived.maximumSkillResource, Math.max(0, state.player.skillResource + derived.maximumSkillResource - before.maximumSkillResource))
  state.player.maximumHealth = derived.maximumHealth
  state.player.maximumSkillResource = derived.maximumSkillResource
}

function recalculateEquipmentResourceCaps(state: TextOpenWorldEffectStateV1, modules: TextOpenWorldParsedModulesV1) {
  const derived = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes,
    equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory),
  })
  state.player.health = Math.min(state.player.health, derived.maximumHealth)
  state.player.skillResource = Math.min(state.player.skillResource, derived.maximumSkillResource)
  state.player.maximumHealth = derived.maximumHealth
  state.player.maximumSkillResource = derived.maximumSkillResource
}

function applyDefinitions(
  stateValue: TextOpenWorldEffectStateV1,
  effects: TextOpenWorldEffectDefinitionV1[],
  claimKey: string,
  modules: TextOpenWorldParsedModulesV1,
  authorization: TextOpenWorldEffectPlanV1['authorization'],
  questTransitions: TextOpenWorldQuestTransitionCatalogV1,
  objectives: TextOpenWorldObjectiveCatalogV1,
  tracking: TextOpenWorldQuestTrackingCatalogV1,
  fastTravel: TextOpenWorldFastTravelCatalogV1,
  weather: TextOpenWorldWeatherCatalogV1,
  actorSchedules: TextOpenWorldActorScheduleCatalogV1,
  actorLifecycle: TextOpenWorldActorLifecycleCatalogV1,
  crime: ReturnType<typeof createTextOpenWorldCrimeCatalogV1>,
  combatState: ReturnType<typeof createTextOpenWorldCombatStateMachineV1>,
  combatActions: ReturnType<typeof createTextOpenWorldCombatActionCatalogV1>,
  crafting: ReturnType<typeof createTextOpenWorldCraftingCatalogV1>,
  economy: ReturnType<typeof createTextOpenWorldEconomyCatalogV1>,
) {
  validateTextOpenWorldEffectStateV1(stateValue, modules)
  if (stateValue.appliedClaimKeys.includes(claimKey)) fail(`claim已应用:${claimKey}`)
  const state = structuredClone(stateValue); const changes: TextOpenWorldEffectChangeV1[] = []
  const item = (itemKey: string) => modules.items.items.find(candidate => candidate.key === itemKey) ?? fail(`物品不存在:${itemKey}`)
  const questTransitionEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'transition-quest' }> => effect.operation === 'transition-quest')
  const questTransitionPositions = effects.flatMap((effect, index) => effect.operation === 'transition-quest' ? [index] : [])
  if (questTransitionEffects.length) {
    if (authorization?.kind !== 'quest-transition') fail('任务状态Effect缺少QuestTransition授权')
    if (questTransitionEffects.length !== authorization.transitions.length) fail('任务状态Effect与授权步数不一致')
    if (questTransitionPositions[questTransitionPositions.length - 1] - questTransitionPositions[0] + 1 !== questTransitionPositions.length) fail('同一任务迁移序列必须连续执行')
    questTransitionEffects.forEach((effect, index) => {
      const step = authorization.transitions[index]
      if (effect.payload.questKey !== authorization.definitionKey || effect.payload.status !== step.toStatus || effect.payload.stageKey !== step.stageKey) fail(`任务状态Effect与授权不一致:${effect.key}`)
    })
  } else if (authorization?.kind === 'quest-transition') fail('QuestTransition授权没有对应任务状态Effect')
  const objectiveEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'complete-objective' }> => effect.operation === 'complete-objective')
  if (objectiveEffects.length) {
    if (objectiveEffects.length !== 1 || authorization?.kind !== 'quest-objective') fail('Objective状态Effect缺少唯一实例授权')
    if (objectiveEffects[0].payload.objectiveKey !== authorization.objectiveKey) fail('Objective状态Effect与授权不一致')
  } else if (authorization?.kind === 'quest-objective') fail('Objective授权没有对应状态Effect')
  const trackingEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'track-quest' | 'untrack-quest' }> => effect.operation === 'track-quest' || effect.operation === 'untrack-quest')
  if (trackingEffects.length) {
    if (trackingEffects.length !== 1 || authorization?.kind !== 'quest-tracking') fail('任务追踪Effect缺少唯一实例授权')
    const expectedOperation = trackingEffects[0].operation === 'track-quest' ? 'track' : 'untrack'
    if (authorization.operation !== expectedOperation || authorization.slot !== trackingEffects[0].payload.slot) fail('任务追踪Effect与授权不一致')
  } else if (authorization?.kind === 'quest-tracking') fail('任务追踪授权没有对应状态Effect')
  const fastTravelEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'fast-travel' }> => effect.operation === 'fast-travel')
  if (fastTravelEffects.length) {
    if (fastTravelEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'fast-travel') fail('快速旅行Effect缺少唯一命令授权')
    fastTravel.assertAuthorization({ state: stateValue, effect: fastTravelEffects[0], authorization })
  } else if (authorization?.kind === 'fast-travel') fail('快速旅行授权没有对应Effect')
  const weatherEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-weather' }> => effect.operation === 'settle-weather')
  if (weatherEffects.length) {
    if (weatherEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'weather-settlement') fail('天气结算Effect缺少唯一命令授权')
    weather.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'weather-settlement') fail('天气结算授权没有对应Effect')
  const actorScheduleEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-actor-schedules' }> => effect.operation === 'settle-actor-schedules')
  if (actorScheduleEffects.length) {
    if (actorScheduleEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'actor-schedule-settlement') fail('角色日程结算Effect缺少唯一命令授权')
    actorSchedules.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'actor-schedule-settlement') fail('角色日程结算授权没有对应Effect')
  const crimeEffectKeys = new Set(modules.relationships.crimeActions.flatMap(crimeDefinition => {
    const action = modules.actions.actions.find(candidate => candidate.key === crimeDefinition.actionKey)!
    return [...action.costEffectKeys, ...action.successEffectKeys, ...action.failureEffectKeys, ...crimeDefinition.witnessedEffectKeys]
  }))
  const includesCrimeEffect = effects.some(effect => crimeEffectKeys.has(effect.key))
  if (authorization?.kind === 'crime') {
    if (!includesCrimeEffect || canonicalProductProductionJsonV2(authorization.effectKeys) !== canonicalProductProductionJsonV2(effects.map(effect => effect.key))) {
      fail('犯罪授权与Effect集合不一致')
    }
    crime.assertAuthorization({ authorization, state: stateValue })
  } else if (includesCrimeEffect) fail('犯罪Effect缺少犯罪授权')
  const combatSettlementEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-combat-state' }> => effect.operation === 'settle-combat-state')
  if (combatSettlementEffects.length) {
    if (combatSettlementEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'combat-transition') fail('战斗阶段Effect缺少唯一CombatTransition授权')
    combatState.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'combat-transition') fail('CombatTransition授权没有对应Effect')
  const combatActionEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> => effect.operation === 'perform-combat-action')
  if (combatActionEffects.length) {
    if (combatActionEffects.length !== 1 || authorization?.kind !== 'combat-action') fail('战斗行动Effect缺少唯一CombatAction授权')
    if (canonicalProductProductionJsonV2(authorization.effectKeys) !== canonicalProductProductionJsonV2(effects.map(effect => effect.key))) fail('战斗行动授权与Effect集合不一致')
    combatActions.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'combat-action') fail('CombatAction授权没有对应Effect')
  const craftingEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-crafting' }> => effect.operation === 'perform-crafting')
  if (craftingEffects.length) {
    if (craftingEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'crafting') fail('制作Effect缺少唯一Crafting授权')
    if (craftingEffects[0].payload.recipeKey !== authorization.recipeKey) fail('制作Effect与配方授权不一致')
    crafting.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'crafting') fail('Crafting授权没有对应Effect')
  const transactionEffects = effects.filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-transaction' }> => effect.operation === 'perform-transaction')
  if (transactionEffects.length) {
    if (transactionEffects.length !== 1 || effects.length !== 1 || authorization?.kind !== 'transaction') fail('交易Effect缺少唯一Transaction授权')
    if (transactionEffects[0].payload.kind !== authorization.transactionKind || transactionEffects[0].payload.vendorKey !== authorization.vendorKey) fail('交易Effect与授权不一致')
    economy.assertAuthorization({ state: stateValue, authorization })
  } else if (authorization?.kind === 'transaction') fail('Transaction授权没有对应Effect')
  let questTransitionsApplied = false
  for (const effect of effects) {
    switch (effect.operation) {
      case 'change-player-resource': {
        const { payload } = effect
        const field = payload.resource === 'health' ? 'health' : 'skillResource'
        const maximum = payload.resource === 'health' ? state.player.maximumHealth : state.player.maximumSkillResource
        const before = state.player[field]
        const after = before + payload.amount
        if (after < 0 || after > maximum) fail(`${effect.key}会让${payload.resource}越界`)
        state.player[field] = after
        record(changes, effect, `玩家${payload.resource}变化${payload.amount}`, before, after)
        break
      }
      case 'grant-experience': {
        const { payload } = effect
        const before = {
          experience: state.player.experience, level: state.player.level, attributes: structuredClone(state.player.attributes),
          health: state.player.health, maximumHealth: state.player.maximumHealth,
          skillResource: state.player.skillResource, maximumSkillResource: state.player.maximumSkillResource,
          learnedSkillKeys: [...state.player.learnedSkillKeys],
        }
        const maximumExperience = modules.progression.levels[modules.progression.rules.maximumLevel - 1].cumulativeExperience
        const appliedExperience = Math.min(payload.amount, maximumExperience - state.player.experience)
        state.player.experience += appliedExperience
        const nextLevel = levelForTextOpenWorldExperienceV1(modules, state.player.experience)
        for (let level = state.player.level + 1; level <= nextLevel; level += 1) {
          const growth = modules.progression.levels[level - 1].attributeGrowth
          state.player.attributes.power += growth.power
          state.player.attributes.vitality += growth.vitality
          state.player.attributes.agility += growth.agility
          modules.progression.levels[level - 1].unlockedSkillKeys.forEach(skillKey => addUnique(state.player.learnedSkillKeys, skillKey))
        }
        state.player.level = Math.min(nextLevel, modules.progression.rules.maximumLevel)
        synchronizePlayerResourceCaps(state, modules)
        record(changes, effect, `获得${appliedExperience}经验${appliedExperience < payload.amount ? `（${payload.amount - appliedExperience}点因满级封顶未计入）` : ''}`, before, {
          experience: state.player.experience, level: state.player.level, attributes: structuredClone(state.player.attributes),
          health: state.player.health, maximumHealth: state.player.maximumHealth,
          skillResource: state.player.skillResource, maximumSkillResource: state.player.maximumSkillResource,
          learnedSkillKeys: [...state.player.learnedSkillKeys], appliedExperience, discardedExperience: payload.amount - appliedExperience,
        })
        break
      }
      case 'apply-status':
      case 'remove-status': {
        const { payload } = effect
        const before = state.player.statusKeys.includes(payload.statusKey)
        if (effect.operation === 'apply-status') {
          if (before) fail(`${effect.key}不能重复施加已有状态`)
          addUnique(state.player.statusKeys, payload.statusKey)
        } else {
          if (!before) fail(`${effect.key}不能移除不存在的状态`)
          remove(state.player.statusKeys, payload.statusKey)
        }
        record(changes, effect, `${effect.operation}:${payload.statusKey}`, before, state.player.statusKeys.includes(payload.statusKey))
        break
      }
      case 'grant-item':
      case 'remove-item': {
        const { payload } = effect
        const removalReason = effect.operation === 'remove-item' ? effect.payload.reason : null
        const definition = item(payload.itemKey)
        if (effect.operation === 'remove-item') {
          if (definition.critical) fail(`${effect.key}不能移除关键物品`)
          if (removalReason === 'consume' && !definition.consumable) fail(`${effect.key}目标不是消耗品`)
          if (removalReason === 'drop' && !definition.droppable) fail(`${effect.key}目标不可丢弃`)
          if (removalReason === 'sell' && !definition.sellable) fail(`${effect.key}目标不可出售`)
        }
        if (definition.stackPolicy === 'stacked') {
          const before = state.inventory.stackQuantities[payload.itemKey] ?? 0
          const after = before + (effect.operation === 'grant-item' ? payload.quantity : -payload.quantity)
          if (after < 0 || after > definition.maximumStack!) fail(`${effect.key}物品堆叠数量无效`)
          if (after === 0) delete state.inventory.stackQuantities[payload.itemKey]
          else state.inventory.stackQuantities[payload.itemKey] = after
          record(changes, effect, `${effect.operation}:${payload.itemKey}:${removalReason ?? 'grant'}`, before, after)
        } else {
          const before = Object.entries(state.inventory.itemInstances).filter(([, instance]) => instance.itemKey === payload.itemKey).map(([instanceId]) => instanceId).sort()
          if (effect.operation === 'grant-item') {
            if (definition.unique && (before.length > 0 || payload.quantity > 1)) fail(`${effect.key}会重复授予唯一物品`)
            for (let ordinal = 1; ordinal <= payload.quantity; ordinal += 1) {
              const instanceId = createTextOpenWorldItemInstanceIdV1({ appliedClaimCount: state.appliedClaimKeys.length, effectKey: effect.key, ordinal })
              if (state.inventory.itemInstances[instanceId]) fail(`${effect.key}物品实例ID冲突`)
              state.inventory.itemInstances[instanceId] = { itemKey: payload.itemKey, acquiredByClaimKey: claimKey, stateTags: ['new'] }
            }
          } else {
            const equipped = new Set(Object.values(state.inventory.equippedItemInstanceIdBySlot).filter((value): value is string => value != null))
            const removable = before.filter(instanceId => !equipped.has(instanceId))
            if (removable.length < payload.quantity) fail(`${effect.key}未装备物品实例数量不足`)
            removable.slice(0, payload.quantity).forEach(instanceId => { delete state.inventory.itemInstances[instanceId] })
          }
          const after = Object.entries(state.inventory.itemInstances).filter(([, instance]) => instance.itemKey === payload.itemKey).map(([instanceId]) => instanceId).sort()
          record(changes, effect, `${effect.operation}:${payload.itemKey}:${removalReason ?? 'grant'}`, before, after)
        }
        break
      }
      case 'equip-item':
      case 'unequip-item': {
        const { payload } = effect
        const definition = item(payload.itemKey)
        if (definition.kind !== 'equipment' || !definition.equipmentSlotKey) fail(`${effect.key}目标不是装备`)
        const slot = definition.equipmentSlotKey
        const matchingInstances = Object.entries(state.inventory.itemInstances)
          .filter(([, instance]) => instance.itemKey === payload.itemKey).map(([instanceId]) => instanceId).sort()
        const before = {
          itemInstanceId: state.inventory.equippedItemInstanceIdBySlot[slot], health: state.player.health,
          maximumHealth: state.player.maximumHealth, skillResource: state.player.skillResource,
          maximumSkillResource: state.player.maximumSkillResource,
        }
        if (effect.operation === 'equip-item') {
          const alreadyEquipped = new Set(Object.values(state.inventory.equippedItemInstanceIdBySlot).filter((value): value is string => value != null))
          const instanceId = matchingInstances.find(candidate => !alreadyEquipped.has(candidate))
          if (!instanceId) fail(`${effect.key}没有未装备的目标物品实例`)
          state.inventory.equippedItemInstanceIdBySlot[slot] = instanceId
        } else {
          const equippedInstanceId = before.itemInstanceId
          if (!equippedInstanceId || state.inventory.itemInstances[equippedInstanceId]?.itemKey !== payload.itemKey) fail(`${effect.key}目标未装备`)
          state.inventory.equippedItemInstanceIdBySlot[slot] = null
        }
        recalculateEquipmentResourceCaps(state, modules)
        record(changes, effect, `${effect.operation}:${payload.itemKey}`, before, {
          itemInstanceId: state.inventory.equippedItemInstanceIdBySlot[slot], health: state.player.health,
          maximumHealth: state.player.maximumHealth, skillResource: state.player.skillResource,
          maximumSkillResource: state.player.maximumSkillResource,
        })
        break
      }
      case 'learn-skill': {
        const { payload } = effect; const before = state.player.learnedSkillKeys.includes(payload.skillKey)
        if (before) fail(`${effect.key}不能重复学习已有技能`)
        addUnique(state.player.learnedSkillKeys, payload.skillKey); record(changes, effect, `学习技能:${payload.skillKey}`, before, true); break
      }
      case 'learn-recipe': {
        const { payload } = effect; const before = state.inventory.knownRecipeKeys.includes(payload.recipeKey)
        addUnique(state.inventory.knownRecipeKeys, payload.recipeKey); record(changes, effect, `学习配方:${payload.recipeKey}`, before, true); break
      }
      case 'change-currency': {
        const { payload } = effect; const before = state.inventory.currency; const after = before + payload.amount
        if (after < 0 || after > 1_000_000_000) fail(`${effect.key}货币越界`)
        state.inventory.currency = after; record(changes, effect, `货币变化${payload.amount}`, before, after); break
      }
      case 'transition-quest': {
        if (questTransitionsApplied) break
        const questAuthorization = authorization as TextOpenWorldQuestTransitionAuthorizationV1
        const transitionChanges = questTransitions.apply({ state, authorization: questAuthorization })
        transitionChanges.forEach((change, index) => record(
          changes,
          questTransitionEffects[index],
          `任务实例${questAuthorization.instanceKey}变为${questAuthorization.transitions[index].toStatus}`,
          change.before,
          change.after,
        ))
        questTransitionsApplied = true
        break
      }
      case 'complete-objective': {
        const objectiveAuthorization = authorization as TextOpenWorldObjectiveAuthorizationV1
        const change = objectives.apply({ state, authorization: objectiveAuthorization })
        record(changes, effect, `完成任务实例目标:${objectiveAuthorization.instanceKey}:${objectiveAuthorization.objectiveKey}`, change.before, change.after); break
      }
      case 'claim-quest-reward': {
        const { payload } = effect
        if (authorization?.kind !== 'reward' || authorization.rewardKey !== payload.rewardKey) fail(`${effect.key}缺少对应Reward授权`)
        const instance = state.quests.instancesByKey[authorization.sourceInstanceKey] ?? fail(`${effect.key}任务实例不存在`)
        if (instance.definitionKey !== payload.questKey || instance.status !== 'completed' || instance.rewardClaimKey != null) fail(`${effect.key}任务奖励当前不可领取`)
        const before = instance.rewardClaimKey
        instance.rewardClaimKey = claimKey
        record(changes, effect, `任务实例奖励已领取:${instance.instanceKey}`, before, claimKey); break
      }
      case 'track-quest':
      case 'untrack-quest': {
        const trackingAuthorization = authorization as TextOpenWorldQuestTrackingAuthorizationV1
        const change = tracking.apply({ state, authorization: trackingAuthorization })
        record(changes, effect, `${effect.operation === 'track-quest' ? '追踪' : '取消追踪'}任务实例:${trackingAuthorization.instanceKey}:${trackingAuthorization.slot}`, change.before, change.after); break
      }
      case 'change-morality': {
        const { payload } = effect; const before = state.relationships.morality; const rawAfter = before + payload.amount
        const after = authorization?.kind === 'crime' && authorization.effectKeys.includes(effect.key)
          ? Math.max(modules.relationships.morality.minimum, Math.min(modules.relationships.morality.maximum, rawAfter))
          : rawAfter
        numberValue(after, `${effect.key} morality`, modules.relationships.morality.minimum, modules.relationships.morality.maximum)
        state.relationships.morality = after; record(changes, effect, `道德变化${after - before}`, before, after); break
      }
      case 'change-faction-affinity': {
        const { payload } = effect; const before = state.relationships.factionAffinityByKey[payload.factionKey] ?? modules.relationships.factionAffinity.initial; const rawAfter = before + payload.amount
        const after = authorization?.kind === 'crime' && authorization.effectKeys.includes(effect.key)
          ? Math.max(modules.relationships.factionAffinity.minimum, Math.min(modules.relationships.factionAffinity.maximum, rawAfter))
          : rawAfter
        numberValue(after, `${effect.key} affinity`, modules.relationships.factionAffinity.minimum, modules.relationships.factionAffinity.maximum)
        state.relationships.factionAffinityByKey[payload.factionKey] = after; record(changes, effect, `阵营亲合度变化${after - before}`, before, after); break
      }
      case 'set-story-modifier': {
        const { payload } = effect; const before = state.relationships.storyModifierByActorKey[payload.actorKey] ?? 0
        if (Math.abs(payload.value) > modules.relationships.attitude.explicitStoryModifierCap) fail(`${effect.key}故事修正越界`)
        state.relationships.storyModifierByActorKey[payload.actorKey] = payload.value; record(changes, effect, '设置角色故事修正', before, payload.value); break
      }
      case 'reveal-knowledge': {
        const { payload } = effect; const rank = { hidden: 0, rumor: 1, known: 2 }; const before = state.knowledge.visibilityByKey[payload.knowledgeKey] ?? 'hidden'
        if (rank[payload.visibility] < rank[before]) fail(`${effect.key}不能降低知识可见性`)
        state.knowledge.visibilityByKey[payload.knowledgeKey] = payload.visibility; record(changes, effect, `揭示知识:${payload.knowledgeKey}`, before, payload.visibility); break
      }
      case 'reveal-location': {
        const { payload } = effect; const before = state.map.locationKnowledgeByKey[payload.locationKey] ?? 'unknown'
        const rank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
        if (rank[before] < rank.heard) state.map.locationKnowledgeByKey[payload.locationKey] = 'heard'
        addUnique(state.map.revealedLocationKeys, payload.locationKey)
        const regionKey = modules.world.locations.find(location => location.key === payload.locationKey)!.regionKey
        if (rank[state.map.regionKnowledgeByKey[regionKey] ?? 'unknown'] < rank.heard) state.map.regionKnowledgeByKey[regionKey] = 'heard'
        record(changes, effect, `听说地点:${payload.locationKey}`, before, state.map.locationKnowledgeByKey[payload.locationKey]); break
      }
      case 'unlock-fast-travel': {
        const { payload } = effect; const before = state.map.unlockedFastTravelPointKeys.includes(payload.fastTravelPointKey)
        const point = modules.world.fastTravelPoints.find(candidate => candidate.key === payload.fastTravelPointKey)!
        const knowledge = state.map.locationKnowledgeByKey[point.locationKey] ?? 'unknown'
        if (knowledge !== 'visited' && knowledge !== 'familiar') fail(`${effect.key}不能解锁尚未到访地点的快速旅行点`)
        addUnique(state.map.unlockedFastTravelPointKeys, payload.fastTravelPointKey); record(changes, effect, `解锁快速旅行:${payload.fastTravelPointKey}`, before, true); break
      }
      case 'enter-location': {
        const { payload } = effect; const before = state.map.currentLocationKey
        if (state.map.travel && state.map.travel.destinationLocationKey !== payload.locationKey) fail(`${effect.key}到达地点与进行中旅行不一致`)
        state.map.currentLocationKey = payload.locationKey; state.map.travel = null; addUnique(state.map.revealedLocationKeys, payload.locationKey)
        state.map.locationKnowledgeByKey[payload.locationKey] = 'visited'
        const regionKey = modules.world.locations.find(location => location.key === payload.locationKey)!.regionKey
        const rank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
        if (rank[state.map.regionKnowledgeByKey[regionKey] ?? 'unknown'] < rank.visited) state.map.regionKnowledgeByKey[regionKey] = 'visited'
        modules.world.fastTravelPoints.filter(point => point.locationKey === payload.locationKey).forEach(point => addUnique(state.map.unlockedFastTravelPointKeys, point.key))
        record(changes, effect, `进入地点:${payload.locationKey}`, before, payload.locationKey); break
      }
      case 'start-travel': {
        const { payload } = effect
        if (state.map.travel) fail(`${effect.key}已有进行中的旅行`)
        const edge = modules.world.edges.find(candidate => candidate.key === payload.edgeKey)!
        if (!state.map.openEdgeKeys.includes(payload.edgeKey)) fail(`${effect.key}道路当前未开放`)
        const directionAllowed = edge.fromLocationKey === state.map.currentLocationKey && edge.toLocationKey === payload.destinationLocationKey
          || edge.bidirectional && edge.toLocationKey === state.map.currentLocationKey && edge.fromLocationKey === payload.destinationLocationKey
        if (!directionAllowed) fail(`${effect.key}旅行端点或方向无效`)
        const before = state.map.travel; state.map.travel = { edgeKey: payload.edgeKey, destinationLocationKey: payload.destinationLocationKey }
        record(changes, effect, `开始旅行:${payload.edgeKey}`, before, state.map.travel); break
      }
      case 'fast-travel': {
        const fastTravelAuthorization = authorization as TextOpenWorldFastTravelAuthorizationV1
        const before = { locationKey: state.map.currentLocationKey, worldMinute: state.time.worldMinute, travel: state.map.travel }
        state.map.currentLocationKey = fastTravelAuthorization.destinationLocationKey
        state.map.travel = null
        state.time.worldMinute += fastTravelAuthorization.travelMinutes
        state.map.locationKnowledgeByKey[fastTravelAuthorization.destinationLocationKey] = 'visited'
        addUnique(state.map.revealedLocationKeys, fastTravelAuthorization.destinationLocationKey)
        const regionKey = modules.world.locations.find(location => location.key === fastTravelAuthorization.destinationLocationKey)!.regionKey
        const rank = { unknown: 0, heard: 1, visited: 2, familiar: 3 }
        if (rank[state.map.regionKnowledgeByKey[regionKey] ?? 'unknown'] < rank.visited) state.map.regionKnowledgeByKey[regionKey] = 'visited'
        record(changes, effect, `快速旅行到:${fastTravelAuthorization.destinationLocationKey}，耗时${fastTravelAuthorization.travelMinutes}分钟`, before, {
          locationKey: state.map.currentLocationKey, worldMinute: state.time.worldMinute, travel: state.map.travel,
        })
        break
      }
      case 'advance-time': {
        const { payload } = effect; const before = state.time.worldMinute; const after = before + payload.minutes
        if (!Number.isSafeInteger(after)) fail(`${effect.key}世界时间溢出`)
        state.time.worldMinute = after; record(changes, effect, `时间推进${payload.minutes}分钟`, before, after); break
      }
      case 'settle-weather': {
        const weatherAuthorization = authorization as TextOpenWorldWeatherSettlementAuthorizationV1
        const before = { epoch: state.time.lastWeatherSettlementEpoch, weatherByRegionKey: structuredClone(state.time.currentWeatherByRegionKey) }
        weatherAuthorization.changes.forEach(change => { state.time.currentWeatherByRegionKey[change.regionKey] = change.toWeatherKey })
        state.time.lastWeatherSettlementEpoch = weatherAuthorization.weatherEpoch
        record(changes, effect, `结算天气周期:${weatherAuthorization.weatherEpoch}`, before, {
          epoch: state.time.lastWeatherSettlementEpoch,
          weatherByRegionKey: state.time.currentWeatherByRegionKey,
        })
        break
      }
      case 'settle-actor-schedules': {
        const actorScheduleAuthorization = authorization as TextOpenWorldActorScheduleSettlementAuthorizationV1
        const before = {
          settlementWorldMinute: state.time.lastActorScheduleSettlementWorldMinute,
          actors: Object.fromEntries(actorScheduleAuthorization.changes.map(change => [change.actorKey, structuredClone(state.actors[change.actorKey])])),
        }
        actorScheduleAuthorization.changes.forEach(change => {
          const actor = state.actors[change.actorKey]
          actor.locationKey = change.toLocationKey
          actor.scheduleState = change.toScheduleState
        })
        state.time.lastActorScheduleSettlementWorldMinute = actorScheduleAuthorization.toSettlementWorldMinute
        record(changes, effect, `结算角色日程:${actorScheduleAuthorization.timePeriodKey}`, before, {
          settlementWorldMinute: state.time.lastActorScheduleSettlementWorldMinute,
          actors: Object.fromEntries(actorScheduleAuthorization.changes.map(change => [change.actorKey, structuredClone(state.actors[change.actorKey])])),
        })
        break
      }
      case 'start-combat': {
        const { payload } = effect; if (state.player.health <= 0) fail(`${effect.key}战败玩家不能开始战斗`); if (state.combat?.status === 'active') fail(`${effect.key}已有进行中的战斗`)
        const before = state.combat; state.combat = { encounterKey: payload.encounterKey, status: 'active' }
        record(changes, effect, `开始战斗:${payload.encounterKey}`, before, state.combat); break
      }
      case 'initialize-combat': {
        const before = state.combat
        state.combat = combatState.initialize({ state, encounterKey: effect.payload.encounterKey, instanceKey: claimKey })
        record(changes, effect, `初始化战斗:${effect.payload.encounterKey}`, before, state.combat); break
      }
      case 'resolve-combat': {
        const { payload } = effect; if (!state.combat || state.combat.status !== 'active' || state.combat.encounterKey !== payload.encounterKey) fail(`${effect.key}没有对应的active战斗`)
        if ('version' in state.combat) fail(`${effect.key}不能结算Combat v2战斗`)
        const before = { status: state.combat.status, health: state.player.health }; state.combat.status = payload.outcome
        if (payload.outcome === 'defeat') state.player.health = 0
        record(changes, effect, `战斗结果:${payload.outcome}`, before, { status: payload.outcome, health: state.player.health }); break
      }
      case 'settle-combat-state': {
        if (authorization?.kind !== 'combat-transition') fail(`${effect.key}缺少CombatTransition授权`)
        const before = { combat: structuredClone(state.combat), health: state.player.health, statusKeys: [...state.player.statusKeys] }
        state.combat = combatState.applyAuthorization({ state, authorization })
        if (authorization.afterStatus === 'defeat') state.player.health = 0
        record(changes, effect, `战斗阶段:${authorization.intent}`, before, { combat: state.combat, health: state.player.health, statusKeys: [...state.player.statusKeys] }); break
      }
      case 'perform-combat-action': {
        if (authorization?.kind !== 'combat-action') fail(`${effect.key}缺少CombatAction授权`)
        const before = { combat: structuredClone(state.combat), skillResource: state.player.skillResource }
        state.combat = combatActions.applyAuthorization({ beforeState: stateValue, state, authorization })
        record(changes, effect, `战斗行动:${authorization.actionKind}`, before, { combat: state.combat, skillResource: state.player.skillResource }); break
      }
      case 'perform-crafting': {
        if (authorization?.kind !== 'crafting') fail(`${effect.key}缺少Crafting授权`)
        const before = {
          worldMinute: state.time.worldMinute,
          ingredients: Object.fromEntries(authorization.ingredients.map(item => [item.itemKey, item.beforeQuantity])),
          outputs: Object.fromEntries(authorization.outputs.map(item => [item.itemKey, item.beforeQuantity])),
        }
        crafting.applyAuthorization({ beforeState: stateValue, state, authorization, claimKey, effectKey: effect.key })
        record(changes, effect, `制作:${authorization.recipeKey}×${authorization.quantity}`, before, {
          worldMinute: state.time.worldMinute,
          ingredients: Object.fromEntries(authorization.ingredients.map(item => [item.itemKey, item.afterQuantity])),
          outputs: Object.fromEntries(authorization.outputs.map(item => [item.itemKey, item.afterQuantity])),
        })
        break
      }
      case 'perform-transaction': {
        if (authorization?.kind !== 'transaction') fail(`${effect.key}缺少Transaction授权`)
        const before = {
          currency: authorization.before.currency,
          playerItemQuantity: authorization.before.playerItemQuantity,
          vendorStockQuantity: authorization.before.vendorStockQuantity,
        }
        economy.applyAuthorization({ beforeState: stateValue, state, authorization, claimKey, effectKey: effect.key })
        record(changes, effect, `${authorization.transactionKind === 'buy' ? '购买' : '出售'}:${authorization.itemKey}×${authorization.quantity}`, before, structuredClone(authorization.after))
        break
      }
      case 'rest': {
        const { payload } = effect
        if (state.player.health <= 0 || state.combat?.status === 'active' || state.combat?.status === 'defeat') fail(`${effect.key}当前不能休息`)
        const before = { health: state.player.health, skillResource: state.player.skillResource, statusKeys: [...state.player.statusKeys] }
        state.player.health = Math.max(state.player.health, Math.ceil(state.player.maximumHealth * payload.healthRatio))
        state.player.skillResource = Math.max(state.player.skillResource, Math.ceil(state.player.maximumSkillResource * payload.skillResourceRatio))
        if (payload.clearHarmfulStatuses) {
          const harmful = new Set(modules.progression.statuses.filter(status => status.polarity === 'harmful').map(status => status.key))
          state.player.statusKeys = state.player.statusKeys.filter(statusKey => !harmful.has(statusKey))
        }
        record(changes, effect, '休息恢复玩家状态', before, { health: state.player.health, skillResource: state.player.skillResource, statusKeys: [...state.player.statusKeys] }); break
      }
      case 'respawn': {
        const { payload } = effect; if (state.combat?.status !== 'defeat') fail(`${effect.key}只能在战败后复活`)
        if (!state.map.unlockedFastTravelPointKeys.includes(payload.fastTravelPointKey)) fail(`${effect.key}复活点尚未解锁`)
        const point = modules.world.fastTravelPoints.find(candidate => candidate.key === payload.fastTravelPointKey)!
        const before = { health: state.player.health, locationKey: state.map.currentLocationKey, combat: state.combat }
        state.player.health = Math.max(1, Math.ceil(state.player.maximumHealth * payload.healthRatio)); state.player.skillResource = state.player.maximumSkillResource
        const harmful = new Set(modules.progression.statuses.filter(status => status.polarity === 'harmful').map(status => status.key))
        state.player.statusKeys = state.player.statusKeys.filter(statusKey => !harmful.has(statusKey))
        state.map.currentLocationKey = point.locationKey; state.map.travel = null; state.combat = null; addUnique(state.map.revealedLocationKeys, point.locationKey)
        state.map.locationKnowledgeByKey[point.locationKey] = 'visited'
        const regionKey = modules.world.locations.find(location => location.key === point.locationKey)!.regionKey; state.map.regionKnowledgeByKey[regionKey] = 'visited'
        record(changes, effect, `在${point.locationKey}复活`, before, { health: state.player.health, skillResource: state.player.skillResource, statusKeys: state.player.statusKeys, locationKey: state.map.currentLocationKey, combat: null }); break
      }
      case 'change-actor-state': {
        const preview = actorLifecycle.preview({ state, effect })
        state.actors[effect.payload.actorKey] = preview.after
        record(changes, effect, `更新Actor:${effect.payload.actorKey}(${effect.payload.cause})`, preview.before, preview.after); break
      }
      case 'change-region-state': {
        const { payload } = effect; const before = state.world.regionStateByKey[payload.regionKey] ?? null
        state.world.regionStateByKey[payload.regionKey] = payload.state; record(changes, effect, `地区状态:${payload.regionKey}`, before, payload.state); break
      }
      case 'set-world-flag': {
        const { payload } = effect; const before = Object.prototype.hasOwnProperty.call(state.world.flags, payload.flagKey) ? state.world.flags[payload.flagKey] : null
        state.world.flags[payload.flagKey] = payload.value; record(changes, effect, `世界标记:${payload.flagKey}`, before, payload.value); break
      }
      case 'earn-achievement': {
        const { payload } = effect; const before = state.knowledge.earnedAchievementKeys.includes(payload.achievementKey)
        if (before) fail(`${effect.key}不能重复获得已有成就`)
        addUnique(state.knowledge.earnedAchievementKeys, payload.achievementKey)
        record(changes, effect, `获得成就:${payload.achievementKey}`, before, true); break
      }
      case 'unlock-ending': {
        const { payload } = effect; const before = state.endings.unlockedKeys.includes(payload.endingKey)
        addUnique(state.endings.unlockedKeys, payload.endingKey); record(changes, effect, `解锁结局:${payload.endingKey}`, before, true); break
      }
      case 'reach-ending': {
        const { payload } = effect; if (!state.endings.unlockedKeys.includes(payload.endingKey) || state.endings.reachedKey != null) fail(`${effect.key}结局不可到达`)
        const before = state.endings.reachedKey; state.endings.reachedKey = payload.endingKey
        record(changes, effect, `到达结局:${payload.endingKey}`, before, payload.endingKey); break
      }
    }
  }
  state.appliedClaimKeys.push(claimKey); validateTextOpenWorldEffectStateV1(state, modules)
  return { state, changes }
}

function planBody(plan: Omit<TextOpenWorldEffectPlanV1, 'planHash'>) { return plan }

/** Synchronous event replay; cryptographic plan verification is performed by the event protocol before persistence/import. */
export function applyTextOpenWorldEffectPlanForReplayV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  state: TextOpenWorldEffectStateV1,
  plan: TextOpenWorldEffectPlanV1,
): { state: TextOpenWorldEffectStateV1; changes: TextOpenWorldEffectChangeV1[] } {
  if (plan.schema !== 'storyforge.text-open-world.effect-plan' || plan.version !== 1) fail('EffectPlan schema/version无效')
  const modules = parseTextOpenWorldModulesV1(value); const refs = references(modules)
  const questTransitions = createTextOpenWorldQuestTransitionCatalogV1(value)
  const objectives = createTextOpenWorldObjectiveCatalogV1(value)
  const tracking = createTextOpenWorldQuestTrackingCatalogV1(value)
  const fastTravel = createTextOpenWorldFastTravelCatalogV1(value, modules)
  const weather = createTextOpenWorldWeatherCatalogV1(value, modules)
  const actorSchedules = createTextOpenWorldActorScheduleCatalogV1(value, modules)
  const actorLifecycle = createTextOpenWorldActorLifecycleCatalogV1(value, modules)
  const crime = createTextOpenWorldCrimeCatalogV1(value, modules)
  const combatState = createTextOpenWorldCombatStateMachineV1(value, modules)
  const combatActions = createTextOpenWorldCombatActionCatalogV1(value, modules)
  const crafting = createTextOpenWorldCraftingCatalogV1(value, modules)
  const economy = createTextOpenWorldEconomyCatalogV1(value, modules)
  const definitions = modules.actions.effects.map((item, index) => parseDefinition(item, refs, `effects[${index}]`))
  const byKey = new Map(definitions.map(item => [item.key, item]))
  const canonical = plan.effectKeys.map(effectKey => byKey.get(effectKey) ?? fail(`Effect不存在:${effectKey}`))
  if (canonicalProductProductionJsonV2(canonical) !== canonicalProductProductionJsonV2(plan.effects)) fail('EffectPlan定义与Release不一致')
  const applied = applyDefinitions(state, canonical, plan.claimKey, modules, plan.authorization, questTransitions, objectives, tracking, fastTravel, weather, actorSchedules, actorLifecycle, crime, combatState, combatActions, crafting, economy)
  if (canonicalProductProductionJsonV2(applied.changes) !== canonicalProductProductionJsonV2(plan.previewChanges)) fail('EffectPlan重放变化与预演不一致')
  return applied
}

export interface TextOpenWorldEffectCatalogV1 {
  list(): TextOpenWorldEffectDefinitionV1[]
  get(effectKey: string): TextOpenWorldEffectDefinitionV1 | null
  plan(input: { effectKeys: string[]; claimKey: string; state: TextOpenWorldEffectStateV1; authorization?: TextOpenWorldEffectPlanV1['authorization'] }): Promise<TextOpenWorldEffectPlanV1>
  apply(input: { plan: TextOpenWorldEffectPlanV1; state: TextOpenWorldEffectStateV1 }): Promise<{ state: TextOpenWorldEffectStateV1; receipt: TextOpenWorldEffectReceiptV1 }>
}

export function createTextOpenWorldEffectCatalogV1(value: TextOpenWorldRuntimePackageV1 | string | unknown): TextOpenWorldEffectCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value); const refs = references(modules)
  const questTransitions = createTextOpenWorldQuestTransitionCatalogV1(value)
  const objectives = createTextOpenWorldObjectiveCatalogV1(value)
  const tracking = createTextOpenWorldQuestTrackingCatalogV1(value)
  const fastTravel = createTextOpenWorldFastTravelCatalogV1(value, modules)
  const weather = createTextOpenWorldWeatherCatalogV1(value, modules)
  const actorSchedules = createTextOpenWorldActorScheduleCatalogV1(value, modules)
  const actorLifecycle = createTextOpenWorldActorLifecycleCatalogV1(value, modules)
  const crime = createTextOpenWorldCrimeCatalogV1(value, modules)
  const combatState = createTextOpenWorldCombatStateMachineV1(value, modules)
  const combatActions = createTextOpenWorldCombatActionCatalogV1(value, modules)
  const crafting = createTextOpenWorldCraftingCatalogV1(value, modules)
  const economy = createTextOpenWorldEconomyCatalogV1(value, modules)
  const definitions = modules.actions.effects.map((item, index) => parseDefinition(item, refs, `effects[${index}]`)); const byKey = new Map(definitions.map(item => [item.key, item])); const clone = <T>(item: T): T => structuredClone(item)
  const plan = async (input: { effectKeys: string[]; claimKey: string; state: TextOpenWorldEffectStateV1; authorization?: TextOpenWorldEffectPlanV1['authorization'] }): Promise<TextOpenWorldEffectPlanV1> => {
    const claimKey = key(input.claimKey, 'claimKey', CLAIM_KEY); if (!Array.isArray(input.effectKeys) || new Set(input.effectKeys).size !== input.effectKeys.length) fail('effectKeys必须是无重复数组')
    const effects = input.effectKeys.map(effectKey => byKey.get(key(effectKey, 'effectKey')) ?? fail(`Effect不存在:${effectKey}`)); const baseStateHash = await hashProductProductionValueV2(input.state); const preview = applyDefinitions(input.state, effects, claimKey, modules, input.authorization ?? null, questTransitions, objectives, tracking, fastTravel, weather, actorSchedules, actorLifecycle, crime, combatState, combatActions, crafting, economy); const resultingStateHash = await hashProductProductionValueV2(preview.state); const impactDomains = [...new Set(effects.flatMap(effect => effectDomains(effect.operation)))]
    const body: Omit<TextOpenWorldEffectPlanV1, 'planHash'> = {
      schema: 'storyforge.text-open-world.effect-plan', version: 1, claimKey, baseStateHash, resultingStateHash,
      effectKeys: [...input.effectKeys], effects: clone(effects), authorization: clone(input.authorization ?? null),
      impactDomains, previewChanges: clone(preview.changes),
    }
    return { ...body, planHash: await hashProductProductionValueV2(planBody(body)) }
  }
  return {
    list: () => clone(definitions),
    get: effectKey => { const found = byKey.get(key(effectKey, 'effectKey')); return found ? clone(found) : null },
    plan,
    apply: async input => {
      const { planHash, ...body } = input.plan
      if (!isSha256Hash(planHash) || await hashProductProductionValueV2(planBody(body)) !== planHash) fail('EffectPlan planHash无效')
      const baseStateHash = await hashProductProductionValueV2(input.state); if (baseStateHash !== input.plan.baseStateHash) fail('EffectPlan基线状态已变化')
      const canonicalEffects = input.plan.effectKeys.map(effectKey => byKey.get(effectKey) ?? fail(`Effect不存在:${effectKey}`)); if (canonicalProductProductionJsonV2(canonicalEffects) !== canonicalProductProductionJsonV2(input.plan.effects)) fail('EffectPlan定义与Release不一致')
      const applied = applyDefinitions(input.state, canonicalEffects, input.plan.claimKey, modules, input.plan.authorization, questTransitions, objectives, tracking, fastTravel, weather, actorSchedules, actorLifecycle, crime, combatState, combatActions, crafting, economy); const resultingStateHash = await hashProductProductionValueV2(applied.state)
      if (resultingStateHash !== input.plan.resultingStateHash || canonicalProductProductionJsonV2(applied.changes) !== canonicalProductProductionJsonV2(input.plan.previewChanges)) fail('EffectPlan预演与应用结果不一致')
      return { state: applied.state, receipt: { schema: 'storyforge.text-open-world.effect-receipt', version: 1, claimKey: input.plan.claimKey, planHash: input.plan.planHash, baseStateHash, resultingStateHash, impactDomains: [...input.plan.impactDomains], changes: clone(applied.changes) } }
    },
  }
}
