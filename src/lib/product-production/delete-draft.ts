import { db } from '../db/schema'
import type { ProductProductionRecordV1, WorkspaceScope } from '../types'
import { transactionTablesFor } from '../registry/lifecycle'
import { cascadeRegisteredReferences } from '../workspace/lifecycle'
import { assertRecordInScope, resolveScope } from '../workspace/scope'

/** Delete only an unstarted text-adventure Production, never its host novel Work. */
export async function deleteTextAdventureDraftV1(scope: WorkspaceScope, expected: ProductProductionRecordV1): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    await resolveScope({ scope })
    const row = expected.id == null ? undefined : await db.productProductions.get(expected.id)
    if (!row || !await assertRecordInScope(scope, 'productProductions', row, { owner: 'work' })
      || expected.projectId !== scope.projectId || expected.worldId !== scope.worldId || expected.workId !== scope.workId
      || row.productType !== 'text-adventure' || expected.productType !== row.productType
      || row.status !== expected.status
      || row.stateRevision !== expected.stateRevision || row.controlEpoch !== expected.controlEpoch
      || row.updatedAt !== expected.updatedAt) throw new Error('制作草稿已变化或不属于当前作品，请刷新后重新确认。')
    if (!['consulting', 'brief-ready'].includes(row.status) || (row.currentBuildNumber != null && row.currentBuildNumber !== 0) || row.currentProductReleaseId != null
      || await db.productBuilds.where('productionId').equals(row.id!).count()) {
      throw new Error('该制作已有执行记录，不能作为空草稿删除；请使用归档。')
    }
    await cascadeRegisteredReferences('productProductions', row.id!)
    await db.productProductions.delete(row.id!)
  })
}
