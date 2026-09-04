import { inspectAdaptationFreshness } from './source-manifest'
import { db } from '../db/schema'
import type { AdaptationProject, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { validateScreenplayBlocksV1 } from '../screenplay/contracts'
import { inspectComicQualityV1 } from '../comic/qa'

export async function completeAdaptationProductionV1(input: { scope: WorkspaceScope; expectedRevision: number }): Promise<AdaptationProject> {
  const scope = await resolveScope({ scope: input.scope })
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.projectId !== scope.projectId || root.worldId !== scope.worldId || !['producing', 'review'].includes(root.status)) throw new Error('[adaptation] 改编不在可完稿的生产/审校阶段')
  if (root.revision !== input.expectedRevision) throw new Error('[adaptation] 改编根已变化，请刷新')
  const freshness = await inspectAdaptationFreshness(root.id)
  if (freshness.status === 'changed') throw new Error('[adaptation] 来源已变化，必须先处理影响再完稿；来源删除或主动脱离不会阻止既有成品完稿')
  if (root.medium === 'screenplay') {
    const scenes = await db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray()
    if (!scenes.length || scenes.some(scene => !['reviewed', 'locked'].includes(scene.status) || scene.sourceReviewManifestVersion !== root.activeSourceManifestVersion || !validateScreenplayBlocksV1(scene.blocks).valid)) throw new Error('[adaptation] 剧本完稿要求每场均已审定、来源版本一致且块结构合法')
  } else {
    const report = await inspectComicQualityV1(scope)
    const pages = await db.comicPages.where('adaptationProjectId').equals(root.id).toArray()
    const panels = pages.length ? await db.comicPanels.where('pageId').anyOf(pages.map(page => page.id!)).toArray() : []
    if (!report.canFormalExport) throw new Error(`[adaptation] 漫画尚未达到正式导出条件：${report.issues.filter(issue => issue.level === 'error').map(issue => issue.message).join('；')}`)
    if (pages.some(page => !['reviewed', 'locked'].includes(page.status)) || panels.some(panel => !['reviewed', 'locked'].includes(panel.status))) throw new Error('[adaptation] 漫画完稿要求每页、每格均已审定或锁定')
  }
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.works), async () => {
    const [current, work] = await Promise.all([db.adaptationProjects.get(root.id!), db.works.get(scope.workId)])
    if (!current || !work || current.revision !== input.expectedRevision || current.activeSourceManifestHash !== root.activeSourceManifestHash) throw new Error('[adaptation] 完稿 CAS 失败，请刷新')
    const updatedAt = Date.now(); const next = { ...current, status: 'complete' as const, revision: current.revision + 1, updatedAt }
    await db.adaptationProjects.put(next); await db.works.update(work.id!, { status: 'completed', updatedAt })
    return next
  })
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
