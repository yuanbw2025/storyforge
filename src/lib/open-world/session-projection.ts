import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  ProductRuntimeEvent,
  TextOpenWorldActionProjectionContextV1,
  TextOpenWorldConditionEvaluationContextV1,
  TextOpenWorldDerivedContextsV1,
  TextOpenWorldDirectorProjectionV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
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
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  createInitialTextOpenWorldInventoryV1,
  deriveTextOpenWorldEquippedItemKeysV1,
  deriveTextOpenWorldInventoryQuantitiesV1,
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

type Row = Record<string, unknown>
const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-session] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) { const expected = [...fields].sort(); const actual = Object.keys(value).sort(); if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`) }
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}无效`); return Number(value) }
function token(value: unknown, label: string, pattern = STABLE_KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function nullableToken(value: unknown, label: string, pattern = STABLE_KEY): string | null { return value == null ? null : token(value, label, pattern) }
function uniqueTokens(value: unknown, label: string, pattern = STABLE_KEY): string[] { if (!Array.isArray(value)) fail(`${label}必须是数组`); const parsed = value.map((item, index) => token(item, `${label}[${index}]`, pattern)); if (new Set(parsed).size !== parsed.length) fail(`${label}不能重复`); return parsed }
function json(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) } }

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
      regionStateByKey: Object.fromEntries(modules.world.regions.map(region => [region.key, 'stable'])),
      regionPressureByKey: Object.fromEntries(modules.world.regions.map(region => [region.key, 0])),
      factionStateByKey: Object.fromEntries(modules.actors.factions.map(faction => [faction.key, 'neutral'])),
      endingEligibleByKey: Object.fromEntries(modules.narrative.endings.map(ending => [ending.key, false])), flags: {},
    },
    knowledge: {
      visibilityByKey: Object.fromEntries(modules.knowledge.entries.map(entry => [entry.key, entry.initialPlayerVisibility])),
      readRumorKeys: [], earnedAchievementKeys: [],
    },
    endings: { unlockedKeys: [], reachedKey: null }, appliedClaimKeys: [],
  }
}

function emptyDirector(): TextOpenWorldDirectorProjectionV1 {
  return { drawCount: 0, generatedQuestInstanceCount: 0, revealedQuestInstanceKeys: [], activeQuestInstanceKeys: [], recentFingerprints: [], lastDrawWorldMinuteByRegionKey: {}, highIntensityStreak: 0 }
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
    actions: { completedOnceActionKeys: [], cooldownUntilWorldMinuteByActionKey: {} }, director: emptyDirector(),
    protocol: { pendingCommandId: null, pendingCommandSequence: null, pendingActionKey: null, pendingActorKey: null, pendingTargetKey: null, randomEvidence: [], lastCompletedCommandId: null, lastOutcomeFingerprint: null },
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
  return candidates
}

export function parseTextOpenWorldSessionProjectionV1(value: unknown): TextOpenWorldSessionProjectionV1 {
  const parsed = row(value, 'projection'); exact(parsed, ['schema', 'version', 'runtimePackage', 'ruleset', 'state', 'actions', 'director', 'protocol', 'lastEventSequence'], 'projection')
  if (parsed.schema !== 'storyforge.text-open-world.session-projection' || parsed.version !== 1) fail('projection schema/version无效')
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(parsed.runtimePackage); const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const lastEventSequence = integer(parsed.lastEventSequence, 'lastEventSequence')
  const ruleset = row(parsed.ruleset, 'ruleset'); exact(ruleset, ['key', 'version'], 'ruleset')
  if (ruleset.key !== runtimePackage.metadata.rulesetKey || ruleset.version !== runtimePackage.metadata.rulesetVersion) fail('ruleset与RuntimePackage不一致')
  const state = structuredClone(parsed.state) as unknown as TextOpenWorldEffectStateV1
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
  validateTextOpenWorldEffectStateV1(state, modules)
  if (Object.values(state.quests.instancesByKey).some(instance => instance.sourceContentHash !== runtimePackage.modules.quests.contentHash)) fail('任务实例来源Hash与冻结Quest模块不一致')
  const actions = row(parsed.actions, 'actions'); exact(actions, ['completedOnceActionKeys', 'cooldownUntilWorldMinuteByActionKey'], 'actions')
  const completedOnceActionKeys = uniqueTokens(actions.completedOnceActionKeys, 'actions.completedOnceActionKeys'); const actionKeys = new Set(modules.actions.actions.map(action => action.key)); completedOnceActionKeys.forEach(key => { if (!actionKeys.has(key)) fail(`未知once Action:${key}`) })
  const cooldowns = row(actions.cooldownUntilWorldMinuteByActionKey, 'actions.cooldownUntilWorldMinuteByActionKey'); const cooldownUntilWorldMinuteByActionKey: Record<string, number> = {}; for (const [key, value] of Object.entries(cooldowns)) { if (!actionKeys.has(token(key, 'cooldown actionKey'))) fail(`未知cooldown Action:${key}`); cooldownUntilWorldMinuteByActionKey[key] = integer(value, `cooldown.${key}`) }
  const director = row(parsed.director, 'director'); exact(director, ['drawCount', 'generatedQuestInstanceCount', 'revealedQuestInstanceKeys', 'activeQuestInstanceKeys', 'recentFingerprints', 'lastDrawWorldMinuteByRegionKey', 'highIntensityStreak'], 'director')
  const recent = Array.isArray(director.recentFingerprints) ? director.recentFingerprints.map((value, index) => { const item = row(value, `director.recentFingerprints[${index}]`); exact(item, ['fingerprint', 'worldMinute'], `director.recentFingerprints[${index}]`); return { fingerprint: token(item.fingerprint, `director.recentFingerprints[${index}].fingerprint`), worldMinute: integer(item.worldMinute, `director.recentFingerprints[${index}].worldMinute`) } }) : fail('director.recentFingerprints必须是数组')
  const lastDraws = row(director.lastDrawWorldMinuteByRegionKey, 'director.lastDrawWorldMinuteByRegionKey'); const lastDrawWorldMinuteByRegionKey: Record<string, number> = {}; for (const [key, minute] of Object.entries(lastDraws)) { if (!modules.world.regions.some(region => region.key === key)) fail(`未知director地区:${key}`); lastDrawWorldMinuteByRegionKey[key] = integer(minute, `director.lastDraw.${key}`) }
  const protocol = row(parsed.protocol, 'protocol')
  const legacyProtocol = !Object.prototype.hasOwnProperty.call(protocol, 'pendingTargetKey')
  exact(protocol, legacyProtocol
    ? ['pendingCommandId', 'pendingCommandSequence', 'pendingActionKey', 'pendingActorKey', 'randomEvidence', 'lastCompletedCommandId', 'lastOutcomeFingerprint']
    : ['pendingCommandId', 'pendingCommandSequence', 'pendingActionKey', 'pendingActorKey', 'pendingTargetKey', 'randomEvidence', 'lastCompletedCommandId', 'lastOutcomeFingerprint'], 'protocol')
  const pendingCommandId = nullableToken(protocol.pendingCommandId, 'protocol.pendingCommandId', COMMAND_ID); const pendingCommandSequence = protocol.pendingCommandSequence == null ? null : integer(protocol.pendingCommandSequence, 'protocol.pendingCommandSequence', 1); const pendingActionKey = nullableToken(protocol.pendingActionKey, 'protocol.pendingActionKey'); const pendingActorKey = nullableToken(protocol.pendingActorKey, 'protocol.pendingActorKey'); const pendingTargetKey = legacyProtocol ? null : nullableToken(protocol.pendingTargetKey, 'protocol.pendingTargetKey')
  if ((pendingCommandId == null) !== (pendingCommandSequence == null) || (pendingCommandId == null) !== (pendingActionKey == null) || (pendingCommandId == null) !== (pendingActorKey == null)) fail('pending command字段必须同时存在或为空')
  if (pendingActionKey && !actionKeys.has(pendingActionKey)) fail('pendingActionKey不存在')
  const randomEvidence = Array.isArray(protocol.randomEvidence) ? protocol.randomEvidence.map((value, index) => { const item = row(value, `protocol.randomEvidence[${index}]`); exact(item, ['eventSequence', 'evidence'], `protocol.randomEvidence[${index}]`); return { eventSequence: integer(item.eventSequence, `protocol.randomEvidence[${index}].eventSequence`, 1), evidence: parseTextOpenWorldRandomEvidenceV1(item.evidence) } }) : fail('protocol.randomEvidence必须是数组')
  if (new Set(randomEvidence.map(item => item.eventSequence)).size !== randomEvidence.length || randomEvidence.some((item, index) => item.eventSequence > lastEventSequence || (index > 0 && randomEvidence[index - 1].eventSequence >= item.eventSequence))) fail('protocol.randomEvidence序号无效')
  if (pendingCommandSequence != null && pendingCommandSequence > lastEventSequence) fail('pendingCommandSequence超过投影序号')
  const revealedQuestInstanceKeys = uniqueTokens(director.revealedQuestInstanceKeys, 'director.revealedQuestInstanceKeys'); const activeQuestInstanceKeys = uniqueTokens(director.activeQuestInstanceKeys, 'director.activeQuestInstanceKeys')
  const generatedQuestInstanceCount = integer(director.generatedQuestInstanceCount, 'director.generatedQuestInstanceCount'); const highIntensityStreak = integer(director.highIntensityStreak, 'director.highIntensityStreak')
  if (generatedQuestInstanceCount > modules.director.rules.maximumQuestInstances || revealedQuestInstanceKeys.length > modules.director.rules.globalMaximumRevealed || activeQuestInstanceKeys.length > modules.director.rules.globalMaximumActive || highIntensityStreak > modules.director.rules.highIntensityStreakLimit) fail('director投影超过Release预算')
  const instanceKeys = new Set(Object.keys(state.quests.instancesByKey)); const directorInstanceKeys = new Set(Object.values(state.quests.instancesByKey).filter(instance => instance.sourceKind === 'director').map(instance => instance.instanceKey))
  if (directorInstanceKeys.size !== generatedQuestInstanceCount) fail('director实例数量与任务实例账本不一致')
  for (const instanceKey of [...revealedQuestInstanceKeys, ...activeQuestInstanceKeys]) if (!instanceKeys.has(instanceKey) || !directorInstanceKeys.has(instanceKey)) fail(`director引用未知生成任务实例:${instanceKey}`)
  if (activeQuestInstanceKeys.some(instanceKey => state.quests.instancesByKey[instanceKey].status !== 'active')) fail('director active任务实例状态不一致')
  if (revealedQuestInstanceKeys.some(instanceKey => state.quests.instancesByKey[instanceKey].status === 'locked')) fail('director revealed任务实例不能处于locked')
  return {
    schema: 'storyforge.text-open-world.session-projection', version: 1, runtimePackage, ruleset: { key: token(ruleset.key, 'ruleset.key'), version: integer(ruleset.version, 'ruleset.version', 1) }, state,
    actions: { completedOnceActionKeys, cooldownUntilWorldMinuteByActionKey },
    director: { drawCount: integer(director.drawCount, 'director.drawCount'), generatedQuestInstanceCount, revealedQuestInstanceKeys, activeQuestInstanceKeys, recentFingerprints: recent, lastDrawWorldMinuteByRegionKey, highIntensityStreak },
    protocol: { pendingCommandId, pendingCommandSequence, pendingActionKey, pendingActorKey, pendingTargetKey, randomEvidence, lastCompletedCommandId: nullableToken(protocol.lastCompletedCommandId, 'protocol.lastCompletedCommandId', COMMAND_ID), lastOutcomeFingerprint: nullableToken(protocol.lastOutcomeFingerprint, 'protocol.lastOutcomeFingerprint', /^[a-f0-9]{64}$/) },
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
    } else {
      const action = modules.actions.actions.find(item => item.key === projection.protocol.pendingActionKey) ?? fail('命令Action不存在')
      const outcomeEffectKeys = applied.outcome === 'failure' ? action.failureEffectKeys : action.successEffectKeys
      const expectedEffectKeys = [...new Set([...action.costEffectKeys, ...outcomeEffectKeys])]
      if (canonicalProductProductionJsonV2(applied.plan.effectKeys) !== canonicalProductProductionJsonV2(expectedEffectKeys)) fail('EffectPlan与命令Action不一致')
      if (applied.plan.effectKeys.some(effectKey => dropEffectKeys.has(effectKey))) fail('掉落Effect缺少RewardContract授权')
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
    projection.protocol.pendingCommandId = null; projection.protocol.pendingCommandSequence = null; projection.protocol.pendingActionKey = null; projection.protocol.pendingActorKey = null; projection.protocol.pendingTargetKey = null
  } else fail(`事件类型不属于vNext Session投影:${event.type}`)
  projection.lastEventSequence = event.sequence
  return parseTextOpenWorldSessionProjectionV1(projection)
}

export function deriveTextOpenWorldContextsV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldDerivedContextsV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value); const modules = parseTextOpenWorldModulesV1(projection.runtimePackage); const state = projection.state
  const clockWeather = projectTextOpenWorldClockWeatherV1({ runtimePackage: projection.runtimePackage, state, parsedModules: modules })
  const regionKey = clockWeather.regionKey; const periodKey = clockWeather.timePeriodKey
  const attitudeByActorKey = Object.fromEntries(modules.actors.actors.map(actor => {
    const affinity = actor.factionKey ? state.relationships.factionAffinityByKey[actor.factionKey] ?? modules.relationships.factionAffinity.initial : 0
    const score = state.relationships.morality * modules.relationships.attitude.moralityWeight + affinity * modules.relationships.attitude.factionWeight + (state.relationships.storyModifierByActorKey[actor.key] ?? 0)
    return [actor.key, score <= modules.relationships.attitude.badMaximum ? 'bad' : score >= modules.relationships.attitude.goodMinimum ? 'good' : 'neutral']
  })) as Record<string, 'bad' | 'neutral' | 'good'>
  const playerStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes,
    equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory),
  })
  const progression = deriveTextOpenWorldProgressionStatusV1(modules, state.player.experience)
  const inventoryQuantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, state.inventory)
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
  const action: TextOpenWorldActionProjectionContextV1 = {
    actorKey: 'player', currentLocationKey: state.map.currentLocationKey, worldMinute: state.time.worldMinute,
    playerHealth: state.player.health, combatStatus: state.combat?.status ?? null,
    conditionResults: Object.fromEntries(Object.entries(evaluations).map(([key, result]) => [key, { satisfied: result.satisfied, publicReason: result.publicReason }])),
    openEdgeKeys: [...state.map.openEdgeKeys],
    unlockedFastTravelPointKeys: [...state.map.unlockedFastTravelPointKeys],
    completedOnceActionKeys: [...projection.actions.completedOnceActionKeys], cooldownUntilWorldMinuteByActionKey: structuredClone(projection.actions.cooldownUntilWorldMinuteByActionKey),
    validTargetKeysByScope: {
      actor: actorTargets, location: [...state.map.revealedLocationKeys], item: Object.keys(inventoryQuantities),
      quest: Object.values(state.quests.instancesByKey).filter(instance => !['locked', 'available'].includes(instance.status)).map(instance => instance.instanceKey),
      vendor: projectedActors.flatMap(actor => actor.availableServices.map(service => service.key)),
      encounter: modules.combat.encounters.filter(encounter => encounter.locationKey === state.map.currentLocationKey).map(encounter => encounter.key),
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
  projection.protocol = {
    pendingCommandId: null, pendingCommandSequence: null, pendingActionKey: null, pendingActorKey: null, pendingTargetKey: null,
    randomEvidence: [], lastCompletedCommandId: null, lastOutcomeFingerprint: null,
  }
  projection.lastEventSequence = 0
  return parseTextOpenWorldSessionProjectionV1(projection)
}
