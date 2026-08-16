import { db } from '../../db/schema'
import type { DetailedOutline } from '../../types'
import type { Chapter } from '../../types'
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
): Promise<ChapterPlanSnapshot> {
  const [outlineNodes, chapters, details] = await Promise.all([
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.detailedOutlines.where('projectId').equals(projectId).toArray(),
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
): Promise<boolean> {
  const reconciliation = chapter.planReconciliation
  if (!chapter.id || !reconciliation) return false
  
  // 如果正文内容变了，对账就不是当前的
  if (reconciliation.sourceTextHash !== await hashChapterText(chapter.content)) return false
  
  // 对于已处理的对账（已确认或已应用），只要正文没变就保持为当前
  if (reconciliation.reviewStatus === 'confirmed-constraint' || 
      reconciliation.reviewStatus === 'applied-outline' ||
      reconciliation.reviewStatus === 'dismissed') {
    return true
  }
  
  // 对于待处理的对账，需要检查计划是否变了
  const plan = await loadChapterPlanSnapshot(projectId, chapter.id)
  return reconciliation.planSourceHash === plan.planSourceHash
}
