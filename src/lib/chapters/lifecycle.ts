import { cascadeRegisteredReferences } from '../workspace/lifecycle'
import { db } from '../db/schema'
import { detachCultivationProgressForDeletedChapters } from '../cultivation/progress-lifecycle'
import { detachTemporalFactsForDeletedChapters } from '../fact-ledger/lifecycle'
import { detachKnowledgeForDeletedChapters } from '../knowledge-ledger/lifecycle'
import { transactionTablesFor } from '../registry/lifecycle'
import { detachStorylineForDeletedChapters } from '../storyline/lifecycle'
import { canonicalStringify } from '../agent/run/hash'
import { assertRecordInScope } from '../workspace/scope'
import type { WorkspaceScope } from '../types'

/** The exact rows and stable owners whose contents were archived by the author. */
export interface ChapterDeletionPreconditionsV1 {
  projectId: number
  workspaceUid: string
  chapters: readonly {
    id: number
    recordPreimage: string
    scope: WorkspaceScope
    worldCode: string
    workCode: string
  }[]
}

/**
 * Registered chapter deletion lifecycle shared by UI and MEMORY-6. References
 * with durable evidence are detached/degraded; tightly derived rows are removed.
 */
export async function cascadeDeleteChapterRecords(
  ids: readonly number[],
  preconditions?: ChapterDeletionPreconditionsV1,
): Promise<void> {
  const chapterIds = [...ids]
  const expected = preconditions && {
    projectId: preconditions.projectId,
    workspaceUid: preconditions.workspaceUid,
    chapters: preconditions.chapters.map(target => ({
      id: target.id,
      recordPreimage: target.recordPreimage,
      scope: { ...target.scope },
      worldCode: target.worldCode,
      workCode: target.workCode,
    })),
  }
  const stale = () => new Error('[chapters] 章节或所属作品已变化，删除未执行；回收副本已保留，请重新检查。')
  if (expected && (new Set(chapterIds).size !== chapterIds.length
    || expected.chapters.length !== chapterIds.length
    || new Set(expected.chapters.map(target => target.id)).size !== chapterIds.length
    || expected.chapters.some(target => !Number.isSafeInteger(target.id) || !chapterIds.includes(target.id)
      || typeof target.recordPreimage !== 'string'
      || target.scope.projectId !== expected.projectId))) throw stale()
  if (!chapterIds.length) return
  await db.transaction('rw', transactionTablesFor('deleteChapters'), async () => {
    if (expected) {
      const project = await db.projects.get(expected.projectId)
      if (!project || project.workspaceUid !== expected.workspaceUid) throw stale()
      // All preconditions pass before any reference is detached or row deleted.
      for (const target of expected.chapters) {
        const [current, work, world] = await Promise.all([
          db.chapters.get(target.id), db.works.get(target.scope.workId), db.worlds.get(target.scope.worldId),
        ])
        if (!current || !work || !world
          || work.projectId !== expected.projectId || world.projectId !== expected.projectId
          || work.worldId !== target.scope.worldId || work.code !== target.workCode || world.code !== target.worldCode
          || canonicalStringify(current) !== target.recordPreimage
          || !await assertRecordInScope(target.scope, 'chapters', current, { owner: 'work' })) throw stale()
      }
    }
    await detachTemporalFactsForDeletedChapters([...chapterIds])
    await detachKnowledgeForDeletedChapters([...chapterIds])
    await detachStorylineForDeletedChapters([...chapterIds])
    await detachCultivationProgressForDeletedChapters([...chapterIds])
    for (const id of chapterIds) await cascadeRegisteredReferences('chapters', id)
    await db.chapters.bulkDelete(chapterIds)
    const beatKeys = (await db.emotionBeatCards
      .where('chapterId').anyOf([...chapterIds]).primaryKeys()) as number[]
    if (beatKeys.length) await db.emotionBeatCards.bulkDelete(beatKeys)
    const chunkKeys = (await db.retrievalChunks
      .where('sourceChapterId').anyOf([...chapterIds]).primaryKeys()) as number[]
    if (chunkKeys.length) await db.retrievalChunks.bulkDelete(chunkKeys)
    const summaryKeys = (await db.narrativeSummaryNodes
      .where('sourceChapterId').anyOf([...chapterIds]).primaryKeys()) as number[]
    if (summaryKeys.length) await db.narrativeSummaryNodes.bulkDelete(summaryKeys)
  })
}
