import { parseAdventureContent } from '../adventure/runtime'
import { parseNarrativeSimulationContent } from '../narrative-simulation/runtime'
import { parseOpenWorldContent } from '../open-world/runtime'
import type {
  AdventureContentV1,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  GameProductionBriefV3,
  GameRuntimePackageV2,
  NarrativeSimulationContentV1,
  OpenWorldContentV1,
} from '../types'
import type { GameProductionWorldSourceCatalogV2 as WorldGameSourceCatalog } from './world-source'

export interface ProductModuleCompilerInputV1 {
  brief: GameProductionBriefV3
  narrative: GameRuntimePackageV2['narrative']
  sourceCatalog?: Pick<WorldGameSourceCatalog,
    'characters' | 'locations' | 'artifacts' | 'loreEntries' | 'storyArcs'>
}

function fail(message: string): never {
  throw new Error(`[game-product-compiler] ${message}`)
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

function selectedLore(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.loreEntries,
    input.brief.source.selection.roleBindings.lore
      ?? input.brief.source.selection.roleBindings.factions ?? [])
}

function selectedStoryArcs(input: ProductModuleCompilerInputV1) {
  return selectedRows(input.sourceCatalog?.storyArcs,
    input.brief.source.selection.roleBindings.quests
      ?? input.brief.source.selection.roleBindings.issues ?? [])
}

function choiceMap(input: ProductModuleCompilerInputV1) {
  const result = new Map<string, GameRuntimePackageV2['narrative']['choices']>()
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

export function compileSimulationModuleV1(input: ProductModuleCompilerInputV1): NarrativeSimulationContentV1 {
  const sourceNodes = sources(input)
  const endingNodes = endings(input)
  const participantActorKeys = participants(input)
  const characterRows = selectedCharacters(input)
  const loreRows = selectedLore(input)
  const storyArcRows = selectedStoryArcs(input)
  const organizationSources = loreRows.length ? loreRows.slice(0, 8) : [{
    resourceKey: 'product-generated:organization', name: '世界局势参与方',
    description: `围绕${input.narrative.moduleTitle}行动的产品私域组织。`,
  }]
  const organizationKeys = organizationSources.map((_, index) => `organization.${pad(index)}`)
  const actorKeys = [...participantActorKeys, ...organizationKeys]
  const sourceIndex = new Map(sourceNodes.map((node, index) => [node.key, index]))
  const issues: NarrativeSimulationContentV1['issues'] = sourceNodes.map((node, index) => {
    const sourceArc = storyArcRows.length ? storyArcRows[index % storyArcRows.length] : null
    return {
    key: `issue.${pad(index)}`, title: sourceArc?.name ?? node.title,
    description: sourceArc?.description || node.summary || `围绕 ${node.title} 累积的世界压力。`,
    initialPressure: 30, minimumPressure: 0, maximumPressure: 100, driftPerTurn: 1,
    stages: [
      { key: 'stable', title: '可控', minimumPressure: 0, description: '仍可常规处理。' },
      { key: 'strained', title: '承压', minimumPressure: 40, description: '选择开始产生明显代价。' },
      { key: 'critical', title: '危机', minimumPressure: 70, description: '必须立刻改变局势。' },
    ], affectedActorKeys: [...actorKeys], crisis: true,
    }
  })
  const actors: NarrativeSimulationContentV1['actors'] = [
    ...participantActorKeys.map((actorKey, index) => ({
      actorKey, title: characterRows[index]?.name ?? `世界主体 ${index + 1}`,
      description: characterRows[index]?.description || `由冻结来源 ${characterKey(input, index)} 投影出的行动主体。`,
      kind: 'actor' as const,
    })),
    ...organizationKeys.map((actorKey, index) => ({
      actorKey, title: organizationSources[index].name,
      description: organizationSources[index].description || `由冻结设定投影出的组织：${organizationSources[index].name}`,
      kind: 'organization' as const,
    })),
  ].map((source, index) => ({
    key: source.actorKey, title: source.title, description: source.description,
    kind: source.kind, stance: 0, capabilities: ['observe', 'respond'],
    observationKeys: ['metric:momentum', issues[index % issues.length].key],
    strategyActions: [{ key: 'respond', title: '回应局势', requirements: [], effects: [{
      op: 'change-issue-pressure', issueKey: issues[index % issues.length].key, delta: 1,
    }], weight: 1 }],
  }))
  const actions: NarrativeSimulationContentV1['actions'] = input.narrative.choices.map((choice, index) => {
    const issueIndex = sourceIndex.get(choice.sourceNodeKey)
    if (issueIndex == null) fail(`模拟行动来源无对应问题:${choice.choiceKey}`)
    return {
      key: `decision.${pad(index)}`, title: choice.text,
      description: choice.description || `执行叙事选择 ${choice.choiceKey}`,
      category: 'decision', requirements: [],
      costs: [{ op: 'change-value', target: 'resource', key: 'agency', delta: -1 }],
      immediateEffects: [
        { op: 'change-issue-pressure', issueKey: `issue.${pad(issueIndex)}`, delta: -8 },
        { op: 'change-value', target: 'metric', key: 'momentum', delta: index % 2 === 0 ? 4 : -2 },
      ], delayedEffects: [{ afterTurns: 2, effects: [{
        op: 'change-value', target: 'metric', key: 'trust', delta: index % 3 === 0 ? 3 : -1,
      }] }], cooldownTurns: 1, conflictsWith: [], tags: [`choice:${choice.choiceKey}`],
    }
  })
  const turnLimit = Math.max(8, Math.min(80, Math.ceil(input.brief.scale.targetPlayMinutes / 2)))
  return parseNarrativeSimulationContent({
    version: 1, turnLimit, actionBudget: 2,
    resources: [{ key: 'agency', title: '行动资源', description: '推动局势的有限资源。', initial: Math.max(12, actions.length * 2), minimum: 0, maximum: Math.max(20, actions.length * 3), conserved: false }],
    metrics: [
      { key: 'momentum', title: '局势推进', description: '世界向用户目标推进的程度。', initial: 50, minimum: 0, maximum: 100, conserved: false, levels: [{ key: 'stalled', label: '停滞', minimum: 0 }, { key: 'moving', label: '推进', minimum: 40 }, { key: 'decisive', label: '决断', minimum: 75 }] },
      { key: 'trust', title: '共同信任', description: '行动者对结果的接受程度。', initial: 50, minimum: 0, maximum: 100, conserved: false, levels: [{ key: 'broken', label: '破裂', minimum: 0 }, { key: 'fragile', label: '脆弱', minimum: 35 }, { key: 'stable', label: '稳定', minimum: 65 }] },
    ], actors, actions, modifiers: [], issues,
    endings: endingNodes.map((ending, index) => ({
      key: `ending.${pad(index)}`, title: ending.title, description: ending.summary || `抵达 ${ending.key}。`,
      narrativeNodeKey: ending.key, priority: endingNodes.length - index,
      conditions: [{ source: 'turn', operator: 'gte', value: Math.min(turnLimit, index + 2) }],
    })),
    themes: [{ key: 'production-world', title: input.narrative.moduleTitle, roleLabel: input.brief.intent.playerRole, resourceLabel: '行动资源', issueLabel: '世界压力' }],
  })
}

export function compileOpenWorldModulesV1(input: ProductModuleCompilerInputV1) {
  const interaction = compileInteractionModulesV1(input)
  const compiledAdventure = compileAdventureModuleV1(input)
  // 开放世界的任务必须先由任务牌公开，再由玩家接受。`active` 会让导演把
  // 所有任务判定为已经开始而永久拒绝发牌；`available` 则表示它可以由
  // OpenWorld 的显式 accept command 激活，但并不把任务公开给玩家。
  const adventure: AdventureContentV1 = {
    ...compiledAdventure,
    quests: compiledAdventure.quests.map(quest => ({ ...quest, initialStatus: 'available' })),
  }
  const simulation = compileSimulationModuleV1(input)
  const locationIndex = locations(input)
  const nodeIndex = new Map(input.narrative.nodes.map((node, index) => [node.key, index]))
  const sourceNodes = sources(input)
  const participantKeys = interaction.profiles.map(profile => profile.participantKey)
  const explicitOrganizations = simulation.actors.filter(actor => actor.kind === 'organization').map(actor => actor.key)
  const organizations = explicitOrganizations.length ? explicitOrganizations : simulation.actors.map(actor => actor.key)
  const regions: OpenWorldContentV1['regions'] = input.narrative.nodes.map((node, index) => {
    const participant = participantKeys[index % participantKeys.length]
    const organization = organizations[index % organizations.length]
    const sourceLocation = adventure.locations.find(item => item.key === locationIndex.locationByNode.get(node.key))
    return {
      key: `region.${pad(index)}`, title: sourceLocation?.title ?? node.title,
      description: sourceLocation?.description || node.summary || `由 ${node.key} 冻结出的区域。`,
      parentKey: null, locationKey: locationIndex.locationByNode.get(node.key)!, tags: [node.kind],
      initialKnowledge: index === 0 ? 'familiar' : 'heard',
      initialAttention: index === 0 ? 'focus' : index < 3 ? 'active' : 'background',
      residentParticipantKeys: [participant], organizationKeys: [organization], channelKeys: [`channel.${pad(index)}`],
      initialResources: { agency: simulation.resources[0].initial },
      initialMetrics: Object.fromEntries(simulation.metrics.map(metric => [metric.key, metric.initial])),
      initialIssuePressures: Object.fromEntries(simulation.issues.map(issue => [issue.key, issue.initialPressure])),
      initialOrganizationInfluence: { [organization]: 0 }, nextScheduledTick: 1,
    }
  })
  const travelEdges: OpenWorldContentV1['travelEdges'] = input.narrative.choices.flatMap((choice, index) => {
    const from = nodeIndex.get(choice.sourceNodeKey); const to = nodeIndex.get(choice.targetNodeKey)
    return from == null || to == null || from === to ? [] : [{
      key: `edge.${pad(index)}`, fromRegionKey: `region.${pad(from)}`, toRegionKey: `region.${pad(to)}`,
      bidirectional: false, travelTicks: 1, risk: Math.min(1, .1 + (index % 5) * .1),
      blockedByIssueKey: null, blockedAtPressure: null,
    }]
  })
  const channels: OpenWorldContentV1['discoveryChannels'] = regions.map((region, index) => ({
    key: `channel.${pad(index)}`, regionKey: region.key, kind: index % 2 === 0 ? 'conversation' : 'rumor',
    title: `${region.title}的线索`, participantKey: participantKeys[index % participantKeys.length],
    triggers: ['observe', 'social', 'explore'], textTemplate: `你在${region.title}发现了与用户目标相关的新线索。`,
  }))
  const cards: OpenWorldContentV1['fixedTaskCards'] = sourceNodes.map((node, index) => {
    const regionIndex = nodeIndex.get(node.key)!
    const questKey = `quest.${pad(index)}`
    const solutions = adventure.quests.find(quest => quest.key === questKey)?.objectives[0]?.alternativeActionKeys ?? []
    const mainline = node.key === input.narrative.entryNodeKey
    return {
      key: `card.${pad(index)}`, questKey, regionKey: `region.${pad(regionIndex)}`,
      category: mainline ? 'mainline' : index % 2 === 0 ? 'issue' : 'exploration',
      sourceIssueKey: `issue.${pad(index)}`, title: node.title, description: node.summary || `解决 ${node.title}。`,
      participantKeys: [participantKeys[index % participantKeys.length]], allowedSolutions: solutions.length ? solutions : ['resolve'],
      rewardBudget: 10, intensity: mainline ? 5 : Math.min(5, index % 5 + 1), basePriority: mainline ? 100 : 20,
      critical: mainline, guaranteedByTick: mainline ? 3 : null, unique: true, cooldownTicks: 2,
      expirationTicks: mainline ? null : 20, allowedChannelKeys: [`channel.${pad(regionIndex)}`],
      requirements: [], declineEffects: [], expirationEffects: [], supersedeConditions: [],
      fingerprint: { family: `story-${pad(index)}`, initiatorKey: participantKeys[index % participantKeys.length], targetKey: `region.${pad(regionIndex)}`, conflictKey: `issue.${pad(index)}`, solutionKey: solutions[0] ?? 'resolve', rewardType: 'narrative-progress' },
    }
  })
  const taskTemplates: OpenWorldContentV1['taskTemplates'] = sourceNodes.slice(0, 8).map((node, index) => {
    const questKey = `quest.${pad(index)}`
    const solutions = adventure.quests.find(quest => quest.key === questKey)?.objectives[0]?.alternativeActionKeys ?? []
    return {
      key: `template.${pad(index)}`, adventureQuestKey: questKey,
      regionKeys: regions.map(region => region.key), category: index % 2 === 0 ? 'issue' : 'character',
      sourceIssueKey: `issue.${pad(index)}`, titleTemplate: `${node.title} · {region}的新动向`,
      descriptionTemplate: `${node.summary || node.title}；局势会根据 {region} 的当前压力生成有界变化。`,
      participantKeys: [participantKeys[index % participantKeys.length]],
      allowedSolutions: solutions.length ? solutions : ['resolve'], rewardBudget: 6,
      intensity: Math.min(4, index % 4 + 1), basePriority: 10, cooldownTicks: 4,
      expirationTicks: 24, allowedChannelKinds: ['conversation', 'rumor'],
      requirements: [{ source: 'tick', operator: 'gte', value: 2 }],
      declineEffects: [], expirationEffects: [],
      fingerprint: {
        family: `dynamic-${pad(index)}`, initiatorKey: participantKeys[index % participantKeys.length],
        targetKey: 'current-region', conflictKey: `issue.${pad(index)}`,
        solutionKey: solutions[0] ?? 'resolve', rewardType: 'world-response',
      },
    }
  })
  const actorSchedules: OpenWorldContentV1['actorSchedules'] = participantKeys.slice(0, 8).map((actorKey, index) => ({
    key: `schedule.${pad(index)}`, actorKey, actorKind: 'participant', periodTicks: 4 + index,
    offsetTicks: index, regionCycle: regions.map(region => region.key),
    effects: [{
      op: 'change-region-value', target: 'issue', regionKey: '$actor-region',
      key: `issue.${pad(index % simulation.issues.length)}`, delta: 1,
    }],
    summary: `让 ${actorKey} 按冻结周期在区域间行动，并以有界方式影响局势。`,
  }))
  const mainlineIndex = Math.max(0, sourceNodes.findIndex(node => node.key === input.narrative.entryNodeKey))
  const openWorld = parseOpenWorldContent({
    version: 1, initialRegionKey: `region.${pad(nodeIndex.get(input.narrative.entryNodeKey)!)}`,
    tickLimit: Math.max(30, Math.min(2_000, input.brief.scale.targetPlayMinutes * 4)),
    simulationCadenceTicks: 2, maxPropagationEdgesPerTick: 8,
    regions, travelEdges, discoveryChannels: channels, fixedTaskCards: cards, taskTemplates,
    decks: regions.map(region => ({
      regionKey: region.key, fixedCardKeys: cards.filter(card => card.regionKey === region.key).map(card => card.key),
      templateKeys: taskTemplates.filter(template => template.regionKeys.includes(region.key)).map(template => template.key),
      categoryQuotas: { mainline: 1, issue: 1, character: 1 }, maxRevealed: 3, maxActive: 2, cooldownTicks: 1,
      recentWindow: 8, blankWeight: 1, highIntensityStreakLimit: 2,
    })), actorSchedules,
    regionalIssueRules: simulation.issues.map((issue, index) => ({
      key: `rule.${pad(index)}`, issueKey: issue.key, regionKeys: regions.map(region => region.key),
      driftPerTick: 1, propagationThreshold: 60, propagationFraction: .25, propagationCap: 8, cooldownTicks: 2,
    })),
    mainline: {
      questKeys: [`quest.${pad(mainlineIndex)}`], protectedParticipantKeys: [participantKeys[0]],
      protectedEdgeKeys: travelEdges.slice(0, 1).map(edge => edge.key), latestRevealTick: 5,
      endingNodeKey: endings(input)[0].key,
    },
    director: { globalMaxRevealed: 5, globalMaxActive: 3, maxQuestInstances: Math.max(20, cards.length * 3), randomJitter: 0, criticalGuaranteeBonus: 100, backlogPenalty: 5, freshnessPenalty: 2 },
  })
  return { interaction, adventure, simulation, openWorld }
}
