import { canonicalGameProductionJsonV2, hashGameProductionValueV2, isSha256Hash } from '../game-production/hash'
import type {
  TextOpenWorldEffectChangeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectImpactDomainV1,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectReceiptV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type Row = Record<string, unknown>
type Refs = ReturnType<typeof references>

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const CLAIM_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const QUEST_STATUSES: TextOpenWorldQuestStatusV1[] = ['locked', 'available', 'active', 'completed', 'failed', 'expired', 'abandoned']

function fail(message: string): never { throw new Error(`[text-open-world-effect] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) {
  const expected = [...fields].sort(); const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`)
}
function key(value: unknown, label: string, pattern = KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(`${label}无效`); return value.trim() }
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
    items: set(modules.items.items), skills: set(modules.progression.skills), recipes: set(modules.crafting.recipes),
    quests: set(modules.quests.quests), questStages: set(modules.quests.stages), objectives: set(modules.quests.objectives),
    locations: set(modules.world.locations), travelPoints: set(modules.world.fastTravelPoints), edges: set(modules.world.edges),
    factions: set(modules.actors.factions), actors: set(modules.actors.actors), regions: set(modules.world.regions),
    encounters: set(modules.combat.encounters), knowledge: set(modules.knowledge.entries), endings: set(modules.narrative.endings),
    questStageOwner: new Map(modules.quests.stages.map(item => [item.key, item.questKey])),
  }
}

function parseDefinition(value: unknown, refs: Refs, label: string): TextOpenWorldEffectDefinitionV1 {
  const definition = row(value, label); exact(definition, ['key', 'operation', 'payload'], label)
  const effectKey = key(definition.key, `${label}.key`); const operation = typeof definition.operation === 'string' ? definition.operation : fail(`${label}.operation无效`); const payload = row(definition.payload, `${label}.payload`)
  if (operation === 'change-player-resource') { exact(payload, ['resource', 'amount'], `${label}.payload`); return { key: effectKey, operation, payload: { resource: enumValue(payload.resource, ['health', 'skill-resource'], `${label}.resource`), amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'grant-experience') { exact(payload, ['amount'], `${label}.payload`); return { key: effectKey, operation, payload: { amount: int(payload.amount, `${label}.amount`, 1) } } }
  if (operation === 'apply-status' || operation === 'remove-status') { exact(payload, ['statusKey'], `${label}.payload`); return { key: effectKey, operation, payload: { statusKey: key(payload.statusKey, `${label}.statusKey`) } } }
  if (operation === 'grant-item' || operation === 'remove-item') { exact(payload, ['itemKey', 'quantity'], `${label}.payload`); return { key: effectKey, operation, payload: { itemKey: ref(payload.itemKey, refs.items, `${label}.itemKey`), quantity: int(payload.quantity, `${label}.quantity`, 1, 1_000_000) } } }
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
  if (operation === 'change-morality') { exact(payload, ['amount'], `${label}.payload`); return { key: effectKey, operation, payload: { amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'change-faction-affinity') { exact(payload, ['factionKey', 'amount'], `${label}.payload`); return { key: effectKey, operation, payload: { factionKey: ref(payload.factionKey, refs.factions, `${label}.factionKey`), amount: numberValue(payload.amount, `${label}.amount`) } } }
  if (operation === 'set-story-modifier') { exact(payload, ['actorKey', 'value'], `${label}.payload`); return { key: effectKey, operation, payload: { actorKey: ref(payload.actorKey, refs.actors, `${label}.actorKey`), value: numberValue(payload.value, `${label}.value`) } } }
  if (operation === 'reveal-knowledge') { exact(payload, ['knowledgeKey', 'visibility'], `${label}.payload`); return { key: effectKey, operation, payload: { knowledgeKey: ref(payload.knowledgeKey, refs.knowledge, `${label}.knowledgeKey`), visibility: enumValue(payload.visibility, ['rumor', 'known'], `${label}.visibility`) } } }
  if (operation === 'reveal-location' || operation === 'enter-location') { exact(payload, ['locationKey'], `${label}.payload`); return { key: effectKey, operation, payload: { locationKey: ref(payload.locationKey, refs.locations, `${label}.locationKey`) } } }
  if (operation === 'unlock-fast-travel') { exact(payload, ['fastTravelPointKey'], `${label}.payload`); return { key: effectKey, operation, payload: { fastTravelPointKey: ref(payload.fastTravelPointKey, refs.travelPoints, `${label}.fastTravelPointKey`) } } }
  if (operation === 'start-travel') { exact(payload, ['edgeKey', 'destinationLocationKey'], `${label}.payload`); return { key: effectKey, operation, payload: { edgeKey: ref(payload.edgeKey, refs.edges, `${label}.edgeKey`), destinationLocationKey: ref(payload.destinationLocationKey, refs.locations, `${label}.destinationLocationKey`) } } }
  if (operation === 'advance-time') { exact(payload, ['minutes'], `${label}.payload`); return { key: effectKey, operation, payload: { minutes: int(payload.minutes, `${label}.minutes`, 1, 1_000_000_000) } } }
  if (operation === 'start-combat') { exact(payload, ['encounterKey'], `${label}.payload`); return { key: effectKey, operation, payload: { encounterKey: ref(payload.encounterKey, refs.encounters, `${label}.encounterKey`) } } }
  if (operation === 'resolve-combat') { exact(payload, ['encounterKey', 'outcome'], `${label}.payload`); return { key: effectKey, operation, payload: { encounterKey: ref(payload.encounterKey, refs.encounters, `${label}.encounterKey`), outcome: enumValue(payload.outcome, ['victory', 'defeat', 'escaped'], `${label}.outcome`) } } }
  if (operation === 'respawn') { exact(payload, ['locationKey', 'healthRatio'], `${label}.payload`); return { key: effectKey, operation, payload: { locationKey: ref(payload.locationKey, refs.locations, `${label}.locationKey`), healthRatio: numberValue(payload.healthRatio, `${label}.healthRatio`, 0.000001, 1) } } }
  if (operation === 'change-actor-state') {
    exact(payload, ['actorKey', 'alive', 'present', 'locationKey'], `${label}.payload`); const alive = boolOrNull(payload.alive, `${label}.alive`); const present = boolOrNull(payload.present, `${label}.present`); const locationKey = nullableRef(payload.locationKey, refs.locations, `${label}.locationKey`)
    if (alive == null && present == null && locationKey == null) fail(`${label}至少改变一个Actor字段`)
    return { key: effectKey, operation, payload: { actorKey: ref(payload.actorKey, refs.actors, `${label}.actorKey`), alive, present, locationKey } }
  }
  if (operation === 'change-region-state') { exact(payload, ['regionKey', 'state'], `${label}.payload`); return { key: effectKey, operation, payload: { regionKey: ref(payload.regionKey, refs.regions, `${label}.regionKey`), state: text(payload.state, `${label}.state`) } } }
  if (operation === 'set-world-flag') { exact(payload, ['flagKey', 'value'], `${label}.payload`); return { key: effectKey, operation, payload: { flagKey: key(payload.flagKey, `${label}.flagKey`), value: scalar(payload.value, `${label}.value`) } } }
  if (operation === 'unlock-ending' || operation === 'reach-ending') { exact(payload, ['endingKey'], `${label}.payload`); return { key: effectKey, operation, payload: { endingKey: ref(payload.endingKey, refs.endings, `${label}.endingKey`) } } }
  fail(`${label}.operation不在白名单:${operation}`)
}

function addUnique(values: string[], value: string) { if (!values.includes(value)) values.push(value) }
function remove(values: string[], value: string) { const index = values.indexOf(value); if (index >= 0) values.splice(index, 1) }
function effectDomains(operation: TextOpenWorldEffectDefinitionV1['operation']): TextOpenWorldEffectImpactDomainV1[] {
  if (operation === 'respawn') return ['combat', 'player', 'map']
  if (['change-player-resource', 'grant-experience', 'apply-status', 'remove-status', 'learn-skill'].includes(operation)) return ['player']
  if (['grant-item', 'remove-item', 'equip-item', 'unequip-item', 'learn-recipe', 'change-currency'].includes(operation)) return ['inventory']
  if (['transition-quest', 'complete-objective'].includes(operation)) return ['quests']
  if (['reveal-location', 'unlock-fast-travel', 'enter-location', 'start-travel'].includes(operation)) return ['map']
  if (operation === 'advance-time') return ['time']
  if (['change-morality', 'change-faction-affinity', 'set-story-modifier'].includes(operation)) return ['relationships']
  if (['start-combat', 'resolve-combat'].includes(operation)) return ['combat']
  if (operation === 'change-actor-state') return ['actors']
  if (['change-region-state', 'set-world-flag'].includes(operation)) return ['world']
  if (operation === 'reveal-knowledge') return ['knowledge']
  return ['endings']
}

function record(changes: TextOpenWorldEffectChangeV1[], effect: TextOpenWorldEffectDefinitionV1, summary: string, before: unknown, after: unknown) {
  changes.push({ effectKey: effect.key, domain: effectDomains(effect.operation)[0], operation: effect.operation, summary, before: structuredClone(before), after: structuredClone(after) })
}

function assertUniqueKnown(values: string[], known: ReadonlySet<string>, label: string) {
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  values.forEach(value => { if (!known.has(value)) fail(`${label}引用不存在:${value}`) })
}

function validateState(state: TextOpenWorldEffectStateV1, modules: TextOpenWorldParsedModulesV1) {
  if (state.version !== 1) fail('EffectState版本无效')
  const refs = references(modules)
  const maxLevel = modules.progression.rules.maximumLevel
  int(state.player.level, 'player.level', 1, maxLevel); int(state.player.experience, 'player.experience'); numberValue(state.player.health, 'player.health', 0, state.player.maximumHealth); numberValue(state.player.maximumHealth, 'player.maximumHealth', 1); numberValue(state.player.skillResource, 'player.skillResource', 0, state.player.maximumSkillResource); numberValue(state.player.maximumSkillResource, 'player.maximumSkillResource', 0)
  Object.values(state.player.attributes).forEach(value => numberValue(value, 'player attribute', 0))
  assertUniqueKnown(state.player.learnedSkillKeys, refs.skills, 'player.learnedSkillKeys')
  if (new Set(state.player.statusKeys).size !== state.player.statusKeys.length) fail('player.statusKeys不能重复')
  for (const [itemKey, value] of Object.entries(state.inventory.itemQuantities)) { ref(itemKey, refs.items, 'inventory itemKey'); int(value, 'inventory quantity', 1, 1_000_000) }
  for (const [slot, itemKey] of Object.entries(state.inventory.equippedItemKeyBySlot)) {
    if (!['weapon', 'armor', 'accessory'].includes(slot)) fail(`未知装备位:${slot}`)
    if (itemKey == null) continue
    const definition = modules.items.items.find(candidate => candidate.key === itemKey)
    if (!definition || definition.kind !== 'equipment' || definition.equipmentSlotKey !== slot || !state.inventory.itemQuantities[itemKey]) fail(`装备状态无效:${slot}`)
  }
  assertUniqueKnown(state.inventory.knownRecipeKeys, refs.recipes, 'inventory.knownRecipeKeys')
  int(state.inventory.currency, 'inventory.currency', 0, 1_000_000_000)
  for (const [questKey, status] of Object.entries(state.quests.statusByQuestKey)) { ref(questKey, refs.quests, 'quest status key'); enumValue(status, QUEST_STATUSES, `quest status:${questKey}`) }
  for (const [questKey, stageKey] of Object.entries(state.quests.stageByQuestKey)) {
    ref(questKey, refs.quests, 'quest stage owner')
    if (stageKey != null && refs.questStageOwner.get(ref(stageKey, refs.questStages, 'quest stage')) !== questKey) fail(`quest stage归属无效:${questKey}`)
  }
  for (const [objectiveKey, status] of Object.entries(state.quests.objectiveStatusByKey)) { ref(objectiveKey, refs.objectives, 'objective status key'); enumValue(status, ['inactive', 'active', 'completed', 'failed'], `objective status:${objectiveKey}`) }
  assertUniqueKnown(state.map.revealedLocationKeys, refs.locations, 'map.revealedLocationKeys')
  assertUniqueKnown(state.map.unlockedFastTravelPointKeys, refs.travelPoints, 'map.unlockedFastTravelPointKeys')
  int(state.time.worldMinute, 'time.worldMinute')
  numberValue(state.relationships.morality, 'relationships.morality', modules.relationships.morality.minimum, modules.relationships.morality.maximum)
  for (const [factionKey, value] of Object.entries(state.relationships.factionAffinityByKey)) { ref(factionKey, refs.factions, 'faction affinity key'); numberValue(value, 'faction affinity', modules.relationships.factionAffinity.minimum, modules.relationships.factionAffinity.maximum) }
  for (const [actorKey, value] of Object.entries(state.relationships.storyModifierByActorKey)) { ref(actorKey, refs.actors, 'story modifier actor'); numberValue(value, 'story modifier', -modules.relationships.attitude.explicitStoryModifierCap, modules.relationships.attitude.explicitStoryModifierCap) }
  if (state.combat) ref(state.combat.encounterKey, refs.encounters, 'combat encounterKey')
  for (const actorDefinition of modules.actors.actors) if (!state.actors[actorDefinition.key]) fail(`Actor运行状态缺失:${actorDefinition.key}`)
  for (const [actorKey, actor] of Object.entries(state.actors)) { ref(actorKey, refs.actors, 'actors key'); ref(actor.locationKey, refs.locations, `actors.${actorKey}.locationKey`) }
  for (const regionKey of Object.keys(state.world.regionStateByKey)) ref(regionKey, refs.regions, 'region state key')
  for (const [knowledgeKey, visibility] of Object.entries(state.knowledge.visibilityByKey)) { ref(knowledgeKey, refs.knowledge, 'knowledge key'); enumValue(visibility, ['hidden', 'rumor', 'known'], `knowledge visibility:${knowledgeKey}`) }
  assertUniqueKnown(state.endings.unlockedKeys, refs.endings, 'endings.unlockedKeys')
  if (state.endings.reachedKey != null && (!refs.endings.has(state.endings.reachedKey) || !state.endings.unlockedKeys.includes(state.endings.reachedKey))) fail('reached ending无效')
  if (new Set(state.appliedClaimKeys).size !== state.appliedClaimKeys.length || state.appliedClaimKeys.some(item => !CLAIM_KEY.test(item))) fail('appliedClaimKeys无效')
  if (!modules.world.locations.some(item => item.key === state.map.currentLocationKey)) fail('currentLocationKey不存在')
  if (state.map.travel) {
    const edge = modules.world.edges.find(candidate => candidate.key === state.map.travel!.edgeKey) ?? fail('travel edgeKey不存在')
    if (![edge.fromLocationKey, edge.toLocationKey].includes(state.map.currentLocationKey) || ![edge.fromLocationKey, edge.toLocationKey].includes(state.map.travel.destinationLocationKey) || state.map.currentLocationKey === state.map.travel.destinationLocationKey) fail('travel状态端点无效')
  }
}

function questTransitionAllowed(before: TextOpenWorldQuestStatusV1, after: TextOpenWorldQuestStatusV1, protectedQuest: boolean, restartable: boolean, repeatable: boolean): boolean {
  if (before === after) return false
  if (protectedQuest) return (before === 'locked' && after === 'available') || (before === 'available' && after === 'active') || (before === 'active' && after === 'completed')
  if (before === 'locked') return after === 'available'
  if (before === 'available') return ['active', 'expired', 'abandoned'].includes(after)
  if (before === 'active') return ['completed', 'failed', 'expired', 'abandoned'].includes(after)
  return (restartable || repeatable) && after === 'available'
}

function applyDefinitions(stateValue: TextOpenWorldEffectStateV1, effects: TextOpenWorldEffectDefinitionV1[], claimKey: string, modules: TextOpenWorldParsedModulesV1) {
  validateState(stateValue, modules)
  if (stateValue.appliedClaimKeys.includes(claimKey)) fail(`claim已应用:${claimKey}`)
  const state = structuredClone(stateValue); const changes: TextOpenWorldEffectChangeV1[] = []
  const item = (itemKey: string) => modules.items.items.find(candidate => candidate.key === itemKey) ?? fail(`物品不存在:${itemKey}`)
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
        const before = { experience: state.player.experience, level: state.player.level, attributes: structuredClone(state.player.attributes) }
        state.player.experience += payload.amount
        const eligibleLevels = modules.progression.levels.filter(level => level.cumulativeExperience <= state.player.experience)
        const nextLevel = eligibleLevels[eligibleLevels.length - 1]?.level ?? 1
        for (let level = state.player.level + 1; level <= nextLevel; level += 1) {
          const growth = modules.progression.levels[level - 1].attributeGrowth
          state.player.attributes.power += growth.power
          state.player.attributes.vitality += growth.vitality
          state.player.attributes.agility += growth.agility
          modules.progression.levels[level - 1].unlockedSkillKeys.forEach(skillKey => addUnique(state.player.learnedSkillKeys, skillKey))
        }
        state.player.level = Math.min(nextLevel, modules.progression.rules.maximumLevel)
        record(changes, effect, `获得${payload.amount}经验`, before, { experience: state.player.experience, level: state.player.level, attributes: state.player.attributes })
        break
      }
      case 'apply-status':
      case 'remove-status': {
        const { payload } = effect
        const before = state.player.statusKeys.includes(payload.statusKey)
        if (effect.operation === 'apply-status') addUnique(state.player.statusKeys, payload.statusKey)
        else remove(state.player.statusKeys, payload.statusKey)
        record(changes, effect, `${effect.operation}:${payload.statusKey}`, before, state.player.statusKeys.includes(payload.statusKey))
        break
      }
      case 'grant-item':
      case 'remove-item': {
        const { payload } = effect
        const definition = item(payload.itemKey)
        const before = state.inventory.itemQuantities[payload.itemKey] ?? 0
        const after = before + (effect.operation === 'grant-item' ? payload.quantity : -payload.quantity)
        if (after < 0 || (!definition.stackable && after > 1)) fail(`${effect.key}物品数量无效`)
        if (effect.operation === 'remove-item' && definition.critical) fail(`${effect.key}不能移除关键物品`)
        if (effect.operation === 'remove-item' && Object.values(state.inventory.equippedItemKeyBySlot).includes(payload.itemKey)) fail(`${effect.key}不能移除已装备物品`)
        if (after === 0) delete state.inventory.itemQuantities[payload.itemKey]
        else state.inventory.itemQuantities[payload.itemKey] = after
        record(changes, effect, `${effect.operation}:${payload.itemKey}`, before, after)
        break
      }
      case 'equip-item':
      case 'unequip-item': {
        const { payload } = effect
        const definition = item(payload.itemKey)
        if (definition.kind !== 'equipment' || !definition.equipmentSlotKey) fail(`${effect.key}目标不是装备`)
        const slot = definition.equipmentSlotKey
        const before = state.inventory.equippedItemKeyBySlot[slot]
        if (effect.operation === 'equip-item') {
          if ((state.inventory.itemQuantities[payload.itemKey] ?? 0) < 1) fail(`${effect.key}背包没有目标装备`)
          state.inventory.equippedItemKeyBySlot[slot] = payload.itemKey
        } else {
          if (before !== payload.itemKey) fail(`${effect.key}目标未装备`)
          state.inventory.equippedItemKeyBySlot[slot] = null
        }
        record(changes, effect, `${effect.operation}:${payload.itemKey}`, before, state.inventory.equippedItemKeyBySlot[slot])
        break
      }
      case 'learn-skill': {
        const { payload } = effect; const before = state.player.learnedSkillKeys.includes(payload.skillKey)
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
        const { payload } = effect
        const definition = modules.quests.quests.find(candidate => candidate.key === payload.questKey)!
        const before = { status: state.quests.statusByQuestKey[payload.questKey] ?? 'locked', stageKey: state.quests.stageByQuestKey[payload.questKey] ?? null }
        const protectedQuest = definition.type === 'mainline' || definition.type === 'significant'
        if (!questTransitionAllowed(before.status as TextOpenWorldQuestStatusV1, payload.status, protectedQuest, definition.lifecyclePolicy === 'abandon-restart', definition.repeatable)) fail(`${effect.key}任务状态迁移非法:${before.status}->${payload.status}`)
        if (payload.status === 'active' && payload.stageKey == null) fail(`${effect.key}激活任务必须指定stageKey`)
        state.quests.statusByQuestKey[payload.questKey] = payload.status; state.quests.stageByQuestKey[payload.questKey] = payload.stageKey
        record(changes, effect, `任务${payload.questKey}变为${payload.status}`, before, { status: payload.status, stageKey: payload.stageKey }); break
      }
      case 'complete-objective': {
        const { payload } = effect; const before = state.quests.objectiveStatusByKey[payload.objectiveKey] ?? 'inactive'
        if (before !== 'active') fail(`${effect.key}只能完成active目标`)
        state.quests.objectiveStatusByKey[payload.objectiveKey] = 'completed'; record(changes, effect, `完成目标:${payload.objectiveKey}`, before, 'completed'); break
      }
      case 'change-morality': {
        const { payload } = effect; const before = state.relationships.morality; const after = before + payload.amount
        numberValue(after, `${effect.key} morality`, modules.relationships.morality.minimum, modules.relationships.morality.maximum)
        state.relationships.morality = after; record(changes, effect, `道德变化${payload.amount}`, before, after); break
      }
      case 'change-faction-affinity': {
        const { payload } = effect; const before = state.relationships.factionAffinityByKey[payload.factionKey] ?? modules.relationships.factionAffinity.initial; const after = before + payload.amount
        numberValue(after, `${effect.key} affinity`, modules.relationships.factionAffinity.minimum, modules.relationships.factionAffinity.maximum)
        state.relationships.factionAffinityByKey[payload.factionKey] = after; record(changes, effect, `阵营亲合度变化${payload.amount}`, before, after); break
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
        const { payload } = effect; const before = state.map.revealedLocationKeys.includes(payload.locationKey)
        addUnique(state.map.revealedLocationKeys, payload.locationKey); record(changes, effect, `揭示地点:${payload.locationKey}`, before, true); break
      }
      case 'unlock-fast-travel': {
        const { payload } = effect; const before = state.map.unlockedFastTravelPointKeys.includes(payload.fastTravelPointKey)
        addUnique(state.map.unlockedFastTravelPointKeys, payload.fastTravelPointKey); record(changes, effect, `解锁快速旅行:${payload.fastTravelPointKey}`, before, true); break
      }
      case 'enter-location': {
        const { payload } = effect; const before = state.map.currentLocationKey
        state.map.currentLocationKey = payload.locationKey; state.map.travel = null; addUnique(state.map.revealedLocationKeys, payload.locationKey)
        record(changes, effect, `进入地点:${payload.locationKey}`, before, payload.locationKey); break
      }
      case 'start-travel': {
        const { payload } = effect
        if (state.map.travel) fail(`${effect.key}已有进行中的旅行`)
        const edge = modules.world.edges.find(candidate => candidate.key === payload.edgeKey)!
        if (![edge.fromLocationKey, edge.toLocationKey].includes(state.map.currentLocationKey) || ![edge.fromLocationKey, edge.toLocationKey].includes(payload.destinationLocationKey) || payload.destinationLocationKey === state.map.currentLocationKey) fail(`${effect.key}旅行端点无效`)
        const before = state.map.travel; state.map.travel = { edgeKey: payload.edgeKey, destinationLocationKey: payload.destinationLocationKey }
        record(changes, effect, `开始旅行:${payload.edgeKey}`, before, state.map.travel); break
      }
      case 'advance-time': {
        const { payload } = effect; const before = state.time.worldMinute; const after = before + payload.minutes
        if (!Number.isSafeInteger(after)) fail(`${effect.key}世界时间溢出`)
        state.time.worldMinute = after; record(changes, effect, `时间推进${payload.minutes}分钟`, before, after); break
      }
      case 'start-combat': {
        const { payload } = effect; if (state.combat?.status === 'active') fail(`${effect.key}已有进行中的战斗`)
        const before = state.combat; state.combat = { encounterKey: payload.encounterKey, status: 'active' }
        record(changes, effect, `开始战斗:${payload.encounterKey}`, before, state.combat); break
      }
      case 'resolve-combat': {
        const { payload } = effect; if (!state.combat || state.combat.status !== 'active' || state.combat.encounterKey !== payload.encounterKey) fail(`${effect.key}没有对应的active战斗`)
        const before = state.combat.status; state.combat.status = payload.outcome
        record(changes, effect, `战斗结果:${payload.outcome}`, before, payload.outcome); break
      }
      case 'respawn': {
        const { payload } = effect; if (state.combat?.status !== 'defeat') fail(`${effect.key}只能在战败后复活`)
        const before = { health: state.player.health, locationKey: state.map.currentLocationKey, combat: state.combat }
        state.player.health = Math.max(1, Math.ceil(state.player.maximumHealth * payload.healthRatio)); state.map.currentLocationKey = payload.locationKey; state.map.travel = null; state.combat = null
        record(changes, effect, `在${payload.locationKey}复活`, before, { health: state.player.health, locationKey: state.map.currentLocationKey, combat: null }); break
      }
      case 'change-actor-state': {
        const { payload } = effect; const definition = modules.actors.actors.find(candidate => candidate.key === payload.actorKey)!
        const actor = state.actors[payload.actorKey] ?? fail(`${effect.key}Actor运行状态不存在`)
        if (definition.protected && payload.alive === false) fail(`${effect.key}不能杀死受保护Actor`)
        const before = structuredClone(actor); if (payload.alive != null) actor.alive = payload.alive; if (payload.present != null) actor.present = payload.present; if (payload.locationKey != null) actor.locationKey = payload.locationKey
        record(changes, effect, `更新Actor:${payload.actorKey}`, before, actor); break
      }
      case 'change-region-state': {
        const { payload } = effect; const before = state.world.regionStateByKey[payload.regionKey] ?? null
        state.world.regionStateByKey[payload.regionKey] = payload.state; record(changes, effect, `地区状态:${payload.regionKey}`, before, payload.state); break
      }
      case 'set-world-flag': {
        const { payload } = effect; const before = Object.prototype.hasOwnProperty.call(state.world.flags, payload.flagKey) ? state.world.flags[payload.flagKey] : null
        state.world.flags[payload.flagKey] = payload.value; record(changes, effect, `世界标记:${payload.flagKey}`, before, payload.value); break
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
  state.appliedClaimKeys.push(claimKey); validateState(state, modules)
  return { state, changes }
}

function planBody(plan: Omit<TextOpenWorldEffectPlanV1, 'planHash'>) { return plan }

export interface TextOpenWorldEffectCatalogV1 {
  list(): TextOpenWorldEffectDefinitionV1[]
  get(effectKey: string): TextOpenWorldEffectDefinitionV1 | null
  plan(input: { effectKeys: string[]; claimKey: string; state: TextOpenWorldEffectStateV1 }): Promise<TextOpenWorldEffectPlanV1>
  apply(input: { plan: TextOpenWorldEffectPlanV1; state: TextOpenWorldEffectStateV1 }): Promise<{ state: TextOpenWorldEffectStateV1; receipt: TextOpenWorldEffectReceiptV1 }>
}

export function createTextOpenWorldEffectCatalogV1(value: TextOpenWorldRuntimePackageV1 | string | unknown): TextOpenWorldEffectCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value); const refs = references(modules)
  const definitions = modules.actions.effects.map((item, index) => parseDefinition(item, refs, `effects[${index}]`)); const byKey = new Map(definitions.map(item => [item.key, item])); const clone = <T>(item: T): T => structuredClone(item)
  const plan = async (input: { effectKeys: string[]; claimKey: string; state: TextOpenWorldEffectStateV1 }): Promise<TextOpenWorldEffectPlanV1> => {
    const claimKey = key(input.claimKey, 'claimKey', CLAIM_KEY); if (!Array.isArray(input.effectKeys) || new Set(input.effectKeys).size !== input.effectKeys.length) fail('effectKeys必须是无重复数组')
    const effects = input.effectKeys.map(effectKey => byKey.get(key(effectKey, 'effectKey')) ?? fail(`Effect不存在:${effectKey}`)); const baseStateHash = await hashGameProductionValueV2(input.state); const preview = applyDefinitions(input.state, effects, claimKey, modules); const resultingStateHash = await hashGameProductionValueV2(preview.state); const impactDomains = [...new Set(effects.flatMap(effect => effectDomains(effect.operation)))]
    const body: Omit<TextOpenWorldEffectPlanV1, 'planHash'> = { schema: 'storyforge.text-open-world.effect-plan', version: 1, claimKey, baseStateHash, resultingStateHash, effectKeys: [...input.effectKeys], effects: clone(effects), impactDomains, previewChanges: clone(preview.changes) }
    return { ...body, planHash: await hashGameProductionValueV2(planBody(body)) }
  }
  return {
    list: () => clone(definitions),
    get: effectKey => { const found = byKey.get(key(effectKey, 'effectKey')); return found ? clone(found) : null },
    plan,
    apply: async input => {
      const { planHash, ...body } = input.plan
      if (!isSha256Hash(planHash) || await hashGameProductionValueV2(planBody(body)) !== planHash) fail('EffectPlan planHash无效')
      const baseStateHash = await hashGameProductionValueV2(input.state); if (baseStateHash !== input.plan.baseStateHash) fail('EffectPlan基线状态已变化')
      const canonicalEffects = input.plan.effectKeys.map(effectKey => byKey.get(effectKey) ?? fail(`Effect不存在:${effectKey}`)); if (canonicalGameProductionJsonV2(canonicalEffects) !== canonicalGameProductionJsonV2(input.plan.effects)) fail('EffectPlan定义与Release不一致')
      const applied = applyDefinitions(input.state, canonicalEffects, input.plan.claimKey, modules); const resultingStateHash = await hashGameProductionValueV2(applied.state)
      if (resultingStateHash !== input.plan.resultingStateHash || canonicalGameProductionJsonV2(applied.changes) !== canonicalGameProductionJsonV2(input.plan.previewChanges)) fail('EffectPlan预演与应用结果不一致')
      return { state: applied.state, receipt: { schema: 'storyforge.text-open-world.effect-receipt', version: 1, claimKey: input.plan.claimKey, planHash: input.plan.planHash, baseStateHash, resultingStateHash, impactDomains: [...input.plan.impactDomains], changes: clone(applied.changes) } }
    },
  }
}
