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
  TextAdventureQuestBundleArtifactV1,
  TextAdventureSystemsArtifactV1,
} from './production-artifacts'
import { planTextAdventureNarrativeLocationsV1 } from './narrative-location-plan'

export interface TextAdventureProductionCompilerInputV1 {
  brief: ProductProductionBriefV3
  narrative: ProductRuntimePackageV1['narrative']
  interaction: FrozenInteractionRuntimeV2
  architecture: TextAdventureArchitectureArtifactV1
  systems: TextAdventureSystemsArtifactV1
  sideQuests: TextAdventureQuestBundleArtifactV1
  ambientEvents: TextAdventureQuestBundleArtifactV1
  sourceCatalog?: Pick<ProductProductionWorldSourceCatalogV2, 'artifacts'>
}

function fail(message: string): never {
  throw new Error(`[text-adventure-production-compiler] ${message}`)
}

function pad(value: number): string {
  return String(value + 1).padStart(3, '0')
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

  const endingNodeKeys = new Set(input.narrative.nodes.filter(node => node.kind === 'ending').map(node => node.key))
  const endingActionKeys = input.narrative.choices
    .filter(choice => endingNodeKeys.has(choice.targetNodeKey))
    .map(choice => `action.choice.${choice.choiceKey}`)
  const mainStages: AdventureContentV2['quests'][number]['stages'] = [{
    key: 'stage.main.resolve', title: '完成主线并承担最终选择', objectiveKeys: ['objective.main.resolve'],
  }]
  const mainObjectives: AdventureContentV2['quests'][number]['objectives'] = [{
    key: 'objective.main.resolve', stageKey: 'stage.main.resolve', title: '沿主线推进并抵达一个可解释结局',
    optional: false, alternativeActionKeys: endingActionKeys,
  }]
  const conditions: AdventureContentV2['conditions'] = []
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
    outgoing.forEach(choice => {
      const targetLocationKey = locationForNode.get(choice.targetNodeKey)
      const endingConditionKey = endingNodeKeys.has(choice.targetNodeKey)
        ? `condition.ending.${choice.targetNodeKey}` : null
      if (endingConditionKey && !conditions.some(item => item.key === endingConditionKey)) conditions.push({
        key: endingConditionKey, title: `通往${choice.text}`, description: `玩家通过行动链选择了${choice.text}。`, tags: ['ending-route'],
      })
      const effects: AdventureEffect[] = [
        ...(targetLocationKey ? [{ op: 'enter-location' as const, locationKey: targetLocationKey }] : []),
        ...(endingConditionKey ? [
          { op: 'complete-objective' as const, questKey: 'quest.main', objectiveKey: 'objective.main.resolve' },
          { op: 'apply-condition' as const, conditionKey: endingConditionKey, duration: null },
        ] : []),
        { op: 'change-resource', resourceKey: clock.key, delta: Math.max(5, Math.round(60 / Math.max(1, narrativeNodes.length))) } as const,
      ]
      registerAction({
        key: `action.choice.${choice.choiceKey}`, kind: targetLocationKey ? 'move' : 'quest-action', label: choice.text,
        description: choice.description || `推进主线：${choice.text}`, locationKey,
        targetKey: targetLocationKey ?? null, requirements: [
          { questKey: 'quest.main', questStatus: 'active' },
          { narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: choice.sourceNodeKey },
        ],
        rule: { kind: 'automatic' }, successEffects: effects, costlySuccessEffects: [], failureEffects: [],
        successText: input.narrative.beats.filter(beat => beat.nodeKey === choice.targetNodeKey).map(beat => beat.text).join('\n') || choice.description || choice.text,
        costlySuccessText: `你付出代价后决定${choice.text}。`, failureText: `你暂时无法${choice.text}。`,
        unavailableText: choice.unavailableReason || '当前条件不允许这个选择。', repeatable: false,
        narrativeChoiceKey: choice.choiceKey, interaction: null,
      }, sceneKey)
    })
  })

  const quests: AdventureContentV2['quests'] = [{
    key: 'quest.main', title: input.architecture.title, description: input.architecture.premise,
    category: 'main', initialStatus: 'active', prerequisites: [], stages: mainStages, objectives: mainObjectives,
    rewardEffects: [
      { op: 'change-resource', resourceKey: experience.key, delta: 20 },
      { op: 'change-resource', resourceKey: skillPoints.key, delta: 1 },
    ], completionNodeKey: null, failureNodeKey: null,
  }]

  const storylets: AdventureContentV2['storylets'] = []
  const compileBundle = (bundle: TextAdventureQuestBundleArtifactV1) => {
    bundle.entries.forEach((entry, index) => {
      const location = locations[(entry.locationOrdinal - 1) % locations.length]
      const questKey = `quest.${bundle.bundleKind}.${entry.key}`
      const stageKey = `stage.${bundle.bundleKind}.${entry.key}`
      const objectiveKey = `objective.${bundle.bundleKind}.${entry.key}`
      const actionKey = `action.${bundle.bundleKind}.${entry.key}`
      const acceptActionKey = `action.accept.${bundle.bundleKind}.${entry.key}`
      const conditionKey = `condition.${bundle.bundleKind}.${entry.key}.resolved`
      conditions.push({ key: conditionKey, title: `${entry.title}已回应`, description: entry.failureText, tags: [bundle.bundleKind] })
      const rewardEffects: AdventureEffect[] = [
        { op: 'change-resource', resourceKey: experience.key, delta: entry.rewardExperience },
        { op: 'change-resource', resourceKey: currency.key, delta: entry.rewardCurrency },
      ]
      quests.push({
        key: questKey, title: entry.title, description: `${entry.hook}\n${entry.description}`,
        category: bundle.bundleKind, initialStatus: bundle.bundleKind === 'side' ? 'available' : 'active', prerequisites: [],
        stages: [{ key: stageKey, title: entry.title, objectiveKeys: [objectiveKey] }],
        objectives: [{ key: objectiveKey, stageKey, title: entry.objective, optional: bundle.bundleKind === 'ambient', alternativeActionKeys: [actionKey] }],
        rewardEffects, completionNodeKey: null, failureNodeKey: null,
      })
      if (bundle.bundleKind === 'side') registerAction({
        key: acceptActionKey, kind: 'quest-action', label: `接取：${entry.title}`,
        description: entry.hook, locationKey: location.key, targetKey: null,
        requirements: [{ questKey, questStatus: 'available' }], rule: { kind: 'automatic' },
        successEffects: [
          { op: 'accept-quest', questKey },
          { op: 'change-resource', resourceKey: clock.key, delta: 1 },
        ],
        costlySuccessEffects: [], failureEffects: [],
        successText: `${entry.hook}\n【系统】新任务：${entry.title}`,
        costlySuccessText: `你接下了${entry.title}，但需要重新安排时间。`,
        failureText: `你暂时无法接取${entry.title}。`, unavailableText: '这项支线已经接取或结束。',
        repeatable: false, narrativeChoiceKey: null, interaction: null,
      })
      const abilityKey = abilityKeys.has(entry.abilityKey) ? entry.abilityKey : fallbackAbilityKey
      const completionEffects: AdventureEffect[] = [
        { op: 'complete-objective', questKey, objectiveKey },
        { op: 'change-resource', resourceKey: clock.key, delta: entry.timeCostMinutes },
        { op: 'apply-condition', conditionKey, duration: null },
      ]
      registerAction({
        key: actionKey, kind: bundle.bundleKind === 'side' ? 'quest-action' : 'inspect',
        label: `${bundle.bundleKind === 'side' ? '执行' : '处理'}：${entry.title}`,
        description: `${entry.objective}\n${entry.description}`, locationKey: location.key, targetKey: null,
        requirements: [{ questKey, questStatus: 'active' }],
        rule: { kind: 'random', abilityKey, expression: '1d20', difficulty: entry.difficulty, costlySuccessFloor: Math.max(1, entry.difficulty - 4) },
        successEffects: completionEffects, costlySuccessEffects: [
          ...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 },
        ],
        failureEffects: contract.narrative.failForward ? [
          ...completionEffects, { op: 'change-resource', resourceKey: health.key, delta: -1 },
        ] : [{ op: 'change-resource', resourceKey: clock.key, delta: entry.timeCostMinutes }],
        successText: entry.successText, costlySuccessText: entry.costlySuccessText,
        failureText: entry.failureText, unavailableText: '这段内容当前尚未满足条件。',
        repeatable: false, narrativeChoiceKey: null, interaction: null,
      })
      storylets.push({
        key: `storylet.${bundle.bundleKind}.${entry.key}`, title: entry.title,
        actionKeys: bundle.bundleKind === 'side' ? [acceptActionKey, actionKey] : [actionKey],
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
  input.systems.starterEquipment.forEach(equipment => registerAction({
    key: `action.equip.${equipment.key}`, kind: 'use', label: `装备：${equipment.title}`,
    description: equipment.description, locationKey: entryLocationKey, targetKey: equipment.key,
    requirements: [{ itemKey: equipment.key, itemQuantity: 1 }], rule: { kind: 'automatic' },
    successEffects: [{ op: 'change-item-state', itemKey: equipment.key, state: 'equipped' }],
    costlySuccessEffects: [], failureEffects: [], successText: `你装备了${equipment.title}。`,
    costlySuccessText: `你勉强装备了${equipment.title}。`, failureText: `你暂时无法装备${equipment.title}。`,
    unavailableText: '装备不在背包中或槽位已被占用。', repeatable: true, narrativeChoiceKey: null, interaction: null,
  }, firstSceneForLocation.get(entryLocationKey)))

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
