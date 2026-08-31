import { db } from '../db/schema'
import { transactionTablesForReferences } from '../registry/lifecycle'
import { addNarrativeNode, createNarrativeModule } from '../narrative/blueprint'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinitionRecordInTransaction,
  parseGameDefinitionWorldSource,
  validateStoryGameContent,
} from '../text-game/content'
import { publishGameDefinition } from '../text-game/releases'
import type {
  AdventureContentV1,
  AdventureModule,
  GameDefinition,
  GameRelease,
  InteractionCharacterProfile,
  InteractionSceneTemplate,
  NarrativeContentGraphReport,
  NarrativeModule,
  NarrativeNode,
  WorkspaceScope,
  WorldRelease,
  WorldRevision,
} from '../types'
import { validateInteractionGameDraft, type InteractionDraftReport } from '../character-interaction/authoring'
import { createInteractionSourceCharacterSnapshot } from '../character-interaction/source-character'
import { adopt } from '../registry/adopt'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { createWorldRevision, listWorldRevisions, publishWorldRevision } from '../world-engine/releases'
import { parseAdventureContent, validateAdventureContent, type AdventureContentReport } from './runtime'

export interface AdventureAuthoringSnapshot {
  definitions: GameDefinition[]
  modules: NarrativeModule[]
  nodes: NarrativeNode[]
  adventureModules: AdventureModule[]
  releases: GameRelease[]
}

export interface AdventureDraftReport {
  valid: boolean
  adventure: AdventureContentReport
  narrative: NarrativeContentGraphReport
  interaction: InteractionDraftReport
  errors: string[]
  warnings: string[]
}

export interface AdventurePublication {
  report: AdventureDraftReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

async function definitionInScope(scope: WorkspaceScope, id: number): Promise<GameDefinition> {
  const row = await db.gameDefinitions.get(id)
  if (!row || row.productType !== 'text-adventure'
    || !await assertRecordInScope(scope, 'gameDefinitions', row, { owner: 'work' })) {
    throw new Error('[adventure] 冒险定义不属于当前 Work')
  }
  return row
}

export async function loadAdventureAuthoringSnapshot(value: WorkspaceScope): Promise<AdventureAuthoringSnapshot> {
  const scope = await resolveScope({ scope: value })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(item => item.worldId === scope.worldId && item.productType === 'text-adventure')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const ids = definitions.flatMap(item => item.id == null ? [] : [item.id])
  const moduleIds = [...new Set(definitions.map(item => item.narrativeModuleId))]
  const [adventureModules, modules, nodes, releases] = await Promise.all([
    ids.length ? db.adventureModules.where('gameDefinitionId').anyOf(ids).toArray() : [],
    Promise.all(moduleIds.map(id => db.narrativeModules.get(id))),
    moduleIds.length ? db.narrativeNodes.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    db.gameReleases.where('workId').equals(scope.workId).toArray(),
  ])
  return {
    definitions,
    modules: modules.filter((item): item is NarrativeModule => item != null),
    nodes,
    adventureModules,
    releases: releases.filter(item => item.worldId === scope.worldId && ids.includes(item.gameDefinitionId ?? -1))
      .sort((a, b) => b.version - a.version),
  }
}

export async function createAdventureGame(input: {
  scope: WorkspaceScope
  title: string
  gameKey?: string
  content: AdventureContentV1
  interactionCharacters?: Array<{
    characterId?: number | null
    participantKey: string
    relationSummary?: string
    sourceCharacter?: {
      worldContentHash: string
      characterExportId: number
      name: string
      description?: string
      voiceRules?: string
    }
  }>
  sourceWorldContentHash?: string
  sourceSelectionJson?: string
  sourceMappingVersion?: number
  /** Reuse an already governed Work-owned Narrative projection instead of creating the generic starter graph. */
  narrativeModuleId?: number
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const content = parseAdventureContent(input.content)
  const title = input.title.trim()
  if (!title) throw new Error('[adventure] 标题不能为空')
  const talkBindings = content.actions.flatMap(action => action.interaction ? [action.interaction] : [])
  const mappings = input.interactionCharacters ?? []
  const mappingByParticipant = new Map(mappings.map(item => [item.participantKey, item]))
  if (mappingByParticipant.size !== mappings.length) throw new Error('[adventure] 互动角色 participantKey 不得重复')
  for (const mapping of mappings) {
    const hasLiveCharacter = Number.isInteger(mapping.characterId) && Number(mapping.characterId) > 0
    const hasSourceCharacter = mapping.sourceCharacter != null
    if (hasLiveCharacter === hasSourceCharacter) {
      throw new Error(`[adventure] 互动角色必须且只能绑定实时角色或冻结来源:${mapping.participantKey}`)
    }
  }
  for (const binding of talkBindings) {
    if (!mappingByParticipant.has(binding.participantKey)) {
      throw new Error(`[adventure] talk 行动缺少世界角色映射:${binding.participantKey}`)
    }
  }
  const liveCharacterIds = [...new Set(mappings.flatMap(item => (
    Number.isInteger(item.characterId) && Number(item.characterId) > 0 ? [Number(item.characterId)] : []
  )))]
  const characters = await Promise.all(liveCharacterIds.map(async id => {
    const character = await db.characters.get(id)
    if (!character || !await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) {
      throw new Error('[adventure] 互动角色不属于当前 World')
    }
    return character
  }))
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
    db.gameDefinitions, db.adventureModules, db.interactionCharacterProfiles,
    db.interactionSceneTemplates, db.outlineNodes, db.characters,
  ), async () => {
    let module: NarrativeModule
    if (input.narrativeModuleId != null) {
      const current = await db.narrativeModules.get(input.narrativeModuleId)
      if (!current || !await assertRecordInScope(scope, 'narrativeModules', current, { owner: 'work' })) {
        throw new Error('[adventure] 来源 Narrative 不属于当前 Work')
      }
      module = current
    } else {
      module = await createNarrativeModule({ scope, owner: 'work', kind: 'quest', title })
      await addNarrativeNode({ scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '冒险开始', successorKeys: ['victory', 'alternate', 'failure'], order: 0 })
      await addNarrativeNode({ scope, moduleId: module.id!, key: 'victory', kind: 'ending', title: '圆满结局', order: 1 })
      await addNarrativeNode({ scope, moduleId: module.id!, key: 'alternate', kind: 'ending', title: '代价结局', order: 2 })
      await addNarrativeNode({ scope, moduleId: module.id!, key: 'failure', kind: 'ending', title: '失落结局', order: 3 })
      await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.intro', kind: 'narration', text: `你来到${content.locations.find(item => item.key === content.initialLocationKey)?.title ?? '冒险起点'}。`, order: 0 })
      const endingConditions: Record<string, unknown> = {
        victory: {
          all: [
            { path: 'adventure.quests.main_bell.status', eq: 'completed' },
            { path: 'adventure.conditions.wanted', exists: false },
          ],
        },
        alternate: {
          all: [
            { path: 'adventure.quests.main_bell.status', eq: 'completed' },
            { path: 'adventure.conditions.wanted', exists: true },
          ],
        },
        failure: { path: 'adventure.quests.main_bell.status', eq: 'failed' },
      }
      for (const [index, ending] of ['victory', 'alternate', 'failure'].entries()) {
        await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: ending, beatKey: `${ending}.ending`, kind: 'narration', text: ending === 'victory' ? '你完成了这段冒险。' : ending === 'alternate' ? '你付出代价，仍为后来者留下道路。' : '你没有达成最初目标，但故事留下了另一条路。', order: 0 })
        await addNarrativeChoice({
          scope,
          moduleId: module.id!,
          sourceNodeKey: 'entry',
          choiceKey: `ending.${ending}`,
          text: `进入${ending === 'victory' ? '圆满' : ending === 'alternate' ? '代价' : '失落'}结局`,
          description: '由正式冒险状态解锁。',
          unavailableReason: '冒险状态尚未满足该结局。',
          availableConditionJson: JSON.stringify(endingConditions[ending]),
          targetNodeKey: ending,
          order: index,
        })
      }
      await addNarrativeChoice({
        scope,
        moduleId: module.id!,
        sourceNodeKey: 'entry',
        choiceKey: 'action.abandon',
        text: '终止调查并接受失落结局',
        description: '通过 Adventure 模块公开的 quest.abandon 行动变更任务状态，再进入结局。',
        unavailableReason: '必须先抵达失声钟楼。',
        availableConditionJson: JSON.stringify({
          any: [
            {
              all: [
                { path: 'adventure.currentLocationKey', eq: 'tower' },
                { path: 'adventure.quests.main_bell.status', eq: 'active' },
              ],
            },
            { path: 'adventure.quests.main_bell.status', eq: 'failed' },
          ],
        }),
        targetNodeKey: 'failure',
        tags: ['adventure-action:quest.abandon'],
        order: 3,
      })
    }
    const definition = await createGameDefinition({
      scope, gameKey: input.gameKey ?? `textadv-${Date.now().toString(36)}`, title,
      narrativeModuleId: module.id!, productType: 'text-adventure',
      sourceWorldContentHash: input.sourceWorldContentHash,
      sourceSelectionJson: input.sourceSelectionJson,
      sourceMappingVersion: input.sourceMappingVersion,
    })
    const now = Date.now()
    const row = stampNewRecord(scope, 'adventureModules', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      gameDefinitionId: definition.id!, contentJson: JSON.stringify(content), createdAt: now, updatedAt: now,
    } satisfies AdventureModule, { owner: 'work' })
    await db.adventureModules.add(row)
    const nowByParticipant = new Map<string, number>()
    for (const [index, mapping] of mappings.entries()) {
      const character = mapping.characterId == null
        ? null
        : characters.find(item => item.id === mapping.characterId) ?? null
      const sourceSnapshot = mapping.sourceCharacter
        ? createInteractionSourceCharacterSnapshot(mapping.sourceCharacter)
        : null
      if (!character && !sourceSnapshot) throw new Error(`[adventure] 互动角色来源不存在:${mapping.participantKey}`)
      const name = character?.name ?? sourceSnapshot!.name
      const description = character?.shortDescription.trim()
        || mapping.sourceCharacter?.description?.trim()
        || `${name}参与这段冒险。`
      const voiceRules = character?.speechStyle?.trim()
        || mapping.sourceCharacter?.voiceRules?.trim()
        || '只根据自己的知识和现场证据回应。'
      const createdAt = now + index
      nowByParticipant.set(mapping.participantKey, createdAt)
      await db.interactionCharacterProfiles.add(stampNewRecord(scope, 'interactionCharacterProfiles', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        gameDefinitionId: definition.id!, characterId: character?.id ?? null, participantKey: mapping.participantKey,
        sourceSnapshotJson: sourceSnapshot ? JSON.stringify(sourceSnapshot) : '{}',
        roleLabel: description,
        voiceRules,
        initialKnowledgeJson: JSON.stringify([
          {
            key: `profile.${mapping.participantKey}`,
            content: description,
            visibility: 'public', importance: 50,
          },
          ...(mapping.relationSummary?.trim() ? [{
            key: `world-relations.${mapping.participantKey}`,
            content: mapping.relationSummary.trim(),
            visibility: 'public' as const,
            importance: 60,
          }] : []),
        ]),
        relationshipDimensionsJson: JSON.stringify([{
          key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3,
        }]),
        maxMemoryEntries: 24, createdAt, updatedAt: createdAt,
      } satisfies InteractionCharacterProfile, { owner: 'work' }))
    }
    const bindingsByScene = new Map<string, typeof talkBindings>()
    for (const binding of talkBindings) {
      const current = bindingsByScene.get(binding.sceneKey) ?? []
      if (!current.some(item => item.ruleKey === binding.ruleKey)) current.push(binding)
      bindingsByScene.set(binding.sceneKey, current)
    }
    let sceneOrder = 0
    for (const [sceneKey, bindings] of bindingsByScene) {
      const participantKeys = [...new Set(bindings.map(item => item.participantKey))]
      const sceneTime = Math.max(...participantKeys.map(item => nowByParticipant.get(item) ?? now))
      await db.interactionSceneTemplates.add(stampNewRecord(scope, 'interactionSceneTemplates', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        gameDefinitionId: definition.id!, sceneKey, title: `${title} · 交谈`,
        purpose: '通过共享角色互动事件产生可验证的冒险交谈结果。',
        location: content.locations.find(item => content.actions.some(action => action.interaction?.sceneKey === sceneKey && action.locationKey === item.key))?.title ?? '冒险现场',
        timeLabel: '冒险进行时', participantKeysJson: JSON.stringify(participantKeys),
        publicKnowledgeKeysJson: JSON.stringify(participantKeys.map(item => `profile.${item}`)),
        goalsJson: JSON.stringify(['完成一次有明确目标的交谈']),
        endingConditionsJson: JSON.stringify(['固定交谈行动完成']),
        safetyBoundariesJson: JSON.stringify(['不替玩家决定行动', '不越过角色知识边界']),
        relationshipRulesJson: JSON.stringify(bindings.map(binding => ({
          ruleKey: binding.ruleKey, label: '完成交谈', playerText: '询问与当前任务有关的线索',
          fromParticipantKey: binding.participantKey, toParticipantKey: 'player',
          dimensionKey: 'trust', delta: 1, reason: '玩家完成了有明确目标且可追溯的交谈。', significantEventKey: null,
        }))),
        openingNodeKey: 'entry', endingNodeKey: null, maxTurns: 1, directorBudget: 0,
        order: sceneOrder++, createdAt: sceneTime, updatedAt: sceneTime,
      } satisfies InteractionSceneTemplate, { owner: 'work' }))
    }
    return definition
  })
}

export async function seedAdventureAcceptanceGame(input: {
  scope: WorkspaceScope
  title?: string
  gameKey?: string
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const characterNames = [
    ['潮汐商人', '掌握档案记录的港口商人'],
    ['守钟人', '照看失声钟楼的见证人'],
  ] as const
  const adopted = await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characters',
    mode: 'add-many',
    data: characterNames.map(spec => ({
      name: spec[0], role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: spec[1], appearance: '', personality: '', background: '', motivation: '',
      abilities: '', relationships: '[]', arc: '', speechStyle: '克制直接，只陈述自己知道的事实。',
    })),
  })
  if (adopted.written.length !== characterNames.length) {
    throw new Error(`[adventure] 验收角色创建失败:${adopted.skipped.map(item => item.reason).join('；')}`)
  }
  const ids = adopted.written.map(item => item.id)
  return createAdventureGame({
    scope,
    title: input.title?.trim() || '雾港潮汐钟',
    gameKey: input.gameKey,
    content: createAdventureAcceptanceContent(),
    interactionCharacters: [
      { characterId: ids[0], participantKey: 'merchant' },
      { characterId: ids[1], participantKey: 'keeper' },
    ],
  })
}

export async function updateAdventureGameDefinition(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  title: string
  description: string
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await definitionInScope(scope, input.gameDefinitionId)
  const title = input.title.trim()
  if (!title) throw new Error('[adventure] 标题不能为空')
  const row = { ...current, title, description: input.description.trim(), updatedAt: Date.now() }
  await db.gameDefinitions.put(row)
  return row
}

export async function saveAdventureContent(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  contentJson: string
}): Promise<AdventureModule> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const content = parseAdventureContent(input.contentJson)
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.adventureModules), async () => {
    const current = await db.adventureModules.where('gameDefinitionId').equals(input.gameDefinitionId).first()
    if (!current || !await assertRecordInScope(scope, 'adventureModules', current, { owner: 'work' })) throw new Error('[adventure] 内容模块不存在')
    const row = { ...current, contentJson: JSON.stringify(content), updatedAt: Date.now() }
    await db.adventureModules.put(row)
    return row
  })
}

export async function validateAdventureGameDraft(value: WorkspaceScope, gameDefinitionId: number): Promise<AdventureDraftReport> {
  const scope = await resolveScope({ scope: value })
  const definition = await definitionInScope(scope, gameDefinitionId)
  const module = await db.adventureModules.where('gameDefinitionId').equals(definition.id!).first()
  const [narrative, interaction] = await Promise.all([
    validateStoryGameContent(scope, definition.narrativeModuleId),
    validateInteractionGameDraft(scope, definition.id!),
  ])
  let adventure: AdventureContentReport = { valid: false, errors: ['冒险内容模块不存在'], warnings: [], unreachableLocationKeys: [], unavailableQuestKeys: [], sourceLessItemKeys: [] }
  if (module) {
    try {
      const content = parseAdventureContent(module.contentJson)
      adventure = validateAdventureContent(content)
      const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).toArray()
      const scenes = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).toArray()
      const choices = await db.narrativeChoices.where('moduleId').equals(definition.narrativeModuleId).toArray()
      const profileKeys = new Set(profiles.map(item => item.participantKey))
      for (const action of content.actions.filter(item => item.kind === 'talk')) {
        const binding = action.interaction
        const scene = scenes.find(item => item.sceneKey === binding?.sceneKey)
        const participants = JSON.parse(scene?.participantKeysJson ?? '[]') as string[]
        const rules = JSON.parse(scene?.relationshipRulesJson ?? '[]') as Array<{ ruleKey?: string; fromParticipantKey?: string }>
        if (!binding || !profileKeys.has(binding.participantKey) || !participants.includes(binding.participantKey)
          || !rules.some(item => item.ruleKey === binding.ruleKey && item.fromParticipantKey === binding.participantKey)) {
          adventure = { ...adventure, valid: false, errors: [...adventure.errors, `talk 行动没有有效共享互动绑定:${action.key}`] }
        }
      }
      const actionByKey = new Map(content.actions.map(action => [action.key, action]))
      for (const choice of choices) {
        const tags = JSON.parse(choice.tagsJson) as string[]
        const bindings = tags.filter(tag => tag.startsWith('adventure-action:'))
        if (bindings.length > 1) {
          adventure = { ...adventure, valid: false, errors: [...adventure.errors, `Narrative Choice 只能绑定一个公共行动:${choice.choiceKey}`] }
          continue
        }
        if (bindings.length === 1) {
          const actionKey = bindings[0].slice('adventure-action:'.length)
          const action = actionByKey.get(actionKey)
          if (!action || action.narrativeChoiceKey !== choice.choiceKey) {
            adventure = { ...adventure, valid: false, errors: [...adventure.errors, `Narrative Choice 公共行动绑定无效:${choice.choiceKey}->${actionKey}`] }
          }
        }
      }
      for (const action of content.actions.filter(item => item.narrativeChoiceKey != null)) {
        const choice = choices.find(item => item.choiceKey === action.narrativeChoiceKey)
        const tags = choice ? JSON.parse(choice.tagsJson) as string[] : []
        if (!choice || !tags.includes(`adventure-action:${action.key}`)) {
          adventure = { ...adventure, valid: false, errors: [...adventure.errors, `Adventure 公共行动缺少 Narrative Choice 反向绑定:${action.key}`] }
        }
      }
    }
    catch (cause) { adventure = { ...adventure, errors: [cause instanceof Error ? cause.message : String(cause)] } }
  }
  const interactionErrors = interaction.diagnostics.filter(item => item.severity === 'error').map(item => item.message)
  const errors = [...adventure.errors, ...(narrative.valid ? [] : ['共享 Narrative 内容图校验未通过']), ...interactionErrors]
  return { valid: narrative.valid && interaction.valid && adventure.valid && !errors.length, adventure, narrative, interaction, errors, warnings: adventure.warnings }
}

export async function deleteAdventureGameDraft(input: { scope: WorkspaceScope; gameDefinitionId: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  await db.transaction('rw', scopeTransactionTables(
    ...transactionTablesForReferences('gameDefinitions'), ...transactionTablesForReferences('narrativeModules'),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await definitionInScope(currentScope, definition.id!)
    const module = await db.narrativeModules.get(current.narrativeModuleId)
    if (!module || !await assertRecordInScope(currentScope, 'narrativeModules', module)) throw new Error('[adventure] Narrative 模块不存在')
    const consumers = await db.gameDefinitions.where('narrativeModuleId').equals(module.id!).toArray()
    await deleteGameDefinitionRecordInTransaction(currentScope, current.id!)
    if (consumers.length === 1 && consumers[0].id === current.id && module.sourceProjection === 'custom') {
      await db.narrativeNodes.where('moduleId').equals(module.id!).delete()
      await db.narrativeBeats.where('moduleId').equals(module.id!).delete()
      await db.narrativeChoices.where('moduleId').equals(module.id!).delete()
      await db.simulationSessions.where('narrativeModuleId').equals(module.id!).modify({ narrativeModuleId: null })
      await db.narrativeModules.delete(module.id!)
    }
  })
}

export async function publishAdventureGameDraft(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  label?: string
  fixtureOnly?: true
}): Promise<AdventurePublication> {
  if (input.fixtureOnly !== true) throw new Error('[adventure] 旧草稿发布只允许隔离测试夹具；正式发布必须进入产品制作中心')
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  parseGameDefinitionWorldSource(definition)
  const report = await validateAdventureGameDraft(scope, definition.id!)
  if (!report.valid) throw new Error(`[adventure] 发布检查未通过:${report.errors.join('；')}`)
  const latest = (await listWorldRevisions(scope))[0]
  const label = input.label?.trim() || `${definition.title} · 发布候选`
  const revision = await createWorldRevision({ scope, label, parentRevisionId: latest?.id ?? null })
  const worldRelease = await publishWorldRevision(revision.id!, label)
  const gameRelease = await publishGameDefinition({ scope, gameDefinitionId: definition.id!, worldReleaseId: worldRelease.id!, label, fixtureOnly: true })
  return { report, revision, worldRelease, gameRelease }
}

export function createAdventureAcceptanceContent(): AdventureContentV1 {
  const locations = [
    ['harbor', '雾港码头'], ['market', '潮汐集市'], ['archive', '旧档案馆'],
    ['canal', '地下水渠'], ['tower', '失声钟楼'], ['cliff', '灯塔断崖'],
  ].map(([key, title]) => ({ key, title, description: `${title}藏着关于失踪潮汐钟的线索。`, tags: ['coastal'] }))
  const objects = [
    ['notice', 'harbor'], ['gate', 'market'], ['ledger', 'archive'], ['lock', 'archive'],
    ['grate', 'canal'], ['mechanism', 'canal'], ['keeper', 'tower'], ['beacon', 'cliff'],
  ].map(([key, locationKey]) => ({ key, locationKey, title: key, description: `${key} 可被观察或使用。`, tags: ['interactive'] }))
  const items = ['rope', 'brass-key', 'ledger-page', 'lamp-oil', 'herb', 'seal', 'gear', 'letter', 'coin', 'bell-shard']
    .map(key => ({ key, title: key, description: `${key} 是本次冒险中的可追溯物品。`, tags: ['quest'], stackable: key === 'coin' || key === 'herb', consumable: ['lamp-oil', 'herb', 'coin'].includes(key) }))
  const abilities = ['observe', 'agility', 'reason', 'empathy'].map(key => ({ key, title: key, description: `${key} 能力。`, initial: 2, minimum: 0, maximum: 10 }))
  const conditions = ['wounded', 'inspired', 'wanted'].map(key => ({ key, title: key, description: `${key} 状态。` }))
  const resources = [{ key: 'stamina', title: '体力', initial: 6, minimum: 0, maximum: 10 }, { key: 'time', title: '剩余时间', initial: 8, minimum: 0, maximum: 12 }]
  const move = (key: string, from: string, to: string, label: string) => ({
    key, kind: 'move' as const, label, description: label, locationKey: from, targetKey: to,
    requirements: [], rule: { kind: 'automatic' as const }, successEffects: [{ op: 'enter-location' as const, locationKey: to }],
    costlySuccessEffects: [], failureEffects: [], successText: `你抵达${locations.find(item => item.key === to)?.title}。`, costlySuccessText: '你付出代价后抵达。', failureText: '道路暂时无法通过。', unavailableText: '当前不能移动。', repeatable: true, narrativeChoiceKey: null,
  })
  const actions: AdventureContentV1['actions'] = [
    { key: 'look.harbor', kind: 'look', label: '环顾码头', description: '再次观察码头与潮汐。', locationKey: 'harbor', targetKey: null, requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [], successText: '你重新观察了雾港码头。', costlySuccessText: '你费力辨认周围的细节。', failureText: '雾气遮住了视线。', unavailableText: '当前无法观察。', repeatable: true, narrativeChoiceKey: null },
    { key: 'rest.harbor', kind: 'rest', label: '短暂休息', description: '在码头稍作停留。', locationKey: 'harbor', targetKey: null, requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [], successText: '你在潮声中短暂休息。', costlySuccessText: '你勉强恢复了一点精神。', failureText: '此刻无法休息。', unavailableText: '当前无法休息。', repeatable: true, narrativeChoiceKey: null },
    move('move.market', 'harbor', 'market', '前往集市'), move('move.archive', 'market', 'archive', '前往档案馆'),
    move('move.canal', 'archive', 'canal', '进入水渠'), move('move.tower', 'canal', 'tower', '前往钟楼'),
    move('move.cliff', 'tower', 'cliff', '前往灯塔'), move('move.harbor', 'cliff', 'harbor', '返回码头'),
    { key: 'take.rope', kind: 'take', label: '取得绳索', description: '从码头领取旧绳。', locationKey: 'harbor', targetKey: 'rope', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'rope', quantity: 1, claimKey: 'claim.rope' }], costlySuccessEffects: [], failureEffects: [], successText: '你收好绳索。', costlySuccessText: '你勉强取得绳索。', failureText: '绳索拿不到。', unavailableText: '绳索已领取。', repeatable: false, narrativeChoiceKey: null },
    { key: 'use.rope', kind: 'use', label: '装备旧绳', description: '把旧绳固定在行囊外，作为攀爬装备。', locationKey: 'harbor', targetKey: 'rope', requirements: [{ itemKey: 'rope', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-item-state', itemKey: 'rope', state: 'equipped' }], costlySuccessEffects: [], failureEffects: [], successText: '旧绳已经装备。', costlySuccessText: '你勉强固定好了旧绳。', failureText: '旧绳无法固定。', unavailableText: '需要先取得旧绳。', repeatable: false, narrativeChoiceKey: null },
    { key: 'inspect.notice', kind: 'inspect', label: '查看告示', description: '查看失物告示。', locationKey: 'harbor', targetKey: 'notice', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'accept-quest', questKey: 'main.bell' }], costlySuccessEffects: [], failureEffects: [], successText: '你接受了寻找潮汐钟的委托。', costlySuccessText: '你接受了委托。', failureText: '告示已经模糊。', unavailableText: '主线已经开始。', repeatable: false, narrativeChoiceKey: null },
    { key: 'talk.merchant', kind: 'talk', label: '询问商人', description: '通过共享角色互动取得档案记录。', locationKey: 'market', targetKey: 'character:merchant', requirements: [{ questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'ledger-page', quantity: 1, claimKey: 'claim.ledger.talk' }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-record' }], costlySuccessEffects: [], failureEffects: [], successText: '商人相信你，交出珍藏的档案抄页。', costlySuccessText: '商人交出抄页，但要求你以后偿还人情。', failureText: '商人拒绝透露线索。', unavailableText: '你还没有接受委托，或档案目标已经完成。', repeatable: false, narrativeChoiceKey: null, interaction: { participantKey: 'merchant', sceneKey: 'merchant-records', ruleKey: 'merchant.share-records' } },
    { key: 'use.coin', kind: 'give', label: '用钱交换档案', description: '支付硬币取得档案抄页。', locationKey: 'market', targetKey: 'character:merchant', requirements: [{ questKey: 'main.bell', questStatus: 'active' }, { itemKey: 'coin', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'remove-item', itemKey: 'coin', quantity: 1 }, { op: 'gain-item', itemKey: 'ledger-page', quantity: 1, claimKey: 'claim.ledger.coin' }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-record' }], costlySuccessEffects: [], failureEffects: [], successText: '交易完成，你拿到档案抄页。', costlySuccessText: '交易勉强完成。', failureText: '交易失败。', unavailableText: '你没有硬币、任务未开始，或档案目标已经完成。', repeatable: false, narrativeChoiceKey: null },
    { key: 'attempt.lock', kind: 'attempt', label: '撬开档案锁', description: '不用钥匙尝试开锁。', locationKey: 'archive', targetKey: 'lock', requirements: [{ questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'random', abilityKey: 'agility', expression: '1d6', difficulty: 7, costlySuccessFloor: 5 }, successEffects: [{ op: 'gain-item', itemKey: 'ledger-page', quantity: 1, claimKey: 'claim.ledger.success' }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-record' }], costlySuccessEffects: [{ op: 'gain-item', itemKey: 'ledger-page', quantity: 1, claimKey: 'claim.ledger.costly' }, { op: 'apply-condition', conditionKey: 'wanted', duration: 3 }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-record' }], failureEffects: [{ op: 'change-resource', resourceKey: 'time', delta: -1 }], successText: '锁应声而开，你找到关键记录。', costlySuccessText: '锁开了，但警铃让你被通缉。', failureText: '锁没有打开，你损失了时间；水渠仍是替代路线。', unavailableText: '任务未开始或行动已完成。', repeatable: false, narrativeChoiceKey: null },
    { key: 'use.key', kind: 'use', label: '使用黄铜钥匙', description: '用钥匙打开档案锁。', locationKey: 'archive', targetKey: 'lock', requirements: [{ itemKey: 'brass-key', itemQuantity: 1 }, { questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'ledger-page', quantity: 1, claimKey: 'claim.ledger.key' }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-record' }], costlySuccessEffects: [], failureEffects: [], successText: '钥匙打开了档案柜。', costlySuccessText: '钥匙终于转动。', failureText: '钥匙不匹配。', unavailableText: '需要黄铜钥匙。', repeatable: false, narrativeChoiceKey: null },
    { key: 'take.shard', kind: 'take', label: '取回钟片', description: '在钟楼取回潮汐钟片。', locationKey: 'tower', targetKey: 'bell-shard', requirements: [{ itemKey: 'ledger-page', itemQuantity: 1 }, { questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'bell-shard', quantity: 1, claimKey: 'claim.bell-shard' }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'recover-bell' }], costlySuccessEffects: [], failureEffects: [], successText: '你取回钟片，主线完成。', costlySuccessText: '你付出代价取回钟片。', failureText: '你还不知道钟片在哪。', unavailableText: '需要档案记录。', repeatable: false, narrativeChoiceKey: null },
    { key: 'quest.abandon', kind: 'quest-action', label: '放弃寻找潮汐钟', description: '承认线索已经无法继续，结束本次调查。', locationKey: 'tower', targetKey: null, requirements: [{ questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'fail-quest', questKey: 'main.bell' }], costlySuccessEffects: [], failureEffects: [], successText: '你决定终止调查，失落结局已经解锁。', costlySuccessText: '你带着遗憾终止调查。', failureText: '你仍无法放下这件事。', unavailableText: '主线尚未进行或已经结束。', repeatable: false, narrativeChoiceKey: 'action.abandon' },
  ]
  actions.push(
    { key: 'inspect.gate', kind: 'inspect', label: '检查集市门闩', description: '在废弃门闩里找到备用钥匙。', locationKey: 'market', targetKey: 'gate', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'brass-key', quantity: 1, claimKey: 'claim.brass-key' }], costlySuccessEffects: [], failureEffects: [], successText: '你找到一把黄铜钥匙。', costlySuccessText: '你费力取出了钥匙。', failureText: '门闩里什么都没有。', unavailableText: '备用钥匙已经取走。', repeatable: false, narrativeChoiceKey: null },
    { key: 'take.oil', kind: 'take', label: '领取灯油', description: '为灯塔准备一瓶灯油。', locationKey: 'market', targetKey: 'lamp-oil', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'lamp-oil', quantity: 1, claimKey: 'claim.lamp-oil' }], costlySuccessEffects: [], failureEffects: [], successText: '你收好灯油。', costlySuccessText: '你终于取得灯油。', failureText: '灯油已经用尽。', unavailableText: '灯油已经领取。', repeatable: false, narrativeChoiceKey: null },
    { key: 'take.seal', kind: 'take', label: '收起旧印章', description: '从档案馆取走无人认领的印章。', locationKey: 'archive', targetKey: 'seal', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'seal', quantity: 1, claimKey: 'claim.seal' }], costlySuccessEffects: [], failureEffects: [], successText: '你收起旧印章。', costlySuccessText: '你拿到了印章。', failureText: '印章够不到。', unavailableText: '印章已经取走。', repeatable: false, narrativeChoiceKey: null },
    { key: 'inspect.grate', kind: 'inspect', label: '查看草药告示', description: '接受寻找水渠草药的委托。', locationKey: 'canal', targetKey: 'grate', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'accept-quest', questKey: 'side.herbs' }], costlySuccessEffects: [], failureEffects: [], successText: '你接受了草药委托。', costlySuccessText: '你接受了委托。', failureText: '告示无法辨认。', unavailableText: '草药委托已经开始。', repeatable: false, narrativeChoiceKey: null },
    { key: 'take.herb', kind: 'take', label: '采集水渠草药', description: '在石缝中采集药草。', locationKey: 'canal', targetKey: 'herb', requirements: [{ questKey: 'side.herbs', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'herb', quantity: 1, claimKey: 'claim.herb' }, { op: 'complete-objective', questKey: 'side.herbs', objectiveKey: 'collect' }], costlySuccessEffects: [], failureEffects: [], successText: '你采到了草药。', costlySuccessText: '你付出代价采到草药。', failureText: '草药从指间滑落。', unavailableText: '先接受草药委托。', repeatable: false, narrativeChoiceKey: null },
    { key: 'give.herb', kind: 'give', label: '交付水渠草药', description: '把采到的草药交给码头药师。', locationKey: 'harbor', targetKey: 'character:apothecary', requirements: [{ questKey: 'side.herbs', questStatus: 'active' }, { itemKey: 'herb', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'transfer-item', itemKey: 'herb', quantity: 1, toOwnerKey: 'apothecary' }, { op: 'complete-objective', questKey: 'side.herbs', objectiveKey: 'deliver' }], costlySuccessEffects: [], failureEffects: [], successText: '药师收下草药，你的同理能力有所成长。', costlySuccessText: '草药终于送达。', failureText: '药师没有收到草药。', unavailableText: '需要带着草药回到码头。', repeatable: false, narrativeChoiceKey: null },
    { key: 'take.gear', kind: 'take', label: '取下备用齿轮', description: '从水渠机关取下一枚齿轮。', locationKey: 'canal', targetKey: 'mechanism', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'gear', quantity: 1, claimKey: 'claim.gear' }], costlySuccessEffects: [], failureEffects: [], successText: '你收起备用齿轮。', costlySuccessText: '你费力拆下齿轮。', failureText: '齿轮纹丝不动。', unavailableText: '齿轮已经取下。', repeatable: false, narrativeChoiceKey: null },
    { key: 'talk.keeper', kind: 'talk', label: '询问守钟人', description: '通过共享角色互动接受寻找未寄出信件的委托。', locationKey: 'tower', targetKey: 'character:keeper', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'accept-quest', questKey: 'side.letter' }], costlySuccessEffects: [], failureEffects: [], successText: '守钟人请你寻找那封信。', costlySuccessText: '守钟人终于开口。', failureText: '守钟人沉默不语。', unavailableText: '信件委托已经开始。', repeatable: false, narrativeChoiceKey: null, interaction: { participantKey: 'keeper', sceneKey: 'keeper-letter', ruleKey: 'keeper.request-letter' } },
    { key: 'take.letter', kind: 'take', label: '找到未寄出的信', description: '从钟楼夹层取出信件。', locationKey: 'tower', targetKey: 'letter', requirements: [{ questKey: 'side.letter', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'letter', quantity: 1, claimKey: 'claim.letter' }, { op: 'complete-objective', questKey: 'side.letter', objectiveKey: 'find' }], costlySuccessEffects: [], failureEffects: [], successText: '你找到了信件。', costlySuccessText: '你终于取出信件。', failureText: '夹层空无一物。', unavailableText: '先接受信件委托。', repeatable: false, narrativeChoiceKey: null },
    { key: 'give.letter', kind: 'give', label: '交还未寄出的信', description: '把信件交还给守钟人。', locationKey: 'tower', targetKey: 'character:keeper', requirements: [{ questKey: 'side.letter', questStatus: 'active' }, { itemKey: 'letter', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'transfer-item', itemKey: 'letter', quantity: 1, toOwnerKey: 'keeper' }, { op: 'complete-objective', questKey: 'side.letter', objectiveKey: 'deliver' }], costlySuccessEffects: [], failureEffects: [], successText: '守钟人收下信件，你更善于观察未说出口的话。', costlySuccessText: '信件终于回到守钟人手中。', failureText: '信件没有交到他手里。', unavailableText: '需要先找到信件。', repeatable: false, narrativeChoiceKey: null },
    { key: 'inspect.beacon', kind: 'inspect', label: '检查灯塔', description: '接受重燃灯塔的委托。', locationKey: 'cliff', targetKey: 'beacon', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'accept-quest', questKey: 'side.beacon' }], costlySuccessEffects: [], failureEffects: [], successText: '你决定重燃灯塔。', costlySuccessText: '你接下了灯塔委托。', failureText: '灯塔无法靠近。', unavailableText: '灯塔委托已经开始。', repeatable: false, narrativeChoiceKey: null },
    { key: 'use.beacon', kind: 'use', label: '重燃灯塔', description: '使用灯油点亮灯塔。', locationKey: 'cliff', targetKey: 'beacon', requirements: [{ questKey: 'side.beacon', questStatus: 'active' }, { itemKey: 'lamp-oil', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'remove-item', itemKey: 'lamp-oil', quantity: 1 }, { op: 'complete-objective', questKey: 'side.beacon', objectiveKey: 'light' }], costlySuccessEffects: [], failureEffects: [], successText: '灯塔重新照亮海面。', costlySuccessText: '灯火在风中亮起。', failureText: '灯芯没有点燃。', unavailableText: '需要先接受委托并取得灯油。', repeatable: false, narrativeChoiceKey: null },
  )
  const quests: AdventureContentV1['quests'] = [
    { key: 'main.bell', title: '失踪的潮汐钟', description: '找回钟片。', initialStatus: 'available', prerequisites: [], objectives: [{ key: 'find-record', title: '通过交谈、物品或能力判定取得档案记录', optional: false, alternativeActionKeys: ['talk.merchant', 'use.coin', 'attempt.lock', 'use.key'] }, { key: 'recover-bell', title: '取回钟片', optional: false, alternativeActionKeys: ['take.shard'] }], rewardEffects: [{ op: 'apply-condition', conditionKey: 'inspired', duration: null }, { op: 'change-ability', abilityKey: 'reason', delta: 1 }], completionNodeKey: 'victory', failureNodeKey: 'failure' },
    { key: 'side.herbs', title: '水渠草药', description: '寻找并交付草药。', initialStatus: 'available', prerequisites: [], objectives: [{ key: 'collect', title: '找到草药', optional: false, alternativeActionKeys: ['take.herb'] }, { key: 'deliver', title: '把草药交给码头药师', optional: false, alternativeActionKeys: ['give.herb'] }], rewardEffects: [{ op: 'change-ability', abilityKey: 'empathy', delta: 1 }], completionNodeKey: null, failureNodeKey: null },
    { key: 'side.letter', title: '未寄出的信', description: '寻找并交还信件。', initialStatus: 'available', prerequisites: [], objectives: [{ key: 'find', title: '找到信件', optional: false, alternativeActionKeys: ['take.letter'] }, { key: 'deliver', title: '把信交还守钟人', optional: false, alternativeActionKeys: ['give.letter'] }], rewardEffects: [{ op: 'change-ability', abilityKey: 'observe', delta: 1 }], completionNodeKey: null, failureNodeKey: null },
    { key: 'side.beacon', title: '重燃灯塔', description: '重燃灯塔。', initialStatus: 'available', prerequisites: [], objectives: [{ key: 'light', title: '点亮灯塔', optional: false, alternativeActionKeys: ['use.beacon'] }], rewardEffects: [{ op: 'change-ability', abilityKey: 'agility', delta: 1 }], completionNodeKey: null, failureNodeKey: null },
  ]
  return parseAdventureContent({ version: 1, initialLocationKey: 'harbor', playerKey: 'player', locations, objects, items, abilities, conditions, resources, quests, actions, initialInventory: [{ itemKey: 'coin', quantity: 1 }] })
}
