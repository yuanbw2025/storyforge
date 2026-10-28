import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { readAvgConfirmedSoundChoicesV1, readAvgConfirmedSoundPlanV1 } from './author-artifacts'
import { applyAvgSoundChoicesToDraftV1, applyAvgSoundLocalRepairChoiceToDraftV2 } from './sound-configuration'
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief'

/** Editable CAS proposal from actually adopted original sounds. This cannot
 * choose/approve audio, modify canonical rules or adopt a Stage. The complete
 * public sound factory stays closed while workbench/runtime joining proceeds. */
export async function configureAvgChosenSoundDraftV1(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number }) {
  if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 正式声音工作流尚未开放')
  const scope = await resolveScope({ scope: input.scope }), draft = await readAvgDraftV1(scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg-sound] 编辑草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(scope, input.productionId, ['avg']), build = details.build, brief = details.executionBrief
  if (!build?.id || !brief?.avgSoundPlanning || build.previewHash) throw new Error('[avg-sound] 当前版本不能配置生成声音')
  const source = { scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
  const choices = await readAvgConfirmedSoundChoicesV1(source)
  let next
  if (brief.avgSoundPlanning.version === 2) {
    const repair = brief.avgSoundPlanning.repair
    if (canonicalProductProductionJsonV2(workspace.soundLocalRepair ?? null) !== canonicalProductProductionJsonV2(repair)) throw new Error('[avg-sound-repair] 当前草稿与准确返修方案不一致')
    await (await import('./sound-local-repair-evidence')).readAvgSoundLocalRepairEvidenceV1({ scope, productionId: input.productionId, repair })
    next = await applyAvgSoundLocalRepairChoiceToDraftV2({ workspace, repair, choices: choices.map(c => c.payload) })
  } else {
    const plan = await readAvgConfirmedSoundPlanV1(source)
    next = await applyAvgSoundChoicesToDraftV1({ workspace, scope: brief.avgSoundPlanning.scope, plan: plan.payload, choices: choices.map(c => c.payload) })
  }
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productBuilds, db.productProductions), async () => {
    const current = await db.productBuilds.get(build.id!), production = await db.productProductions.get(input.productionId)
    if (!current || !production || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
      || current.briefHash !== build.briefHash || current.planHash !== build.planHash || current.previewHash
      || production.status !== details.production.status || production.currentBuildNumber !== build.buildNumber
      || production.currentBriefRevision !== build.briefRevision || production.controlEpoch !== build.controlEpoch) throw new Error('[avg-sound] 配置期间制作来源已stale')
    return saveAvgAuthorWorkspaceV1(scope, draft.revision, next)
  })
}
