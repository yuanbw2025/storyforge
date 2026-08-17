import { describe, expect, it } from 'vitest'
import { createInitialAdventureState } from '../../src/lib/adventure/runtime'
import { createTextOpenWorldAcceptanceBundle } from '../../src/lib/open-world/authoring'
import {
  createInitialOpenWorldState,
  planOpenWorldDraw,
  runOpenWorldBatch,
  validateOpenWorldContent,
} from '../../src/lib/open-world/runtime'

const HASH = 'a'.repeat(64)

function linked(bundle: ReturnType<typeof createTextOpenWorldAcceptanceBundle>) {
  const profiles = bundle.participantKeys.map((participantKey, index) => ({
    participantKey, characterKey: `character:${index}`, name: participantKey, roleLabel: '区域关键人物', voiceRules: '只陈述已知事实。',
    initialKnowledge: [{ key: `profile.${participantKey}`, content: '区域知识', visibility: 'public' as const, importance: 50 }],
    relationshipDimensions: [{ key: 'trust' as const, label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 }], maxMemoryEntries: 24,
  }))
  const scenes = [{ sceneKey: 'regional-conversation', title: '区域交谈', purpose: '发现任务', location: '当前区域', timeLabel: '现在', participantKeys: bundle.participantKeys, publicKnowledgeKeys: bundle.participantKeys.map(key => `profile.${key}`), goals: ['发现线索'], endingConditions: ['玩家结束'], safetyBoundaries: ['不越界'], relationshipRules: [], openingNodeKey: 'entry', endingNodeKey: null, maxTurns: 20, directorBudget: 1, order: 0 }]
  return { profiles, scenes }
}

describe('TEXTWORLD-1 · deterministic regional kernel', () => {
  it('验收内容满足 5 区域、20 NPC、5 组织、30 固定任务、10 模板与主线保护', () => {
    const bundle = createTextOpenWorldAcceptanceBundle()
    const { profiles, scenes } = linked(bundle)
    const report = validateOpenWorldContent({ content: bundle.openWorld, adventure: bundle.adventure, interactionProfiles: profiles, interactionScenes: scenes, simulation: bundle.simulation, narrativeNodeKeys: ['entry', 'ending'] })
    expect(report).toMatchObject({ valid: true, missingReferences: [], unreachableRegionKeys: [], unreachableMainlineQuestKeys: [], taskFloodRegionKeys: [], unboundedPropagationRuleKeys: [] })
    expect(bundle.openWorld.regions).toHaveLength(5)
    expect(bundle.participantKeys).toHaveLength(20)
    expect(bundle.simulation.actors.filter(actor => actor.kind === 'organization')).toHaveLength(5)
    expect(bundle.openWorld.fixedTaskCards).toHaveLength(30)
    expect(bundle.openWorld.taskTemplates).toHaveLength(10)
    expect(bundle.openWorld.mainline.questKeys).toHaveLength(5)
  })

  it('相同状态和 seed 产生相同候选证据与任务实例，悬空引用会阻断发布', () => {
    const bundle = createTextOpenWorldAcceptanceBundle()
    const state = createInitialOpenWorldState(bundle.openWorld, HASH)
    const adventure = createInitialAdventureState(bundle.adventure, HASH)
    const left = planOpenWorldDraw({ content: bundle.openWorld, simulation: bundle.simulation, state, adventure, trigger: 'observe', seed: 'same-seed', startingSequence: 0 })
    const right = planOpenWorldDraw({ content: bundle.openWorld, simulation: bundle.simulation, state, adventure, trigger: 'observe', seed: 'same-seed', startingSequence: 0 })
    expect(left.descriptors).toEqual(right.descriptors)
    expect(left.evidence).toEqual(right.evidence)
    const broken = structuredClone(bundle.openWorld)
    broken.travelEdges[0].toRegionKey = 'missing-region'
    const { profiles, scenes } = linked(bundle)
    const report = validateOpenWorldContent({ content: broken, adventure: bundle.adventure, interactionProfiles: profiles, interactionScenes: scenes, simulation: bundle.simulation, narrativeNodeKeys: ['entry', 'ending'] })
    expect(report.valid).toBe(false)
    expect(report.missingReferences).toContain('region:missing-region')
  })

  it('1000 tick 后台演进有界、可复现并正常结束', () => {
    const bundle = createTextOpenWorldAcceptanceBundle()
    const adventure = createInitialAdventureState(bundle.adventure, HASH)
    const left = runOpenWorldBatch({ content: bundle.openWorld, simulation: bundle.simulation, adventure, contentHash: HASH, seed: 'pressure-seed', ticks: 1_000 })
    const right = runOpenWorldBatch({ content: bundle.openWorld, simulation: bundle.simulation, adventure, contentHash: HASH, seed: 'pressure-seed', ticks: 1_000 })
    expect(left.state).toEqual(right.state)
    expect(left.state).toMatchObject({ tick: 1_000, ended: true })
    expect(left.state.remoteActionHistory.length).toBeLessThanOrEqual(128)
    expect(left.state.propagationHistory.length).toBeLessThanOrEqual(128)
    expect(left.state.regionalProjections.every(region => Object.values(region.issuePressures).every(value => value >= 0 && value <= 100))).toBe(true)
  })
})
