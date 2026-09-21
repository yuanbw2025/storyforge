import { parseAdventureContent } from '../adventure/runtime'
import type {
  AdventureContentV1,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
} from '../types'
import type { ProductProductionWorldSourceCatalogV2 as ProductWorldSourceCatalog } from './world-source'

export interface ProductModuleCompilerInputV1 {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  sourceCatalog?: Pick<ProductWorldSourceCatalog,
    'characters' | 'locations' | 'artifacts' | 'loreEntries' | 'storyArcs'>
}

function fail(message: string): never {
  throw new Error(`[product-module-compiler] ${message}`)
}

function pad(index: number): string {
  return String(index + 1).padStart(3, '0')
}

function sources(input: ProductModuleCompilerInputV1) {
  const result = input.narrative.nodes.filter(node => node.kind !== 'ending')
  if (!result.length) fail('产品玩法模块需要至少一个非结局节点')
  return result
}

function endings(input: ProductModuleCompilerInputV1) {
  const result = input.narrative.nodes.filter(node => node.kind === 'ending')
  if (!result.length) fail('叙事图没有可达结局')
  return result
}

function participants(input: ProductModuleCompilerInputV1): string[] {
  const keys = (input.brief.source.selection.roleBindings.characters
    ?? input.brief.source.selection.roleBindings.participants ?? []).slice(0, 8)
  return keys.length ? keys.map((_, index) => `participant.${pad(index)}`) : ['participant.001']
}

function characterKey(input: ProductModuleCompilerInputV1, index: number): string {
  const key = (input.brief.source.selection.roleBindings.characters
    ?? input.brief.source.selection.roleBindings.participants ?? [])[index]
  return key == null ? `generated:participant.${pad(index)}` : `character:${index + 1}`
}

function selectedRows<T extends { resourceKey: string }>(
  rows: readonly T[] | undefined,
  resourceKeys: readonly string[],
): T[] {
  if (!rows?.length || !resourceKeys.length) return []
  const byKey = new Map(rows.map(row => [row.resourceKey, row]))
  return resourceKeys.flatMap(resourceKey => {
    const row = byKey.get(resourceKey)
    return row ? [row] : []
  })
}

function selectedCharacters(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.characters,
    input.brief.source.selection.roleBindings.characters
      ?? input.brief.source.selection.roleBindings.participants ?? [])
}

function selectedLocations(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.locations,
    input.brief.source.selection.roleBindings.locations
      ?? input.brief.source.selection.roleBindings.regions ?? [])
}

function selectedArtifacts(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.artifacts,
    input.brief.source.selection.roleBindings.items ?? [])
}

function choiceMap(input: ProductModuleCompilerInputV1) {
  const result = new Map<string, ProductRuntimePackageV1['narrative']['choices']>()
  for (const choice of input.narrative.choices) {
    result.set(choice.sourceNodeKey, [...(result.get(choice.sourceNodeKey) ?? []), choice])
  }
  return result
}

export function compileInteractionModulesV1(input: ProductModuleCompilerInputV1) {
  const participantKeys = participants(input)
  const sourceCharacters = selectedCharacters(input)
  const profiles: FrozenInteractionCharacterProfile[] = participantKeys.map((participantKey, index) => {
    const frozenCharacterKey = characterKey(input, index)
    const sourceCharacter = sourceCharacters[index]
    const spoken = input.narrative.beats.filter(beat => beat.speakerKey === frozenCharacterKey)
      .slice(0, 12).map(beat => beat.text)
    return {
      participantKey, characterKey: frozenCharacterKey,
      name: sourceCharacter?.name ?? `产品角色 ${index + 1}`,
      roleLabel: index === 0 ? '核心互动角色' : '相关角色',
      voiceRules: `保持 ${sourceCharacter?.description || frozenCharacterKey} 的冻结事实和知识边界；遵守：${input.brief.intent.contentBoundaries.join('；')}`,
      initialKnowledge: [{
        key: `profile.${pad(index)}`,
        content: [sourceCharacter?.description, ...spoken].filter(Boolean).join('\n') || input.brief.intent.openingSituation,
        visibility: 'public', importance: index === 0 ? 100 : 70,
      }],
      relationshipDimensions: [
        { key: 'trust', label: '信任', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20 },
        { key: 'respect', label: '尊重', minimum: -100, maximum: 100, initial: 0, largeChangeThreshold: 20 },
      ],
      maxMemoryEntries: Math.max(40, Math.min(240, input.brief.scale.targetPlayMinutes * 2)),
    }
  })
  const endingNodes = endings(input)
  const choices = choiceMap(input)
  const sourceNodes = sources(input)
  const sceneTemplates: FrozenInteractionSceneTemplate[] = sourceNodes.map((node, index) => {
    const speakers = new Set(input.narrative.beats.filter(beat => beat.nodeKey === node.key)
      .flatMap(beat => beat.speakerKey == null ? [] : [beat.speakerKey]))
    const speakingParticipants = participantKeys.filter((_, participantIndex) => speakers.has(characterKey(input, participantIndex)))
    const activeParticipants = speakingParticipants.length ? speakingParticipants : participantKeys.slice(0, 3)
    const outgoing = choices.get(node.key) ?? []
    const directEnding = outgoing.map(choice => endingNodes.find(ending => ending.key === choice.targetNodeKey)).find(Boolean)
    return {
      sceneKey: `scene.${pad(index)}`, title: node.title,
      purpose: node.summary || input.brief.intent.openingSituation,
      location: `冻结场景：${node.title}`, timeLabel: index === 0 ? '故事开始时' : `阶段 ${index + 1}`,
      participantKeys: activeParticipants,
      publicKnowledgeKeys: profiles.map((_, profileIndex) => `profile.${pad(profileIndex)}`),
      goals: outgoing.length ? outgoing.map(choice => choice.text).slice(0, 8) : [...input.brief.intent.coreExperience],
      endingConditions: outgoing.map(choice => `玩家确认选择：${choice.text}`).slice(0, 8),
      safetyBoundaries: [...input.brief.intent.contentBoundaries, '不替玩家决定感受或行动'],
      relationshipRules: activeParticipants.flatMap((participantKey, participantIndex) => ([
        {
          ruleKey: `relationship.${pad(index)}.${pad(participantIndex)}.trust`,
          label: `向${profiles.find(profile => profile.participantKey === participantKey)?.name ?? participantKey}坦诚说明`,
          playerText: '坦诚说明已掌握的事实，并允许对方保留自己的立场。',
          fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'trust' as const,
          delta: 2, reason: '玩家以公开事实和尊重边界的方式推进对话。', significantEventKey: null,
        },
        {
          ruleKey: `relationship.${pad(index)}.${pad(participantIndex)}.pressure`,
          label: `向${profiles.find(profile => profile.participantKey === participantKey)?.name ?? participantKey}施压`,
          playerText: '以当前证据要求对方立刻作出回应。',
          fromParticipantKey: participantKey, toParticipantKey: 'player', dimensionKey: 'trust' as const,
          delta: -2, reason: '玩家用压力换取即时回应，关系信任因此承受代价。', significantEventKey: null,
        },
      ])), openingNodeKey: node.key,
      endingNodeKey: directEnding?.key ?? endingNodes[0].key,
      maxTurns: Math.max(8, Math.min(80, Math.ceil(input.brief.scale.targetPlayMinutes / Math.max(1, sourceNodes.length)) * 4)),
      directorBudget: Math.max(1, Math.min(activeParticipants.length * 2, 12)), order: index,
    }
  })
  return { playerKey: 'player' as const, profiles, sceneTemplates }
}

interface LocationIndexV1 {
  locationByNode: Map<string, string>
  sourceByNode: Map<string, number>
}

function locations(input: ProductModuleCompilerInputV1): LocationIndexV1 {
  return {
    locationByNode: new Map(input.narrative.nodes.map((node, index) => [node.key, `location.${pad(index)}`])),
    sourceByNode: new Map(sources(input).map((node, index) => [node.key, index])),
  }
}

export function compileAdventureModuleV1(input: ProductModuleCompilerInputV1): AdventureContentV1 {
  const index = locations(input)
  const interaction = compileInteractionModulesV1(input)
  const worldLocations = selectedLocations(input)
  const worldArtifacts = selectedArtifacts(input)
  const choiceBySource = choiceMap(input)
  const quests: AdventureContentV1['quests'] = sources(input).map((node, nodeIndex) => ({
    key: `quest.${pad(nodeIndex)}`, title: node.title,
    description: node.summary || `在 ${node.title} 做出会留下后果的选择。`,
    initialStatus: 'active', prerequisites: [], objectives: [{
      key: 'resolve', title: '决定本阶段的行动方向', optional: false,
      alternativeActionKeys: (choiceBySource.get(node.key) ?? []).map(choice => `action.choice.${choice.choiceKey}`),
    }], rewardEffects: [], completionNodeKey: null, failureNodeKey: null,
  }))
  const choiceActions: AdventureContentV1['actions'] = input.narrative.choices.map(choice => {
    const sourceIndex = index.sourceByNode.get(choice.sourceNodeKey)
    const sourceLocation = index.locationByNode.get(choice.sourceNodeKey)
    const targetLocation = index.locationByNode.get(choice.targetNodeKey)
    if (sourceIndex == null || !sourceLocation || !targetLocation) fail(`Choice 地点映射失败:${choice.choiceKey}`)
    return {
      key: `action.choice.${choice.choiceKey}`, kind: 'move', label: choice.text,
      description: choice.description || `执行叙事选择 ${choice.choiceKey}`,
      locationKey: sourceLocation, targetKey: targetLocation, requirements: [], rule: { kind: 'automatic' },
      successEffects: [
        { op: 'enter-location', locationKey: targetLocation },
        { op: 'complete-objective', questKey: `quest.${pad(sourceIndex)}`, objectiveKey: 'resolve' },
      ], costlySuccessEffects: [], failureEffects: [],
      successText: input.narrative.beats.filter(beat => beat.nodeKey === choice.targetNodeKey).map(beat => beat.text).join('\n') || `你选择了：${choice.text}`,
      costlySuccessText: `你付出代价后选择了：${choice.text}`, failureText: `当前无法完成：${choice.text}`,
      unavailableText: choice.unavailableReason || '当前条件不允许这个行动。',
      repeatable: false, narrativeChoiceKey: choice.choiceKey, interaction: null,
    }
  })
  const lookActions: AdventureContentV1['actions'] = input.narrative.nodes.map((node, nodeIndex) => ({
    key: `action.look.${pad(nodeIndex)}`, kind: 'look', label: `观察：${node.title}`,
    description: node.summary || '重新确认当前局面。', locationKey: index.locationByNode.get(node.key)!,
    targetKey: null, requirements: [], rule: { kind: 'automatic' }, successEffects: [],
    costlySuccessEffects: [], failureEffects: [],
    successText: input.narrative.beats.filter(beat => beat.nodeKey === node.key).map(beat => beat.text).join('\n') || node.summary,
    costlySuccessText: '你辨认出有限线索。', failureText: '当前信息仍不完整。',
    unavailableText: '当前无法观察。', repeatable: true, narrativeChoiceKey: null, interaction: null,
  }))
  const initialLocationKey = index.locationByNode.get(input.narrative.entryNodeKey)!
  const fieldNotesItemKey = 'item.field-notes'
  const fieldNotesObjectKey = 'object.field-notes'
  const sourceArtifactObjects: AdventureContentV1['objects'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `object.source.${pad(artifactIndex)}`,
    locationKey: index.locationByNode.get(input.narrative.nodes[artifactIndex % input.narrative.nodes.length].key)!,
    title: artifact.name, description: artifact.description || `来自冻结世界的道具：${artifact.name}`,
    tags: ['world-artifact', `source:${artifact.resourceKey}`],
  }))
  const sourceArtifactItems: AdventureContentV1['items'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `item.source.${pad(artifactIndex)}`, title: artifact.name,
    description: artifact.description || `来自冻结世界的道具：${artifact.name}`,
    tags: ['world-artifact', `source:${artifact.resourceKey}`], stackable: false, consumable: false,
  }))
  const sourceArtifactActions: AdventureContentV1['actions'] = worldArtifacts.map((artifact, artifactIndex) => ({
    key: `action.take.source.${pad(artifactIndex)}`, kind: 'take', label: `取得：${artifact.name}`,
    description: artifact.description || `把 ${artifact.name} 收入随身物品。`,
    locationKey: sourceArtifactObjects[artifactIndex].locationKey,
    targetKey: sourceArtifactObjects[artifactIndex].key, requirements: [], rule: { kind: 'automatic' },
    successEffects: [{
      op: 'gain-item', itemKey: sourceArtifactItems[artifactIndex].key,
      quantity: 1, claimKey: `claim.source.${pad(artifactIndex)}`,
    }],
    costlySuccessEffects: [], failureEffects: [], successText: `你取得了${artifact.name}。`,
    costlySuccessText: `你付出代价后取得了${artifact.name}。`, failureText: `${artifact.name}暂时无法取得。`,
    unavailableText: `${artifact.name}已经被取走。`, repeatable: false, narrativeChoiceKey: null, interaction: null,
  }))
  const interactionScene = interaction.sceneTemplates[0]
  const interactionRule = interactionScene?.relationshipRules[0]
  const talkAction: AdventureContentV1['actions'] = interactionScene && interactionRule ? [{
    key: 'action.talk.opening', kind: 'talk', label: `交谈：${interaction.profiles[0].name}`,
    description: '进入共享角色互动场景，关系变化由冻结规则显式结算。',
    locationKey: initialLocationKey,
    targetKey: interaction.profiles[0].characterKey.startsWith('character.')
      ? interaction.profiles[0].characterKey : null,
    requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [],
    successText: '对话留下了可回放的关系与知识证据。', costlySuccessText: '对话推进，但关系付出代价。',
    failureText: '对方暂时拒绝继续。', unavailableText: '当前无法开始这段对话。', repeatable: true,
    narrativeChoiceKey: null,
    interaction: {
      participantKey: interaction.profiles[0].participantKey,
      sceneKey: interactionScene.sceneKey,
      ruleKey: interactionRule.ruleKey,
    },
  }] : []
  return parseAdventureContent({
    version: 1, initialLocationKey, playerKey: 'player',
    playerIdentity: { name: input.brief.intent.playerRole, description: input.brief.intent.openingSituation },
    locations: input.narrative.nodes.map((node, nodeIndex) => {
      const worldLocation = worldLocations.length ? worldLocations[nodeIndex % worldLocations.length] : null
      return {
        key: index.locationByNode.get(node.key)!,
        title: worldLocation ? `${worldLocation.name} · ${node.title}` : node.title,
        description: [worldLocation?.description, node.summary
          || input.narrative.beats.filter(beat => beat.nodeKey === node.key).map(beat => beat.text).join('\n')]
          .filter(Boolean).join('\n'),
        tags: [node.kind, `narrative:${node.key}`, ...(worldLocation ? [`world-location:${worldLocation.resourceKey}`] : [])],
      }
    }),
    objects: [{
      key: fieldNotesObjectKey, locationKey: initialLocationKey, title: '现场记录夹',
      description: '保存已确认事实、未解问题和公开范围的便携记录夹。', tags: ['evidence', 'tool'],
    }, ...sourceArtifactObjects],
    items: [{
      key: fieldNotesItemKey, title: '现场记录', description: '可随身查阅的调查记录。',
      tags: ['evidence', 'tool'], stackable: false, consumable: false,
    }, ...sourceArtifactItems],
    abilities: [{ key: 'resolve', title: '决断', description: '识别局势并承担后果。', initial: 2, minimum: 0, maximum: 10 }],
    conditions: [], resources: [{ key: 'focus', title: '专注', initial: 5, minimum: 0, maximum: 5 }],
    quests,
    actions: [...choiceActions, ...lookActions, {
      key: 'action.take.field-notes', kind: 'take', label: '拿起现场记录',
      description: '把记录夹中的关键信息整理进随身物品。', locationKey: initialLocationKey,
      targetKey: fieldNotesObjectKey, requirements: [], rule: { kind: 'automatic' },
      successEffects: [{ op: 'gain-item', itemKey: fieldNotesItemKey, quantity: 1, claimKey: 'claim.field-notes' }],
      costlySuccessEffects: [], failureEffects: [], successText: '你取得了现场记录。',
      costlySuccessText: '你取得了部分记录。', failureText: '记录暂时无法取得。', unavailableText: '现场记录已经被取走。',
      repeatable: false, narrativeChoiceKey: null, interaction: null,
    }, ...sourceArtifactActions, ...talkAction],
    initialInventory: [],
  })
}
