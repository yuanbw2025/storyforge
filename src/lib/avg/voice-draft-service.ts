import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { scopeTransactionTables } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgDraftV1 } from './draft-service'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { prepareAvgVoiceDraftV1, readAvgVoiceDraftV1, validateAvgVoiceDraftSourcesV1 } from './voice-draft-contract'
import { assertAvgMediaProductionDraftEditableV1 } from './production-draft-editability'
import { assertAvgVoiceProcessingDraft } from './voice-processing-draft-contract'
import type { AvgAudioProductionProcessingPlan } from './audio-production-contract'

/** Must run inside the final draft write transaction after expensive, DB-free
 * protocol/source compilation. Active starts cannot be raced by a late save.
 */
async function assertEditable(scope: WorkspaceScope, draft: Awaited<ReturnType<typeof readAvgDraftV1>>) {
  return assertAvgMediaProductionDraftEditableV1(scope, draft, 'voice')
}

function assertUnconsumed(workspace: AvgAuthorWorkspaceV1) {
  if (!workspace.voiceProduction) return
  const keys = new Set(readAvgVoiceDraftV1(workspace.voiceProduction).voice.batch.requirements.map(r => r.assetKey))
  if (workspace.presentation.stage.assets.some(a => keys.has(a.assetKey))
    || workspace.presentation.reading?.voices.some(v => keys.has(v.assetKey))) {
    throw new Error('[avg-voice] 该批配音已进入演出；请保留来源并使用明确的沿用或返修流程')
  }
}

/** Existing Work draft/CAS only. Saving does not start, contact a provider,
 * rewrite script words, create a candidate/audio Blob or adopt anything.
 */
export async function saveAvgVoiceProductionDraftV1(input: {
  scope: WorkspaceScope; expectedDraftRevision: number
} & Omit<Parameters<typeof prepareAvgVoiceDraftV1>[0], 'workspace'>) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-voice] 已保存脚本或配音草稿已变化，请刷新后继续')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const packet = await prepareAvgVoiceDraftV1({ ...input, workspace })
  if (workspace.voiceProcessing) assertAvgVoiceProcessingDraft(workspace.voiceProcessing, readAvgVoiceDraftV1(packet).voice.batch.requirements)
  const same = canonicalProductProductionJsonV2(workspace.voiceProduction ?? null) === canonicalProductProductionJsonV2(packet)
  if (workspace.voiceLocalRepair && !same) throw new Error('[avg-voice-repair] 局部音量返修不能改成重录请求，请先明确撤销返修要求')
  if (!same) assertUnconsumed(workspace)
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-voice] 配音保存期间编辑版本已变化')
    await assertEditable(input.scope, current)
    return same ? current : saveAvgAuthorWorkspaceV1(input.scope, current.revision, { ...workspace, voiceProduction: packet })
  })
}

export async function clearAvgVoiceProductionDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const draft = await readAvgDraftV1(input.scope)
    if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-voice] 配音草稿已变化')
    await assertEditable(input.scope, draft)
    const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    if (!workspace.voiceProduction) return draft
    assertUnconsumed(workspace)
    delete workspace.voiceProduction
    delete workspace.voiceProcessing
    delete workspace.voiceLocalRepair
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, workspace)
  })
}

/** The same Work draft/CAS as voice requirements. No audio is generated or adopted. */
export async function saveAvgVoiceProcessingDraftV1(input: {
  scope: WorkspaceScope; expectedDraftRevision: number; plan: AvgAudioProductionProcessingPlan | null
}) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-voice-process] 配音或音量草稿已变化，请刷新后继续')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (input.plan !== null && !workspace.voiceProduction) throw new Error('[avg-voice-process] 请先保存逐句配音需求')
  const voice = input.plan !== null ? await validateAvgVoiceDraftSourcesV1(workspace.voiceProduction, workspace) : null
  const plan = voice ? assertAvgVoiceProcessingDraft(input.plan, voice.voice.batch.requirements) : null
  const same = canonicalProductProductionJsonV2(workspace.voiceProcessing ?? null) === canonicalProductProductionJsonV2(plan)
  if (!same) assertUnconsumed(workspace)
  if (plan) workspace.voiceProcessing = plan
  else delete workspace.voiceProcessing
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-voice-process] 保存音量要求期间草稿已变化')
    await assertEditable(input.scope, current)
    return same ? current : saveAvgAuthorWorkspaceV1(input.scope, current.revision, workspace)
  })
}
