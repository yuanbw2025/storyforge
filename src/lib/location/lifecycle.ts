import { db } from '../db/schema'
import { cascadeRegisteredReferences } from '../workspace/lifecycle'

/**
 * 删除重要地点前按 PROJECT_TABLES 清理已登记引用。
 *
 * 调用方必须使用 transactionTablesForReferences('importantLocations') 派生事务，
 * 这样地点子树、角色与城池引用不会出现半删除状态。
 * 返回值保留原有受影响城池计数；角色清理策略由注册表裁决。
 */
export async function clearImportantLocationReferences(
  projectId: number,
  locationIds: ReadonlySet<number>,
): Promise<number> {
  if (locationIds.size === 0) return 0
  const entries = await db.codexEntries.where('projectId').equals(projectId).toArray()
  const affected = entries.filter(entry =>
    entry.id != null &&
    entry.importantLocationId != null &&
    locationIds.has(entry.importantLocationId))
  for (const id of locationIds) await cascadeRegisteredReferences('importantLocations', id)

  const now = Date.now()
  for (const entry of affected) await db.codexEntries.update(entry.id!, { updatedAt: now })
  return affected.length
}
