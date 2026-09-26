import Dexie from 'dexie'
import { scopeTransactionTables } from '../workspace/scope'
import { recordLongformWorkCompletionV1 } from '../workspace/works'
import { db } from '../db/schema'
import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import { readOwnedRows } from '../workspace/scope'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import { countWords, htmlToPlainText } from '../utils/html'
import { hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunV1 } from '../agent/run/event-store'

/** Deterministic coverage evidence, separate from the author's literary acceptance. */
export async function readLongformCompletionV1(scope: WorkspaceScope) {
  const [work, nodes, chapters, runs] = await Promise.all([
    db.works.get(scope.workId),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<{ id?: number; status: string }>(scope, 'agentRuns', { owner: 'work' }),
  ])
  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('作品归属已变化。')
  const canonical = walkOutlineChaptersInCanonicalOrder(nodes)
  const chapterByOutline = buildBestChapterByOutlineMap(chapters)
  const missing = canonical.chapters.filter(row => !htmlToPlainText(chapterByOutline.get(row.outlineNode.id!)?.content ?? '').trim()).map(row => row.outlineNode.title)
  let unfinishedRuns = 0
  for (const run of runs) {
    if (!['running', 'awaiting_confirmation', 'paused', 'recovery_required'].includes(run.status)) continue
    if (['paused', 'running'].includes(run.status) && run.id != null) {
      try {
        const snapshot = await readAgentRunV1(scope, run.id)
        const steps = Object.values(snapshot.projection.steps)
        // Older rejections leave an active ledger. Declining a candidate (or
        // optional post-adoption authorization) must not require accepting it
        // to finish a manuscript. Any unresolved candidate/error still blocks.
        if (steps.some(step => step.confirmation === 'reject') && steps.every(step => (
          step.status === 'scheduled' || step.status === 'succeeded'
          || (step.status === 'failed' && step.confirmation === 'reject')
        ))) continue
      } catch {
        // Unverifiable evidence remains unresolved, never silently complete.
      }
    }
    unfinishedRuns++
  }
  const words = canonical.chapters.reduce((sum, row) => sum + countWords(htmlToPlainText(chapterByOutline.get(row.outlineNode.id!)?.content ?? '')), 0)
  const problems = [
    ...(!canonical.chapters.length ? ['还没有正式章纲。'] : []),
    ...missing.map(title => `《${title}》还没有正文。`),
    ...canonical.anomalies.map(row => `大纲结构需要检查：${row.detail}`),
    ...(unfinishedRuns ? [`还有 ${unfinishedRuns} 个创作或章后运行等待处理。`] : []),
  ]
  const contentHash = await Dexie.waitFor(hashCanonicalValue({ work, nodes, chapters }))
  return { work, chapterCount: canonical.chapters.length, words, missing, unfinishedRuns, problems, contentHash, ready: problems.length === 0 }
}

export async function commitLongformCompletionV1(scope: WorkspaceScope, expectedContentHash: string): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.chapters, db.agentRuns, db.agentRunEvents), async () => {
    const report = await readLongformCompletionV1(scope)
    if (!report.ready || report.contentHash !== expectedContentHash) throw new Error('作品或运行状态已变化，请重新检查并确认。')
    await recordLongformWorkCompletionV1(scope)
  })
}
