import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { scopeTransactionTables } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgDraftV1 } from './draft-service'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { freezeAvgSoundPlanningScopeV1, validateAvgSoundPlanningSourcesV1 } from './sound-source'
import { parseAvgSoundProductionDraftV1, type AvgSoundPlanningDraftInputV1 } from './sound-draft-contract'
import { assertAvgMediaProductionDraftEditableV1 } from './production-draft-editability'
import { assertAvgSoundProcessingDraft } from './sound-processing-draft-contract'
import type { AvgAudioProductionProcessingPlan } from './audio-production-contract'

function assertUnconsumed(workspace: AvgAuthorWorkspaceV1) {
  const keys = new Set(workspace.soundProduction?.scope.templates.map(t => t.assetKey) ?? [])
  if (workspace.presentation.stage.assets.some(a => keys.has(a.assetKey))) throw new Error('[avg-sound] 声音已进入演出；请保留原来源并使用明确的沿用或返修流程')
}

/** No HTTP or model configuration. Scope freeze and canonical source checks
 * precede the existing Work draft CAS; save is never a production/adoption. */
export async function saveAvgSoundProductionDraftV1(input: {
  scope: WorkspaceScope; expectedDraftRevision: number; planning: AvgSoundPlanningDraftInputV1
}) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-sound] 编辑草稿或声音需求已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const soundProduction = parseAvgSoundProductionDraftV1({ schema: 'storyforge.avg.sound-production-draft', version: 1,
    scope: await freezeAvgSoundPlanningScopeV1(input.planning, workspace) })
  if (workspace.soundProcessing) assertAvgSoundProcessingDraft(workspace.soundProcessing, soundProduction.scope)
  const same = canonicalProductProductionJsonV2(workspace.soundProduction ?? null) === canonicalProductProductionJsonV2(soundProduction)
  if (!same) assertUnconsumed(workspace)
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-sound] 声音保存期间编辑版本已变化')
    await assertAvgMediaProductionDraftEditableV1(input.scope, current, 'sound')
    return same ? current : saveAvgAuthorWorkspaceV1(input.scope, current.revision, { ...workspace, soundProduction })
  })
}
export async function clearAvgSoundProductionDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const draft = await readAvgDraftV1(input.scope)
    if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-sound] 声音需求草稿已变化')
    await assertAvgMediaProductionDraftEditableV1(input.scope, draft, 'sound')
    const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    if (!workspace.soundProduction) return draft
    assertUnconsumed(workspace); delete workspace.soundProduction
    delete workspace.soundProcessing
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, workspace)
  })
}
/** The existing Work draft/CAS owns local sound requirements. Saving or
 * clearing this plan creates no Run, Blob, provider request or adoption. */
export async function saveAvgSoundProcessingDraftV1(input: {
  scope: WorkspaceScope; expectedDraftRevision: number; plan: AvgAudioProductionProcessingPlan | null
}) {
  const frozen = structuredClone(input), draft = await readAvgDraftV1(frozen.scope)
  if (draft.revision !== frozen.expectedDraftRevision) throw new Error('[avg-sound-process] 声音或音量草稿已变化，请刷新后继续')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (frozen.plan !== null && !workspace.soundProduction) throw new Error('[avg-sound-process] 请先保存声音需求')
  const sound = frozen.plan !== null ? await validateAvgSoundDraftSourcesV1(workspace.soundProduction, workspace) : null
  const plan = sound ? assertAvgSoundProcessingDraft(frozen.plan, sound.scope) : null
  const same = canonicalProductProductionJsonV2(workspace.soundProcessing ?? null) === canonicalProductProductionJsonV2(plan)
  if (!same) assertUnconsumed(workspace)
  if (plan) workspace.soundProcessing = plan
  else delete workspace.soundProcessing
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(frozen.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-sound-process] 保存音量要求期间草稿已变化')
    await assertAvgMediaProductionDraftEditableV1(frozen.scope, current, 'sound')
    return same ? current : saveAvgAuthorWorkspaceV1(frozen.scope, current.revision, workspace)
  })
}
export async function validateAvgSoundDraftSourcesV1(value: unknown, workspace: AvgAuthorWorkspaceV1) {
  const draft = parseAvgSoundProductionDraftV1(value)
  await validateAvgSoundPlanningSourcesV1(draft.scope, workspace)
  return draft
}
