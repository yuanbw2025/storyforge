import { db } from '../db/schema'
import type { Chapter, OutlineNode } from '../types/outline'
import type { Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../types/reference'
import type { Work, WorkspaceScope } from '../types/world-ownership'
import { readOwnedRows, resolveReadScopeLike } from '../workspace/scope'
import { projectSelectedBookAnalysisV1, projectSelectedNovelV1 } from './public-snapshot'
import type { FictionDimension } from '../types/import-session-data'

/** Read-only preview. Publication must re-read and compare a frozen manifest before upload. */
export async function loadSelectedNovelPreview(input: {
  scope: WorkspaceScope
  selectedChapterIds: readonly number[]
  includeDescription?: boolean
  includeGenres?: boolean
  publicRightsConfirmed: boolean
}) {
  const scope = await resolveReadScopeLike(input.scope)
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) {
    throw new Error('当前小说作品已不存在')
  }
  const [nodes, chapters] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  return projectSelectedNovelV1({
    work: work as Work,
    chapters,
    ownedOutlineNodeIds: new Set(nodes.flatMap(node => node.id == null ? [] : [node.id])),
    selectedChapterIds: input.selectedChapterIds,
    includeDescription: input.includeDescription,
    includeGenres: input.includeGenres,
    publicRightsConfirmed: input.publicRightsConfirmed,
  })
}

/** Uses the governed work-scoped tables; never reads referenceAnalysisSources or raw imported files. */
export async function loadSelectedBookAnalysisPreview(input: {
  scope: WorkspaceScope
  referenceId: number
  analysisRunId: number
  selectedChunkIndices: readonly number[]
  selectedDimensions: readonly FictionDimension[]
  authorCommentary: string
  publicRightsConfirmed: boolean
}) {
  const scope = await resolveReadScopeLike(input.scope)
  const [references, runs, chunks] = await Promise.all([
    readOwnedRows<Reference>(scope, 'references', { owner: 'work' }),
    readOwnedRows<ReferenceAnalysisRun>(scope, 'referenceAnalysisRuns', { owner: 'work' }),
    readOwnedRows<ReferenceChunkAnalysis>(scope, 'referenceChunkAnalysis', { owner: 'work' }),
  ])
  const reference = references.find(row => row.id === input.referenceId)
  const run = runs.find(row => row.id === input.analysisRunId && row.referenceId === input.referenceId)
  if (!reference || !run) throw new Error('所选分析不属于当前作品或已不存在')
  return projectSelectedBookAnalysisV1({
    reference,
    run,
    chunks: chunks.filter(row => row.referenceId === input.referenceId && row.analysisRunId === input.analysisRunId),
    selectedChunkIndices: input.selectedChunkIndices,
    selectedDimensions: input.selectedDimensions,
    authorCommentary: input.authorCommentary,
    publicRightsConfirmed: input.publicRightsConfirmed,
  })
}
