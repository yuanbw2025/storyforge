import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  ProductRuntimeEvent,
  TextOpenWorldActionProjectionContextV1,
  TextOpenWorldConditionEvaluationContextV1,
  TextOpenWorldCombatTransitionIntentV1,
  TextOpenWorldDerivedContextsV1,
  TextOpenWorldDirectorProjectionV1,
  TextOpenWorldDirectorTriggerV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldLongTermMemoryProjectionV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { createTextOpenWorldConditionCatalogV1 } from './condition-dsl'
import { applyTextOpenWorldEffectPlanForReplayV1, validateTextOpenWorldEffectStateV1 } from './effect-dsl'
import {
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  parseTextOpenWorldRandomEvidenceV1,
  parseTextOpenWorldRandomResolvedEventPayloadV1,
} from './event-contract'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import { parseTextOpenWorldMemoryCommittedEventPayloadV1 } from './runtime-memory-contract'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  createInitialTextOpenWorldInventoryV1,
  deriveTextOpenWorldEquippedItemKeysV1,
  deriveTextOpenWorldInventoryQuantitiesV1,
  deriveTextOpenWorldRemovableInventoryQuantitiesV1,
} from './inventory'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'
import { deriveTextOpenWorldProgressionStatusV1 } from './progression'
import { createTextOpenWorldQuestTransitionCatalogV1 } from './quest-state-machine'
import { createTextOpenWorldObjectiveCatalogV1 } from './objective-state'
import { createTextOpenWorldQuestTrackingCatalogV1 } from './quest-tracking'
import {
  createInitialTextOpenWorldQuestInstancesV1,
  deriveTextOpenWorldQuestConditionProjectionV1,
} from './quests'
import { createTextOpenWorldRewardCatalogV1 } from './rewards'
import { parseTextOpenWorldRuntimePackageV1 } from './runtime-package'
import { createTextOpenWorldFastTravelCatalogV1 } from './fast-travel'
import { createTextOpenWorldWeatherCatalogV1, projectTextOpenWorldClockWeatherV1 } from './weather'
import { createTextOpenWorldActorScheduleCatalogV1, projectTextOpenWorldActorsV1 } from './actors'
import { deriveTextOpenWorldAttitudeByActorKeyV1 } from './relationships'
import { createTextOpenWorldCrimeCatalogV1 } from './crime'
import { createTextOpenWorldCombatStateMachineV1 } from './combat-state-machine'
import { createTextOpenWorldCombatActionCatalogV1 } from './combat-actions'
import { createTextOpenWorldCraftingCatalogV1 } from './crafting'
import { createInitialTextOpenWorldEconomyStateV1, createTextOpenWorldEconomyCatalogV1 } from './economy'
import { createTextOpenWorldDirectorCatalogV1 } from './director'

type Row = Record<string, unknown>
const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-session] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) { const expected = [...fields].sort(); const actual = Object.keys(value).sort(); if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`) }
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}无效`); return Number(value) }
function token(value: unknown, label: string, pattern = STABLE_KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function enumToken<T extends string>(value: unknown, allowed: readonly T[], label: string): T { if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}无效`); return value as T }
function nullableToken(value: unknown, label: string, pattern = STABLE_KEY): string | null { return value == null ? null : token(value, label, pattern) }
function uniqueTokens(value: unknown, label: string, pattern = STABLE_KEY): string[] { if (!Array.isArray(value)) fail(`${label}必须是数组`); const parsed = value.map((item, index) => token(item, `${label}[${index}]`, pattern)); if (new Set(parsed).size !== parsed.length) fail(`${label}不能重复`); return parsed }
function json(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) } }

function parseLongTermMemoryProjectionV1(input: {
  value: unknown
  modules: TextOpenWorldParsedModulesV1
  lastEventSequence: number
}): TextOpenWorldLongTermMemoryProjectionV1 {
  const memory = row(input.value, 'memory')
  exact(memory, ['version', 'records', 'actorKnowledgeByActorKey'], 'memory')
  if (memory.version !== 1) fail('memory.version无效')
  const actorKeys = new Set(input.modules.actors.actors.map(actor => actor.key))
  const knowledgeKeys = new Set(input.modules.knowledge.entries.map(entry => entry.key))
  const actorKnowledgeByActorKey: Record<string, string[]> = {}
  const actorKnowledge = row(memory.actorKnowledgeByActorKey, 'memory.actorKnowledgeByActorKey')
  for (const [actorKey, value] of Object.entries(actorKnowledge)) {
    if (!actorKeys.has(actorKey)) fail(`长期记忆引用未知Actor:${actorKey}`)
    const keys = uniqueTokens(value, `memory.actorKnowledgeByActorKey.${actorKey}`)
    if (keys.some(key => !knowledgeKeys.has(key))) fail(`Actor长期记忆引用未知知识:${actorKey}`)
    actorKnowledgeByActorKey[actorKey] = keys
  }
  if (!Array.isArray(memory.records) || memory.records.length > 64) fail('长期记忆记录最多64项')
  const seenMemoryKeys = new Set<string>()
  const seenDialogueHashes = new Set<string>()
  const records = memory.records.map((value, index) => {
    const item = row(value, `memory.records[${index}]`)
    exact(item, [
      'memoryKey', 'kind', 'subjectKey', 'sceneKey', 'actorKey', 'summary',
      'coveredEventSequences', 'coveredEventHashes', 'playerKnowledgeKeys', 'actorKnowledgeKeys',
      'sourceDialogueKnowledgeKeys', 'openThreadKeys', 'sourceDialogueHash', 'candidateHash',
      'contextManifestHash', 'adoptionHash', 'worldMinute', 'committedSequence', 'inherited',
    ], `memory.records[${index}]`)
    const parsed = parseTextOpenWorldMemoryCommittedEventPayloadV1({
      schema: 'storyforge.text-open-world.memory-committed-event', version: 1,
      memoryKey: item.memoryKey, kind: item.kind, subjectKey: item.subjectKey,
      sceneKey: item.sceneKey, actorKey: item.actorKey, summary: item.summary,
      coveredEventSequences: item.coveredEventSequences, coveredEventHashes: item.coveredEventHashes,
      playerKnowledgeKeys: item.playerKnowledgeKeys, actorKnowledgeKeys: item.actorKnowledgeKeys,
      sourceDialogueKnowledgeKeys: item.sourceDialogueKnowledgeKeys, openThreadKeys: item.openThreadKeys,
      sourceDialogueHash: item.sourceDialogueHash, candidateHash: item.candidateHash,
      contextManifestHash: item.contextManifestHash, adoptionHash: item.adoptionHash,
      worldMinute: item.worldMinute,
    })
    if (seenMemoryKeys.has(parsed.memoryKey) || seenDialogueHashes.has(parsed.sourceDialogueHash)) {
      fail('长期记忆记录键或对话窗口Hash重复')
    }
    seenMemoryKeys.add(parsed.memoryKey); seenDialogueHashes.add(parsed.sourceDialogueHash)
    if (parsed.actorKey != null && !actorKeys.has(parsed.actorKey)) fail('长期记忆引用未知Actor')
    if (parsed.sceneKey != null && !input.modules.narrative.scenes.some(scene => scene.key === parsed.sceneKey)) fail('长期记忆引用未知Scene')
    if ([...parsed.playerKnowledgeKeys, ...parsed.actorKnowledgeKeys, ...parsed.sourceDialogueKnowledgeKeys]
      .some(key => !knowledgeKeys.has(key))) fail('长期记忆引用未知Knowledge')
    const committedSequence = integer(item.committedSequence, `memory.records[${index}].committedSequence`)
    if (typeof item.inherited !== 'boolean') fail('长期记忆inherited必须是boolean')
    if (item.inherited) {
      if (committedSequence !== 0 || parsed.coveredEventSequences.length || parsed.coveredEventHashes.length) {
        fail('继承记忆不得引用子分支本地事件序号')
      }
    } else if (committedSequence < 1 || committedSequence > input.lastEventSequence
      || parsed.coveredEventSequences.some(sequence => sequence >= committedSequence)) {
      fail('长期记忆事件序号无效')
    }
    const { schema: _schema, version: _version, ...record } = parsed
    return { ...record, committedSequence, inherited: item.inherited }
  })
  return { version: 1, records, actorKnowledgeByActorKey }
}

function assertTextOpenWorldItemActionReplayBindingV1(input: {
  action: TextOpenWorldParsedModulesV1['actions']['actions'][number]
  effects: TextOpenWorldEffectDefinitionV1[]
  pendingActorKey: 'player' | 'system' | null
  pendingTargetKey: string | null
}): void {
  const category = input.action.category
  if (!['use', 'drop', 'equip', 'unequip'].includes(category)) return
  const ownedEffectKeys = new Set([
    ...input.action.costEffectKeys,
    ...input.action.successEffectKeys,
    ...input.action.failureEffectKeys,
  ])
  const candidates = input.effects.filter(effect => {
    if (!ownedEffectKeys.has(effect.key)) return false
    if (category === 'use') return effect.operation === 'remove-item' && effect.payload.reason === 'consume'
    if (category === 'drop') return effect.operation === 'remove-item' && effect.payload.reason === 'drop'
    return effect.operation === `${category}-item`
  })
  if (candidates.length !== 1) fail('物品Action缺少唯一固定物品Effect')
  const candidate = candidates[0]!
  const itemKey = candidate.operation === 'remove-item' || candidate.operation === 'equip-item' || candidate.operation === 'unequip-item'
    ? candidate.payload.itemKey
    : fail('物品Action固定Effect类型无效')
  if (input.pendingActorKey !== 'player' || input.action.actorScope !== 'player'
    || input.action.targetScope !== 'item' || input.pendingTargetKey !== itemKey) {
    fail('物品Action与命令操作者或目标不一致')
  }
}

function timePeriodKey(modules: TextOpenWorldParsedModulesV1, worldMinute: number): string {
  const minute = worldMinute % modules['time-weather'].minutesPerDay
  return modules['time-weather'].timePeriods.find(period => minute >= period.startMinute && minute < period.endMinute)?.key ?? fail('世界分钟无法映射时间段')
}

function timePeriodStartWorldMinute(modules: TextOpenWorldParsedModulesV1, worldMinute: number): number {
  const periodKey = timePeriodKey(modules, worldMinute)
  const period = modules['time-weather'].timePeriods.find(item => item.key === periodKey) ?? fail('世界分钟无法映射时间段起点')
  return Math.floor(worldMinute / modules['time-weather'].minutesPerDay) * modules['time-weather'].minutesPerDay + period.startMinute
}

function actorInitialState(modules: TextOpenWorldParsedModulesV1, actorKey: string, periodKey: string) {
  const actor = modules.actors.actors.find(item => item.key === actorKey) ?? fail(`Actor不存在:${actorKey}`)
  const schedule = modules.actors.schedules.find(item => item.actorKey === actorKey)
  const entry = schedule?.entries.find(item => item.timePeriodKey === periodKey)
  return { alive: true, present: true, locationKey: entry?.locationKey ?? actor.homeLocationKey, scheduleState: entry?.activity ?? '空闲' }
}

function initialEffectState(runtimePackage: ReturnType<typeof parseTextOpenWorldRuntimePackageV1>, modules: TextOpenWorldParsedModulesV1): TextOpenWorldEffectStateV1 {
  const level = modules.actors.player.build.initialLevel; const attributes = structuredClone(modules.actors.player.build.attributes)
  const derivedStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level, attributes, equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
  })
  const periodKey = timePeriodKey(modules, modules['time-weather'].initialWorldMinute)
  const regionKnowledgeByKey = Object.fromEntries(modules.world.regions.map(region => [region.key, region.initialKnowledge]))
  const initialRegionKey = modules.world.locations.find(location => location.key === modules.world.initialLocationKey)!.regionKey
  regionKnowledgeByKey[initialRegionKey] = 'visited'
  const initialInventory = createInitialTextOpenWorldInventoryV1(modules)
  const locationKnowledgeByKey = Object.fromEntries(modules.world.locations.map(location => [location.key, location.initialKnowledge]))
  locationKnowledgeByKey[modules.world.initialLocationKey] = 'visited'
  return {
    version: 1,
    player: {
      level, experience: modules.progression.levels[level - 1].cumulativeExperience,
      health: derivedStats.maximumHealth, maximumHealth: derivedStats.maximumHealth,
      skillResource: derivedStats.maximumSkillResource, maximumSkillResource: derivedStats.maximumSkillResource,
      attributes, statusKeys: [],
      learnedSkillKeys: [...modules.actors.player.build.learnedSkillKeys],
    },
    inventory: {
      ...initialInventory,
      equippedItemInstanceIdBySlot: { weapon: null, armor: null, accessory: null },
      knownRecipeKeys: modules.crafting.recipes.filter(recipe => recipe.learnedByDefault).map(recipe => recipe.key),
      currency: modules.actors.player.build.startingCurrency,
    },
    economy: createInitialTextOpenWorldEconomyStateV1(modules),
    director: emptyDirector(modules),
    quests: {
      instancesByKey: createInitialTextOpenWorldQuestInstancesV1(runtimePackage),
      resultTags: [],
      tracking: { primaryInstanceKey: null, pinnedInstanceKeys: [] },
    },
    map: {
      currentLocationKey: modules.world.initialLocationKey,
      revealedLocationKeys: modules.world.locations.filter(location => locationKnowledgeByKey[location.key] !== 'unknown').map(location => location.key),
      regionKnowledgeByKey, locationKnowledgeByKey,
      unlockedFastTravelPointKeys: modules.world.fastTravelPoints.filter(point => point.unlockedByDefault).map(point => point.key),
      openEdgeKeys: modules.world.edges.filter(edge => edge.conditionKeys.length === 0).map(edge => edge.key), travel: null,
    },
    time: {
      worldMinute: modules['time-weather'].initialWorldMinute,
      lastWeatherSettlementEpoch: Math.floor(modules['time-weather'].initialWorldMinute / modules['time-weather'].weatherUpdateIntervalMinutes),
      lastActorScheduleSettlementWorldMinute: timePeriodStartWorldMinute(modules, modules['time-weather'].initialWorldMinute),
      currentWeatherByRegionKey: Object.fromEntries(modules['time-weather'].regionWeatherTables.map(table => [table.regionKey, table.entries[0].weatherKey])),
      deadlineWorldMinuteByKey: {},
    },
    relationships: {
      morality: modules.relationships.morality.initial,
      factionAffinityByKey: Object.fromEntries(modules.actors.factions.map(faction => [faction.key, modules.relationships.factionAffinity.initial])),
      storyModifierByActorKey: {},
    },
    combat: null,
    actors: Object.fromEntries(modules.actors.actors.map(actor => [actor.key, actorInitialState(modules, actor.key, periodKey)])),
    world: {
      regionStateByKey: Object.fromEntries(modules.director.regionRules.map(rule => [rule.regionKey, [...rule.stateBands].sort((left, right) => right.minimumPressure - left.minimumPressure).find(band => rule.initialPressure >= band.minimumPressure)!.key])),
      regionPressureByKey: Object.fromEntries(modules.director.regionRules.map(rule => [rule.regionKey, rule.initialPressure])),
      factionStateByKey: Object.fromEntries(modules.actors.factions.map(faction => [faction.key, 'neutral'])),
      endingEligibleByKey: Object.fromEntries(modules.narrative.endings.map(ending => [ending.key, false])), flags: {},
    },
    knowledge: {
      visibilityByKey: Object.fromEntries(modules.knowledge.entries.map(entry => [entry.key, entry.initialPlayerVisibility])),
      readRumorKeys: [], earnedAchievementKeys: [], seenRandomEventKeys: [], history: [],
    },
    endings: { unlockedKeys: [], reachedKey: null }, appliedClaimKeys: [],
  }
}

function emptyDirector(modules: TextOpenWorldParsedModulesV1): TextOpenWorldDirectorProjectionV1 {
  return {
    drawCount: 0, generatedQuestInstanceCount: 0, revealedQuestInstanceKeys: [], activeQuestInstanceKeys: [],
    recentFingerprints: [], lastDrawWorldMinuteByRegionKey: {}, highIntensityStreak: 0,
    lastResolvedWorldMinuteBySourceKey: {},
    lastRegionSettlementWorldMinuteByRegionKey: Object.fromEntries(modules.world.regions.map(region => [region.key, modules['time-weather'].initialWorldMinute])),
    history: [],
  }
}

function parseDirectorRuntime(
  value: unknown,
  modules: TextOpenWorldParsedModulesV1,
  label: string,
  legacy: boolean,
): TextOpenWorldDirectorProjectionV1 {
  const director = row(value, label)
  exact(director, [
    'drawCount', 'generatedQuestInstanceCount', 'revealedQuestInstanceKeys', 'activeQuestInstanceKeys',
    'recentFingerprints', 'lastDrawWorldMinuteByRegionKey', 'highIntensityStreak',
    ...legacy ? [] : ['lastResolvedWorldMinuteBySourceKey', 'lastRegionSettlementWorldMinuteByRegionKey', 'history'],
  ], label)
  const recentFingerprints = Array.isArray(director.recentFingerprints)
    ? director.recentFingerprints.map((value, index) => {
        const item = row(value, `${label}.recentFingerprints[${index}]`)
        exact(item, ['fingerprint', 'worldMinute'], `${label}.recentFingerprints[${index}]`)
        return {
          fingerprint: token(item.fingerprint, `${label}.recentFingerprints[${index}].fingerprint`),
          worldMinute: integer(item.worldMinute, `${label}.recentFingerprints[${index}].worldMinute`),
        }
      })
    : fail(`${label}.recentFingerprints必须是数组`)
  const parseRegionMinuteMap = (rawValue: unknown, childLabel: string, complete: boolean) => {
    const raw = row(rawValue, childLabel); const result: Record<string, number> = {}
    for (const [regionKey, minute] of Object.entries(raw)) {
      if (!modules.world.regions.some(region => region.key === regionKey)) fail(`未知Director地区:${regionKey}`)
      result[regionKey] = integer(minute, `${childLabel}.${regionKey}`)
    }
    if (complete && canonicalProductProductionJsonV2(Object.keys(result).sort()) !== canonicalProductProductionJsonV2(modules.world.regions.map(region => region.key).sort())) fail(`${childLabel}必须覆盖全部地区`)
    return result
  }
  const lastDrawWorldMinuteByRegionKey = parseRegionMinuteMap(director.lastDrawWorldMinuteByRegionKey, `${label}.lastDrawWorldMinuteByRegionKey`, false)
  const sourceKeys = new Set([
    ...modules.director.templates.map(item => item.key),
    ...modules.director.randomEvents.map(item => item.key),
    ...modules.director.decks.flatMap(item => item.questKeys),
  ])
  const lastResolvedWorldMinuteBySourceKey: Record<string, number> = {}
  if (!legacy) {
    const raw = row(director.lastResolvedWorldMinuteBySourceKey, `${label}.lastResolvedWorldMinuteBySourceKey`)
    for (const [sourceKey, minute] of Object.entries(raw)) {
      if (!sourceKeys.has(sourceKey)) fail(`未知Director来源:${sourceKey}`)
      lastResolvedWorldMinuteBySourceKey[sourceKey] = integer(minute, `${label}.lastResolvedWorldMinuteBySourceKey.${sourceKey}`)
    }
  }
  const history = legacy ? [] : Array.isArray(director.history)
    ? director.history.map((value, index) => {
        const item = row(value, `${label}.history[${index}]`)
        exact(item, ['drawNumber', 'worldMinute', 'regionKey', 'trigger', 'outcomeKind', 'sourceKey', 'questInstanceKey', 'variantTextKey', 'fingerprint', 'intensity'], `${label}.history[${index}]`)
        const outcomeKind = enumToken(item.outcomeKind, ['blank', 'fixed-quest', 'template-quest', 'random-event'], `${label}.history[${index}].outcomeKind`)
        const sourceKey = nullableToken(item.sourceKey, `${label}.history[${index}].sourceKey`)
        if ((outcomeKind === 'blank') !== (sourceKey == null)) fail(`${label}.history[${index}]来源与结果不一致`)
        if (sourceKey && !sourceKeys.has(sourceKey)) fail(`${label}.history[${index}]引用未知来源:${sourceKey}`)
        return {
          drawNumber: integer(item.drawNumber, `${label}.history[${index}].drawNumber`, 1),
          worldMinute: integer(item.worldMinute, `${label}.history[${index}].worldMinute`),
          regionKey: token(item.regionKey, `${label}.history[${index}].regionKey`),
          trigger: enumToken(item.trigger, ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'], `${label}.history[${index}].trigger`),
          outcomeKind,
          sourceKey,
          questInstanceKey: nullableToken(item.questInstanceKey, `${label}.history[${index}].questInstanceKey`),
          variantTextKey: nullableToken(item.variantTextKey, `${label}.history[${index}].variantTextKey`),
          fingerprint: nullableToken(item.fingerprint, `${label}.history[${index}].fingerprint`),
          intensity: integer(item.intensity, `${label}.history[${index}].intensity`, 0, 10),
        }
      })
    : fail(`${label}.history必须是数组`)
  const lastRegionSettlementWorldMinuteByRegionKey = legacy
    ? Object.fromEntries(modules.world.regions.map(region => [region.key, modules['time-weather'].initialWorldMinute]))
    : parseRegionMinuteMap(director.lastRegionSettlementWorldMinuteByRegionKey, `${label}.lastRegionSettlementWorldMinuteByRegionKey`, true)
  return {
    drawCount: integer(director.drawCount, `${label}.drawCount`),
    generatedQuestInstanceCount: integer(director.generatedQuestInstanceCount, `${label}.generatedQuestInstanceCount`),
    revealedQuestInstanceKeys: uniqueTokens(director.revealedQuestInstanceKeys, `${label}.revealedQuestInstanceKeys`),
    activeQuestInstanceKeys: uniqueTokens(director.activeQuestInstanceKeys, `${label}.activeQuestInstanceKeys`),
    recentFingerprints,
    lastDrawWorldMinuteByRegionKey,
    highIntensityStreak: integer(director.highIntensityStreak, `${label}.highIntensityStreak`),
    lastResolvedWorldMinuteBySourceKey,
    lastRegionSettlementWorldMinuteByRegionKey,
    history,
  }
}

export function createInitialTextOpenWorldSessionProjectionV1(value: unknown): TextOpenWorldSessionProjectionV1 {
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(value); const modules = parseTextOpenWorldModulesV1(runtimePackage); const state = initialEffectState(runtimePackage, modules)
  state.quests.tracking.primaryInstanceKey = Object.values(state.quests.instancesByKey)
    .find(instance => modules.quests.quests.find(definition => definition.key === instance.definitionKey)?.type === 'mainline'
      && instance.status === 'revealed')?.instanceKey ?? null
  validateTextOpenWorldEffectStateV1(state, modules)
  return {
    schema: 'storyforge.text-open-world.session-projection', version: 1, runtimePackage,
    ruleset: { key: runtimePackage.metadata.rulesetKey, version: runtimePackage.metadata.rulesetVersion }, state,
    actions: { completedOnceActionKeys: [], cooldownUntilWorldMinuteByActionKey: {} }, director: structuredClone(state.director),
    memory: { version: 1, records: [], actorKnowledgeByActorKey: {} },
    protocol: { pendingCommandId: null, pendingCommandSequence: null, pendingActionKey: null, pendingActorKey: null, pendingTargetKey: null, pendingCombatTransitionIntent: null, pendingActionQuantity: null, pendingActionItemKey: null, pendingDirectorTrigger: null, randomEvidence: [], lastCompletedCommandId: null, lastOutcomeFingerprint: null },
    lastEventSequence: 0,
  }
}

/**
 * Returns every byte-level InitialState shape that this reader still supports.
 *
 * Action module v1 Releases were published before quest tracking became part of
 * the session projection. Their immutable hash must remain verifiable even
 * though parsing that state now migrates it to the current in-memory shape.
 * New Builds always hash the first (current) candidate.
 */
export function createTextOpenWorldInitialProjectionCandidatesV1(value: unknown): unknown[] {
  const current = createInitialTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(current.runtimePackage)
  const candidates: unknown[] = [current]
  // Releases produced before G6-08 freeze an otherwise current vNext initial
  // state without the product-owned memory projection. Keep that byte shape as
  // a verification candidate; parsing upgrades it to an empty in-memory view.
  const preMemory = structuredClone(current) as unknown as Row
  delete preMemory.memory
  candidates.push(preMemory)
  if (modules.actions.version === 1) {
    const legacy = structuredClone(current) as unknown as Row
    const legacyState = row(legacy.state, 'legacy projection.state')
    const legacyQuests = row(legacyState.quests, 'legacy projection.state.quests')
    delete legacyQuests.tracking
    candidates.push(legacy)
  }
  if (current.runtimePackage.modules.world.schemaVersion < 3) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyState = row(legacy.state, 'legacy projection.state')
      const legacyMap = row(legacyState.map, 'legacy projection.state.map')
      delete legacyMap.locationKnowledgeByKey
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 5 || modules['time-weather'].version < 2) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyState = row(legacy.state, 'legacy projection.state')
      const legacyTime = row(legacyState.time, 'legacy projection.state.time')
      delete legacyTime.lastWeatherSettlementEpoch
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 6) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyState = row(legacy.state, 'legacy projection.state')
      const legacyTime = row(legacyState.time, 'legacy projection.state.time')
      delete legacyTime.lastActorScheduleSettlementWorldMinute
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 9) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyProtocol = row(legacy.protocol, 'legacy projection.protocol')
      delete legacyProtocol.pendingCombatTransitionIntent
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 12) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyProtocol = row(legacy.protocol, 'legacy projection.protocol')
      delete legacyProtocol.pendingActionQuantity
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 13 || modules.economy.sourceVersion < 2) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyState = row(legacy.state, 'legacy projection.state')
      delete legacyState.economy
      const legacyProtocol = row(legacy.protocol, 'legacy projection.protocol')
      delete legacyProtocol.pendingActionItemKey
      candidates.push(legacy)
    }
  }
  if (modules.actions.version < 14 || modules.director.sourceVersion < 2) {
    for (const candidate of [...candidates]) {
      const legacy = structuredClone(candidate) as Row
      const legacyState = row(legacy.state, 'legacy projection.state')
      delete legacyState.director
      const legacyKnowledge = row(legacyState.knowledge, 'legacy projection.state.knowledge')
      delete legacyKnowledge.seenRandomEventKeys
      delete legacyKnowledge.history
      const legacyDirector = row(legacy.director, 'legacy projection.director')
      delete legacyDirector.lastResolvedWorldMinuteBySourceKey
      delete legacyDirector.lastRegionSettlementWorldMinuteByRegionKey
      delete legacyDirector.history
      const legacyProtocol = row(legacy.protocol, 'legacy projection.protocol')
      delete legacyProtocol.pendingDirectorTrigger
      candidates.push(legacy)
    }
  }
  return candidates
}

export function parseTextOpenWorldSessionProjectionV1(value: unknown): TextOpenWorldSessionProjectionV1 {
  const parsed = row(value, 'projection')
  const hasMemory = Object.prototype.hasOwnProperty.call(parsed, 'memory')
  exact(parsed, ['schema', 'version', 'runtimePackage', 'ruleset', 'state', 'actions', 'director', ...hasMemory ? ['memory'] : [], 'protocol', 'lastEventSequence'], 'projection')
  if (parsed.schema !== 'storyforge.text-open-world.session-projection' || parsed.version !== 1) fail('projection schema/version无效')
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(parsed.runtimePackage); const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const lastEventSequence = integer(parsed.lastEventSequence, 'lastEventSequence')
  const ruleset = row(parsed.ruleset, 'ruleset'); exact(ruleset, ['key', 'version'], 'ruleset')
  if (ruleset.key !== runtimePackage.metadata.rulesetKey || ruleset.version !== runtimePackage.metadata.rulesetVersion) fail('ruleset与RuntimePackage不一致')
  const state = structuredClone(parsed.state) as unknown as TextOpenWorldEffectStateV1
  const legacyEconomyState = state as TextOpenWorldEffectStateV1 & { economy?: TextOpenWorldEffectStateV1['economy'] }
  if (!legacyEconomyState.economy) {
    if (modules.actions.version >= 13 && modules.economy.sourceVersion >= 2) fail('新版Session缺少经济运行状态')
    legacyEconomyState.economy = createInitialTextOpenWorldEconomyStateV1(modules)
  }
  const legacyTime = state.time as TextOpenWorldEffectStateV1['time'] & { lastWeatherSettlementEpoch?: number }
  if (legacyTime.lastWeatherSettlementEpoch == null) {
    if (modules.actions.version >= 5 && modules['time-weather'].version >= 2) fail('新版Session缺少天气结算周期游标')
    legacyTime.lastWeatherSettlementEpoch = Math.floor(legacyTime.worldMinute / modules['time-weather'].weatherUpdateIntervalMinutes)
  }
  const legacyActorTime = state.time as TextOpenWorldEffectStateV1['time'] & { lastActorScheduleSettlementWorldMinute?: number }
  if (legacyActorTime.lastActorScheduleSettlementWorldMinute == null) {
    if (modules.actions.version >= 6) fail('新版Session缺少角色日程结算游标')
    legacyActorTime.lastActorScheduleSettlementWorldMinute = timePeriodStartWorldMinute(modules, legacyActorTime.worldMinute)
  }
  const legacyQuests = state.quests as TextOpenWorldEffectStateV1['quests'] & { tracking?: TextOpenWorldEffectStateV1['quests']['tracking'] }
  if (!legacyQuests.tracking) {
    legacyQuests.tracking = {
      primaryInstanceKey: Object.values(legacyQuests.instancesByKey)
        .find(instance => modules.quests.quests.find(definition => definition.key === instance.definitionKey)?.type === 'mainline'
          && ['revealed', 'accepted', 'active', 'suspended'].includes(instance.status))?.instanceKey ?? null,
      pinnedInstanceKeys: [],
    }
  }
  const legacyMap = state.map as TextOpenWorldEffectStateV1['map'] & { locationKnowledgeByKey?: TextOpenWorldEffectStateV1['map']['locationKnowledgeByKey'] }
  if (!legacyMap.locationKnowledgeByKey) {
    legacyMap.locationKnowledgeByKey = Object.fromEntries(modules.world.locations.map(location => [location.key, 'unknown']))
    legacyMap.revealedLocationKeys.forEach(locationKey => { legacyMap.locationKnowledgeByKey![locationKey] = 'heard' })
    legacyMap.locationKnowledgeByKey[legacyMap.currentLocationKey] = 'visited'
  }
  const currentDirectorContract = modules.actions.version >= 14 && modules.director.sourceVersion >= 2
  const topLevelDirectorRow = row(parsed.director, 'director')
  const legacyTopLevelDirector = !Object.prototype.hasOwnProperty.call(topLevelDirectorRow, 'lastResolvedWorldMinuteBySourceKey')
  if (legacyTopLevelDirector && currentDirectorContract) fail('新版Session缺少完整Director镜像')
  const stateWithLegacyDirector = state as TextOpenWorldEffectStateV1 & { director?: TextOpenWorldEffectStateV1['director'] }
  if (!stateWithLegacyDirector.director) {
    if (currentDirectorContract) fail('新版Session缺少Director运行状态')
    stateWithLegacyDirector.director = parseDirectorRuntime(parsed.director, modules, 'director', legacyTopLevelDirector)
  }
  const legacyKnowledge = state.knowledge as TextOpenWorldEffectStateV1['knowledge'] & {
    seenRandomEventKeys?: string[]
    history?: TextOpenWorldEffectStateV1['knowledge']['history']
  }
  if (!legacyKnowledge.seenRandomEventKeys || !legacyKnowledge.history) {
    if (currentDirectorContract) fail('新版Session缺少玩家知识历程')
    legacyKnowledge.seenRandomEventKeys ??= []
    legacyKnowledge.history ??= []
  }
  validateTextOpenWorldEffectStateV1(state, modules)
  if (Object.values(state.quests.instancesByKey).some(instance => instance.sourceContentHash !== runtimePackage.modules.quests.contentHash)) fail('任务实例来源Hash与冻结Quest模块不一致')
  const actions = row(parsed.actions, 'actions'); exact(actions, ['completedOnceActionKeys', 'cooldownUntilWorldMinuteByActionKey'], 'actions')
  const completedOnceActionKeys = uniqueTokens(actions.completedOnceActionKeys, 'actions.completedOnceActionKeys'); const actionKeys = new Set(modules.actions.actions.map(action => action.key)); completedOnceActionKeys.forEach(key => { if (!actionKeys.has(key)) fail(`未知once Action:${key}`) })
  const cooldowns = row(actions.cooldownUntilWorldMinuteByActionKey, 'actions.cooldownUntilWorldMinuteByActionKey'); const cooldownUntilWorldMinuteByActionKey: Record<string, number> = {}; for (const [key, value] of Object.entries(cooldowns)) { if (!actionKeys.has(token(key, 'cooldown actionKey'))) fail(`未知cooldown Action:${key}`); cooldownUntilWorldMinuteByActionKey[key] = integer(value, `cooldown.${key}`) }
  const director = parseDirectorRuntime(parsed.director, modules, 'director', legacyTopLevelDirector)
  if (currentDirectorContract && canonicalProductProductionJsonV2(state.director) !== canonicalProductProductionJsonV2(director)) fail('EffectState与顶层Director镜像不一致')
  state.director = structuredClone(director)
  const memory = hasMemory
    ? parseLongTermMemoryProjectionV1({ value: parsed.memory, modules, lastEventSequence })
    : { version: 1 as const, records: [], actorKnowledgeByActorKey: {} }
  const protocol = row(parsed.protocol, 'protocol')
  const legacyProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingTargetKey')
  const legacyCombatProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingCombatTransitionIntent')
  const legacyCraftingProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingActionQuantity')
  const legacyEconomyProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingActionItemKey')
  const legacyDirectorProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingDirectorTrigger')
  if (legacyCombatProtocol && modules.actions.version >= 9) fail('新版Session缺少战斗阶段命令游标')
  if (legacyCraftingProtocol && modules.actions.version >= 12) fail('新版Session缺少Action数量游标')
  if (legacyEconomyProtocol && modules.actions.version >= 13) fail('新版Session缺少交易物品游标')
  if (legacyDirectorProtocol && currentDirectorContract) fail('新版Session缺少Director触发游标')
  exact(protocol, [
    'pendingCommandId', 'pendingCommandSequence', 'pendingActionKey', 'pendingActorKey',
    ...legacyProtocol ? [] : ['pendingTargetKey'],
    ...legacyCombatProtocol ? [] : ['pendingCombatTransitionIntent'],
    ...legacyCraftingProtocol ? [] : ['pendingActionQuantity'],
    ...legacyEconomyProtocol ? [] : ['pendingActionItemKey'],
    ...legacyDirectorProtocol ? [] : ['pendingDirectorTrigger'],
    'randomEvidence', 'lastCompletedCommandId', 'lastOutcomeFingerprint',
  ], 'protocol')
  const pendingCommandId = nullableToken(protocol.pendingCommandId, 'protocol.pendingCommandId', COMMAND_ID); const pendingCommandSequence = protocol.pendingCommandSequence == null ? null : integer(protocol.pendingCommandSequence, 'protocol.pendingCommandSequence', 1); const pendingActionKey = nullableToken(protocol.pendingActionKey, 'protocol.pendingActionKey'); const pendingActorKey = nullableToken(protocol.pendingActorKey, 'protocol.pendingActorKey'); const pendingTargetKey = legacyProtocol ? null : nullableToken(protocol.pendingTargetKey, 'protocol.pendingTargetKey')
  const pendingCombatTransitionIntent = legacyCombatProtocol || protocol.pendingCombatTransitionIntent == null
    ? null
    : enumToken(protocol.pendingCombatTransitionIntent, ['begin-round', 'begin-turn', 'complete-turn', 'advance-turn', 'finish-victory', 'finish-defeat', 'finish-escaped'], 'protocol.pendingCombatTransitionIntent')
  const pendingActionQuantity = legacyCraftingProtocol || protocol.pendingActionQuantity == null
    ? null
    : integer(protocol.pendingActionQuantity, 'protocol.pendingActionQuantity', 1)
  const pendingActionItemKey = legacyEconomyProtocol ? null : nullableToken(protocol.pendingActionItemKey, 'protocol.pendingActionItemKey')
  const pendingDirectorTrigger = legacyDirectorProtocol || protocol.pendingDirectorTrigger == null
    ? null
    : enumToken<TextOpenWorldDirectorTriggerV1>(protocol.pendingDirectorTrigger, ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'], 'protocol.pendingDirectorTrigger')
  if ((pendingCommandId == null) !== (pendingCommandSequence == null) || (pendingCommandId == null) !== (pendingActionKey == null) || (pendingCommandId == null) !== (pendingActorKey == null)) fail('pending command字段必须同时存在或为空')
  if (pendingCombatTransitionIntent != null && pendingCommandId == null) fail('战斗阶段intent不能脱离pending command')
  if (pendingActionQuantity != null && pendingCommandId == null) fail('Action数量不能脱离pending command')
  if (pendingActionItemKey != null && pendingCommandId == null) fail('交易物品不能脱离pending command')
  if (pendingDirectorTrigger != null && pendingCommandId == null) fail('Director触发不能脱离pending command')
  if (pendingActionKey && !actionKeys.has(pendingActionKey)) fail('pendingActionKey不存在')
  if (pendingDirectorTrigger != null) {
    const pendingAction = modules.actions.actions.find(action => action.key === pendingActionKey)
    if (pendingAction?.category !== 'director-action') fail('Director触发只能属于Director系统Action')
  }
  const randomEvidence = Array.isArray(protocol.randomEvidence) ? protocol.randomEvidence.map((value, index) => { const item = row(value, `protocol.randomEvidence[${index}]`); exact(item, ['eventSequence', 'evidence'], `protocol.randomEvidence[${index}]`); return { eventSequence: integer(item.eventSequence, `protocol.randomEvidence[${index}].eventSequence`, 1), evidence: parseTextOpenWorldRandomEvidenceV1(item.evidence) } }) : fail('protocol.randomEvidence必须是数组')
  if (new Set(randomEvidence.map(item => item.eventSequence)).size !== randomEvidence.length || randomEvidence.some((item, index) => item.eventSequence > lastEventSequence || (index > 0 && randomEvidence[index - 1].eventSequence >= item.eventSequence))) fail('protocol.randomEvidence序号无效')
  if (pendingCommandSequence != null && pendingCommandSequence > lastEventSequence) fail('pendingCommandSequence超过投影序号')
  const { revealedQuestInstanceKeys, activeQuestInstanceKeys, generatedQuestInstanceCount, highIntensityStreak } = director
  if (generatedQuestInstanceCount > modules.director.rules.maximumQuestInstances || revealedQuestInstanceKeys.length > modules.director.rules.globalMaximumRevealed || activeQuestInstanceKeys.length > modules.director.rules.globalMaximumActive || highIntensityStreak > modules.director.rules.highIntensityStreakLimit || director.history.length > modules.director.rules.historyLimit) fail('director投影超过Release预算')
  const directorInstanceKeys = new Set(Object.values(state.quests.instancesByKey).filter(instance => instance.sourceKind === 'director').map(instance => instance.instanceKey))
  const fixedQuestDefinitionKeys = new Set(modules.director.decks.flatMap(deck => deck.questKeys))
  const managedInstanceKeys = new Set(Object.values(state.quests.instancesByKey).filter(instance => instance.sourceKind === 'director' || fixedQuestDefinitionKeys.has(instance.definitionKey)).map(instance => instance.instanceKey))
  if (directorInstanceKeys.size !== generatedQuestInstanceCount) fail('director实例数量与任务实例账本不一致')
  for (const instanceKey of [...revealedQuestInstanceKeys, ...activeQuestInstanceKeys]) if (!managedInstanceKeys.has(instanceKey)) fail(`director引用未知管理任务实例:${instanceKey}`)
  const expectedRevealed = [...managedInstanceKeys].filter(instanceKey => ['revealed', 'accepted', 'active', 'suspended'].includes(state.quests.instancesByKey[instanceKey].status)).sort()
  const expectedActive = [...managedInstanceKeys].filter(instanceKey => ['accepted', 'active', 'suspended'].includes(state.quests.instancesByKey[instanceKey].status)).sort()
  if (canonicalProductProductionJsonV2([...revealedQuestInstanceKeys].sort()) !== canonicalProductProductionJsonV2(expectedRevealed)
    || canonicalProductProductionJsonV2([...activeQuestInstanceKeys].sort()) !== canonicalProductProductionJsonV2(expectedActive)) fail('director任务预算镜像与任务状态不一致')
  director.history.forEach((entry, index) => {
    if (!modules.world.regions.some(region => region.key === entry.regionKey) || entry.worldMinute > state.time.worldMinute || entry.drawNumber > director.drawCount || (index > 0 && director.history[index - 1].drawNumber >= entry.drawNumber)) fail('director历史顺序或引用无效')
    if (entry.questInstanceKey != null && !state.quests.instancesByKey[entry.questInstanceKey]) fail(`director历史引用未知任务实例:${entry.questInstanceKey}`)
  })
  Object.values(director.lastRegionSettlementWorldMinuteByRegionKey).forEach(minute => { if (minute > state.time.worldMinute) fail('Director地区结算游标不能晚于世界时间') })
  return {
    schema: 'storyforge.text-open-world.session-projection', version: 1, runtimePackage, ruleset: { key: token(ruleset.key, 'ruleset.key'), version: integer(ruleset.version, 'ruleset.version', 1) }, state,
    actions: { completedOnceActionKeys, cooldownUntilWorldMinuteByActionKey },
    director: structuredClone(director),
    memory,
    protocol: { pendingCommandId, pendingCommandSequence, pendingActionKey, pendingActorKey, pendingTargetKey, pendingCombatTransitionIntent, pendingActionQuantity, pendingActionItemKey, pendingDirectorTrigger, randomEvidence, lastCompletedCommandId: nullableToken(protocol.lastCompletedCommandId, 'protocol.lastCompletedCommandId', COMMAND_ID), lastOutcomeFingerprint: nullableToken(protocol.lastOutcomeFingerprint, 'protocol.lastOutcomeFingerprint', /^[a-f0-9]{64}$/) },
    lastEventSequence,
  }
}

export function applyTextOpenWorldSessionEventV1(current: TextOpenWorldSessionProjectionV1, event: ProductRuntimeEvent): TextOpenWorldSessionProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(current)
  if (event.sequence <= projection.lastEventSequence) fail(`Session投影事件序号未前进:${projection.lastEventSequence}->${event.sequence}`)
  if (event.type === 'text-open-world.command.committed') {
    if (projection.protocol.pendingCommandId) fail('上一命令尚未终结')
    const command = parseTextOpenWorldCommandEventPayloadV1(json(event)); if (command.envelope.commandId !== event.commandId) fail('命令事件索引不一致')
    projection.protocol.pendingCommandId = command.envelope.commandId; projection.protocol.pendingCommandSequence = event.sequence; projection.protocol.pendingActionKey = command.envelope.actionKey; projection.protocol.pendingActorKey = command.envelope.actorKey; projection.protocol.pendingTargetKey = typeof command.envelope.payload.targetKey === 'string' ? command.envelope.payload.targetKey : null
    projection.protocol.pendingCombatTransitionIntent = typeof command.envelope.payload.combatTransitionIntent === 'string'
      ? enumToken<TextOpenWorldCombatTransitionIntentV1>(command.envelope.payload.combatTransitionIntent, ['begin-round', 'begin-turn', 'complete-turn', 'advance-turn', 'finish-victory', 'finish-defeat', 'finish-escaped'], 'command combatTransitionIntent')
      : null
    const commandAction = parseTextOpenWorldModulesV1(projection.runtimePackage).actions.actions.find(action => action.key === command.envelope.actionKey) ?? fail('命令Action不存在')
    if (commandAction.category === 'director-action') {
      projection.protocol.pendingDirectorTrigger = enumToken<TextOpenWorldDirectorTriggerV1>(command.envelope.payload.directorTrigger, ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'], 'command directorTrigger')
    } else {
      if (command.envelope.payload.directorTrigger != null) fail('非Director Action不能提交directorTrigger')
      projection.protocol.pendingDirectorTrigger = null
    }
    if (commandAction.category === 'craft') {
      projection.protocol.pendingActionQuantity = integer(command.envelope.payload.quantity, 'command quantity', 1)
      if (command.envelope.payload.itemKey != null) fail('制作Action不能提交交易itemKey')
      projection.protocol.pendingActionItemKey = null
    } else if (commandAction.category === 'buy' || commandAction.category === 'sell') {
      projection.protocol.pendingActionQuantity = integer(command.envelope.payload.quantity, 'command quantity', 1)
      projection.protocol.pendingActionItemKey = token(command.envelope.payload.itemKey, 'command itemKey')
    } else {
      if (command.envelope.payload.quantity != null || command.envelope.payload.itemKey != null) fail('非制作或交易Action不能提交quantity/itemKey')
      projection.protocol.pendingActionQuantity = null
      projection.protocol.pendingActionItemKey = null
    }
  } else if (event.type === 'text-open-world.random.resolved') {
    const pendingEvidence = projection.protocol.randomEvidence.filter(item => item.eventSequence > (projection.protocol.pendingCommandSequence ?? Number.MAX_SAFE_INTEGER))
    const random = parseTextOpenWorldRandomResolvedEventPayloadV1(json(event)); if (random.commandId !== projection.protocol.pendingCommandId || random.commandSequence !== projection.protocol.pendingCommandSequence || random.evidence.drawIndex !== pendingEvidence.length) fail('随机事件不属于当前命令')
    if (canonicalProductProductionJsonV2(random.ruleset) !== canonicalProductProductionJsonV2(projection.ruleset)) fail('随机事件ruleset不一致')
    projection.protocol.randomEvidence.push({ eventSequence: event.sequence, evidence: random.evidence })
  } else if (event.type === 'text-open-world.effects.applied') {
    const applied = parseTextOpenWorldEffectsAppliedEventPayloadV1(json(event)); if (applied.commandId !== projection.protocol.pendingCommandId || applied.commandSequence !== projection.protocol.pendingCommandSequence) fail('Effect事件不属于当前命令')
    const pendingRandom = projection.protocol.randomEvidence.filter(item => item.eventSequence > (projection.protocol.pendingCommandSequence ?? Number.MAX_SAFE_INTEGER))
    const pendingRandomSequences = pendingRandom.map(item => item.eventSequence)
    if (canonicalProductProductionJsonV2(applied.ruleset) !== canonicalProductProductionJsonV2(projection.ruleset) || canonicalProductProductionJsonV2(applied.randomEventSequences) !== canonicalProductProductionJsonV2(pendingRandomSequences)) fail('Effect事件ruleset或随机序列不一致')
    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    const dropEffectKeys = new Set(modules.items.dropTables.flatMap(table => table.entries.flatMap(entry => entry.quantityEffects.map(mapping => mapping.effectKey))))
    if (projection.protocol.pendingCombatTransitionIntent != null && applied.plan.authorization?.kind !== 'combat-transition') fail('战斗阶段命令缺少CombatTransition授权')
    if (applied.plan.authorization?.kind === 'reward') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const reward = modules.items.rewardContracts.find(item => item.key === authorization.rewardKey) ?? fail('奖励合同不存在')
      if (reward.sourceKind === 'quest') {
        const instance = projection.state.quests.instancesByKey[authorization.sourceInstanceKey] ?? fail('奖励任务实例不存在')
        const definition = modules.quests.quests.find(item => item.key === instance.definitionKey) ?? fail('奖励任务定义不存在')
        if (projection.protocol.pendingTargetKey !== instance.instanceKey || projection.protocol.pendingActorKey !== 'player'
          || action.category !== 'claim-reward' || action.actorScope !== 'player' || action.targetScope !== 'quest'
          || definition.rewardContractKey !== reward.key || definition.claimActionKey !== action.key
          || instance.status !== 'completed' || instance.rewardClaimKey != null) fail('任务奖励领取授权与命令或任务状态不一致')
      } else if (reward.sourceKind === 'combat') {
        const combat = projection.state.combat
        const encounter = modules.combat.encounters.find(item => item.rewardContractKey === reward.key) ?? fail('战斗奖励没有所属遭遇')
        if (!combat || !('version' in combat) || combat.status !== 'victory' || combat.phase !== 'terminal'
          || combat.encounterKey !== encounter.key || authorization.sourceInstanceKey !== combat.instanceKey
          || projection.protocol.pendingTargetKey !== encounter.key || projection.protocol.pendingActorKey !== 'system'
          || action.category !== 'combat-reward-action' || action.actorScope !== 'system' || action.targetScope !== 'encounter') {
          fail('战斗奖励领取授权与命令或胜利状态不一致')
        }
      }
      const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults).map(([key, result]) => [key, result.satisfied]))
      createTextOpenWorldRewardCatalogV1(projection.runtimePackage).assertAuthorization({
        claimKey: applied.plan.claimKey, effectKeys: applied.plan.effectKeys, authorization,
        evidence: pendingRandom.map(item => item.evidence), conditionResults,
      })
    } else if (applied.plan.authorization?.kind === 'quest-transition') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('任务迁移EffectPlan与命令Action不一致')
      if (projection.protocol.pendingTargetKey !== authorization.instanceKey || action.targetScope !== 'quest') fail('任务迁移授权与命令目标不一致')
      if (action.actorScope !== projection.protocol.pendingActorKey) fail('任务迁移Action操作者不一致')
      const intents = authorization.transitions.map(step => step.intent)
      if (action.category === 'accept-quest') {
        if (intents.join(',') !== 'accept,activate') fail('接受任务必须原子完成accept与activate')
      } else if (action.category === 'restart-quest') {
        if (intents.join(',') !== 'reoffer,reveal,accept,activate') fail('重新接取任务必须原子完成reoffer、reveal、accept与activate')
      } else if (action.category === 'abandon-quest') {
        if (intents.length !== 1 || intents[0] !== 'abandon') fail('放弃任务Action只能执行abandon')
      } else if (action.category !== 'quest-action' || action.actorScope !== 'system') fail('任务系统迁移必须使用system quest-action')
      if (action.category === 'quest-action') {
        const conditionResults = deriveTextOpenWorldContextsV1(projection).action.conditionResults
        if (action.requirementConditionKeys.some(conditionKey => conditionResults[conditionKey]?.satisfied !== true)) fail('任务系统迁移条件未满足')
      }
      createTextOpenWorldQuestTransitionCatalogV1(projection.runtimePackage).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'quest-objective') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('Objective EffectPlan与命令Action不一致')
      if (projection.protocol.pendingTargetKey !== authorization.instanceKey || projection.protocol.pendingActorKey !== 'player'
        || action.category !== 'objective-action' || action.actorScope !== 'player' || action.targetScope !== 'quest') fail('Objective授权与命令目标不一致')
      createTextOpenWorldObjectiveCatalogV1(projection.runtimePackage).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'quest-tracking') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      const expectedCategory = authorization.operation === 'track' ? 'track' : 'untrack'
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('任务追踪EffectPlan与命令Action不一致')
      if (projection.protocol.pendingTargetKey !== authorization.instanceKey || projection.protocol.pendingActorKey !== 'player'
        || action.category !== expectedCategory || action.actorScope !== 'player' || action.targetScope !== 'quest') fail('任务追踪授权与命令目标不一致')
      createTextOpenWorldQuestTrackingCatalogV1(projection.runtimePackage).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'fast-travel') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      const fastTravelEffect = action.successEffectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
        .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'fast-travel' }> => effect.operation === 'fast-travel')
        ?? fail('快速旅行Action缺少fast-travel Effect')
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('快速旅行EffectPlan与命令Action不一致')
      if (projection.protocol.pendingTargetKey !== authorization.destinationLocationKey || projection.protocol.pendingActorKey !== 'player'
        || action.category !== 'fast-travel' || action.actorScope !== 'player' || action.targetScope !== 'location') fail('快速旅行授权与命令目标不一致')
      createTextOpenWorldFastTravelCatalogV1(projection.runtimePackage, modules).assertAuthorization({ state: projection.state, effect: fastTravelEffect, authorization })
    } else if (applied.plan.authorization?.kind === 'weather-settlement') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('天气结算EffectPlan与命令Action不一致')
      if (projection.protocol.pendingActorKey !== 'system' || projection.protocol.pendingTargetKey !== null
        || action.category !== 'weather-action' || action.actorScope !== 'system' || action.targetScope !== 'none') fail('天气结算授权与系统命令不一致')
      createTextOpenWorldWeatherCatalogV1(projection.runtimePackage, modules).assertAuthorization({
        state: projection.state,
        authorization,
        evidence: pendingRandom.map(item => item.evidence),
      })
    } else if (applied.plan.authorization?.kind === 'actor-schedule-settlement') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('角色日程结算EffectPlan与命令Action不一致')
      if (projection.protocol.pendingActorKey !== 'system' || projection.protocol.pendingTargetKey !== null
        || action.category !== 'actor-schedule-action' || action.actorScope !== 'system' || action.targetScope !== 'none') fail('角色日程结算授权与系统命令不一致')
      createTextOpenWorldActorScheduleCatalogV1(projection.runtimePackage, modules).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'combat-transition') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('战斗阶段EffectPlan与命令Action不一致')
      if (projection.protocol.pendingActorKey !== 'system' || projection.protocol.pendingTargetKey !== authorization.encounterKey
        || projection.protocol.pendingCombatTransitionIntent !== authorization.intent
        || action.category !== 'combat-state-action' || action.actorScope !== 'system' || action.targetScope !== 'encounter'
        || applied.outcome !== 'success' || applied.reason != null || applied.degradation != null) fail('战斗阶段授权与系统命令不一致')
      createTextOpenWorldCombatStateMachineV1(projection.runtimePackage, modules).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'combat-action') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const authorizationSkill = authorization.skillKey == null
        ? null
        : modules.progression.skills.find(skill => skill.key === authorization.skillKey)
          ?? fail('战斗授权技能不存在')
      const expectedTargetKey = authorization.actionKind === 'item'
        ? authorization.itemKey
        : authorization.actionKind !== 'enemy-skill' && authorizationSkill?.target === 'single-enemy'
          ? authorization.targetCombatantKeys[0]
          : null
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(authorization.effectKeys)
        || action.key !== authorization.actionKey || projection.protocol.pendingActorKey !== authorization.actorKey
        || projection.protocol.pendingTargetKey !== expectedTargetKey
        || !['combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'escape'].includes(action.category)
        || applied.outcome !== 'success' || applied.reason != null || applied.degradation != null) fail('战斗行动授权与命令或Action不一致')
      createTextOpenWorldCombatActionCatalogV1(projection.runtimePackage, modules).assertAuthorization({
        state: projection.state,
        authorization,
        evidence: pendingRandom.map(item => item.evidence),
        conditionResults: Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
          .map(([key, result]) => [key, result.satisfied])),
      })
    } else if (applied.plan.authorization?.kind === 'crafting') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      if (projection.protocol.pendingActorKey !== 'player' || projection.protocol.pendingTargetKey !== authorization.recipeKey
        || projection.protocol.pendingActionQuantity !== authorization.quantity || projection.protocol.pendingActionItemKey !== null
        || action.category !== 'craft' || action.actorScope !== 'player' || action.targetScope !== 'recipe'
        || applied.plan.effectKeys.length !== 1 || applied.plan.effectKeys[0] !== action.successEffectKeys[0]
        || applied.outcome !== 'success' || applied.reason != null || applied.degradation != null) fail('制作授权与命令或Action不一致')
      const conditionResults = deriveTextOpenWorldContextsV1(projection).action.conditionResults
      if (action.requirementConditionKeys.some(conditionKey => conditionResults[conditionKey]?.satisfied !== true)) fail('制作Action条件未满足')
      createTextOpenWorldCraftingCatalogV1(projection.runtimePackage, modules).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'transaction') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      if (projection.protocol.pendingActorKey !== 'player' || projection.protocol.pendingTargetKey !== authorization.vendorKey
        || projection.protocol.pendingActionQuantity !== authorization.quantity || projection.protocol.pendingActionItemKey !== authorization.itemKey
        || action.category !== authorization.transactionKind || action.actorScope !== 'player' || action.targetScope !== 'vendor'
        || applied.plan.effectKeys.length !== 1 || applied.plan.effectKeys[0] !== action.successEffectKeys[0]
        || applied.outcome !== 'success' || applied.reason != null || applied.degradation != null) fail('交易授权与命令或Action不一致')
      const marker = applied.plan.effects[0]
      if (marker.operation !== 'perform-transaction' || marker.payload.kind !== authorization.transactionKind || marker.payload.vendorKey !== authorization.vendorKey) fail('交易Effect与授权不一致')
      const conditionResults = deriveTextOpenWorldContextsV1(projection).action.conditionResults
      if (action.requirementConditionKeys.some(conditionKey => conditionResults[conditionKey]?.satisfied !== true)) fail('交易Action条件未满足')
      createTextOpenWorldEconomyCatalogV1(projection.runtimePackage, modules).assertAuthorization({ state: projection.state, authorization })
    } else if (applied.plan.authorization?.kind === 'director-settlement') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const markerEffectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
      const expectedEffectKeys = [...markerEffectKeys, ...authorization.selection.effectKeys]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)
        || projection.protocol.pendingActorKey !== 'system' || projection.protocol.pendingTargetKey !== null
        || projection.protocol.pendingDirectorTrigger !== authorization.trigger
        || action.category !== 'director-action' || action.actorScope !== 'system' || action.targetScope !== 'none'
        || applied.outcome !== 'success' || applied.reason != null || applied.degradation != null) fail('Director授权与系统命令不一致')
      const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
        .map(([key, result]) => [key, result.satisfied]))
      createTextOpenWorldDirectorCatalogV1(projection.runtimePackage, modules).assertAuthorization({
        state: projection.state,
        authorization,
        conditionResults,
        evidence: pendingRandom.map(item => item.evidence),
      })
    } else if (applied.plan.authorization?.kind === 'crime') {
      const authorization = applied.plan.authorization
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      if (projection.protocol.pendingActorKey !== 'player' || projection.protocol.pendingTargetKey !== authorization.targetActorKey
        || action.actorScope !== 'player' || action.targetScope !== 'actor' || action.key !== authorization.actionKey
        || action.category !== authorization.crimeKind || applied.outcome !== authorization.outcome
        || canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(authorization.effectKeys)) {
        fail('犯罪结果与命令、Action或Effect授权不一致')
      }
      if (applied.outcome === 'failure' ? applied.reason?.code !== 'crime-attempt-failed' : applied.reason != null) fail('犯罪结果原因与成败不一致')
      const conditionResults = deriveTextOpenWorldContextsV1(projection).action.conditionResults
      createTextOpenWorldCrimeCatalogV1(projection.runtimePackage, modules).assertAuthorization({
        state: projection.state,
        authorization,
        conditionResults,
      })
    } else {
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const outcomeEffectKeys = applied.outcome === 'failure' ? action.failureEffectKeys : action.successEffectKeys
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...outcomeEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('EffectPlan与命令Action不一致')
      if (applied.plan.effectKeys.some(effectKey => dropEffectKeys.has(effectKey))) fail('掉落Effect缺少RewardContract授权')
      if (['use', 'drop', 'equip', 'unequip'].includes(action.category)) {
        assertTextOpenWorldItemActionReplayBindingV1({
          action,
          effects: modules.actions.effects,
          pendingActorKey: projection.protocol.pendingActorKey === 'player' || projection.protocol.pendingActorKey === 'system'
            ? projection.protocol.pendingActorKey
            : projection.protocol.pendingActorKey === null ? null : fail('物品Action命令操作者无效'),
          pendingTargetKey: projection.protocol.pendingTargetKey,
        })
      }
      const actorStateEffect = applied.plan.effects.find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'change-actor-state' }> => effect.operation === 'change-actor-state')
      if (actorStateEffect) {
        if (projection.protocol.pendingTargetKey !== actorStateEffect.payload.actorKey || action.targetScope !== 'actor') fail('Actor状态Effect与命令目标不一致')
        if (actorStateEffect.payload.cause === 'player-attack') {
          if (projection.protocol.pendingActorKey !== 'player' || action.actorScope !== 'player' || action.category !== 'attack-actor') fail('玩家攻击Actor结果必须来自受治理攻击Action')
        } else if (projection.protocol.pendingActorKey !== 'system' || action.actorScope !== 'system' || action.category !== 'actor-state-action') {
          fail('剧情或事件Actor结果必须来自受治理系统Action')
        }
      }
      if (action.category === 'travel') {
        const start = action.successEffectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
          .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'start-travel' }> => effect.operation === 'start-travel')
          ?? fail('普通旅行Action缺少start-travel Effect')
        if (projection.protocol.pendingActorKey !== 'player' || projection.protocol.pendingTargetKey !== start.payload.destinationLocationKey
          || !action.locationKeys.includes(projection.state.map.currentLocationKey)) fail('普通旅行命令与当前地点或目标不一致')
      }
    }
    projection.state = applyTextOpenWorldEffectPlanForReplayV1(projection.runtimePackage, projection.state, applied.plan).state
    const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
    if (action.repeatPolicy === 'once' && !projection.actions.completedOnceActionKeys.includes(action.key)) projection.actions.completedOnceActionKeys.push(action.key)
    if (action.repeatPolicy === 'cooldown') projection.actions.cooldownUntilWorldMinuteByActionKey[action.key] = projection.state.time.worldMinute + (action.cooldownMinutes ?? 0)
    projection.protocol.lastCompletedCommandId = applied.commandId; projection.protocol.lastOutcomeFingerprint = applied.outcomeFingerprint
    projection.director = structuredClone(projection.state.director)
    projection.protocol.pendingCommandId = null; projection.protocol.pendingCommandSequence = null; projection.protocol.pendingActionKey = null; projection.protocol.pendingActorKey = null; projection.protocol.pendingTargetKey = null; projection.protocol.pendingCombatTransitionIntent = null; projection.protocol.pendingActionQuantity = null; projection.protocol.pendingActionItemKey = null; projection.protocol.pendingDirectorTrigger = null
  } else if (event.type === 'text-open-world.memory.committed') {
    if (projection.protocol.pendingCommandId) fail('待处理命令期间不能写入长期记忆')
    const memory = parseTextOpenWorldMemoryCommittedEventPayloadV1(json(event))
    if (event.commandId != null) fail('长期记忆事件不能绑定命令')
    // baseSequence belongs to the shared ProductRuntime stream. Shared events
    // can advance it without entering this product-private projection; the
    // async event protocol validates the exact global predecessor.
    if (event.baseStateHash == null) fail('长期记忆事件缺少基线状态Hash')
    if (event.actorKey !== 'player') fail('长期记忆事件只能由玩家确认')
    if (event.targetKey !== memory.actorKey) fail('长期记忆事件目标角色不一致')
    if (memory.worldMinute !== projection.state.time.worldMinute) fail('长期记忆世界时间与当前投影不一致')
    if (memory.coveredEventSequences.some(sequence => sequence >= event.sequence)) fail('长期记忆不能引用自身或未来事件')
    if (projection.memory.records.some(record => record.memoryKey === memory.memoryKey
      || record.sourceDialogueHash === memory.sourceDialogueHash)) fail('长期记忆窗口已经提交')

    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    const knowledgeKeys = new Set(modules.knowledge.entries.map(entry => entry.key))
    const actor = memory.actorKey == null
      ? null
      : modules.actors.actors.find(item => item.key === memory.actorKey) ?? fail('长期记忆Actor不存在')
    const scene = memory.sceneKey == null || modules.narrative.version !== 2
      ? null
      : modules.narrative.scenes.find(item => item.key === memory.sceneKey) ?? fail('长期记忆Scene不存在')
    if (memory.kind === 'dialogue-window') {
      const actorState = actor ? projection.state.actors[actor.key] : null
      if (!actor || !scene || scene.actorKey !== actor.key || !actorState?.alive || !actorState.present
        || actorState.locationKey !== projection.state.map.currentLocationKey) {
        fail('长期对白记忆必须绑定当前地点仍在场的存活角色')
      }
    }
    const acquiredActorKnowledge = new Set(actor ? projection.memory.actorKnowledgeByActorKey[actor.key] ?? [] : [])
    const actorKnownBefore = new Set(actor
      ? modules.knowledge.entries
        .filter(entry => entry.actorKeys.includes(actor.key) || acquiredActorKnowledge.has(entry.key))
        .map(entry => entry.key)
      : [])
    const sceneAllowed = new Set(scene?.allowedKnowledgeClaimKeys ?? [])
    if (memory.sourceDialogueKnowledgeKeys.some(key => !knowledgeKeys.has(key)
      || !actorKnownBefore.has(key) || !sceneAllowed.has(key))) {
      fail('长期记忆引用了NPC当时不知道或场景不允许声明的知识')
    }
    if (memory.sourceDialogueKnowledgeKeys.some(key => !memory.playerKnowledgeKeys.includes(key))) {
      fail('NPC实际引用知识必须进入玩家知识回执')
    }
    const playerKnownBefore = new Set(Object.entries(projection.state.knowledge.visibilityByKey)
      .filter(([, visibility]) => visibility === 'known').map(([key]) => key))
    const dialogueKnown = new Set(memory.sourceDialogueKnowledgeKeys)
    if (memory.playerKnowledgeKeys.some(key => !knowledgeKeys.has(key)
      || (!playerKnownBefore.has(key) && !dialogueKnown.has(key)))) {
      fail('玩家长期记忆只能包含原已知或本窗口由NPC实际引用的知识')
    }
    if (memory.actorKnowledgeKeys.some(key => !knowledgeKeys.has(key)
      || (!playerKnownBefore.has(key) && !dialogueKnown.has(key) && !actorKnownBefore.has(key)))) {
      fail('角色长期记忆只能包含玩家原已知、本窗口已说出或角色本来知道的知识')
    }
    const visibleInstances = Object.values(projection.state.quests.instancesByKey)
      .filter(instance => !['locked', 'available'].includes(instance.status))
    const visibleDefinitions = new Set(visibleInstances.map(instance => instance.definitionKey))
    const openThreadKeys = new Set([
      ...visibleInstances.map(instance => instance.instanceKey),
      ...visibleDefinitions,
      ...modules.narrative.storylines.flatMap(storyline => storyline.stageKeys.some(stageKey => (
        modules.narrative.stages.find(stage => stage.key === stageKey)?.questKeys.some(key => visibleDefinitions.has(key))
      )) ? [storyline.key] : []),
    ])
    if (memory.openThreadKeys.some(key => !openThreadKeys.has(key))) fail('长期记忆引用了尚未公开的故事线程')

    const regionKey = modules.world.locations.find(location => location.key === projection.state.map.currentLocationKey)!.regionKey
    for (const key of memory.playerKnowledgeKeys) {
      if (projection.state.knowledge.visibilityByKey[key] === 'known') continue
      projection.state.knowledge.visibilityByKey[key] = 'known'
      projection.state.knowledge.history.push({
        kind: 'knowledge-revealed', targetKey: key, sourceKey: memory.memoryKey,
        regionKey, worldMinute: projection.state.time.worldMinute,
      })
    }
    projection.state.knowledge.history = projection.state.knowledge.history.slice(-modules.director.rules.historyLimit)
    if (actor) {
      projection.memory.actorKnowledgeByActorKey[actor.key] = [...new Set([
        ...(projection.memory.actorKnowledgeByActorKey[actor.key] ?? []),
        ...memory.actorKnowledgeKeys,
      ])].sort()
    }
    const { schema: _schema, version: _version, ...memoryRecord } = memory
    projection.memory.records.push({ ...memoryRecord, committedSequence: event.sequence, inherited: false })
    projection.memory.records = projection.memory.records.slice(-64)
    validateTextOpenWorldEffectStateV1(projection.state, modules)
  } else fail(`事件类型不属于vNext Session投影:${event.type}`)
  projection.lastEventSequence = event.sequence
  return parseTextOpenWorldSessionProjectionV1(projection)
}

export function deriveTextOpenWorldContextsV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldDerivedContextsV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value); const modules = parseTextOpenWorldModulesV1(projection.runtimePackage); const state = projection.state
  const clockWeather = projectTextOpenWorldClockWeatherV1({ runtimePackage: projection.runtimePackage, state, parsedModules: modules })
  const regionKey = clockWeather.regionKey; const periodKey = clockWeather.timePeriodKey
  const attitudeByActorKey = deriveTextOpenWorldAttitudeByActorKeyV1({
    runtimePackage: projection.runtimePackage,
    state,
    parsedModules: modules,
  })
  const playerStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes,
    equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory),
  })
  const progression = deriveTextOpenWorldProgressionStatusV1(modules, state.player.experience)
  const inventoryQuantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, state.inventory)
  const removableInventoryQuantities = deriveTextOpenWorldRemovableInventoryQuantitiesV1(modules, state.inventory)
  const questCondition = deriveTextOpenWorldQuestConditionProjectionV1(modules, state.quests)
  const condition: TextOpenWorldConditionEvaluationContextV1 = {
    player: {
      level: state.player.level, experience: state.player.experience,
      health: state.player.health, maximumHealth: playerStats.maximumHealth,
      skillResource: state.player.skillResource, maximumSkillResource: playerStats.maximumSkillResource,
      morality: state.relationships.morality, attributes: structuredClone(state.player.attributes), statusKeys: [...state.player.statusKeys],
    },
    inventory: { itemQuantities: inventoryQuantities, currency: state.inventory.currency, equippedItemKeys: Object.values(deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory)).filter((key): key is string => key != null), knownRecipeKeys: [...state.inventory.knownRecipeKeys] },
    quests: { ...questCondition, resultTags: [...state.quests.resultTags] },
    map: { currentLocationKey: state.map.currentLocationKey, regionKnowledgeByKey: structuredClone(state.map.regionKnowledgeByKey), locationKnowledgeByKey: structuredClone(state.map.locationKnowledgeByKey), unlockedFastTravelPointKeys: [...state.map.unlockedFastTravelPointKeys], openEdgeKeys: [...state.map.openEdgeKeys] },
    time: { worldMinute: state.time.worldMinute, minutesPerDay: modules['time-weather'].minutesPerDay, timePeriodKey: periodKey, weatherKey: state.time.currentWeatherByRegionKey[regionKey], deadlineWorldMinuteByKey: structuredClone(state.time.deadlineWorldMinuteByKey) },
    relations: { factionAffinityByKey: structuredClone(state.relationships.factionAffinityByKey), attitudeByActorKey, storyModifierByActorKey: structuredClone(state.relationships.storyModifierByActorKey) },
    actors: Object.fromEntries(modules.actors.actors.map(actor => [actor.key, { ...state.actors[actor.key], protected: actor.protected }])),
    world: { flags: structuredClone(state.world.flags), regionPressureByKey: structuredClone(state.world.regionPressureByKey), factionStateByKey: structuredClone(state.world.factionStateByKey), endingEligibleByKey: structuredClone(state.world.endingEligibleByKey) },
    knowledge: { visibilityByKey: structuredClone(state.knowledge.visibilityByKey), readRumorKeys: [...state.knowledge.readRumorKeys], earnedAchievementKeys: [...state.knowledge.earnedAchievementKeys] },
  }
  const evaluations = createTextOpenWorldConditionCatalogV1(projection.runtimePackage).evaluateMany(modules.actions.conditions.map(item => item.key), condition)
  const projectedActors = projectTextOpenWorldActorsV1({
    runtimePackage: projection.runtimePackage,
    state,
    attitudeByActorKey,
  })
  const actorTargets = projectedActors.map(actor => actor.key)
  const activeCombat = state.combat && 'version' in state.combat ? state.combat : null
  const action: TextOpenWorldActionProjectionContextV1 = {
    actorKey: 'player', currentLocationKey: state.map.currentLocationKey, worldMinute: state.time.worldMinute,
    playerHealth: state.player.health, combatStatus: state.combat?.status ?? null,
    combatEncounterKey: state.combat?.encounterKey ?? null,
    combatPhase: activeCombat?.phase ?? null,
    activeCombatantKey: activeCombat?.activeCombatantKey ?? null,
    learnedSkillKeys: [...state.player.learnedSkillKeys],
    skillResource: state.player.skillResource,
    combatSkillCooldownRemainingTurnsBySkillKey: activeCombat
      ? Object.fromEntries(modules.progression.skills.map(skill => [
          skill.key,
          Math.max(0, (activeCombat.cooldownUntilRoundBySkillKey?.[skill.key] ?? 0) - activeCombat.round),
        ]))
      : {},
    reachedEndingKey: state.endings.reachedKey,
    knownRecipeKeys: [...state.inventory.knownRecipeKeys],
    inventoryQuantities: structuredClone(inventoryQuantities),
    removableInventoryQuantities: structuredClone(removableInventoryQuantities),
    conditionResults: Object.fromEntries(Object.entries(evaluations).map(([key, result]) => [key, { satisfied: result.satisfied, publicReason: result.publicReason }])),
    openEdgeKeys: [...state.map.openEdgeKeys],
    unlockedFastTravelPointKeys: [...state.map.unlockedFastTravelPointKeys],
    completedOnceActionKeys: [...projection.actions.completedOnceActionKeys], cooldownUntilWorldMinuteByActionKey: structuredClone(projection.actions.cooldownUntilWorldMinuteByActionKey),
    validTargetKeysByScope: {
      actor: actorTargets, location: [...state.map.revealedLocationKeys], item: Object.keys(inventoryQuantities),
      quest: Object.values(state.quests.instancesByKey).filter(instance => !['locked', 'available'].includes(instance.status)).map(instance => instance.instanceKey),
      vendor: projectedActors.flatMap(actor => actor.availableServices.map(service => service.key)),
      encounter: modules.combat.encounters.filter(encounter => encounter.locationKey === state.map.currentLocationKey).map(encounter => encounter.key),
      combatant: state.combat && 'version' in state.combat
        ? state.combat.enemies.filter(enemy => !enemy.defeated).map(enemy => enemy.combatantKey)
        : [],
      recipe: modules.crafting.recipes.map(recipe => recipe.key),
    },
    questDefinitionKeyByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, instance.definitionKey])),
    questStatusByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, instance.status])),
    questStageKeyByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, instance.currentStageKey])),
    questObjectiveStatusByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, structuredClone(instance.objectiveStatusByKey)])),
    questRewardClaimKeyByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, instance.rewardClaimKey])),
    questDeadlineWorldMinuteByInstanceKey: Object.fromEntries(Object.values(state.quests.instancesByKey).map(instance => [instance.instanceKey, instance.deadlineWorldMinute])),
    primaryTrackedQuestInstanceKey: state.quests.tracking.primaryInstanceKey,
    pinnedQuestInstanceKeys: [...state.quests.tracking.pinnedInstanceKeys],
  }
  return { condition, action, playerStats, progression }
}

export function rebaseTextOpenWorldSessionProjectionForBranchV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldSessionProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  if (projection.protocol.pendingCommandId) fail('不能从尚未终结的命令批次创建分支')
  if (projection.state.endings.reachedKey != null) fail('不能从已抵达结局的状态创建分支')
  projection.protocol = {
    pendingCommandId: null, pendingCommandSequence: null, pendingActionKey: null, pendingActorKey: null, pendingTargetKey: null, pendingCombatTransitionIntent: null, pendingActionQuantity: null, pendingActionItemKey: null,
    pendingDirectorTrigger: null, randomEvidence: [], lastCompletedCommandId: null, lastOutcomeFingerprint: null,
  }
  projection.memory.records = projection.memory.records.map(record => ({
    ...record,
    coveredEventSequences: [],
    coveredEventHashes: [],
    committedSequence: 0,
    inherited: true,
  }))
  projection.lastEventSequence = 0
  return parseTextOpenWorldSessionProjectionV1(projection)
}
