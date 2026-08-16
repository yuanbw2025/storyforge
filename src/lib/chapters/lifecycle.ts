import { db } from '../db/schema'
import { detachCultivationProgressForDeletedChapters } from '../cultivation/progress-lifecycle'
import { detachTemporalFactsForDeletedChapters } from '../fact-ledger/lifecycle'
import { detachKnowledgeForDeletedChapters } from '../knowledge-ledger/lifecycle'
import { transactionTablesFor } from '../registry/lifecycle'
import { detachStorylineForDeletedChapters } from '../storyline/lifecycle'

/**
 * Registered chapter deletion lifecycle shared by UI and MEMORY-6. References
 * with durable evidence are detached/degraded; tightly derived rows are removed.
 */
export async function cascadeDeleteChapterRecords(ids: readonly number[]): Promise<void> {
  if (!ids.length) return
  await db.transaction('rw', transactionTablesFor('deleteChapters'), async () => {
    await detachTemporalFactsForDeletedChapters([...ids])
    await detachKnowledgeForDeletedChapters([...ids])
    await detachStorylineForDeletedChapters([...ids])
    await detachCultivationProgressForDeletedChapters([...ids])
    await db.chapters.bulkDelete([...ids])
    const beatKeys = (await db.emotionBeatCards
      .where('chapterId').anyOf([...ids]).primaryKeys()) as number[]
    if (beatKeys.length) await db.emotionBeatCards.bulkDelete(beatKeys)
    const chunkKeys = (await db.retrievalChunks
      .where('sourceChapterId').anyOf([...ids]).primaryKeys()) as number[]
    if (chunkKeys.length) await db.retrievalChunks.bulkDelete(chunkKeys)
    const summaryKeys = (await db.narrativeSummaryNodes
      .where('sourceChapterId').anyOf([...ids]).primaryKeys()) as number[]
    if (summaryKeys.length) await db.narrativeSummaryNodes.bulkDelete(summaryKeys)
  })
}
