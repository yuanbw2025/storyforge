import { db } from '../db/schema'
import type { AdaptationProject, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'

export async function completeAdaptationProductionV1(input: { scope: WorkspaceScope; expectedRevision: number }): Promise<AdaptationProject> {
  const scope = await resolveScope({ scope: input.scope })
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.projectId !== scope.projectId || root.worldId !== scope.worldId || !['producing', 'review'].includes(root.status)) throw new Error('[adaptation] 改编不在可完稿的生产/审校阶段')
  if (root.revision !== input.expectedRevision) throw new Error('[adaptation] 改编根已变化，请刷新')
  if (root.medium === 'screenplay') throw new Error('[adaptation] 旧剧本完稿入口已停用；请完成双重审查并发布不可变剧本 Release')
  throw new Error('[adaptation] 旧漫画完稿入口已停用；请通过专业分镜版或视觉版 Release 发布')
}

/**
 * Completed adaptations are immutable until the author explicitly reopens
 * review. This keeps Work.status and the product root from silently drifting
 * away from the actual screenplay/comic rows.
 */
export async function reopenAdaptationProductionV1(input: { scope: WorkspaceScope; expectedRevision: number }): Promise<AdaptationProject> {
  const scope = await resolveScope({ scope: input.scope })
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.works), async () => {
    const [root, work] = await Promise.all([
      db.adaptationProjects.where('workId').equals(scope.workId).first(),
      db.works.get(scope.workId),
    ])
    if (!root?.id || !work || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[adaptation] 改编根不存在或越过当前 scope')
    if (root.status !== 'complete') throw new Error('[adaptation] 只有已完稿改编可以重新打开审校')
    if (root.revision !== input.expectedRevision) throw new Error('[adaptation] 改编根已变化，请刷新')
    const updatedAt = Date.now()
    const next: AdaptationProject = { ...root, status: 'review', revision: root.revision + 1, updatedAt }
    await db.adaptationProjects.put(next)
    await db.works.update(work.id!, { status: 'ongoing', updatedAt })
    return next
  })
}
