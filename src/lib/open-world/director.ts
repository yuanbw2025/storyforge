import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldDirectorSettlementAuthorizationV1,
  TextOpenWorldDirectorTriggerV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { createTextOpenWorldDirectorQuestInstanceV1, createTextOpenWorldQuestInstanceKeyV1 } from './quests'

type ConditionResults = Record<string, boolean>
type Candidate = {
  outcomeKind: 'fixed-quest' | 'template-quest' | 'random-event'
  sourceKey: string
  definitionKey: string | null
  sourceInstanceKey: string | null
  questInstanceKey: string | null
  variantTextKeys: string[]
  fingerprint: string
  intensity: number
  effectKeys: string[]
  rumorKey: string | null
  weight: number
}

const DIRECTION_REASON_PREFIX_V1 = 'runtime-direction-v1'
const HASH = /^[a-f0-9]{64}$/

/**
 * Verified, read-only model advice. The Director may only use it to choose one
 * candidate that deterministic code has already admitted. Blank probability,
 * eligibility, cooldowns, capacity and all effects remain code-owned.
 */
export interface TextOpenWorldDirectorAdviceV1 {
  version: 1
  source: 'runtime-direction'
  candidateKey: string
  candidateHash: string
  contextManifestHash: string
  terminalReceiptHash: string
}

export interface TextOpenWorldDirectorCandidateProjectionV1 {
  regionKey: string
  deckReady: boolean
  blankWeight: number
  candidates: Array<{
    outcomeKind: Candidate['outcomeKind']
    sourceKey: string
    definitionKey: string | null
    questInstanceKey: string | null
    variantTextKeys: string[]
    fingerprint: string
    intensity: number
    weight: number
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-director] ${message}`) }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)) }
function allSatisfied(keys: string[], results: ConditionResults) { return keys.every(key => results[key] === true) }
function currentRegionKey(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1) {
  return modules.world.locations.find(location => location.key === state.map.currentLocationKey)?.regionKey
    ?? fail(`当前位置没有所属地区:${state.map.currentLocationKey}`)
}
function regionState(rule: TextOpenWorldParsedModulesV1['director']['regionRules'][number], pressure: number) {
  return [...rule.stateBands].sort((left, right) => right.minimumPressure - left.minimumPressure)
    .find(band => pressure >= band.minimumPressure)?.key ?? fail(`地区压力无法映射状态:${rule.regionKey}`)
}
function recentEnough(state: TextOpenWorldEffectStateV1, fingerprint: string, cooldownMinutes: number) {
  return state.director.recentFingerprints.some(item => item.fingerprint === fingerprint
    && state.time.worldMinute - item.worldMinute < cooldownMinutes)
}
function sourceCoolingDown(state: TextOpenWorldEffectStateV1, sourceKey: string, cooldownMinutes: number) {
  const lastMinute = state.director.lastResolvedWorldMinuteBySourceKey[sourceKey]
  return lastMinute != null && state.time.worldMinute - lastMinute < cooldownMinutes
}
function managedQuestInstances(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, regionKey?: string) {
  const fixed = new Set(modules.director.decks.flatMap(deck => deck.questKeys))
  return Object.values(state.quests.instancesByKey).filter(instance => {
    if (instance.sourceKind !== 'director' && !fixed.has(instance.definitionKey)) return false
    if (!regionKey) return true
    return modules.quests.quests.find(quest => quest.key === instance.definitionKey)?.regionKeys.includes(regionKey) === true
  })
}
function projectedQuestMirrors(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1) {
  const managed = managedQuestInstances(modules, state)
  return {
    generatedQuestInstanceCount: managed.filter(instance => instance.sourceKind === 'director').length,
    revealedQuestInstanceKeys: managed.filter(instance => ['revealed', 'accepted', 'active', 'suspended'].includes(instance.status)).map(instance => instance.instanceKey).sort(),
    activeQuestInstanceKeys: managed.filter(instance => ['accepted', 'active', 'suspended'].includes(instance.status)).map(instance => instance.instanceKey).sort(),
  }
}

/** Recomputes the derived Director quest-budget mirrors from the canonical quest ledger. */
export function synchronizeTextOpenWorldDirectorQuestMirrorsV1(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
): boolean {
  const projected = projectedQuestMirrors(modules, state)
  const before = {
    generatedQuestInstanceCount: state.director.generatedQuestInstanceCount,
    revealedQuestInstanceKeys: state.director.revealedQuestInstanceKeys,
    activeQuestInstanceKeys: state.director.activeQuestInstanceKeys,
  }
  Object.assign(state.director, projected)
  return canonicalProductProductionJsonV2(before) !== canonicalProductProductionJsonV2(projected)
}

function regionChanges(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1): TextOpenWorldDirectorSettlementAuthorizationV1['regionChanges'] {
  return modules.director.regionRules.flatMap(rule => {
    const fromSettlementWorldMinute = state.director.lastRegionSettlementWorldMinuteByRegionKey[rule.regionKey]
      ?? modules['time-weather'].initialWorldMinute
    const elapsed = state.time.worldMinute - fromSettlementWorldMinute
    const settledIntervals = Math.min(modules.director.rules.maximumSettlementIntervals, Math.floor(elapsed / rule.settlementIntervalMinutes))
    if (settledIntervals <= 0) return []
    const fromPressure = state.world.regionPressureByKey[rule.regionKey] ?? rule.initialPressure
    const toPressure = clamp(fromPressure + rule.driftPerInterval * settledIntervals, rule.minimumPressure, rule.maximumPressure)
    const fromState = state.world.regionStateByKey[rule.regionKey] ?? regionState(rule, fromPressure)
    return [{
      regionKey: rule.regionKey,
      settledIntervals,
      fromSettlementWorldMinute,
      toSettlementWorldMinute: fromSettlementWorldMinute + settledIntervals * rule.settlementIntervalMinutes,
      fromPressure,
      toPressure,
      fromState,
      toState: regionState(rule, toPressure),
    }]
  })
}

function candidates(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
  trigger: TextOpenWorldDirectorTriggerV1
  conditionResults: ConditionResults
}) {
  const { modules, state, trigger, conditionResults } = input
  const regionKey = currentRegionKey(modules, state)
  const deck = modules.director.decks.find(item => item.regionKey === regionKey) ?? fail(`地区缺少Director牌组:${regionKey}`)
  const lastDraw = state.director.lastDrawWorldMinuteByRegionKey[regionKey]
  const deckReady = deck.triggerKinds.includes(trigger) && (lastDraw == null || state.time.worldMinute - lastDraw >= deck.cooldownMinutes)
  if (!deckReady || state.combat?.status === 'active') return { regionKey, deck, deckReady: false, candidates: [] as Candidate[] }
  const managed = managedQuestInstances(modules, state, regionKey)
  const revealedCount = managed.filter(instance => ['revealed', 'accepted', 'active', 'suspended'].includes(instance.status)).length
  const activeCount = managed.filter(instance => ['accepted', 'active', 'suspended'].includes(instance.status)).length
  const canRevealQuest = revealedCount < deck.maximumRevealed
    && state.director.revealedQuestInstanceKeys.length < modules.director.rules.globalMaximumRevealed
  const canGenerateQuest = canRevealQuest
    && activeCount < deck.maximumActive
    && state.director.activeQuestInstanceKeys.length < modules.director.rules.globalMaximumActive
    && state.director.generatedQuestInstanceCount < modules.director.rules.maximumQuestInstances
  const result: Candidate[] = []
  if (canRevealQuest) deck.questKeys.forEach(questKey => {
    const instance = Object.values(state.quests.instancesByKey).find(item => item.definitionKey === questKey && item.sourceKind === 'release')
    if (!instance || instance.status !== 'available') return
    result.push({
      outcomeKind: 'fixed-quest', sourceKey: questKey, definitionKey: questKey, sourceInstanceKey: instance.sourceInstanceKey,
      questInstanceKey: instance.instanceKey, variantTextKeys: [], fingerprint: `fixed.${questKey}`, intensity: 3,
      effectKeys: [], rumorKey: null, weight: 100,
    })
  })
  if (canGenerateQuest) deck.templateKeys.forEach(templateKey => {
    const template = modules.director.templates.find(item => item.key === templateKey)!
    if (state.player.level < template.levelBand.minimum || state.player.level > template.levelBand.maximum
      || !allSatisfied(template.conditionKeys, conditionResults)
      || sourceCoolingDown(state, template.key, template.cooldownMinutes)
      || recentEnough(state, template.fingerprint, template.cooldownMinutes)) return
    const sourceInstanceKey = `draw.${state.director.drawCount + 1}`
    result.push({
      outcomeKind: 'template-quest', sourceKey: template.key, definitionKey: template.questKey, sourceInstanceKey,
      questInstanceKey: createTextOpenWorldQuestInstanceKeyV1({ definitionKey: template.questKey, sourceKind: 'director', sourceInstanceKey }),
      variantTextKeys: [...template.variantTextKeys], fingerprint: template.fingerprint, intensity: template.intensity,
      effectKeys: [], rumorKey: null, weight: template.weight,
    })
  })
  deck.randomEventKeys.forEach(eventKey => {
    const event = modules.director.randomEvents.find(item => item.key === eventKey)!
    if (event.locationKeys.length && !event.locationKeys.includes(state.map.currentLocationKey)
      || !allSatisfied(event.conditionKeys, conditionResults)
      || sourceCoolingDown(state, event.key, event.cooldownMinutes)
      || recentEnough(state, event.fingerprint, event.cooldownMinutes)
      || event.intensity >= 7 && state.director.highIntensityStreak >= modules.director.rules.highIntensityStreakLimit) return
    let definitionKey: string | null = null; let sourceInstanceKey: string | null = null; let questInstanceKey: string | null = null; let variantTextKeys: string[] = []
    if (event.kind === 'quest-upgrade') {
      if (!canGenerateQuest) return
      const template = modules.director.templates.find(item => item.key === event.upgradeTemplateKey)!
      if (state.player.level < template.levelBand.minimum || state.player.level > template.levelBand.maximum
        || !allSatisfied(template.conditionKeys, conditionResults)
        || sourceCoolingDown(state, template.key, template.cooldownMinutes)
        || recentEnough(state, template.fingerprint, template.cooldownMinutes)) return
      definitionKey = template.questKey; sourceInstanceKey = `draw.${state.director.drawCount + 1}`; variantTextKeys = [...template.variantTextKeys]
      questInstanceKey = createTextOpenWorldQuestInstanceKeyV1({ definitionKey, sourceKind: 'director', sourceInstanceKey })
    }
    result.push({
      outcomeKind: 'random-event', sourceKey: event.key, definitionKey, sourceInstanceKey, questInstanceKey,
      variantTextKeys, fingerprint: event.fingerprint, intensity: event.intensity,
      effectKeys: [...event.effectKeys], rumorKey: event.rumorKey, weight: event.weight,
    })
  })
  return { regionKey, deck, deckReady: true, candidates: result.sort((left, right) => left.outcomeKind.localeCompare(right.outcomeKind) || left.sourceKey.localeCompare(right.sourceKey)) }
}

/**
 * Read-only Director candidate projection for the registered runtime AI
 * Context Provider. It exposes only the same candidates deterministic
 * settlement may choose; random evidence and final selection remain owned by
 * createTextOpenWorldDirectorCatalogV1().
 */
export function projectTextOpenWorldDirectorCandidatesV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  state: TextOpenWorldEffectStateV1
  trigger: TextOpenWorldDirectorTriggerV1
  conditionResults: ConditionResults
  parsedModules?: TextOpenWorldParsedModulesV1
}): TextOpenWorldDirectorCandidateProjectionV1 {
  const modules = input.parsedModules ?? parseTextOpenWorldModulesV1(input.runtimePackage)
  const projected = candidates({
    modules,
    state: input.state,
    trigger: input.trigger,
    conditionResults: input.conditionResults,
  })
  return {
    regionKey: projected.regionKey,
    deckReady: projected.deckReady,
    blankWeight: projected.deckReady ? projected.deck.blankWeight : 0,
    candidates: projected.candidates.map(candidate => ({
      outcomeKind: candidate.outcomeKind,
      sourceKey: candidate.sourceKey,
      definitionKey: candidate.definitionKey,
      questInstanceKey: candidate.questInstanceKey,
      variantTextKeys: [...candidate.variantTextKeys],
      fingerprint: candidate.fingerprint,
      intensity: candidate.intensity,
      weight: candidate.weight,
    })),
  }
}

function requestsFor(input: ReturnType<typeof candidates>, drawNumber: number): TextOpenWorldRandomRequestV1[] {
  if (!input.deckReady) return []
  const totalWeight = input.deck.blankWeight + input.candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
  if (totalWeight <= 0) return []
  const maximumVariants = Math.max(1, ...input.candidates.map(candidate => candidate.variantTextKeys.length))
  return [
    { drawKey: `director.select.${drawNumber}.${input.regionKey}`, minimumInclusive: 1, maximumInclusive: totalWeight },
    { drawKey: `director.variant.${drawNumber}.${input.regionKey}`, minimumInclusive: 1, maximumInclusive: maximumVariants },
  ]
}

function directionReason(advice: TextOpenWorldDirectorAdviceV1): string {
  return [
    DIRECTION_REASON_PREFIX_V1,
    encodeURIComponent(advice.candidateKey),
    advice.candidateHash,
    advice.contextManifestHash,
    advice.terminalReceiptHash,
  ].join('|')
}

function parseDirectionReason(reason: string): TextOpenWorldDirectorAdviceV1 | null {
  if (!reason.startsWith(`${DIRECTION_REASON_PREFIX_V1}|`)) return null
  const parts = reason.split('|')
  if (parts.length !== 5) fail('Director AI建议证据格式无效')
  let candidateKey = ''
  try { candidateKey = decodeURIComponent(parts[1]) } catch { fail('Director AI建议候选键编码无效') }
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,199}$/.test(candidateKey)
    || !HASH.test(parts[2]) || !HASH.test(parts[3]) || !HASH.test(parts[4])) {
    fail('Director AI建议证据无效')
  }
  return {
    version: 1,
    source: 'runtime-direction',
    candidateKey,
    candidateHash: parts[2],
    contextManifestHash: parts[3],
    terminalReceiptHash: parts[4],
  }
}

function earnedAchievements(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, conditionResults: ConditionResults) {
  return modules.knowledge.achievements.filter(achievement => achievement.grantAuthority !== 'owner-action'
    && !state.knowledge.earnedAchievementKeys.includes(achievement.key)
    && allSatisfied(achievement.conditionKeys, conditionResults)).map(achievement => achievement.key).sort()
}

export interface TextOpenWorldDirectorCatalogV1 {
  shouldSettle(input: { state: TextOpenWorldEffectStateV1; trigger: TextOpenWorldDirectorTriggerV1; conditionResults: ConditionResults }): boolean
  randomRequestsFor(input: { state: TextOpenWorldEffectStateV1; trigger: TextOpenWorldDirectorTriggerV1; conditionResults: ConditionResults }): TextOpenWorldRandomRequestV1[]
  resolve(input: { state: TextOpenWorldEffectStateV1; trigger: TextOpenWorldDirectorTriggerV1; conditionResults: ConditionResults; evidence: TextOpenWorldRandomEvidenceV1[]; advice?: TextOpenWorldDirectorAdviceV1 | null }): TextOpenWorldDirectorSettlementAuthorizationV1
  assertAuthorization(input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldDirectorSettlementAuthorizationV1; conditionResults?: ConditionResults; evidence?: TextOpenWorldRandomEvidenceV1[] }): void
  applyAuthorization(input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldDirectorSettlementAuthorizationV1 }): TextOpenWorldEffectStateV1
}

export function createTextOpenWorldDirectorCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
): TextOpenWorldDirectorCatalogV1 {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const resolve = (input: { state: TextOpenWorldEffectStateV1; trigger: TextOpenWorldDirectorTriggerV1; conditionResults: ConditionResults; evidence: TextOpenWorldRandomEvidenceV1[]; advice?: TextOpenWorldDirectorAdviceV1 | null }) => {
    const state = input.state; const drawNumber = state.director.drawCount + 1
    const eligible = candidates({ modules, state, trigger: input.trigger, conditionResults: input.conditionResults })
    const randomRequests = requestsFor(eligible, drawNumber)
    if (canonicalProductProductionJsonV2(input.evidence.map(item => ({ drawKey: item.drawKey, minimumInclusive: item.minimumInclusive, maximumInclusive: item.maximumInclusive }))) !== canonicalProductProductionJsonV2(randomRequests)) fail('Director随机证据与请求不一致')
    input.evidence.forEach((item, index) => { if (item.drawIndex !== index) fail('Director随机证据drawIndex不连续') })
    let selected: Candidate | null = null
    if (randomRequests.length) {
      let cursor = eligible.deck.blankWeight
      const roll = input.evidence[0].value
      if (roll > cursor) {
        for (const candidate of eligible.candidates) {
          cursor += candidate.weight
          if (roll <= cursor) { selected = candidate; break }
        }
      }
    }
    // The deterministic roll decides Blank versus content first. Advice may
    // only replace one non-Blank candidate with another currently legal one.
    if (selected && input.advice) {
      const advised = eligible.candidates.find(candidate => candidate.sourceKey === input.advice!.candidateKey)
      if (!advised) fail(`Director AI建议不在当前合法候选闭集:${input.advice.candidateKey}`)
      const advisedQuest = advised.definitionKey
        ? modules.quests.quests.find(quest => quest.key === advised.definitionKey)
        : null
      if (advisedQuest?.type === 'mainline' || advisedQuest?.type === 'significant') {
        fail(`Director AI建议不能选择受保护故事线:${input.advice.candidateKey}`)
      }
      selected = advised
    }
    const variantTextKey = selected && selected.variantTextKeys.length
      ? selected.variantTextKeys[(input.evidence[1].value - 1) % selected.variantTextKeys.length]
      : null
    const selection: TextOpenWorldDirectorSettlementAuthorizationV1['selection'] = selected ? {
      outcomeKind: selected.outcomeKind, sourceKey: selected.sourceKey, definitionKey: selected.definitionKey,
      sourceInstanceKey: selected.sourceInstanceKey, questInstanceKey: selected.questInstanceKey,
      variantTextKey, fingerprint: selected.fingerprint, intensity: selected.intensity,
      effectKeys: [...selected.effectKeys], rumorKey: selected.rumorKey,
      reason: input.advice ? directionReason(input.advice) : 'weighted-selection',
    } : {
      outcomeKind: 'blank', sourceKey: null, definitionKey: null, sourceInstanceKey: null, questInstanceKey: null,
      variantTextKey: null, fingerprint: null, intensity: 0, effectKeys: [], rumorKey: null,
      reason: randomRequests.length ? 'blank-weight' : eligible.deckReady ? 'no-weighted-candidate' : 'deck-not-ready',
    }
    return {
      kind: 'director-settlement' as const,
      trigger: input.trigger,
      regionKey: eligible.regionKey,
      worldMinute: state.time.worldMinute,
      randomRequests,
      regionChanges: regionChanges(modules, state),
      selection,
      earnedAchievementKeys: earnedAchievements(modules, state, input.conditionResults),
    }
  }
  const assertAuthorization: TextOpenWorldDirectorCatalogV1['assertAuthorization'] = input => {
    if (input.conditionResults && input.evidence) {
      const advice = parseDirectionReason(input.authorization.selection.reason)
      const expected = resolve({
        state: input.state,
        trigger: input.authorization.trigger,
        conditionResults: input.conditionResults,
        evidence: input.evidence,
        advice,
      })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('Director授权与冻结规则或当前状态不一致')
      return
    }
    if (input.authorization.worldMinute !== input.state.time.worldMinute
      || input.authorization.regionKey !== currentRegionKey(modules, input.state)
      || canonicalProductProductionJsonV2(input.authorization.regionChanges) !== canonicalProductProductionJsonV2(regionChanges(modules, input.state))) fail('Director授权时间、地区或演化结果不一致')
    const selection = input.authorization.selection
    if (selection.outcomeKind === 'fixed-quest') {
      if (!modules.director.decks.some(deck => deck.regionKey === input.authorization.regionKey && deck.questKeys.includes(selection.sourceKey!)) || selection.effectKeys.length) fail('Director固定任务授权无效')
    } else if (selection.outcomeKind === 'template-quest') {
      const template = modules.director.templates.find(item => item.key === selection.sourceKey)
      if (!template || template.questKey !== selection.definitionKey || selection.effectKeys.length) fail('Director模板任务授权无效')
    } else if (selection.outcomeKind === 'random-event') {
      const event = modules.director.randomEvents.find(item => item.key === selection.sourceKey)
      if (!event || canonicalProductProductionJsonV2(event.effectKeys) !== canonicalProductProductionJsonV2(selection.effectKeys)
        || event.rumorKey !== selection.rumorKey
        || event.locationKeys.length && !event.locationKeys.includes(input.state.map.currentLocationKey)) {
        fail('Director随机事件授权无效')
      }
    }
    input.authorization.earnedAchievementKeys.forEach(key => {
      const achievement = modules.knowledge.achievements.find(item => item.key === key)
      if (!achievement || achievement.grantAuthority === 'owner-action'
        || input.state.knowledge.earnedAchievementKeys.includes(key)) {
        fail(`Director成就授权无效:${key}`)
      }
    })
  }
  return {
    shouldSettle: input => regionChanges(modules, input.state).length > 0
      || requestsFor(candidates({ modules, ...input }), input.state.director.drawCount + 1).length > 0,
    randomRequestsFor: input => requestsFor(candidates({ modules, ...input }), input.state.director.drawCount + 1),
    resolve,
    assertAuthorization,
    applyAuthorization: input => {
      const { state, authorization } = input
      assertAuthorization({ state, authorization })
      authorization.regionChanges.forEach(change => {
        state.world.regionPressureByKey[change.regionKey] = change.toPressure
        state.world.regionStateByKey[change.regionKey] = change.toState
        state.director.lastRegionSettlementWorldMinuteByRegionKey[change.regionKey] = change.toSettlementWorldMinute
      })
      const selection = authorization.selection
      if (selection.outcomeKind === 'fixed-quest') {
        const instance = state.quests.instancesByKey[selection.questInstanceKey!] ?? fail('Director固定任务实例不存在')
        if (instance.status !== 'available') fail('Director固定任务不再可揭示')
        const definition = modules.quests.quests.find(quest => quest.key === instance.definitionKey)!
        instance.status = 'revealed'; instance.offeredAtWorldMinute = state.time.worldMinute
        instance.deadlineWorldMinute = definition.timePolicy === 'timed' ? state.time.worldMinute + definition.expirationMinutes! : null
      } else if (selection.definitionKey && selection.sourceInstanceKey && selection.questInstanceKey) {
        const instance = createTextOpenWorldDirectorQuestInstanceV1(value, {
          definitionKey: selection.definitionKey, sourceInstanceKey: selection.sourceInstanceKey, worldMinute: state.time.worldMinute,
        })
        if (instance.instanceKey !== selection.questInstanceKey || state.quests.instancesByKey[instance.instanceKey]) fail('Director任务实例授权冲突')
        state.quests.instancesByKey[instance.instanceKey] = instance
      }
      if (selection.rumorKey) {
        const rumor = modules.knowledge.rumors.find(item => item.key === selection.rumorKey) ?? fail('Director传闻不存在')
        if (!state.knowledge.readRumorKeys.includes(rumor.key)) state.knowledge.readRumorKeys.push(rumor.key)
        if (state.knowledge.visibilityByKey[rumor.knowledgeKey] === 'hidden') state.knowledge.visibilityByKey[rumor.knowledgeKey] = 'rumor'
        state.knowledge.history.push({ kind: 'rumor-read', targetKey: rumor.key, sourceKey: selection.sourceKey!, regionKey: authorization.regionKey, worldMinute: state.time.worldMinute })
        state.knowledge.history.push({ kind: 'knowledge-revealed', targetKey: rumor.knowledgeKey, sourceKey: selection.sourceKey!, regionKey: authorization.regionKey, worldMinute: state.time.worldMinute })
      }
      if (selection.outcomeKind === 'random-event' && selection.sourceKey) {
        if (!state.knowledge.seenRandomEventKeys.includes(selection.sourceKey)) state.knowledge.seenRandomEventKeys.push(selection.sourceKey)
        state.knowledge.history.push({ kind: 'random-event-seen', targetKey: selection.sourceKey, sourceKey: selection.sourceKey, regionKey: authorization.regionKey, worldMinute: state.time.worldMinute })
      }
      authorization.earnedAchievementKeys.forEach(achievementKey => {
        if (!state.knowledge.earnedAchievementKeys.includes(achievementKey)) state.knowledge.earnedAchievementKeys.push(achievementKey)
        state.knowledge.history.push({ kind: 'achievement-earned', targetKey: achievementKey, sourceKey: selection.sourceKey ?? 'director-settlement', regionKey: authorization.regionKey, worldMinute: state.time.worldMinute })
      })
      if (authorization.randomRequests.length) {
        state.director.drawCount += 1
        state.director.lastDrawWorldMinuteByRegionKey[authorization.regionKey] = state.time.worldMinute
        if (selection.sourceKey) state.director.lastResolvedWorldMinuteBySourceKey[selection.sourceKey] = state.time.worldMinute
        if (selection.outcomeKind === 'random-event' && selection.sourceKey) {
          const event = modules.director.randomEvents.find(item => item.key === selection.sourceKey)
          if (event?.upgradeTemplateKey) {
            state.director.lastResolvedWorldMinuteBySourceKey[event.upgradeTemplateKey] = state.time.worldMinute
            const template = modules.director.templates.find(item => item.key === event.upgradeTemplateKey)!
            state.director.recentFingerprints.push({ fingerprint: template.fingerprint, worldMinute: state.time.worldMinute })
          }
        }
        if (selection.fingerprint) {
          state.director.recentFingerprints.push({ fingerprint: selection.fingerprint, worldMinute: state.time.worldMinute })
          state.director.recentFingerprints = state.director.recentFingerprints.slice(-modules.director.rules.historyLimit)
        }
        state.director.highIntensityStreak = selection.intensity >= 7 ? state.director.highIntensityStreak + 1 : 0
        state.director.history.push({
          drawNumber: state.director.drawCount, worldMinute: state.time.worldMinute, regionKey: authorization.regionKey,
          trigger: authorization.trigger, outcomeKind: selection.outcomeKind, sourceKey: selection.sourceKey,
          questInstanceKey: selection.questInstanceKey, variantTextKey: selection.variantTextKey,
          fingerprint: selection.fingerprint, intensity: selection.intensity,
        })
        state.director.history = state.director.history.slice(-modules.director.rules.historyLimit)
      }
      state.knowledge.history = state.knowledge.history.slice(-modules.director.rules.historyLimit)
      synchronizeTextOpenWorldDirectorQuestMirrorsV1(modules, state)
      return state
    },
  }
}
