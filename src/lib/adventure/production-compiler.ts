import type {
  AdventureActionDefinition,
  AdventureContentV2,
  AdventureEffect,
  FrozenInteractionRuntimeV2,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
} from '../types'
import type { ProductProductionWorldSourceCatalogV2 } from '../product-production/world-source'
import { parseAdventureContent } from './runtime'
import type {
  TextAdventureArchitectureArtifactV1,
  TextAdventureQuestBundleArtifactV2,
  TextAdventureSystemsArtifactV1,
} from './production-artifacts'
import type {
  TextAdventureCastBibleArtifactV1,
  TextAdventureNarrativeArcPlanArtifactV1,
  TextAdventureQuestPlanArtifactV1,
  TextAdventureQuestScriptArtifactV2,
} from './production-artifacts-v2'
import { planTextAdventureNarrativeLocationsV1 } from './narrative-location-plan'

export interface TextAdventureProductionCompilerInputV1 {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  interaction: FrozenInteractionRuntimeV2
  architecture: TextAdventureArchitectureArtifactV1
  systems: TextAdventureSystemsArtifactV1
  cast: TextAdventureCastBibleArtifactV1
  arcPlan: TextAdventureNarrativeArcPlanArtifactV1
  mainQuestPlan: TextAdventureQuestPlanArtifactV1
  questScript: TextAdventureQuestScriptArtifactV2
  sideQuests: TextAdventureQuestBundleArtifactV2
  ambientEvents: TextAdventureQuestBundleArtifactV2
  sourceCatalog?: Pick<ProductProductionWorldSourceCatalogV2, 'artifacts'>
}

function fail(message: string): never {
  throw new Error(`[text-adventure-production-compiler] ${message}`)
}

function pad(value: number): string {
  return String(value + 1).padStart(3, '0')
}

function participantKeyForCastIndex(index: number): string {
  return `participant.cast.${pad(index)}`
}

/**
 * Partition the ending space with a deterministic prefix tree. This makes the
 * route's earlier decisions authoritative: the final menu cannot silently
 * replace them with an unrelated ending.
 */
function endingDecisionRequirementKeysV1(
  arcPlan: TextAdventureNarrativeArcPlanArtifactV1,
  endingKeys: readonly string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  if (endingKeys.length <= 1 || arcPlan.decisions.length < endingKeys.length - 1) return result
  endingKeys.forEach((endingKey, endingIndex) => {
    const conditionKeys = arcPlan.decisions.slice(0, endingIndex)
      .map(decision => decision.options[1].persistentEffectKey)
    if (endingIndex < endingKeys.length - 1) {
      conditionKeys.push(arcPlan.decisions[endingIndex].options[0].persistentEffectKey)
    }
    result.set(endingKey, conditionKeys)
  })
  return result
}

export function compileTextAdventureInteractionV1(input: {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  cast: TextAdventureCastBibleArtifactV1
  arcPlan: TextAdventureNarrativeArcPlanArtifactV1
}): FrozenInteractionRuntimeV2 {
  const npcs = input.cast.characters.filter(character => character.role !== 'player')
  if (!npcs.length) fail('角色圣经没有可互动 NPC')
  const participantByCharacter = new Map(npcs.map((character, index) => (
    [character.key, participantKeyForCastIndex(index)] as const
  )))
  const profiles: FrozenInteractionRuntimeV2['profiles'] = npcs.map((character, index) => ({
    participantKey: participantKeyForCastIndex(index), characterKey: character.key,
    name: character.name, roleLabel: character.publicIdentity,
    voiceRules: `${character.voice}\n动机：${character.motivation}\n不得知晓：${character.forbiddenKnowledge.join('；')}`,
    initialKnowledge: character.initialKnowledge.map((content, knowledgeIndex) => ({
      key: `knowledge.cast.${pad(index)}.${pad(knowledgeIndex)}`,
      content, visibility: 'public' as const, importance: knowledgeIndex === 0 ? 100 : 70,
    })),
    relationshipDimensions: [
      { key: 'trust', label: '信任', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20 },
      { key: 'respect', label: '尊重', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20 },
    ],
    maxMemoryEntries: Math.max(40, Math.min(240, input.brief.scale.targetPlayMinutes * 2)),
  }))
  const arcSceneCards = input.arcPlan.acts.flatMap(act => act.sceneCards)
  const sceneCardByKey = new Map(arcSceneCards.map(scene => [scene.key, scene]))
  const nonEndingNodes = input.narrative.nodes.filter(node => node.kind !== 'ending')
  const endings = input.narrative.nodes.filter(node => node.kind === 'ending')
  const outgoingByNode = new Map<string, typeof input.narrative.choices>()
  for (const choice of input.narrative.choices) {
    outgoingByNode.set(choice.sourceNodeKey, [...(outgoingByNode.get(choice.sourceNodeKey) ?? []), choice])
  }
  const sceneTemplates: FrozenInteractionRuntimeV2['sceneTemplates'] = nonEndingNodes.map((node, sceneIndex) => {
    const sceneCard = sceneCardByKey.get(node.key) ?? arcSceneCards[sceneIndex]
    const castParticipants = sceneCard?.castKeys.flatMap(characterKey => {
      const participantKey = participantByCharacter.get(characterKey)
      return participantKey ? [participantKey] : []
    }) ?? []
    const participantKeys = [...new Set(castParticipants.length
      ? castParticipants : profiles.slice(sceneIndex % profiles.length, sceneIndex % profiles.length + 1).map(profile => profile.participantKey))]
    const outgoing = outgoingByNode.get(node.key) ?? []
    const endingNode = outgoing.map(choice => endings.find(ending => ending.key === choice.targetNodeKey)).find(Boolean)
    const relationshipRules = participantKeys.flatMap((participantKey, participantIndex) => {
      const profile = profiles.find(item => item.participantKey === participantKey)!
      return [{
        ruleKey: `relationship.cast.${pad(sceneIndex)}.${pad(participantIndex)}.listen`,
        label: `倾听${profile.name}`, playerText: `请${profile.name}说清眼前局面，并尊重其知识边界。`,
        fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'trust' as const,
        delta: 2, reason: '玩家认真倾听并承认对方的处境。', significantEventKey: null,
      }, {
        ruleKey: `relationship.cast.${pad(sceneIndex)}.${pad(participantIndex)}.press`,
        label: `追问${profile.name}`, playerText: `要求${profile.name}立即回应与当前目标直接相关的问题。`,
        fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'respect' as const,
        delta: -1, reason: '玩家以压力换取即时信息。', significantEventKey: null,
      }]
    })
    return {
      sceneKey: `scene.${pad(sceneIndex)}`, title: node.title,
      purpose: sceneCard?.purpose ?? node.summary,
      location: sceneCard ? `地点编号 ${sceneCard.locationOrdinal}` : `叙事场景：${node.title}`,
      timeLabel: sceneIndex === 0 ? '故事开始时' : `主线场景 ${sceneIndex + 1}`,
      participantKeys,
      publicKnowledgeKeys: participantKeys.flatMap(participantKey => (
        profiles.find(profile => profile.participantKey === participantKey)?.initialKnowledge.map(item => item.key) ?? []
      )),
      goals: [sceneCard?.conflict ?? node.summary, ...outgoing.map(choice => choice.text)].filter(Boolean).slice(0, 8),
      endingConditions: outgoing.map(choice => `玩家确认选择：${choice.text}`).slice(0, 8),
      safetyBoundaries: [...input.brief.intent.contentBoundaries, '角色不得知道其 forbiddenKnowledge 中的事实', '不替玩家决定感受或行动'],
      relationshipRules, openingNodeKey: node.key, endingNodeKey: endingNode?.key ?? endings[0]?.key ?? null,
      maxTurns: Math.max(8, Math.min(80, Math.ceil(input.brief.scale.targetPlayMinutes / nonEndingNodes.length) * 4)),
      directorBudget: Math.max(1, Math.min(participantKeys.length * 2, 12)), order: sceneIndex,
    }
  })
  return { playerKey: 'player', profiles, sceneTemplates }
}

export function compileTextAdventureModuleV2(
  input: TextAdventureProductionCompilerInputV1,
): AdventureContentV2 {
  const contract = input.brief.textAdventure
  if (input.brief.intent.productType !== 'text-adventure' || !contract) fail('缺少文字冒险正式 Brief')
  const regions: AdventureContentV2['regions'] = []
  const areas: AdventureContentV2['areas'] = []
  const locations: AdventureContentV2['locations'] = []
  input.architecture.regions.forEach((region, regionIndex) => {
    const regionKey = `region.${pad(regionIndex)}`
    const areaKeys: string[] = []
    region.areas.forEach((area, areaIndex) => {
      const areaKey = `area.${pad(regionIndex)}.${pad(areaIndex)}`
      const locationKeys: string[] = []
      area.locations.forEach((location, locationIndex) => {
        const locationKey = `location.${pad(regionIndex)}.${pad(areaIndex)}.${pad(locationIndex)}`
        locationKeys.push(locationKey)
        locations.push({
          key: locationKey, areaKey, title: location.title, description: location.description,
          tags: [...location.tags, `region:${regionKey}`, `area:${areaKey}`], sceneKeys: [],
        })
      })
      areaKeys.push(areaKey)
      areas.push({ key: areaKey, regionKey, title: area.title, description: area.description, locationKeys, tags: [] })
    })
    regions.push({ key: regionKey, title: region.title, description: region.description, areaKeys, tags: [] })
  })
  if (!locations.length) fail('空间编译后没有地点')

  const narrativeNodes = input.narrative.nodes.filter(node => node.kind !== 'ending')
  const desiredSceneCount = Math.max(locations.length, narrativeNodes.length, contract.narrative.targetSceneCount)
  const narrativeLocationPlan = planTextAdventureNarrativeLocationsV1(narrativeNodes.length, locations.length)
  const narrativeLocationIndexes = new Set(narrativeLocationPlan.map(item => item.locationIndex))
  const remainingLocationIndexes = locations
    .map((_, locationIndex) => locationIndex)
    .filter(locationIndex => !narrativeLocationIndexes.has(locationIndex))
  const scenes: AdventureContentV2['scenes'] = Array.from({ length: desiredSceneCount }, (_, index) => {
    // Mainline scenes move monotonically through the authored location spine.
    // Fine-grained scenes are spread across locations without ever wrapping a
    // late-game action back into an earlier location.
    const narrativeNode = narrativeNodes[index]
    const fallbackLocationIndex = remainingLocationIndexes[index - narrativeNodes.length]
      ?? Math.min(locations.length - 1, index)
    const location = locations[narrativeNode
      ? narrativeLocationPlan[index].locationIndex
      : fallbackLocationIndex]
    const sceneKey = `scene.${pad(index)}`
    location.sceneKeys.push(sceneKey)
    return {
      key: sceneKey, locationKey: location.key,
      title: narrativeNode?.title ?? `${location.title} · 场景 ${index + 1}`,
      description: narrativeNode?.summary ?? location.description,
      actionKeys: [], tags: narrativeNode ? [`narrative:${narrativeNode.key}`] : ['exploration'],
    }
  })
  const firstSceneForLocation = new Map<string, string>()
  for (const scene of scenes) if (!firstSceneForLocation.has(scene.locationKey)) firstSceneForLocation.set(scene.locationKey, scene.key)
  const sceneForNode = new Map(narrativeNodes.map((node, index) => [node.key, scenes[index]]))
  const arcSceneCards = input.arcPlan.acts.flatMap(act => act.sceneCards)
  const sceneForArcKey = new Map(arcSceneCards.map((sceneCard, index) => [sceneCard.key, scenes[index]]))
  const narrativeNodeForScene = new Map(narrativeNodes.map((node, index) => [scenes[index].key, node.key]))
  const locationForNode = new Map([...sceneForNode].map(([nodeKey, scene]) => [nodeKey, scene.locationKey]))
  const entryLocationKey = locationForNode.get(input.narrative.entryNodeKey) ?? locations[0].key

  const abilities: AdventureContentV2['abilities'] = input.systems.abilities.map(item => ({ ...item, group: item.role }))
  if (!abilities.some(item => item.key === 'ability.level')) abilities.unshift({
    key: 'ability.level', title: '等级', description: '角色的总体成长阶段。', role: 'stat', group: 'progression',
    initial: 1, minimum: 1, maximum: 50,
  })
  const abilityKeys = new Set(abilities.map(item => item.key))
  const fallbackAbilityKey = abilities.find(item => item.role === 'skill')?.key ?? abilities[0].key
  const resources: AdventureContentV2['resources'] = input.systems.resources.map(item => ({ ...item }))
  const resourceByRole = new Map(resources.map(item => [item.role, item]))
  const experience = resourceByRole.get('experience')
  const skillPoints = resourceByRole.get('skill-points')
  const clock = resourceByRole.get('clock')
  const health = resourceByRole.get('health')
  const currency = resourceByRole.get('currency')
  if (!experience || !skillPoints || !clock || !health || !currency) fail('系统 Artifact 缺少成长、时间或代价资源')

  const equipmentSlots: AdventureContentV2['equipmentSlots'] = input.systems.equipmentSlots.map(item => ({ ...item }))
  const items: AdventureContentV2['items'] = input.systems.starterEquipment.map(item => ({
    key: item.key, title: item.title, description: item.description, tags: item.tags,
    stackable: false, consumable: false, category: 'equipment', equipmentSlotKey: item.slotKey,
    modifiers: [{ abilityKey: item.modifierAbilityKey, delta: item.modifierDelta }], usableActionKey: null,
  }))
  const initialInventory: AdventureContentV2['initialInventory'] = items.map(item => ({ itemKey: item.key, quantity: 1 }))

  const objects: AdventureContentV2['objects'] = locations.map((location, index) => ({
    key: `object.journal.${pad(index)}`, locationKey: location.key,
    sceneKey: firstSceneForLocation.get(location.key) ?? null,
    title: `${location.title}的现场记录`, description: `记录${location.description}`, tags: ['world-detail', 'journal'],
  }))
  const sourceArtifacts = input.sourceCatalog?.artifacts ?? []
  sourceArtifacts.forEach((artifact, index) => {
    const location = locations[index % locations.length]
    const itemKey = `item.world.${pad(index)}`
    items.push({
      key: itemKey, title: artifact.name, description: artifact.description || `来自冻结世界的物品：${artifact.name}`,
      tags: ['world-artifact', `source:${artifact.resourceKey}`], stackable: false, consumable: false,
      category: 'key', equipmentSlotKey: null, modifiers: [], usableActionKey: null,
    })
    objects.push({
      key: `object.world.${pad(index)}`, locationKey: location.key,
      sceneKey: firstSceneForLocation.get(location.key) ?? null,
      title: artifact.name, description: artifact.description || `来自冻结世界的物品：${artifact.name}`,
      tags: ['world-artifact', `source:${artifact.resourceKey}`],
    })
  })
  if (sourceArtifacts.length === 0) items.push({
    key: 'item.product.field-notes', title: '现场记录页',
    description: `一页由本次冒险整理出的${locations[0].title}现场记录；它只属于当前产品，不会被当作冻结世界事实。`,
    tags: ['product-private', 'journal'], stackable: false, consumable: false,
    category: 'key', equipmentSlotKey: null, modifiers: [], usableActionKey: null,
  })

  const actions: AdventureActionDefinition[] = []
  const actionScene = new Map<string, string>()
  const registerAction = (action: AdventureActionDefinition, sceneKey?: string) => {
    actions.push(action)
    actionScene.set(action.key, sceneKey ?? firstSceneForLocation.get(action.locationKey) ?? scenes[0].key)
  }

  const conditions: AdventureContentV2['conditions'] = []
  const arcSceneIndexByKey = new Map(arcSceneCards.map((sceneCard, index) => [sceneCard.key, index]))
  const arcDecisionByNarrativeNode = new Map(input.arcPlan.decisions.flatMap(decision => {
    const sceneIndex = arcSceneIndexByKey.get(decision.sceneKey)
    const narrativeNode = sceneIndex == null ? null : narrativeNodes[sceneIndex]
    return narrativeNode ? [[narrativeNode.key, decision] as const] : []
  }))
  for (const decision of input.arcPlan.decisions) for (const option of decision.options) {
    if (!conditions.some(condition => condition.key === option.persistentEffectKey)) conditions.push({
      key: option.persistentEffectKey, title: option.label,
      description: `决定代价：${option.cost}`, tags: ['narrative-decision'],
    })
  }
  const mainQuest = input.mainQuestPlan.quests[0]
  if (!mainQuest || input.mainQuestPlan.bundleKind !== 'main') fail('主线任务计划不存在或类型错误')
  const mainQuestKey = mainQuest.key
  const objectiveCompletionConditionKey = (objectiveKey: string) => `condition.main.${objectiveKey}.completed`
  const mainStages: AdventureContentV2['quests'][number]['stages'] = mainQuest.stages.map(stage => ({
    key: stage.key, title: stage.title, objectiveKeys: [...stage.objectiveKeys],
  }))
  const mainObjectives: AdventureContentV2['quests'][number]['objectives'] = mainQuest.objectives.map(objective => ({
    key: objective.key, stageKey: objective.stageKey, title: objective.title, optional: false,
    alternativeActionKeys: objective.alternatives.map(alternative => `action.main.${alternative.key}`),
  }))
  for (const objective of mainQuest.objectives) {
    conditions.push({
      key: objectiveCompletionConditionKey(objective.key), title: `${objective.title}已完成`,
      description: objective.narrativePurpose, tags: ['main-objective'],
    })
    for (const alternative of objective.alternatives) for (const effectKey of alternative.persistentEffectKeys) {
      if (!conditions.some(condition => condition.key === effectKey)) conditions.push({
        key: effectKey, title: `${objective.title}的持久后果`,
        description: alternative.successConsequence, tags: ['mainline-consequence'],
      })
    }
  }
  const orderedMainObjectives = mainQuest.stages.flatMap(stage => (
    stage.objectiveKeys.map(objectiveKey => mainQuest.objectives.find(objective => objective.key === objectiveKey)!)
  ))
  const mainScriptByObjective = new Map(input.questScript.mainObjectiveScripts.map(script => [script.objectiveKey, script]))
  const npcCharacters = input.cast.characters.filter(character => character.role !== 'player')
  const mainActionLabel: Record<TextAdventureQuestPlanArtifactV1['quests'][number]['objectives'][number]['alternatives'][number]['actionKind'], string> = {
    look: '观察', move: '前往', talk: '交谈', take: '取得', give: '交付', use: '使用',
    inspect: '检查', attempt: '尝试', rest: '休整', 'quest-action': '执行',
  }
  orderedMainObjectives.forEach((objective, objectiveIndex) => {
    const scene = sceneForArcKey.get(objective.sceneKeys[0])
    if (!scene) fail(`主线目标没有对应 Runtime 场景:${objective.key}`)
    const expectedLocation = locations[objective.locationOrdinal - 1]
    if (!expectedLocation || expectedLocation.key !== scene.locationKey) {
      fail(`主线目标地点与 Runtime 场景不一致:${objective.key}`)
    }
    const previousObjective = orderedMainObjectives[objectiveIndex - 1]
    const itemActionKinds = new Set(objective.alternatives.map(alternative => alternative.actionKind))
    const needsQuestItem = [...itemActionKinds].some(kind => kind === 'take' || kind === 'give' || kind === 'use')
    const questItemKey = needsQuestItem ? `item.main.${objective.key}` : null
    if (questItemKey) {
      const useAlternative = objective.alternatives.find(alternative => alternative.actionKind === 'use')
      items.push({
        key: questItemKey,
        title: `${objective.title}所需物`,
        description: `用于“${objective.title}”的任务物品；取得、使用与交付都由确定性事件记录。`,
        tags: ['quest', `objective:${objective.key}`],
        stackable: false,
        consumable: false,
        category: 'quest',
        equipmentSlotKey: null,
        modifiers: [],
        usableActionKey: useAlternative ? `action.main.${useAlternative.key}` : null,
      })
      objects.push({
        key: `object.main.${objective.key}`,
        locationKey: scene.locationKey,
        sceneKey: scene.key,
        title: `${objective.title}所需物`,
        description: `完成“${objective.title}”前可以取得的任务物品。`,
        tags: ['quest', `objective:${objective.key}`],
      })
      if (itemActionKinds.has('give') || itemActionKinds.has('use')) {
        registerAction({
          key: `action.prepare.${objective.key}`,
          kind: 'take',
          label: `取得：${objective.title}所需物`,
          description: `先把完成“${objective.title}”所需的物品收入背包。`,
          locationKey: scene.locationKey,
          targetKey: `object.main.${objective.key}`,
          requirements: [
            { questKey: mainQuestKey, questStatus: 'active' },
            { conditionKey: objectiveCompletionConditionKey(objective.key), conditionPresent: false },
            ...(previousObjective ? [{
              conditionKey: objectiveCompletionConditionKey(previousObjective.key), conditionPresent: true,
            }] : []),
            { narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: narrativeNodeForScene.get(scene.key)! },
          ],
          rule: { kind: 'automatic' },
          successEffects: [{
            op: 'gain-item', itemKey: questItemKey, quantity: 1,
            claimKey: `claim.main.${objective.key}`,
          }],
          costlySuccessEffects: [], failureEffects: [],
          successText: `你取得了${objective.title}所需物，并把它妥善放进背包。`,
          costlySuccessText: `你付出代价后取得了${objective.title}所需物。`,
          failureText: `你暂时无法取得${objective.title}所需物。`,
          unavailableText: '该任务物品已经取得、目标尚未开放，或你不在对应场景。',
          repeatable: false, narrativeChoiceKey: null, interaction: null,
        }, scene.key)
      }
    }
    objective.alternatives.forEach(alternative => {
      const script = mainScriptByObjective.get(objective.key)?.alternatives
        .find(candidate => candidate.alternativeKey === alternative.key)
      if (!script) fail(`主线解法缺少 Quest Script:${alternative.key}`)
      let interaction: AdventureActionDefinition['interaction'] = null
      if (alternative.actionKind === 'talk') {
        const npcIndex = npcCharacters.findIndex(character => character.key === alternative.targetCharacterKey)
        if (npcIndex < 0) fail(`主线 talk 行动未绑定角色圣经 NPC:${alternative.key}`)
        const participantKey = participantKeyForCastIndex(npcIndex)
        const interactionScene = input.interaction.sceneTemplates.find(template => (
          template.sceneKey === scene.key && template.participantKeys.includes(participantKey)
        ))
        const relationshipRule = interactionScene?.relationshipRules.find(rule => rule.fromParticipantKey === participantKey)
        if (!interactionScene || !relationshipRule) fail(`主线 talk 行动缺少场景互动合同:${alternative.key}`)
        interaction = { participantKey, sceneKey: interactionScene.sceneKey, ruleKey: relationshipRule.ruleKey }
      }
      const completionEffects: AdventureEffect[] = [
        ...(questItemKey && alternative.actionKind === 'take' ? [{
          op: 'gain-item' as const,
          itemKey: questItemKey,
          quantity: 1,
          claimKey: `claim.main.${objective.key}`,
        }] : []),
        ...(questItemKey && alternative.actionKind === 'give' ? [{
          op: 'transfer-item' as const,
          itemKey: questItemKey,
          quantity: 1,
          toOwnerKey: 'quest-recipient',
        }] : []),
        { op: 'complete-objective', questKey: mainQuestKey, objectiveKey: objective.key },
        { op: 'apply-condition', conditionKey: objectiveCompletionConditionKey(objective.key), duration: null },
        ...alternative.persistentEffectKeys.map(conditionKey => (
          { op: 'apply-condition' as const, conditionKey, duration: null }
        )),
        { op: 'change-resource', resourceKey: clock.key, delta: script.timeCostMinutes },
      ]
      registerAction({
        key: `action.main.${alternative.key}`, kind: alternative.actionKind,
        label: `${mainActionLabel[alternative.actionKind]}：${objective.title}`,
        description: `${objective.narrativePurpose}\n代价：${alternative.cost}`,
        locationKey: scene.locationKey,
        requirements: [
          { questKey: mainQuestKey, questStatus: 'active' },
          { conditionKey: objectiveCompletionConditionKey(objective.key), conditionPresent: false },
          ...(previousObjective ? [{
            conditionKey: objectiveCompletionConditionKey(previousObjective.key), conditionPresent: true,
          }] : []),
          { narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: narrativeNodeForScene.get(scene.key)! },
          ...(questItemKey && (alternative.actionKind === 'give' || alternative.actionKind === 'use')
            ? [{ itemKey: questItemKey, itemQuantity: 1 }] : []),
        ],
        rule: script.resolution.mode === 'check'
          ? {
              kind: 'random', abilityKey: script.resolution.abilityKey!, expression: '1d20',
              difficulty: script.resolution.difficulty!, costlySuccessFloor: script.resolution.costlySuccessFloor!,
            }
          : { kind: 'automatic' },
        successEffects: completionEffects,
        costlySuccessEffects: [...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 }],
        failureEffects: contract.narrative.failForward
          ? [...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 }]
          : [{ op: 'change-resource', resourceKey: clock.key, delta: 3 }],
        successText: script.successText,
        costlySuccessText: script.costlySuccessText,
        failureText: script.failureForwardText,
        unavailableText: '这项目标尚未轮到、已经完成，或当前不在对应场景。',
        repeatable: false, narrativeChoiceKey: null, interaction,
        targetKey: alternative.actionKind === 'move'
          ? scene.locationKey
          : questItemKey && ['take', 'give', 'use'].includes(alternative.actionKind)
            ? questItemKey : null,
      }, scene.key)
    })
  })

  const orderedEndingNodeKeys = input.narrative.nodes.filter(node => node.kind === 'ending').map(node => node.key)
  const endingNodeKeys = new Set(orderedEndingNodeKeys)
  const endingDecisionRequirements = endingDecisionRequirementKeysV1(input.arcPlan, orderedEndingNodeKeys)
  const choiceBySource = new Map<string, typeof input.narrative.choices>()
  for (const choice of input.narrative.choices) {
    choiceBySource.set(choice.sourceNodeKey, [...(choiceBySource.get(choice.sourceNodeKey) ?? []), choice])
  }
  // The current general-adventure recipe is route-driven: narrative choices
  // own forward movement. Unconditional adjacent travel would let a player
  // leave the authoritative narrative node behind and either skip scenes or
  // strand the session in a location with no legal mainline action.
  narrativeNodes.forEach(node => {
    const outgoing = choiceBySource.get(node.key) ?? []
    const locationKey = locationForNode.get(node.key) ?? entryLocationKey
    const sceneKey = sceneForNode.get(node.key)?.key
    registerAction({
      key: `action.look.${node.key}`, kind: 'look', label: `观察：${node.title}`,
      description: node.summary || `重新确认${node.title}的局面。`, locationKey, targetKey: null,
      requirements: [{ narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: node.key }],
      rule: { kind: 'automatic' }, successEffects: [{ op: 'change-resource', resourceKey: clock.key, delta: 2 }],
      costlySuccessEffects: [], failureEffects: [],
      successText: input.narrative.beats.filter(beat => beat.nodeKey === node.key).map(beat => beat.text).join('\n') || node.summary,
      costlySuccessText: `你花费更多时间理解了${node.title}。`, failureText: `你暂时没有看清${node.title}。`,
      unavailableText: '当前无法观察。', repeatable: true, narrativeChoiceKey: null, interaction: null,
    }, sceneKey)
    outgoing.forEach((choice, choiceIndex) => {
      const targetLocationKey = locationForNode.get(choice.targetNodeKey)
      const decisionOption = arcDecisionByNarrativeNode.get(choice.sourceNodeKey)?.options[choiceIndex]
      const endingConditionKey = endingNodeKeys.has(choice.targetNodeKey)
        ? `condition.ending.${choice.targetNodeKey}` : null
      if (endingConditionKey && !conditions.some(item => item.key === endingConditionKey)) conditions.push({
        key: endingConditionKey, title: `通往${choice.text}`, description: `玩家通过行动链选择了${choice.text}。`, tags: ['ending-route'],
      })
      const effects: AdventureEffect[] = [
        ...(targetLocationKey ? [{ op: 'enter-location' as const, locationKey: targetLocationKey }] : []),
        ...(decisionOption ? [{
          op: 'apply-condition' as const,
          conditionKey: decisionOption.persistentEffectKey,
          duration: null,
        }] : []),
        ...(endingConditionKey ? [
          { op: 'apply-condition' as const, conditionKey: endingConditionKey, duration: null },
        ] : []),
        { op: 'change-resource', resourceKey: clock.key, delta: Math.max(5, Math.round(60 / Math.max(1, narrativeNodes.length))) } as const,
      ]
      registerAction({
        key: `action.choice.${choice.choiceKey}`, kind: targetLocationKey ? 'move' : 'quest-action', label: choice.text,
        description: choice.description || `推进主线：${choice.text}`, locationKey,
        targetKey: targetLocationKey ?? null, requirements: [
          { narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: choice.sourceNodeKey },
          ...mainQuest.objectives.filter(objective => objective.sceneKeys.some(sceneKey => (
            sceneForArcKey.get(sceneKey)?.key === sceneForNode.get(choice.sourceNodeKey)?.key
          ))).map(objective => ({
            conditionKey: objectiveCompletionConditionKey(objective.key), conditionPresent: true,
          })),
          ...(endingDecisionRequirements.get(choice.targetNodeKey) ?? []).map(conditionKey => ({
            conditionKey, conditionPresent: true,
          })),
        ],
        rule: { kind: 'automatic' }, successEffects: effects, costlySuccessEffects: [], failureEffects: [],
        successText: input.narrative.beats.filter(beat => beat.nodeKey === choice.targetNodeKey).map(beat => beat.text).join('\n') || choice.description || choice.text,
        costlySuccessText: `你付出代价后决定${choice.text}。`, failureText: `你暂时无法${choice.text}。`,
        unavailableText: choice.unavailableReason || '当前条件不允许这个选择。', repeatable: false,
        narrativeChoiceKey: choice.choiceKey, interaction: null,
      }, sceneKey)
    })
  })

  // Re-surface each authored decision only on the route that caused it. The
  // immutable scene body remains shared, while these condition-gated actions
  // give later scenes explicit, replayable evidence of route consequences.
  for (const decision of input.arcPlan.decisions) for (const option of decision.options) {
    for (const echoSceneKey of option.echoSceneKeys) {
      const scene = sceneForArcKey.get(echoSceneKey)
      const narrativeNodeKey = scene ? narrativeNodeForScene.get(scene.key) : null
      if (!scene || !narrativeNodeKey) fail(`决定回响没有 Runtime 场景:${decision.key}->${echoSceneKey}`)
      registerAction({
        key: `action.echo.${decision.key}.${option.key}.${echoSceneKey}`,
        kind: 'look',
        label: `回响：${option.label}`,
        description: `此前的选择正在影响${scene.title}。`,
        locationKey: scene.locationKey,
        targetKey: null,
        requirements: [
          { narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: narrativeNodeKey },
          { conditionKey: option.persistentEffectKey, conditionPresent: true },
        ],
        rule: { kind: 'automatic' },
        successEffects: [], costlySuccessEffects: [], failureEffects: [],
        successText: `你曾面对“${decision.prompt}”，并选择了“${option.label}”。${option.cost}。这个决定已经改变眼前人物的立场与可用道路。`,
        costlySuccessText: `你再次感到“${option.label}”留下的代价。`,
        failureText: '这段回响没有发生。',
        unavailableText: '只有作出对应决定后，才能看见这段回响。',
        repeatable: true, narrativeChoiceKey: null, interaction: null,
      }, scene.key)
    }
  }

  const quests: AdventureContentV2['quests'] = [{
    key: mainQuestKey, title: mainQuest.title, description: mainQuest.description,
    category: 'main', initialStatus: 'active', prerequisites: [], stages: mainStages, objectives: mainObjectives,
    rewardEffects: [
      { op: 'change-resource', resourceKey: experience.key, delta: 20 },
      { op: 'change-resource', resourceKey: skillPoints.key, delta: 1 },
    ], completionNodeKey: null, failureNodeKey: null,
  }]

  const storylets: AdventureContentV2['storylets'] = []
  const compileBundle = (bundle: TextAdventureQuestBundleArtifactV2) => {
    const scripts = bundle.bundleKind === 'side'
      ? input.questScript.sideQuestScripts : input.questScript.ambientEventScripts
    const scriptByEntry = new Map(scripts.map(script => [script.entryKey, script]))
    bundle.entries.forEach((entry, index) => {
      const script = scriptByEntry.get(entry.key)
      if (!script) fail(`${bundle.bundleKind} 条目缺少 Quest Script:${entry.key}`)
      const firstLocation = locations[(entry.stages[0].locationOrdinal - 1) % locations.length]
      const questKey = `quest.${bundle.bundleKind}.${entry.key}`
      const intakeStageKey = `stage.${bundle.bundleKind}.${entry.key}.intake`
      const intakeObjectiveKey = `objective.${bundle.bundleKind}.${entry.key}.intake`
      const acceptActionKey = `action.accept.${bundle.bundleKind}.${entry.key}`
      const rewardEffects: AdventureEffect[] = [
        { op: 'change-resource', resourceKey: experience.key, delta: entry.rewardExperience },
        { op: 'change-resource', resourceKey: currency.key, delta: entry.rewardCurrency },
      ]
      const compiledStages = entry.stages.map((stage, stageIndex) => ({
        key: `stage.${bundle.bundleKind}.${entry.key}.${stage.key}`,
        title: stage.title,
        objectiveKeys: [`objective.${bundle.bundleKind}.${entry.key}.${stage.key}`],
        stage,
        stageIndex,
      }))
      quests.push({
        key: questKey, title: entry.title, description: `${entry.hook}\n${entry.description}`,
        category: bundle.bundleKind, initialStatus: bundle.bundleKind === 'side' ? 'available' : 'active', prerequisites: [],
        stages: bundle.bundleKind === 'side'
          ? [
              { key: intakeStageKey, title: `接触：${entry.title}`, objectiveKeys: [intakeObjectiveKey] },
              ...compiledStages.map(({ key, title, objectiveKeys }) => ({ key, title, objectiveKeys })),
            ]
          : compiledStages.map(({ key, title, objectiveKeys }) => ({ key, title, objectiveKeys })),
        objectives: bundle.bundleKind === 'side'
          ? [
              {
                key: intakeObjectiveKey, stageKey: intakeStageKey, title: `了解并接下：${entry.title}`,
                optional: false, alternativeActionKeys: [acceptActionKey],
              },
              ...compiledStages.map(({ key, stage }) => ({
                key: `objective.${bundle.bundleKind}.${entry.key}.${stage.key}`,
                stageKey: key,
                title: stage.objective,
                optional: false,
                alternativeActionKeys: [`action.${bundle.bundleKind}.${entry.key}.${stage.key}`],
              })),
            ]
          : compiledStages.map(({ key, stage }) => ({
              key: `objective.${bundle.bundleKind}.${entry.key}.${stage.key}`,
              stageKey: key,
              title: stage.objective,
              optional: true,
              alternativeActionKeys: [`action.${bundle.bundleKind}.${entry.key}.${stage.key}`],
            })),
        rewardEffects, completionNodeKey: null, failureNodeKey: null,
      })
      if (bundle.bundleKind === 'side') registerAction({
        key: acceptActionKey, kind: 'quest-action', label: `接取：${entry.title}`,
        description: entry.hook, locationKey: firstLocation.key, targetKey: null,
        requirements: [{ questKey, questStatus: 'available' }], rule: { kind: 'automatic' },
        successEffects: [
          { op: 'accept-quest', questKey },
          { op: 'complete-objective', questKey, objectiveKey: intakeObjectiveKey },
          { op: 'change-resource', resourceKey: clock.key, delta: 1 },
        ],
        costlySuccessEffects: [], failureEffects: [],
        successText: `${entry.hook}\n【系统】新任务：${entry.title}`,
        costlySuccessText: `你接下了${entry.title}，但需要重新安排时间。`,
        failureText: `你暂时无法接取${entry.title}。`, unavailableText: '这项支线已经接取或结束。',
        repeatable: false, narrativeChoiceKey: null, interaction: null,
      })
      const storyletActionKeys = bundle.bundleKind === 'side' ? [acceptActionKey] : []
      compiledStages.forEach(({ stage, stageIndex }) => {
        const stageScript = script.stages.find(candidate => candidate.stageKey === stage.key)
        if (!stageScript) fail(`${bundle.bundleKind} 阶段缺少 Quest Script:${entry.key}.${stage.key}`)
        const location = locations[(stage.locationOrdinal - 1) % locations.length]
        const objectiveKey = `objective.${bundle.bundleKind}.${entry.key}.${stage.key}`
        const actionKey = `action.${bundle.bundleKind}.${entry.key}.${stage.key}`
        const conditionKey = `condition.${bundle.bundleKind}.${entry.key}.${stage.key}.resolved`
        const previousStage = compiledStages[stageIndex - 1]?.stage
        const previousConditionKey = previousStage
          ? `condition.${bundle.bundleKind}.${entry.key}.${previousStage.key}.resolved`
          : null
        conditions.push({
          key: conditionKey,
          title: `${entry.title} · ${stage.title}已回应`,
          description: stage.failureText,
          tags: [bundle.bundleKind, 'quest-stage'],
        })
        const abilityKey = abilityKeys.has(stageScript.abilityKey) ? stageScript.abilityKey : fallbackAbilityKey
        const useItemKey = stageScript.actionKind === 'use'
          ? `item.${bundle.bundleKind}.${entry.key}.${stage.key}` : null
        const stageRequirements: AdventureActionDefinition['requirements'] = [
          { questKey, questStatus: 'active' },
          { conditionKey, conditionPresent: false },
          ...(previousConditionKey ? [{ conditionKey: previousConditionKey, conditionPresent: true }] : []),
        ]
        if (useItemKey) {
          items.push({
            key: useItemKey,
            title: `${entry.title} · ${stage.title}所需物`,
            description: `用于完成“${stage.objective}”的任务物品。`,
            tags: ['quest', bundle.bundleKind, `stage:${stage.key}`],
            stackable: false,
            consumable: false,
            category: 'quest',
            equipmentSlotKey: null,
            modifiers: [],
            usableActionKey: actionKey,
          })
          const objectKey = `object.${bundle.bundleKind}.${entry.key}.${stage.key}`
          objects.push({
            key: objectKey,
            locationKey: location.key,
            sceneKey: firstSceneForLocation.get(location.key) ?? null,
            title: `${entry.title} · ${stage.title}所需物`,
            description: `完成“${stage.objective}”前可以取得的任务物品。`,
            tags: ['quest', bundle.bundleKind, `stage:${stage.key}`],
          })
          const prepareActionKey = `action.prepare.${bundle.bundleKind}.${entry.key}.${stage.key}`
          registerAction({
            key: prepareActionKey,
            kind: 'take',
            label: `取得：${entry.title} · ${stage.title}所需物`,
            description: `把完成“${stage.objective}”所需的物品收入背包。`,
            locationKey: location.key,
            targetKey: objectKey,
            requirements: stageRequirements,
            rule: { kind: 'automatic' },
            successEffects: [{
              op: 'gain-item', itemKey: useItemKey, quantity: 1,
              claimKey: `claim.${bundle.bundleKind}.${entry.key}.${stage.key}`,
            }],
            costlySuccessEffects: [],
            failureEffects: [],
            successText: `你取得了完成“${stage.objective}”所需的物品。`,
            costlySuccessText: `你付出代价后取得了完成“${stage.objective}”所需的物品。`,
            failureText: `你暂时无法取得完成“${stage.objective}”所需的物品。`,
            unavailableText: '该任务物品已经取得，或任务尚未进入对应阶段。',
            repeatable: false,
            narrativeChoiceKey: null,
            interaction: null,
          })
          storyletActionKeys.push(prepareActionKey)
        }
        const completionEffects: AdventureEffect[] = [
          { op: 'complete-objective', questKey, objectiveKey },
          { op: 'change-resource', resourceKey: clock.key, delta: stageScript.timeCostMinutes },
          { op: 'apply-condition', conditionKey, duration: null },
        ]
        registerAction({
          key: actionKey,
          kind: stageScript.actionKind,
          label: `${bundle.bundleKind === 'side' ? '推进' : '处理'}：${entry.title} · ${stage.title}`,
          description: `${stage.objective}\n${entry.description}`,
          locationKey: location.key,
          targetKey: useItemKey,
          requirements: [
            ...stageRequirements,
            ...(useItemKey ? [{ itemKey: useItemKey, itemQuantity: 1 }] : []),
          ],
          rule: {
            kind: 'random', abilityKey, expression: '1d20', difficulty: stageScript.difficulty,
            costlySuccessFloor: stageScript.costlySuccessFloor,
          },
          successEffects: completionEffects,
          costlySuccessEffects: [
            ...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 },
          ],
          failureEffects: contract.narrative.failForward ? [
            ...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 },
          ] : [{ op: 'change-resource', resourceKey: clock.key, delta: stageScript.timeCostMinutes }],
          successText: stageScript.successText,
          costlySuccessText: stageScript.costlySuccessText,
          failureText: stageScript.failureForwardText,
          unavailableText: '这段内容当前尚未满足条件，或前一阶段尚未完成。',
          repeatable: false,
          narrativeChoiceKey: null,
          interaction: null,
        })
        storyletActionKeys.push(actionKey)
      })
      storylets.push({
        key: `storylet.${bundle.bundleKind}.${entry.key}`, title: entry.title,
        actionKeys: storyletActionKeys,
        requirements: [], once: true,
        priority: bundle.bundleKind === 'side' ? 60 - index : 30 - index,
      })
    })
  }
  compileBundle(input.sideQuests)
  compileBundle(input.ambientEvents)

  sourceArtifacts.forEach((artifact, index) => {
    const location = locations[index % locations.length]
    registerAction({
      key: `action.take.world.${pad(index)}`, kind: 'take', label: `取得：${artifact.name}`,
      description: artifact.description || `把${artifact.name}收入背包。`, locationKey: location.key,
      targetKey: `object.world.${pad(index)}`, requirements: [], rule: { kind: 'automatic' },
      successEffects: [{ op: 'gain-item', itemKey: `item.world.${pad(index)}`, quantity: 1, claimKey: `claim.world.${pad(index)}` }],
      costlySuccessEffects: [], failureEffects: [], successText: `你取得了${artifact.name}。`,
      costlySuccessText: `你付出代价后取得了${artifact.name}。`, failureText: `${artifact.name}暂时无法取得。`,
      unavailableText: `${artifact.name}已经被取走。`, repeatable: false, narrativeChoiceKey: null, interaction: null,
    })
  })
  if (sourceArtifacts.length === 0) registerAction({
    key: 'action.take.product.field-notes', kind: 'take', label: '取得：现场记录页',
    description: `把${locations[0].title}的现场记录页收入背包。`, locationKey: entryLocationKey,
    targetKey: 'object.journal.001', requirements: [], rule: { kind: 'automatic' },
    successEffects: [{
      op: 'gain-item', itemKey: 'item.product.field-notes', quantity: 1,
      claimKey: 'claim.product.field-notes',
    }],
    costlySuccessEffects: [], failureEffects: [], successText: '你把现场记录页收入了背包。',
    costlySuccessText: '你费了些功夫才收好现场记录页。', failureText: '现场记录页暂时无法取得。',
    unavailableText: '现场记录页已经被取走。', repeatable: false, narrativeChoiceKey: null, interaction: null,
  }, firstSceneForLocation.get(entryLocationKey))
  input.systems.starterEquipment.forEach(equipment => {
    registerAction({
      key: `action.equip.${equipment.key}`, kind: 'use', label: `装备：${equipment.title}`,
      description: equipment.description, locationKey: entryLocationKey, targetKey: equipment.key,
      requirements: [{ itemKey: equipment.key, itemQuantity: 1, itemState: 'carried' }], rule: { kind: 'automatic' },
      successEffects: [{ op: 'change-item-state', itemKey: equipment.key, state: 'equipped' }],
      costlySuccessEffects: [], failureEffects: [], successText: `你装备了${equipment.title}。`,
      costlySuccessText: `你勉强装备了${equipment.title}。`, failureText: `你暂时无法装备${equipment.title}。`,
      unavailableText: '装备不在背包中或槽位已被占用。', repeatable: true, narrativeChoiceKey: null, interaction: null,
    }, firstSceneForLocation.get(entryLocationKey))
    registerAction({
      key: `action.unequip.${equipment.key}`, kind: 'use', label: `卸下：${equipment.title}`,
      description: `把${equipment.title}从装备槽收回背包。`, locationKey: entryLocationKey, targetKey: equipment.key,
      requirements: [{ itemKey: equipment.key, itemQuantity: 1, itemState: 'equipped' }], rule: { kind: 'automatic' },
      successEffects: [{ op: 'change-item-state', itemKey: equipment.key, state: 'carried' }],
      costlySuccessEffects: [], failureEffects: [], successText: `你卸下了${equipment.title}。`,
      costlySuccessText: `你花了一些时间卸下${equipment.title}。`, failureText: `你暂时无法卸下${equipment.title}。`,
      unavailableText: '装备不在背包中。', repeatable: true, narrativeChoiceKey: null, interaction: null,
    }, firstSceneForLocation.get(entryLocationKey))
  })

  const interactionScene = input.interaction.sceneTemplates[0]
  const interactionRule = interactionScene?.relationshipRules[0]
  const interactionProfile = input.interaction.profiles.find(profile => profile.participantKey === interactionRule?.fromParticipantKey)
    ?? input.interaction.profiles[0]
  const authoredInteractionProfile = interactionProfile
    && !interactionProfile.characterKey.startsWith('generated:')
    && !/^产品角色\s*\d+$/u.test(interactionProfile.name.trim())
    ? interactionProfile : null
  if (interactionScene && interactionRule && authoredInteractionProfile) registerAction({
    key: 'action.talk.opening', kind: 'talk', label: `交谈：${authoredInteractionProfile.name}`,
    description: '在冻结角色事实和知识边界内推进关系与当前目标。', locationKey: entryLocationKey,
    targetKey: null, requirements: [], rule: { kind: 'automatic' },
    successEffects: [{ op: 'change-resource', resourceKey: clock.key, delta: 3 }], costlySuccessEffects: [], failureEffects: [],
    successText: '这段对话留下了可回放的关系与知识证据。', costlySuccessText: '对话推进，但关系付出代价。',
    failureText: '对方暂时拒绝继续。', unavailableText: '当前无法开始这段对话。', repeatable: true,
    narrativeChoiceKey: null, interaction: {
      participantKey: authoredInteractionProfile.participantKey, sceneKey: interactionScene.sceneKey, ruleKey: interactionRule.ruleKey,
    },
  })

  for (const scene of scenes) {
    scene.actionKeys = actions.filter(action => actionScene.get(action.key) === scene.key).map(action => action.key)
  }
  const endingNodes = input.narrative.nodes.filter(node => node.kind === 'ending')
  const endings: AdventureContentV2['endings'] = endingNodes.map((node, index) => ({
    key: node.key, title: node.title, narrativeNodeKey: node.key,
    requirements: [{ conditionKey: `condition.ending.${node.key}`, conditionPresent: true }], priority: 100 - index,
  }))
  const levelMaximum = abilities.find(item => item.key === 'ability.level')!.maximum
  const experienceThresholds = Array.from({ length: Math.max(2, Math.min(10, levelMaximum)) }, (_, index) => (
    index === 0 ? 0 : index * (index + 1) * 10
  ))
  const parsed = parseAdventureContent({
    schema: 'storyforge.text-adventure.content', version: 2, recipeKey: 'general-adventure.v1',
    initialLocationKey: entryLocationKey, playerKey: 'player',
    playerIdentity: { name: input.brief.intent.playerRole, description: input.brief.intent.openingSituation },
    capabilities: ['space', 'character', 'inventory', 'equipment', 'quests', 'time', 'storylets', 'endings'].map(key => ({
      key, version: 1, enabled: true, required: true,
    })),
    regions, areas, locations, scenes, objects, items, equipmentSlots,
    abilities, conditions, resources, quests, actions, initialInventory,
    progression: {
      levelAbilityKey: 'ability.level', experienceResourceKey: experience.key,
      skillPointResourceKey: skillPoints.key, experienceThresholds,
    },
    clock: { resourceKey: clock.key, dayLengthMinutes: 1440, startLabel: '冒险开始' },
    storylets, endings,
    media: { mode: contract.media.mode, fallback: 'text-only', assetKeys: [] },
  })
  if (parsed.version !== 2) fail('编译结果没有进入 AdventureContentV2')
  return parsed
}

export function bindTextAdventureNarrativeActionsV1(input: {
  narrative: ProductRuntimePackageV1['narrative']
  adventure: AdventureContentV2
}): ProductRuntimePackageV1['narrative'] {
  const actionByChoice = new Map(input.adventure.actions.flatMap(action => (
    action.narrativeChoiceKey ? [[action.narrativeChoiceKey, action.key] as const] : []
  )))
  return {
    ...structuredClone(input.narrative),
    choices: input.narrative.choices.map(choice => {
      const actionKey = actionByChoice.get(choice.choiceKey)
      if (!actionKey) return structuredClone(choice)
      return { ...structuredClone(choice), tags: [
        ...choice.tags.filter(tag => !tag.startsWith('adventure-action:')),
        `adventure-action:${actionKey}`,
      ] }
    }),
  }
}
