import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'

export function comicMediaRemovalTransactionTablesV1() {
  return scopeTransactionTables(db.adaptationProjects, db.comicPages, db.comicPanels,
    db.comicVisualSubjects, db.comicMediaAssets, db.mediaBlobObjects)
}

export async function readComicRemovalPagesV1(scopeInput: WorkspaceScope, adaptationProjectId: number) {
  const scope = { ...scopeInput }
  const pages = await db.comicPages.where('adaptationProjectId').equals(adaptationProjectId).toArray()
  for (const page of pages) {
    if (!await assertRecordInScope(scope, 'comicPages', page, { owner: 'work' })) throw new Error('[media] 漫画页越过当前作品作用域')
  }
  return new Map(pages.map(page => [page.id!, page]))
}

/** Draft references are cleared atomically; registered Blob GC runs after commit. */
export async function removeComicMediaRowsInTransactionV1(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  assetKeys: string[]
  clearReferences: boolean
}): Promise<number[]> {
  if (Dexie.currentTransaction?.db !== db || Dexie.currentTransaction.mode !== 'readwrite') {
    throw new Error('[media] 图片引用清理必须在同一写事务中执行')
  }
  const scope = { ...input.scope }
  const adaptationProjectId = input.adaptationProjectId
  const clearReferences = input.clearReferences === true
  const keys = new Set(input.assetKeys)
  if (!keys.size) return []
  const assets = await db.comicMediaAssets.where('workId').equals(scope.workId).filter(row => keys.has(row.stableKey)).toArray()
  if (assets.length !== keys.size) throw new Error('[media] asset 不存在或身份重复')
  for (const asset of assets) {
    const blob = await db.mediaBlobObjects.get(asset.blobObjectId)
    if (asset.adaptationProjectId !== adaptationProjectId
      || !await assertRecordInScope(scope, 'comicMediaAssets', asset, { owner: 'work' })
      || !blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })) {
      throw new Error('[media] 图片或 Blob 不属于当前漫画')
    }
  }
  const pages = await readComicRemovalPagesV1(scope, adaptationProjectId)
  const [panels, subjects, references] = await Promise.all([
    db.comicPanels.where('workId').equals(scope.workId).filter(row => pages.has(row.pageId) && keys.has(row.selectedMediaAssetKey ?? '')).toArray(),
    db.comicVisualSubjects.where('workId').equals(scope.workId).filter(row => row.adaptationProjectId === adaptationProjectId && keys.has(row.selectedMediaAssetKey ?? '')).toArray(),
    db.comicMediaAssets.where('workId').equals(scope.workId).filter(row => row.adaptationProjectId === adaptationProjectId && !keys.has(row.stableKey) && row.referenceAssetKeys.some(key => keys.has(key))).toArray(),
  ])
  if ((panels.length || subjects.length || references.length) && !clearReferences) {
    throw new Error('[media] asset 仍被选择或作为参考图使用，请显式清理引用')
  }
  for (const [table, rows] of [
    ['comicPanels', panels], ['comicVisualSubjects', subjects], ['comicMediaAssets', references],
  ] as const) {
    for (const row of rows) {
      if (!await assertRecordInScope(scope, table, row, { owner: 'work' })) throw new Error('[media] 图片引用越过当前漫画作用域')
    }
  }
  if (panels.some(row => row.status === 'locked' || pages.get(row.pageId)?.status === 'locked') || subjects.some(row => row.status === 'locked')) {
    throw new Error('[media] asset 被锁定格或视觉条目引用，请先解锁')
  }
  const now = Date.now()
  await db.comicPanels.bulkPut(panels.map(panel => {
    const revision = panel.revision + 1
    return { ...panel, selectedMediaAssetKey: null,
      narrativeReviewRevision: panel.narrativeReviewRevision === panel.revision ? revision : panel.narrativeReviewRevision,
      visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null, revision, updatedAt: now }
  }))
  await db.comicVisualSubjects.bulkPut(subjects.map(subject => ({ ...subject, selectedMediaAssetKey: null, revision: subject.revision + 1, updatedAt: now })))
  await db.comicMediaAssets.bulkPut(references.map(row => ({ ...row, referenceAssetKeys: row.referenceAssetKeys.filter(key => !keys.has(key)), updatedAt: now })))
  await db.comicMediaAssets.bulkDelete(assets.map(row => row.id!))
  return [...new Set(assets.map(row => row.blobObjectId))]
}
