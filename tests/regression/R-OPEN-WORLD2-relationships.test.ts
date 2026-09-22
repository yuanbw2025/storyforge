import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { projectTextOpenWorldRelationshipsV1 } from '../../src/lib/open-world/relationships'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatV1,
} from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · morality, faction affinity and three-band attitudes', () => {
  it('按阈值稳定派生差、一般、好三档，不保存独立NPC亲密度', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const relationships = runtimePackage.modules.relationships.payload as any
    Object.assign(relationships.attitude, { moralityWeight: 1, factionWeight: 0 })
    Object.assign(runtimePackage.calibration.relationships.attitude, { moralityWeight: 1, factionWeight: 0 })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)

    projection.state.relationships.morality = -25
    expect(projectTextOpenWorldRelationshipsV1({ runtimePackage, state: projection.state }).actors[0]).toMatchObject({
      attitude: 'bad', label: '差', optionalInteractionPolicy: 'available',
    })
    projection.state.relationships.morality = -24
    expect(projectTextOpenWorldRelationshipsV1({ runtimePackage, state: projection.state }).actors[0]).toMatchObject({ attitude: 'neutral', label: '一般' })
    projection.state.relationships.morality = 25
    expect(projectTextOpenWorldRelationshipsV1({ runtimePackage, state: projection.state }).actors[0]).toMatchObject({ attitude: 'good', label: '好' })

    const invalid = structuredClone(projection.state) as any
    invalid.relationships.intimacyByActorKey = { 'actor.caretaker': 100 }
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.reward-currency'], claimKey: 'claim.relationship-no-intimacy', state: invalid,
    })).rejects.toThrow('relationships字段不符合合同')

    const missingFactionState = structuredClone(projection.state)
    missingFactionState.relationships.factionAffinityByKey = {}
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.reward-currency'], claimKey: 'claim.relationship-missing-faction', state: missingFactionState,
    })).rejects.toThrow('factionAffinityByKey必须覆盖全部冻结阵营')
  })

  it('同一道德值可由不同阵营反向解释，问候、可选互动和价格读取同一投影', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as any
    actors.factions.push({ key: 'faction.smugglers', title: '走私客', description: '把守序行为视为威胁。' })
    actors.actors.push({
      key: 'actor.smuggler', tier: 'resident', name: '暗巷商人', biography: '经营灰色交易。', portrayal: '戒备。',
      factionKey: 'faction.smugglers', homeLocationKey: 'location.salt-port', protected: false, mortalityPolicy: 'mortal', serviceKeys: [], scheduleKey: null,
    })
    const relationships = runtimePackage.modules.relationships.payload as any
    relationships.factionMorality.push({ factionKey: 'faction.smugglers', moralityMultiplier: -1 })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.relationships.morality = 100
    const projected = projectTextOpenWorldRelationshipsV1({ runtimePackage, state: projection.state })
    expect(projected.actors.find(actor => actor.actorKey === 'actor.caretaker')).toMatchObject({
      attitude: 'good', greetingTone: '友善且愿意帮助', optionalInteractionPolicy: 'available', buyPriceMultiplier: 0.9, sellPriceMultiplier: 1.1,
    })
    expect(projected.actors.find(actor => actor.actorKey === 'actor.smuggler')).toMatchObject({
      attitude: 'bad', greetingTone: '冷淡而克制', optionalInteractionPolicy: 'may-refuse', buyPriceMultiplier: 1.15, sellPriceMultiplier: 0.85,
    })
    expect(deriveTextOpenWorldContextsV1(projection).condition.relations.attitudeByActorKey).toMatchObject({
      'actor.caretaker': 'good', 'actor.smuggler': 'bad',
    })
  })

  it('故事修正必须来自Release预制定义，并与道德、阵营贡献一起给出可解释结果', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actions = runtimePackage.modules.actions.payload as any
    actions.effects.push({ key: 'effect.apply-caretaker-trust', operation: 'set-story-modifier', payload: { actorKey: 'actor.caretaker', value: 10 } })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: ['effect.apply-caretaker-trust'], claimKey: 'claim.story-trust', state: projection.state })
    const applied = await catalog.apply({ plan, state: projection.state })
    expect(projectTextOpenWorldRelationshipsV1({ runtimePackage, state: applied.state }).actors[0]).toMatchObject({
      score: 10, reasons: { morality: 0, factionAffinity: 0, experiencedStory: 10 },
    })

    const invalid = createTextOpenWorldVNextFixture()
    ;(invalid.modules.actions.payload as any).effects.push({ key: 'effect.unplanned-trust', operation: 'set-story-modifier', payload: { actorKey: 'actor.caretaker', value: 7 } })
    expect(() => parseTextOpenWorldModulesV1(invalid)).toThrow('故事修正Effect必须匹配Release预制修正')
  })

  it('Build要求覆盖每个阵营和三档表现，并拒绝关系条件阻断主线', () => {
    const missingFaction = createTextOpenWorldVNextFixture()
    ;(missingFaction.modules.relationships.payload as any).factionMorality = []
    expect(() => parseTextOpenWorldModulesV1(missingFaction)).toThrow('阵营道德解释覆盖')

    const duplicateBand = createTextOpenWorldVNextFixture()
    ;(duplicateBand.modules.relationships.payload as any).attitudeBands[2].attitude = 'neutral'
    expect(() => parseTextOpenWorldModulesV1(duplicateBand)).toThrow('三档态度定义覆盖')

    const gatedQuest = createTextOpenWorldVNextFixture()
    const gatedActions = gatedQuest.modules.actions.payload as any
    gatedActions.conditions.push({ key: 'condition.caretaker-good', expression: { op: 'relation-attitude', actorKey: 'actor.caretaker', attitude: 'good' }, failureMessage: '关系不足。' })
    ;(gatedQuest.modules.quests.payload as any).quests.find((quest: any) => quest.type === 'mainline').prerequisiteConditionKeys.push('condition.caretaker-good')
    expect(() => parseTextOpenWorldModulesV1(gatedQuest)).toThrow('主线任务不能由道德、阵营或态度条件锁定')

    const gatedObjective = createTextOpenWorldVNextFixture()
    const objectiveActions = gatedObjective.modules.actions.payload as any
    objectiveActions.conditions.push({ key: 'condition.morality-positive', expression: { op: 'player-number', field: 'morality', comparator: 'gte', value: 1 }, failureMessage: '道德不足。' })
    const objectiveActionKeys = (gatedObjective.modules.quests.payload as any).objectives.find((objective: any) => !objective.optional).actionKeys
    objectiveActionKeys.forEach((actionKey: string) => objectiveActions.actions.find((action: any) => action.key === actionKey).requirementConditionKeys.push('condition.morality-positive'))
    expect(() => parseTextOpenWorldModulesV1(gatedObjective)).toThrow('主线必需Objective至少需要一条不受关系数值阻断的Action')
  })

  it('旧Relationship v1可确定性补齐阵营解释和三档表现', () => {
    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureCombatV1(legacy)
    const relationships = legacy.modules.relationships.payload as any
    relationships.version = 1
    legacy.modules.relationships.schemaVersion = 1
    delete relationships.unaffiliatedMoralityMultiplier
    delete relationships.factionMorality
    delete relationships.attitudeBands
    delete relationships.crimeActions
    const actions = legacy.modules.actions.payload as any
    actions.version = 7
    legacy.modules.actions.schemaVersion = 7
    actions.actions = actions.actions.filter((action: any) => !['steal', 'deceive', 'crime'].includes(action.category))
    const crimeEffectKeys = new Set([
      'effect.steal-morality-success', 'effect.steal-morality-failure', 'effect.steal-item', 'effect.steal-witnessed-affinity',
      'effect.deceive-morality-success', 'effect.deceive-morality-failure', 'effect.deceive-witnessed-affinity',
    ])
    actions.effects = actions.effects.filter((effect: any) => !crimeEffectKeys.has(effect.key))
    const parsed = parseTextOpenWorldModulesV1(legacy)
    expect(parsed.relationships).toMatchObject({
      version: 2,
      unaffiliatedMoralityMultiplier: 1,
      factionMorality: [{ factionKey: 'faction.canal-keepers', moralityMultiplier: 1 }],
    })
    expect(parsed.relationships.attitudeBands.map(band => band.attitude)).toEqual(['bad', 'neutral', 'good'])
  })
})
