import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import {
  addNarrativeNode,
  createNarrativeModule,
} from '../narrative/blueprint'
import { transactionTablesForReferences } from '../registry/lifecycle'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinitionRecordInTransaction,
  validateStoryGameContent,
} from '../text-game/content'
import { publishGameDefinition } from '../text-game/releases'
import type {
  Character,
  CharacterRelation,
  Chapter,
  GameDefinition,
  GameRelease,
  InteractionCharacterProfile,
  InteractionKnowledgeSeed,
  InteractionRelationshipDimension,
  InteractionRelationshipRule,
  InteractionSceneTemplate,
  KnowledgeLedgerEntry,
  NarrativeContentGraphReport,
  NarrativeModule,
  NarrativeNode,
  OutlineNode,
  WorkspaceScope,
  WorldRelease,
  WorldRevision,
  WorkCharacterBinding,
} from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../world-engine/scope'
import {
  createInternalProductWorldReleaseFixtureV1,
} from '../world-engine/releases'
import {
  createInteractionGuestCharacterSnapshot,
  parseInteractionSourceCharacterSnapshot,
} from './source-character'
import { buildWorldGroundedInteractionProfile } from './world-grounding'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const DIMENSIONS = new Set(['trust', 'closeness', 'wariness', 'respect'])

export interface InteractionAuthoringSnapshot {
  definitions: GameDefinition[]
  modules: NarrativeModule[]
  nodes: NarrativeNode[]
  profiles: InteractionCharacterProfile[]
  scenes: InteractionSceneTemplate[]
  releases: GameRelease[]
  characters: Character[]
}

export interface InteractionDraftDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  recordKey?: string
}

export interface InteractionDraftReport {
  valid: boolean
  narrative: NarrativeContentGraphReport
  diagnostics: InteractionDraftDiagnostic[]
  participantCount: number
  sceneCount: number
}

export interface InteractionContextInspection {
  participantKey: string
  profile: { characterName: string; roleLabel: string; voiceRulesPresent: boolean }
  visibleKnowledgeKeys: string[]
  hiddenKnowledgeKeys: string[]
  sceneKeys: string[]
  memoryCapacity: number
  sourceKeys: ['interactionRuntime']
}

export interface InteractionGamePublication {
  report: InteractionDraftReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

interface InteractionWorldGroundingSources {
  allCharacters: Character[]
  relations: CharacterRelation[]
  knowledgeEvents: KnowledgeLedgerEntry[]
  workCharacterBindings: WorkCharacterBinding[]
  chapterOrder: Map<number, number>
}

function stableKey(value: string, label: string): string {
  const result = value.trim()
  if (!result || result.length > 160 || !STABLE_KEY.test(result)) {
    throw new Error(`[chatgame] ${label} 必须是不超过 160 字符的稳定 key`)
  }
  return result
}

function text(value: string, label: string, maximum: number): string {
  const result = value.trim()
  if (!result || result.length > maximum) throw new Error(`[chatgame] ${label} 无效`)
  return result
}

function parseArray<T>(value: string, label: string): T[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[chatgame] ${label} 不是合法 JSON`) }
  if (!Array.isArray(parsed)) throw new Error(`[chatgame] ${label} 必须是 JSON 数组`)
  return parsed as T[]
}

function normalizedStringArray(value: string, label: string, required = false): string {
  const parsed = parseArray<unknown>(value, label)
  if (parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[chatgame] ${label} 只能包含非空字符串`)
  }
  const result = [...new Set(parsed.map(item => String(item).trim()))]
  if (required && !result.length) throw new Error(`[chatgame] ${label} 不能为空`)
  return JSON.stringify(result)
}

function normalizeKnowledge(value: string): string {
  const result = parseArray<InteractionKnowledgeSeed>(value, '初始知识')
  const keys = new Set<string>()
  for (const item of result) {
    item.key = stableKey(item.key, '知识 key')
    item.content = text(item.content, '知识内容', 8_000)
    if (item.visibility !== 'public' && item.visibility !== 'private') throw new Error('[chatgame] 知识可见性无效')
    if (!Number.isInteger(item.importance) || item.importance < 0 || item.importance > 100) throw new Error('[chatgame] 知识重要度必须为 0..100')
    if (keys.has(item.key)) throw new Error(`[chatgame] 初始知识 key 重复:${item.key}`)
    keys.add(item.key)
  }
  return JSON.stringify(result)
}

function normalizeDimensions(value: string): string {
  const result = parseArray<InteractionRelationshipDimension>(value, '关系维度')
  const keys = new Set<string>()
  for (const item of result) {
    if (!DIMENSIONS.has(item.key)) throw new Error(`[chatgame] 关系维度不受支持:${item.key}`)
    item.label = text(item.label, '关系维度名称', 240)
    if (![item.minimum, item.maximum, item.initial, item.largeChangeThreshold].every(Number.isFinite)
      || item.minimum >= item.maximum || item.initial < item.minimum || item.initial > item.maximum
      || item.largeChangeThreshold < 0 || item.largeChangeThreshold > item.maximum - item.minimum) {
      throw new Error(`[chatgame] 关系维度范围无效:${item.key}`)
    }
    if (keys.has(item.key)) throw new Error(`[chatgame] 关系维度重复:${item.key}`)
    keys.add(item.key)
  }
  if (!result.length) throw new Error('[chatgame] 至少需要一个关系维度')
  return JSON.stringify(result)
}

function normalizeRules(value: string | undefined): string {
  const result = parseArray<InteractionRelationshipRule>(value ?? '[]', '关系规则')
  const keys = new Set<string>()
  for (const item of result) {
    item.ruleKey = stableKey(item.ruleKey, '关系规则 key')
    item.label = text(item.label, '关系规则名称', 240)
    item.playerText = text(item.playerText, '固定行动文本', 1_000)
    item.fromParticipantKey = stableKey(item.fromParticipantKey, '关系规则来源角色')
    if (item.toParticipantKey !== 'player') throw new Error('[chatgame] 首期关系规则目标只能是 player')
    if (!DIMENSIONS.has(item.dimensionKey) || !Number.isFinite(item.delta) || item.delta === 0) throw new Error('[chatgame] 关系规则变化量无效')
    item.reason = text(item.reason, '关系变化原因', 2_000)
    item.significantEventKey = item.significantEventKey?.trim() || null
    if (keys.has(item.ruleKey)) throw new Error(`[chatgame] 关系规则 key 重复:${item.ruleKey}`)
    keys.add(item.ruleKey)
  }
  return JSON.stringify(result)
}

async function definitionInScope(
  scope: WorkspaceScope,
  id: number,
  allowedProductTypes: GameDefinition['productType'][] = ['character-interaction'],
): Promise<GameDefinition> {
  const row = await db.gameDefinitions.get(id)
  if (!row || !allowedProductTypes.includes(row.productType)
    || !await assertRecordInScope(scope, 'gameDefinitions', row, { owner: 'work' })) {
    throw new Error('[chatgame] 互动游戏定义不属于当前 Work')
  }
  return row
}

async function characterInScope(scope: WorkspaceScope, id: number): Promise<Character> {
  const row = await db.characters.get(id)
  if (!row || !await assertRecordInScope(scope, 'characters', row, { owner: 'world' })) {
    throw new Error('[chatgame] 角色不属于当前 World')
  }
  return row
}

async function readInteractionWorldGroundingSources(scope: WorkspaceScope): Promise<InteractionWorldGroundingSources> {
  const [allCharacters, relations, knowledgeEvents, workCharacterBindings, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<CharacterRelation>(scope, 'characterRelations', { owner: 'world' }),
    readOwnedRows<KnowledgeLedgerEntry>(scope, 'knowledgeLedger', { owner: 'work' }),
    readOwnedRows<WorkCharacterBinding>(scope, 'workCharacterBindings', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const chapterOrder = new Map<number, number>()
  resolveCanonicalChapterSequence(outlineNodes, chapters).sequence.forEach((item, index) => {
    if (item.chapter.id != null) chapterOrder.set(item.chapter.id, index)
  })
  return { allCharacters, relations, knowledgeEvents, workCharacterBindings, chapterOrder }
}

function compileInteractionWorldGrounding(character: Character, sources: InteractionWorldGroundingSources) {
  return buildWorldGroundedInteractionProfile({
    character,
    allCharacters: sources.allCharacters,
    relations: sources.relations,
    workBinding: sources.workCharacterBindings.find(binding => binding.characterId === character.id) ?? null,
    chapterOrder: sources.chapterOrder,
    knowledgeEvents: sources.knowledgeEvents.filter(entry => (
      entry.worldGroupId == null || entry.worldGroupId === (character.homeWorldGroupId ?? null)
    )),
  })
}

export async function loadInteractionAuthoringSnapshot(scopeValue: WorkspaceScope): Promise<InteractionAuthoringSnapshot> {
  const scope = await resolveScope({ scope: scopeValue })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(row => row.worldId === scope.worldId && row.productType === 'character-interaction')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const ids = definitions.flatMap(row => row.id == null ? [] : [row.id])
  const moduleIds = [...new Set(definitions.map(row => row.narrativeModuleId))]
  const [profiles, scenes, releases, characterRows, modules, nodes] = await Promise.all([
    ids.length ? db.interactionCharacterProfiles.where('gameDefinitionId').anyOf(ids).toArray() : [],
    ids.length ? db.interactionSceneTemplates.where('gameDefinitionId').anyOf(ids).sortBy('order') : [],
    db.gameReleases.where('workId').equals(scope.workId).toArray(),
    db.characters.where('projectId').equals(scope.projectId).toArray(),
    Promise.all(moduleIds.map(id => db.narrativeModules.get(id))),
    moduleIds.length ? db.narrativeNodes.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
  ])
  const characters: Character[] = []
  for (const row of characterRows) {
    if (await assertRecordInScope(scope, 'characters', row, { owner: 'world' })) characters.push(row)
  }
  return {
    definitions,
    modules: modules.filter((row): row is NarrativeModule => row != null),
    nodes,
    profiles: profiles.sort((a, b) => a.participantKey.localeCompare(b.participantKey)),
    scenes,
    releases: releases.filter(row => row.worldId === scope.worldId && ids.includes(row.gameDefinitionId ?? -1))
      .sort((a, b) => b.version - a.version),
    characters: characters.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function createStarterInteractionGame(input: {
  scope: WorkspaceScope
  title?: string
  gameKey?: string
  characterIds: number[]
  sceneTitle?: string
  scenePurpose?: string
  sceneLocation?: string
  sceneTimeLabel?: string
  chatDirection?: string
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const characterIds = [...new Set(input.characterIds)]
  if (!characterIds.length || characterIds.length > 8) throw new Error('[chatgame] 请选择 1..8 个互动角色')
  const characters = await Promise.all(characterIds.map(id => characterInScope(scope, id)))
  const groundingSources = await readInteractionWorldGroundingSources(scope)
  const title = input.title?.trim() || '未命名角色互动'
  const gameKey = stableKey(input.gameKey ?? `chatgame-${Date.now().toString(36)}`, 'gameKey')
  const sceneTitle = input.sceneTitle?.trim() || '初次见面'
  const scenePurpose = input.scenePurpose?.trim() || '让玩家与角色建立第一次可回放的互动。'
  const sceneLocation = input.sceneLocation?.trim() || '作者待补充的地点'
  const sceneTimeLabel = input.sceneTimeLabel?.trim() || '故事开始时'
  const chatDirection = input.chatDirection?.trim() || '完成一次有目标的见面'
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
    db.gameDefinitions, db.interactionCharacterProfiles, db.interactionSceneTemplates,
    db.characters, db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({ scope, owner: 'work', kind: 'main', title })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '场景开场', order: 0 })
    await addNarrativeNode({ scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '本次互动结束', order: 1 })
    await addNarrativeBeat({ scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.prompt', kind: 'narration', text: '人物在约定的时间与地点相见。', order: 0 })
    await addNarrativeChoice({ scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'entry.finish', text: '结束这次见面', targetNodeKey: 'ending', order: 0 })
    const definition = await createGameDefinition({
      scope,
      gameKey,
      title,
      narrativeModuleId: module.id!,
      productType: 'character-interaction',
    })
    const now = Date.now()
    const participantKeys: string[] = []
    for (const [index, character] of characters.entries()) {
      const participantKey = stableKey(`character-${character.id}`, '参与者 key')
      participantKeys.push(participantKey)
      const grounding = compileInteractionWorldGrounding(character, groundingSources)
      const profile = stampNewRecord(scope, 'interactionCharacterProfiles', {
        projectId: scope.projectId,
        worldId: scope.worldId,
        workId: scope.workId,
        gameDefinitionId: definition.id!,
        characterId: character.id!,
        participantKey,
        roleLabel: grounding.roleLabel,
        voiceRules: grounding.voiceRules,
        initialKnowledgeJson: JSON.stringify(grounding.initialKnowledge),
        relationshipDimensionsJson: JSON.stringify([
          { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
          { key: 'closeness', label: '亲近', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
        ]),
        maxMemoryEntries: 24,
        createdAt: now + index,
        updatedAt: now + index,
      } satisfies InteractionCharacterProfile, { owner: 'work' })
      await db.interactionCharacterProfiles.add(profile)
    }
    const scene = stampNewRecord(scope, 'interactionSceneTemplates', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: definition.id!,
      sceneKey: 'first-meeting',
      title: text(sceneTitle, '场景标题', 240),
      purpose: text(scenePurpose, '场景目的', 4_000),
      location: text(sceneLocation, '场景地点', 1_000),
      timeLabel: text(sceneTimeLabel, '场景时间', 1_000),
      participantKeysJson: JSON.stringify(participantKeys),
      publicKnowledgeKeysJson: JSON.stringify(participantKeys.map(key => `profile.${key}`)),
      goalsJson: JSON.stringify([text(chatDirection, '聊天方向', 2_000)]),
      endingConditionsJson: JSON.stringify(['玩家选择结束，或场景达到最大回合']),
      safetyBoundariesJson: JSON.stringify(['不替玩家决定感受或行动']),
      relationshipRulesJson: '[]',
      openingNodeKey: 'entry',
      endingNodeKey: 'ending',
      maxTurns: 20,
      directorBudget: Math.min(3, participantKeys.length),
      order: 0,
      createdAt: now,
      updatedAt: now,
    } satisfies InteractionSceneTemplate, { owner: 'work' })
    await db.interactionSceneTemplates.add(scene)
    return definition
  })
}

/** Add one existing World character through the same terminal-capsule compiler as a new game. */
export async function addWorldGroundedInteractionCharacter(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  characterId: number
}): Promise<InteractionCharacterProfile> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const character = await characterInScope(scope, input.characterId)
  const grounding = compileInteractionWorldGrounding(character, await readInteractionWorldGroundingSources(scope))
  return saveInteractionCharacterProfile({
    scope,
    gameDefinitionId: input.gameDefinitionId,
    characterId: input.characterId,
    participantKey: `character-${input.characterId}`,
    roleLabel: grounding.roleLabel,
    voiceRules: grounding.voiceRules,
    initialKnowledgeJson: JSON.stringify(grounding.initialKnowledge),
    relationshipDimensionsJson: JSON.stringify([
      { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
      { key: 'closeness', label: '亲近', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
    ]),
    maxMemoryEntries: 24,
  })
}

/**
 * Create a portable interaction-only participant. The profile belongs to the
 * current Work draft and release; it does not create or mutate World Character.
 */
export async function createGuestInteractionCharacterProfile(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  guestKey?: string
  name: string
  roleLabel: string
  background?: string
  relationToWorld?: string
  voiceRules?: string
}): Promise<InteractionCharacterProfile> {
  const guestKey = stableKey(input.guestKey ?? `guest-${Date.now().toString(36)}`, '自建角色 key')
  const snapshot = createInteractionGuestCharacterSnapshot({ guestKey, name: input.name })
  const participantKey = stableKey(`guest-${guestKey}`, '参与者 key')
  const roleLabel = text(input.roleLabel, '角色定位', 500)
  const initialKnowledge: InteractionKnowledgeSeed[] = [{
    key: `profile.${participantKey}`,
    content: `${snapshot.name}：${roleLabel}`,
    visibility: 'public',
    importance: 50,
  }]
  const background = input.background?.trim()
  if (background) initialKnowledge.push({
    key: `guest.${guestKey}.background`,
    content: `自建角色背景：${background}`,
    visibility: 'private',
    importance: 85,
  })
  const relationToWorld = input.relationToWorld?.trim()
  if (relationToWorld) initialKnowledge.push({
    key: `guest.${guestKey}.world-relation`,
    content: `与既有世界和人物的起点关联：${relationToWorld}`,
    visibility: 'private',
    importance: 90,
  })
  return saveInteractionCharacterProfile({
    scope: input.scope,
    gameDefinitionId: input.gameDefinitionId,
    characterId: null,
    sourceSnapshotJson: JSON.stringify(snapshot),
    participantKey,
    roleLabel,
    voiceRules: input.voiceRules?.trim()
      || '保持自建角色的身份、经历和关系边界；只依据自己的私有认知、公开场景信息与亲历互动回应。',
    initialKnowledgeJson: JSON.stringify(initialKnowledge),
    relationshipDimensionsJson: JSON.stringify([
      { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
      { key: 'closeness', label: '亲近', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 },
    ]),
    maxMemoryEntries: 24,
  })
}

/**
 * Builds the documented three-character, five-scene acceptance game through the
 * same authoring APIs as user-created content. It is intentionally deterministic
 * and contains no AI-generated prose.
 */
export async function createInteractionAcceptanceSample(input: {
  scope: WorkspaceScope
  characterIds: number[]
  title?: string
}): Promise<GameDefinition> {
  const selected = [...new Set(input.characterIds)].slice(0, 3)
  if (selected.length !== 3) throw new Error('[chatgame] 五场景验收样例需要恰好三个世界角色')
  const definition = await createStarterInteractionGame({
    scope: input.scope,
    title: input.title?.trim() || '钟楼密信',
    gameKey: `chatgame-acceptance-${Date.now().toString(36)}`,
    characterIds: selected,
  })
  try {
    const profiles = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(definition.id!).sortBy('participantKey')
    const keeper = profiles[0]
    if (keeper.characterId == null) throw new Error('[chatgame] 验收样例角色来源不存在')
    await saveInteractionCharacterProfile({
      scope: input.scope,
      gameDefinitionId: definition.id!,
      profileId: keeper.id,
      characterId: keeper.characterId,
      participantKey: keeper.participantKey,
      roleLabel: '掌握密信去向、但不会越权泄密的见证人',
      voiceRules: '克制直接；只陈述自己实际知道的事实；秘密被当面说出前不得假设其他角色知情。',
      initialKnowledgeJson: JSON.stringify([
        { key: `profile.${keeper.participantKey}`, content: '这名见证人负责保管钟楼的旧钥匙。', visibility: 'public', importance: 60 },
        { key: 'secret.sealed-letter', content: '失踪的密信藏在钟楼第三层裂开的钟座下。', visibility: 'private', importance: 95 },
      ]),
      relationshipDimensionsJson: JSON.stringify([
        { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 2 },
        { key: 'wariness', label: '戒备', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 2 },
      ]),
      maxMemoryEntries: 24,
    })
    const participantKeys = profiles.map(item => item.participantKey)
    const publicKnowledgeKeys = profiles.map(item => `profile.${item.participantKey}`)
    const sceneSpecs = [
      { key: 'rainy-belltower', title: '雨夜钟楼', purpose: '面对一次明确的失约。', location: '旧钟楼门厅', time: '第一夜', rules: [{ ruleKey: 'promise.broken', label: '承认失约', playerText: '承认自己没有赴约', fromParticipantKey: keeper.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: -2, reason: '玩家当面承认未履行约定。', significantEventKey: null }] },
      { key: 'north-street', title: '北街巡查', purpose: '在信息不对称下核对各自证词。', location: '封锁的北街', time: '第二夜', rules: [] },
      { key: 'archive-room', title: '档案室对质', purpose: '让三人共同确认可公开的证据。', location: '市政档案室', time: '第三日', rules: [] },
      { key: 'riverside-repair', title: '河岸补救', purpose: '用可追溯证据修复此前失约。', location: '旧河岸码头', time: '第四夜', rules: [{ ruleKey: 'promise.repaired', label: '交付证据', playerText: '交出找到的证据作为补救', fromParticipantKey: keeper.participantKey, toParticipantKey: 'player', dimensionKey: 'trust', delta: 2, reason: '玩家用真实证据履行了补救承诺。', significantEventKey: null }] },
      { key: 'dawn-review', title: '黎明复盘', purpose: '回看关系变化和各角色真实记忆。', location: '钟楼顶层', time: '第五日黎明', rules: [] },
    ] as const
    const first = await db.interactionSceneTemplates.where('gameDefinitionId').equals(definition.id!).first()
    for (const [index, spec] of sceneSpecs.entries()) {
      await saveInteractionSceneTemplate({
        scope: input.scope,
        gameDefinitionId: definition.id!,
        sceneId: index === 0 ? first?.id : undefined,
        sceneKey: spec.key,
        title: spec.title,
        purpose: spec.purpose,
        location: spec.location,
        timeLabel: spec.time,
        participantKeysJson: JSON.stringify(participantKeys),
        publicKnowledgeKeysJson: JSON.stringify(publicKnowledgeKeys),
        goalsJson: JSON.stringify([spec.purpose]),
        endingConditionsJson: JSON.stringify(['玩家完成当前场景目标或主动结束场景']),
        safetyBoundariesJson: JSON.stringify(['不替玩家决定感受或行动', '不向无权角色泄露私有知识']),
        relationshipRulesJson: JSON.stringify(spec.rules),
        openingNodeKey: 'entry',
        endingNodeKey: 'ending',
        maxTurns: 100,
        directorBudget: 12,
        order: index,
      })
    }
    return definition
  } catch (reason) {
    await deleteInteractionGameDraft({ scope: input.scope, gameDefinitionId: definition.id! })
    throw reason
  }
}

export async function saveInteractionCharacterProfile(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  profileId?: number
  characterId: number | null
  sourceSnapshotJson?: string
  participantKey: string
  roleLabel: string
  voiceRules: string
  initialKnowledgeJson: string
  relationshipDimensionsJson: string
  maxMemoryEntries: number
}): Promise<InteractionCharacterProfile> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const sourceCharacter = parseInteractionSourceCharacterSnapshot(input.sourceSnapshotJson)
  if (input.characterId != null) {
    await characterInScope(scope, input.characterId)
    if (sourceCharacter) throw new Error('[chatgame] 互动角色不能同时绑定世界角色与便携来源')
  } else if (!sourceCharacter) {
    throw new Error('[chatgame] 自建互动角色缺少便携身份')
  }
  const participantKey = stableKey(input.participantKey, '参与者 key')
  const initialKnowledgeJson = normalizeKnowledge(input.initialKnowledgeJson)
  const relationshipDimensionsJson = normalizeDimensions(input.relationshipDimensionsJson)
  if (!Number.isInteger(input.maxMemoryEntries) || input.maxMemoryEntries < 1 || input.maxMemoryEntries > 500) {
    throw new Error('[chatgame] 记忆上限必须为 1..500')
  }
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.characters, db.interactionCharacterProfiles), async () => {
    const duplicate = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(input.gameDefinitionId)
      .filter(row => row.participantKey === participantKey && row.id !== input.profileId).first()
    if (duplicate) throw new Error(`[chatgame] 参与者 key 重复:${participantKey}`)
    const now = Date.now()
    const base = input.profileId == null ? null : await db.interactionCharacterProfiles.get(input.profileId)
    if (input.profileId != null && (!base || base.gameDefinitionId !== input.gameDefinitionId
      || !await assertRecordInScope(scope, 'interactionCharacterProfiles', base, { owner: 'work' }))) {
      throw new Error('[chatgame] 互动角色档案越界')
    }
    const row = stampNewRecord(scope, 'interactionCharacterProfiles', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: input.gameDefinitionId,
      characterId: input.characterId,
      participantKey,
      sourceSnapshotJson: sourceCharacter ? JSON.stringify(sourceCharacter) : '{}',
      roleLabel: text(input.roleLabel, '角色定位', 500),
      voiceRules: text(input.voiceRules, '口吻规则', 8_000),
      initialKnowledgeJson,
      relationshipDimensionsJson,
      maxMemoryEntries: input.maxMemoryEntries,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    } satisfies InteractionCharacterProfile, { owner: 'work' })
    if (base?.id != null) {
      await db.interactionCharacterProfiles.put({ ...row, id: base.id })
      return { ...row, id: base.id }
    }
    const id = await db.interactionCharacterProfiles.add(row) as number
    return { ...row, id }
  })
}

export async function saveInteractionSceneTemplate(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  sceneId?: number
  sceneKey: string
  title: string
  purpose: string
  location: string
  timeLabel: string
  participantKeysJson: string
  publicKnowledgeKeysJson: string
  goalsJson: string
  endingConditionsJson: string
  safetyBoundariesJson: string
  relationshipRulesJson?: string
  openingNodeKey?: string | null
  endingNodeKey?: string | null
  maxTurns: number
  directorBudget: number
  order?: number
}): Promise<InteractionSceneTemplate> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  const nodes = await db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).toArray()
  const nodeKeys = new Set(nodes.map(item => item.key))
  const openingNodeKey = input.openingNodeKey?.trim() || null
  const endingNodeKey = input.endingNodeKey?.trim() || null
  if (openingNodeKey && !nodeKeys.has(openingNodeKey)) throw new Error('[chatgame] 场景开场节点不存在')
  if (endingNodeKey && !nodeKeys.has(endingNodeKey)) throw new Error('[chatgame] 场景结束节点不存在')
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 10_000
    || !Number.isInteger(input.directorBudget) || input.directorBudget < 0 || input.directorBudget > 1_000_000) {
    throw new Error('[chatgame] 场景回合或导演预算无效')
  }
  const sceneKey = stableKey(input.sceneKey, '场景 key')
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.narrativeNodes, db.interactionSceneTemplates), async () => {
    const duplicate = await db.interactionSceneTemplates.where('gameDefinitionId').equals(input.gameDefinitionId)
      .filter(row => row.sceneKey === sceneKey && row.id !== input.sceneId).first()
    if (duplicate) throw new Error(`[chatgame] 场景 key 重复:${sceneKey}`)
    const now = Date.now()
    const base = input.sceneId == null ? null : await db.interactionSceneTemplates.get(input.sceneId)
    if (input.sceneId != null && (!base || base.gameDefinitionId !== input.gameDefinitionId
      || !await assertRecordInScope(scope, 'interactionSceneTemplates', base, { owner: 'work' }))) {
      throw new Error('[chatgame] 互动场景模板越界')
    }
    const row = stampNewRecord(scope, 'interactionSceneTemplates', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: input.gameDefinitionId,
      sceneKey,
      title: text(input.title, '场景标题', 240),
      purpose: text(input.purpose, '场景目的', 4_000),
      location: text(input.location, '场景地点', 1_000),
      timeLabel: text(input.timeLabel, '场景时间', 1_000),
      participantKeysJson: normalizedStringArray(input.participantKeysJson, '场景参与者', true),
      publicKnowledgeKeysJson: normalizedStringArray(input.publicKnowledgeKeysJson, '公开知识'),
      goalsJson: normalizedStringArray(input.goalsJson, '场景目标', true),
      endingConditionsJson: normalizedStringArray(input.endingConditionsJson, '结束条件', true),
      safetyBoundariesJson: normalizedStringArray(input.safetyBoundariesJson, '安全边界', true),
      relationshipRulesJson: normalizeRules(input.relationshipRulesJson),
      openingNodeKey,
      endingNodeKey,
      maxTurns: input.maxTurns,
      directorBudget: input.directorBudget,
      order: input.order ?? base?.order ?? 0,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    } satisfies InteractionSceneTemplate, { owner: 'work' })
    if (base?.id != null) {
      await db.interactionSceneTemplates.put({ ...row, id: base.id })
      return { ...row, id: base.id }
    }
    const id = await db.interactionSceneTemplates.add(row) as number
    return { ...row, id }
  })
}

export async function deleteInteractionCharacterProfile(input: {
  scope: WorkspaceScope
  profileId: number
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const profile = await db.interactionCharacterProfiles.get(input.profileId)
  if (!profile || !await assertRecordInScope(scope, 'interactionCharacterProfiles', profile, { owner: 'work' })) {
    throw new Error('[chatgame] 互动角色档案越界')
  }
  await definitionInScope(scope, profile.gameDefinitionId)
  const scenes = await db.interactionSceneTemplates.where('gameDefinitionId').equals(profile.gameDefinitionId).toArray()
  if (scenes.some(scene => (JSON.parse(scene.participantKeysJson) as string[]).includes(profile.participantKey))) {
    throw new Error('[chatgame] 请先从所有场景参与者中移除该角色')
  }
  await db.interactionCharacterProfiles.delete(profile.id!)
}

export async function deleteInteractionSceneTemplate(input: {
  scope: WorkspaceScope
  sceneId: number
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const scene = await db.interactionSceneTemplates.get(input.sceneId)
  if (!scene || !await assertRecordInScope(scope, 'interactionSceneTemplates', scene, { owner: 'work' })) {
    throw new Error('[chatgame] 互动场景模板越界')
  }
  await definitionInScope(scope, scene.gameDefinitionId)
  await db.interactionSceneTemplates.delete(scene.id!)
}

export async function validateInteractionGameDraft(scopeValue: WorkspaceScope, gameDefinitionId: number): Promise<InteractionDraftReport> {
  const scope = await resolveScope({ scope: scopeValue })
  const definition = await definitionInScope(scope, gameDefinitionId, ['character-interaction', 'text-adventure', 'text-open-world'])
  const [narrative, profiles, scenes, nodes] = await Promise.all([
    validateStoryGameContent(scope, definition.narrativeModuleId),
    db.interactionCharacterProfiles.where('gameDefinitionId').equals(gameDefinitionId).toArray(),
    db.interactionSceneTemplates.where('gameDefinitionId').equals(gameDefinitionId).toArray(),
    db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).toArray(),
  ])
  const diagnostics: InteractionDraftDiagnostic[] = []
  const error = (code: string, message: string, recordKey?: string) => diagnostics.push({ severity: 'error', code, message, recordKey })
  const warning = (code: string, message: string, recordKey?: string) => diagnostics.push({ severity: 'warning', code, message, recordKey })
  if (!profiles.length) error('profiles.empty', '至少需要一个互动角色')
  if (!scenes.length) error('scenes.empty', '至少需要一个场景模板')
  const profileKeys = new Set<string>()
  const dimensions = new Map<string, Set<string>>()
  const knowledge = new Map<string, string>()
  for (const profile of profiles) {
    try {
      const key = stableKey(profile.participantKey, '参与者 key')
      if (profileKeys.has(key)) error('profile.duplicate-key', `参与者 key 重复:${key}`, key)
      profileKeys.add(key)
      if (!profile.roleLabel.trim() || !profile.voiceRules.trim()) error('profile.incomplete', '角色定位和口吻规则不能为空', key)
      const seeds = JSON.parse(normalizeKnowledge(profile.initialKnowledgeJson)) as InteractionKnowledgeSeed[]
      const parsedDimensions = JSON.parse(normalizeDimensions(profile.relationshipDimensionsJson)) as InteractionRelationshipDimension[]
      dimensions.set(key, new Set(parsedDimensions.map(item => item.key)))
      for (const seed of seeds) {
        const current = knowledge.get(seed.key)
        if (current != null && current !== seed.content) error('knowledge.conflicting-content', `同一知识 key 的内容冲突:${seed.key}`, key)
        knowledge.set(seed.key, seed.content)
      }
      const sourceCharacter = parseInteractionSourceCharacterSnapshot(profile.sourceSnapshotJson)
      if (profile.characterId != null && sourceCharacter) {
        throw new Error('[chatgame] 互动角色不能同时绑定实时角色与冻结来源')
      }
      if (profile.characterId != null) {
        await characterInScope(scope, profile.characterId)
      } else if (!sourceCharacter) {
        throw new Error('[chatgame] 互动角色缺少实时角色或冻结来源')
      }
    } catch (reason) {
      error('profile.invalid', reason instanceof Error ? reason.message : String(reason), profile.participantKey)
    }
  }
  const nodeKeys = new Set(nodes.map(item => item.key))
  const sceneKeys = new Set<string>()
  for (const scene of scenes) {
    try {
      const key = stableKey(scene.sceneKey, '场景 key')
      if (sceneKeys.has(key)) error('scene.duplicate-key', `场景 key 重复:${key}`, key)
      sceneKeys.add(key)
      const participants = JSON.parse(normalizedStringArray(scene.participantKeysJson, '场景参与者', true)) as string[]
      const publicKnowledge = JSON.parse(normalizedStringArray(scene.publicKnowledgeKeysJson, '公开知识')) as string[]
      const goals = JSON.parse(normalizedStringArray(scene.goalsJson, '场景目标', true)) as string[]
      const endings = JSON.parse(normalizedStringArray(scene.endingConditionsJson, '结束条件', true)) as string[]
      const safety = JSON.parse(normalizedStringArray(scene.safetyBoundariesJson, '安全边界', true)) as string[]
      void goals; void endings; void safety
      for (const participant of participants) if (!profileKeys.has(participant)) error('scene.unknown-participant', `场景引用不存在的角色:${participant}`, key)
      for (const knowledgeKey of publicKnowledge) if (!knowledge.has(knowledgeKey)) error('scene.unknown-knowledge', `场景引用不存在的知识:${knowledgeKey}`, key)
      if (scene.openingNodeKey && !nodeKeys.has(scene.openingNodeKey)) error('scene.unknown-opening-node', '场景开场节点不存在', key)
      if (scene.endingNodeKey && !nodeKeys.has(scene.endingNodeKey)) error('scene.unknown-ending-node', '场景结束节点不存在', key)
      if (!scene.openingNodeKey && !scene.endingNodeKey) warning('scene.no-narrative-link', '场景没有连接 Narrative Node，将作为纯互动场景', key)
      const rules = JSON.parse(normalizeRules(scene.relationshipRulesJson)) as InteractionRelationshipRule[]
      for (const rule of rules) {
        if (!profileKeys.has(rule.fromParticipantKey)) error('rule.unknown-participant', `关系规则引用不存在的角色:${rule.fromParticipantKey}`, key)
        if (!dimensions.get(rule.fromParticipantKey)?.has(rule.dimensionKey)) error('rule.unknown-dimension', `角色没有启用关系维度:${rule.dimensionKey}`, key)
        const profile = profiles.find(item => item.participantKey === rule.fromParticipantKey)
        const dimension = (JSON.parse(profile?.relationshipDimensionsJson ?? '[]') as InteractionRelationshipDimension[])
          .find(item => item.key === rule.dimensionKey)
        if (dimension && Math.abs(rule.delta) > dimension.largeChangeThreshold && !rule.significantEventKey) {
          error('rule.large-change-without-evidence', `大幅关系变化必须声明重大事件:${rule.ruleKey}`, key)
        }
      }
    } catch (reason) {
      error('scene.invalid', reason instanceof Error ? reason.message : String(reason), scene.sceneKey)
    }
  }
  if (!narrative.valid) error('narrative.invalid', '共享 Narrative 内容图校验未通过')
  return {
    valid: narrative.valid && !diagnostics.some(item => item.severity === 'error'),
    narrative,
    diagnostics,
    participantCount: profiles.length,
    sceneCount: scenes.length,
  }
}

export async function inspectInteractionContext(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  participantKey: string
}): Promise<InteractionContextInspection> {
  const snapshot = await loadInteractionAuthoringSnapshot(input.scope)
  const definition = snapshot.definitions.find(item => item.id === input.gameDefinitionId)
  if (!definition) throw new Error('[chatgame] 互动游戏定义不存在')
  const profile = snapshot.profiles.find(item => item.gameDefinitionId === definition.id
    && item.participantKey === input.participantKey)
  if (!profile) throw new Error('[chatgame] 互动角色档案不存在')
  const character = profile.characterId == null
    ? null
    : snapshot.characters.find(item => item.id === profile.characterId) ?? null
  const sourceCharacter = parseInteractionSourceCharacterSnapshot(profile.sourceSnapshotJson)
  if (character && sourceCharacter) throw new Error('[chatgame] 互动角色来源存在冲突')
  if (!character && !sourceCharacter) throw new Error('[chatgame] 互动角色来源不存在')
  const ownKnowledge = JSON.parse(normalizeKnowledge(profile.initialKnowledgeJson)) as InteractionKnowledgeSeed[]
  const allProfiles = snapshot.profiles.filter(item => item.gameDefinitionId === definition.id)
  const otherPrivate = allProfiles.flatMap(item => (
    item.id === profile.id ? [] : (JSON.parse(normalizeKnowledge(item.initialKnowledgeJson)) as InteractionKnowledgeSeed[])
      .filter(seed => seed.visibility === 'private').map(seed => seed.key)
  ))
  return {
    participantKey: profile.participantKey,
    profile: { characterName: character?.name ?? sourceCharacter!.name, roleLabel: profile.roleLabel, voiceRulesPresent: !!profile.voiceRules.trim() },
    visibleKnowledgeKeys: [...new Set([
      ...ownKnowledge.map(seed => seed.key),
      ...allProfiles.flatMap(item => (JSON.parse(normalizeKnowledge(item.initialKnowledgeJson)) as InteractionKnowledgeSeed[])
        .filter(seed => seed.visibility === 'public').map(seed => seed.key)),
    ])].sort(),
    hiddenKnowledgeKeys: [...new Set(otherPrivate)].sort(),
    sceneKeys: snapshot.scenes.filter(item => item.gameDefinitionId === definition.id
      && (JSON.parse(item.participantKeysJson) as string[]).includes(profile.participantKey)).map(item => item.sceneKey),
    memoryCapacity: profile.maxMemoryEntries,
    sourceKeys: ['interactionRuntime'],
  }
}

export async function deleteInteractionGameDraft(input: { scope: WorkspaceScope; gameDefinitionId: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  await db.transaction('rw', scopeTransactionTables(
    ...transactionTablesForReferences('gameDefinitions'),
    ...transactionTablesForReferences('narrativeModules'),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await definitionInScope(currentScope, definition.id!)
    const module = await db.narrativeModules.get(current.narrativeModuleId)
    if (!module || !await assertRecordInScope(currentScope, 'narrativeModules', module)) throw new Error('[chatgame] 叙事模块不存在')
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

export async function publishInteractionGameDraft(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  label?: string
  /**
   * Legacy deterministic runtime fixture only. Formal character-interaction
   * publication must use the stage-two Brief/SourcePlan and stage-three
   * production pipeline. Keeping this explicit guard prevents an authoring UI
   * from silently turning product narrative into a WorldRelease again.
   */
  fixtureOnly: true
}): Promise<InteractionGamePublication> {
  if (import.meta.env.MODE !== 'test') {
    throw new Error('[chatgame] 旧草稿发布只允许隔离测试夹具；正式发布必须进入角色互动制作流程')
  }
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  const report = await validateInteractionGameDraft(scope, definition.id!)
  if (!report.valid) {
    throw new Error(`[chatgame] 发布检查未通过:${report.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('；')}`)
  }
  const label = input.label?.trim() || `${definition.title} · 发布候选`
  const { revision, release: worldRelease } = await createInternalProductWorldReleaseFixtureV1({ scope, label })
  const gameRelease = await publishGameDefinition({
    scope,
    gameDefinitionId: definition.id!,
    worldReleaseId: worldRelease.id!,
    label,
    fixtureOnly: true,
  })
  return { report, revision, worldRelease, gameRelease }
}
