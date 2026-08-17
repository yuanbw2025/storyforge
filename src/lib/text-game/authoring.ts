import Dexie from 'dexie'
import { db } from '../db/schema'
import { transactionTablesForReferences } from '../registry/lifecycle'
import {
  addNarrativeNode,
  createNarrativeModule,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import {
  advanceFrozenNarrativeChoice,
  enterFrozenNarrativeNode,
} from '../simulation/runtime'
import type {
  GameDefinition,
  GameRelease,
  Character,
  NarrativeBeat,
  NarrativeBeatKind,
  NarrativeChoice,
  NarrativeContentGraphReport,
  NarrativeModule,
  NarrativeNode,
  NarrativeNodeKind,
  SimulationNarrativeState,
  WorkspaceScope,
  WorldRelease,
  WorldRevision,
} from '../types'
import { NARRATIVE_BEAT_KINDS, NARRATIVE_NODE_KINDS } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import {
  createWorldRevision,
  listWorldRevisions,
  publishWorldRevision,
} from '../world-engine/releases'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinitionRecordInTransaction,
  evaluateNarrativeChoices,
  parseGameDefinitionWorldSource,
  parseGameInitialVariables,
  validateStoryGameContent,
} from './content'
import { publishGameDefinition } from './releases'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/

export interface StoryGameAuthoringSnapshot {
  definitions: GameDefinition[]
  modules: NarrativeModule[]
  nodes: NarrativeNode[]
  beats: NarrativeBeat[]
  choices: NarrativeChoice[]
  releases: GameRelease[]
  characters: Character[]
}

export interface StoryGameDraftPreview {
  state: SimulationNarrativeState
  speakerNames: Record<string, string>
}

export interface StoryGamePublication {
  report: NarrativeContentGraphReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function stableKey(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !STABLE_KEY.test(normalized)) {
    throw new Error(`[storygame] ${label} 无效`)
  }
  return normalized
}

function objectJson(value: string, label: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[storygame] ${label} 不是合法 JSON`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[storygame] ${label} 必须是 JSON 对象`)
  }
  return JSON.stringify(parsed)
}

function stringArrayJson(value: string, label: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`[storygame] ${label} 不是合法 JSON`) }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[storygame] ${label} 必须是字符串数组`)
  }
  const normalized = [...new Set(parsed.map(item => String(item).trim()))]
  return JSON.stringify(normalized)
}

async function scopedModule(scope: WorkspaceScope, moduleId: number): Promise<NarrativeModule> {
  const module = await db.narrativeModules.get(moduleId)
  if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) {
    throw new Error('[storygame] 叙事模块不属于当前 scope')
  }
  return module
}

async function scopedDefinition(scope: WorkspaceScope, gameDefinitionId: number): Promise<GameDefinition> {
  const definition = await db.gameDefinitions.get(gameDefinitionId)
  if (!definition || !await assertRecordInScope(scope, 'gameDefinitions', definition, { owner: 'work' })) {
    throw new Error('[storygame] 游戏定义不属于当前 Work')
  }
  return definition
}

export async function loadStoryGameAuthoringSnapshot(scope: WorkspaceScope): Promise<StoryGameAuthoringSnapshot> {
  scope = await resolveScope({ scope })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId && row.productType === 'storygame')
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const moduleIds = [...new Set(definitions.map(row => row.narrativeModuleId))]
  const modules = (await Promise.all(moduleIds.map(id => db.narrativeModules.get(id))))
    .filter((row): row is NarrativeModule => row != null)
  for (const module of modules) {
    if (!await assertRecordInScope(scope, 'narrativeModules', module)) {
      throw new Error('[storygame] 游戏定义包含跨 scope 叙事模块')
    }
  }
  const [nodes, beats, choices, releases, characterRows] = await Promise.all([
    moduleIds.length ? db.narrativeNodes.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    moduleIds.length ? db.narrativeBeats.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    moduleIds.length ? db.narrativeChoices.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    db.gameReleases.where('workId').equals(scope.workId).toArray(),
    db.characters.where('projectId').equals(scope.projectId).toArray(),
  ])
  const characters: Character[] = []
  for (const character of characterRows) {
    if (await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) characters.push(character)
  }
  return {
    definitions,
    modules,
    nodes,
    beats,
    choices,
    releases: releases
      .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId)
      .sort((left, right) => right.version - left.version || right.createdAt - left.createdAt),
    characters: characters.sort((left, right) => left.name.localeCompare(right.name)),
  }
}

export async function updateGameDefinition(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  title: string
  description?: string
  initialVariablesJson: string
  status?: GameDefinition['status']
}): Promise<GameDefinition> {
  const title = input.title.trim()
  if (!title || title.length > 300) throw new Error('[storygame] 游戏标题无效')
  const initialVariablesJson = objectJson(input.initialVariablesJson, '初始变量')
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const definition = await scopedDefinition(scope, input.gameDefinitionId)
    const updatedAt = Date.now()
    await db.gameDefinitions.update(definition.id!, {
      title,
      description: input.description?.trim() ?? '',
      initialVariablesJson,
      status: input.status ?? definition.status,
      updatedAt,
    })
    return { ...definition, title, description: input.description?.trim() ?? '', initialVariablesJson, status: input.status ?? definition.status, updatedAt }
  })
}

/**
 * Remove an authoring draft. A custom module created exclusively for this
 * GameDefinition is deleted with its registered children; shared/projected
 * modules are preserved so other authoring surfaces cannot lose content.
 * Frozen releases are detached by the existing GameDefinition lifecycle.
 */
export async function deleteStoryGameDraft(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
}): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await scopedDefinition(scope, input.gameDefinitionId)
  await scopedModule(scope, definition.narrativeModuleId)
  await db.transaction('rw', scopeTransactionTables(
    ...transactionTablesForReferences('gameDefinitions'),
    ...transactionTablesForReferences('narrativeModules'),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await scopedDefinition(currentScope, definition.id!)
    const currentModule = await scopedModule(currentScope, current.narrativeModuleId)
    const consumers = await db.gameDefinitions.where('narrativeModuleId').equals(currentModule.id!).toArray()
    await deleteGameDefinitionRecordInTransaction(currentScope, current.id!)
    const moduleIsExclusiveDraft = consumers.length === 1
      && consumers[0].id === current.id
      && currentModule.sourceProjection === 'custom'
    if (!moduleIsExclusiveDraft) return
    await db.narrativeNodes.where('moduleId').equals(currentModule.id!).delete()
    await db.narrativeBeats.where('moduleId').equals(currentModule.id!).delete()
    await db.narrativeChoices.where('moduleId').equals(currentModule.id!).delete()
    const work = await db.works.get(currentScope.workId)
    if (work?.id != null && work.activeNarrativeModuleId === currentModule.id) {
      await db.works.update(work.id, { activeNarrativeModuleId: null, updatedAt: Date.now() })
    }
    await db.simulationSessions.where('narrativeModuleId').equals(currentModule.id!).modify({ narrativeModuleId: null })
    await db.narrativeModules.delete(currentModule.id!)
  })
}

export async function updateNarrativeModule(input: {
  scope: WorkspaceScope
  moduleId: number
  title: string
  description?: string
  entryNodeKey: string
  status?: NarrativeModule['status']
}): Promise<NarrativeModule> {
  const title = input.title.trim()
  const entryNodeKey = stableKey(input.entryNodeKey, '入口节点 key')
  if (!title || title.length > 500) throw new Error('[storygame] 模块标题无效')
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeNodes), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const module = await scopedModule(scope, input.moduleId)
    const entry = await db.narrativeNodes.where('moduleId').equals(module.id!).filter(node => node.key === entryNodeKey).first()
    if (!entry) throw new Error('[storygame] 入口节点不存在')
    const updatedAt = Date.now()
    const patch = {
      title,
      description: input.description?.trim() ?? '',
      entryNodeKey,
      status: input.status ?? module.status,
      updatedAt,
    }
    await db.narrativeModules.update(module.id!, patch)
    return { ...module, ...patch }
  })
}

export async function updateNarrativeNode(input: {
  scope: WorkspaceScope
  nodeId: number
  kind: NarrativeNodeKind
  title: string
  summary?: string
  conditionJson: string
  effectsJson: string
  order?: number
}): Promise<NarrativeNode> {
  if (!NARRATIVE_NODE_KINDS.includes(input.kind)) throw new Error('[storygame] 节点类型无效')
  const title = input.title.trim()
  if (!title || title.length > 500) throw new Error('[storygame] 节点标题无效')
  parseNarrativeCondition(input.conditionJson)
  parseNarrativeEffects(input.effectsJson)
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeNodes), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const node = await db.narrativeNodes.get(input.nodeId)
    if (!node) throw new Error('[storygame] 节点不存在')
    await scopedModule(scope, node.moduleId)
    const updatedAt = Date.now()
    const patch = {
      kind: input.kind,
      title,
      summary: input.summary?.trim() ?? '',
      conditionJson: input.conditionJson,
      effectsJson: input.effectsJson,
      order: input.order ?? node.order,
      updatedAt,
    }
    await db.narrativeNodes.update(node.id!, patch)
    return { ...node, ...patch }
  })
}

export async function deleteNarrativeNode(input: {
  scope: WorkspaceScope
  nodeId: number
}): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
  ), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const node = await db.narrativeNodes.get(input.nodeId)
    if (!node) throw new Error('[storygame] 节点不存在')
    const module = await scopedModule(scope, node.moduleId)
    if (module.entryNodeKey === node.key) throw new Error('[storygame] 入口节点不能删除；请先更换模块入口')
    await db.narrativeBeats.where('[moduleId+nodeKey]').equals([node.moduleId, node.key]).delete()
    await db.narrativeChoices.where('moduleId').equals(node.moduleId)
      .filter(choice => choice.sourceNodeKey === node.key || choice.targetNodeKey === node.key)
      .delete()
    await db.narrativeNodes.delete(node.id!)
    await db.narrativeModules.update(module.id!, { updatedAt: Date.now() })
  })
}

export async function updateNarrativeBeat(input: {
  scope: WorkspaceScope
  beatId: number
  kind: NarrativeBeatKind
  speakerCharacterId?: number | null
  text: string
  order?: number
}): Promise<NarrativeBeat> {
  const text = input.text.trim()
  if (!NARRATIVE_BEAT_KINDS.includes(input.kind) || !text || text.length > 40_000) {
    throw new Error('[storygame] Beat 内容无效')
  }
  if (input.kind === 'dialogue' && input.speakerCharacterId == null) throw new Error('[storygame] 对话 Beat 必须指定 speaker')
  if (input.kind !== 'dialogue' && input.speakerCharacterId != null) throw new Error('[storygame] 只有对话 Beat 可以指定 speaker')
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeBeats, db.characters), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const beat = await db.narrativeBeats.get(input.beatId)
    if (!beat) throw new Error('[storygame] Beat 不存在')
    await scopedModule(scope, beat.moduleId)
    if (input.speakerCharacterId != null) {
      const speaker = await db.characters.get(input.speakerCharacterId)
      if (!speaker || !await assertRecordInScope(scope, 'characters', speaker, { owner: 'world' })) {
        throw new Error('[storygame] Beat speaker 不属于当前 World')
      }
    }
    const updatedAt = Date.now()
    const patch = { kind: input.kind, speakerCharacterId: input.speakerCharacterId ?? null, text, order: input.order ?? beat.order, updatedAt }
    await db.narrativeBeats.update(beat.id!, patch)
    return { ...beat, ...patch }
  })
}

export async function deleteNarrativeBeat(input: { scope: WorkspaceScope; beatId: number }): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeBeats), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const beat = await db.narrativeBeats.get(input.beatId)
    if (!beat) throw new Error('[storygame] Beat 不存在')
    await scopedModule(scope, beat.moduleId)
    await db.narrativeBeats.delete(beat.id!)
  })
}

export async function updateNarrativeChoice(input: {
  scope: WorkspaceScope
  choiceId: number
  text: string
  description?: string
  unavailableReason?: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tagsJson: string
  order?: number
}): Promise<NarrativeChoice> {
  const text = input.text.trim()
  const targetNodeKey = stableKey(input.targetNodeKey, 'Choice 目标')
  if (!text || text.length > 4_000) throw new Error('[storygame] Choice 文本无效')
  parseNarrativeCondition(input.displayConditionJson)
  parseNarrativeCondition(input.availableConditionJson)
  parseNarrativeEffects(input.effectsJson)
  const tagsJson = stringArrayJson(input.tagsJson, 'Choice 标签')
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeNodes, db.narrativeChoices), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const choice = await db.narrativeChoices.get(input.choiceId)
    if (!choice) throw new Error('[storygame] Choice 不存在')
    await scopedModule(scope, choice.moduleId)
    const target = await db.narrativeNodes.where('moduleId').equals(choice.moduleId).filter(node => node.key === targetNodeKey).first()
    if (!target) throw new Error(`[storygame] Choice 目标节点不存在:${targetNodeKey}`)
    const updatedAt = Date.now()
    const patch = {
      text,
      description: input.description?.trim() ?? '',
      unavailableReason: input.unavailableReason?.trim() ?? '',
      targetNodeKey,
      displayConditionJson: input.displayConditionJson,
      availableConditionJson: input.availableConditionJson,
      effectsJson: input.effectsJson,
      tagsJson,
      order: input.order ?? choice.order,
      updatedAt,
    }
    await db.narrativeChoices.update(choice.id!, patch)
    return { ...choice, ...patch }
  })
}

export async function deleteNarrativeChoice(input: { scope: WorkspaceScope; choiceId: number }): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeChoices), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const choice = await db.narrativeChoices.get(input.choiceId)
    if (!choice) throw new Error('[storygame] Choice 不存在')
    await scopedModule(scope, choice.moduleId)
    await db.narrativeChoices.delete(choice.id!)
  })
}

export async function createStarterStoryGame(input: {
  scope: WorkspaceScope
  title?: string
  gameKey?: string
}): Promise<GameDefinition> {
  const title = input.title?.trim() || '未命名分支故事'
  const gameKey = stableKey(input.gameKey ?? `storygame-${Date.now().toString(36)}`, 'gameKey')
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
    db.gameDefinitions, db.characters, db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({ scope: input.scope, owner: 'work', kind: 'main', title })
    await addNarrativeNode({ scope: input.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '故事入口', order: 0 })
    await addNarrativeNode({ scope: input.scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '故事结局', order: 1 })
    await addNarrativeBeat({ scope: input.scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.narration', kind: 'narration', text: '在这里写下故事的第一段。', order: 0 })
    await addNarrativeChoice({ scope: input.scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'entry.finish', text: '走向结局', targetNodeKey: 'ending', order: 0 })
    return createGameDefinition({ scope: input.scope, gameKey, title, narrativeModuleId: module.id! })
  })
}

type SampleNode = { key: string; kind: NarrativeNodeKind; title: string }
type SampleChoice = { source: string; key: string; text: string; target: string; display?: string; available?: string; reason?: string; effects?: string }

const SAMPLE_NODES: SampleNode[] = [
  { key: 'ch1.entry', kind: 'entry', title: '第一章 · 失潮之夜' },
  { key: 'ch1.archive', kind: 'scene', title: '封闭档案室' },
  { key: 'ch1.roof', kind: 'scene', title: '钟塔屋顶' },
  { key: 'ch1.merge', kind: 'scene', title: '雨巷会合' },
  { key: 'ch1.alley', kind: 'scene', title: '跟随纸船' },
  { key: 'ch1.station', kind: 'scene', title: '废弃潮汐站' },
  { key: 'ch1.gate', kind: 'choice', title: '穿过旧城门' },
  { key: 'ch2.entry', kind: 'scene', title: '第二章 · 灯市无月' },
  { key: 'ch2.market', kind: 'scene', title: '灯市长街' },
  { key: 'ch2.temple', kind: 'scene', title: '沉没神龛' },
  { key: 'ch2.merge', kind: 'scene', title: '守灯人的屋檐' },
  { key: 'ch2.tower', kind: 'scene', title: '白塔盘梯' },
  { key: 'ch2.under', kind: 'scene', title: '地下水道' },
  { key: 'ch2.lantern', kind: 'scene', title: '点亮旧灯' },
  { key: 'ch2.bridge', kind: 'choice', title: '潮桥抉择' },
  { key: 'ch3.entry', kind: 'scene', title: '第三章 · 黎明以前' },
  { key: 'ch3.garden', kind: 'scene', title: '盐花庭院' },
  { key: 'ch3.engine', kind: 'scene', title: '潮汐机心' },
  { key: 'ch3.merge', kind: 'scene', title: '最后的地图' },
  { key: 'ch3.council', kind: 'scene', title: '议会长廊' },
  { key: 'ch3.harbor', kind: 'scene', title: '空港码头' },
  { key: 'ch3.final', kind: 'choice', title: '让城市记住什么' },
  { key: 'ending.truth', kind: 'ending', title: '真相之潮' },
  { key: 'ending.home', kind: 'ending', title: '归灯之路' },
  { key: 'ending.tide', kind: 'ending', title: '远海新生' },
]

const SAMPLE_CHOICES: SampleChoice[] = [
  { source: 'ch1.entry', key: 'ch1.seek-archive', text: '去档案室寻找失潮记录', target: 'ch1.archive', effects: '[{"op":"set","path":"clue","value":true}]' },
  { source: 'ch1.entry', key: 'ch1.climb-roof', text: '登上钟塔观察灯号', target: 'ch1.roof', effects: '[{"op":"set","path":"trust","value":1}]' },
  { source: 'ch1.archive', key: 'ch1.archive-merge', text: '带着旧图赶往雨巷', target: 'ch1.merge' },
  { source: 'ch1.roof', key: 'ch1.roof-merge', text: '循着灯号赶往雨巷', target: 'ch1.merge' },
  { source: 'ch1.merge', key: 'ch1.follow-boat', text: '跟随水沟里的纸船', target: 'ch1.alley' },
  { source: 'ch1.merge', key: 'ch1.enter-station', text: '请守门人打开潮汐站', target: 'ch1.station', available: '{"path":"trust","eq":1}', reason: '守门人还不信任你。' },
  { source: 'ch1.alley', key: 'ch1.alley-gate', text: '从暗巷抵达旧城门', target: 'ch1.gate' },
  { source: 'ch1.station', key: 'ch1.station-gate', text: '穿过停转的泵房', target: 'ch1.gate' },
  { source: 'ch1.gate', key: 'ch1.cross-gate', text: '进入无月的灯市', target: 'ch2.entry' },
  { source: 'ch2.entry', key: 'ch2.walk-market', text: '沿灯市寻找守灯人', target: 'ch2.market' },
  { source: 'ch2.entry', key: 'ch2.find-temple', text: '按旧图寻找沉没神龛', target: 'ch2.temple', display: '{"path":"clue","eq":true}' },
  { source: 'ch2.market', key: 'ch2.market-merge', text: '向屋檐下的守灯人求助', target: 'ch2.merge' },
  { source: 'ch2.temple', key: 'ch2.temple-merge', text: '带走神龛里的灯芯', target: 'ch2.merge', effects: '[{"op":"set","path":"wick","value":true}]' },
  { source: 'ch2.merge', key: 'ch2.climb-tower', text: '从白塔寻找风路', target: 'ch2.tower' },
  { source: 'ch2.merge', key: 'ch2.enter-under', text: '从水道寻找潮路', target: 'ch2.under' },
  { source: 'ch2.tower', key: 'ch2.tower-lantern', text: '把风声带回旧灯', target: 'ch2.lantern' },
  { source: 'ch2.under', key: 'ch2.under-lantern', text: '把潮声带回旧灯', target: 'ch2.lantern' },
  { source: 'ch2.lantern', key: 'ch2.light-lantern', text: '点亮守望灯', target: 'ch2.bridge', effects: '[{"op":"increment","path":"light","value":1}]' },
  { source: 'ch2.bridge', key: 'ch2.cross-bridge', text: '跨过正在苏醒的潮桥', target: 'ch3.entry' },
  { source: 'ch3.entry', key: 'ch3.enter-garden', text: '先去盐花庭院', target: 'ch3.garden' },
  { source: 'ch3.entry', key: 'ch3.enter-engine', text: '直奔潮汐机心', target: 'ch3.engine' },
  { source: 'ch3.garden', key: 'ch3.garden-merge', text: '收起最后一朵盐花', target: 'ch3.merge', effects: '[{"op":"set","path":"mercy","value":true}]' },
  { source: 'ch3.engine', key: 'ch3.engine-merge', text: '记下机心的真实频率', target: 'ch3.merge', effects: '[{"op":"set","path":"truth","value":true}]' },
  { source: 'ch3.merge', key: 'ch3.ask-council', text: '去议会公开地图', target: 'ch3.council' },
  { source: 'ch3.merge', key: 'ch3.reach-harbor', text: '去空港寻找离城船', target: 'ch3.harbor' },
  { source: 'ch3.council', key: 'ch3.council-final', text: '带着证词走上观潮台', target: 'ch3.final' },
  { source: 'ch3.harbor', key: 'ch3.harbor-final', text: '带着航线走上观潮台', target: 'ch3.final' },
  { source: 'ch3.final', key: 'ending.reveal', text: '让所有人看见真相', target: 'ending.truth' },
  { source: 'ch3.final', key: 'ending.return', text: '守住仍亮着的家灯', target: 'ending.home' },
  { source: 'ch3.final', key: 'ending.depart', text: '把灯火带向远海', target: 'ending.tide' },
]

export async function seedStoryGameAcceptanceSample(input: {
  scope: WorkspaceScope
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, 'lantern-harbor']).first()
  if (existing) return existing
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices,
    db.gameDefinitions, db.characters, db.outlineNodes,
  ), async () => {
    const module = await createNarrativeModule({
      scope,
      owner: 'work',
      kind: 'main',
      title: '《潮港守灯录》',
      description: '三章确定性分支叙事验收样例：路线分流、汇合、条件选项与三个结局。',
    })
    for (const [index, node] of SAMPLE_NODES.entries()) {
      await addNarrativeNode({ scope, moduleId: module.id!, ...node, order: index })
    }
    let beatIndex = 0
    for (const [nodeIndex, node] of SAMPLE_NODES.entries()) {
      const count = nodeIndex < 20 ? 2 : 1
      for (let local = 0; local < count; local += 1) {
        const isChapter = local === 0 && ['ch1.entry', 'ch2.entry', 'ch3.entry'].includes(node.key)
        await addNarrativeBeat({
          scope,
          moduleId: module.id!,
          nodeKey: node.key,
          beatKey: `${node.key}.beat-${local + 1}`,
          kind: isChapter ? 'system' : local === 0 ? 'narration' : 'action',
          text: isChapter
            ? node.title
            : local === 0
              ? `${node.title}前，潮声把被城市遗忘的名字送回岸上。`
              : '你记下眼前的细节，也知道这一步会改变后来抵达的道路。',
          order: beatIndex++,
        })
      }
    }
    for (const [order, choice] of SAMPLE_CHOICES.entries()) {
      await addNarrativeChoice({
        scope,
        moduleId: module.id!,
        sourceNodeKey: choice.source,
        choiceKey: choice.key,
        text: choice.text,
        description: `前往“${SAMPLE_NODES.find(node => node.key === choice.target)?.title ?? choice.target}”`,
        unavailableReason: choice.reason,
        targetNodeKey: choice.target,
        displayConditionJson: choice.display,
        availableConditionJson: choice.available,
        effectsJson: choice.effects,
        tags: choice.key.startsWith('ending.') ? ['ending'] : [choice.source.split('.')[0]],
        order,
      })
    }
    const definition = await createGameDefinition({
      scope,
      gameKey: 'lantern-harbor',
      title: '潮港守灯录',
      description: '失潮之夜，守灯人必须决定这座城市应当记住什么。',
      narrativeModuleId: module.id!,
      initialVariables: { clue: false, trust: 0, light: 0 },
    })
    const report = await validateStoryGameContent(scope, module.id!)
    if (!report.valid || SAMPLE_NODES.length < 25 || beatIndex < 45 || SAMPLE_CHOICES.length < 20) {
      throw new Error(`[storygame] 验收样例生成失败:${[...report.errors, ...report.unreachableNodeKeys].join('；')}`)
    }
    return definition
  })
}

export async function buildStoryGameDraftPreview(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  startNodeKey?: string
}): Promise<StoryGameDraftPreview> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await scopedDefinition(scope, input.gameDefinitionId)
  const module = await scopedModule(scope, definition.narrativeModuleId)
  const [nodes, beats, choices] = await Promise.all([
    db.narrativeNodes.where('moduleId').equals(module.id!).sortBy('order'),
    db.narrativeBeats.where('moduleId').equals(module.id!).sortBy('order'),
    db.narrativeChoices.where('moduleId').equals(module.id!).sortBy('order'),
  ])
  const speakerIds = [...new Set(beats.flatMap(beat => beat.speakerCharacterId == null ? [] : [beat.speakerCharacterId]))]
  const speakers = await Promise.all(speakerIds.map(id => db.characters.get(id)))
  const speakerNames: Record<string, string> = {}
  for (const speaker of speakers) {
    if (speaker?.id != null && await assertRecordInScope(scope, 'characters', speaker, { owner: 'world' })) {
      speakerNames[`character:${speaker.id}`] = speaker.name
    }
  }
  const frozenNodes = nodes.map(node => ({
    key: node.key,
    kind: node.kind,
    title: node.title,
    summary: node.summary,
    conditionJson: node.conditionJson,
    effectsJson: node.effectsJson,
    successorKeys: JSON.parse(node.successorKeysJson) as string[],
  }))
  const frozenBeats = beats.map(beat => ({
    beatKey: beat.beatKey,
    nodeKey: beat.nodeKey,
    kind: beat.kind,
    speakerKey: beat.speakerCharacterId == null ? null : `character:${beat.speakerCharacterId}`,
    text: beat.text,
    order: beat.order,
  }))
  const frozenChoices = choices.map(choice => ({
    choiceKey: choice.choiceKey,
    sourceNodeKey: choice.sourceNodeKey,
    text: choice.text,
    description: choice.description,
    unavailableReason: choice.unavailableReason,
    targetNodeKey: choice.targetNodeKey,
    displayConditionJson: choice.displayConditionJson,
    availableConditionJson: choice.availableConditionJson,
    effectsJson: choice.effectsJson,
    tags: JSON.parse(choice.tagsJson) as string[],
    order: choice.order,
  }))
  const source = { definition, module, nodes: frozenNodes, beats: frozenBeats, choices: frozenChoices }
  const contentHash = await sha256(source)
  const empty: SimulationNarrativeState = {
    schema: 'storyforge.simulation-narrative',
    version: 2,
    sourceModuleId: module.id!,
    sourceModuleExportId: null,
    moduleKind: module.kind,
    moduleTitle: module.title,
    sourceHash: contentHash,
    contentHash,
    nodes: frozenNodes,
    beats: frozenBeats,
    choices: frozenChoices,
    currentNodeKey: null,
    visitedNodeKeys: [],
    availableNodeKeys: [],
    variables: parseGameInitialVariables(definition),
    completed: false,
    visibleChoiceKeys: [],
    availableChoiceKeys: [],
    choiceHistory: [],
    endingKey: null,
    completedAtSequence: null,
    lastEnteredNodeSequence: null,
  }
  const startNodeKey = input.startNodeKey?.trim() || module.entryNodeKey || frozenNodes.find(node => node.kind === 'entry')?.key
  if (!startNodeKey) throw new Error('[storygame] 草稿试玩缺少起始节点')
  return { state: enterFrozenNarrativeNode(empty, startNodeKey, { eventSequence: 1 }), speakerNames }
}

export function advanceStoryGameDraftPreview(
  preview: StoryGameDraftPreview,
  choiceKey: string,
): StoryGameDraftPreview {
  // Match the persisted protocol: started #1, initial node-entered #2,
  // then each choice/node-entered pair consumes two sequence positions.
  const eventSequence = (preview.state.choiceHistory?.length ?? 0) * 2 + 3
  return { ...preview, state: advanceFrozenNarrativeChoice(preview.state, choiceKey, eventSequence) }
}

export function evaluateStoryGameDraftChoices(preview: StoryGameDraftPreview) {
  const state = preview.state
  if (!state.currentNodeKey || state.completed) return []
  return evaluateNarrativeChoices({
    ...state.variables,
    __visitedNodeKeys: state.visitedNodeKeys,
    __selectedChoiceKeys: (state.choiceHistory ?? []).map(item => item.choiceKey),
  }, state.currentNodeKey, state.choices ?? [])
}

export async function publishStoryGameDraft(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  label?: string
}): Promise<StoryGamePublication> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await scopedDefinition(scope, input.gameDefinitionId)
  parseGameDefinitionWorldSource(definition)
  const report = await validateStoryGameContent(scope, definition.narrativeModuleId)
  if (!report.valid) {
    throw new Error(`[storygame] 发布检查未通过:${[
      ...report.errors,
      ...report.danglingSuccessors.map(item => `${item.nodeKey}->${item.successorKey}`),
      ...report.invalidChoiceTargets.map(item => `${item.choiceKey}->${item.targetNodeKey}`),
      ...report.unreachableNodeKeys.map(key => `不可达:${key}`),
    ].join('；')}`)
  }
  const latest = (await listWorldRevisions(scope))[0]
  const label = input.label?.trim() || `${definition.title} · 发布候选`
  const revision = await createWorldRevision({
    scope,
    label,
    parentRevisionId: latest?.id ?? null,
    selectedNarrativeModuleIds: [definition.narrativeModuleId],
  })
  const worldRelease = await publishWorldRevision(revision.id!, label)
  const gameRelease = await publishGameDefinition({
    scope,
    gameDefinitionId: definition.id!,
    worldReleaseId: worldRelease.id!,
    label,
  })
  return { report, revision, worldRelease, gameRelease }
}
