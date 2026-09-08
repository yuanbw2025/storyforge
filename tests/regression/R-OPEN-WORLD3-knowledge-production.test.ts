import { describe, expect, it } from 'vitest'
import { validateTextOpenWorldKnowledgeProductionClosureV1 } from '../../src/lib/open-world/knowledge-production'
import type {
  TextOpenWorldDirectorDecksV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldSceneScriptsV1,
} from '../../src/lib/types'

function governedKnowledgeGraph() {
  const knowledgeKey = 'knowledge.001'
  const rumorKey = 'rumor.001'
  const knowledgeRevealEffectKey = 'effect.knowledge.001.confirm.001'
  const achievementSources = [
    { sourceKind: 'quest-reward-claim' as const, sourceKey: 'quest.main.001', ownerKey: 'reward.main.001', actionKey: 'action.claim.quest.main.001' },
    { sourceKind: 'quest-reward-claim' as const, sourceKey: 'quest.main.002', ownerKey: 'reward.main.002', actionKey: 'action.claim.quest.main.002' },
    { sourceKind: 'ending-action' as const, sourceKey: 'ending.001', ownerKey: 'action.ending.ending.001', actionKey: 'action.ending.ending.001' },
  ]
  const achievementBindings = achievementSources.map((source, index) => {
    return {
      order: index + 1,
      achievementKey: `achievement.${source.sourceKey}`,
      sourceKind: source.sourceKind,
      sourceKey: source.sourceKey,
      sourceActionKey: source.actionKey,
      effectOwnerKind: source.sourceKind === 'ending-action' ? 'action' as const : 'reward-contract' as const,
      effectOwnerKey: source.ownerKey,
      earnEffectKey: `effect.achievement.${source.sourceKey}.earn`,
    }
  })
  const effects = [
    {
      key: knowledgeRevealEffectKey,
      operation: 'reveal-knowledge' as const,
      payload: { knowledgeKey, visibility: 'known' as const },
    },
    ...achievementBindings.map(binding => ({
      key: binding.earnEffectKey,
      operation: 'earn-achievement' as const,
      payload: { achievementKey: binding.achievementKey },
    })),
  ]
  const conditions = [{
    key: 'condition.knowledge.001.unread',
    expression: {
      op: 'all' as const,
      conditions: [
        { op: 'knowledge-rumor-read' as const, rumorKey, read: false },
        { op: 'not' as const, condition: { op: 'knowledge-visibility' as const, knowledgeKey, minimum: 'known' as const } },
      ],
    },
    failureMessage: '已经听过或确认。',
  }]
  const rewardOneEffectKeys = [
    knowledgeRevealEffectKey,
    achievementBindings[0]!.earnEffectKey,
  ]
  const rewardTwoEffectKeys = [
    achievementBindings[1]!.earnEffectKey,
  ]
  const endingEffectKeys = [
    achievementBindings[2]!.earnEffectKey,
  ]
  const quests = {
    quests: [{
      key: 'quest.main.001', rewardContractKey: 'reward.main.001',
      claimActionKey: 'action.claim.quest.main.001', rewardEffectKeys: rewardOneEffectKeys,
    }, {
      key: 'quest.main.002', rewardContractKey: 'reward.main.002',
      claimActionKey: 'action.claim.quest.main.002', rewardEffectKeys: rewardTwoEffectKeys,
    }],
    conditions,
    effects,
    actions: [{
      key: 'action.claim.quest.main.001', category: 'claim-reward', successEffectKeys: [],
    }, {
      key: 'action.claim.quest.main.002', category: 'claim-reward', successEffectKeys: [],
    }, {
      key: 'action.ending.ending.001', category: 'quest-action', successEffectKeys: endingEffectKeys,
    }, {
      key: 'action.rest.standard', category: 'rest', actorScope: 'player', targetScope: 'none',
      locationKeys: [], requirementConditionKeys: [], repeatPolicy: 'repeatable', successEffectKeys: [],
    }],
    catalogBindings: {
      rewards: [{ rewardContractKey: 'reward.main.001', effectKeys: rewardOneEffectKeys },
        { rewardContractKey: 'reward.main.002', effectKeys: rewardTwoEffectKeys }],
    },
    endingBindings: {
      routes: [{ endingKey: 'ending.001', actionKey: 'action.ending.ending.001' }],
    },
    knowledgeBindings: [{
      order: 1,
      sourceRumorKey: 'rumor-seed.001',
      regionKey: 'region.001',
      propagationLocationKey: 'location.001',
      knowledgeKey,
      kind: 'quest-clue',
      subjectSourceKey: 'quest.main.001',
      subjectDefinitionKey: 'quest.main.001',
      truthSummary: '盐井的回声由旧闸门改变。',
      sourceClaimKeys: ['source.claim.00001'],
      rumorKey,
      rumorText: '有人说旧闸门在夜里会回应。',
      reliability: 'uncertain',
      minimumRevealGate: { kind: 'regional-public', stageKey: null },
      propagationEventKey: 'event.director.rumor.001',
      propagationConditionKeys: ['condition.knowledge.001.unread'],
      confirmationBindings: [{
        order: 1,
        sourceKind: 'quest-reward-claim',
        sourceKey: 'quest.main.001',
        sourceActionKey: 'action.claim.quest.main.001',
        effectOwnerKind: 'reward-contract',
        effectOwnerKey: 'reward.main.001',
        revealEffectKey: knowledgeRevealEffectKey,
      }],
    }],
    achievementBindings,
    coverage: {
      requiredKnowledgeKeys: [knowledgeKey],
      confirmableKnowledgeKeys: [knowledgeKey],
      requiredRumorSeedKeys: ['rumor-seed.001'],
      boundRumorSeedKeys: ['rumor-seed.001'],
      requiredAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
      earnableAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
    },
    governance: {
      allRumorsHaveUniquePropagationPath: true,
      allKnowledgeHasConfirmationPath: true,
      allAchievementsOneTimeReachable: true,
      knowledgeProgressReady: true,
    },
  } as unknown as TextOpenWorldQuestDesignDocumentsV1
  const director = {
    decks: [{
      regionKey: 'region.001',
      fixedQuestKeys: [],
      templateKeys: [],
      randomEventKeys: ['event.director.rumor.001'],
      triggerKinds: ['rest'],
      maximumRevealed: 2,
      maximumActive: 1,
      cooldownMinutes: 60,
      blankWeight: 1,
    }],
    randomEvents: [{
      key: 'event.director.rumor.001', sourceSeedKey: 'rumor-seed.001', kind: 'clue',
      regionKeys: ['region.001'], locationKeys: ['location.001'], actionKeys: [], effectKeys: [],
      conditionKeys: ['condition.knowledge.001.unread'], rumorKey,
      upgradeTemplateKey: null,
    }],
    coverage: {
      requiredRumorSeedKeys: ['rumor-seed.001'],
      boundRumorSeedKeys: ['rumor-seed.001'],
    },
    governance: {
      allRumorsHaveUniquePropagationPath: true,
      knowledgeProgressReady: true,
    },
  } as unknown as TextOpenWorldDirectorDecksV1
  const scenes = {
    scenes: [{ allowedKnowledgeClaimKeys: [knowledgeKey] }],
    randomEventPresentations: [{
      randomEventKey: 'event.director.rumor.001', rumorKey,
      rumorText: '有人说旧闸门在夜里会回应。', reliability: 'uncertain',
      sourceClaimKeys: ['source.claim.00001'],
    }],
    knowledgePresentations: [{
      key: `presentation.${knowledgeKey}`, order: 1, knowledgeKey,
      title: '旧闸门的回声', summary: '盐井的回声由旧闸门改变。',
    }],
    achievementPresentations: achievementBindings.map(binding => ({
      key: `presentation.${binding.achievementKey}`,
      order: binding.order,
      achievementKey: binding.achievementKey,
      title: `成就 ${binding.order}`,
      description: `完成第 ${binding.order} 项故事成果。`,
    })),
    coverage: {
      requiredKnowledgeKeys: [knowledgeKey], presentedKnowledgeKeys: [knowledgeKey],
      requiredAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
      presentedAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
    },
    governance: {
      disclosureSafeModelContextV3: true,
      knowledgePresentationsComplete: true,
      achievementPresentationsComplete: true,
      rumorFactsCopiedFromQuestDesign: true,
      sceneKnowledgeRefsAreRuntimeKnowledgeKeys: true,
    },
  } as unknown as TextOpenWorldSceneScriptsV1
  return { quests, director, scenes }
}

describe('R-OPEN-WORLD3 · Knowledge production closure', () => {
  it('要求P7传闻、P8F传播/确认/成就和P9玩家表现形成同一可运行图', () => {
    const graph = governedKnowledgeGraph()
    expect(validateTextOpenWorldKnowledgeProductionClosureV1(graph)).toBe('governed-v18')
  })

  it('拒绝没有唯一传播、真实确认或一次性获得路径的伪闭环', () => {
    const duplicatedPropagation = governedKnowledgeGraph()
    duplicatedPropagation.director.randomEvents.push(structuredClone(duplicatedPropagation.director.randomEvents[0]!))
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(duplicatedPropagation)).toThrow(/额外或缺失|传播事件/)

    const detachedConfirmation = governedKnowledgeGraph()
    detachedConfirmation.quests.catalogBindings.rewards[0]!.effectKeys = detachedConfirmation.quests.catalogBindings.rewards[0]!.effectKeys
      .filter(key => key !== 'effect.knowledge.001.confirm.001')
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(detachedConfirmation)).toThrow(/确认Effect没有唯一执行归属/)

    const duplicatedAchievementOwner = governedKnowledgeGraph()
    duplicatedAchievementOwner.quests.catalogBindings.rewards[1]!.effectKeys.push('effect.achievement.quest.main.002.earn')
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(duplicatedAchievementOwner)).toThrow(/Earn Effect没有唯一执行归属/)

    const sharedRewardContract = governedKnowledgeGraph()
    const sharedRewardQuest = sharedRewardContract.quests.quests[1]!
    const sharedEarnKey = 'effect.achievement.quest.main.002.earn'
    sharedRewardQuest.rewardContractKey = 'reward.main.001'
    sharedRewardQuest.rewardEffectKeys = [...sharedRewardContract.quests.catalogBindings.rewards[0]!.effectKeys, sharedEarnKey]
    sharedRewardContract.quests.catalogBindings.rewards[0]!.effectKeys.push(sharedEarnKey)
    sharedRewardContract.quests.catalogBindings.rewards[1]!.effectKeys = []
    sharedRewardContract.quests.achievementBindings![1]!.effectOwnerKey = 'reward.main.001'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(sharedRewardContract))
      .toThrow(/RewardContract不能跨任务共享/)

    const sharedClaimAction = governedKnowledgeGraph()
    sharedClaimAction.quests.quests[1]!.claimActionKey = 'action.claim.quest.main.001'
    sharedClaimAction.quests.achievementBindings![1]!.sourceActionKey = 'action.claim.quest.main.001'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(sharedClaimAction))
      .toThrow(/奖励领取Action不能跨任务共享/)

    const directorConfirmsKnowledge = governedKnowledgeGraph()
    directorConfirmsKnowledge.director.randomEvents.push({
      ...structuredClone(directorConfirmsKnowledge.director.randomEvents[0]!),
      key: 'event.director.resource.001',
      sourceSeedKey: 'random-event-seed.001',
      kind: 'resource',
      rumorKey: null,
      effectKeys: ['effect.knowledge.001.confirm.001'],
      conditionKeys: [],
    })
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(directorConfirmsKnowledge))
      .toThrow(/Knowledge确认Effect没有唯一执行归属/)

    const directorEarnsAchievement = governedKnowledgeGraph()
    directorEarnsAchievement.director.randomEvents.push({
      ...structuredClone(directorEarnsAchievement.director.randomEvents[0]!),
      key: 'event.director.resource.001',
      sourceSeedKey: 'random-event-seed.001',
      kind: 'resource',
      rumorKey: null,
      effectKeys: ['effect.achievement.quest.main.002.earn'],
      conditionKeys: [],
    })
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(directorEarnsAchievement))
      .toThrow(/成就Earn Effect没有唯一执行归属/)

    const aliasedKnowledgeEffect = governedKnowledgeGraph()
    aliasedKnowledgeEffect.quests.effects.push({
      key: 'effect.knowledge.001.alias',
      operation: 'reveal-knowledge',
      payload: { knowledgeKey: 'knowledge.001', visibility: 'known' },
    })
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(aliasedKnowledgeEffect))
      .toThrow(/Effect定义与受治理绑定不闭合/)

    const aliasedAchievementEffect = governedKnowledgeGraph()
    aliasedAchievementEffect.quests.effects.push({
      key: 'effect.achievement.quest.main.002.alias',
      operation: 'earn-achievement',
      payload: { achievementKey: 'achievement.quest.main.002' },
    })
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(aliasedAchievementEffect))
      .toThrow(/Effect定义与受治理绑定不闭合/)
  })

  it('要求传播事件唯一进入对应地区且牌组存在真实玩家行动触发', () => {
    const missingDeckBinding = governedKnowledgeGraph()
    missingDeckBinding.director.decks[0]!.randomEventKeys = []
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(missingDeckBinding))
      .toThrow(/没有唯一进入对应地区牌组/)

    const wrongRegionDeck = governedKnowledgeGraph()
    wrongRegionDeck.director.decks[0]!.regionKey = 'region.other'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(wrongRegionDeck))
      .toThrow(/没有唯一进入对应地区牌组/)

    const duplicateDeckBinding = governedKnowledgeGraph()
    duplicateDeckBinding.director.decks.push({
      ...structuredClone(duplicateDeckBinding.director.decks[0]!),
      regionKey: 'region.duplicate',
    })
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(duplicateDeckBinding))
      .toThrow(/没有唯一进入对应地区牌组/)

    const unreachableTrigger = governedKnowledgeGraph()
    unreachableTrigger.director.decks[0]!.triggerKinds = ['time-batch', 'quest-complete']
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(unreachableTrigger))
      .toThrow(/编译器保证可达的rest触发/)
  })

  it('拒绝P9改写传闻事实或把SourceLedger claim当成玩家Knowledge', () => {
    const rewrittenRumor = governedKnowledgeGraph()
    rewrittenRumor.scenes.randomEventPresentations[0]!.rumorText = '模型另写了一条传闻。'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(rewrittenRumor)).toThrow(/改写了P8F传闻事实/)

    const rewrittenTruth = governedKnowledgeGraph()
    rewrittenTruth.scenes.knowledgePresentations[0]!.summary = '模型改写了真相摘要。'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(rewrittenTruth)).toThrow(/Knowledge表现没有一对一绑定/)

    const expandedLocation = governedKnowledgeGraph()
    expandedLocation.director.randomEvents[0]!.locationKeys.push('location.extra')
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(expandedLocation)).toThrow(/传播事件不精确/)

    const leakedClaim = governedKnowledgeGraph()
    leakedClaim.scenes.scenes[0]!.allowedKnowledgeClaimKeys = ['source.claim.00001']
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(leakedClaim)).toThrow(/SourceLedger claim/)
  })

  it('阶段门槛只接受精确completed状态并绑定唯一来源任务', () => {
    const graph = governedKnowledgeGraph()
    const binding = graph.quests.knowledgeBindings![0]!
    binding.minimumRevealGate = { kind: 'mainline-stage-complete', stageKey: 'story-stage.main.001' }
    binding.propagationConditionKeys.push('condition.knowledge.001.gate')
    graph.quests.conditions.push({
      key: 'condition.knowledge.001.gate',
      expression: { op: 'quest-status', questKey: 'quest.main.001', statuses: ['completed'] },
      failureMessage: '主线阶段尚未完成。',
    })
    graph.director.randomEvents[0]!.conditionKeys.push('condition.knowledge.001.gate')
    ;(graph.quests.quests[0] as { type?: string }).type = 'mainline'
    const questSkeletons = {
      quests: [{
        key: 'quest.main.001',
        source: { kind: 'mainline-stage', sourceKey: 'story-stage.main.001', sourceOrder: 1 },
        storylineKey: 'storyline.main',
      }],
    } as unknown as TextOpenWorldQuestSkeletonsV1
    expect(validateTextOpenWorldKnowledgeProductionClosureV1({ ...graph, questSkeletons })).toBe('governed-v18')

    const expandedStatuses = structuredClone(graph)
    const gate = expandedStatuses.quests.conditions.find(item => item.key === 'condition.knowledge.001.gate')!
    if (gate.expression.op === 'quest-status') gate.expression.statuses.push('active')
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1({ ...expandedStatuses, questSkeletons }))
      .toThrow(/最早揭示门槛没有保真/)

    const wrongSource = structuredClone(questSkeletons)
    wrongSource.quests[0]!.source.sourceKey = 'story-stage.main.other'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1({ ...graph, questSkeletons: wrongSource }))
      .toThrow(/没有绑定唯一来源任务/)
  })

  it('重要支线阶段只能由同线且不早于门槛的任务奖励确认，不能借全局结局绕过', () => {
    const graph = governedKnowledgeGraph()
    const binding = graph.quests.knowledgeBindings![0]!
    binding.minimumRevealGate = { kind: 'significant-stage-complete', stageKey: 'story-stage.side.002' }
    binding.propagationConditionKeys.push('condition.knowledge.001.gate')
    graph.quests.conditions.push({
      key: 'condition.knowledge.001.gate',
      expression: { op: 'quest-status', questKey: 'quest.main.001', statuses: ['completed'] },
      failureMessage: '重要支线阶段尚未完成。',
    })
    graph.director.randomEvents[0]!.conditionKeys.push('condition.knowledge.001.gate')
    ;(graph.quests.quests[0] as { type?: string }).type = 'significant'
    ;(graph.quests.quests[1] as { type?: string }).type = 'significant'
    const knowledgeEffectKey = 'effect.knowledge.001.confirm.001'
    const gateQuest = graph.quests.quests[0]!
    const confirmationQuest = graph.quests.quests[1]!
    const gateReward = graph.quests.catalogBindings.rewards[0]!
    const confirmationReward = graph.quests.catalogBindings.rewards[1]!
    gateQuest.rewardEffectKeys = gateQuest.rewardEffectKeys.filter(key => key !== knowledgeEffectKey)
    gateReward.effectKeys = gateReward.effectKeys.filter(key => key !== knowledgeEffectKey)
    confirmationQuest.rewardEffectKeys = [...confirmationQuest.rewardEffectKeys, knowledgeEffectKey]
    confirmationReward.effectKeys = [...confirmationReward.effectKeys, knowledgeEffectKey]
    binding.confirmationBindings = [{
      order: 1,
      sourceKind: 'quest-reward-claim',
      sourceKey: confirmationQuest.key,
      sourceActionKey: confirmationQuest.claimActionKey,
      effectOwnerKind: 'reward-contract',
      effectOwnerKey: confirmationQuest.rewardContractKey,
      revealEffectKey: knowledgeEffectKey,
    }]
    const questSkeletons = {
      quests: [{
        key: 'quest.main.001',
        source: { kind: 'significant-stage', sourceKey: 'story-stage.side.002', sourceOrder: 2 },
        storylineKey: 'storyline.side.001',
      }, {
        key: 'quest.main.002',
        source: { kind: 'significant-stage', sourceKey: 'story-stage.side.003', sourceOrder: 3 },
        storylineKey: 'storyline.side.001',
      }],
    } as unknown as TextOpenWorldQuestSkeletonsV1
    expect(validateTextOpenWorldKnowledgeProductionClosureV1({ ...graph, questSkeletons })).toBe('governed-v18')

    const endingBypass = structuredClone(graph)
    const endingAction = endingBypass.quests.actions.find(action => action.key === 'action.ending.ending.001')!
    const reward = endingBypass.quests.catalogBindings.rewards.find(item => item.rewardContractKey === 'reward.main.002')!
    const quest = endingBypass.quests.quests.find(item => item.key === 'quest.main.002')!
    reward.effectKeys = reward.effectKeys.filter(key => key !== 'effect.knowledge.001.confirm.001')
    quest.rewardEffectKeys = quest.rewardEffectKeys.filter(key => key !== 'effect.knowledge.001.confirm.001')
    endingAction.successEffectKeys.push('effect.knowledge.001.confirm.001')
    endingBypass.quests.knowledgeBindings![0]!.confirmationBindings = [{
      order: 1,
      sourceKind: 'ending-action',
      sourceKey: 'ending.001',
      sourceActionKey: 'action.ending.ending.001',
      effectOwnerKind: 'action',
      effectOwnerKey: 'action.ending.ending.001',
      revealEffectKey: 'effect.knowledge.001.confirm.001',
    }]
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1({ ...endingBypass, questSkeletons }))
      .toThrow(/不能由全局结局提前确认/)

    const earlierOtherThread = structuredClone(graph)
    const earlierSkeletons = structuredClone(questSkeletons)
    earlierSkeletons.quests[1]!.source.sourceOrder = 1
    earlierSkeletons.quests[1]!.storylineKey = 'storyline.side.other'
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1({ ...earlierOtherThread, questSkeletons: earlierSkeletons }))
      .toThrow(/早于或脱离阶段门槛/)
  })

  it('只允许完整legacy图，不接受一半升级的混合产物', () => {
    const graph = governedKnowledgeGraph()
    delete graph.quests.knowledgeBindings
    delete graph.quests.achievementBindings
    graph.quests.governance = {} as TextOpenWorldQuestDesignDocumentsV1['governance']
    graph.quests.coverage = {} as TextOpenWorldQuestDesignDocumentsV1['coverage']
    graph.director.governance = {} as TextOpenWorldDirectorDecksV1['governance']
    graph.director.coverage = {} as TextOpenWorldDirectorDecksV1['coverage']
    expect(validateTextOpenWorldKnowledgeProductionClosureV1({ quests: graph.quests, director: graph.director })).toBe('legacy')

    graph.scenes.knowledgePresentations = []
    expect(() => validateTextOpenWorldKnowledgeProductionClosureV1(graph)).toThrow(/混用了legacy与governed字段/)
  })
})
