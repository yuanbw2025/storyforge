import { hashChapterText } from '../ai/chapter-memory/text-normalization'
import { buildLongTermConsistencyDossierV1 } from '../memory/consistency-dossier'
import type { ContextSourceRefV1, FrozenResourceScopeV1, ContextTimeRangeV1 } from '../registry/types'
import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import type { NarrativeSummaryNode } from '../types/narrative-summary'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import { readOwnedRows, resolveScope } from '../workspace/scope'

function normalizedTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase('zh-CN').trim()
  return [...new Set([
    normalized,
    ...normalized.split(/[^\p{L}\p{N}_-]+/u).map(value => value.trim()),
  ].filter(value => value.length >= 2))].slice(0, 32)
}

function matches(text: string, keywords: readonly string[], terms: readonly string[]): boolean {
  const body = text.toLocaleLowerCase('zh-CN')
  const normalizedKeywords = keywords.map(value => value.toLocaleLowerCase('zh-CN'))
  return terms.some(term => body.includes(term) || normalizedKeywords.some(keyword => keyword.includes(term)))
}

function key(table: string, recordId: number): string {
  return `${table}:${recordId}`
}

function chapterGroup(
  chapter: Chapter,
  outlineById: ReadonlyMap<number, OutlineNode>,
): number | null {
  return outlineById.get(chapter.outlineNodeId)?.worldGroupId ?? null
}

function allowedAtBoundary(chapter: Chapter, boundary: number | undefined): boolean {
  return boundary == null || (chapter.id != null && chapter.id <= boundary)
}

export interface NarrativeRetrievalPlanV1 {
  version: 1
  candidateRecordKeys: ReadonlySet<string>
  canonFallbackRecordKeys: ReadonlySet<string>
  diagnostics: {
    chunks: 'available' | 'missing' | 'degraded'
    validChunkCount: number
    staleChunkCount: number
    verifiedSummaryCount: number
    dossierSourceCount: number
    canonFallbackChapterCount: number
    embeddingAuthoritative: false
  }
}

/**
 * Derived memory proposes rows only. Every returned row is projected and
 * scope/hash checked again by the Canon Provider before it can become evidence.
 */
export async function planNarrativeRetrievalV1(input: {
  scope: FrozenResourceScopeV1
  query: string
  timeRange?: ContextTimeRangeV1
}): Promise<NarrativeRetrievalPlanV1> {
  const scope = await resolveScope({ scope: input.scope as WorkspaceScope })
  const terms = normalizedTerms(input.query)
  const [chunks, summaries, chapters, outlines] = await Promise.all([
    readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<NarrativeSummaryNode>(scope, 'narrativeSummaryNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const outlineById = new Map(outlines.filter(row => row.id != null).map(row => [row.id!, row]))
  const scopedChapters = chapters.filter(chapter => (
    chapter.id != null
    && chapterGroup(chapter, outlineById) === (input.scope.worldGroupId ?? null)
    && allowedAtBoundary(chapter, input.timeRange?.throughChapterId)
  ))
  const chapterById = new Map(scopedChapters.map(chapter => [chapter.id!, chapter]))
  const chunksByChapter = new Map<number, RetrievalChunk[]>()
  for (const chunk of chunks) {
    if (!chapterById.has(chunk.sourceChapterId)) continue
    chunksByChapter.set(chunk.sourceChapterId, [...(chunksByChapter.get(chunk.sourceChapterId) ?? []), chunk])
  }

  const candidateRecordKeys = new Set<string>()
  const canonFallbackRecordKeys = new Set<string>()
  const currentChapterHashes = new Map<number, string>()
  let validChunkCount = 0
  let staleChunkCount = 0
  for (const chapter of scopedChapters) {
    const chapterChunks = chunksByChapter.get(chapter.id!) ?? []
    const currentHash = await hashChapterText(chapter.content ?? '')
    currentChapterHashes.set(chapter.id!, currentHash)
    const valid = chapterChunks.filter(chunk => chunk.sourceTextHash === currentHash)
    staleChunkCount += chapterChunks.length - valid.length
    validChunkCount += valid.length
    if (!valid.length || valid.length !== chapterChunks.length) {
      canonFallbackRecordKeys.add(key('chapters', chapter.id!))
    }
    if (valid.some(chunk => matches(chunk.text, chunk.keywords, terms))) {
      candidateRecordKeys.add(key('chapters', chapter.id!))
    }
  }

  let verifiedSummaryCount = 0
  for (const summary of summaries) {
    if (summary.status !== 'verified' || !matches(summary.summary, summary.keywords, terms)) continue
    if (summary.sourceChapterId != null
      && summary.sourceHash !== currentChapterHashes.get(summary.sourceChapterId)) continue
    verifiedSummaryCount += 1
    if (summary.sourceChapterId != null && chapterById.has(summary.sourceChapterId)) {
      candidateRecordKeys.add(key('chapters', summary.sourceChapterId))
    }
    if (summary.sourceOutlineNodeId != null && outlineById.has(summary.sourceOutlineNodeId)) {
      candidateRecordKeys.add(key('outlineNodes', summary.sourceOutlineNodeId))
    }
  }

  let dossierSourceCount = 0
  const boundaryChapterId = input.timeRange?.throughChapterId
  if (boundaryChapterId != null && chapterById.has(boundaryChapterId)) {
    try {
      const dossier = await buildLongTermConsistencyDossierV1({
        scope,
        boundaryChapterId,
        query: input.query,
        maxTokens: 2_000,
      })
      for (const ref of dossier.sourceRefs) {
        if (ref.status !== 'current') continue
        dossierSourceCount += 1
        candidateRecordKeys.add(key(ref.table, ref.recordId))
      }
    } catch {
      // Dossier is an optional candidate source. Canon fallback below remains
      // available and no failed derived index is promoted to evidence.
    }
  }

  return {
    version: 1,
    candidateRecordKeys,
    canonFallbackRecordKeys,
    diagnostics: {
      chunks: chunks.length === 0 ? 'missing' : staleChunkCount > 0 ? 'degraded' : 'available',
      validChunkCount,
      staleChunkCount,
      verifiedSummaryCount,
      dossierSourceCount,
      canonFallbackChapterCount: canonFallbackRecordKeys.size,
      embeddingAuthoritative: false,
    },
  }
}

export function narrativePlanMatchesSourceRefsV1(
  plan: NarrativeRetrievalPlanV1,
  sourceRefs: readonly ContextSourceRefV1[],
): { candidate: boolean; canonFallback: boolean } {
  const keys = sourceRefs
    .filter(ref => typeof ref.recordId === 'number')
    .map(ref => key(ref.table, ref.recordId as number))
  return {
    candidate: keys.some(value => plan.candidateRecordKeys.has(value)),
    canonFallback: keys.some(value => plan.canonFallbackRecordKeys.has(value)),
  }
}
