import { FICTION_DIMENSIONS, type FictionDimension } from '../types/import-session-data'
import type { Chapter } from '../types/outline'
import type { Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../types/reference'
import type { Work } from '../types/world-ownership'

/** Only explicitly selected public fields cross the local-project boundary. No DB writes occur here. */
export interface NovelPublicSnapshotV1 {
  schemaVersion: 1
  kind: 'novel'
  title: string
  description: string
  genres: string[]
  chapters: Array<{ title: string; content: string }>
}

export interface BookAnalysisPublicSnapshotV1 {
  schemaVersion: 1
  kind: 'book-analysis'
  book: { title: string; author: string; genre: string }
  analysis: { version: number; depth: 'quick' | 'deep' }
  dimensions: Array<{
    key: FictionDimension
    selected: boolean
    entries: Array<{ label: string; text: string }>
  }>
  authorCommentary: string
}

export type CommunityPublicSnapshotV1 = NovelPublicSnapshotV1 | BookAnalysisPublicSnapshotV1

function requireUniqueIds(ids: readonly number[], description: string): void {
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 0)) {
    throw new Error(`${description}必须非空、唯一且有效`)
  }
}

/**
 * The caller must first resolve owned outline nodes for this Work through the current
 * workspace scope. A Chapter has no workId, so the projector verifies that binding
 * rather than trusting chapter IDs or a UI-provided workId.
 */
export function projectSelectedNovelV1(input: {
  work: Work
  chapters: readonly Chapter[]
  ownedOutlineNodeIds: ReadonlySet<number>
  selectedChapterIds: readonly number[]
  publicRightsConfirmed: boolean
}): NovelPublicSnapshotV1 {
  const { work, chapters, ownedOutlineNodeIds, selectedChapterIds } = input
  if (!input.publicRightsConfirmed) throw new Error('公开投稿需要单独确认发布权利')
  if (work.kind !== 'novel' || !work.id) throw new Error('只能从有效的小说作品创建公开快照')
  requireUniqueIds(selectedChapterIds, '所选章节')

  const available = new Map<number, Chapter>()
  for (const chapter of chapters) {
    if (!chapter.id || chapter.projectId !== work.projectId || !ownedOutlineNodeIds.has(chapter.outlineNodeId)) {
      throw new Error('章节与当前作品的归属不匹配')
    }
    if (available.has(chapter.id)) throw new Error('章节列表存在重复身份')
    available.set(chapter.id, chapter)
  }
  return {
    schemaVersion: 1,
    kind: 'novel',
    title: work.title,
    description: work.description,
    genres: [...work.genres],
    chapters: selectedChapterIds.map(id => {
      const chapter = available.get(id)
      if (!chapter) throw new Error('所选章节已不存在或不属于当前作品')
      return { title: chapter.title, content: chapter.content }
    }),
  }
}

/** Builds a fixed 13-dimension report from an existing analysis run, never from source text. */
export function projectSelectedBookAnalysisV1(input: {
  reference: Reference
  run: ReferenceAnalysisRun
  chunks: readonly ReferenceChunkAnalysis[]
  selectedChunkIndices: readonly number[]
  selectedDimensions: readonly FictionDimension[]
  authorCommentary: string
  publicRightsConfirmed: boolean
}): BookAnalysisPublicSnapshotV1 {
  const { reference, run, chunks, selectedChunkIndices, selectedDimensions } = input
  if (!input.publicRightsConfirmed) throw new Error('公开投稿需要单独确认发布权利')
  if (!reference.id || !run.id || run.referenceId !== reference.id || run.projectId !== reference.projectId || run.workId !== reference.workId) {
    throw new Error('分析版本与参考作品的归属不匹配')
  }
  if (!['ready', 'active', 'superseded'].includes(run.status)) throw new Error('分析版本尚未完成')
  requireUniqueIds(selectedChunkIndices, '所选分析条目')
  if (selectedDimensions.length === 0 || new Set(selectedDimensions).size !== selectedDimensions.length ||
      selectedDimensions.some(key => !FICTION_DIMENSIONS.includes(key))) {
    throw new Error('所选分析维度必须非空、唯一且有效')
  }

  const available = new Map<number, ReferenceChunkAnalysis>()
  for (const chunk of chunks) {
    if (chunk.referenceId !== reference.id || chunk.analysisRunId !== run.id ||
        (chunk.projectId != null && chunk.projectId !== run.projectId) ||
        (chunk.workId != null && chunk.workId !== run.workId)) {
      throw new Error('分析条目与所选版本的归属不匹配')
    }
    if (available.has(chunk.chunkIndex)) throw new Error('分析条目列表存在重复序号')
    available.set(chunk.chunkIndex, chunk)
  }
  const selected = selectedChunkIndices.map(index => {
    const chunk = available.get(index)
    if (!chunk) throw new Error('所选分析条目已不存在')
    return chunk
  })
  const dimensionSet = new Set(selectedDimensions)
  const dimensions = FICTION_DIMENSIONS.map(key => ({
    key,
    selected: dimensionSet.has(key),
    entries: dimensionSet.has(key) ? selected.flatMap(chunk => {
      const text = chunk[key]
      return typeof text === 'string' && text.trim()
        ? [{ label: chunk.label || `第 ${chunk.chunkIndex + 1} 部分`, text }]
        : []
    }) : [],
  }))
  if (!dimensions.some(dimension => dimension.entries.length > 0)) throw new Error('所选范围没有可公开的分析内容')
  return {
    schemaVersion: 1,
    kind: 'book-analysis',
    book: { title: reference.title, author: reference.author, genre: reference.genre || '' },
    analysis: { version: run.version, depth: run.depth },
    dimensions,
    authorCommentary: input.authorCommentary,
  }
}
