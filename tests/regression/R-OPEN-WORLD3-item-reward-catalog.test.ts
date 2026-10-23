import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import type { TextOpenWorldCraftingEconomyCatalogV1, TextOpenWorldItemRewardCatalogV1 } from '../../src/lib/types'
import {
  assertTextOpenWorldItemSourceClosureV1,
  buildTextOpenWorldItemSourceChoicesV1,
  compileTextOpenWorldItemSourcePlansV1,
  hasTextOpenWorldExplicitItemSourcesV1,
  packTextOpenWorldItemSourceChoicesV1,
  unpackTextOpenWorldItemSourceChoicesV1,
  packTextOpenWorldRewardDemandsV1,
  unpackTextOpenWorldRewardDemandsV1,
  type TextOpenWorldItemSourceChoiceV1,
} from '../../src/lib/open-world/item-source-production'

describe('R-OPEN-WORLD3 · ItemRewardCatalog生产契约', () => {
  it('登记唯一Context、Skill写目标与任务/成长/遭遇闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8.catalog.items-rewards')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.item-reward-catalog.v1',
      inputArtifactKeys: [
        'text-open-world.gameplay-ruleset-skeleton',
        'text-open-world.player-build',
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
        'text-open-world.progression-catalogs',
        'text-open-world.enemy-encounter-catalog',
      ],
      outputArtifactKeys: ['text-open-world.item-reward-catalog'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.item-reward-catalog-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-item-reward-catalog'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.item-reward-catalog-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})

describe('R-OPEN-WORLD3 · 明确物品来源履约', () => {
  it('奖励表只去除重复列名，语义、引用、强制物品和技能全部保留', () => {
    const rewards = Array.from({ length: 46 }, (_, index) => ({
      demandNumber: index + 1, sourceDemandKey: `quest-reward.${index}`, sourceKind: 'quest' as const,
      sourceSemanticKey: `quest.${index}`, title: `奖励${index}`, semanticBrief: '完成该任务并保留后续可玩来源。',
      expectedMinutes: 15, requirementKeys: [`requirement.${index}`], mandatoryItemDemandNumbers: [1, 2], mandatorySkillKeys: ['skill.one'],
    }))
    const original = JSON.stringify(rewards)
    const packed = packTextOpenWorldRewardDemandsV1(rewards)
    expect(unpackTextOpenWorldRewardDemandsV1(packed)).toEqual(rewards)
    expect(estimateTokens(JSON.stringify(packed))).toBeLessThan(estimateTokens(original) * 0.6)
    expect(JSON.stringify(rewards)).toBe(original)
    const missingLast = structuredClone(packed)
    missingLast.rows[0]!.pop()
    expect(() => unpackTextOpenWorldRewardDemandsV1(missingLast)).toThrow(/表行无效/)
  })

  it('完整大目录的来源表无损去重，保留全部来源和资格且拒绝破损引用', () => {
    const numbers = Array.from({ length: 33 }, (_, index) => index + 1)
    const choices: TextOpenWorldItemSourceChoiceV1[] = Array.from({ length: 80 }, (_, index) => ({
      choiceNumber: index + 1, kind: index < 46 ? 'reward' : 'drop',
      sourceKey: `source.${index + 1}`, title: `来源${index + 1}`,
      eligibleItemDemandNumbers: numbers.slice(index % 4), requiredItemDemandNumbers: index < 46 ? [] : [33],
    }))
    const original = JSON.stringify(choices)
    const packed = packTextOpenWorldItemSourceChoicesV1(choices)
    expect(packed.rows).toHaveLength(80)
    expect(unpackTextOpenWorldItemSourceChoicesV1(packed)).toEqual(choices)
    expect(estimateTokens(JSON.stringify(packed))).toBeLessThan(estimateTokens(original) / 2)
    expect(JSON.stringify(choices)).toBe(original)
    expect(unpackTextOpenWorldItemSourceChoicesV1(choices)).toEqual(choices)
    const malformed = structuredClone(packed)
    malformed.rows[0]![4] = packed.demandNumberSets.length + 1
    expect(() => unpackTextOpenWorldItemSourceChoicesV1(malformed)).toThrow(/集合引用越界/)
    malformed.rows[0]![4] = 0
    expect(() => unpackTextOpenWorldItemSourceChoicesV1(malformed)).toThrow(/集合引用越界/)
    const missingColumn = structuredClone(packed)
    Object.assign(missingColumn, { columns: packed.columns.slice(1) })
    expect(() => unpackTextOpenWorldItemSourceChoicesV1(missingColumn)).toThrow(/格式无效/)
    const duplicate = structuredClone(packed)
    duplicate.rows[1]![0] = 1
    expect(() => unpackTextOpenWorldItemSourceChoicesV1(duplicate)).toThrow(/表行无效/)
  })

  function catalogWithDeferredSources(): TextOpenWorldItemRewardCatalogV1 {
    // This unit fixture represents the producer boundary; full Context/hash,
    // model candidate and runtime compilation are covered by experience-design.
    return {
      itemSourceContract: 'explicit-producers-v1',
      items: [
        { key: 'salt', order: 1, kind: 'material', critical: false },
        { key: 'pump', order: 2, kind: 'misc', critical: false },
        { key: 'record', order: 3, kind: 'quest', critical: true },
        { key: 'parcel', order: 4, kind: 'misc', critical: false },
        { key: 'potion', order: 5, kind: 'consumable', critical: false },
      ],
      itemSourcePlans: [
        { itemKey: 'salt', sources: [{ kind: 'vendor', sourceKey: 'vendor.salt' }] },
        { itemKey: 'pump', sources: [{ kind: 'craft', sourceKey: 'recipe.pump' }] },
        { itemKey: 'record', sources: [{ kind: 'acquisition', sourceKey: 'objective.record' }] },
        { itemKey: 'parcel', sources: [{ kind: 'acquisition', sourceKey: 'objective.pickup' }] },
        { itemKey: 'potion', sources: [{ kind: 'initial', sourceKey: 'potion' }] },
      ],
      coverage: { coveredPlayerItemKeys: ['potion'] }, rewardContracts: [], dropTables: [],
    } as unknown as TextOpenWorldItemRewardCatalogV1
  }
  function economy(): TextOpenWorldCraftingEconomyCatalogV1 {
    return {
      recipes: [{ sourceDemandKey: 'recipe.pump', outputs: [{ itemKey: 'pump' }] }],
      vendors: [{ sourceDemandKey: 'vendor.salt', inventoryEntries: [{ itemKey: 'salt' }] }],
    } as unknown as TextOpenWorldCraftingEconomyCatalogV1
  }
  const acquisitions = [
    { itemKey: 'record', objectiveKey: 'objective.record' },
    { itemKey: 'parcel', objectiveKey: 'objective.pickup' },
  ]

  it('消费需求不自动成为本任务或后续任务奖励，未安排任务的地区仍有来源候选', () => {
    const context = {
      itemDemands: [{ demandNumber: 1, demandKind: 'content-requirement', criticality: 'protected', plannedKind: 'quest', requirementKey: 'req.record' }],
      rewardDemands: ['before', 'consumer', 'after', 'repeatable'].map(key => ({ sourceKind: 'quest', sourceSemanticKey: key, sourceDemandKey: `reward.${key}`, title: key })),
      questSkeletons: {
        quests: ['before', 'consumer', 'after', 'repeatable'].map((key, order) => ({ key, order, type: 'mainline', regionKeys: ['r1'], lifecyclePlan: { repeatable: key === 'repeatable' } })),
        objectives: [{ key: 'objective.record', questKey: 'consumer', playerIntent: 'collect', title: '取得原始记录' }],
      },
      contentRequirementManifest: { requirements: [{ key: 'req.record', consumerRefs: [{ kind: 'quest-objective', consumerKey: 'objective.record' }] }] },
      enemyEncounterCatalog: { enemies: [], coverage: { requiredRegionKeys: ['r1', 'r2'] } },
    } as unknown as Parameters<typeof buildTextOpenWorldItemSourceChoicesV1>[0]
    const choices = buildTextOpenWorldItemSourceChoicesV1(context)
    expect(choices.filter(choice => choice.kind === 'reward' && choice.eligibleItemDemandNumbers.includes(1))
      .map(choice => choice.sourceKey)).toEqual(['reward.before'])
    expect(choices.find(choice => choice.kind === 'acquisition')).toMatchObject({ sourceKey: 'objective.record', eligibleItemDemandNumbers: [1] })
    expect(choices.filter(choice => choice.kind === 'vendor').map(choice => choice.sourceKey)).toEqual(['region-vendor.r1', 'region-vendor.r2'])
  })

  it('六种材料可明确由同一商店供应，五种奖励必须拒绝而非静默截断', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ key: `material.${index}`, order: index + 1 })) as TextOpenWorldItemRewardCatalogV1['items']
    const choices: TextOpenWorldItemSourceChoiceV1[] = [
      { choiceNumber: 1, kind: 'vendor', sourceKey: 'vendor.materials', title: '材料铺', eligibleItemDemandNumbers: [1, 2, 3, 4, 5, 6], requiredItemDemandNumbers: [] },
      { choiceNumber: 2, kind: 'reward', sourceKey: 'reward.prior', title: '前置奖励', eligibleItemDemandNumbers: [1, 2, 3, 4, 5, 6], requiredItemDemandNumbers: [] },
    ]
    expect(compileTextOpenWorldItemSourcePlansV1({ items, choices, selections: items.map(() => [1]) })).toHaveLength(6)
    expect(() => compileTextOpenWorldItemSourcePlansV1({ items, choices, selections: items.map((_, index) => index < 5 ? [1, 2] : [1]) }))
      .toThrow(/奖励最多4种物品/)
    expect(() => compileTextOpenWorldItemSourcePlansV1({ items, choices, selections: items.map((_, index) => index ? [1] : []) })).toThrow(/缺来源/)
    expect(() => compileTextOpenWorldItemSourcePlansV1({ items, choices, selections: items.map(() => [999]) })).toThrow(/越界/)
    expect(() => compileTextOpenWorldItemSourcePlansV1({ items, choices, selections: items.map(() => [1, 1]) })).toThrow(/唯一/)
  })

  it('制作、商店和领取各自兑现；制作专属组件及普通送件不会被补发', () => {
    const catalog = catalogWithDeferredSources()
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog })).not.toThrow()
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog, economy: economy() })).not.toThrow()
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog, economy: economy(), acquisitions })).not.toThrow()
    const extraStock = economy()
    extraStock.vendors[0]!.inventoryEntries.push({ itemKey: 'pump' } as typeof extraStock.vendors[number]['inventoryEntries'][number])
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog, economy: extraStock })).toThrow(/不闭合/)
    const missingRecipe = economy()
    missingRecipe.recipes = []
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog, economy: missingRecipe })).toThrow(/不闭合/)
    catalog.rewardContracts.push({ sourceDemandKey: 'reward.delivery', grants: { items: [{ itemKey: 'parcel' }] } } as typeof catalog.rewardContracts[number])
    expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog })).toThrow(/不闭合/)
  })

  it('来源计划不冒充已落地领取；缺失、错目标和重复领取不能通过最终签收', () => {
    const catalog = catalogWithDeferredSources()
    for (const picks of [[], acquisitions.slice(0, 1), [...acquisitions, acquisitions[0]!],
      acquisitions.map(pick => ({ ...pick, objectiveKey: 'objective.delivery' }))]) {
      expect(() => assertTextOpenWorldItemSourceClosureV1({ catalog, economy: economy(), acquisitions: picks })).toThrow(/不闭合/)
    }
    catalog.itemSourcePlans![2]!.sources = [{ kind: 'vendor', sourceKey: 'vendor.salt' }]
    expect(() => hasTextOpenWorldExplicitItemSourcesV1(catalog)).toThrow(/关键物品/)
  })

  it('旧目录仍由旧校验器处理，但半份或未知新合同不能退回旧模式', () => {
    const catalog = catalogWithDeferredSources()
    delete catalog.itemSourceContract
    expect(() => hasTextOpenWorldExplicitItemSourcesV1(catalog)).toThrow(/版本不匹配/)
    delete catalog.itemSourcePlans
    expect(hasTextOpenWorldExplicitItemSourcesV1(catalog)).toBe(false)
    const bytes = JSON.stringify(catalog)
    assertTextOpenWorldItemSourceClosureV1({ catalog, economy: economy(), acquisitions: [] })
    expect(JSON.stringify(catalog)).toBe(bytes)
  })
})
