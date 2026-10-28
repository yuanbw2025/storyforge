import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { scopeTransactionTables } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { readAvgDraftV1 } from './draft-service'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgAdoptedGeneratedSoundV1, assertAvgInheritedSoundBindingV1 } from './stage-sound-sources'
import { parseAvgSoundPlanningBrief } from './sound-production-brief'
import { parseAvgSoundLocalRepairV1 } from './sound-local-repair-contract'
import { readAvgSoundLocalRepairEvidenceV1 } from './sound-local-repair-evidence'
import { parseAvgAudioProcessingRecipe, type AvgAudioProcessingRecipe } from './audio-processing-versioned-contract'
import { assertAvgMediaProductionDraftEditableV1 } from './production-draft-editability'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Save only an explicit retained-source proposal. The old request, selected
 * output and all other stage slots remain; no producer or adoption is created. */
export async function saveAvgSoundLocalRepairDraftV1(input: {
  scope: WorkspaceScope; expectedDraftRevision: number; expectedBuildId: number; expectedBuildRevision: number
  expectedPreviewHash: string; assetKey: string; recipe: AvgAudioProcessingRecipe
}) {
  const captured = { scope: structuredClone(input.scope), expectedDraftRevision: input.expectedDraftRevision,
    expectedBuildId: input.expectedBuildId, expectedBuildRevision: input.expectedBuildRevision,
    expectedPreviewHash: input.expectedPreviewHash, assetKey: input.assetKey, recipe: structuredClone(input.recipe) }
  const recipe = parseAvgAudioProcessingRecipe(captured.recipe)
  const draft = await readAvgDraftV1(captured.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (draft.revision !== captured.expectedDraftRevision || !draft.productionId) throw new Error('[avg-sound-repair] 返修草稿或制作指针已变化')
  if (workspace.voiceProduction || workspace.voiceLocalRepair || workspace.mediaBatch || workspace.imageProcessing
    || workspace.soundProduction || workspace.soundProcessing || workspace.soundLocalRepair) {
    throw new Error('[avg-sound-repair] 请先明确结束原媒资批次，或撤销尚未开始的返修要求')
  }
  const details = await readProductProductionDetailsV1(captured.scope, draft.productionId, ['avg']), parent = details.build
  if (!parent?.id || parent.id !== captured.expectedBuildId || parent.stateRevision !== captured.expectedBuildRevision
    || !parent.previewHash || parent.previewHash !== captured.expectedPreviewHash || !parent.manifestHash
    || details.brief?.revision !== parent.briefRevision || !['preview-ready', 'release-ready', 'released'].includes(parent.status)) {
    throw new Error('[avg-sound-repair] 请先核对准确已完成预览，不能覆盖其他待开始方案')
  }
  await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(captured.scope, null)
  const inherited = workspace.presentation.inheritedSounds?.find(e => e.assetKey === captured.assetKey)
  if (!inherited) throw new Error('[avg-sound-repair] 请先保留已采用声音并结束原批次')
  const selected = await readAvgAdoptedGeneratedSoundV1({ scope: captured.scope, source: inherited.source })
  if (selected.originalAsset.mimeType !== 'audio/wav' || selected.asset.mimeType !== 'audio/wav'
    || !same(workspace.presentation.stage.assets.find(a => a.assetKey === captured.assetKey), selected.asset)
    || selected.sourceWorldContentHash !== details.executionBrief?.source.worldContentHash) {
    throw new Error('[avg-sound-repair] 所选槽、原件WAV或冻结世界与原采用来源不一致')
  }
  assertAvgInheritedSoundBindingV1({ asset: selected.asset, raw: selected.rawPayload, payload: workspace.presentation, scripts: workspace.scripts })
  const sourceBrief = parseAvgSoundPlanningBrief(selected.brief.avgSoundPlanning)
  const repair = parseAvgSoundLocalRepairV1({ schema: 'storyforge.avg.sound-local-repair', version: 1,
    source: selected.source, sourceBuildRevision: selected.build.stateRevision,
    sourceScope: sourceBrief.version === 1 ? sourceBrief.scope : sourceBrief.repair.sourceScope,
    sourcePlan: selected.soundPlan.payload, sourceAsset: selected.asset,
    parent: { productionKey: details.production.productionKey, buildNumber: parent.buildNumber, buildRevision: parent.stateRevision,
      briefHash: parent.briefHash, planHash: parent.planHash, previewHash: parent.previewHash, manifestHash: parent.manifestHash },
    recipe, declaration: recipe.declaration })
  await readAvgSoundLocalRepairEvidenceV1({ scope: captured.scope, productionId: draft.productionId, repair })
  workspace.soundLocalRepair = repair
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(captured.scope), production = await db.productProductions.get(draft.productionId!), build = await db.productBuilds.get(parent.id!)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId || !production || !build
      || production.stateRevision !== details.production.stateRevision || production.currentBuildNumber !== parent.buildNumber
      || !same(build, parent)) throw new Error('[avg-sound-repair] 保存期间草稿或准确预览已变化')
    await assertAvgMediaProductionDraftEditableV1(captured.scope, current, 'sound')
    return saveAvgAuthorWorkspaceV1(captured.scope, current.revision, workspace)
  })
}

/** Cancel only the saved proposal. Configured new results never roll back to
 * a prior asset merely because an old source has the same key or bytes. */
export async function clearAvgSoundLocalRepairDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  const captured = { scope: structuredClone(input.scope), expectedDraftRevision: input.expectedDraftRevision }
  const draft = await readAvgDraftV1(captured.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (draft.revision !== captured.expectedDraftRevision || !draft.productionId || !workspace.soundLocalRepair) {
    throw new Error('[avg-sound-repair] 返修草稿已变化或不存在')
  }
  await assertAvgMediaProductionDraftEditableV1(captured.scope, draft, 'sound')
  const repair = workspace.soundLocalRepair
  const old = workspace.presentation.inheritedSounds?.find(e => e.assetKey === repair.sourceAsset.assetKey && same(e.source, repair.source))
  if (!old || !same(workspace.presentation.stage.assets.find(a => a.assetKey === old.assetKey), repair.sourceAsset)) {
    throw new Error('[avg-sound-repair] 新结果已经配置，不能撤销覆盖已采用版本')
  }
  await readAvgSoundLocalRepairEvidenceV1({ scope: captured.scope, productionId: draft.productionId, repair })
  delete workspace.soundLocalRepair
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(captured.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-sound-repair] 撤销期间草稿已变化')
    await assertAvgMediaProductionDraftEditableV1(captured.scope, current, 'sound')
    return saveAvgAuthorWorkspaceV1(captured.scope, current.revision, workspace)
  })
}
