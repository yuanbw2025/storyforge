import Dexie from 'dexie'
import { db } from '../../db/schema'
import { adopt, adoptionTransactionTablesV1 } from '../../registry/adopt'
import type { AdoptResult } from '../../registry/types'
import { canonicalStringify } from '../../agent/run/hash'
import type { Chapter, ChapterPlanReconciliation, DetailedOutline, OutlineNode, WorkspaceScope } from '../../types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables } from '../../workspace/scope'
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
  const digest = sha256Text(`${currentPlan}\n---NEXT---\n${nextChapterPlan}`)
  return {
    currentPlan,
    nextChapterPlan,
    planSourceHash: await (Dexie.currentTransaction ? Dexie.waitFor(digest) : digest),
  }
}

export async function isPlanReconciliationCurrent(
  projectId: number,
  chapter: Chapter,
  scope?: WorkspaceScope,
): Promise<boolean> {
  const reconciliation = chapter.planReconciliation
  if (!chapter.id || !reconciliation) return false

  // 如果正文内容变了，对账就不是当前的
  if (reconciliation.sourceTextHash !== await hashChapterText(chapter.content)) return false
  if (reconciliation.reviewStatus === 'confirmed-constraint') return true
  if (reconciliation.reviewStatus === 'applied-outline' || reconciliation.reviewStatus === 'dismissed') return false
  const plan = await loadChapterPlanSnapshot(projectId, chapter.id, scope)
  return reconciliation.planSourceHash === plan.planSourceHash
}

const reconciliationSections = [
  'completedGoals', 'unfinishedGoals', 'deviations', 'newConstraints', 'nextChapterImpacts',
  'foreshadowingRevealed', 'delayedPlot',
] as const

function hasLegacyOutlineClaim(report: ChapterPlanReconciliation): boolean {
  return !report.outlineSync && (report.reviewStatus === 'applied-outline'
    || Object.values(report.actions ?? {}).some(action => action.action === 'apply'))
}

/** Author review can continue after its own atomic outline write. This does
 * not make an already-applied report current for prose generation. */
export async function isPlanReconciliationReviewCurrent(
  projectId: number, chapter: Chapter, scope?: WorkspaceScope,
): Promise<boolean> {
  const report = chapter.planReconciliation
  if (!chapter.id || !report || hasLegacyOutlineClaim(report)) return false
  if (report.sourceTextHash !== await hashChapterText(chapter.content)) return false
  const plan = await loadChapterPlanSnapshot(projectId, chapter.id, scope)
  return (report.outlineSync?.planSourceHash ?? report.planSourceHash) === plan.planSourceHash
}

function sameReconciliationReport(current: ChapterPlanReconciliation, expected: ChapterPlanReconciliation): boolean {
  return canonicalStringify({ ...current, actions: expected.actions, reviewStatus: expected.reviewStatus,
    reviewedAt: expected.reviewedAt, outlineSync: expected.outlineSync }) === canonicalStringify(expected)
}

function assertReviewFieldWritten(result: AdoptResult, id: number, field: 'summary' | 'planReconciliation'): void {
  const written = result.written[0]
  if (result.written.length !== 1 || !written || written.id !== id || written.fields.length !== 2
    || !written.fields.includes(field) || !written.fields.includes('updatedAt')
    || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) {
    throw new Error('对账字段未完整保存，原章节和章纲均已保留。')
  }
}

export async function saveChapterPlanReconciliationReview(input: {
  scope: WorkspaceScope
  expected: ChapterPlanReconciliation
  outline: Pick<OutlineNode, 'id' | 'summary' | 'updatedAt'>
  actions: NonNullable<ChapterPlanReconciliation['actions']>
}): Promise<{ chapter: Chapter; outline: OutlineNode }> {
  const { scope, expected, outline, actions } = structuredClone(input)
  if (!outline.id) throw new Error('原章纲已不存在，对账未保存。')
  return db.transaction('rw', scopeTransactionTables(
    ...adoptionTransactionTablesV1('outlineNodes', { summary: '' }),
    ...adoptionTransactionTablesV1('chapters', { planReconciliation: expected }),
    db.detailedOutlines,
  ), async () => {
    await resolveScopeLike(scope)
    const [chapter, target] = await Promise.all([db.chapters.get(expected.chapterId), db.outlineNodes.get(outline.id!)])
    if (!chapter?.planReconciliation || !target || target.type !== 'chapter' || chapter.outlineNodeId !== target.id
      || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
      || !await assertRecordInScope(scope, 'outlineNodes', target, { owner: 'work' })) {
      throw new Error('原章节或章纲归属已变化，对账未保存。')
    }
    const current = chapter.planReconciliation
    if (hasLegacyOutlineClaim(current)) throw new Error('旧对账缺少同步凭证，请先重新生成并复核。')
    if (!sameReconciliationReport(current, expected)) throw new Error('对账报告已更新，请核对当前报告。')
    const bodyHash = await Dexie.waitFor(hashChapterText(chapter.content))
    const plan = await loadChapterPlanSnapshot(scope.projectId, expected.chapterId, scope)
    if (bodyHash !== current.sourceTextHash || plan.planSourceHash !== (current.outlineSync?.planSourceHash ?? current.planSourceHash)) {
      throw new Error('正文或章纲已变化，请刷新对账并复核，输入尚未保存。')
    }
    if (current.outlineSync && canonicalStringify(current.actions) === canonicalStringify(actions)) {
      return { chapter, outline: target }
    }
    if (canonicalStringify(current) !== canonicalStringify(expected)) {
      throw new Error('对账操作已在其他页面更新，请核对后再保存。')
    }

    const applied = new Set(current.outlineSync?.appliedItemKeys ?? [])
    const selected = new Set<string>()
    const additions: string[] = []
    let hasApply = false
    let hasAccept = false
    for (const [key, { action, indices }] of Object.entries(actions)) {
      const section = reconciliationSections.find(section => key === `${section}:${action}`)
      if (!section || !['apply', 'confirm', 'dismiss', 'foreshadow'].includes(action)) throw new Error('对账操作无效。')
      hasApply ||= action === 'apply'
      hasAccept ||= action === 'confirm' || action === 'foreshadow'
      for (const index of indices) {
        const itemKey = `${section}:${index}`
        const item = Number.isSafeInteger(index) && index >= 0 ? current[section]?.[index] : undefined
        if (!item || selected.has(itemKey)) throw new Error('对账条目不存在或操作重复。')
        selected.add(itemKey)
        if (action !== 'apply' || applied.has(itemKey)) continue
        applied.add(itemKey)
        const prefix = section === 'unfinishedGoals' ? '[待完成]' : section === 'deviations' ? '[补充]'
          : section === 'newConstraints' ? '[新约束]' : '[更新]'
        additions.push(`${prefix} ${item.text}`)
      }
    }
    let savedOutline = target
    let planSourceHash = plan.planSourceHash
    const reviewedAt = Date.now()
    if (additions.length) {
      if (target.updatedAt !== outline.updatedAt || target.summary !== outline.summary) {
        throw new Error('章纲已被其他页面修改，请核对后保存。')
      }
      const additionsText = additions.join('\n')
      // Append only the new governed text, preserving the author's existing
      // summary bytes instead of normalizing the whole prior manuscript.
      const summary = target.summary ? `[基于对账更新]\n${additionsText}` : additionsText
      const result = await adopt({ projectId: scope.projectId, scope, target: 'outlineNodes',
        recordId: target.id!, data: { summary }, mode: 'append' })
      assertReviewFieldWritten(result, target.id!, 'summary')
      const saved = await db.outlineNodes.get(target.id!)
      if (!saved) throw new Error('章纲已删除，对账未保存。')
      savedOutline = saved
      planSourceHash = (await loadChapterPlanSnapshot(scope.projectId, expected.chapterId, scope)).planSourceHash
    }
    const planReconciliation: ChapterPlanReconciliation = { ...current, actions, reviewedAt,
      reviewStatus: hasApply ? 'applied-outline' : hasAccept ? 'confirmed-constraint' : 'dismissed',
      outlineSync: { appliedItemKeys: [...applied], planSourceHash } }
    const result = await adopt({ projectId: scope.projectId, scope, target: 'chapters',
      recordId: chapter.id!, data: { planReconciliation }, mode: 'replace' })
    assertReviewFieldWritten(result, chapter.id!, 'planReconciliation')
    const savedChapter = await db.chapters.get(chapter.id!)
    if (!savedChapter) throw new Error('章节已删除，对账未保存。')
    return { chapter: savedChapter, outline: savedOutline }
  })
}
