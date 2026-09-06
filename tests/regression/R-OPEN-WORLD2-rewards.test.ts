import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { resolveTextOpenWorldRandomEvidenceV1 } from '../../src/lib/open-world/event-contract'
import { createTextOpenWorldRewardCatalogV1 } from '../../src/lib/open-world/rewards'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatActionsV1,
} from '../helpers/text-open-world-vnext-fixture'

async function evidence(preparation: ReturnType<ReturnType<typeof createTextOpenWorldRewardCatalogV1>['prepare']>) {
  return Promise.all(preparation.randomRequests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
    seed: 'reward-seed', commandId: 'command.reward.1', commandSequence: 1, drawIndex, request,
  })))
}

describe('Text Open World vNext · reward contracts, drops and unique claims', () => {
  it('静态奖励与确定性掉落合并为一个EffectPlan，并只领取一次', async () => {
    const fixture = createTextOpenWorldVNextFixture()
    const rewards = createTextOpenWorldRewardCatalogV1(fixture)
    const preparation = rewards.prepare({ rewardKey: 'reward.ridge-jackal', sourceInstanceKey: 'encounter.ridge-jackal.1' })
    expect(preparation.randomRequests).toHaveLength(2)
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    const resolved = await rewards.resolve({ preparation, evidence: await evidence(preparation), state })
    expect(resolved.effectKeys).toEqual(['effect.reward-experience', expect.stringMatching(/^effect\.drop-salt-[12]$/)])
    expect(resolved.drops).toEqual([expect.objectContaining({ dropTableKey: 'drop.salt-jackal', itemKey: 'item.salt-crystal' })])
    const effects = createTextOpenWorldEffectCatalogV1(fixture)
    const applied = await effects.apply({ plan: resolved.effectPlan, state })
    expect(applied.state.player).toMatchObject({ level: 2, experience: 100 })
    expect(applied.state.inventory.stackQuantities['item.salt-crystal']).toBe(resolved.drops[0].quantity)
    await expect(rewards.resolve({ preparation, evidence: await evidence(preparation), state: applied.state }))
      .rejects.toThrow('claim已应用')
  })

  it('奖励随机证据必须完整对应请求，篡改或缺失时不能决定掉落', async () => {
    const fixture = createTextOpenWorldVNextFixture()
    const rewards = createTextOpenWorldRewardCatalogV1(fixture)
    const preparation = rewards.prepare({ rewardKey: 'reward.ridge-jackal', sourceInstanceKey: 'encounter.ridge-jackal.2' })
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    const valid = await evidence(preparation)
    await expect(rewards.resolve({ preparation, evidence: valid.slice(1), state })).rejects.toThrow('证据数量不一致')
    const tampered = structuredClone(valid)
    tampered[0].drawKey = tampered[1].drawKey
    await expect(rewards.resolve({ preparation, evidence: tampered, state })).rejects.toThrow('证据与请求不一致')
  })

  it('任一奖励越界会使经验、货币和掉落全部不结算', async () => {
    const fixture = createTextOpenWorldVNextFixture()
    const reward = (fixture.modules.items.payload as any).rewardContracts.find((item: any) => item.sourceKind === 'combat')
    reward.effectKeys.push('effect.reward-currency')
    const rewards = createTextOpenWorldRewardCatalogV1(fixture)
    const preparation = rewards.prepare({ rewardKey: reward.key, sourceInstanceKey: 'encounter.atomic.1' })
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state.inventory.stackQuantities['item.salt-crystal'] = 999
    const before = structuredClone(state)
    await expect(rewards.resolve({ preparation, evidence: await evidence(preparation), state })).rejects.toThrow('物品堆叠数量无效')
    expect(state).toEqual(before)
  })

  it('经验、货币、物品、技能、配方、道德、阵营与解锁可原子结算', async () => {
    const fixture = downgradeTextOpenWorldFixtureCombatActionsV1(createTextOpenWorldVNextFixture())
    const actions = fixture.modules.actions.payload as any
    const progression = fixture.modules.progression.payload as any
    const quests = fixture.modules.quests.payload as any
    const crafting = fixture.modules.crafting.payload as any
    actions.effects.push(
      { key: 'effect.reward-seal', operation: 'grant-item', payload: { itemKey: 'item.canal-seal', quantity: 1 } },
      { key: 'effect.reward-morality', operation: 'change-morality', payload: { amount: 5 } },
      { key: 'effect.reward-affinity', operation: 'change-faction-affinity', payload: { factionKey: 'faction.canal-keepers', amount: 10 } },
      { key: 'effect.reward-reveal-ridge', operation: 'reveal-location', payload: { locationKey: 'location.ridge-channel' } },
      { key: 'effect.reward-fast-ridge', operation: 'unlock-fast-travel', payload: { fastTravelPointKey: 'fast-travel.ridge' } },
      { key: 'effect.reward-learn-channel', operation: 'learn-skill', payload: { skillKey: 'skill.channel-listening' } },
      { key: 'effect.reward-learn-recipe', operation: 'learn-recipe', payload: { recipeKey: 'recipe.salt-poultice' } },
    )
    progression.skills.push({
      key: 'skill.channel-listening', title: '听渠', description: '从水流中辨认线索。', tags: ['调查'],
      activation: 'active', kind: 'status', target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.template.supplies' }], useConditionKeys: [], priority: 40,
      resourceCost: 1, cooldownTurns: 0, effectKeys: [],
    })
    quests.quests.find((quest: any) => quest.key === 'quest.template.supplies').rewardEffectKeys.push('effect.reward-learn-channel')
    ;(fixture.modules.items.payload as any).rewardContracts.find((reward: any) => reward.key === 'reward.quest-supplies').effectKeys.push('effect.reward-learn-channel')
    crafting.recipes.push({
      key: 'recipe.salt-poultice', title: '盐敷剂', description: '以盐晶制作的外敷剂。', learnedByDefault: false,
      stationLocationKeys: ['location.salt-port'], ingredients: [{ itemKey: 'item.salt-crystal', quantity: 1 }],
      outputs: [{ itemKey: 'item.brine-tonic', quantity: 1 }], timeCostMinutes: 15,
    })
    ;(fixture.modules.items.payload as any).rewardContracts.push({
      key: 'reward.milestone', title: '里程碑综合奖励', sourceKind: 'system', claimPolicy: 'once-per-source',
      expectedMinutes: 60, budgetClass: 'major', conditionKeys: [], dropTableKeys: [],
      effectKeys: [
        'effect.reward-experience', 'effect.reward-currency', 'effect.reward-seal', 'effect.reward-learn-channel',
        'effect.reward-learn-recipe', 'effect.reward-morality', 'effect.reward-affinity', 'effect.reward-reveal-ridge',
        'effect.reward-fast-ridge', 'effect.earn-first-clue',
      ],
    })
    const rewards = createTextOpenWorldRewardCatalogV1(fixture)
    const preparation = rewards.prepare({ rewardKey: 'reward.milestone', sourceInstanceKey: 'quest.main.1' })
    const state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    const resolved = await rewards.resolve({ preparation, evidence: [], state })
    const applied = await createTextOpenWorldEffectCatalogV1(fixture).apply({ plan: resolved.effectPlan, state })
    expect(applied.state).toMatchObject({
      player: { level: 2, experience: 100, learnedSkillKeys: expect.arrayContaining(['skill.channel-listening']) },
      inventory: { currency: 30, knownRecipeKeys: expect.arrayContaining(['recipe.salt-poultice']) },
      relationships: { morality: 5, factionAffinityByKey: { 'faction.canal-keepers': 10 } },
      map: { revealedLocationKeys: expect.arrayContaining(['location.ridge-channel']), unlockedFastTravelPointKeys: expect.arrayContaining(['fast-travel.ridge']) },
      knowledge: { earnedAchievementKeys: ['achievement.first-clue'] },
    })
    expect(Object.values(applied.state.inventory.itemInstances).filter(instance => instance.itemKey === 'item.canal-seal')).toHaveLength(1)
  })

  it('唯一物品重复奖励、未满足条件和非法奖励Effect均失败关闭', async () => {
    const duplicate = createTextOpenWorldVNextFixture()
    ;(duplicate.modules.actions.payload as any).effects.push({ key: 'effect.reward-seal', operation: 'grant-item', payload: { itemKey: 'item.canal-seal', quantity: 1 } })
    ;(duplicate.modules.items.payload as any).rewardContracts.push({
      key: 'reward.seal', title: '守渠印奖励', sourceKind: 'system', claimPolicy: 'once-per-source', expectedMinutes: 10,
      budgetClass: 'standard', conditionKeys: [], effectKeys: ['effect.reward-seal'], dropTableKeys: [],
    })
    const rewards = createTextOpenWorldRewardCatalogV1(duplicate)
    const preparation = rewards.prepare({ rewardKey: 'reward.seal', sourceInstanceKey: 'quest.seal.2' })
    const state = createInitialTextOpenWorldSessionProjectionV1(duplicate).state
    state.inventory.itemInstances['instance.existing-seal'] = { itemKey: 'item.canal-seal', acquiredByClaimKey: 'initial-build', stateTags: [] }
    await expect(rewards.resolve({ preparation, evidence: [], state })).rejects.toThrow('重复授予唯一物品')

    const conditioned = createTextOpenWorldVNextFixture()
    ;(conditioned.modules.items.payload as any).rewardContracts.find((reward: any) => reward.key === 'reward.ridge-jackal').conditionKeys = ['condition.always']
    expect(() => createTextOpenWorldRewardCatalogV1(conditioned).prepare({ rewardKey: 'reward.ridge-jackal', sourceInstanceKey: 'encounter.condition.1' }))
      .toThrow('条件未满足')

    const illegal = createTextOpenWorldVNextFixture()
    ;(illegal.modules.items.payload as any).rewardContracts.find((reward: any) => reward.key === 'reward.ridge-jackal').effectKeys = ['effect.consume-brine-tonic']
    expect(() => createTextOpenWorldRewardCatalogV1(illegal)).toThrow('非奖励Effect')

    const mismatchedDrop = createTextOpenWorldVNextFixture()
    ;(mismatchedDrop.modules.items.payload as any).dropTables[0].entries[0].quantityEffects[0].effectKey = 'effect.reward-currency'
    expect(() => createTextOpenWorldRewardCatalogV1(mismatchedDrop)).toThrow('必须是grant-item')
  })
})
