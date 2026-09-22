import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldDirectorDecksV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldSceneScriptsV1,
} from '../types'

type KnowledgeProductionModeV1 = 'legacy' | 'governed-v18'

function fail(message: string): never {
  throw new Error(`[text-open-world-knowledge-production] ${message}`)
}

function same(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function sameKeys(left: string[], right: string[]): boolean {
  return same([...left].sort(), [...right].sort())
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label}存在重复稳定键`)
}

function contiguousOrders(values: Array<{ order: number }>, label: string): void {
  if (values.some((value, index) => value.order !== index + 1)) {
    fail(`${label}必须按连续order排序`)
  }
}

function validateUniqueEffectExecutionOwner(input: {
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  ownerKind: 'reward-contract' | 'action'
  ownerKey: string
  effectKey: string
  label: string
}): void {
  const references: Array<{ kind: 'action-cost' | 'action-success' | 'action-failure' | 'reward-contract' | 'director-event'; ownerKey: string }> = []
  for (const action of input.quests.actions) {
    ;(action.costEffectKeys ?? []).forEach(effectKey => {
      if (effectKey === input.effectKey) references.push({ kind: 'action-cost', ownerKey: action.key })
    })
    ;(action.successEffectKeys ?? []).forEach(effectKey => {
      if (effectKey === input.effectKey) references.push({ kind: 'action-success', ownerKey: action.key })
    })
    ;(action.failureEffectKeys ?? []).forEach(effectKey => {
      if (effectKey === input.effectKey) references.push({ kind: 'action-failure', ownerKey: action.key })
    })
  }
  for (const reward of input.quests.catalogBindings.rewards) {
    reward.effectKeys.forEach(effectKey => {
      if (effectKey === input.effectKey) {
        references.push({ kind: 'reward-contract', ownerKey: reward.rewardContractKey })
      }
    })
  }
  for (const event of input.director.randomEvents) {
    event.effectKeys.forEach(effectKey => {
      if (effectKey === input.effectKey) references.push({ kind: 'director-event', ownerKey: event.key })
    })
  }
  const expected = input.ownerKind === 'action'
    ? { kind: 'action-success' as const, ownerKey: input.ownerKey }
    : { kind: 'reward-contract' as const, ownerKey: input.ownerKey }
  if (references.length !== 1
    || references[0]!.kind !== expected.kind
    || references[0]!.ownerKey !== expected.ownerKey) {
    fail(`${input.label}没有唯一执行归属:${input.effectKey}`)
  }
}

function validateConfirmationBinding(input: {
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  knowledgeKey: string
  binding: NonNullable<TextOpenWorldQuestDesignDocumentsV1['knowledgeBindings']>[number]['confirmationBindings'][number]
}): void {
  const { quests, director, knowledgeKey, binding } = input
  const sourceAction = quests.actions.find(action => action.key === binding.sourceActionKey)
    ?? fail(`Knowledge确认引用未知Action:${binding.sourceActionKey}`)
  const reveal = quests.effects.find(effect => effect.key === binding.revealEffectKey)
  if (!same(reveal, {
    key: binding.revealEffectKey,
    operation: 'reveal-knowledge',
    payload: { knowledgeKey, visibility: 'known' },
  })) fail(`Knowledge确认Effect无效:${binding.revealEffectKey}`)
  validateUniqueEffectExecutionOwner({
    quests,
    director,
    ownerKind: binding.effectOwnerKind,
    ownerKey: binding.effectOwnerKey,
    effectKey: binding.revealEffectKey,
    label: 'Knowledge确认Effect',
  })
  if (binding.sourceKind === 'quest-reward-claim') {
    const quest = quests.quests.find(item => item.key === binding.sourceKey)
      ?? fail(`Knowledge确认引用未知Quest:${binding.sourceKey}`)
    if (binding.effectOwnerKind !== 'reward-contract'
      || binding.effectOwnerKey !== quest.rewardContractKey
      || binding.sourceActionKey !== quest.claimActionKey
      || !quest.rewardEffectKeys.includes(binding.revealEffectKey)
      || sourceAction.category !== 'claim-reward') {
      fail(`Knowledge任务确认没有绑定RewardContract:${knowledgeKey}`)
    }
  } else if (binding.effectOwnerKind !== 'action'
    || binding.effectOwnerKey !== binding.sourceActionKey
    || !quests.endingBindings.routes.some(route => (
      route.endingKey === binding.sourceKey && route.actionKey === binding.sourceActionKey
    ))) {
    fail(`Knowledge结局确认没有绑定Ending Action:${knowledgeKey}`)
  }
}

function validateAchievementBinding(input: {
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  binding: NonNullable<TextOpenWorldQuestDesignDocumentsV1['achievementBindings']>[number]
}): void {
  const { quests, director, binding } = input
  const earn = quests.effects.find(item => item.key === binding.earnEffectKey)
  if (binding.achievementKey !== `achievement.${binding.sourceKey}`
    || binding.earnEffectKey !== `effect.achievement.${binding.sourceKey}.earn`
    || !same(earn, {
    key: binding.earnEffectKey,
    operation: 'earn-achievement',
    payload: { achievementKey: binding.achievementKey },
  })) fail(`成就Earn Effect无效:${binding.achievementKey}`)

  const sourceAction = quests.actions.find(action => action.key === binding.sourceActionKey)
    ?? fail(`成就引用未知Action:${binding.sourceActionKey}`)
  validateUniqueEffectExecutionOwner({
    quests,
    director,
    ownerKind: binding.effectOwnerKind,
    ownerKey: binding.effectOwnerKey,
    effectKey: binding.earnEffectKey,
    label: '成就Earn Effect',
  })
  if (binding.sourceKind === 'quest-reward-claim') {
    const quest = quests.quests.find(item => item.key === binding.sourceKey)
      ?? fail(`成就引用未知Quest:${binding.sourceKey}`)
    if (binding.effectOwnerKind !== 'reward-contract'
      || binding.effectOwnerKey !== quest.rewardContractKey
      || binding.sourceActionKey !== quest.claimActionKey
      || !quest.rewardEffectKeys.includes(binding.earnEffectKey)
      || sourceAction.category !== 'claim-reward') fail(`任务成就没有绑定RewardContract:${binding.achievementKey}`)
  } else if (binding.effectOwnerKind !== 'action'
    || binding.effectOwnerKey !== binding.sourceActionKey
    || !quests.endingBindings.routes.some(route => (
      route.endingKey === binding.sourceKey && route.actionKey === binding.sourceActionKey
    ))) fail(`结局成就没有绑定Ending Action:${binding.achievementKey}`)
}

/**
 * Verifies the P8F → Director → P9 executable Knowledge graph. It intentionally
 * accepts historical artifacts as one all-legacy set, while rejecting mixed
 * fresh/legacy graphs that could silently reintroduce SourceLedger disclosure.
 */
export function validateTextOpenWorldKnowledgeProductionClosureV1(input: {
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  scenes?: TextOpenWorldSceneScriptsV1
  /** Available during fresh assembly; proves stage gates against their source skeleton. */
  questSkeletons?: TextOpenWorldQuestSkeletonsV1
}): KnowledgeProductionModeV1 {
  const { quests, director, scenes, questSkeletons } = input
  const governed = quests.governance.knowledgeProgressReady === true
  if (!governed) {
    if (quests.knowledgeBindings !== undefined || quests.achievementBindings !== undefined
      || quests.governance.allRumorsHaveUniquePropagationPath !== undefined
      || quests.governance.allKnowledgeHasConfirmationPath !== undefined
      || quests.governance.allAchievementsOneTimeReachable !== undefined
      || director.governance.knowledgeProgressReady !== undefined
      || director.governance.allRumorsHaveUniquePropagationPath !== undefined
      || scenes?.governance.disclosureSafeModelContextV3 !== undefined
      || scenes?.knowledgePresentations !== undefined || scenes?.achievementPresentations !== undefined) {
      fail('Knowledge生产图混用了legacy与governed字段')
    }
    return 'legacy'
  }

  if (quests.governance.allRumorsHaveUniquePropagationPath !== true
    || quests.governance.allKnowledgeHasConfirmationPath !== true
    || quests.governance.allAchievementsOneTimeReachable !== true
    || director.governance.knowledgeProgressReady !== true
    || director.governance.allRumorsHaveUniquePropagationPath !== true) {
    fail('Knowledge生产治理声明不完整')
  }
  const knowledge = quests.knowledgeBindings ?? fail('P8F缺少Knowledge绑定')
  const achievements = quests.achievementBindings ?? fail('P8F缺少成就绑定')
  if (!knowledge.length) fail('受治理Knowledge不能为空')
  if (achievements.length < 3 || achievements.length > 6) fail('首版成就必须有3到6项')
  contiguousOrders(knowledge, 'Knowledge绑定')
  contiguousOrders(achievements, '成就绑定')
  unique(knowledge.map(item => item.sourceRumorKey), 'P7传闻')
  unique(knowledge.map(item => item.knowledgeKey), 'Knowledge')
  unique(knowledge.map(item => item.rumorKey), 'Rumor')
  unique(knowledge.map(item => item.propagationEventKey), 'Knowledge传播事件')
  unique(achievements.map(item => item.achievementKey), '成就')
  unique(achievements.map(item => `${item.sourceKind}:${item.sourceKey}`), '成就来源')
  const revealEffectKeys = knowledge.flatMap(item => item.confirmationBindings.map(binding => binding.revealEffectKey))
  const earnEffectKeys = achievements.map(item => item.earnEffectKey)
  unique(revealEffectKeys, 'Knowledge确认Effect')
  unique(earnEffectKeys, '成就Earn Effect')
  const definedRevealEffectKeys = quests.effects
    .filter(effect => effect.operation === 'reveal-knowledge')
    .map(effect => effect.key)
  const definedEarnEffectKeys = quests.effects
    .filter(effect => effect.operation === 'earn-achievement')
    .map(effect => effect.key)
  if (!sameKeys(definedRevealEffectKeys, revealEffectKeys)
    || !sameKeys(definedEarnEffectKeys, earnEffectKeys)) {
    fail('Knowledge确认或成就Effect定义与受治理绑定不闭合')
  }
  if (!sameKeys(quests.coverage.requiredRumorSeedKeys ?? [], knowledge.map(item => item.sourceRumorKey))
    || !sameKeys(quests.coverage.boundRumorSeedKeys ?? [], knowledge.map(item => item.sourceRumorKey))
    || !sameKeys(quests.coverage.requiredKnowledgeKeys ?? [], knowledge.map(item => item.knowledgeKey))
    || !sameKeys(quests.coverage.confirmableKnowledgeKeys ?? [], knowledge.map(item => item.knowledgeKey))
    || !sameKeys(quests.coverage.requiredAchievementKeys ?? [], achievements.map(item => item.achievementKey))
    || !sameKeys(quests.coverage.earnableAchievementKeys ?? [], achievements.map(item => item.achievementKey))) {
    fail('P8F Knowledge/成就coverage不闭合')
  }
  if (!sameKeys(director.coverage.requiredRumorSeedKeys ?? [], knowledge.map(item => item.sourceRumorKey))
    || !sameKeys(director.coverage.boundRumorSeedKeys ?? [], knowledge.map(item => item.sourceRumorKey))) {
    fail('Director传闻coverage不闭合')
  }

  const conditionKeys = new Set(quests.conditions.map(item => item.key))
  const restAction = quests.actions.find(action => action.key === 'action.rest.standard')
  if (!restAction || restAction.category !== 'rest' || restAction.actorScope !== 'player'
    || restAction.targetScope !== 'none' || restAction.locationKeys.length
    || restAction.requirementConditionKeys.length || restAction.repeatPolicy !== 'repeatable') {
    fail('Knowledge传播缺少可在任意地点执行的编译器休息Action')
  }
  for (const binding of knowledge) {
    const knowledgeSuffix = binding.knowledgeKey.startsWith('knowledge.')
      ? binding.knowledgeKey.slice('knowledge.'.length) : ''
    if (!binding.truthSummary.trim() || !binding.rumorText.trim() || !binding.sourceClaimKeys.length
      || !knowledgeSuffix || binding.rumorKey !== `rumor.${knowledgeSuffix}`
      || binding.propagationEventKey !== `event.director.rumor.${knowledgeSuffix}`
      || binding.propagationConditionKeys[0] !== `condition.knowledge.${knowledgeSuffix}.unread`
      || binding.confirmationBindings.length < 1 || binding.confirmationBindings.length > 3) {
      fail(`Knowledge语义或确认路径无效:${binding.knowledgeKey}`)
    }
    contiguousOrders(binding.confirmationBindings, `Knowledge确认:${binding.knowledgeKey}`)
    unique(binding.confirmationBindings.map(item => item.revealEffectKey), `Knowledge确认Effect:${binding.knowledgeKey}`)
    const event = director.randomEvents.find(item => item.key === binding.propagationEventKey)
      ?? fail(`Knowledge缺少传播事件:${binding.knowledgeKey}`)
    if (event.sourceSeedKey !== binding.sourceRumorKey || event.rumorKey !== binding.rumorKey
      || event.kind !== 'clue' || !same(event.regionKeys, [binding.regionKey])
      || !same(event.locationKeys, [binding.propagationLocationKey])
      || !same(event.conditionKeys, binding.propagationConditionKeys)
      || event.actionKeys.length || event.effectKeys.length || event.upgradeTemplateKey !== null) {
      fail(`Knowledge传播事件不精确:${binding.knowledgeKey}`)
    }
    const propagationDecks = director.decks.filter(deck => (
      deck.randomEventKeys.includes(binding.propagationEventKey)
    ))
    if (propagationDecks.length !== 1
      || propagationDecks[0]!.regionKey !== binding.regionKey) {
      fail(`Knowledge传播事件没有唯一进入对应地区牌组:${binding.knowledgeKey}`)
    }
    if (!propagationDecks[0]!.triggerKinds.includes('rest')) {
      fail(`Knowledge传播地区牌组没有编译器保证可达的rest触发:${binding.knowledgeKey}`)
    }
    if (binding.propagationConditionKeys.some(key => !conditionKeys.has(key))) {
      fail(`Knowledge传播引用未知Condition:${binding.knowledgeKey}`)
    }
    unique(binding.propagationConditionKeys, `Knowledge传播Condition:${binding.knowledgeKey}`)
    const unread = quests.conditions.find(condition => same(condition.expression, {
      op: 'all',
      conditions: [
        { op: 'knowledge-rumor-read', rumorKey: binding.rumorKey, read: false },
        { op: 'not', condition: { op: 'knowledge-visibility', knowledgeKey: binding.knowledgeKey, minimum: 'known' } },
      ],
    }))
    if (!unread || binding.propagationConditionKeys[0] !== unread.key) {
      fail(`Knowledge传播缺少未读门槛:${binding.knowledgeKey}`)
    }
    const gateConditions = binding.propagationConditionKeys.filter(key => key !== unread.key)
    if (binding.minimumRevealGate.kind === 'regional-public') {
      if (binding.minimumRevealGate.stageKey !== null || gateConditions.length) {
        fail(`Knowledge最早揭示门槛没有保真:${binding.knowledgeKey}`)
      }
    } else {
      const stageKey = binding.minimumRevealGate.stageKey
      const gate = quests.conditions.find(item => item.key === gateConditions[0])
      if (stageKey === null || gateConditions.length !== 1
        || gateConditions[0] !== `condition.knowledge.${knowledgeSuffix}.gate`
        || !gate || gate.expression.op !== 'quest-status') {
        fail(`Knowledge最早揭示门槛没有保真:${binding.knowledgeKey}`)
      }
      const gateExpression = gate.expression
      if (!same(gateExpression.statuses, ['completed'])) {
        fail(`Knowledge最早揭示门槛没有保真:${binding.knowledgeKey}`)
      }
      const gateQuest = quests.quests.find(item => item.key === gateExpression.questKey)
      const expectedQuestType = binding.minimumRevealGate.kind === 'mainline-stage-complete'
        ? 'mainline' : 'significant'
      if (gateQuest?.type !== expectedQuestType) {
        fail(`Knowledge阶段门槛引用了错误任务类型:${binding.knowledgeKey}`)
      }
      if (questSkeletons) {
        const expectedSourceKind = binding.minimumRevealGate.kind === 'mainline-stage-complete'
          ? 'mainline-stage' : 'significant-stage'
        const matchingSkeletons = questSkeletons.quests.filter(item => (
          item.source.kind === expectedSourceKind && item.source.sourceKey === stageKey
        ))
        if (matchingSkeletons.length !== 1 || matchingSkeletons[0]!.key !== gateQuest.key) {
          fail(`Knowledge阶段门槛没有绑定唯一来源任务:${binding.knowledgeKey}`)
        }
      }
    }
    binding.confirmationBindings.forEach(confirmation => validateConfirmationBinding({
      quests,
      director,
      knowledgeKey: binding.knowledgeKey,
      binding: confirmation,
    }))
    if (binding.minimumRevealGate.kind === 'significant-stage-complete'
      && binding.confirmationBindings.some(confirmation => confirmation.sourceKind === 'ending-action')) {
      fail(`重要支线阶段Knowledge不能由全局结局提前确认:${binding.knowledgeKey}`)
    }
    if (questSkeletons && binding.minimumRevealGate.kind !== 'regional-public') {
      const expectedSourceKind = binding.minimumRevealGate.kind === 'mainline-stage-complete'
        ? 'mainline-stage' : 'significant-stage'
      const gateSkeleton = questSkeletons.quests.find(item => (
        item.source.kind === expectedSourceKind
        && item.source.sourceKey === binding.minimumRevealGate.stageKey
      )) ?? fail(`Knowledge阶段门槛缺少来源骨架:${binding.knowledgeKey}`)
      for (const confirmation of binding.confirmationBindings) {
        if (confirmation.sourceKind === 'ending-action') {
          // Mainline endings are downstream of every mainline gate. Significant
          // gates were rejected above because ending completion says nothing
          // about that independent thread.
          continue
        }
        const confirmationSkeleton = questSkeletons.quests.find(item => item.key === confirmation.sourceKey)
          ?? fail(`Knowledge确认缺少来源任务骨架:${binding.knowledgeKey}`)
        if (confirmationSkeleton.source.kind !== expectedSourceKind
          || confirmationSkeleton.source.sourceOrder < gateSkeleton.source.sourceOrder
          || (expectedSourceKind === 'significant-stage'
            && confirmationSkeleton.storylineKey !== gateSkeleton.storylineKey)) {
          fail(`Knowledge确认早于或脱离阶段门槛:${binding.knowledgeKey}`)
        }
      }
    }
  }
  const governedDirectorEvents = director.randomEvents.filter(event => event.rumorKey != null)
  if (!sameKeys(governedDirectorEvents.map(event => event.key), knowledge.map(item => item.propagationEventKey))) {
    fail('Director包含额外或缺失的传闻事件')
  }

  achievements.forEach(binding => validateAchievementBinding({ quests, director, binding }))
  const rewardContractOwnerByKey = new Map<string, string>()
  const claimActionOwnerByKey = new Map<string, string>()
  for (const quest of quests.quests) {
    if (quest.rewardContractKey) {
      const priorRewardOwner = rewardContractOwnerByKey.get(quest.rewardContractKey)
      if (priorRewardOwner) {
        fail(`Quest RewardContract不能跨任务共享:${quest.rewardContractKey}:${priorRewardOwner}:${quest.key}`)
      }
      rewardContractOwnerByKey.set(quest.rewardContractKey, quest.key)
    }
    if (quest.claimActionKey) {
      const priorActionOwner = claimActionOwnerByKey.get(quest.claimActionKey)
      if (priorActionOwner) {
        fail(`Quest奖励领取Action不能跨任务共享:${quest.claimActionKey}:${priorActionOwner}:${quest.key}`)
      }
      claimActionOwnerByKey.set(quest.claimActionKey, quest.key)
    }
    const reward = quests.catalogBindings.rewards
      .find(item => item.rewardContractKey === quest.rewardContractKey)
      ?? fail(`Quest缺少RewardContract:${quest.key}`)
    if (!sameKeys(quest.rewardEffectKeys, reward.effectKeys)) {
      fail(`Quest奖励Effect镜像与RewardContract不一致:${quest.key}`)
    }
  }
  if (!achievements.some(item => item.sourceKind === 'quest-reward-claim')
    || !achievements.some(item => item.sourceKind === 'ending-action')) {
    fail('成就必须同时覆盖受保护任务与结局')
  }

  if (scenes) {
    if (scenes.governance.disclosureSafeModelContextV3 !== true
      || scenes.governance.knowledgePresentationsComplete !== true
      || scenes.governance.achievementPresentationsComplete !== true
      || scenes.governance.rumorFactsCopiedFromQuestDesign !== true
      || scenes.governance.sceneKnowledgeRefsAreRuntimeKnowledgeKeys !== true) {
      fail('P9 Knowledge表现治理声明不完整')
    }
    const knowledgePresentations = scenes.knowledgePresentations ?? fail('P9缺少Knowledge表现')
    const achievementPresentations = scenes.achievementPresentations ?? fail('P9缺少成就表现')
    contiguousOrders(knowledgePresentations, 'Knowledge表现')
    contiguousOrders(achievementPresentations, '成就表现')
    unique(knowledgePresentations.map(item => item.knowledgeKey), 'Knowledge表现')
    unique(achievementPresentations.map(item => item.achievementKey), '成就表现')
    if (!sameKeys(scenes.coverage.requiredKnowledgeKeys ?? [], knowledge.map(item => item.knowledgeKey))
      || !sameKeys(scenes.coverage.presentedKnowledgeKeys ?? [], knowledgePresentations.map(item => item.knowledgeKey))
      || !sameKeys(scenes.coverage.requiredAchievementKeys ?? [], achievements.map(item => item.achievementKey))
      || !sameKeys(scenes.coverage.presentedAchievementKeys ?? [], achievementPresentations.map(item => item.achievementKey))) {
      fail('P9 Knowledge/成就表现coverage不闭合')
    }
    knowledgePresentations.forEach((presentation, index) => {
      const binding = knowledge[index]
      if (!binding || presentation.order !== binding.order
        || presentation.knowledgeKey !== binding.knowledgeKey
        || presentation.key !== `presentation.${binding.knowledgeKey}`
        || !presentation.title.trim() || presentation.summary !== binding.truthSummary) {
        fail(`Knowledge表现没有一对一绑定:${presentation.knowledgeKey}`)
      }
    })
    achievementPresentations.forEach((presentation, index) => {
      const binding = achievements[index]
      if (!binding || presentation.order !== binding.order
        || presentation.achievementKey !== binding.achievementKey
        || presentation.key !== `presentation.${binding.achievementKey}`
        || !presentation.title.trim() || !presentation.description.trim()) {
        fail(`成就表现没有一对一绑定:${presentation.achievementKey}`)
      }
    })
    const knowledgeKeys = new Set(knowledge.map(item => item.knowledgeKey))
    if (scenes.scenes.some(scene => scene.allowedKnowledgeClaimKeys.some(key => !knowledgeKeys.has(key)))) {
      fail('受治理Scene仍引用SourceLedger claim而非Runtime Knowledge')
    }
    for (const binding of knowledge) {
      const presentation = scenes.randomEventPresentations
        .find(item => item.randomEventKey === binding.propagationEventKey)
        ?? fail(`P9缺少传闻事件表现:${binding.propagationEventKey}`)
      if (presentation.rumorKey !== binding.rumorKey
        || presentation.rumorText !== binding.rumorText
        || presentation.reliability !== binding.reliability
        || !same(presentation.sourceClaimKeys, binding.sourceClaimKeys)) {
        fail(`P9改写了P8F传闻事实:${binding.rumorKey}`)
      }
    }
  }
  return 'governed-v18'
}
