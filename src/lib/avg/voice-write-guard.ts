import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseAvgAuthorStageV1 } from './author-workspace-contract'
import { assertAvgVoicePrototypeWriteEnabledV3 } from './prototype-contract'

/** Write fence only, never producer/author authority. Legacy manually imported
 * voice and frozen Release reads remain independent of production switches.
 * The final receipt transactions already include the stage artifact table. */
export async function assertAvgVoiceBuildWriteEnabledV3(scope: WorkspaceScope, buildId: number, brief: ProductProductionBriefV3) {
  if (brief.intent.productType !== 'avg') return false
  if (brief.avgAssembly?.version === 3) { assertAvgVoicePrototypeWriteEnabledV3(); return true }
  if (!brief.avgAssembly && !brief.avgVisualPlanning && !brief.avgSoundPlanning) return false
  const rows = await db.productBuildArtifacts.where('buildId').equals(buildId)
    .filter(row => row.artifactKey === 'avg.author.stage' && (row.status === 'accepted' || row.status === 'carried-forward')).limit(2).toArray()
  for (const row of rows) {
    if (!await assertRecordInScope(scope, 'productBuildArtifacts', row, { owner: 'work' })) throw new Error('[avg-voice] 演出写入来源跨作品')
    if (parseAvgAuthorStageV1(row.payloadJson).inheritedVoices?.length) { assertAvgVoicePrototypeWriteEnabledV3(); return true }
  }
  return false
}
