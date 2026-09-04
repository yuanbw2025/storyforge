import Dexie from 'dexie'
import { nanoid } from 'nanoid'
import { db } from '../db/schema'
import type {
  AdaptationProject,
  AdaptationSourceSelectionV1,
  AdaptationSourceUnit,
  Chapter,
  ComicGlobalVisualBibleV1,
  ComicTargetSpecV1,
  OutlineNode,
  ScreenplayTargetSpecV1,
  StoryCore,
  Work,
  WorkspaceScope,
} from '../types'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { hashCanonicalValue } from '../agent/run/hash'
import { countWords, htmlToPlainText } from '../utils/html'
import { buildWorkRecord } from '../workspace/works'
import { effectiveWorkKind } from '../workspace/work-kind'
import { assertRecordInScope, readOwnedRows, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import {
  assertAdaptationBriefV1,
  assertAdaptationPlanV1,
  assertAdaptationProjectInvariant,
  assertComicGlobalVisualBibleV1,
  assertComicTargetSpecV1,
  assertScreenplayTargetSpecV1,
} from './contracts'

const SOURCE_MANIFEST_SCHEMA_VERSION = 1
const SOURCE_SUMMARY_LIMIT = 600

export type CreateAdaptationInput = {
  sourceScope: WorkspaceScope
  sourceWorkId: number
  title: string
  sourceSelection: AdaptationSourceSelectionV1
} & (
  | { medium: 'screenplay'; targetSpec: ScreenplayTargetSpecV1 }
  | { medium: 'comic'; targetSpec: ComicTargetSpecV1 }
)

export interface ResolvedSourceManifestV1 {
  units: AdaptationSourceUnit[]
  manifestHash: string
  coverage: 'full-text' | 'outline-only'
  writtenChapterCount: number
  totalWordCount: number
  outlineOnlyUnitCount: number
}

export interface AdaptationFreshnessReport {
  status: 'unchanged' | 'changed' | 'missing' | 'detached'
  activeManifestVersion: number
  storedHash: string
  currentHash: string | null
  changes: Array<{ sourceUnitKey: string; kind: 'added' | 'removed' | 'changed' | 'reordered' | 'missing'; label: string }>
}

export interface AdaptationSourceContentSliceV1 {
  adaptationProjectId: number
  manifestVersion: number
  sourceManifestHash: string
  units: Array<{
    sourceUnitKey: string
    sourceKind: AdaptationSourceUnit['sourceKind']
    label: string
    content: string
    contentHash: string
    wordCount: number
  }>
}

export interface AdaptationSourceOptionCatalogV1 {
  workTitle: string
  outlines: Array<{ id: number; parentId: number | null; type: OutlineNode['type']; title: string; order: number }>
  chapters: Array<{ id: number; outlineNodeId: number; title: string; order: number; wordCount: number }>
}

export interface AdaptationSourceSelectionPreviewV1 {
  coverage: ResolvedSourceManifestV1['coverage']
  writtenChapterCount: number
  totalWordCount: number
  outlineOnlyUnitCount: number
  units: Array<Pick<AdaptationSourceUnit, 'sourceUnitKey' | 'sourceKind' | 'label' | 'order' | 'wordCount' | 'summary'>>
}

function bounded(value: string): string {
  return value.trim().slice(0, SOURCE_SUMMARY_LIMIT)
}

function orderedOutlineNodes(nodes: OutlineNode[]): OutlineNode[] {
  const byId = new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const children = new Map<number | null, OutlineNode[]>()
  for (const node of nodes) {
    const parent = node.parentId != null && byId.has(node.parentId) ? node.parentId : null
    const list = children.get(parent) ?? []
    list.push(node)
    children.set(parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0))
  const result: OutlineNode[] = []
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const walk = (node: OutlineNode) => {
    if (node.id == null) return
    if (visiting.has(node.id)) throw new Error('[adaptation] 来源大纲存在循环')
    if (visited.has(node.id)) return
    visiting.add(node.id)
    result.push(node)
    for (const child of children.get(node.id) ?? []) walk(child)
    visiting.delete(node.id)
    visited.add(node.id)
  }
  for (const root of children.get(null) ?? []) walk(root)
  for (const node of nodes) if (node.id != null && !visited.has(node.id)) walk(node)
  return result
}

function descendantsOf(rootId: number, nodes: OutlineNode[]): Set<number> {
  const root = nodes.find(node => node.id === rootId)
  if (!root) throw new Error('[adaptation] 来源大纲根不存在或不属于来源 Work')
  const children = new Map<number, OutlineNode[]>()
  for (const node of nodes) {
    if (node.parentId == null) continue
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  const result = new Set<number>()
  const visiting = new Set<number>()
  const walk = (id: number) => {
    if (visiting.has(id)) throw new Error('[adaptation] 来源大纲存在循环')
    if (result.has(id)) return
    visiting.add(id)
    result.add(id)
    for (const child of children.get(id) ?? []) if (child.id != null) walk(child.id)
    visiting.delete(id)
  }
  walk(rootId)
  return result
}

function sourceIdentity(kind: AdaptationSourceUnit['sourceKind'], outlineId: number | null, chapterId: number | null): string {
  if (kind === 'work') return 'work'
  return kind === 'outline-node' ? `outline:${outlineId}` : `chapter:${chapterId}`
}

function existingKeyMap(units: AdaptationSourceUnit[]): Map<string, string> {
  return new Map(units.map(unit => [sourceIdentity(unit.sourceKind, unit.sourceOutlineNodeId, unit.sourceChapterId), unit.sourceUnitKey]))
}

function keyFor(identity: string, existing: Map<string, string>): string {
  return existing.get(identity) ?? `asu_${nanoid(18)}`
}

function assertSelectionShape(selection: AdaptationSourceSelectionV1): void {
  if (selection.mode === 'chapters') {
    if (!selection.chapterIds.length) throw new Error('[adaptation] 至少选择一个来源章节')
    if (new Set(selection.chapterIds).size !== selection.chapterIds.length) throw new Error('[adaptation] 来源章节选择包含重复 ID')
    if (selection.chapterIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('[adaptation] 来源章节 ID 非法')
  }
}

async function hashInsideTransaction(value: unknown): Promise<string> {
  return Dexie.currentTransaction
    ? Dexie.waitFor(hashCanonicalValue(value))
    : hashCanonicalValue(value)
}

export async function resolveAdaptationSourceManifest(input: {
  sourceWork: Work
  selection: AdaptationSourceSelectionV1
  outlines: OutlineNode[]
  chapters: Chapter[]
  storyCores: StoryCore[]
  targetWorkId: number
  adaptationProjectId: number
  manifestVersion: number
  existingUnits?: AdaptationSourceUnit[]
  now?: number
}): Promise<ResolvedSourceManifestV1> {
  assertSelectionShape(input.selection)
  if (effectiveWorkKind(input.sourceWork) !== 'novel') throw new Error('[adaptation] 改编来源必须是小说 Work')
  if (!input.sourceWork.id || !input.sourceWork.code) throw new Error('[adaptation] 来源 Work 缺少稳定身份')
  const now = input.now ?? Date.now()
  const existing = existingKeyMap(input.existingUnits ?? [])
  const outlineOrder = orderedOutlineNodes(input.outlines)
  const canonical = resolveCanonicalChapterSequence(input.outlines, input.chapters)
  if (canonical.anomalies.some(issue => issue.kind === 'outline-cycle')) throw new Error('[adaptation] 来源大纲存在循环')
  const canonicalChapterIds = canonical.sequence.map(entry => entry.chapter.id).filter((id): id is number => id != null)
  const chapterById = new Map(canonical.sequence.flatMap(entry => entry.chapter.id == null ? [] : [[entry.chapter.id, entry.chapter]]))

  let selectedChapterIds: number[]
  let selectedOutlineIds: Set<number>
  if (input.selection.mode === 'entire-work') {
    selectedChapterIds = canonicalChapterIds
    selectedOutlineIds = new Set(outlineOrder.flatMap(node => node.id == null ? [] : [node.id]))
  } else if (input.selection.mode === 'outline-subtree') {
    selectedOutlineIds = descendantsOf(input.selection.outlineNodeId, input.outlines)
    selectedChapterIds = canonical.sequence
      .filter(entry => entry.outlineNode?.id != null && selectedOutlineIds.has(entry.outlineNode.id))
      .map(entry => entry.chapter.id!)
  } else if (input.selection.mode === 'chapter-range') {
    const startIndex = canonicalChapterIds.indexOf(input.selection.startChapterId)
    const endIndex = canonicalChapterIds.indexOf(input.selection.endChapterId)
    if (startIndex < 0 || endIndex < 0) throw new Error('[adaptation] 章节范围端点不存在或跨 Work')
    if (startIndex > endIndex) throw new Error('[adaptation] 章节范围起点不能晚于终点')
    selectedChapterIds = canonicalChapterIds.slice(startIndex, endIndex + 1)
    selectedOutlineIds = new Set(selectedChapterIds.map(id => chapterById.get(id)!.outlineNodeId))
  } else {
    const requested = new Set(input.selection.chapterIds)
    for (const id of requested) if (!chapterById.has(id)) throw new Error('[adaptation] 所选章节不存在或跨 Work')
    selectedChapterIds = canonicalChapterIds.filter(id => requested.has(id))
    if (selectedChapterIds.length !== requested.size) throw new Error('[adaptation] 所选章节无法进入规范章序')
    selectedOutlineIds = new Set(selectedChapterIds.map(id => chapterById.get(id)!.outlineNodeId))
  }

  const selectedChapterSet = new Set(selectedChapterIds)
  const units: AdaptationSourceUnit[] = []
  const workIdentity = sourceIdentity('work', null, null)
  const storyCorePayload = input.storyCores.map(core => ({
    logline: core.logline ?? '',
    theme: core.theme ?? '',
    coreConflict: core.centralConflict ?? '',
  }))
  units.push({
    projectId: input.sourceWork.projectId,
    workId: input.targetWorkId,
    adaptationProjectId: input.adaptationProjectId,
    manifestVersion: input.manifestVersion,
    sourceKind: 'work',
    sourceOutlineNodeId: null,
    sourceChapterId: null,
    sourceUnitKey: keyFor(workIdentity, existing),
    order: 0,
    label: input.sourceWork.title,
    contentHash: await hashInsideTransaction({
      title: input.sourceWork.title,
      description: input.sourceWork.description,
      genres: input.sourceWork.genres,
      storyCore: storyCorePayload,
    }),
    summary: bounded(input.sourceWork.description || storyCorePayload.map(core => core.logline).filter(Boolean).join('；')),
    wordCount: 0,
    sourceUpdatedAt: input.sourceWork.updatedAt,
    createdAt: now,
  })

  let order = 1
  let writtenChapterCount = 0
  let totalWordCount = 0
  let outlineOnlyUnitCount = 0
  let hasOutlineContent = false
  for (const outline of outlineOrder) {
    if (outline.id == null || !selectedOutlineIds.has(outline.id)) continue
    const outlineIdentity = sourceIdentity('outline-node', outline.id, null)
    units.push({
      projectId: input.sourceWork.projectId,
      workId: input.targetWorkId,
      adaptationProjectId: input.adaptationProjectId,
      manifestVersion: input.manifestVersion,
      sourceKind: 'outline-node',
      sourceOutlineNodeId: outline.id,
      sourceChapterId: null,
      sourceUnitKey: keyFor(outlineIdentity, existing),
      order: order++,
      label: outline.title,
      contentHash: await hashInsideTransaction({ type: outline.type, title: outline.title, summary: outline.summary, order: outline.order }),
      summary: bounded(outline.summary),
      wordCount: 0,
      sourceUpdatedAt: outline.updatedAt,
      createdAt: now,
    })
    if (outline.summary.trim()) hasOutlineContent = true
    const chapter = canonical.sequence.find(entry => entry.outlineNode?.id === outline.id)?.chapter
    if (!chapter?.id || !selectedChapterSet.has(chapter.id)) {
      outlineOnlyUnitCount += 1
      continue
    }
    const plain = htmlToPlainText(chapter.content || '').trim()
    const wordCount = countWords(plain)
    if (wordCount > 0) writtenChapterCount += 1
    else outlineOnlyUnitCount += 1
    totalWordCount += wordCount
    const chapterIdentity = sourceIdentity('chapter', null, chapter.id)
    units.push({
      projectId: input.sourceWork.projectId,
      workId: input.targetWorkId,
      adaptationProjectId: input.adaptationProjectId,
      manifestVersion: input.manifestVersion,
      sourceKind: 'chapter',
      sourceOutlineNodeId: null,
      sourceChapterId: chapter.id,
      sourceUnitKey: keyFor(chapterIdentity, existing),
      order: order++,
      label: chapter.title,
      contentHash: await hashInsideTransaction({ title: chapter.title, content: plain, summary: chapter.summary ?? '' }),
      summary: bounded(chapter.summary || plain),
      wordCount,
      sourceUpdatedAt: chapter.updatedAt,
      createdAt: now,
    })
  }

  if (writtenChapterCount === 0 && !hasOutlineContent) throw new Error('[adaptation] 选定来源没有正文或有效大纲内容')
  const manifestHash = await hashInsideTransaction({
    schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
    sourceWorkStableCode: input.sourceWork.code,
    selectionMode: input.selection.mode,
    units: units.map(unit => ({
      sourceUnitKey: unit.sourceUnitKey,
      sourceKind: unit.sourceKind,
      contentHash: unit.contentHash,
      order: unit.order,
    })),
  })
  return {
    units,
    manifestHash,
    coverage: writtenChapterCount > 0 ? 'full-text' : 'outline-only',
    writtenChapterCount,
    totalWordCount,
    outlineOnlyUnitCount,
  }
}

async function readSourceRows(scope: WorkspaceScope): Promise<{ outlines: OutlineNode[]; chapters: Chapter[]; storyCores: StoryCore[] }> {
  const [outlines, chapters, storyCores] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }),
  ])
  return { outlines, chapters, storyCores }
}

async function requireSourceNovelScope(sourceScope: WorkspaceScope): Promise<{ scope: WorkspaceScope; sourceWork: Work; rows: Awaited<ReturnType<typeof readSourceRows>> }> {
  const scope = await resolveScope({ scope: sourceScope })
  const sourceWork = await db.works.get(scope.workId)
  if (!sourceWork || sourceWork.projectId !== scope.projectId || sourceWork.worldId !== scope.worldId || effectiveWorkKind(sourceWork) !== 'novel') {
    throw new Error('[adaptation] 来源必须是当前 scope 的小说 Work')
  }
  return { scope, sourceWork, rows: await readSourceRows(scope) }
}

export async function listAdaptationSourceOptions(sourceScope: WorkspaceScope): Promise<AdaptationSourceOptionCatalogV1> {
  const { sourceWork, rows } = await requireSourceNovelScope(sourceScope)
  const canonical = resolveCanonicalChapterSequence(rows.outlines, rows.chapters)
  if (canonical.anomalies.some(issue => issue.kind === 'outline-cycle')) throw new Error('[adaptation] 来源大纲存在循环')
  return {
    workTitle: sourceWork.title,
    outlines: orderedOutlineNodes(rows.outlines).flatMap(node => node.id == null ? [] : [{
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      title: node.title,
      order: node.order,
    }]),
    chapters: canonical.sequence.flatMap((entry, index) => entry.chapter.id == null ? [] : [{
      id: entry.chapter.id,
      outlineNodeId: entry.chapter.outlineNodeId,
      title: entry.chapter.title,
      order: index,
      wordCount: countWords(htmlToPlainText(entry.chapter.content || '')),
    }]),
  }
}

export async function previewAdaptationSourceSelection(input: {
  sourceScope: WorkspaceScope
  selection: AdaptationSourceSelectionV1
}): Promise<AdaptationSourceSelectionPreviewV1> {
  const { sourceWork, rows } = await requireSourceNovelScope(input.sourceScope)
  const resolved = await resolveAdaptationSourceManifest({
    sourceWork,
    selection: input.selection,
    ...rows,
    targetWorkId: sourceWork.id!,
    adaptationProjectId: 0,
    manifestVersion: 1,
    now: 0,
  })
  return {
    coverage: resolved.coverage,
    writtenChapterCount: resolved.writtenChapterCount,
    totalWordCount: resolved.totalWordCount,
    outlineOnlyUnitCount: resolved.outlineOnlyUnitCount,
    units: resolved.units.map(({ sourceUnitKey, sourceKind, label, order, wordCount, summary }) => ({ sourceUnitKey, sourceKind, label, order, wordCount, summary })),
  }
}

function selectionRootFields(selection: AdaptationSourceSelectionV1): Pick<AdaptationProject, 'sourceSelectionMode' | 'sourceOutlineRootId' | 'sourceStartChapterId' | 'sourceEndChapterId'> {
  return {
    sourceSelectionMode: selection.mode,
    sourceOutlineRootId: selection.mode === 'outline-subtree' ? selection.outlineNodeId : null,
    sourceStartChapterId: selection.mode === 'chapter-range' ? selection.startChapterId : null,
    sourceEndChapterId: selection.mode === 'chapter-range' ? selection.endChapterId : null,
  }
}

export async function createAdaptation(input: CreateAdaptationInput): Promise<{
  adaptation: AdaptationProject
  targetWork: Work
  scope: WorkspaceScope
  sourceStats: Pick<ResolvedSourceManifestV1, 'coverage' | 'writtenChapterCount' | 'totalWordCount' | 'outlineOnlyUnitCount'>
}> {
  if (input.medium === 'screenplay') assertScreenplayTargetSpecV1(input.targetSpec)
  else assertComicTargetSpecV1(input.targetSpec)
  const sourceScope = await resolveScope({ scope: input.sourceScope })
  if (sourceScope.workId !== input.sourceWorkId) throw new Error('[adaptation] sourceWorkId 必须等于授权 scope.workId')
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.outlineNodes,
    db.chapters,
    db.storyCores,
    db.adaptationProjects,
    db.adaptationSourceUnits,
  ), async () => {
    const [project, world, sourceWork] = await Promise.all([
      db.projects.get(sourceScope.projectId),
      db.worlds.get(sourceScope.worldId),
      db.works.get(sourceScope.workId),
    ])
    if (!project || !world || !sourceWork || sourceWork.projectId !== project.id || sourceWork.worldId !== world.id) throw new Error('[adaptation] 来源 scope 无效')
    if (effectiveWorkKind(sourceWork) !== 'novel') throw new Error('[adaptation] 改编来源必须是小说 Work')
    const rows = await readSourceRows(sourceScope)
    const targetWorkRow = buildWorkRecord({
      projectId: project.id!,
      worldId: world.id!,
      fallback: sourceWork,
      create: {
        title: input.title,
        description: `改编自《${sourceWork.title}》`,
        genres: sourceWork.genres,
        status: 'drafting',
        targetWordCount: 0,
        kind: input.medium,
        novelProfile: null,
      },
      now,
    })
    const targetWorkId = await db.works.add(targetWorkRow) as number
    const targetScope = { projectId: project.id!, worldId: world.id!, workId: targetWorkId }
    const rootSeed = stampNewRecord(targetScope, 'adaptationProjects', {
      projectId: project.id!,
      worldId: world.id!,
      workId: targetWorkId,
      sourceWorkId: sourceWork.id!,
      lineageMode: 'linked' as const,
      status: 'source-frozen' as const,
      ...selectionRootFields(input.sourceSelection),
      sourceCoverage: 'outline-only' as const,
      medium: input.medium,
      targetSpec: structuredClone(input.targetSpec),
      visualBibleSourceManifestVersion: null,
      visualBible: null,
      brief: null,
      plan: null,
      activeSourceManifestVersion: 1,
      activeSourceManifestHash: '0'.repeat(64),
      briefSourceManifestVersion: null,
      planSourceManifestVersion: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    } as AdaptationProject, { owner: 'work' })
    const adaptationProjectId = await db.adaptationProjects.add(rootSeed) as number
    const manifest = await resolveAdaptationSourceManifest({
      sourceWork,
      selection: input.sourceSelection,
      ...rows,
      targetWorkId,
      adaptationProjectId,
      manifestVersion: 1,
      now,
    })
    const root = { ...rootSeed, id: adaptationProjectId, sourceCoverage: manifest.coverage, activeSourceManifestHash: manifest.manifestHash } as AdaptationProject
    const targetWork = { ...targetWorkRow, id: targetWorkId }
    assertAdaptationProjectInvariant(root, targetWork, sourceWork)
    await db.adaptationProjects.update(adaptationProjectId, {
      sourceCoverage: manifest.coverage,
      activeSourceManifestHash: manifest.manifestHash,
    })
    await db.adaptationSourceUnits.bulkAdd(manifest.units.map(unit => stampNewRecord(targetScope, 'adaptationSourceUnits', unit, { owner: 'work' })))
    await db.projects.update(project.id!, {
      activeWorldId: world.id!,
      activeWorkId: targetWork.id!,
      updatedAt: now,
    })
    return {
      adaptation: root,
      targetWork,
      scope: targetScope,
      sourceStats: {
        coverage: manifest.coverage,
        writtenChapterCount: manifest.writtenChapterCount,
        totalWordCount: manifest.totalWordCount,
        outlineOnlyUnitCount: manifest.outlineOnlyUnitCount,
      },
    }
  })
}

export async function getAdaptationForWork(workId: number): Promise<AdaptationProject | null> {
  return (await db.adaptationProjects.where('workId').equals(workId).first()) ?? null
}

export async function listActiveSourceUnits(adaptationProjectId: number): Promise<AdaptationSourceUnit[]> {
  const root = await db.adaptationProjects.get(adaptationProjectId)
  if (!root) throw new Error('[adaptation] 改编项目不存在')
  return db.adaptationSourceUnits
    .where('[adaptationProjectId+manifestVersion]')
    .equals([adaptationProjectId, root.activeSourceManifestVersion])
    .sortBy('order')
}

/**
 * Read only the immutable-manifest units explicitly authorized by a Run.
 * Numeric source IDs never come from the caller: they are resolved through the
 * target AdaptationProject and its frozen SourceUnits. Every unit is re-hashed
 * immediately before delivery so changed source text cannot leak through an old
 * manifest receipt.
 */
export async function readAdaptationSourceContent(input: {
  targetScope: WorkspaceScope
  adaptationProjectId: number
  manifestVersion: number
  sourceUnitKeys: string[]
}): Promise<AdaptationSourceContentSliceV1> {
  const scope = await resolveScope({ scope: input.targetScope })
  const root = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!root || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) {
    throw new Error('[adaptation] 改编项目不属于当前目标 Work')
  }
  if (!Number.isInteger(input.manifestVersion) || input.manifestVersion < 1) throw new Error('[adaptation] 来源 manifest 版本非法')
  if (!input.sourceUnitKeys.length || input.sourceUnitKeys.length > 64) throw new Error('[adaptation] 来源单元选择数量非法')
  if (new Set(input.sourceUnitKeys).size !== input.sourceUnitKeys.length) throw new Error('[adaptation] 来源单元 key 重复')
  if (input.sourceUnitKeys.some(key => !/^asu_[A-Za-z0-9_-]{8,64}$/.test(key))) throw new Error('[adaptation] 来源单元 key 非法')
  if (root.lineageMode !== 'linked' || root.sourceWorkId == null) throw new Error('[adaptation] 来源小说已断开，不能读取正文')
  const sourceWork = await db.works.get(root.sourceWorkId)
  if (!sourceWork || sourceWork.projectId !== root.projectId || sourceWork.worldId !== root.worldId || effectiveWorkKind(sourceWork) !== 'novel') {
    throw new Error('[adaptation] 来源小说不可用')
  }
  const frozen = await db.adaptationSourceUnits
    .where('[adaptationProjectId+manifestVersion]')
    .equals([root.id!, input.manifestVersion])
    .sortBy('order')
  const byKey = new Map(frozen.map(unit => [unit.sourceUnitKey, unit]))
  const requested = input.sourceUnitKeys.map(key => {
    const unit = byKey.get(key)
    if (!unit) throw new Error(`[adaptation] 来源单元不在指定 manifest：${key}`)
    return unit
  })
  const sourceScope = { projectId: root.projectId, worldId: root.worldId, workId: sourceWork.id! }
  const storyCores = requested.some(unit => unit.sourceKind === 'work')
    ? await readOwnedRows<StoryCore>(sourceScope, 'storyCores', { owner: 'work' })
    : []
  const result: AdaptationSourceContentSliceV1['units'] = []
  for (const unit of requested) {
    let content = ''
    let payload: unknown
    if (unit.sourceKind === 'work') {
      const storyCore = storyCores.map(core => ({
        logline: core.logline ?? '',
        theme: core.theme ?? '',
        coreConflict: core.centralConflict ?? '',
      }))
      content = [
        `作品：${sourceWork.title}`,
        sourceWork.description ? `简介：${sourceWork.description}` : '',
        ...storyCore.map(core => `核心：${core.logline}｜主题：${core.theme}｜冲突：${core.coreConflict}`),
      ].filter(Boolean).join('\n')
      payload = { title: sourceWork.title, description: sourceWork.description, genres: sourceWork.genres, storyCore }
    } else if (unit.sourceKind === 'outline-node') {
      if (unit.sourceOutlineNodeId == null) throw new Error(`[adaptation] 来源大纲引用已缺失：${unit.sourceUnitKey}`)
      const outline = await db.outlineNodes.get(unit.sourceOutlineNodeId)
      if (!outline || !await assertRecordInScope(sourceScope, 'outlineNodes', outline, { owner: 'work' })) throw new Error(`[adaptation] 来源大纲不可用：${unit.sourceUnitKey}`)
      content = `${outline.title}\n${outline.summary}`.trim()
      payload = { type: outline.type, title: outline.title, summary: outline.summary, order: outline.order }
    } else {
      if (unit.sourceChapterId == null) throw new Error(`[adaptation] 来源章节引用已缺失：${unit.sourceUnitKey}`)
      const chapter = await db.chapters.get(unit.sourceChapterId)
      if (!chapter || !await assertRecordInScope(sourceScope, 'chapters', chapter, { owner: 'work' })) throw new Error(`[adaptation] 来源章节不可用：${unit.sourceUnitKey}`)
      const plain = htmlToPlainText(chapter.content || '').trim()
      content = [`章节：${chapter.title}`, chapter.summary ? `摘要：${chapter.summary}` : '', '正文：', plain].filter(Boolean).join('\n')
      payload = { title: chapter.title, content: plain, summary: chapter.summary ?? '' }
    }
    const actualHash = await hashCanonicalValue(payload)
    if (actualHash !== unit.contentHash) throw new Error(`[adaptation] 来源单元已变化，请先同步：${unit.label}`)
    result.push({
      sourceUnitKey: unit.sourceUnitKey,
      sourceKind: unit.sourceKind,
      label: unit.label,
      content,
      contentHash: actualHash,
      wordCount: unit.wordCount,
    })
  }
  return {
    adaptationProjectId: root.id!,
    manifestVersion: input.manifestVersion,
    sourceManifestHash: root.activeSourceManifestVersion === input.manifestVersion ? root.activeSourceManifestHash : await hashCanonicalValue({
      schemaVersion: SOURCE_MANIFEST_SCHEMA_VERSION,
      sourceWorkStableCode: sourceWork.code,
      selectionMode: root.sourceSelectionMode,
      units: frozen.map(unit => ({ sourceUnitKey: unit.sourceUnitKey, sourceKind: unit.sourceKind, contentHash: unit.contentHash, order: unit.order })),
    }),
    units: result,
  }
}

function selectionFromRoot(root: AdaptationProject, activeUnits: AdaptationSourceUnit[]): AdaptationSourceSelectionV1 | null {
  if (root.sourceSelectionMode === 'entire-work') return { mode: 'entire-work' }
  if (root.sourceSelectionMode === 'outline-subtree') return root.sourceOutlineRootId == null ? null : { mode: 'outline-subtree', outlineNodeId: root.sourceOutlineRootId }
  if (root.sourceSelectionMode === 'chapter-range') return root.sourceStartChapterId == null || root.sourceEndChapterId == null
    ? null
    : { mode: 'chapter-range', startChapterId: root.sourceStartChapterId, endChapterId: root.sourceEndChapterId }
  const chapterIds = activeUnits.filter(unit => unit.sourceKind === 'chapter').map(unit => unit.sourceChapterId)
  return chapterIds.some(id => id == null) ? null : { mode: 'chapters', chapterIds: chapterIds as number[] }
}

function compareManifests(stored: AdaptationSourceUnit[], current: AdaptationSourceUnit[]): AdaptationFreshnessReport['changes'] {
  const before = new Map(stored.map(unit => [unit.sourceUnitKey, unit]))
  const after = new Map(current.map(unit => [unit.sourceUnitKey, unit]))
  const changes: AdaptationFreshnessReport['changes'] = []
  for (const unit of stored) {
    const next = after.get(unit.sourceUnitKey)
    if (!next) changes.push({ sourceUnitKey: unit.sourceUnitKey, kind: 'removed', label: unit.label })
    else if (next.contentHash !== unit.contentHash) changes.push({ sourceUnitKey: unit.sourceUnitKey, kind: 'changed', label: unit.label })
    else if (next.order !== unit.order) changes.push({ sourceUnitKey: unit.sourceUnitKey, kind: 'reordered', label: unit.label })
  }
  for (const unit of current) if (!before.has(unit.sourceUnitKey)) changes.push({ sourceUnitKey: unit.sourceUnitKey, kind: 'added', label: unit.label })
  return changes
}

export async function inspectAdaptationFreshness(adaptationProjectId: number): Promise<AdaptationFreshnessReport> {
  const root = await db.adaptationProjects.get(adaptationProjectId)
  if (!root) throw new Error('[adaptation] 改编项目不存在')
  if (root.lineageMode === 'detached') return { status: 'detached', activeManifestVersion: root.activeSourceManifestVersion, storedHash: root.activeSourceManifestHash, currentHash: null, changes: [] }
  const activeUnits = await listActiveSourceUnits(adaptationProjectId)
  if (root.sourceWorkId == null) return { status: 'missing', activeManifestVersion: root.activeSourceManifestVersion, storedHash: root.activeSourceManifestHash, currentHash: null, changes: [{ sourceUnitKey: 'work', kind: 'missing', label: '来源小说已删除' }] }
  const sourceWork = await db.works.get(root.sourceWorkId)
  if (!sourceWork || effectiveWorkKind(sourceWork) !== 'novel' || sourceWork.projectId !== root.projectId || sourceWork.worldId !== root.worldId) {
    return { status: 'missing', activeManifestVersion: root.activeSourceManifestVersion, storedHash: root.activeSourceManifestHash, currentHash: null, changes: [{ sourceUnitKey: 'work', kind: 'missing', label: '来源小说不可用' }] }
  }
  const selection = selectionFromRoot(root, activeUnits)
  if (!selection) {
    return {
      status: 'missing', activeManifestVersion: root.activeSourceManifestVersion, storedHash: root.activeSourceManifestHash, currentHash: null,
      changes: activeUnits.filter(unit => unit.sourceKind !== 'work' && unit.sourceOutlineNodeId == null && unit.sourceChapterId == null).map(unit => ({ sourceUnitKey: unit.sourceUnitKey, kind: 'missing' as const, label: unit.label })),
    }
  }
  const scope = { projectId: root.projectId, worldId: root.worldId, workId: sourceWork.id! }
  const rows = await readSourceRows(scope)
  try {
    const current = await resolveAdaptationSourceManifest({
      sourceWork,
      selection,
      ...rows,
      targetWorkId: root.workId,
      adaptationProjectId: root.id!,
      manifestVersion: root.activeSourceManifestVersion,
      existingUnits: activeUnits,
      now: Date.now(),
    })
    const changes = compareManifests(activeUnits, current.units)
    return {
      status: current.manifestHash === root.activeSourceManifestHash && changes.length === 0 ? 'unchanged' : 'changed',
      activeManifestVersion: root.activeSourceManifestVersion,
      storedHash: root.activeSourceManifestHash,
      currentHash: current.manifestHash,
      changes,
    }
  } catch (error) {
    return {
      status: 'missing', activeManifestVersion: root.activeSourceManifestVersion, storedHash: root.activeSourceManifestHash, currentHash: null,
      changes: [{ sourceUnitKey: 'selection', kind: 'missing', label: error instanceof Error ? error.message : '来源范围不可用' }],
    }
  }
}

export async function resyncAdaptationSource(input: { adaptationProjectId: number; expectedRevision: number }): Promise<AdaptationProject> {
  return db.transaction('rw', scopeTransactionTables(
    db.outlineNodes,
    db.chapters,
    db.storyCores,
    db.adaptationProjects,
    db.adaptationSourceUnits,
  ), async () => {
    const root = await db.adaptationProjects.get(input.adaptationProjectId)
    if (!root) throw new Error('[adaptation] 改编项目不存在')
    if (root.revision !== input.expectedRevision) throw new Error('[adaptation] 改编项目已变化，请刷新后重试')
    if (root.status === 'complete') throw new Error('[adaptation] 已完成项目必须先显式解锁，不能后台同步来源')
    if (root.lineageMode !== 'linked' || root.sourceWorkId == null) throw new Error('[adaptation] 当前来源不可重新同步')
    const sourceWork = await db.works.get(root.sourceWorkId)
    if (!sourceWork || effectiveWorkKind(sourceWork) !== 'novel') throw new Error('[adaptation] 来源小说不可用')
    const activeUnits = await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).sortBy('order')
    const selection = selectionFromRoot(root, activeUnits)
    if (!selection) throw new Error('[adaptation] 来源选择已缺失，不能自动同步')
    const rows = await readSourceRows({ projectId: root.projectId, worldId: root.worldId, workId: sourceWork.id! })
    const nextVersion = root.activeSourceManifestVersion + 1
    const now = Date.now()
    const manifest = await resolveAdaptationSourceManifest({
      sourceWork,
      selection,
      ...rows,
      targetWorkId: root.workId,
      adaptationProjectId: root.id!,
      manifestVersion: nextVersion,
      existingUnits: activeUnits,
      now,
    })
    if (manifest.manifestHash === root.activeSourceManifestHash) throw new Error('[adaptation] 来源没有变化，无需同步')
    const targetScope = { projectId: root.projectId, worldId: root.worldId, workId: root.workId }
    await db.adaptationSourceUnits.bulkAdd(manifest.units.map(unit => stampNewRecord(targetScope, 'adaptationSourceUnits', unit, { owner: 'work' })))
    const next: AdaptationProject = {
      ...root,
      sourceCoverage: manifest.coverage,
      activeSourceManifestVersion: nextVersion,
      activeSourceManifestHash: manifest.manifestHash,
      status: 'brief-review',
      revision: root.revision + 1,
      updatedAt: now,
    }
    await db.adaptationProjects.update(root.id!, {
      sourceCoverage: next.sourceCoverage,
      activeSourceManifestVersion: nextVersion,
      activeSourceManifestHash: next.activeSourceManifestHash,
      status: next.status,
      revision: next.revision,
      updatedAt: now,
    })
    return next
  })
}

export async function saveAdaptationBriefDraft(input: { adaptationProjectId: number; brief: AdaptationProject['brief']; expectedRevision: number }): Promise<AdaptationProject> {
  if (!input.brief) throw new Error('[adaptation] Brief 不能为空')
  assertAdaptationBriefV1(input.brief)
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => ({
    ...root,
    brief: structuredClone(input.brief),
    briefSourceManifestVersion: null,
    status: 'brief-review',
  }))
}

export async function confirmAdaptationBrief(input: { adaptationProjectId: number; expectedRevision: number }): Promise<AdaptationProject> {
  const freshness = await inspectAdaptationFreshness(input.adaptationProjectId)
  if (freshness.status !== 'unchanged') throw new Error('[adaptation] 来源已变化或缺失，不能确认 Brief')
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => {
    if (!root.brief) throw new Error('[adaptation] 请先保存 Brief')
    assertAdaptationBriefV1(root.brief)
    return { ...root, briefSourceManifestVersion: root.activeSourceManifestVersion, status: 'planning' }
  })
}

export async function saveAdaptationPlanDraft(input: { adaptationProjectId: number; plan: AdaptationProject['plan']; expectedRevision: number }): Promise<AdaptationProject> {
  if (!input.plan) throw new Error('[adaptation] Plan 不能为空')
  assertAdaptationPlanV1(input.plan)
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => {
    if (root.briefSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation] 当前来源版本的 Brief 尚未确认')
    return { ...root, plan: structuredClone(input.plan), planSourceManifestVersion: null, status: 'planning' }
  })
}

export async function confirmAdaptationPlan(input: { adaptationProjectId: number; expectedRevision: number }): Promise<AdaptationProject> {
  const freshness = await inspectAdaptationFreshness(input.adaptationProjectId)
  if (freshness.status !== 'unchanged') throw new Error('[adaptation] 来源已变化或缺失，不能确认 Plan')
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => {
    if (!root.plan) throw new Error('[adaptation] 请先保存 Plan')
    assertAdaptationPlanV1(root.plan)
    return { ...root, planSourceManifestVersion: root.activeSourceManifestVersion, status: 'planning' }
  })
}

export async function confirmComicVisualBible(input: { adaptationProjectId: number; visualBible: ComicGlobalVisualBibleV1; expectedRevision: number }): Promise<AdaptationProject> {
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => {
    if (root.medium !== 'comic') throw new Error('[adaptation] 只有漫画改编可确认视觉圣经')
    assertComicGlobalVisualBibleV1(input.visualBible)
    if (JSON.stringify(input.visualBible).length > 64_000) throw new Error('[adaptation] 漫画视觉圣经过大')
    return { ...root, visualBible: structuredClone(input.visualBible), visualBibleSourceManifestVersion: root.activeSourceManifestVersion }
  })
}

export async function startAdaptationProduction(input: { adaptationProjectId: number; expectedRevision: number }): Promise<AdaptationProject> {
  const freshness = await inspectAdaptationFreshness(input.adaptationProjectId)
  if (freshness.status !== 'unchanged') throw new Error('[adaptation] 来源已变化或缺失，不能开始生产')
  return updateAdaptationRootContent(input.adaptationProjectId, input.expectedRevision, root => {
    if (root.briefSourceManifestVersion !== root.activeSourceManifestVersion || root.planSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation] Brief/Plan 尚未按当前来源版本确认')
    if (root.medium === 'comic' && root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation] 漫画视觉圣经尚未按当前来源版本确认')
    return { ...root, status: 'producing' }
  }, true)
}

async function updateAdaptationRootContent(
  adaptationProjectId: number,
  expectedRevision: number,
  mutate: (root: AdaptationProject) => AdaptationProject,
  markWorkOngoing = false,
): Promise<AdaptationProject> {
  return db.transaction('rw', db.adaptationProjects, db.works, db.projects, db.worlds, async () => {
    const root = await db.adaptationProjects.get(adaptationProjectId)
    if (!root) throw new Error('[adaptation] 改编项目不存在')
    if (root.revision !== expectedRevision) throw new Error('[adaptation] 改编项目已变化，请刷新后重试')
    const next = mutate(root)
    const updatedAt = Date.now()
    next.revision = root.revision + 1
    next.updatedAt = updatedAt
    assertAdaptationProjectInvariant(next)
    await db.adaptationProjects.put(next)
    if (markWorkOngoing) {
      const work = await db.works.get(root.workId)
      if (!work || work.projectId !== root.projectId || work.worldId !== root.worldId) {
        throw new Error('[adaptation] 目标作品已缺失')
      }
      const ongoingWork: Work = { ...work, status: 'ongoing', updatedAt }
      await db.works.put(ongoingWork)
    }
    return next
  })
}
