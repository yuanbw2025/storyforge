import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import type {
  ProductRuntimeEvent,
  TextOpenWorldEffectChangeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectImpactDomainV1,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectReceiptV1,
  TextOpenWorldCommandOutcomeV1,
  TextOpenWorldDegradationV1,
  TextOpenWorldOutcomeReasonV1,
  TextOpenWorldEffectsAppliedEventPayloadV1,
  TextOpenWorldEventBatchProjectionV1,
  TextOpenWorldEventProtocolProjectionV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRandomResolvedEventPayloadV1,
  TextOpenWorldObjectiveAuthorizationV1,
  TextOpenWorldQuestTransitionAuthorizationV1,
  TextOpenWorldQuestTrackingAuthorizationV1,
  TextOpenWorldRulesetStampV1,
  TextOpenWorldRewardAuthorizationV1,
  TextOpenWorldFastTravelAuthorizationV1,
  TextOpenWorldWeatherSettlementAuthorizationV1,
  TextOpenWorldActorScheduleSettlementAuthorizationV1,
  TextOpenWorldCombatTransitionAuthorizationV1,
  TextOpenWorldCombatActionAuthorizationV1,
  TextOpenWorldCombatStatusInstanceV2,
  TextOpenWorldCombatRecoveryResolutionV2,
  TextOpenWorldCombatResourceResolutionV2,
  TextOpenWorldCombatStatusResolutionV2,
  TextOpenWorldCraftingAuthorizationV1,
  TextOpenWorldTransactionAuthorizationV1,
  TextOpenWorldCrimeAuthorizationV1,
  TextOpenWorldDirectorSettlementAuthorizationV1,
} from '../types'
import {
  createTextOpenWorldMemoryAdoptionHashV1,
  createTextOpenWorldMemoryEvidenceEventHashV1,
  parseTextOpenWorldMemoryCommittedEventPayloadV1,
} from './runtime-memory-contract'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'

type Row = Record<string, unknown>

const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const IMPACT_DOMAINS: TextOpenWorldEffectImpactDomainV1[] = ['player', 'inventory', 'quests', 'map', 'time', 'relationships', 'combat', 'actors', 'world', 'knowledge', 'endings', 'economy', 'director']

function fail(message: string): never { throw new Error(`[text-open-world-event] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) {
  const expected = [...fields].sort(); const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`)
}
function token(value: unknown, label: string, pattern = STABLE_KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}必须是安全整数`); return Number(value) }
function hash(value: unknown, label: string): string { if (!isSha256Hash(value)) fail(`${label}不是SHA-256`); return value }
function text(value: unknown, label: string, maximum = 2_000): string { if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label}无效`); return value.trim() }
function uniqueStrings(value: unknown, label: string, allowed?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const values = value.map((item, index) => token(item, `${label}[${index}]`))
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  if (allowed) values.forEach(item => { if (!allowed.has(item)) fail(`${label}值无效:${item}`) })
  return values
}

function parseCombatStatusInstanceV2(value: unknown, label: string): TextOpenWorldCombatStatusInstanceV2 {
  const parsed = row(value, label)
  exact(parsed, ['statusKey', 'sourceCombatantKey', 'sourceSkillKey', 'stacks', 'appliedAtActorTurnOrdinal', 'expiresAfterTargetTurnOrdinal'], label)
  return {
    statusKey: token(parsed.statusKey, `${label}.statusKey`),
    sourceCombatantKey: token(parsed.sourceCombatantKey, `${label}.sourceCombatantKey`),
    sourceSkillKey: token(parsed.sourceSkillKey, `${label}.sourceSkillKey`),
    stacks: integer(parsed.stacks, `${label}.stacks`, 1, 100),
    appliedAtActorTurnOrdinal: integer(parsed.appliedAtActorTurnOrdinal, `${label}.appliedAtActorTurnOrdinal`),
    expiresAfterTargetTurnOrdinal: parsed.expiresAfterTargetTurnOrdinal == null
      ? null
      : integer(parsed.expiresAfterTargetTurnOrdinal, `${label}.expiresAfterTargetTurnOrdinal`, 1),
  }
}

function parseCombatStatusMapV2(value: unknown, label: string): Record<string, TextOpenWorldCombatStatusInstanceV2[]> {
  const parsed = row(value, label)
  if (!Object.keys(parsed).length || Object.keys(parsed).length > 64) fail(`${label}战斗员数量无效`)
  return Object.fromEntries(Object.entries(parsed).map(([combatantKey, instances]) => {
    token(combatantKey, `${label}.combatantKey`)
    if (!Array.isArray(instances) || instances.length > 64) fail(`${label}.${combatantKey}无效`)
    const result = instances.map((instance, index) => parseCombatStatusInstanceV2(instance, `${label}.${combatantKey}[${index}]`))
    if (new Set(result.map(instance => instance.statusKey)).size !== result.length) fail(`${label}.${combatantKey}状态不能重复`)
    return [combatantKey, result]
  }))
}

function parseCombatOrdinalMapV2(value: unknown, label: string): Record<string, number> {
  const parsed = row(value, label)
  if (!Object.keys(parsed).length || Object.keys(parsed).length > 64) fail(`${label}战斗员数量无效`)
  return Object.fromEntries(Object.entries(parsed).map(([combatantKey, ordinal]) => [
    token(combatantKey, `${label}.combatantKey`),
    integer(ordinal, `${label}.${combatantKey}`),
  ]))
}
function uniqueIntegers(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const values = value.map((item, index) => integer(item, `${label}[${index}]`, 1))
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  return values
}

function parseRuleset(value: unknown, label: string): TextOpenWorldRulesetStampV1 {
  const parsed = row(value, label); exact(parsed, ['key', 'version'], label)
  return { key: token(parsed.key, `${label}.key`), version: integer(parsed.version, `${label}.version`, 1, 1_000_000) }
}

export function parseTextOpenWorldRandomRequestV1(value: unknown, label = 'randomRequest'): TextOpenWorldRandomRequestV1 {
  const parsed = row(value, label); exact(parsed, ['drawKey', 'minimumInclusive', 'maximumInclusive'], label)
  const minimumInclusive = integer(parsed.minimumInclusive, `${label}.minimumInclusive`, -1_000_000_000, 1_000_000_000)
  const maximumInclusive = integer(parsed.maximumInclusive, `${label}.maximumInclusive`, -1_000_000_000, 1_000_000_000)
  if (maximumInclusive < minimumInclusive) fail(`${label}范围倒置`)
  return { drawKey: token(parsed.drawKey, `${label}.drawKey`), minimumInclusive, maximumInclusive }
}

export function parseTextOpenWorldRandomEvidenceV1(value: unknown, label = 'randomEvidence'): TextOpenWorldRandomEvidenceV1 {
  const parsed = row(value, label); exact(parsed, ['drawKey', 'minimumInclusive', 'maximumInclusive', 'algorithm', 'seedHash', 'inputHash', 'drawIndex', 'value'], label)
  if (parsed.algorithm !== 'sha256-range-v1') fail(`${label}.algorithm无效`)
  const request = parseTextOpenWorldRandomRequestV1({ drawKey: parsed.drawKey, minimumInclusive: parsed.minimumInclusive, maximumInclusive: parsed.maximumInclusive }, label)
  const result = {
    ...request, algorithm: 'sha256-range-v1' as const,
    seedHash: hash(parsed.seedHash, `${label}.seedHash`), inputHash: hash(parsed.inputHash, `${label}.inputHash`),
    drawIndex: integer(parsed.drawIndex, `${label}.drawIndex`, 0, 1_000_000),
    value: integer(parsed.value, `${label}.value`, request.minimumInclusive, request.maximumInclusive),
  }
  return result
}

function requestFromEvidence(evidence: TextOpenWorldRandomEvidenceV1): TextOpenWorldRandomRequestV1 {
  return { drawKey: evidence.drawKey, minimumInclusive: evidence.minimumInclusive, maximumInclusive: evidence.maximumInclusive }
}

function parseChange(value: unknown, label: string): TextOpenWorldEffectChangeV1 {
  const parsed = row(value, label); exact(parsed, ['effectKey', 'domain', 'operation', 'summary', 'before', 'after'], label)
  canonicalProductProductionJsonV2(parsed.before); canonicalProductProductionJsonV2(parsed.after)
  const domain = token(parsed.domain, `${label}.domain`) as TextOpenWorldEffectImpactDomainV1
  if (!IMPACT_DOMAINS.includes(domain)) fail(`${label}.domain无效`)
  return {
    effectKey: token(parsed.effectKey, `${label}.effectKey`), domain,
    operation: token(parsed.operation, `${label}.operation`) as TextOpenWorldEffectChangeV1['operation'],
    summary: text(parsed.summary, `${label}.summary`), before: structuredClone(parsed.before), after: structuredClone(parsed.after),
  }
}

function parseRewardAuthorization(value: unknown, label: string): TextOpenWorldRewardAuthorizationV1 | null {
  if (value == null) return null
  const parsed = row(value, label); exact(parsed, ['kind', 'rewardKey', 'sourceInstanceKey', 'randomRequests', 'drops'], label)
  if (parsed.kind !== 'reward') fail(`${label}.kind无效`)
  if (!Array.isArray(parsed.randomRequests) || parsed.randomRequests.length > 128) fail(`${label}.randomRequests无效`)
  if (!Array.isArray(parsed.drops) || parsed.drops.length > 128) fail(`${label}.drops无效`)
  return {
    kind: 'reward', rewardKey: token(parsed.rewardKey, `${label}.rewardKey`), sourceInstanceKey: token(parsed.sourceInstanceKey, `${label}.sourceInstanceKey`),
    randomRequests: parsed.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `${label}.randomRequests[${index}]`)),
    drops: parsed.drops.map((drop, index) => {
      const item = row(drop, `${label}.drops[${index}]`); exact(item, ['dropTableKey', 'itemKey', 'quantity', 'effectKey'], `${label}.drops[${index}]`)
      return {
        dropTableKey: token(item.dropTableKey, `${label}.drops[${index}].dropTableKey`),
        itemKey: token(item.itemKey, `${label}.drops[${index}].itemKey`),
        quantity: integer(item.quantity, `${label}.drops[${index}].quantity`, 1, 1_000_000),
        effectKey: token(item.effectKey, `${label}.drops[${index}].effectKey`),
      }
    }),
  }
}

function parseAuthorization(value: unknown, label: string): TextOpenWorldEffectPlanV1['authorization'] {
  if (value == null) return null
  const raw = row(value, label)
  if (raw.kind === 'reward') return parseRewardAuthorization(value, label)
  if (raw.kind === 'director-settlement') {
    exact(raw, ['kind', 'trigger', 'regionKey', 'worldMinute', 'randomRequests', 'regionChanges', 'selection', 'earnedAchievementKeys'], label)
    if (!Array.isArray(raw.randomRequests) || raw.randomRequests.length > 2) fail(`${label}.randomRequests无效`)
    const randomRequests = raw.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `${label}.randomRequests[${index}]`))
    if (!Array.isArray(raw.regionChanges) || raw.regionChanges.length > 10_000) fail(`${label}.regionChanges无效`)
    const regionChanges = raw.regionChanges.map((change, index) => {
      const item = row(change, `${label}.regionChanges[${index}]`)
      exact(item, ['regionKey', 'settledIntervals', 'fromSettlementWorldMinute', 'toSettlementWorldMinute', 'fromPressure', 'toPressure', 'fromState', 'toState'], `${label}.regionChanges[${index}]`)
      const fromSettlementWorldMinute = integer(item.fromSettlementWorldMinute, `${label}.regionChanges[${index}].fromSettlementWorldMinute`)
      const toSettlementWorldMinute = integer(item.toSettlementWorldMinute, `${label}.regionChanges[${index}].toSettlementWorldMinute`)
      if (toSettlementWorldMinute <= fromSettlementWorldMinute) fail(`${label}.regionChanges[${index}]结算时间无效`)
      return {
        regionKey: token(item.regionKey, `${label}.regionChanges[${index}].regionKey`),
        settledIntervals: integer(item.settledIntervals, `${label}.regionChanges[${index}].settledIntervals`, 1),
        fromSettlementWorldMinute,
        toSettlementWorldMinute,
        fromPressure: integer(item.fromPressure, `${label}.regionChanges[${index}].fromPressure`, -1_000_000, 1_000_000),
        toPressure: integer(item.toPressure, `${label}.regionChanges[${index}].toPressure`, -1_000_000, 1_000_000),
        fromState: token(item.fromState, `${label}.regionChanges[${index}].fromState`),
        toState: token(item.toState, `${label}.regionChanges[${index}].toState`),
      }
    })
    if (new Set(regionChanges.map(change => change.regionKey)).size !== regionChanges.length) fail(`${label}.regionChanges地区不能重复`)
    const selection = row(raw.selection, `${label}.selection`)
    exact(selection, ['outcomeKind', 'sourceKey', 'definitionKey', 'sourceInstanceKey', 'questInstanceKey', 'variantTextKey', 'fingerprint', 'intensity', 'effectKeys', 'rumorKey', 'reason'], `${label}.selection`)
    const outcomeKind = ['blank', 'fixed-quest', 'template-quest', 'random-event'].includes(String(selection.outcomeKind))
      ? selection.outcomeKind as TextOpenWorldDirectorSettlementAuthorizationV1['selection']['outcomeKind']
      : fail(`${label}.selection.outcomeKind无效`)
    const nullable = (rawValue: unknown, childLabel: string, pattern = STABLE_KEY) => rawValue == null ? null : token(rawValue, childLabel, pattern)
    const parsedSelection = {
      outcomeKind,
      sourceKey: nullable(selection.sourceKey, `${label}.selection.sourceKey`),
      definitionKey: nullable(selection.definitionKey, `${label}.selection.definitionKey`),
      sourceInstanceKey: nullable(selection.sourceInstanceKey, `${label}.selection.sourceInstanceKey`, COMMAND_ID),
      questInstanceKey: nullable(selection.questInstanceKey, `${label}.selection.questInstanceKey`),
      variantTextKey: nullable(selection.variantTextKey, `${label}.selection.variantTextKey`),
      fingerprint: nullable(selection.fingerprint, `${label}.selection.fingerprint`),
      intensity: integer(selection.intensity, `${label}.selection.intensity`, 0, 10),
      effectKeys: uniqueStrings(selection.effectKeys, `${label}.selection.effectKeys`),
      rumorKey: nullable(selection.rumorKey, `${label}.selection.rumorKey`),
      reason: text(selection.reason, `${label}.selection.reason`),
    }
    if ((outcomeKind === 'blank') !== (parsedSelection.sourceKey == null)
      || outcomeKind === 'blank' && (parsedSelection.definitionKey != null || parsedSelection.questInstanceKey != null || parsedSelection.effectKeys.length > 0 || parsedSelection.rumorKey != null || parsedSelection.intensity !== 0)) fail(`${label}.selection空结果字段不自洽`)
    return {
      kind: 'director-settlement',
      trigger: ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'].includes(String(raw.trigger))
        ? raw.trigger as TextOpenWorldDirectorSettlementAuthorizationV1['trigger']
        : fail(`${label}.trigger无效`),
      regionKey: token(raw.regionKey, `${label}.regionKey`),
      worldMinute: integer(raw.worldMinute, `${label}.worldMinute`),
      randomRequests,
      regionChanges,
      selection: parsedSelection,
      earnedAchievementKeys: uniqueStrings(raw.earnedAchievementKeys, `${label}.earnedAchievementKeys`),
    } satisfies TextOpenWorldDirectorSettlementAuthorizationV1
  }
  if (raw.kind === 'fast-travel') {
    exact(raw, ['kind', 'fastTravelPointKey', 'originLocationKey', 'destinationLocationKey', 'routeEdgeKeys', 'openEdgeKeys', 'baseWorldMinute', 'travelMinutes'], label)
    return {
      kind: 'fast-travel',
      fastTravelPointKey: token(raw.fastTravelPointKey, `${label}.fastTravelPointKey`),
      originLocationKey: token(raw.originLocationKey, `${label}.originLocationKey`),
      destinationLocationKey: token(raw.destinationLocationKey, `${label}.destinationLocationKey`),
      routeEdgeKeys: uniqueStrings(raw.routeEdgeKeys, `${label}.routeEdgeKeys`),
      openEdgeKeys: uniqueStrings(raw.openEdgeKeys, `${label}.openEdgeKeys`),
      baseWorldMinute: integer(raw.baseWorldMinute, `${label}.baseWorldMinute`),
      travelMinutes: integer(raw.travelMinutes, `${label}.travelMinutes`, 1),
    } satisfies TextOpenWorldFastTravelAuthorizationV1
  }
  if (raw.kind === 'weather-settlement') {
    exact(raw, ['kind', 'worldMinute', 'weatherEpoch', 'randomRequests', 'changes'], label)
    if (!Array.isArray(raw.randomRequests) || raw.randomRequests.length < 1 || raw.randomRequests.length > 128) fail(`${label}.randomRequests无效`)
    if (!Array.isArray(raw.changes) || raw.changes.length !== raw.randomRequests.length) fail(`${label}.changes无效`)
    const randomRequests = raw.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `${label}.randomRequests[${index}]`))
    const changes = raw.changes.map((change, index) => {
      const parsed = row(change, `${label}.changes[${index}]`)
      exact(parsed, ['regionKey', 'fromWeatherKey', 'toWeatherKey', 'drawKey', 'drawValue'], `${label}.changes[${index}]`)
      const request = randomRequests[index]
      const drawKey = token(parsed.drawKey, `${label}.changes[${index}].drawKey`)
      if (drawKey !== request.drawKey) fail(`${label}.changes[${index}].drawKey与随机请求不一致`)
      return {
        regionKey: token(parsed.regionKey, `${label}.changes[${index}].regionKey`),
        fromWeatherKey: token(parsed.fromWeatherKey, `${label}.changes[${index}].fromWeatherKey`),
        toWeatherKey: token(parsed.toWeatherKey, `${label}.changes[${index}].toWeatherKey`),
        drawKey,
        drawValue: integer(parsed.drawValue, `${label}.changes[${index}].drawValue`, request.minimumInclusive, request.maximumInclusive),
      }
    })
    if (new Set(changes.map(change => change.regionKey)).size !== changes.length) fail(`${label}.changes地区不能重复`)
    return {
      kind: 'weather-settlement',
      worldMinute: integer(raw.worldMinute, `${label}.worldMinute`),
      weatherEpoch: integer(raw.weatherEpoch, `${label}.weatherEpoch`),
      randomRequests,
      changes,
    } satisfies TextOpenWorldWeatherSettlementAuthorizationV1
  }
  if (raw.kind === 'actor-schedule-settlement') {
    exact(raw, ['kind', 'worldMinute', 'fromSettlementWorldMinute', 'toSettlementWorldMinute', 'timePeriodKey', 'changes'], label)
    if (!Array.isArray(raw.changes) || raw.changes.length > 20_000) fail(`${label}.changes无效`)
    const worldMinute = integer(raw.worldMinute, `${label}.worldMinute`)
    const fromSettlementWorldMinute = integer(raw.fromSettlementWorldMinute, `${label}.fromSettlementWorldMinute`)
    const toSettlementWorldMinute = integer(raw.toSettlementWorldMinute, `${label}.toSettlementWorldMinute`)
    if (fromSettlementWorldMinute >= toSettlementWorldMinute || toSettlementWorldMinute > worldMinute) fail(`${label}.结算时间范围无效`)
    const changes = raw.changes.map((change, index) => {
      const parsed = row(change, `${label}.changes[${index}]`)
      exact(parsed, ['actorKey', 'fromLocationKey', 'toLocationKey', 'fromScheduleState', 'toScheduleState'], `${label}.changes[${index}]`)
      return {
        actorKey: token(parsed.actorKey, `${label}.changes[${index}].actorKey`),
        fromLocationKey: token(parsed.fromLocationKey, `${label}.changes[${index}].fromLocationKey`),
        toLocationKey: token(parsed.toLocationKey, `${label}.changes[${index}].toLocationKey`),
        fromScheduleState: text(parsed.fromScheduleState, `${label}.changes[${index}].fromScheduleState`),
        toScheduleState: text(parsed.toScheduleState, `${label}.changes[${index}].toScheduleState`),
      }
    })
    if (new Set(changes.map(change => change.actorKey)).size !== changes.length) fail(`${label}.changes角色不能重复`)
    return {
      kind: 'actor-schedule-settlement', worldMinute, fromSettlementWorldMinute, toSettlementWorldMinute,
      timePeriodKey: token(raw.timePeriodKey, `${label}.timePeriodKey`), changes,
    } satisfies TextOpenWorldActorScheduleSettlementAuthorizationV1
  }
  if (raw.kind === 'crime') {
    exact(raw, ['kind', 'crimeKey', 'actionKey', 'crimeKind', 'targetActorKey', 'locationKey', 'worldMinute', 'outcome', 'successConditionResults', 'witnessActorKeys', 'effectKeys'], label)
    const crimeKind = raw.crimeKind === 'steal' || raw.crimeKind === 'deceive' || raw.crimeKind === 'crime'
      ? raw.crimeKind
      : fail(`${label}.crimeKind无效`)
    const outcome = raw.outcome === 'success' || raw.outcome === 'failure' ? raw.outcome : fail(`${label}.outcome无效`)
    if (!Array.isArray(raw.successConditionResults) || raw.successConditionResults.length > 64) fail(`${label}.successConditionResults无效`)
    const successConditionResults = raw.successConditionResults.map((item, index) => {
      const parsed = row(item, `${label}.successConditionResults[${index}]`)
      exact(parsed, ['conditionKey', 'satisfied'], `${label}.successConditionResults[${index}]`)
      if (typeof parsed.satisfied !== 'boolean') fail(`${label}.successConditionResults[${index}].satisfied无效`)
      return { conditionKey: token(parsed.conditionKey, `${label}.successConditionResults[${index}].conditionKey`), satisfied: parsed.satisfied }
    })
    if (new Set(successConditionResults.map(item => item.conditionKey)).size !== successConditionResults.length) fail(`${label}.successConditionResults不能重复`)
    return {
      kind: 'crime', crimeKey: token(raw.crimeKey, `${label}.crimeKey`), actionKey: token(raw.actionKey, `${label}.actionKey`),
      crimeKind, targetActorKey: token(raw.targetActorKey, `${label}.targetActorKey`), locationKey: token(raw.locationKey, `${label}.locationKey`),
      worldMinute: integer(raw.worldMinute, `${label}.worldMinute`), outcome, successConditionResults,
      witnessActorKeys: uniqueStrings(raw.witnessActorKeys, `${label}.witnessActorKeys`),
      effectKeys: uniqueStrings(raw.effectKeys, `${label}.effectKeys`),
    } satisfies TextOpenWorldCrimeAuthorizationV1
  }
  if (raw.kind === 'combat-transition') {
    const includesStatusSettlement = raw.removedPlayerStatusKeys !== undefined
    const includesStructuredRuntime = raw.combatRuntimeVersion === 2
    exact(raw, [
      'kind', 'instanceKey', 'encounterKey', 'intent',
      'beforePhase', 'beforeRound', 'beforeTurnIndex', 'beforeActiveCombatantKey',
      'afterStatus', 'afterPhase', 'afterRound', 'afterTurnIndex', 'afterActiveCombatantKey',
      ...(includesStatusSettlement ? ['removedPlayerStatusKeys'] : []),
      ...(includesStructuredRuntime ? ['combatRuntimeVersion', 'afterActorTurnOrdinalByCombatantKey', 'afterStatusInstancesByCombatantKey'] : []),
    ], label)
    if (includesStatusSettlement && includesStructuredRuntime) fail(`${label}不能混合旧临时状态与Combat v4状态快照`)
    const intents = new Set(['begin-round', 'begin-turn', 'complete-turn', 'advance-turn', 'finish-victory', 'finish-defeat', 'finish-escaped'])
    const phases = new Set(['started', 'round-start', 'actor-turn', 'action-resolved', 'round-end', 'terminal'])
    const statuses = new Set(['active', 'victory', 'defeat', 'escaped'])
    const intent = token(raw.intent, `${label}.intent`) as TextOpenWorldCombatTransitionAuthorizationV1['intent']
    const beforePhase = token(raw.beforePhase, `${label}.beforePhase`) as TextOpenWorldCombatTransitionAuthorizationV1['beforePhase']
    const afterPhase = token(raw.afterPhase, `${label}.afterPhase`) as TextOpenWorldCombatTransitionAuthorizationV1['afterPhase']
    const afterStatus = token(raw.afterStatus, `${label}.afterStatus`) as TextOpenWorldCombatTransitionAuthorizationV1['afterStatus']
    if (!intents.has(intent) || !phases.has(beforePhase) || !phases.has(afterPhase) || !statuses.has(afterStatus)) fail(`${label}枚举无效`)
    return {
      kind: 'combat-transition',
      instanceKey: token(raw.instanceKey, `${label}.instanceKey`, COMMAND_ID),
      encounterKey: token(raw.encounterKey, `${label}.encounterKey`),
      intent,
      beforePhase,
      beforeRound: integer(raw.beforeRound, `${label}.beforeRound`),
      beforeTurnIndex: raw.beforeTurnIndex == null ? null : integer(raw.beforeTurnIndex, `${label}.beforeTurnIndex`),
      beforeActiveCombatantKey: raw.beforeActiveCombatantKey == null ? null : token(raw.beforeActiveCombatantKey, `${label}.beforeActiveCombatantKey`),
      afterStatus,
      afterPhase,
      afterRound: integer(raw.afterRound, `${label}.afterRound`),
      afterTurnIndex: raw.afterTurnIndex == null ? null : integer(raw.afterTurnIndex, `${label}.afterTurnIndex`),
      afterActiveCombatantKey: raw.afterActiveCombatantKey == null ? null : token(raw.afterActiveCombatantKey, `${label}.afterActiveCombatantKey`),
      ...(includesStatusSettlement ? { removedPlayerStatusKeys: uniqueStrings(raw.removedPlayerStatusKeys, `${label}.removedPlayerStatusKeys`) } : {}),
      ...(includesStructuredRuntime ? {
        combatRuntimeVersion: 2 as const,
        afterActorTurnOrdinalByCombatantKey: parseCombatOrdinalMapV2(raw.afterActorTurnOrdinalByCombatantKey, `${label}.afterActorTurnOrdinalByCombatantKey`),
        afterStatusInstancesByCombatantKey: parseCombatStatusMapV2(raw.afterStatusInstancesByCombatantKey, `${label}.afterStatusInstancesByCombatantKey`),
      } : {}),
    } satisfies TextOpenWorldCombatTransitionAuthorizationV1
  }
  if (raw.kind === 'combat-action') {
    const resolutionVersion = raw.resolutionVersion === 1 || raw.resolutionVersion === 2
      ? raw.resolutionVersion
      : null
    const includesResolution = resolutionVersion != null
    const structuredResolution = resolutionVersion === 2
    exact(raw, [
      'kind', 'instanceKey', 'encounterKey', 'actionKey', 'actorKey', 'actorCombatantKey', 'actionKind',
      'skillKey', 'itemKey', 'targetCombatantKeys', 'beforePhase', 'beforeRound', 'beforeTurnIndex',
      'beforeActiveCombatantKey', 'effectKeys', 'resourceCost', 'cooldownTurns', 'cooldownUntilRound', 'afterSkillResource',
      ...(resolutionVersion === 1 ? ['resolutionVersion', 'randomRequests', 'targetResolutions', 'statusEffectKeys'] : []),
      ...(structuredResolution ? [
        'resolutionVersion', 'randomRequests', 'targetResolutions', 'mechanicKind',
        'recoveryResolutions', 'resourceResolutions', 'statusResolutions', 'expiredStatusKeys',
        'afterStatusInstancesByCombatantKey',
      ] : []),
    ], label)
    const actorKey = raw.actorKey === 'player' || raw.actorKey === 'system' ? raw.actorKey : fail(`${label}.actorKey无效`)
    const actionKind = ['basic-attack', 'skill', 'item', 'escape', 'enemy-skill'].includes(String(raw.actionKind))
      ? raw.actionKind as TextOpenWorldCombatActionAuthorizationV1['actionKind']
      : fail(`${label}.actionKind无效`)
    if (raw.beforePhase !== 'actor-turn') fail(`${label}.beforePhase无效`)
    const randomRequests = includesResolution
      ? Array.isArray(raw.randomRequests) && raw.randomRequests.length <= 128
        ? raw.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `${label}.randomRequests[${index}]`))
        : fail(`${label}.randomRequests无效`)
      : undefined
    const targetResolutions = includesResolution
      ? Array.isArray(raw.targetResolutions) && raw.targetResolutions.length <= 8
        ? raw.targetResolutions.map((value, index) => {
            const resolution = row(value, `${label}.targetResolutions[${index}]`)
            exact(resolution, [
              'targetCombatantKey', 'attack', 'defense', 'powerNumerator', 'powerDenominator', 'flatDamage',
              'damageBeforeDefense', 'damageAfterDefense', 'criticalChanceBasisPoints', 'criticalDrawValue',
              'critical', 'computedDamage', 'appliedDamage', 'beforeHealth', 'afterHealth', 'defeated',
              ...(structuredResolution ? ['skillPower'] : []),
            ], `${label}.targetResolutions[${index}]`)
            if (typeof resolution.critical !== 'boolean' || typeof resolution.defeated !== 'boolean') fail(`${label}.targetResolutions[${index}]布尔字段无效`)
            const beforeHealth = integer(resolution.beforeHealth, `${label}.targetResolutions[${index}].beforeHealth`, 1, 1_000_000_000)
            const appliedDamage = integer(resolution.appliedDamage, `${label}.targetResolutions[${index}].appliedDamage`, 0, beforeHealth)
            const afterHealth = integer(resolution.afterHealth, `${label}.targetResolutions[${index}].afterHealth`, 0, beforeHealth)
            if (afterHealth !== beforeHealth - appliedDamage || resolution.defeated !== (afterHealth === 0)) fail(`${label}.targetResolutions[${index}]生命变化不自洽`)
            return {
              targetCombatantKey: token(resolution.targetCombatantKey, `${label}.targetResolutions[${index}].targetCombatantKey`),
              attack: integer(resolution.attack, `${label}.targetResolutions[${index}].attack`, 0, 1_000_000_000),
              defense: integer(resolution.defense, `${label}.targetResolutions[${index}].defense`, 0, 1_000_000_000),
              powerNumerator: integer(resolution.powerNumerator, `${label}.targetResolutions[${index}].powerNumerator`, 0, 100),
              powerDenominator: integer(resolution.powerDenominator, `${label}.targetResolutions[${index}].powerDenominator`, 1, 100),
              flatDamage: integer(resolution.flatDamage, `${label}.targetResolutions[${index}].flatDamage`, 0, 1_000_000_000),
              damageBeforeDefense: integer(resolution.damageBeforeDefense, `${label}.targetResolutions[${index}].damageBeforeDefense`, 0, 1_000_000_000),
              damageAfterDefense: integer(resolution.damageAfterDefense, `${label}.targetResolutions[${index}].damageAfterDefense`, 0, 1_000_000_000),
              criticalChanceBasisPoints: integer(resolution.criticalChanceBasisPoints, `${label}.targetResolutions[${index}].criticalChanceBasisPoints`, 0, 10_000),
              criticalDrawValue: integer(resolution.criticalDrawValue, `${label}.targetResolutions[${index}].criticalDrawValue`, 1, 10_000),
              critical: resolution.critical,
              computedDamage: integer(resolution.computedDamage, `${label}.targetResolutions[${index}].computedDamage`, 0, 1_000_000_000),
              appliedDamage,
              beforeHealth,
              afterHealth,
              defeated: resolution.defeated,
              ...(structuredResolution ? {
                skillPower: integer(resolution.skillPower, `${label}.targetResolutions[${index}].skillPower`, -1_000_000_000, 1_000_000_000),
              } : {}),
            }
          })
        : fail(`${label}.targetResolutions无效`)
      : undefined
    const mechanicKind = structuredResolution
      ? raw.mechanicKind == null
        ? null
        : ['attack', 'recovery', 'resource', 'status'].includes(String(raw.mechanicKind))
          ? raw.mechanicKind as TextOpenWorldCombatActionAuthorizationV1['mechanicKind']
          : fail(`${label}.mechanicKind无效`)
      : undefined
    const parseRecoveryResolutions = (): TextOpenWorldCombatRecoveryResolutionV2[] => {
      if (!Array.isArray(raw.recoveryResolutions) || raw.recoveryResolutions.length > 8) fail(`${label}.recoveryResolutions无效`)
      return raw.recoveryResolutions.map((value, index) => {
        const item = row(value, `${label}.recoveryResolutions[${index}]`)
        exact(item, ['targetCombatantKey', 'scalingAttribute', 'scalingValue', 'baseAmount', 'scalingNumerator', 'scalingDenominator', 'skillPower', 'requestedRecovery', 'appliedRecovery', 'maximumHealth', 'beforeHealth', 'afterHealth'], `${label}.recoveryResolutions[${index}]`)
        const scalingAttribute = ['power', 'vitality', 'agility'].includes(String(item.scalingAttribute))
          ? item.scalingAttribute as TextOpenWorldCombatRecoveryResolutionV2['scalingAttribute']
          : fail(`${label}.recoveryResolutions[${index}].scalingAttribute无效`)
        const scalingValue = integer(item.scalingValue, `${label}.recoveryResolutions[${index}].scalingValue`)
        const baseAmount = integer(item.baseAmount, `${label}.recoveryResolutions[${index}].baseAmount`)
        const scalingNumerator = integer(item.scalingNumerator, `${label}.recoveryResolutions[${index}].scalingNumerator`, 0, 100)
        const scalingDenominator = integer(item.scalingDenominator, `${label}.recoveryResolutions[${index}].scalingDenominator`, 1, 100)
        const skillPower = integer(item.skillPower, `${label}.recoveryResolutions[${index}].skillPower`, -1_000_000_000, 1_000_000_000)
        const requestedRecovery = integer(item.requestedRecovery, `${label}.recoveryResolutions[${index}].requestedRecovery`)
        const appliedRecovery = integer(item.appliedRecovery, `${label}.recoveryResolutions[${index}].appliedRecovery`)
        const maximumHealth = integer(item.maximumHealth, `${label}.recoveryResolutions[${index}].maximumHealth`, 1)
        const beforeHealth = integer(item.beforeHealth, `${label}.recoveryResolutions[${index}].beforeHealth`, 1, maximumHealth)
        const afterHealth = integer(item.afterHealth, `${label}.recoveryResolutions[${index}].afterHealth`, beforeHealth, maximumHealth)
        if (requestedRecovery !== Math.max(0, baseAmount + Math.floor(scalingValue * scalingNumerator / scalingDenominator) + skillPower)
          || afterHealth !== Math.min(maximumHealth, beforeHealth + requestedRecovery)
          || appliedRecovery !== afterHealth - beforeHealth) fail(`${label}.recoveryResolutions[${index}]数值不自洽`)
        return {
          targetCombatantKey: token(item.targetCombatantKey, `${label}.recoveryResolutions[${index}].targetCombatantKey`),
          scalingAttribute, scalingValue, baseAmount, scalingNumerator, scalingDenominator, skillPower,
          requestedRecovery, appliedRecovery, maximumHealth, beforeHealth, afterHealth,
        }
      })
    }
    const parseResourceResolutions = (): TextOpenWorldCombatResourceResolutionV2[] => {
      if (!Array.isArray(raw.resourceResolutions) || raw.resourceResolutions.length > 1) fail(`${label}.resourceResolutions无效`)
      return raw.resourceResolutions.map((value, index) => {
        const item = row(value, `${label}.resourceResolutions[${index}]`)
        exact(item, ['targetCombatantKey', 'scalingAttribute', 'scalingValue', 'baseAmount', 'scalingNumerator', 'scalingDenominator', 'skillPower', 'requestedRecovery', 'appliedRecovery', 'maximumSkillResource', 'beforeSkillResource', 'afterSkillResource'], `${label}.resourceResolutions[${index}]`)
        if (item.targetCombatantKey !== 'player') fail(`${label}.resourceResolutions[${index}].targetCombatantKey无效`)
        const scalingAttribute = ['power', 'vitality', 'agility'].includes(String(item.scalingAttribute))
          ? item.scalingAttribute as TextOpenWorldCombatResourceResolutionV2['scalingAttribute']
          : fail(`${label}.resourceResolutions[${index}].scalingAttribute无效`)
        const scalingValue = integer(item.scalingValue, `${label}.resourceResolutions[${index}].scalingValue`)
        const baseAmount = integer(item.baseAmount, `${label}.resourceResolutions[${index}].baseAmount`)
        const scalingNumerator = integer(item.scalingNumerator, `${label}.resourceResolutions[${index}].scalingNumerator`, 0, 100)
        const scalingDenominator = integer(item.scalingDenominator, `${label}.resourceResolutions[${index}].scalingDenominator`, 1, 100)
        const skillPower = integer(item.skillPower, `${label}.resourceResolutions[${index}].skillPower`, -1_000_000_000, 1_000_000_000)
        const requestedRecovery = integer(item.requestedRecovery, `${label}.resourceResolutions[${index}].requestedRecovery`)
        const appliedRecovery = integer(item.appliedRecovery, `${label}.resourceResolutions[${index}].appliedRecovery`)
        const maximumSkillResource = integer(item.maximumSkillResource, `${label}.resourceResolutions[${index}].maximumSkillResource`)
        const beforeSkillResource = integer(item.beforeSkillResource, `${label}.resourceResolutions[${index}].beforeSkillResource`, 0, maximumSkillResource)
        const afterSkillResource = integer(item.afterSkillResource, `${label}.resourceResolutions[${index}].afterSkillResource`, beforeSkillResource, maximumSkillResource)
        if (requestedRecovery !== Math.max(0, baseAmount + Math.floor(scalingValue * scalingNumerator / scalingDenominator) + skillPower)
          || afterSkillResource !== Math.min(maximumSkillResource, beforeSkillResource + requestedRecovery)
          || appliedRecovery !== afterSkillResource - beforeSkillResource) fail(`${label}.resourceResolutions[${index}]数值不自洽`)
        return {
          targetCombatantKey: 'player', scalingAttribute, scalingValue, baseAmount, scalingNumerator,
          scalingDenominator, skillPower, requestedRecovery, appliedRecovery, maximumSkillResource,
          beforeSkillResource, afterSkillResource,
        }
      })
    }
    const parseStatusResolutions = (): TextOpenWorldCombatStatusResolutionV2[] => {
      if (!Array.isArray(raw.statusResolutions) || raw.statusResolutions.length > 8) fail(`${label}.statusResolutions无效`)
      return raw.statusResolutions.map((value, index) => {
        const item = row(value, `${label}.statusResolutions[${index}]`)
        exact(item, ['targetCombatantKey', 'statusKey', 'outcome', 'beforeStatus', 'afterStatus'], `${label}.statusResolutions[${index}]`)
        const outcome = ['applied', 'rejected', 'refreshed', 'stacked', 'max-stacks'].includes(String(item.outcome))
          ? item.outcome as TextOpenWorldCombatStatusResolutionV2['outcome']
          : fail(`${label}.statusResolutions[${index}].outcome无效`)
        const statusKey = token(item.statusKey, `${label}.statusResolutions[${index}].statusKey`)
        const beforeStatus = item.beforeStatus == null ? null : parseCombatStatusInstanceV2(item.beforeStatus, `${label}.statusResolutions[${index}].beforeStatus`)
        const afterStatus = item.afterStatus == null ? null : parseCombatStatusInstanceV2(item.afterStatus, `${label}.statusResolutions[${index}].afterStatus`)
        if ((beforeStatus && beforeStatus.statusKey !== statusKey) || (afterStatus && afterStatus.statusKey !== statusKey)) fail(`${label}.statusResolutions[${index}]状态key不一致`)
        if ((outcome === 'applied' && (beforeStatus != null || afterStatus == null))
          || ((outcome === 'rejected' || outcome === 'max-stacks') && canonicalProductProductionJsonV2(beforeStatus) !== canonicalProductProductionJsonV2(afterStatus))
          || ((outcome === 'refreshed' || outcome === 'stacked') && (beforeStatus == null || afterStatus == null))) fail(`${label}.statusResolutions[${index}]结果不自洽`)
        return {
          targetCombatantKey: token(item.targetCombatantKey, `${label}.statusResolutions[${index}].targetCombatantKey`),
          statusKey, outcome, beforeStatus, afterStatus,
        }
      })
    }
    const recoveryResolutions = structuredResolution ? parseRecoveryResolutions() : undefined
    const resourceResolutions = structuredResolution ? parseResourceResolutions() : undefined
    const statusResolutions = structuredResolution ? parseStatusResolutions() : undefined
    const targetCombatantKeys = uniqueStrings(raw.targetCombatantKeys, `${label}.targetCombatantKeys`)
    if (includesResolution && randomRequests!.length !== targetResolutions!.length) fail(`${label}伤害结果与随机请求数量不一致`)
    if (structuredResolution) {
      if (mechanicKind === 'attack' && canonicalProductProductionJsonV2(targetResolutions!.map(item => item.targetCombatantKey)) !== canonicalProductProductionJsonV2(targetCombatantKeys)) fail(`${label}攻击目标与伤害结果不一致`)
      if (mechanicKind !== 'attack' && targetResolutions!.length) fail(`${label}非攻击机制不能包含伤害结果`)
      if ((mechanicKind === 'recovery') !== (recoveryResolutions!.length === 1)) fail(`${label}recovery结果数量无效`)
      if ((mechanicKind === 'resource') !== (resourceResolutions!.length === 1)) fail(`${label}resource结果数量无效`)
      if (mechanicKind === 'status'
        ? canonicalProductProductionJsonV2(statusResolutions!.map(item => item.targetCombatantKey)) !== canonicalProductProductionJsonV2(targetCombatantKeys)
        : statusResolutions!.length > 0) fail(`${label}status结果目标无效`)
      if ((actionKind === 'basic-attack' && mechanicKind !== 'attack')
        || ((actionKind === 'item' || actionKind === 'escape') && mechanicKind !== null)) fail(`${label}行动与mechanicKind不一致`)
    }
    return {
      kind: 'combat-action',
      instanceKey: token(raw.instanceKey, `${label}.instanceKey`, COMMAND_ID),
      encounterKey: token(raw.encounterKey, `${label}.encounterKey`),
      actionKey: token(raw.actionKey, `${label}.actionKey`),
      actorKey,
      actorCombatantKey: token(raw.actorCombatantKey, `${label}.actorCombatantKey`),
      actionKind,
      skillKey: raw.skillKey == null ? null : token(raw.skillKey, `${label}.skillKey`),
      itemKey: raw.itemKey == null ? null : token(raw.itemKey, `${label}.itemKey`),
      targetCombatantKeys,
      beforePhase: 'actor-turn',
      beforeRound: integer(raw.beforeRound, `${label}.beforeRound`, 1),
      beforeTurnIndex: integer(raw.beforeTurnIndex, `${label}.beforeTurnIndex`),
      beforeActiveCombatantKey: token(raw.beforeActiveCombatantKey, `${label}.beforeActiveCombatantKey`),
      effectKeys: uniqueStrings(raw.effectKeys, `${label}.effectKeys`),
      resourceCost: integer(raw.resourceCost, `${label}.resourceCost`),
      cooldownTurns: integer(raw.cooldownTurns, `${label}.cooldownTurns`),
      cooldownUntilRound: integer(raw.cooldownUntilRound, `${label}.cooldownUntilRound`, 1),
      afterSkillResource: integer(raw.afterSkillResource, `${label}.afterSkillResource`),
      ...(resolutionVersion === 1 ? {
        resolutionVersion: 1 as const,
        randomRequests: randomRequests!,
        targetResolutions: targetResolutions!,
        statusEffectKeys: uniqueStrings(raw.statusEffectKeys, `${label}.statusEffectKeys`),
      } : structuredResolution ? {
        resolutionVersion: 2 as const,
        randomRequests: randomRequests!,
        targetResolutions: targetResolutions!,
        mechanicKind: mechanicKind!,
        recoveryResolutions: recoveryResolutions!,
        resourceResolutions: resourceResolutions!,
        statusResolutions: statusResolutions!,
        expiredStatusKeys: uniqueStrings(raw.expiredStatusKeys, `${label}.expiredStatusKeys`),
        afterStatusInstancesByCombatantKey: parseCombatStatusMapV2(raw.afterStatusInstancesByCombatantKey, `${label}.afterStatusInstancesByCombatantKey`),
      } : {}),
    } satisfies TextOpenWorldCombatActionAuthorizationV1
  }
  if (raw.kind === 'crafting') {
    exact(raw, ['kind', 'recipeKey', 'quantity', 'locationKey', 'baseWorldMinute', 'timeCostMinutes', 'ingredients', 'outputs'], label)
    const parseItems = (value: unknown, field: 'ingredients' | 'outputs') => {
      if (!Array.isArray(value) || value.length < 1 || value.length > 128) fail(`${label}.${field}无效`)
      const items = value.map((entry, index) => {
        const parsed = row(entry, `${label}.${field}[${index}]`)
        exact(parsed, ['itemKey', 'quantity', 'beforeQuantity', 'afterQuantity'], `${label}.${field}[${index}]`)
        const itemQuantity = integer(parsed.quantity, `${label}.${field}[${index}].quantity`, 1, 1_000_000)
        const beforeQuantity = integer(parsed.beforeQuantity, `${label}.${field}[${index}].beforeQuantity`, 0, 1_000_000_000)
        const afterQuantity = integer(parsed.afterQuantity, `${label}.${field}[${index}].afterQuantity`, 0, 1_000_000_000)
        if (field === 'ingredients' ? afterQuantity !== beforeQuantity - itemQuantity : afterQuantity !== beforeQuantity + itemQuantity) {
          fail(`${label}.${field}[${index}]数量变化不自洽`)
        }
        return { itemKey: token(parsed.itemKey, `${label}.${field}[${index}].itemKey`), quantity: itemQuantity, beforeQuantity, afterQuantity }
      })
      if (new Set(items.map(item => item.itemKey)).size !== items.length) fail(`${label}.${field}物品不能重复`)
      return items
    }
    const ingredients = parseItems(raw.ingredients, 'ingredients')
    const outputs = parseItems(raw.outputs, 'outputs')
    if (ingredients.some(ingredient => outputs.some(output => output.itemKey === ingredient.itemKey))) fail(`${label}输入与输出物品不能重叠`)
    return {
      kind: 'crafting', recipeKey: token(raw.recipeKey, `${label}.recipeKey`),
      quantity: integer(raw.quantity, `${label}.quantity`, 1, 1_000),
      locationKey: token(raw.locationKey, `${label}.locationKey`),
      baseWorldMinute: integer(raw.baseWorldMinute, `${label}.baseWorldMinute`),
      timeCostMinutes: integer(raw.timeCostMinutes, `${label}.timeCostMinutes`),
      ingredients, outputs,
    } satisfies TextOpenWorldCraftingAuthorizationV1
  }
  if (raw.kind === 'transaction') {
    exact(raw, ['kind', 'transactionKind', 'vendorKey', 'vendorActorKey', 'itemKey', 'quantity', 'currencyKey', 'locationKey', 'worldMinute', 'attitude', 'price', 'before', 'after'], label)
    const transactionKind = raw.transactionKind === 'buy' || raw.transactionKind === 'sell'
      ? raw.transactionKind
      : fail(`${label}.transactionKind无效`)
    if (raw.currencyKey !== 'currency') fail(`${label}.currencyKey无效`)
    const attitude = raw.attitude === 'bad' || raw.attitude === 'neutral' || raw.attitude === 'good'
      ? raw.attitude
      : fail(`${label}.attitude无效`)
    const price = row(raw.price, `${label}.price`)
    exact(price, ['baseValue', 'vendorMultiplierBasisPoints', 'relationshipMultiplierBasisPoints', 'rounding', 'unitPrice', 'totalPrice'], `${label}.price`)
    const rounding = price.rounding === 'ceil' || price.rounding === 'floor' ? price.rounding : fail(`${label}.price.rounding无效`)
    if ((transactionKind === 'buy' ? 'ceil' : 'floor') !== rounding) fail(`${label}.price.rounding与交易方向不一致`)
    const quantity = integer(raw.quantity, `${label}.quantity`, 1, 1_000_000)
    const unitPrice = integer(price.unitPrice, `${label}.price.unitPrice`, 1, 1_000_000_000)
    const totalPrice = integer(price.totalPrice, `${label}.price.totalPrice`, 1, 1_000_000_000)
    if (unitPrice * quantity !== totalPrice || !Number.isSafeInteger(unitPrice * quantity)) fail(`${label}.price总价不自洽`)
    const parseBalance = (value: unknown, field: 'before' | 'after') => {
      const balance = row(value, `${label}.${field}`)
      exact(balance, ['currency', 'playerItemQuantity', 'vendorStockQuantity'], `${label}.${field}`)
      return {
        currency: integer(balance.currency, `${label}.${field}.currency`, 0, 1_000_000_000),
        playerItemQuantity: integer(balance.playerItemQuantity, `${label}.${field}.playerItemQuantity`, 0, 1_000_000_000),
        vendorStockQuantity: balance.vendorStockQuantity == null ? null : integer(balance.vendorStockQuantity, `${label}.${field}.vendorStockQuantity`, 0, 1_000_000),
      }
    }
    const before = parseBalance(raw.before, 'before')
    const after = parseBalance(raw.after, 'after')
    const direction = transactionKind === 'buy' ? 1 : -1
    if (after.playerItemQuantity !== before.playerItemQuantity + direction * quantity
      || after.currency !== before.currency - direction * totalPrice
      || (before.vendorStockQuantity == null) !== (after.vendorStockQuantity == null)
      || (before.vendorStockQuantity != null && after.vendorStockQuantity !== before.vendorStockQuantity - direction * quantity)) {
      fail(`${label}交易余额变化不自洽`)
    }
    return {
      kind: 'transaction', transactionKind,
      vendorKey: token(raw.vendorKey, `${label}.vendorKey`),
      vendorActorKey: token(raw.vendorActorKey, `${label}.vendorActorKey`),
      itemKey: token(raw.itemKey, `${label}.itemKey`), quantity, currencyKey: 'currency',
      locationKey: token(raw.locationKey, `${label}.locationKey`),
      worldMinute: integer(raw.worldMinute, `${label}.worldMinute`), attitude,
      price: {
        baseValue: integer(price.baseValue, `${label}.price.baseValue`, 1, 1_000_000_000),
        vendorMultiplierBasisPoints: integer(price.vendorMultiplierBasisPoints, `${label}.price.vendorMultiplierBasisPoints`, 100, 1_000_000),
        relationshipMultiplierBasisPoints: integer(price.relationshipMultiplierBasisPoints, `${label}.price.relationshipMultiplierBasisPoints`, 100, 1_000_000),
        rounding, unitPrice, totalPrice,
      },
      before, after,
    } satisfies TextOpenWorldTransactionAuthorizationV1
  }
  if (raw.kind === 'quest-objective') {
    exact(raw, ['kind', 'instanceKey', 'definitionKey', 'stageKey', 'objectiveKey', 'worldMinute', 'fromStatus', 'toStatus'], label)
    if (raw.fromStatus !== 'active' || raw.toStatus !== 'completed') fail(`${label}.objective状态边无效`)
    return {
      kind: 'quest-objective', instanceKey: token(raw.instanceKey, `${label}.instanceKey`),
      definitionKey: token(raw.definitionKey, `${label}.definitionKey`), stageKey: token(raw.stageKey, `${label}.stageKey`),
      objectiveKey: token(raw.objectiveKey, `${label}.objectiveKey`), worldMinute: integer(raw.worldMinute, `${label}.worldMinute`),
      fromStatus: 'active', toStatus: 'completed',
    } satisfies TextOpenWorldObjectiveAuthorizationV1
  }
  if (raw.kind === 'quest-tracking') {
    exact(raw, ['kind', 'instanceKey', 'definitionKey', 'worldMinute', 'operation', 'slot', 'beforePrimaryInstanceKey', 'beforePinnedInstanceKeys'], label)
    if (!Array.isArray(raw.beforePinnedInstanceKeys) || raw.beforePinnedInstanceKeys.length > 3) fail(`${label}.beforePinnedInstanceKeys无效`)
    const beforePinnedInstanceKeys = raw.beforePinnedInstanceKeys.map((value, index) => token(value, `${label}.beforePinnedInstanceKeys[${index}]`))
    if (new Set(beforePinnedInstanceKeys).size !== beforePinnedInstanceKeys.length) fail(`${label}.beforePinnedInstanceKeys不能重复`)
    const operation = raw.operation === 'track' || raw.operation === 'untrack' ? raw.operation : fail(`${label}.operation无效`)
    const slot = raw.slot === 'primary' || raw.slot === 'pinned' ? raw.slot : fail(`${label}.slot无效`)
    return {
      kind: 'quest-tracking', instanceKey: token(raw.instanceKey, `${label}.instanceKey`),
      definitionKey: token(raw.definitionKey, `${label}.definitionKey`), worldMinute: integer(raw.worldMinute, `${label}.worldMinute`),
      operation, slot, beforePrimaryInstanceKey: raw.beforePrimaryInstanceKey == null ? null : token(raw.beforePrimaryInstanceKey, `${label}.beforePrimaryInstanceKey`),
      beforePinnedInstanceKeys,
    } satisfies TextOpenWorldQuestTrackingAuthorizationV1
  }
  if (raw.kind !== 'quest-transition') fail(`${label}.kind无效`)
  exact(raw, ['kind', 'instanceKey', 'definitionKey', 'worldMinute', 'transitions'], label)
  if (!Array.isArray(raw.transitions) || raw.transitions.length < 1 || raw.transitions.length > 8) fail(`${label}.transitions无效`)
  const statuses = new Set(['locked', 'available', 'revealed', 'accepted', 'active', 'suspended', 'completed', 'failed', 'expired', 'abandoned', 'withdrawn'])
  const intents = new Set(['unlock', 'reveal', 'accept', 'activate', 'suspend', 'resume', 'advance-stage', 'complete', 'fail', 'abandon', 'expire', 'withdraw', 'reoffer'])
  return {
    kind: 'quest-transition',
    instanceKey: token(raw.instanceKey, `${label}.instanceKey`),
    definitionKey: token(raw.definitionKey, `${label}.definitionKey`),
    worldMinute: integer(raw.worldMinute, `${label}.worldMinute`),
    transitions: raw.transitions.map((value, index) => {
      const step = row(value, `${label}.transitions[${index}]`)
      exact(step, ['intent', 'actorKind', 'fromStatus', 'toStatus', 'stageKey'], `${label}.transitions[${index}]`)
      const actorKind: 'player' | 'system' = step.actorKind === 'player' || step.actorKind === 'system'
        ? step.actorKind
        : fail(`${label}.transitions[${index}].actorKind无效`)
      return {
        intent: token(step.intent, `${label}.transitions[${index}].intent`) as TextOpenWorldQuestTransitionAuthorizationV1['transitions'][number]['intent'],
        actorKind,
        fromStatus: token(step.fromStatus, `${label}.transitions[${index}].fromStatus`) as TextOpenWorldQuestTransitionAuthorizationV1['transitions'][number]['fromStatus'],
        toStatus: token(step.toStatus, `${label}.transitions[${index}].toStatus`) as TextOpenWorldQuestTransitionAuthorizationV1['transitions'][number]['toStatus'],
        stageKey: step.stageKey == null ? null : token(step.stageKey, `${label}.transitions[${index}].stageKey`),
      }
    }).map((step, index) => {
      if (!intents.has(step.intent) || !statuses.has(step.fromStatus) || !statuses.has(step.toStatus)) fail(`${label}.transitions[${index}]枚举无效`)
      return step
    }),
  }
}

function parsePlan(value: unknown, label: string): TextOpenWorldEffectPlanV1 {
  const parsed = row(value, label); exact(parsed, ['schema', 'version', 'claimKey', 'baseStateHash', 'resultingStateHash', 'effectKeys', 'effects', 'authorization', 'impactDomains', 'previewChanges', 'planHash'], label)
  if (parsed.schema !== 'storyforge.text-open-world.effect-plan' || parsed.version !== 1) fail(`${label} schema/version无效`)
  const effectKeys = uniqueStrings(parsed.effectKeys, `${label}.effectKeys`)
  if (!Array.isArray(parsed.effects) || parsed.effects.length !== effectKeys.length) fail(`${label}.effects无效`)
  const effects = parsed.effects.map((value, index) => {
    const effect = row(value, `${label}.effects[${index}]`); exact(effect, ['key', 'operation', 'payload'], `${label}.effects[${index}]`)
    if (token(effect.key, `${label}.effects[${index}].key`) !== effectKeys[index]) fail(`${label}.effects与effectKeys顺序不一致`)
    token(effect.operation, `${label}.effects[${index}].operation`); canonicalProductProductionJsonV2(effect.payload)
    return structuredClone(effect) as TextOpenWorldEffectDefinitionV1
  })
  const impactDomains = uniqueStrings(parsed.impactDomains, `${label}.impactDomains`, new Set(IMPACT_DOMAINS)) as TextOpenWorldEffectImpactDomainV1[]
  if (!Array.isArray(parsed.previewChanges)) fail(`${label}.previewChanges必须是数组`)
  return {
    schema: 'storyforge.text-open-world.effect-plan', version: 1,
    claimKey: token(parsed.claimKey, `${label}.claimKey`, COMMAND_ID),
    baseStateHash: hash(parsed.baseStateHash, `${label}.baseStateHash`), resultingStateHash: hash(parsed.resultingStateHash, `${label}.resultingStateHash`),
    effectKeys, effects, authorization: parseAuthorization(parsed.authorization, `${label}.authorization`), impactDomains,
    previewChanges: parsed.previewChanges.map((item, index) => parseChange(item, `${label}.previewChanges[${index}]`)),
    planHash: hash(parsed.planHash, `${label}.planHash`),
  }
}

function parseReceipt(value: unknown, label: string): TextOpenWorldEffectReceiptV1 {
  const parsed = row(value, label); exact(parsed, ['schema', 'version', 'claimKey', 'planHash', 'baseStateHash', 'resultingStateHash', 'impactDomains', 'changes'], label)
  if (parsed.schema !== 'storyforge.text-open-world.effect-receipt' || parsed.version !== 1) fail(`${label} schema/version无效`)
  if (!Array.isArray(parsed.changes)) fail(`${label}.changes必须是数组`)
  return {
    schema: 'storyforge.text-open-world.effect-receipt', version: 1,
    claimKey: token(parsed.claimKey, `${label}.claimKey`, COMMAND_ID), planHash: hash(parsed.planHash, `${label}.planHash`),
    baseStateHash: hash(parsed.baseStateHash, `${label}.baseStateHash`), resultingStateHash: hash(parsed.resultingStateHash, `${label}.resultingStateHash`),
    impactDomains: uniqueStrings(parsed.impactDomains, `${label}.impactDomains`, new Set(IMPACT_DOMAINS)) as TextOpenWorldEffectImpactDomainV1[],
    changes: parsed.changes.map((item, index) => parseChange(item, `${label}.changes[${index}]`)),
  }
}

function parseOutcome(value: unknown, label: string): TextOpenWorldCommandOutcomeV1 {
  if (value !== 'success' && value !== 'failure' && value !== 'degraded') fail(`${label}无效`)
  return value
}

function parseDegradation(value: unknown, outcome: TextOpenWorldCommandOutcomeV1, label: string): TextOpenWorldDegradationV1 | null {
  if (value == null) {
    if (outcome === 'degraded') fail(`${label}在degraded结果中不能为空`)
    return null
  }
  if (outcome !== 'degraded') fail(`${label}只能用于degraded结果`)
  const parsed = row(value, label); exact(parsed, ['code', 'message', 'unavailableCapability', 'fallback'], label)
  const readable = (child: unknown, childLabel: string, maximum = 2_000) => {
    if (typeof child !== 'string' || !child.trim() || child.length > maximum) fail(`${childLabel}无效`)
    return child.trim().normalize('NFC')
  }
  return {
    code: token(parsed.code, `${label}.code`),
    message: readable(parsed.message, `${label}.message`),
    unavailableCapability: token(parsed.unavailableCapability, `${label}.unavailableCapability`),
    fallback: readable(parsed.fallback, `${label}.fallback`),
  }
}

function parseOutcomeReason(value: unknown, outcome: TextOpenWorldCommandOutcomeV1, label: string): TextOpenWorldOutcomeReasonV1 | null {
  if (value == null) {
    if (outcome === 'failure') fail(`${label}在failure结果中不能为空`)
    return null
  }
  if (outcome !== 'failure') fail(`${label}只能用于failure结果`)
  const parsed = row(value, label); exact(parsed, ['code', 'message'], label)
  if (typeof parsed.message !== 'string' || !parsed.message.trim() || parsed.message.length > 2_000) fail(`${label}.message无效`)
  return { code: token(parsed.code, `${label}.code`), message: parsed.message.trim().normalize('NFC') }
}

export function parseTextOpenWorldRandomResolvedEventPayloadV1(value: unknown): TextOpenWorldRandomResolvedEventPayloadV1 {
  const parsed = row(value, 'randomEvent'); exact(parsed, ['schema', 'version', 'commandId', 'commandSequence', 'ruleset', 'evidence'], 'randomEvent')
  if (parsed.schema !== 'storyforge.text-open-world.random-resolved-event' || parsed.version !== 1) fail('randomEvent schema/version无效')
  return {
    schema: 'storyforge.text-open-world.random-resolved-event', version: 1,
    commandId: token(parsed.commandId, 'randomEvent.commandId', COMMAND_ID), commandSequence: integer(parsed.commandSequence, 'randomEvent.commandSequence', 1),
    ruleset: parseRuleset(parsed.ruleset, 'randomEvent.ruleset'), evidence: parseTextOpenWorldRandomEvidenceV1(parsed.evidence, 'randomEvent.evidence'),
  }
}

export function parseTextOpenWorldEffectsAppliedEventPayloadV1(value: unknown): TextOpenWorldEffectsAppliedEventPayloadV1 {
  const parsed = row(value, 'effectsEvent'); exact(parsed, ['schema', 'version', 'commandId', 'commandSequence', 'ruleset', 'randomEventSequences', 'outcome', 'reason', 'degradation', 'plan', 'receipt', 'outcomeFingerprint'], 'effectsEvent')
  if (parsed.schema !== 'storyforge.text-open-world.effects-applied-event' || parsed.version !== 1) fail('effectsEvent schema/version无效')
  const plan = parsePlan(parsed.plan, 'effectsEvent.plan'); const receipt = parseReceipt(parsed.receipt, 'effectsEvent.receipt'); const outcome = parseOutcome(parsed.outcome, 'effectsEvent.outcome'); const reason = parseOutcomeReason(parsed.reason, outcome, 'effectsEvent.reason'); const degradation = parseDegradation(parsed.degradation, outcome, 'effectsEvent.degradation')
  if (receipt.claimKey !== plan.claimKey || receipt.planHash !== plan.planHash || receipt.baseStateHash !== plan.baseStateHash || receipt.resultingStateHash !== plan.resultingStateHash || canonicalProductProductionJsonV2(receipt.impactDomains) !== canonicalProductProductionJsonV2(plan.impactDomains) || canonicalProductProductionJsonV2(receipt.changes) !== canonicalProductProductionJsonV2(plan.previewChanges)) fail('effectsEvent plan与receipt不一致')
  return {
    schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
    commandId: token(parsed.commandId, 'effectsEvent.commandId', COMMAND_ID), commandSequence: integer(parsed.commandSequence, 'effectsEvent.commandSequence', 1),
    ruleset: parseRuleset(parsed.ruleset, 'effectsEvent.ruleset'), randomEventSequences: uniqueIntegers(parsed.randomEventSequences, 'effectsEvent.randomEventSequences'),
    outcome, reason, degradation, plan, receipt, outcomeFingerprint: hash(parsed.outcomeFingerprint, 'effectsEvent.outcomeFingerprint'),
  }
}

export async function resolveTextOpenWorldRandomEvidenceV1(input: {
  seed: string
  commandId: string
  commandSequence: number
  drawIndex: number
  request: TextOpenWorldRandomRequestV1 | unknown
}): Promise<TextOpenWorldRandomEvidenceV1> {
  if (typeof input.seed !== 'string' || !input.seed.trim() || input.seed.length > 500) fail('随机seed无效')
  const request = parseTextOpenWorldRandomRequestV1(input.request)
  const commandId = token(input.commandId, 'commandId', COMMAND_ID); const commandSequence = integer(input.commandSequence, 'commandSequence', 1); const drawIndex = integer(input.drawIndex, 'drawIndex', 0, 1_000_000)
  const algorithm = 'sha256-range-v1' as const
  const seedHash = await hashProductProductionValueV2(input.seed)
  const inputHash = await hashProductProductionValueV2({ algorithm, seed: input.seed, commandId, commandSequence, drawIndex, ...request })
  const sample = Number.parseInt(inputHash.slice(0, 8), 16)
  const value = request.minimumInclusive + sample % (request.maximumInclusive - request.minimumInclusive + 1)
  return { ...request, algorithm, seedHash, inputHash, drawIndex, value }
}

async function outcomeFingerprint(input: {
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  requests: TextOpenWorldRandomRequestV1[]
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
  outcome: TextOpenWorldCommandOutcomeV1
  degradation: TextOpenWorldDegradationV1 | null
  reason: TextOpenWorldOutcomeReasonV1 | null
}) { return hashProductProductionValueV2({ schema: 'storyforge.text-open-world.outcome-batch', version: 1, ...input }) }

export async function createTextOpenWorldOutcomeFingerprintV1(input: {
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  randomRequests: TextOpenWorldRandomRequestV1[]
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
  outcome: TextOpenWorldCommandOutcomeV1
  degradation: TextOpenWorldDegradationV1 | null
  reason: TextOpenWorldOutcomeReasonV1 | null
}): Promise<string> {
  const ruleset = parseRuleset(input.ruleset, 'ruleset')
  const requests = input.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `randomRequests[${index}]`))
  const effect = parseTextOpenWorldEffectsAppliedEventPayloadV1({
    schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
    commandId: input.commandId, commandSequence: input.commandSequence, ruleset, randomEventSequences: [],
    outcome: input.outcome, reason: input.reason, degradation: input.degradation,
    plan: input.plan, receipt: input.receipt, outcomeFingerprint: '0'.repeat(64),
  })
  return outcomeFingerprint({ commandId: effect.commandId, commandSequence: effect.commandSequence, ruleset, requests, plan: effect.plan, receipt: effect.receipt, outcome: effect.outcome, reason: effect.reason, degradation: effect.degradation })
}

function payload(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence} payload不是合法JSON`) } }

export async function replayTextOpenWorldEventProtocolV1(events: readonly ProductRuntimeEvent[], seed: string): Promise<TextOpenWorldEventProtocolProjectionV1> {
  const projection: TextOpenWorldEventProtocolProjectionV1 = {
    schema: 'storyforge.text-open-world.event-protocol-projection', version: 1, sessionId: null, lastSequence: 0, batches: [], pendingCommandId: null,
  }
  let pending: TextOpenWorldEventBatchProjectionV1 | null = null
  const randomRequests: TextOpenWorldRandomRequestV1[] = []
  const priorEventsBySequence = new Map<number, ProductRuntimeEvent>()
  for (const event of events) {
    if (event.sequence !== projection.lastSequence + 1) fail(`事件序号不连续:${projection.lastSequence + 1}->${event.sequence}`)
    if (projection.sessionId == null) projection.sessionId = event.sessionId
    else if (projection.sessionId !== event.sessionId) fail('事件流混入其他Session')
    if (event.type === 'text-open-world.command.committed') {
      if (pending) fail(`上一命令尚未终结:${pending.commandId}`)
      const command = parseTextOpenWorldCommandEventPayloadV1(payload(event))
      if (command.envelope.sessionId !== event.sessionId || command.envelope.commandId !== event.commandId || command.envelope.baseSequence !== projection.lastSequence || command.resultingSequence !== event.sequence) fail('命令事件索引或顺序无效')
      pending = { commandId: command.envelope.commandId, commandSequence: event.sequence, randomEventSequences: [], effectsEventSequence: null, ruleset: null, outcomeFingerprint: null }
      randomRequests.length = 0
    } else if (event.type === 'text-open-world.random.resolved') {
      if (!pending) fail('随机事件前没有待处理命令')
      const random = parseTextOpenWorldRandomResolvedEventPayloadV1(payload(event))
      if (random.commandId !== pending.commandId || random.commandSequence !== pending.commandSequence || random.evidence.drawIndex !== pending.randomEventSequences.length) fail('随机事件命令归属或drawIndex无效')
      if (pending.ruleset && canonicalProductProductionJsonV2(pending.ruleset) !== canonicalProductProductionJsonV2(random.ruleset)) fail('同一命令批次ruleset不一致')
      const request = requestFromEvidence(random.evidence)
      const expected = await resolveTextOpenWorldRandomEvidenceV1({ seed, commandId: pending.commandId, commandSequence: pending.commandSequence, drawIndex: random.evidence.drawIndex, request })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(random.evidence)) fail('随机证据无法由Session seed重放')
      pending.ruleset = random.ruleset; pending.randomEventSequences.push(event.sequence); randomRequests.push(request)
    } else if (event.type === 'text-open-world.effects.applied') {
      if (!pending) fail('Effect事件前没有待处理命令')
      const effect = parseTextOpenWorldEffectsAppliedEventPayloadV1(payload(event))
      if (effect.commandId !== pending.commandId || effect.commandSequence !== pending.commandSequence || canonicalProductProductionJsonV2(effect.randomEventSequences) !== canonicalProductProductionJsonV2(pending.randomEventSequences)) fail('Effect事件命令归属或随机证据序列无效')
      if (pending.ruleset && canonicalProductProductionJsonV2(pending.ruleset) !== canonicalProductProductionJsonV2(effect.ruleset)) fail('同一命令批次ruleset不一致')
      const { planHash, ...planBody } = effect.plan
      if (await hashProductProductionValueV2(planBody) !== planHash) fail('EffectPlan planHash无法重放')
      const expectedFingerprint = await outcomeFingerprint({ commandId: effect.commandId, commandSequence: effect.commandSequence, ruleset: effect.ruleset, requests: randomRequests, plan: effect.plan, receipt: effect.receipt, outcome: effect.outcome, reason: effect.reason, degradation: effect.degradation })
      if (expectedFingerprint !== effect.outcomeFingerprint) fail('命令结果批次指纹无效')
      pending.ruleset = effect.ruleset; pending.effectsEventSequence = event.sequence; pending.outcomeFingerprint = effect.outcomeFingerprint
      projection.batches.push(structuredClone(pending)); pending = null; randomRequests.length = 0
    } else if (event.type === 'text-open-world.memory.committed') {
      if (pending) fail('待处理命令期间不能插入长期记忆事件')
      const memory = parseTextOpenWorldMemoryCommittedEventPayloadV1(payload(event))
      if (event.commandId != null || event.baseSequence !== projection.lastSequence
        || event.baseStateHash == null || event.actorKey !== 'player'
        || event.targetKey !== memory.actorKey) fail('长期记忆事件索引无效')
      const { adoptionHash, ...memoryWithoutAdoption } = memory
      if (await createTextOpenWorldMemoryAdoptionHashV1(memoryWithoutAdoption) !== adoptionHash) {
        fail('长期记忆采用Hash无法重放')
      }
      for (let index = 0; index < memory.coveredEventSequences.length; index += 1) {
        const sequence = memory.coveredEventSequences[index]!
        const evidence = priorEventsBySequence.get(sequence)
        if (!evidence || evidence.type !== 'text-open-world.effects.applied') {
          fail(`长期记忆证据不是已提交终态事件:${sequence}`)
        }
        if (await createTextOpenWorldMemoryEvidenceEventHashV1(evidence) !== memory.coveredEventHashes[index]) {
          fail(`长期记忆事件指纹无法重放:${sequence}`)
        }
      }
    }
    // ProductRuntimeSession is a shared event stream. Narrative, interaction
    // and other product events advance the global cursor but do not belong to
    // the vNext command/outcome sub-protocol.
    projection.lastSequence = event.sequence
    priorEventsBySequence.set(event.sequence, event)
  }
  projection.pendingCommandId = pending?.commandId ?? null
  return projection
}
