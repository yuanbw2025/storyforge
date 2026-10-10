import { describe, expect, it } from 'vitest'
import type { ProductProductionBriefV3 } from '../../src/lib/types'
import type { TextAdventureQuestPlanArtifactV1 } from '../../src/lib/adventure/production-artifacts-v2'
import type { TextAdventureSystemsArtifactV1 } from '../../src/lib/adventure/production-artifacts'
import {
  compileTextAdventureResourceCostsV3,
  parseTextAdventureQuestScriptArtifact,
  type TextAdventureQuestScriptArtifactV3,
} from '../../src/lib/adventure/quest-settlement'
import { adventureRequirementSatisfied, applyAdventureEffects, createInitialAdventureState } from '../../src/lib/adventure/runtime'
import { createTextAdventureFoundationContentV2 } from '../helpers/text-adventure-v2-foundation'

function fixture() {
  const content = createTextAdventureFoundationContentV2()
  const value: TextAdventureQuestScriptArtifactV3 = {
    schema: 'storyforge.text-adventure-quest-script-artifact', version: 3,
    mainObjectiveScripts: [{
      objectiveKey: 'objective.records', sceneKey: 'scene.001',
      itemBinding: { kind: 'quest', title: '铜钟刻线拓片', description: '在钟座现场取得的刻线拓片；原调音钥匙仍留在玩家手中。' },
      alternatives: [{
        alternativeKey: 'route.give', recipientCharacterKey: 'character.keeper',
        resolution: { mode: 'check', abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
        timeCostMinutes: 5,
        resourceCosts: {
          success: [{ resourceKey: 'resource.mana', amount: 1 }],
          costlySuccess: [{ resourceKey: 'resource.mana', amount: 1 }, { resourceKey: 'resource.health', amount: 1 }],
          failure: [{ resourceKey: 'resource.mana', amount: 2 }],
        },
        successText: '你交付拓片并确认钟座记录。',
        costlySuccessText: '你交付拓片并确认钟座记录，擦伤的手还在流血。',
        failureForwardText: '拓片破损，但守钟人仍从残留刻线确认钟座记录。',
      }],
    }], sideQuestScripts: [], ambientEventScripts: [],
  }
  const mainQuestPlan: TextAdventureQuestPlanArtifactV1 = {
    schema: 'storyforge.text-adventure-quest-plan-artifact', version: 1, bundleKind: 'main',
    quests: [{
      key: 'quest.main', title: '钟座记录', description: '恢复钟座记录。', characterKeys: ['character.keeper'],
      stages: [{ key: 'stage.1', title: '钟座', objectiveKeys: ['objective.records'] }],
      objectives: [{
        key: 'objective.records', stageKey: 'stage.1', title: '确认钟座记录', narrativePurpose: '确认钟座记录。',
        sceneKeys: ['scene.001'], locationOrdinal: 1,
        alternatives: [{ key: 'route.give', actionKind: 'give', targetCharacterKey: null,
          cost: '交付铜钟拓片，消耗法力。', successConsequence: '确认钟座记录。', failureForwardConsequence: '仍能确认钟座记录。', persistentEffectKeys: ['flag.records'] }],
      }],
    }],
  }
  const input = {
    value,
    brief: { intent: { productType: 'text-adventure' }, source: { selection: { resourceKeys: ['artifact:bell'] } } } as ProductProductionBriefV3,
    systems: { abilities: content.abilities, resources: content.resources, starterEquipment: [{ key: 'item.key' }] } as TextAdventureSystemsArtifactV1,
    mainQuestPlan,
    sideQuests: { schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'side' as const, entries: [] },
    ambientEvents: { schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'ambient' as const, entries: [] },
    locationTitles: ['钟座'], recipientKeysByScene: { 'scene.001': ['character.keeper'] },
  }
  return { input, value, content }
}

describe('R-TEXTADV · explicit quest settlement V3', () => {
  it('keeps V2 exact and refuses to silently assign V3 costs to an old artifact', () => {
    const { input, value } = fixture()
    const legacy = { ...value, version: 2, mainObjectiveScripts: value.mainObjectiveScripts.map(({ itemBinding: _item, alternatives, ...objective }) => ({
      ...objective, alternatives: alternatives.map(({ resourceCosts: _costs, recipientCharacterKey: _recipient, ...alternative }) => alternative),
    })) }
    expect(parseTextAdventureQuestScriptArtifact({ ...input, value: legacy })).toEqual(legacy)
    expect(() => parseTextAdventureQuestScriptArtifact({ ...input, value: { ...value, version: 2 } })).toThrow('字段不精确')
    expect(parseTextAdventureQuestScriptArtifact(input)).toEqual(value)
  })

  it.each([
    ['unknown resource', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success[0].resourceKey = 'resource.invented' }],
    ['progression resource', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success[0].resourceKey = 'resource.experience' }],
    ['negative cost', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success[0].amount = -1 }],
    ['fractional cost', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success[0].amount = 0.5 }],
    ['duplicate cost', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success.push({ resourceKey: 'resource.mana', amount: 1 }) }],
    ['cost above resource capacity', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].resourceCosts.success[0].amount = 999 }],
    ['missing item', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].itemBinding = null }],
    ['unknown starter item', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].itemBinding = { kind: 'starter', itemKey: 'missing' } }],
    ['unselected world item', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].itemBinding = { kind: 'world', resourceKey: 'artifact:other-world' } }],
    ['recipient from another scene', (value: TextAdventureQuestScriptArtifactV3) => { value.mainObjectiveScripts[0].alternatives[0].recipientCharacterKey = 'character.offstage' }],
    ['arbitrary effect', (value: TextAdventureQuestScriptArtifactV3) => { Object.assign(value.mainObjectiveScripts[0].alternatives[0], { effects: [{ op: 'gain-item' }] }) }],
  ] as const)('fails closed: %s', (_label, mutate) => {
    const { input, value } = fixture()
    mutate(value)
    expect(() => parseTextAdventureQuestScriptArtifact(input)).toThrow()
  })

  it('reserves the worst outcome and settles only the selected outcome without mutating prior state', () => {
    const { input, content } = fixture()
    const parsed = parseTextAdventureQuestScriptArtifact(input) as TextAdventureQuestScriptArtifactV3
    const costs = compileTextAdventureResourceCostsV3(parsed.mainObjectiveScripts[0].alternatives[0].resourceCosts,
      new Map(content.resources.map(resource => [resource.key, resource.minimum])))
    const state = createInitialAdventureState(content, 'a'.repeat(64))
    state.resources['resource.mana'] = 2
    const original = structuredClone(state)
    expect(costs.requirements.every(requirement => adventureRequirementSatisfied(requirement, state))).toBe(true)
    const success = applyAdventureEffects(content, state, costs.effects.success, 1)
    expect(success.resources['resource.mana']).toBe(1)
    expect(success.resources['resource.health']).toBe(state.resources['resource.health'])
    const costly = applyAdventureEffects(content, state, costs.effects.costlySuccess, 1)
    expect(costly.resources['resource.mana']).toBe(1)
    expect(costly.resources['resource.health']).toBe(state.resources['resource.health'] - 1)
    expect(applyAdventureEffects(content, state, costs.effects.failure, 1).resources['resource.mana']).toBe(0)
    expect(state).toEqual(original)
    const short = { ...state, resources: { ...state.resources, 'resource.mana': 1 } }
    expect(costs.requirements.every(requirement => adventureRequirementSatisfied(requirement, short))).toBe(false)
    const shortBefore = structuredClone(short)
    expect(() => applyAdventureEffects(content, short, [{ op: 'change-resource', resourceKey: 'resource.health', delta: -1 }, ...costs.effects.failure], 1)).toThrow('资源越界')
    expect(short).toEqual(shortBefore)
  })
})
