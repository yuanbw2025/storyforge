import { transactionTablesForReferenceCascade } from '../registry/lifecycle'
import { cascadeRegisteredReferences } from '../workspace/lifecycle'
import { db } from '../db/schema'
import { inspectStages } from '../types/story-arc'

/** 删章时保留作者确认的数据和冗余章名，只断开可能悬空的 FK。 */
export async function detachStorylineForDeletedChapters(
  chapterIds: number[],
): Promise<{ progressTouched: number; crossingsTouched: number }> {
  if (!chapterIds.length) return { progressTouched: 0, crossingsTouched: 0 }
  const ids = new Set(chapterIds)
  const [progress, crossings] = await Promise.all([
    db.storylineProgress.toArray(),
    db.storylineCrossings.toArray(),
  ])
  let progressTouched = 0
  let crossingsTouched = 0
  const now = Date.now()
  for (const row of progress) {
    if (row.id == null || row.lastActiveChapterId == null || !ids.has(row.lastActiveChapterId)) continue
    await db.storylineProgress.update(row.id, { lastActiveChapterId: null, updatedAt: now })
    progressTouched++
  }
  for (const row of crossings) {
    if (row.id == null || row.chapterId == null || !ids.has(row.chapterId)) continue
    await db.storylineCrossings.update(row.id, { chapterId: null, updatedAt: now })
    crossingsTouched++
  }
  return { progressTouched, crossingsTouched }
}

/** StoryArc 是动态投影的硬父项；删线必须在同一事务里清掉所有投影和交汇。 */
export async function deleteStoryArcLifecycle(arcId: number): Promise<void> {
  await db.transaction('rw', transactionTablesForReferenceCascade('storyArcs'), async () => {
    await cascadeRegisteredReferences('storyArcs', arcId)
    await db.storyArcs.delete(arcId)
  })
}

/** 编辑静态阶段后，不能让动态投影继续指向已删除的 stageId。 */
export async function updateStoryArcStagesLifecycle(args: {
  arcId: number
  stages: string
  validStageIds: readonly string[]
  /** Explicit repair (and store edits) compare the exact original JSON inside the transaction. */
  expectedStagesJson?: string
}): Promise<void> {
  const inspected = inspectStages(args.stages)
  if (!inspected.valid) throw new Error(inspected.error)
  await db.transaction('rw', db.storyArcs, db.storylineProgress, async () => {
    const current = await db.storyArcs.get(args.arcId)
    if (!current) throw new Error('故事线已不存在，请重新载入。')
    if (args.expectedStagesJson !== undefined && current.stages !== args.expectedStagesJson) throw new Error('故事线阶段已变化，请刷新页面后检查，当前修复尚未保存。')
    if (!inspectStages(current.stages).valid && args.expectedStagesJson === undefined) throw new Error('原阶段数据格式异常，请先检查原始数据并显式保存修复。')
    if (await db.storyArcs.update(args.arcId, { stages: args.stages, updatedAt: Date.now() }) !== 1) {
      throw new Error('故事线写入0行，阶段和进度均未保存。')
    }
    const progress = await db.storylineProgress.where('arcId').equals(args.arcId).first()
    if (
      progress?.id != null
      && progress.currentStageId != null
      && !inspected.stages.some(stage => stage.id === progress.currentStageId)
    ) {
      if (await db.storylineProgress.update(progress.id, {
        currentStageId: null,
        updatedAt: Date.now(),
      }) !== 1) throw new Error('故事线进度写入0行，阶段和进度均未保存。')
    }
  })
}
