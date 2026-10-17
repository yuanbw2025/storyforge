import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgDraftV1 } from './draft-service'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { prepareAvgVoiceDraftV1, readAvgVoiceDraftV1 } from './voice-draft-contract'

/** Must run inside the final draft write transaction after expensive, DB-free
 * protocol/source compilation. Active starts cannot be raced by a late save.
 */
async function assertEditable(scope: WorkspaceScope, draft: Awaited<ReturnType<typeof readAvgDraftV1>>) {
  if (!draft.productionId) return
  const production = await db.productProductions.get(draft.productionId)
  if (!production || production.productType !== 'avg' || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[avg-voice] 配音草稿的制作指针不存在或跨作品')
  }
  if (production.currentBuildNumber === null) return
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([draft.productionId, production.currentBuildNumber]).first()
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-voice] 配音草稿的制作版本不存在或跨作品')
  if (!build.previewHash && production.status !== 'brief-ready' && !['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
    throw new Error('[avg-voice] 当前配音批次已开始，请先明确停止并保留调用记录后准备新版本')
  }
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
  const same = canonicalProductProductionJsonV2(workspace.voiceProduction ?? null) === canonicalProductProductionJsonV2(packet)
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
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, workspace)
  })
}
