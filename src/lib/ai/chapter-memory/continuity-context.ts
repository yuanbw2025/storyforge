import type { Chapter, OutlineNode, WorkspaceScope } from '../../types'
import { readOwnedRows, resolveReadScopeLike } from '../../workspace/scope'
import { formatHandoff } from './handoff-format'
import { getChapterDerivedMemoryStatus, normalizeChapterText } from './text-normalization'
import {
  resolveCanonicalChapterSequence,
  type CanonicalChapterEntry,
  type ChapterSequenceAnomaly,
} from './canonical-chapter-sequence'
import { isPlanReconciliationCurrent } from './plan-reconciliation'

export interface PreparedContinuityContext {
  current: CanonicalChapterEntry | null
  predecessor: CanonicalChapterEntry | null
  previousTailText: string
  handoffText: string
  planReconciliationText?: string
  recentSummariesText: string
  memoryRebuildCandidateIds: number[]
  anomalies: ChapterSequenceAnomaly[]
}

function worldLabel(worldGroupId: number | null, names: Map<number, string>): string {
  return worldGroupId == null ? '默认世界' : (names.get(worldGroupId) ?? `世界#${worldGroupId}`)
}

export async function prepareContinuityContext(args: {
  projectId: number
  chapterId: number
  recentSummaryLimit?: number
  previousTailChars?: number
  scope?: WorkspaceScope
}): Promise<PreparedContinuityContext> {
  const scope = args.scope ?? await resolveReadScopeLike(args.projectId)
  const [outlineNodes, chapters, worldGroups] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(scope, 'worldGroups', { owner: 'world' }),
  ])
  const resolved = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const currentIndex = resolved.sequence.findIndex(entry => entry.chapter.id === args.chapterId)
  const current = currentIndex >= 0 ? resolved.sequence[currentIndex] : null
  const predecessor = currentIndex > 0 ? resolved.sequence[currentIndex - 1] : null
  const names = new Map(worldGroups.filter(group => group.id != null).map(group => [group.id!, group.name]))
  const rebuildIds = new Set<number>()

  let previousTailText = ''
  let handoffText = ''
  let planReconciliationText = ''
  if (predecessor) {
    const predecessorWorld = worldLabel(predecessor.worldGroupId, names)
    const currentWorld = worldLabel(current?.worldGroupId ?? null, names)
    const crossWorld = predecessor.worldGroupId !== (current?.worldGroupId ?? null)
    const tail = normalizeChapterText(predecessor.chapter.content || '').slice(-(args.previousTailChars ?? 1200))
    if (tail) {
      previousTailText = [
        `【全局叙事直接前驱原文尾部 · ${predecessorWorld}${crossWorld ? ` → ${currentWorld} 跨世界转场` : ''}】`,
        tail,
      ].join('\n')
    }
    const status = await getChapterDerivedMemoryStatus(predecessor.chapter)
    if (status.handoff === 'verified' && predecessor.chapter.continuityHandoff) {
      handoffText = [
        `【全局叙事直接前驱交接 · ${predecessorWorld}${crossWorld ? ` → ${currentWorld} 跨世界转场` : ''}】`,
        ...formatHandoff(predecessor.chapter.continuityHandoff),
      ].join('\n')
    } else if (predecessor.chapter.id != null) {
      rebuildIds.add(predecessor.chapter.id)
    }
    const reconciliation = predecessor.chapter.planReconciliation
    if (
      reconciliation?.sourceTextHash === status.currentSourceTextHash
      && await isPlanReconciliationCurrent(args.projectId, predecessor.chapter, scope)
    ) {
      const lines = [
        ...reconciliation.completedGoals.map(item => `已完成：${item.text}`),
        ...reconciliation.unfinishedGoals.map(item => `未完成：${item.text}`),
        ...reconciliation.deviations.map(item => `实际偏移：${item.text}`),
        ...reconciliation.newConstraints.map(item => `新增约束：${item.text}`),
        ...reconciliation.nextChapterImpacts.map(item => `下一章影响：${item.text}`),
      ]
      if (reconciliation.confirmedActualProgress) {
        lines.unshift(`作者已确认实际进展：${reconciliation.confirmedActualProgress}`)
      }
      if (lines.length) {
        planReconciliationText = [
          `【前章计划—正文对账 · ${reconciliation.reviewStatus === 'pending' ? '待作者确认候选' : '作者已处理'}】`,
          ...lines,
        ].join('\n')
      }
    }
  }

  const recent: string[] = []
  if (current) {
    const sameWorldCandidates = resolved.sequence
      .slice(0, Math.max(0, currentIndex))
      .filter(entry => entry.worldGroupId === current.worldGroupId)
      .slice(-(args.recentSummaryLimit ?? 5))
    for (const entry of sameWorldCandidates) {
      const status = await getChapterDerivedMemoryStatus(entry.chapter)
      if (status.summary === 'verified' && entry.chapter.summary) {
        recent.push(`- ${entry.outlineNode?.title ?? entry.chapter.title}：${entry.chapter.summary}`)
      } else if (entry.chapter.id != null) {
        rebuildIds.add(entry.chapter.id)
      }
    }
  }

  return {
    current,
    predecessor,
    previousTailText,
    handoffText,
    planReconciliationText,
    recentSummariesText: recent.length
      ? `【当前世界最近已验证章节摘要 · 旧→新】\n${recent.join('\n')}`
      : '',
    memoryRebuildCandidateIds: [...rebuildIds],
    anomalies: resolved.anomalies,
  }
}
