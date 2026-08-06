import type { Chapter, DetailedOutline, OutlineNode, WorkspaceScope } from '../../types'
import { readOwnedRows, resolveReadScopeLike } from '../../world-engine/scope'
import { hashChapterText, sha256Text } from './text-normalization'
import { resolveCanonicalChapterSequence } from './canonical-chapter-sequence'

export interface ChapterPlanSnapshot {
  currentPlan: string
  nextChapterPlan: string
  planSourceHash: string
}

function formatDetailedOutline(detail: DetailedOutline | undefined): string {
  if (!detail) return ''
  const parts = [
    detail.openingHook && `开场钩子：${detail.openingHook}`,
    detail.sceneLocation && `地点：${detail.sceneLocation}`,
    ...(detail.scenes ?? []).map((scene, index) => `场景${index + 1}：${JSON.stringify(scene)}`),
    detail.endingCliffhanger && `结尾悬念：${detail.endingCliffhanger}`,
  ].filter(Boolean)
  return parts.join('\n')
}

export async function loadChapterPlanSnapshot(
  projectId: number,
  chapterId: number,
  scope?: WorkspaceScope,
): Promise<ChapterPlanSnapshot> {
  const resolvedScope = scope ?? await resolveReadScopeLike(projectId)
  const [outlineNodes, chapters, details] = await Promise.all([
    readOwnedRows<OutlineNode>(resolvedScope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(resolvedScope, 'chapters', { owner: 'work' }),
    readOwnedRows<DetailedOutline>(resolvedScope, 'detailedOutlines', { owner: 'work' }),
  ])
  const resolved = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const index = resolved.sequence.findIndex(entry => entry.chapter.id === chapterId)
  const current = index >= 0 ? resolved.sequence[index] : null
  const next = index >= 0 ? resolved.sequence[index + 1] : null
  const detailByNode = new Map(details.map(detail => [detail.outlineNodeId, detail]))
  const currentPlan = current?.outlineNode
    ? [
        `标题：${current.outlineNode.title}`,
        `章纲：${current.outlineNode.summary || '（空）'}`,
        formatDetailedOutline(detailByNode.get(current.outlineNode.id!)),
      ].filter(Boolean).join('\n')
    : ''
  const nextChapterPlan = next?.outlineNode
    ? `标题：${next.outlineNode.title}\n章纲：${next.outlineNode.summary || '（空）'}`
    : ''
  return {
    currentPlan,
    nextChapterPlan,
    planSourceHash: await sha256Text(`${currentPlan}\n---NEXT---\n${nextChapterPlan}`),
  }
}

export async function isPlanReconciliationCurrent(
  projectId: number,
  chapter: Chapter,
  scope?: WorkspaceScope,
): Promise<boolean> {
  const reconciliation = chapter.planReconciliation
  if (!chapter.id || !reconciliation) return false
  if (reconciliation.sourceTextHash !== await hashChapterText(chapter.content)) return false
  if (reconciliation.reviewStatus === 'confirmed-constraint') return true
  if (reconciliation.reviewStatus === 'applied-outline' || reconciliation.reviewStatus === 'dismissed') return false
  const plan = await loadChapterPlanSnapshot(projectId, chapter.id, scope)
  return reconciliation.planSourceHash === plan.planSourceHash
}
