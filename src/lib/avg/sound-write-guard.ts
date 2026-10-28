import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseAvgAuthorStageV1 } from './author-workspace-contract'
import { assertAvgSoundPrototypeWriteEnabledV1 } from './prototype-contract'

/** Write fence only. Original frozen reads/playback remain gate-independent.
 * Call again inside the final transaction; the stage table joins that lease. */
export async function assertAvgSoundBuildWriteEnabledV1(scope: WorkspaceScope, buildId: number, brief: ProductProductionBriefV3) {
  if (brief.avgSoundPlanning) { assertAvgSoundPrototypeWriteEnabledV1(); return true }
  if (brief.intent.productType !== 'avg' || !brief.avgAssembly && !brief.avgVisualPlanning) return false
  const rows = await db.productBuildArtifacts.where('buildId').equals(buildId)
    .filter(row => row.artifactKey === 'avg.author.stage' && row.status === 'accepted').limit(2).toArray()
  for (const row of rows) {
    if (!await assertRecordInScope(scope, 'productBuildArtifacts', row, { owner: 'work' })) throw new Error('[avg-sound] 演出写入来源跨作品')
    if (parseAvgAuthorStageV1(row.payloadJson).inheritedSounds?.length) { assertAvgSoundPrototypeWriteEnabledV1(); return true }
  }
  return false
}
