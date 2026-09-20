import { describe, expect, it } from 'vitest'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import { validateTextOpenWorldEffectStateV1 } from '../../src/lib/open-world/effect-dsl'
import { resolveTextOpenWorldRandomEvidenceV1 } from '../../src/lib/open-world/event-contract'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldDirectorTriggerV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const STRESS_BATCH_COUNT = 1_000
const CONDITION_RESULTS = { 'condition.always': true, 'condition.level-two': false }
const TRIGGER: TextOpenWorldDirectorTriggerV1 = 'talk'

type StressMetrics = {
  batches: number
  draws: number
  blankSelections: number
  templateSelections: number
  randomEventSelections: number
  maximumGeneratedQuestInstances: number
  maximumRevealedQuestInstances: number
  maximumHistoryEntries: number
  maximumRecentFingerprints: number
  maximumSettledIntervalsInBatch: number
  finalStateJson: string
}

function protectedQuestSnapshot(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
) {
  const protectedDefinitionKeys = new Set(modules.quests.quests
    .filter(quest => quest.type === 'mainline' || quest.type === 'significant')
    .map(quest => quest.key))
  return Object.values(state.quests.instancesByKey)
    .filter(instance => protectedDefinitionKeys.has(instance.definitionKey))
    .map(instance => ({
      instanceKey: instance.instanceKey,
      definitionKey: instance.definitionKey,
      status: instance.status,
      deadlineWorldMinute: instance.deadlineWorldMinute,
      terminalAtWorldMinute: instance.terminalAtWorldMinute,
    }))
    .sort((left, right) => left.instanceKey.localeCompare(right.instanceKey))
}

function assertDirectorBudgets(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
) {
  expect(state.director.generatedQuestInstanceCount)
    .toBeLessThanOrEqual(modules.director.rules.maximumQuestInstances)
  expect(state.director.revealedQuestInstanceKeys.length)
    .toBeLessThanOrEqual(modules.director.rules.globalMaximumRevealed)
  expect(state.director.activeQuestInstanceKeys.length)
    .toBeLessThanOrEqual(modules.director.rules.globalMaximumActive)
  expect(state.director.history.length).toBeLessThanOrEqual(modules.director.rules.historyLimit)
  expect(state.director.recentFingerprints.length).toBeLessThanOrEqual(modules.director.rules.historyLimit)
  expect(state.knowledge.history.length).toBeLessThanOrEqual(modules.director.rules.historyLimit)

  for (const deck of modules.director.decks) {
    const fixedQuestKeys = new Set(deck.questKeys)
    const regionDefinitionKeys = new Set(modules.quests.quests
      .filter(quest => quest.regionKeys.includes(deck.regionKey))
      .map(quest => quest.key))
    const regionInstances = Object.values(state.quests.instancesByKey)
      .filter(instance => regionDefinitionKeys.has(instance.definitionKey)
        && (instance.sourceKind === 'director' || fixedQuestKeys.has(instance.definitionKey)))
    expect(regionInstances.filter(instance => ['revealed', 'accepted', 'active', 'suspended'].includes(instance.status)).length)
      .toBeLessThanOrEqual(deck.maximumRevealed)
    expect(regionInstances.filter(instance => ['accepted', 'active', 'suspended'].includes(instance.status)).length)
      .toBeLessThanOrEqual(deck.maximumActive)
  }
}

function assertNoCrossRegionContent(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
) {
  for (const history of state.director.history) {
    if (history.outcomeKind === 'template-quest') {
      const template = modules.director.templates.find(candidate => candidate.key === history.sourceKey)
      expect(template, `缺少Director模板:${history.sourceKey}`).toBeDefined()
      expect(template!.regionKeys).toContain(history.regionKey)
    }
    if (history.outcomeKind === 'random-event') {
      const event = modules.director.randomEvents.find(candidate => candidate.key === history.sourceKey)
      expect(event, `缺少Director随机事件:${history.sourceKey}`).toBeDefined()
      expect(event!.regionKeys).toContain(history.regionKey)
    }
  }

  for (const instance of Object.values(state.quests.instancesByKey).filter(item => item.sourceKind === 'director')) {
    const definition = modules.quests.quests.find(candidate => candidate.key === instance.definitionKey)
    expect(definition, `缺少Director任务定义:${instance.definitionKey}`).toBeDefined()
    const sourceDraw = Number(instance.sourceInstanceKey.replace(/^draw\./, ''))
    expect(Number.isInteger(sourceDraw) && sourceDraw > 0).toBe(true)
    expect(definition!.type).toBe('template')
    expect(definition!.regionKeys.length).toBeGreaterThan(0)
  }
}

async function runDirectorStress(seed: string): Promise<StressMetrics> {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const director = createTextOpenWorldDirectorCatalogV1(runtimePackage, modules)
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const state = projection.state
  const protectedBefore = protectedQuestSnapshot(modules, state)
  const initialReleaseQuestCount = Object.values(state.quests.instancesByKey)
    .filter(instance => instance.sourceKind === 'release').length
  const locationsByRegionKey = Object.fromEntries(modules.world.regions.map(region => [
    region.key,
    modules.world.locations.find(location => location.regionKey === region.key)?.key,
  ]))
  for (const locationKey of Object.values(locationsByRegionKey)) {
    expect(locationKey).toBeTruthy()
    state.map.locationKnowledgeByKey[locationKey!] = 'visited'
    const regionKey = modules.world.locations.find(location => location.key === locationKey)!.regionKey
    state.map.regionKnowledgeByKey[regionKey] = 'visited'
  }

  let draws = 0
  let blankSelections = 0
  let templateSelections = 0
  let randomEventSelections = 0
  let maximumGeneratedQuestInstances = 0
  let maximumRevealedQuestInstances = 0
  let maximumHistoryEntries = 0
  let maximumRecentFingerprints = 0
  let maximumSettledIntervalsInBatch = 0

  for (let batch = 1; batch <= STRESS_BATCH_COUNT; batch += 1) {
    const region = modules.world.regions[(batch - 1) % modules.world.regions.length]
    state.map.currentLocationKey = locationsByRegionKey[region.key]!
    const interval = modules.director.regionRules.find(rule => rule.regionKey === region.key)!.settlementIntervalMinutes
    state.time.worldMinute += interval * (batch % 100 === 0 ? 100 : 1)

    const requests = director.randomRequestsFor({
      state,
      trigger: TRIGGER,
      conditionResults: CONDITION_RESULTS,
    })
    const evidence = await Promise.all(requests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
      seed,
      commandId: `command.g7-stress.${batch}`,
      commandSequence: batch,
      drawIndex,
      request,
    })))
    const authorization = director.resolve({
      state,
      trigger: TRIGGER,
      conditionResults: CONDITION_RESULTS,
      evidence,
    })
    expect(authorization.regionKey).toBe(region.key)
    expect(authorization.worldMinute).toBe(state.time.worldMinute)
    for (const change of authorization.regionChanges) {
      expect(change.settledIntervals).toBeGreaterThan(0)
      expect(change.settledIntervals).toBeLessThanOrEqual(modules.director.rules.maximumSettlementIntervals)
      expect(change.toSettlementWorldMinute).toBeLessThanOrEqual(state.time.worldMinute)
      const rule = modules.director.regionRules.find(candidate => candidate.regionKey === change.regionKey)!
      expect(change.toPressure).toBeGreaterThanOrEqual(rule.minimumPressure)
      expect(change.toPressure).toBeLessThanOrEqual(rule.maximumPressure)
      maximumSettledIntervalsInBatch = Math.max(maximumSettledIntervalsInBatch, change.settledIntervals)
    }
    if (authorization.randomRequests.length) draws += 1
    if (authorization.selection.outcomeKind === 'blank') blankSelections += 1
    if (authorization.selection.outcomeKind === 'template-quest') templateSelections += 1
    if (authorization.selection.outcomeKind === 'random-event') randomEventSelections += 1

    director.applyAuthorization({ state, authorization })
    validateTextOpenWorldEffectStateV1(state, modules)
    expect(protectedQuestSnapshot(modules, state)).toEqual(protectedBefore)
    expect(Object.values(state.quests.instancesByKey).filter(instance => instance.sourceKind === 'release')).toHaveLength(initialReleaseQuestCount)
    assertDirectorBudgets(modules, state)
    assertNoCrossRegionContent(modules, state)

    maximumGeneratedQuestInstances = Math.max(maximumGeneratedQuestInstances, state.director.generatedQuestInstanceCount)
    maximumRevealedQuestInstances = Math.max(maximumRevealedQuestInstances, state.director.revealedQuestInstanceKeys.length)
    maximumHistoryEntries = Math.max(maximumHistoryEntries, state.director.history.length)
    maximumRecentFingerprints = Math.max(maximumRecentFingerprints, state.director.recentFingerprints.length)
  }

  expect(state.director.drawCount).toBe(draws)
  expect(templateSelections).toBeGreaterThan(0)
  expect(randomEventSelections).toBeGreaterThan(0)
  expect(maximumGeneratedQuestInstances).toBeGreaterThan(0)
  expect(maximumSettledIntervalsInBatch).toBe(modules.director.rules.maximumSettlementIntervals)
  expect(protectedQuestSnapshot(modules, state)).toEqual(protectedBefore)
  expect(state.director.history.at(-1)?.drawNumber).toBe(state.director.drawCount)

  return {
    batches: STRESS_BATCH_COUNT,
    draws,
    blankSelections,
    templateSelections,
    randomEventSelections,
    maximumGeneratedQuestInstances,
    maximumRevealedQuestInstances,
    maximumHistoryEntries,
    maximumRecentFingerprints,
    maximumSettledIntervalsInBatch,
    finalStateJson: canonicalProductProductionJsonV2(state),
  }
}

describe('Text Open World G7 · 1,000-batch Director and quest pressure gate', () => {
  it('双地区长时演化与发牌保持容量、地区、主线和历史有界，且固定seed结果可重复', async () => {
    const first = await runDirectorStress('salt-ridge-director-stress-v1')
    const replay = await runDirectorStress('salt-ridge-director-stress-v1')

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      batches: STRESS_BATCH_COUNT,
      maximumRevealedQuestInstances: 3,
      maximumHistoryEntries: 64,
      maximumSettledIntervalsInBatch: 32,
    })
  }, 30_000)
})
