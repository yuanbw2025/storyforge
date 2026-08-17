import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import { transactionTablesForReferences } from '../registry/lifecycle'
import { addNarrativeNode, createNarrativeModule } from '../narrative/blueprint'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinitionRecordInTransaction,
  validateStoryGameContent,
} from '../text-game/content'
import { publishGameDefinition } from '../text-game/releases'
import { validateInteractionGameDraft, type InteractionDraftReport } from '../character-interaction/authoring'
import { parseAdventureContent, validateAdventureContent, type AdventureContentReport } from '../adventure/runtime'
import { createNarrativeSimulationAcceptanceContent } from '../narrative-simulation/authoring'
import { parseNarrativeSimulationContent, validateNarrativeSimulationContent } from '../narrative-simulation/runtime'
import type {
  AdventureContentV1,
  AdventureModule,
  Character,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  GameDefinition,
  GameRelease,
  InteractionCharacterProfile,
  InteractionSceneTemplate,
  NarrativeContentGraphReport,
  NarrativeModule,
  NarrativeNode,
  NarrativeSimulationContentV1,
  NarrativeSimulationModule,
  NarrativeSimulationValidationReport,
  OpenWorldContentV1,
  OpenWorldModule,
  OpenWorldValidationReport,
  WorkspaceScope,
  WorldRelease,
  WorldRevision,
} from '../types'
import { createWorldRevision, listWorldRevisions, publishWorldRevision } from '../world-engine/releases'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { parseOpenWorldContent, validateOpenWorldContent } from './runtime'

export interface TextOpenWorldAuthoringSnapshot {
  definitions: GameDefinition[]
  narrativeModules: NarrativeModule[]
  narrativeNodes: NarrativeNode[]
  openWorldModules: OpenWorldModule[]
  adventureModules: AdventureModule[]
  simulationModules: NarrativeSimulationModule[]
  profiles: InteractionCharacterProfile[]
  scenes: InteractionSceneTemplate[]
  releases: GameRelease[]
}

export interface TextOpenWorldDraftReport {
  valid: boolean
  narrative: NarrativeContentGraphReport
  interaction: InteractionDraftReport
  adventure: AdventureContentReport
  simulation: NarrativeSimulationValidationReport
  openWorld: OpenWorldValidationReport
  errors: string[]
  warnings: string[]
}

export interface TextOpenWorldPublication {
  report: TextOpenWorldDraftReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

export interface TextOpenWorldAcceptanceBundle {
  adventure: AdventureContentV1
  simulation: NarrativeSimulationContentV1
  openWorld: OpenWorldContentV1
  participantKeys: string[]
}

async function definitionInScope(scope: WorkspaceScope, id: number): Promise<GameDefinition> {
  const definition = await db.gameDefinitions.get(id)
  if (!definition || definition.productType !== 'text-open-world'
    || !await assertRecordInScope(scope, 'gameDefinitions', definition, { owner: 'work' })) {
    throw new Error('[textworld] 游戏定义不属于当前 Work')
  }
  return definition
}

export async function loadTextOpenWorldAuthoringSnapshot(
  inputScope: WorkspaceScope,
): Promise<TextOpenWorldAuthoringSnapshot> {
  const scope = await resolveScope({ scope: inputScope })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId
      && row.productType === 'text-open-world')
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const ids = definitions.flatMap(row => row.id == null ? [] : [row.id])
  const moduleIds = definitions.map(row => row.narrativeModuleId)
  const [narrativeModules, narrativeNodes, openWorldModules, adventureModules, simulationModules, profiles, scenes, releases] = await Promise.all([
    Promise.all(moduleIds.map(id => db.narrativeModules.get(id))).then(rows => rows.filter((row): row is NarrativeModule => !!row)),
    moduleIds.length ? db.narrativeNodes.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    ids.length ? db.openWorldModules.where('gameDefinitionId').anyOf(ids).toArray() : [],
    ids.length ? db.adventureModules.where('gameDefinitionId').anyOf(ids).toArray() : [],
    ids.length ? db.narrativeSimulationModules.where('gameDefinitionId').anyOf(ids).toArray() : [],
    ids.length ? db.interactionCharacterProfiles.where('gameDefinitionId').anyOf(ids).toArray() : [],
    ids.length ? db.interactionSceneTemplates.where('gameDefinitionId').anyOf(ids).sortBy('order') : [],
    ids.length ? db.gameReleases.where('workId').equals(scope.workId)
      .filter(row => ids.includes(row.gameDefinitionId ?? -1)).toArray() : [],
  ])
  return { definitions, narrativeModules, narrativeNodes, openWorldModules, adventureModules, simulationModules, profiles, scenes, releases: releases.sort((left, right) => right.version - left.version) }
}

export async function createTextOpenWorldGame(input: {
  scope: WorkspaceScope
  title: string
  gameKey?: string
  adventure: AdventureContentV1 | string
  simulation: NarrativeSimulationContentV1 | string
  openWorld: OpenWorldContentV1 | string
  participants: Array<{ characterId: number; participantKey: string }>
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const title = input.title.trim()
  if (!title) throw new Error('[textworld] 标题不能为空')
  const adventure = parseAdventureContent(input.adventure)
  const simulation = parseNarrativeSimulationContent(input.simulation)
  const openWorld = parseOpenWorldContent(input.openWorld)
  const participantKeys = input.participants.map(item => item.participantKey.trim())
  if (!participantKeys.length || new Set(participantKeys).size !== participantKeys.length) {
    throw new Error('[textworld] 参与者映射不能为空或重复')
  }
  const characters = await Promise.all(input.participants.map(async mapping => {
    const character = await db.characters.get(mapping.characterId)
    if (!character || !await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) {
      throw new Error('[textworld] 参与者角色不属于当前 World')
    }
    return character
  }))
  const profilePreview = input.participants.map((mapping, index): FrozenInteractionCharacterProfile => ({
    participantKey: mapping.participantKey,
    characterKey: `character:${index}`,
    name: characters[index].name,
    roleLabel: characters[index].shortDescription.trim() || '区域关键人物',
    voiceRules: characters[index].speechStyle?.trim() || '只陈述自己能够知道的区域事实。',
    initialKnowledge: [{ key: `profile.${mapping.participantKey}`, content: `${characters[index].name}熟悉自己的常驻区域。`, visibility: 'public', importance: 50 }],
    relationshipDimensions: [{ key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 }],
    maxMemoryEntries: 24,
  }))
  const scenePreview: FrozenInteractionSceneTemplate[] = [{
    sceneKey: 'regional-conversation', title: `${title} · 区域交谈`, purpose: '承载区域任务发现与事实边界内的角色互动。',
    location: '当前焦点区域', timeLabel: '世界推进中', participantKeys, publicKnowledgeKeys: participantKeys.map(key => `profile.${key}`),
    goals: ['询问区域变化与任务线索'], endingConditions: ['玩家结束交谈'], safetyBoundaries: ['不替玩家决定行动', '不越过角色知识边界'],
    relationshipRules: [], openingNodeKey: 'entry', endingNodeKey: null, maxTurns: 20, directorBudget: 1, order: 0,
  }]
  const report = validateOpenWorldContent({
    content: openWorld,
    adventure,
    interactionProfiles: profilePreview,
    interactionScenes: scenePreview,
    simulation,
    narrativeNodeKeys: ['entry', 'ending'],
  })
  if (!report.valid) throw new Error(`[textworld] 开放世界内容无效:${report.errors.join('；')}`)
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
    db.gameDefinitions, db.openWorldModules, db.adventureModules, db.narrativeSimulationModules,
    db.interactionCharacterProfiles, db.interactionSceneTemplates, db.characters, db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({ scope, owner: 'work', kind: 'main', title })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '世界旅程', summary: '在区域之间行动，处理动态任务并维持世界长期演进。', successorKeys: ['ending'], order: 0 })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '世界主线完成', summary: '关键区域任务已经完成，世界进入新的稳定阶段。', order: 1 })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.world', kind: 'system', text: '区域、人物、组织与问题按离散 tick 推进；每个事实都可以从事件流重放。', order: 0 })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'ending', beatKey: 'ending.world', kind: 'narration', text: '你完成了开放世界的关键主线，但各区域仍保留可追溯的后续状态。', order: 0 })
    const endingCondition = JSON.stringify({ path: 'openWorld.mainlineReady', eq: true })
    await addNarrativeChoice({ scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'ending.world', text: '完成世界主线', description: '只有全部受保护主线任务完成后才可进入。', unavailableReason: '主线任务尚未完成。', targetNodeKey: 'ending', displayConditionJson: endingCondition, availableConditionJson: endingCondition, order: 0 })
    const definition = await createGameDefinition({
      scope,
      gameKey: input.gameKey?.trim() || `textworld-${Date.now().toString(36)}`,
      title,
      description: '区域、NPC、组织、动态任务导演和长期模拟共享统一事件运行时。',
      narrativeModuleId: module.id!,
      productType: 'text-open-world',
    })
    const now = Date.now()
    await db.openWorldModules.add(stampNewRecord(scope, 'openWorldModules', { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!, contentJson: JSON.stringify(openWorld), createdAt: now, updatedAt: now } satisfies OpenWorldModule, { owner: 'work' }))
    await db.adventureModules.add(stampNewRecord(scope, 'adventureModules', { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!, contentJson: JSON.stringify(adventure), createdAt: now, updatedAt: now } satisfies AdventureModule, { owner: 'work' }))
    await db.narrativeSimulationModules.add(stampNewRecord(scope, 'narrativeSimulationModules', { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!, contentJson: JSON.stringify(simulation), createdAt: now, updatedAt: now } satisfies NarrativeSimulationModule, { owner: 'work' }))
    for (const [index, mapping] of input.participants.entries()) {
      const preview = profilePreview[index]
      await db.interactionCharacterProfiles.add(stampNewRecord(scope, 'interactionCharacterProfiles', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!,
        characterId: mapping.characterId, participantKey: preview.participantKey, roleLabel: preview.roleLabel, voiceRules: preview.voiceRules,
        initialKnowledgeJson: JSON.stringify(preview.initialKnowledge), relationshipDimensionsJson: JSON.stringify(preview.relationshipDimensions),
        maxMemoryEntries: preview.maxMemoryEntries, createdAt: now + index, updatedAt: now + index,
      } satisfies InteractionCharacterProfile, { owner: 'work' }))
    }
    const scene = scenePreview[0]
    await db.interactionSceneTemplates.add(stampNewRecord(scope, 'interactionSceneTemplates', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!,
      sceneKey: scene.sceneKey, title: scene.title, purpose: scene.purpose, location: scene.location, timeLabel: scene.timeLabel,
      participantKeysJson: JSON.stringify(scene.participantKeys), publicKnowledgeKeysJson: JSON.stringify(scene.publicKnowledgeKeys),
      goalsJson: JSON.stringify(scene.goals), endingConditionsJson: JSON.stringify(scene.endingConditions), safetyBoundariesJson: JSON.stringify(scene.safetyBoundaries),
      relationshipRulesJson: JSON.stringify(scene.relationshipRules), openingNodeKey: scene.openingNodeKey, endingNodeKey: scene.endingNodeKey,
      maxTurns: scene.maxTurns, directorBudget: scene.directorBudget, order: scene.order, createdAt: now, updatedAt: now,
    } satisfies InteractionSceneTemplate, { owner: 'work' }))
    return definition
  })
}

export async function saveTextOpenWorldContent(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  content: OpenWorldContentV1 | string
}): Promise<OpenWorldModule> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const contentJson = JSON.stringify(parseOpenWorldContent(input.content))
  const module = await db.openWorldModules.where('gameDefinitionId').equals(input.gameDefinitionId).first()
  if (!module || !await assertRecordInScope(scope, 'openWorldModules', module, { owner: 'work' })) throw new Error('[textworld] 开放世界内容模块不存在')
  const updated = { ...module, contentJson, updatedAt: Date.now() }
  await db.openWorldModules.put(updated)
  return updated
}

export async function saveTextOpenWorldBundle(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  adventure: AdventureContentV1 | string
  simulation: NarrativeSimulationContentV1 | string
  openWorld: OpenWorldContentV1 | string
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const adventureJson = JSON.stringify(parseAdventureContent(input.adventure))
  const simulationJson = JSON.stringify(parseNarrativeSimulationContent(input.simulation))
  const openWorldJson = JSON.stringify(parseOpenWorldContent(input.openWorld))
  await db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.adventureModules, db.narrativeSimulationModules, db.openWorldModules), async () => {
    const [adventure, simulation, openWorld] = await Promise.all([
      db.adventureModules.where('gameDefinitionId').equals(input.gameDefinitionId).first(),
      db.narrativeSimulationModules.where('gameDefinitionId').equals(input.gameDefinitionId).first(),
      db.openWorldModules.where('gameDefinitionId').equals(input.gameDefinitionId).first(),
    ])
    if (!adventure || !simulation || !openWorld) throw new Error('[textworld] 三个共享内容模块必须同时存在')
    const updatedAt = Date.now()
    await Promise.all([
      db.adventureModules.update(adventure.id!, { contentJson: adventureJson, updatedAt }),
      db.narrativeSimulationModules.update(simulation.id!, { contentJson: simulationJson, updatedAt }),
      db.openWorldModules.update(openWorld.id!, { contentJson: openWorldJson, updatedAt }),
    ])
  })
}

function freezeProfiles(profiles: InteractionCharacterProfile[], characters: Character[]): FrozenInteractionCharacterProfile[] {
  return profiles.map(profile => ({
    participantKey: profile.participantKey,
    characterKey: `character:${profile.characterId}`,
    name: characters.find(character => character.id === profile.characterId)?.name ?? '',
    roleLabel: profile.roleLabel,
    voiceRules: profile.voiceRules,
    initialKnowledge: JSON.parse(profile.initialKnowledgeJson),
    relationshipDimensions: JSON.parse(profile.relationshipDimensionsJson),
    maxMemoryEntries: profile.maxMemoryEntries,
  }))
}

function freezeScenes(scenes: InteractionSceneTemplate[]): FrozenInteractionSceneTemplate[] {
  return scenes.map(scene => ({
    sceneKey: scene.sceneKey, title: scene.title, purpose: scene.purpose, location: scene.location, timeLabel: scene.timeLabel,
    participantKeys: JSON.parse(scene.participantKeysJson), publicKnowledgeKeys: JSON.parse(scene.publicKnowledgeKeysJson),
    goals: JSON.parse(scene.goalsJson), endingConditions: JSON.parse(scene.endingConditionsJson), safetyBoundaries: JSON.parse(scene.safetyBoundariesJson),
    relationshipRules: JSON.parse(scene.relationshipRulesJson ?? '[]'), openingNodeKey: scene.openingNodeKey ?? null, endingNodeKey: scene.endingNodeKey ?? null,
    maxTurns: scene.maxTurns, directorBudget: scene.directorBudget, order: scene.order,
  }))
}

export async function validateTextOpenWorldGame(inputScope: WorkspaceScope, gameDefinitionId: number): Promise<TextOpenWorldDraftReport> {
  const scope = await resolveScope({ scope: inputScope })
  const definition = await definitionInScope(scope, gameDefinitionId)
  const [narrative, interaction, openWorldRow, adventureRow, simulationRow, nodes, profiles, scenes, characters] = await Promise.all([
    validateStoryGameContent(scope, definition.narrativeModuleId),
    validateInteractionGameDraft(scope, definition.id!),
    db.openWorldModules.where('gameDefinitionId').equals(definition.id!).first(),
    db.adventureModules.where('gameDefinitionId').equals(definition.id!).first(),
    db.narrativeSimulationModules.where('gameDefinitionId').equals(definition.id!).first(),
    db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).toArray(),
    db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).toArray(),
    db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).toArray(),
    db.characters.where('projectId').equals(scope.projectId).toArray(),
  ])
  const adventure = adventureRow ? validateAdventureContent(parseAdventureContent(adventureRow.contentJson))
    : { valid: false, errors: ['冒险内容模块不存在'], warnings: [], unreachableLocationKeys: [], unavailableQuestKeys: [], sourceLessItemKeys: [] }
  const simulation = simulationRow ? validateNarrativeSimulationContent({ content: simulationRow.contentJson, narrativeNodeKeys: nodes.map(node => node.key) })
    : { valid: false, errors: ['模拟内容模块不存在'], warnings: [], duplicateKeys: [], missingReferences: [], dominatedActionKeys: [], unboundedGrowthKeys: [], conservedMutationKeys: [], unsolvedCrisisKeys: [], unreachableEndingKeys: [] }
  let openWorld: OpenWorldValidationReport = { valid: false, errors: ['开放世界内容模块不存在'], warnings: [], duplicateKeys: [], missingReferences: [], unreachableRegionKeys: [], unreachableMainlineQuestKeys: [], taskFloodRegionKeys: [], unboundedPropagationRuleKeys: [], invalidProtectedReferenceKeys: [], duplicateFingerprintKeys: [] }
  if (openWorldRow && adventureRow && simulationRow) {
    openWorld = validateOpenWorldContent({ content: openWorldRow.contentJson, adventure: parseAdventureContent(adventureRow.contentJson), interactionProfiles: freezeProfiles(profiles, characters), interactionScenes: freezeScenes(scenes), simulation: parseNarrativeSimulationContent(simulationRow.contentJson), narrativeNodeKeys: nodes.map(node => node.key) })
  }
  const interactionErrors = interaction.diagnostics.filter(item => item.severity === 'error').map(item => item.message)
  const errors = [...narrative.errors, ...interactionErrors, ...adventure.errors, ...simulation.errors, ...openWorld.errors]
  return { valid: narrative.valid && interaction.valid && adventure.valid && simulation.valid && openWorld.valid && errors.length === 0, narrative, interaction, adventure, simulation, openWorld, errors, warnings: [...adventure.warnings, ...simulation.warnings, ...openWorld.warnings] }
}

export async function publishTextOpenWorldGame(input: { scope: WorkspaceScope; gameDefinitionId: number; label?: string }): Promise<TextOpenWorldPublication> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  const report = await validateTextOpenWorldGame(scope, definition.id!)
  if (!report.valid) throw new Error(`[textworld] 内容不可发布:${report.errors.join('；')}`)
  const latest = (await listWorldRevisions(scope))[0]
  const label = input.label?.trim() || `${definition.title} · 开放世界发布`
  const revision = await createWorldRevision({ scope, label, parentRevisionId: latest?.id ?? null, selectedNarrativeModuleIds: [definition.narrativeModuleId] })
  const worldRelease = await publishWorldRevision(revision.id!, label)
  const gameRelease = await publishGameDefinition({ scope, gameDefinitionId: definition.id!, worldReleaseId: worldRelease.id!, label })
  return { report, revision, worldRelease, gameRelease }
}

export async function deleteTextOpenWorldGameDraft(input: { scope: WorkspaceScope; gameDefinitionId: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  await db.transaction('rw', scopeTransactionTables(...transactionTablesForReferences('gameDefinitions'), ...transactionTablesForReferences('narrativeModules')), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await definitionInScope(currentScope, definition.id!)
    const consumers = await db.gameDefinitions.where('narrativeModuleId').equals(current.narrativeModuleId).toArray()
    await deleteGameDefinitionRecordInTransaction(currentScope, current.id!)
    if (consumers.length === 1 && consumers[0].id === current.id) {
      await db.narrativeNodes.where('moduleId').equals(current.narrativeModuleId).delete()
      await db.narrativeBeats.where('moduleId').equals(current.narrativeModuleId).delete()
      await db.narrativeChoices.where('moduleId').equals(current.narrativeModuleId).delete()
      await db.narrativeModules.delete(current.narrativeModuleId)
    }
  })
}

export function createTextOpenWorldAcceptanceBundle(): TextOpenWorldAcceptanceBundle {
  const participantKeys = Array.from({ length: 20 }, (_, index) => `npc.${String(index + 1).padStart(2, '0')}`)
  const regionKeys = Array.from({ length: 5 }, (_, index) => `region.${index + 1}`)
  const organizationKeys = ['council', 'guild', 'residents', 'watch', 'auditors']
  const baseSimulation = createNarrativeSimulationAcceptanceContent()
  const simulation: NarrativeSimulationContentV1 = {
    ...baseSimulation,
    turnLimit: 1_000,
    actors: baseSimulation.actors.map(actor => ({ ...actor, kind: 'organization' as const })),
    endings: [{ key: 'world-horizon', title: '千回合地平线', description: '世界完成了一千回合的可回放演进。', narrativeNodeKey: 'ending', priority: 100, conditions: [{ source: 'turn', operator: 'gte', value: 1_000 }] }],
  }
  const locations = regionKeys.map((key, index) => ({ key, title: `第${index + 1}区域`, description: `第${index + 1}区域拥有独立资源、问题与角色日程。`, tags: ['open-world'] }))
  const moveActions: AdventureContentV1['actions'] = regionKeys.map((from, index) => {
    const to = regionKeys[(index + 1) % regionKeys.length]
    return { key: `move.${index + 1}`, kind: 'move', label: `前往第${(index + 1) % regionKeys.length + 1}区域`, description: '由开放世界交通命令实际执行的共享位置边。', locationKey: from, targetKey: to, requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'enter-location', locationKey: to }], costlySuccessEffects: [], failureEffects: [], successText: '你抵达下一区域。', costlySuccessText: '你付出代价后抵达。', failureText: '道路暂不可用。', unavailableText: '必须通过区域旅行。', repeatable: true, narrativeChoiceKey: null }
  })
  const questKeys = [
    ...Array.from({ length: 30 }, (_, index) => `fixed.quest.${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 10 }, (_, index) => `template.quest.${String(index + 1).padStart(2, '0')}`),
  ]
  const resolveActions: AdventureContentV1['actions'] = questKeys.map((questKey, index) => ({
    key: `resolve.${questKey}`, kind: 'quest-action', label: `解决任务 ${index + 1}`, description: '完成动态导演冻结到实例中的任务目标。', locationKey: index < 30 ? (index < 6 ? regionKeys[0] : regionKeys[1 + Math.floor((index - 6) / 6)]) : regionKeys[(index - 30) % 5], targetKey: null,
    requirements: [{ questKey, questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'complete-objective', questKey, objectiveKey: 'resolve' }], costlySuccessEffects: [], failureEffects: [], successText: '任务目标已经解决。', costlySuccessText: '任务付出代价后解决。', failureText: '任务仍未解决。', unavailableText: '任务尚未通过区域导演接受。', repeatable: false, narrativeChoiceKey: null,
  }))
  const adventure: AdventureContentV1 = parseAdventureContent({
    version: 1, initialLocationKey: regionKeys[0], playerKey: 'player', locations, objects: [], items: [],
    abilities: [{ key: 'resolve', title: '处理', description: '处理区域任务的基础能力。', initial: 2, minimum: 0, maximum: 10 }],
    conditions: [], resources: [{ key: 'stamina', title: '行动力', initial: 10, minimum: 0, maximum: 10 }],
    quests: questKeys.map((questKey, index) => ({ key: questKey, title: `区域任务 ${index + 1}`, description: '由动态任务导演选择渠道并冻结为运行实例。', initialStatus: 'available', prerequisites: [], objectives: [{ key: 'resolve', title: '解决区域矛盾', optional: false, alternativeActionKeys: [`resolve.${questKey}`] }], rewardEffects: [], completionNodeKey: null, failureNodeKey: null })),
    actions: [...moveActions, ...resolveActions], initialInventory: [],
  })
  const channels = regionKeys.flatMap((regionKey, regionIndex) => Array.from({ length: 4 }, (_, channelIndex) => ({
    key: `channel.${regionIndex + 1}.${channelIndex + 1}`, regionKey,
    kind: (['conversation', 'rumor', 'notice', 'encounter'] as const)[channelIndex], title: `区域渠道 ${regionIndex + 1}-${channelIndex + 1}`,
    participantKey: participantKeys[regionIndex * 4 + channelIndex], triggers: ['observe', 'social', 'explore', 'rest', 'travel', 'combat'] as const,
    textTemplate: '你通过区域渠道发现了一项可核验的新任务。',
  })))
  const fixedTaskCards: OpenWorldContentV1['fixedTaskCards'] = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1
    const regionKey = index < 6 ? regionKeys[0] : regionKeys[1 + Math.floor((index - 6) / 6)]
    const mainline = index < 5
    return {
      key: `fixed.card.${String(number).padStart(2, '0')}`, questKey: `fixed.quest.${String(number).padStart(2, '0')}`, regionKey,
      category: mainline ? 'mainline' : (['issue', 'character', 'exploration', 'growth', 'resource'] as const)[index % 5], sourceIssueKey: ['housing', 'unrest', 'supply'][index % 3],
      title: `固定区域任务 ${number}`, description: '由作者固定设计、由确定性导演按区域压力揭示。', participantKeys: [participantKeys[index % participantKeys.length]],
      allowedSolutions: ['resolve'], rewardBudget: 10, intensity: mainline ? 4 : index % 5 + 1, basePriority: mainline ? 40 - index : 10 + index % 7,
      critical: mainline, guaranteedByTick: mainline ? (index + 1) * 5 : null, unique: true, cooldownTicks: 5, expirationTicks: mainline ? null : 20,
      allowedChannelKeys: channels.filter(channel => channel.regionKey === regionKey).map(channel => channel.key), requirements: [], declineEffects: [], expirationEffects: [], supersedeConditions: [],
      fingerprint: { family: `fixed-${number}`, initiatorKey: participantKeys[index % 20], targetKey: regionKey, conflictKey: `conflict-${index % 7}`, solutionKey: 'resolve', rewardType: 'regional-stability' },
    }
  })
  const taskTemplates: OpenWorldContentV1['taskTemplates'] = Array.from({ length: 10 }, (_, index) => ({
    key: `template.${String(index + 1).padStart(2, '0')}`, adventureQuestKey: `template.quest.${String(index + 1).padStart(2, '0')}`, regionKeys: [regionKeys[index % 5]],
    category: (['issue', 'character', 'exploration', 'resource', 'consequence'] as const)[index % 5], sourceIssueKey: ['housing', 'unrest', 'supply'][index % 3],
    titleTemplate: '{region}的临时委托', descriptionTemplate: '处理{region}刚刚出现的区域矛盾。', participantKeys: [participantKeys[(index + 10) % 20]],
    allowedSolutions: ['resolve'], rewardBudget: 8, intensity: index % 3 + 1, basePriority: 8, cooldownTicks: 10, expirationTicks: 15,
    allowedChannelKinds: ['conversation', 'rumor', 'notice', 'encounter'], requirements: [], declineEffects: [], expirationEffects: [],
    fingerprint: { family: `template-${index + 1}`, initiatorKey: participantKeys[(index + 10) % 20], targetKey: 'regional-issue', conflictKey: `issue-${index % 3}`, solutionKey: 'resolve', rewardType: 'regional-resource' },
  }))
  const openWorld: OpenWorldContentV1 = parseOpenWorldContent({
    version: 1, initialRegionKey: regionKeys[0], tickLimit: 1_000, simulationCadenceTicks: 5, maxPropagationEdgesPerTick: 3,
    regions: regionKeys.map((key, index) => ({ key, title: `第${index + 1}区域`, description: '具有独立关注级别和后台演进状态。', parentKey: null, locationKey: key, tags: ['acceptance'], initialKnowledge: index === 0 ? 'visited' : 'heard', initialAttention: index === 0 ? 'focus' : index === 1 || index === 4 ? 'active' : 'background', residentParticipantKeys: participantKeys.slice(index * 4, index * 4 + 4), organizationKeys, channelKeys: channels.filter(channel => channel.regionKey === key).map(channel => channel.key), initialResources: { funds: 120, labor: 90, districts: 12 }, initialMetrics: { stability: 55, welfare: 52, legitimacy: 50 }, initialIssuePressures: { housing: 30, unrest: 24, supply: 22 }, initialOrganizationInfluence: Object.fromEntries(organizationKeys.map(org => [org, 0])), nextScheduledTick: 1 })),
    travelEdges: regionKeys.map((fromRegionKey, index) => ({ key: `edge.${index + 1}`, fromRegionKey, toRegionKey: regionKeys[(index + 1) % 5], bidirectional: true, travelTicks: index % 2 + 1, risk: index * 5, blockedByIssueKey: index === 2 ? 'unrest' : null, blockedAtPressure: index === 2 ? 90 : null })),
    discoveryChannels: channels,
    fixedTaskCards,
    taskTemplates,
    decks: regionKeys.map(regionKey => ({ regionKey, fixedCardKeys: fixedTaskCards.filter(card => card.regionKey === regionKey).map(card => card.key), templateKeys: taskTemplates.filter(template => template.regionKeys.includes(regionKey)).map(template => template.key), categoryQuotas: { mainline: 5, issue: 2, character: 2, exploration: 2, growth: 2, resource: 2, crisis: 1, consequence: 1 }, maxRevealed: 6, maxActive: 3, cooldownTicks: 2, recentWindow: 20, blankWeight: 0, highIntensityStreakLimit: 3 })),
    actorSchedules: [
      ...participantKeys.map((actorKey, index) => ({ key: `schedule.${actorKey}`, actorKey, actorKind: 'participant' as const, periodTicks: 7 + index % 5, offsetTicks: index % 7, regionCycle: [regionKeys[Math.floor(index / 4)], regionKeys[(Math.floor(index / 4) + 1) % 5]], effects: [], summary: '关键人物按确定性日程在相邻区域活动。' })),
      ...organizationKeys.map((actorKey, index) => ({ key: `schedule.org.${actorKey}`, actorKey, actorKind: 'organization' as const, periodTicks: 5 + index, offsetTicks: index, regionCycle: regionKeys, effects: [{ op: 'change-organization-influence' as const, regionKey: '$actor-region', organizationKey: actorKey, delta: 0 }], summary: '组织在各区域进行可回放的例行行动。' })),
    ],
    regionalIssueRules: ['housing', 'unrest', 'supply'].map((issueKey, index) => ({ key: `propagation.${issueKey}`, issueKey, regionKeys, driftPerTick: index === 0 ? 1 : 0, propagationThreshold: 60 + index * 5, propagationFraction: 0.1, propagationCap: 5, cooldownTicks: 5 })),
    mainline: { questKeys: fixedTaskCards.slice(0, 5).map(card => card.questKey), protectedParticipantKeys: participantKeys.slice(0, 5), protectedEdgeKeys: regionKeys.map((_, index) => `edge.${index + 1}`), latestRevealTick: 30, endingNodeKey: 'ending' },
    director: { globalMaxRevealed: 6, globalMaxActive: 3, maxQuestInstances: 128, randomJitter: 3, criticalGuaranteeBonus: 100, backlogPenalty: 5, freshnessPenalty: 10 },
  })
  return { adventure, simulation, openWorld, participantKeys }
}

export async function seedTextOpenWorldAcceptanceGame(input: { scope: WorkspaceScope }): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, 'five-regions-textworld']).first()
  if (existing) return existing
  const bundle = createTextOpenWorldAcceptanceBundle()
  const adopted = await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characters',
    mode: 'add-many',
    data: bundle.participantKeys.map((participantKey, index) => ({
      name: `区域人物 ${String(index + 1).padStart(2, '0')}`, role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${participantKey} 是第${Math.floor(index / 4) + 1}区域的关键见证人。`, appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', speechStyle: '只根据自己所在区域的知识和已经发生的事件回应。',
    })),
  })
  if (adopted.written.length !== bundle.participantKeys.length) {
    throw new Error(`[textworld] 验收角色创建失败:${adopted.skipped.map(item => item.reason).join('；')}`)
  }
  return createTextOpenWorldGame({
    scope,
    title: '五区长路',
    gameKey: 'five-regions-textworld',
    adventure: bundle.adventure,
    simulation: bundle.simulation,
    openWorld: bundle.openWorld,
    participants: adopted.written.map((character, index) => ({ characterId: character.id, participantKey: bundle.participantKeys[index] })),
  })
}
