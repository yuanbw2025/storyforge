import { db } from '../db/schema'
import { createNarrativeModule, addNarrativeNode } from '../narrative/blueprint'
import { transactionTablesForReferences } from '../registry/lifecycle'
import { deleteGameDefinitionRecordInTransaction, addNarrativeBeat, addNarrativeChoice, createGameDefinition, parseGameDefinitionWorldSource, validateStoryGameContent } from '../text-game/content'
import { parseAvgGameReleaseManifest, publishGameDefinition } from '../text-game/releases'
import { seedStoryGameAcceptanceSample } from '../text-game/authoring'
import type {
  AvgMediaAsset, AvgMediaBlob, AvgMediaKind, AvgPresentationContentV1, AvgPresentationCue,
  AvgPresentationModule, AvgValidationReport, FrozenNarrativeBeat, GameDefinition, GameRelease,
  NarrativeBeat, NarrativeChoice, NarrativeModule, NarrativeNode, WorkspaceScope, WorldRelease, WorldRevision,
} from '../types'
import { AVG_MEDIA_KINDS } from '../types'
import { createWorldRevision, listWorldRevisions, publishWorldRevision } from '../world-engine/releases'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { freezeAvgMediaAsset, parseAvgPresentationContent, validateAvgPresentation } from './runtime'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/

export interface AvgAuthoringSnapshot {
  definitions: GameDefinition[]
  modules: NarrativeModule[]
  nodes: NarrativeNode[]
  beats: NarrativeBeat[]
  choices: NarrativeChoice[]
  presentationModules: AvgPresentationModule[]
  assets: AvgMediaAsset[]
  releases: GameRelease[]
}

export interface AvgPublication {
  report: AvgValidationReport
  revision: WorldRevision
  worldRelease: WorldRelease
  gameRelease: GameRelease
}

function key(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !STABLE_KEY.test(normalized)) throw new Error(`[avg] ${label} 无效`)
  return normalized
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function definitionInScope(scope: WorkspaceScope, id: number): Promise<GameDefinition> {
  const row = await db.gameDefinitions.get(id)
  if (!row || row.productType !== 'avg' || !await assertRecordInScope(scope, 'gameDefinitions', row, { owner: 'work' })) {
    throw new Error('[avg] 游戏定义不属于当前 Work')
  }
  return row
}

function frozenBeat(row: NarrativeBeat): FrozenNarrativeBeat {
  return { beatKey: row.beatKey, nodeKey: row.nodeKey, kind: row.kind, speakerKey: row.speakerCharacterId == null ? null : `character:${row.speakerCharacterId}`, text: row.text, order: row.order }
}

export async function loadAvgAuthoringSnapshot(inputScope: WorkspaceScope): Promise<AvgAuthoringSnapshot> {
  const scope = await resolveScope({ scope: inputScope })
  const definitions = (await db.gameDefinitions.where('workId').equals(scope.workId).toArray())
    .filter(row => row.projectId === scope.projectId && row.worldId === scope.worldId && row.productType === 'avg')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const definitionIds = definitions.map(row => row.id!)
  const moduleIds = definitions.map(row => row.narrativeModuleId)
  const [modules, nodes, beats, choices, presentationModules, assets, releases] = await Promise.all([
    Promise.all(moduleIds.map(id => db.narrativeModules.get(id))).then(rows => rows.filter((row): row is NarrativeModule => !!row)),
    moduleIds.length ? db.narrativeNodes.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    moduleIds.length ? db.narrativeBeats.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    moduleIds.length ? db.narrativeChoices.where('moduleId').anyOf(moduleIds).sortBy('order') : [],
    definitionIds.length ? db.avgPresentationModules.where('gameDefinitionId').anyOf(definitionIds).toArray() : [],
    db.avgMediaAssets.where('workId').equals(scope.workId).toArray(),
    db.gameReleases.where('workId').equals(scope.workId).filter(row => definitionIds.includes(row.gameDefinitionId ?? -1)).toArray(),
  ])
  return { definitions, modules, nodes, beats, choices, presentationModules, assets: assets.sort((a, b) => a.assetKey.localeCompare(b.assetKey) || b.version - a.version), releases: releases.sort((a, b) => b.version - a.version) }
}

export async function createAvgGame(input: { scope: WorkspaceScope; title?: string; gameKey?: string }): Promise<GameDefinition> {
  const title = input.title?.trim() || '未命名视觉小说'
  const gameKey = key(input.gameKey ?? `avg-${Date.now().toString(36)}`, 'gameKey')
  return db.transaction('rw', scopeTransactionTables(db.narrativeModules, db.narrativeNodes, db.narrativeBeats, db.narrativeChoices, db.gameDefinitions, db.avgPresentationModules, db.characters, db.outlineNodes), async () => {
    const module = await createNarrativeModule({ scope: input.scope, owner: 'work', kind: 'main', title })
    await addNarrativeNode({ scope: input.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '开场', order: 0 })
    await addNarrativeNode({ scope: input.scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '结局', order: 1 })
    await addNarrativeBeat({ scope: input.scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.line', kind: 'narration', text: '在这里开始视觉小说。', order: 0 })
    await addNarrativeChoice({ scope: input.scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'entry.end', text: '继续', targetNodeKey: 'ending', order: 0 })
    const definition = await createGameDefinition({ scope: input.scope, gameKey, title, narrativeModuleId: module.id!, productType: 'avg' })
    const scope = await resolveScope({ scope: input.scope })
    const now = Date.now()
    await db.avgPresentationModules.add(stampNewRecord(scope, 'avgPresentationModules', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, gameDefinitionId: definition.id!,
      contentJson: JSON.stringify({ version: 1, cues: [] } satisfies AvgPresentationContentV1), createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    return definition
  })
}

/** Materialize an AVG shell around an existing governed NarrativeModule. */
export async function createAvgGameFromNarrative(input: {
  scope: WorkspaceScope
  title: string
  gameKey: string
  narrativeModuleId: number
  content?: AvgPresentationContentV1
  sourceWorldContentHash?: string
  sourceSelectionJson?: string
  sourceMappingVersion?: number
}): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  return db.transaction('rw', scopeTransactionTables(
    db.narrativeModules,
    db.gameDefinitions,
    db.avgPresentationModules,
  ), async () => {
    const definition = await createGameDefinition({
      scope,
      gameKey: input.gameKey,
      title: input.title,
      narrativeModuleId: input.narrativeModuleId,
      productType: 'avg',
      sourceWorldContentHash: input.sourceWorldContentHash,
      sourceSelectionJson: input.sourceSelectionJson,
      sourceMappingVersion: input.sourceMappingVersion,
    })
    const now = Date.now()
    await db.avgPresentationModules.add(stampNewRecord(scope, 'avgPresentationModules', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: definition.id!,
      contentJson: JSON.stringify(input.content ?? { version: 1, cues: [] } satisfies AvgPresentationContentV1),
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    return definition
  })
}

export async function importAvgMediaAsset(input: {
  scope: WorkspaceScope
  assetKey: string
  kind: AvgMediaKind
  name: string
  blob: Blob
  altText?: string
  source?: string
  license?: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  characterTag?: string
  sceneTag?: string
  /** Re-publish an older identical binary as the latest version when projecting an immutable source release. */
  forceLatest?: boolean
}): Promise<AvgMediaAsset> {
  const scope = await resolveScope({ scope: input.scope })
  const assetKey = key(input.assetKey, 'assetKey')
  if (!AVG_MEDIA_KINDS.includes(input.kind) || !input.name.trim() || input.blob.size > 100 * 1024 * 1024) throw new Error('[avg] 媒资输入无效或超过 100MB')
  const data = await input.blob.arrayBuffer()
  const contentHash = await hashBlob(new Blob([data]))
  const existing = (await db.avgMediaAssets.where('workId').equals(scope.workId).filter(row => row.assetKey === assetKey).toArray())
  const duplicate = existing.find(row => row.contentHash === contentHash)
  const latestVersion = Math.max(0, ...existing.map(row => row.version))
  if (duplicate && (!input.forceLatest || duplicate.version === latestVersion)) return duplicate
  const version = latestVersion + 1
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.avgMediaAssets, db.avgMediaBlobs), async () => {
    const row = stampNewRecord(scope, 'avgMediaAssets', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, assetKey, version, kind: input.kind,
      name: input.name.trim(), mimeType: input.blob.type.toLowerCase() || 'application/octet-stream', byteSize: input.blob.size,
      width: input.width ?? null, height: input.height ?? null, durationMs: input.durationMs ?? null, contentHash,
      source: input.source?.trim() ?? '', license: input.license?.trim() ?? '', altText: input.altText?.trim() ?? '',
      characterTag: input.characterTag?.trim() ?? '', sceneTag: input.sceneTag?.trim() ?? '', createdAt: now, updatedAt: now,
    } satisfies AvgMediaAsset, { owner: 'work' })
    const id = await db.avgMediaAssets.add(row) as number
    const blobRow = stampNewRecord(scope, 'avgMediaBlobs', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, mediaAssetId: id, data, createdAt: now,
    } satisfies AvgMediaBlob, { owner: 'work' })
    await db.avgMediaBlobs.add(blobRow)
    return { ...row, id }
  })
}

export async function updateAvgPresentation(input: { scope: WorkspaceScope; gameDefinitionId: number; content: AvgPresentationContentV1 | string }): Promise<AvgPresentationModule> {
  const scope = await resolveScope({ scope: input.scope })
  await definitionInScope(scope, input.gameDefinitionId)
  const content = parseAvgPresentationContent(input.content)
  return db.transaction('rw', scopeTransactionTables(db.gameDefinitions, db.avgPresentationModules), async () => {
    const row = await db.avgPresentationModules.where('gameDefinitionId').equals(input.gameDefinitionId).first()
    if (!row || !await assertRecordInScope(scope, 'avgPresentationModules', row, { owner: 'work' })) throw new Error('[avg] 演出模块不存在')
    const updatedAt = Date.now(); const contentJson = JSON.stringify(content)
    await db.avgPresentationModules.update(row.id!, { contentJson, updatedAt })
    return { ...row, contentJson, updatedAt }
  })
}

export async function validateAvgGame(scopeInput: WorkspaceScope, gameDefinitionId: number): Promise<AvgValidationReport> {
  const scope = await resolveScope({ scope: scopeInput })
  const definition = await definitionInScope(scope, gameDefinitionId)
  const [presentation, beats, allAssets] = await Promise.all([
    db.avgPresentationModules.where('gameDefinitionId').equals(definition.id!).first(),
    db.narrativeBeats.where('moduleId').equals(definition.narrativeModuleId).sortBy('order'),
    db.avgMediaAssets.where('workId').equals(scope.workId).toArray(),
  ])
  if (!presentation) throw new Error('[avg] 演出模块不存在')
  const latestRows = [...allAssets].sort((a, b) => b.version - a.version).filter((asset, index, rows) => rows.findIndex(item => item.assetKey === asset.assetKey) === index)
  const latest = latestRows.map(freezeAvgMediaAsset)
  const content = parseAvgPresentationContent(presentation.contentJson)
  const referenced = new Set(content.cues.flatMap(cue => cue.assetKey ? [cue.assetKey] : []))
  const report = validateAvgPresentation({ content, beats: beats.map(frozenBeat), assets: latest.filter(asset => referenced.has(asset.assetKey)), allWorkAssets: latest })
  const binaryErrors: string[] = []
  for (const asset of latestRows.filter(row => referenced.has(row.assetKey))) {
    const blob = await db.avgMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
    if (!blob || blob.data.byteLength !== asset.byteSize || await hashBlob(new Blob([blob.data])) !== asset.contentHash) {
      binaryErrors.push(`[avg] 媒资二进制缺失或完整性失败:${asset.assetKey}@${asset.version}`)
    }
  }
  return { ...report, valid: report.valid && binaryErrors.length === 0, errors: [...report.errors, ...binaryErrors] }
}

export async function deleteAvgMediaAsset(input: { scope: WorkspaceScope; mediaAssetId: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.avgMediaAssets.get(input.mediaAssetId)
  if (!asset || !await assertRecordInScope(scope, 'avgMediaAssets', asset, { owner: 'work' })) throw new Error('[avg] 媒资不存在')
  const releases = await db.gameReleases.where('workId').equals(scope.workId).toArray()
  if (releases.some(release => {
    try {
      return parseAvgGameReleaseManifest(release.manifestJson).presentation.assets
        .some(frozen => frozen.assetKey === asset.assetKey && frozen.version === asset.version)
    } catch { return false }
  })) {
    throw new Error('[avg] 媒资仍被不可变发布引用，不能删除')
  }
  const latestVersion = Math.max(...(await db.avgMediaAssets.where('workId').equals(scope.workId)
    .filter(row => row.assetKey === asset.assetKey).toArray()).map(row => row.version))
  const liveModules = await db.avgPresentationModules.where('workId').equals(scope.workId).toArray()
  if (asset.version === latestVersion
    && liveModules.some(module => parseAvgPresentationContent(module.contentJson).cues.some(cue => cue.assetKey === asset.assetKey))) {
    throw new Error('[avg] 媒资最新版本仍被草稿引用，不能删除')
  }
  await db.transaction('rw', scopeTransactionTables(db.avgMediaAssets, db.avgMediaBlobs), async () => {
    await db.avgMediaBlobs.where('mediaAssetId').equals(asset.id!).delete()
    await db.avgMediaAssets.delete(asset.id!)
  })
}

export async function publishAvgGame(input: { scope: WorkspaceScope; gameDefinitionId: number; label?: string }): Promise<AvgPublication> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  parseGameDefinitionWorldSource(definition)
  const graph = await validateStoryGameContent(scope, definition.narrativeModuleId)
  if (!graph.valid) throw new Error(`[avg] 叙事内容不可发布:${graph.errors.join('；')}`)
  const report = await validateAvgGame(scope, definition.id!)
  if (!report.valid) throw new Error(`[avg] 演出内容不可发布:${report.errors.join('；')}`)
  const latest = (await listWorldRevisions(scope))[0]
  const label = input.label?.trim() || `${definition.title} · AVG 发布`
  const revision = await createWorldRevision({ scope, label, parentRevisionId: latest?.id ?? null, selectedNarrativeModuleIds: [definition.narrativeModuleId] })
  const worldRelease = await publishWorldRevision(revision.id!, label)
  const gameRelease = await publishGameDefinition({ scope, gameDefinitionId: definition.id!, worldReleaseId: worldRelease.id!, label })
  return { report, revision, worldRelease, gameRelease }
}

export async function deleteAvgGameDraft(input: { scope: WorkspaceScope; gameDefinitionId: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await definitionInScope(scope, input.gameDefinitionId)
  await db.transaction('rw', scopeTransactionTables(...transactionTablesForReferences('gameDefinitions'), ...transactionTablesForReferences('narrativeModules')), async () => {
    const consumers = await db.gameDefinitions.where('narrativeModuleId').equals(definition.narrativeModuleId).toArray()
    await deleteGameDefinitionRecordInTransaction(scope, definition.id!)
    if (consumers.length !== 1) return
    await db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).delete()
    await db.narrativeBeats.where('moduleId').equals(definition.narrativeModuleId).delete()
    await db.narrativeChoices.where('moduleId').equals(definition.narrativeModuleId).delete()
    await db.simulationSessions.where('narrativeModuleId').equals(definition.narrativeModuleId)
      .modify({ narrativeModuleId: null })
    const work = await db.works.get(scope.workId)
    if (work?.activeNarrativeModuleId === definition.narrativeModuleId) {
      await db.works.update(work.id!, { activeNarrativeModuleId: null, updatedAt: Date.now() })
    }
    await db.narrativeModules.delete(definition.narrativeModuleId)
  })
}

const SAMPLE_ASSETS: Array<{ key: string; kind: AvgMediaKind; mime: string; alt: string }> = [
  ...['harbor-night', 'archive', 'lantern-market', 'tide-bridge', 'dawn'].map(key => ({ key: `bg.${key}`, kind: 'background' as const, mime: 'image/svg+xml', alt: `${key} 场景背景` })),
  ...['lin.neutral', 'lin.smile', 'lin.afraid', 'yu.neutral', 'yu.angry', 'yu.soft', 'keeper.neutral', 'keeper.smile', 'keeper.sad'].map(key => ({ key: `actor.${key}`, kind: 'character-pose' as const, mime: 'image/svg+xml', alt: `${key} 角色立绘` })),
  ...['truth', 'home', 'sea'].map(key => ({ key: `cg.${key}`, kind: 'cg' as const, mime: 'image/svg+xml', alt: `${key} 结局 CG` })),
  { key: 'audio.theme', kind: 'bgm', mime: 'audio/wav', alt: '' }, { key: 'audio.rain', kind: 'ambience', mime: 'audio/wav', alt: '' },
  { key: 'audio.bell', kind: 'sfx', mime: 'audio/wav', alt: '' }, { key: 'audio.voice', kind: 'voice', mime: 'audio/wav', alt: '' },
]

function sampleCue(cueKey: string, beatKey: string, type: AvgPresentationCue['type'], assetKey?: string, extra: Partial<AvgPresentationCue> = {}): AvgPresentationCue {
  return { cueKey, beatKey, phase: 'before', type, assetKey: assetKey ?? null, actorKey: null, slot: null, layer: null, x: null, y: null, scale: null, opacity: null, tone: null, durationMs: 300, easing: 'ease', volume: null, loop: false, snapshotKey: null, order: 0, ...extra }
}

export async function seedAvgAcceptanceGame(input: { scope: WorkspaceScope }): Promise<GameDefinition> {
  const scope = await resolveScope({ scope: input.scope })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, 'lantern-harbor-avg']).first()
  if (existing) return existing
  const story = await seedStoryGameAcceptanceSample({ scope })
  const definition = await createGameDefinition({
    scope,
    gameKey: 'lantern-harbor-avg',
    title: '潮港守灯录 · 演出版',
    description: '复用《潮港守灯录》完整三章、三结局 Narrative 的 20 至 40 分钟视觉演出版。',
    narrativeModuleId: story.narrativeModuleId,
    productType: 'avg',
    initialVariables: { clue: false, trust: 0, light: 0 },
  })
  const now = Date.now()
  await db.avgPresentationModules.add(stampNewRecord(scope, 'avgPresentationModules', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    gameDefinitionId: definition.id!, contentJson: JSON.stringify({ version: 1, cues: [] }), createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  for (const asset of SAMPLE_ASSETS) {
    const body = asset.mime.startsWith('image/') ? `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#203040"/><text x="16" y="90" fill="white">${asset.key}</text></svg>` : `RIFF-${asset.key}`
    await importAvgMediaAsset({ scope, assetKey: asset.key, kind: asset.kind, name: asset.key, blob: new Blob([body], { type: asset.mime }), altText: asset.alt, source: 'StoryForge acceptance fixture', license: 'CC0 test fixture' })
  }
  const cues = [
    sampleCue('cue.entry.background', 'ch1.entry.beat-1', 'set-background', 'bg.harbor-night', { order: 0 }),
    sampleCue('cue.entry.bgm', 'ch1.entry.beat-1', 'play-audio', 'audio.theme', { loop: true, volume: .6, order: 1 }),
    sampleCue('cue.entry.rain', 'ch1.entry.beat-1', 'play-audio', 'audio.rain', { loop: true, volume: .35, order: 2 }),
    sampleCue('cue.entry.lin-neutral', 'ch1.entry.beat-2', 'show-actor', 'actor.lin.neutral', { actorKey: 'lin', slot: 'center', layer: 'actor-front', order: 0 }),
    sampleCue('cue.archive.background', 'ch1.archive.beat-1', 'set-background', 'bg.archive', { order: 0 }),
    sampleCue('cue.archive.lin-afraid', 'ch1.archive.beat-2', 'show-actor', 'actor.lin.afraid', { actorKey: 'lin', slot: 'left', layer: 'actor-front', order: 1 }),
    sampleCue('cue.market.background', 'ch2.market.beat-1', 'set-background', 'bg.lantern-market', { order: 0 }),
    sampleCue('cue.market.crossfade', 'ch2.market.beat-1', 'transition', undefined, { tone: 'crossfade', order: 1 }),
    sampleCue('cue.market.lin-smile', 'ch2.market.beat-1', 'show-actor', 'actor.lin.smile', { actorKey: 'lin', slot: 'left', layer: 'actor-front', order: 2 }),
    sampleCue('cue.market.yu-neutral', 'ch2.market.beat-1', 'show-actor', 'actor.yu.neutral', { actorKey: 'yu', slot: 'center', layer: 'actor-front', order: 3 }),
    sampleCue('cue.market.keeper-neutral', 'ch2.market.beat-1', 'show-actor', 'actor.keeper.neutral', { actorKey: 'keeper', slot: 'right', layer: 'actor-back', order: 4 }),
    sampleCue('cue.market.yu-angry', 'ch2.market.beat-2', 'show-actor', 'actor.yu.angry', { actorKey: 'yu', slot: 'center', layer: 'actor-front', order: 0 }),
    sampleCue('cue.market.keeper-smile', 'ch2.market.beat-2', 'show-actor', 'actor.keeper.smile', { actorKey: 'keeper', slot: 'right', layer: 'actor-back', order: 1 }),
    sampleCue('cue.market.move', 'ch2.market.beat-2', 'move-actor', undefined, { actorKey: 'lin', slot: 'left', x: -.5, order: 2 }),
    sampleCue('cue.market.bell', 'ch2.market.beat-2', 'play-audio', 'audio.bell', { volume: .8, order: 3 }),
    sampleCue('cue.market.voice', 'ch2.market.beat-2', 'play-audio', 'audio.voice', { volume: .75, order: 4 }),
    sampleCue('cue.market.shake', 'ch2.market.beat-2', 'shake', undefined, { order: 5 }),
    sampleCue('cue.market.keeper-exit', 'ch2.market.beat-2', 'hide-actor', undefined, { actorKey: 'keeper', order: 6 }),
    sampleCue('cue.bridge.background', 'ch2.bridge.beat-1', 'set-background', 'bg.tide-bridge', { order: 0 }),
    sampleCue('cue.bridge.camera', 'ch2.bridge.beat-2', 'camera', undefined, { scale: 1.2, order: 1 }),
    sampleCue('cue.final.background', 'ch3.final.beat-1', 'set-background', 'bg.dawn', { order: 0 }),
    sampleCue('cue.final.lin-neutral', 'ch3.final.beat-1', 'show-actor', 'actor.lin.neutral', { actorKey: 'lin', slot: 'left', order: 1 }),
    sampleCue('cue.final.yu-soft', 'ch3.final.beat-1', 'show-actor', 'actor.yu.soft', { actorKey: 'yu', slot: 'right', order: 2 }),
    sampleCue('cue.final.keeper-sad', 'ch3.final.beat-1', 'show-actor', 'actor.keeper.sad', { actorKey: 'keeper', slot: 'center', layer: 'actor-back', order: 3 }),
    sampleCue('cue.final.flash', 'ch3.final.beat-1', 'flash', undefined, { order: 4 }),
    sampleCue('cue.truth.lin-smile', 'ending.truth.beat-1', 'show-actor', 'actor.lin.smile', { actorKey: 'lin', slot: 'center', order: 0 }),
    sampleCue('cue.truth.yu-neutral', 'ending.truth.beat-1', 'show-actor', 'actor.yu.neutral', { actorKey: 'yu', slot: 'right', order: 1 }),
    sampleCue('cue.truth.keeper-neutral', 'ending.truth.beat-1', 'show-actor', 'actor.keeper.neutral', { actorKey: 'keeper', slot: 'left', order: 2 }),
    sampleCue('cue.truth.cg', 'ending.truth.beat-1', 'show-cg', 'cg.truth', { order: 3 }),
    sampleCue('cue.home.lin-neutral', 'ending.home.beat-1', 'show-actor', 'actor.lin.neutral', { actorKey: 'lin', slot: 'left', order: 0 }),
    sampleCue('cue.home.yu-soft', 'ending.home.beat-1', 'show-actor', 'actor.yu.soft', { actorKey: 'yu', slot: 'right', order: 1 }),
    sampleCue('cue.home.keeper-smile', 'ending.home.beat-1', 'show-actor', 'actor.keeper.smile', { actorKey: 'keeper', slot: 'center', order: 2 }),
    sampleCue('cue.home.cg', 'ending.home.beat-1', 'show-cg', 'cg.home', { order: 3 }),
    sampleCue('cue.sea.lin-afraid', 'ending.tide.beat-1', 'show-actor', 'actor.lin.afraid', { actorKey: 'lin', slot: 'left', order: 0 }),
    sampleCue('cue.sea.yu-angry', 'ending.tide.beat-1', 'show-actor', 'actor.yu.angry', { actorKey: 'yu', slot: 'right', order: 1 }),
    sampleCue('cue.sea.keeper-sad', 'ending.tide.beat-1', 'show-actor', 'actor.keeper.sad', { actorKey: 'keeper', slot: 'center', order: 2 }),
    sampleCue('cue.sea.cg', 'ending.tide.beat-1', 'show-cg', 'cg.sea', { order: 3 }),
  ]
  await updateAvgPresentation({ scope, gameDefinitionId: definition.id!, content: { version: 1, cues } })
  return definition
}
