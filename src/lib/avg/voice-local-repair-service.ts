import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { readAvgDraftV1 } from './draft-service'
import { saveAvgAuthorWorkspaceV1 } from './editor-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgAdoptedGeneratedVoice } from './generated-voice-source'
import { assertAvgInheritedVoiceBindingV1 } from './stage-voice-source-contract'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { encodeAvgVoiceDraftV1, readAvgVoiceDraftV1 } from './voice-draft-contract'
import { hashAvgVoiceDeclarationForRecoveryV1, assertAvgVoiceLocalRepairSourcesV2 } from './voice-recovery'
import { parseAvgVoiceLocalRepairV2 } from './voice-local-repair-contract'
import { assertAvgVoiceProcessingDraft } from './voice-processing-draft-contract'
import type { AvgAudioProcessingRecipe } from './audio-processing-versioned-contract'
import { assertAvgMediaProductionDraftEditableV1 } from './production-draft-editability'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** An explicit editable proposal based on the displayed frozen preview.
 * No request, Build, candidate, Blob, adoption or old-version rewrite occurs. */
export async function saveAvgVoiceLocalRepairDraftV2(input: {
  scope: WorkspaceScope; expectedDraftRevision: number; expectedBuildId: number; expectedBuildRevision: number
  expectedPreviewHash: string; assetKey: string; recipe: AvgAudioProcessingRecipe
}) {
  const draft = await readAvgDraftV1(input.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (draft.revision !== input.expectedDraftRevision || !draft.productionId) throw new Error('[avg-voice-repair] 返修草稿或制作指针已变化')
  if (workspace.voiceProduction || workspace.mediaBatch || workspace.soundProduction) throw new Error('[avg-voice-repair] 请先明确结束原媒资批次，再保存单句返修要求')
  const details = await readProductProductionDetailsV1(input.scope, draft.productionId, ['avg']), parent = details.build
  if (!parent?.id || parent.id !== input.expectedBuildId || parent.stateRevision !== input.expectedBuildRevision
    || !parent.previewHash || parent.previewHash !== input.expectedPreviewHash || !parent.manifestHash
    || details.brief?.revision !== parent.briefRevision || !['preview-ready', 'release-ready', 'released'].includes(parent.status)) {
    throw new Error('[avg-voice-repair] 请先核对准确的已完成预览，不能覆盖其他待开始方案')
  }
  const entry = workspace.presentation.inheritedVoices?.find(e => e.assetKey === input.assetKey)
  if (!entry) throw new Error('[avg-voice-repair] 请先保留已采用配音并结束原批次')
  const selected = await readAvgAdoptedGeneratedVoice({ scope: input.scope, source: entry.source })
  if (!same(workspace.presentation.stage.assets.find(a => a.assetKey === input.assetKey), selected.asset)
    || selected.sourceWorldContentHash !== details.executionBrief?.source.worldContentHash) throw new Error('[avg-voice-repair] 当前演出配音或冻结世界与原采用来源不一致')
  assertAvgInheritedVoiceBindingV1({ asset: selected.asset, requirement: selected.requirement, scripts: workspace.scripts, reading: workspace.presentation.reading })
  const sources = await db.productProductions.where('workId').equals(input.scope.workId)
    .filter(p => p.productType === 'avg' && p.productionKey === selected.source.productionKey).limit(2).toArray()
  if (sources.length !== 1 || !sources[0].id || !await assertRecordInScope(input.scope, 'productProductions', sources[0], { owner: 'work' })) throw new Error('[avg-voice-repair] 原制作来源不存在或跨作品')
  const sourceBuild = await db.productBuilds.where('[productionId+buildNumber]').equals([sources[0].id, selected.source.raw.buildNumber]).first()
  const sourceRow = sourceBuild ? await db.productProductionBriefs.where('[productionId+revision]').equals([sources[0].id, sourceBuild.briefRevision]).first() : null
  if (!sourceBuild?.id || !sourceRow || !await assertRecordInScope(input.scope, 'productBuilds', sourceBuild, { owner: 'work' })
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', sourceRow, { owner: 'work' })) throw new Error('[avg-voice-repair] 原配音冻结版本不存在')
  const sourceBrief = parseProductProductionBriefV3(sourceRow.briefJson)
  const original = (await assertAvgStoredAssemblyBriefV3(sourceBrief.avgAssembly)).assembly.voice
  const { recovery: _oldRecovery, ...declaration } = original
  const voice = { ...declaration, batch: { ...declaration.batch, requirements: [selected.requirement], presets: [selected.preset] } }
  const repair = parseAvgVoiceLocalRepairV2({ schema: 'storyforge.avg.voice-recovery', version: 2,
    sourceBuildNumber: sourceBuild.buildNumber, sourceBuildRevision: sourceBuild.stateRevision, sourceBriefHash: sourceBuild.briefHash,
    sourcePlanHash: sourceBuild.planHash, sourceControlEpoch: selected.source.raw.controlEpoch,
    sourceProductionKey: selected.source.productionKey, sourceVoiceHash: await hashAvgVoiceDeclarationForRecoveryV1(original),
    targetVoiceHash: await hashAvgVoiceDeclarationForRecoveryV1(voice), parentBuildNumber: parent.buildNumber,
    parentPreviewHash: parent.previewHash, parentManifestHash: parent.manifestHash,
    adoptedChoice: { payloadVersion: selected.source.version, ...selected.source.choice },
    retained: [{ requirementKey: selected.requirement.requirementKey, proof: selected.source.raw }], rerunRequirementKeys: [],
    declaration: input.recipe.declaration }, voice.batch)
  const processing = assertAvgVoiceProcessingDraft({ schema: 'storyforge.avg.audio-production-processing-plan', version: input.recipe.version === 2 ? 2 : 1,
    entries: [{ domain: 'voice', requirementKey: selected.requirement.requirementKey, recipe: input.recipe }] }, voice.batch.requirements)
  await assertAvgVoiceLocalRepairSourcesV2({ scope: input.scope, productionId: draft.productionId, voice: { ...voice, recovery: repair } })
  workspace.basePreviewHash = parent.previewHash
  workspace.voiceProduction = await encodeAvgVoiceDraftV1(voice)
  workspace.voiceProcessing = processing; workspace.voiceLocalRepair = repair
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(input.scope), production = await db.productProductions.get(draft.productionId!), build = await db.productBuilds.get(parent.id!)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId || !production || !build
      || production.stateRevision !== details.production.stateRevision || production.currentBuildNumber !== parent.buildNumber
      || build.stateRevision !== parent.stateRevision || build.previewHash !== parent.previewHash || build.manifestHash !== parent.manifestHash) {
      throw new Error('[avg-voice-repair] 保存返修要求期间草稿或预览已变化')
    }
    await assertAvgMediaProductionDraftEditableV1(input.scope, current, 'voice')
    return saveAvgAuthorWorkspaceV1(input.scope, current.revision, workspace)
  })
}

/** Explicitly abandon only the editable proposal. Once the new voice has
 * replaced its old slot, use the normal retained-result workflow instead. */
export async function clearAvgVoiceLocalRepairDraftV2(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  const draft = await readAvgDraftV1(input.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (draft.revision !== input.expectedDraftRevision || !draft.productionId || !workspace.voiceLocalRepair || !workspace.voiceProduction) throw new Error('[avg-voice-repair] 本地返修要求已变化')
  await assertAvgMediaProductionDraftEditableV1(input.scope, draft, 'voice')
  const source = await assertAvgVoiceLocalRepairSourcesV2({ scope: input.scope, productionId: draft.productionId,
    voice: { ...readAvgVoiceDraftV1(workspace.voiceProduction).voice, recovery: workspace.voiceLocalRepair } })
  const adopted = workspace.voiceLocalRepair.adoptedChoice
  const expectedChoice = { artifactKey: adopted.artifactKey, version: adopted.version, contentHash: adopted.contentHash, authorReceiptHash: adopted.authorReceiptHash }
  const key = workspace.voiceLocalRepair.retained[0].requirementKey
  const old = workspace.presentation.inheritedVoices?.find(e => e.source.requirementKey === key
    && e.source.productionKey === workspace.voiceLocalRepair!.sourceProductionKey && same(e.source.choice, expectedChoice))
  if (!old || !source.recovery.retained.some(r => r.requirementKey === key)) throw new Error('[avg-voice-repair] 已配置新配音，请保留新结果，不能还原覆盖已采用版本')
  delete workspace.voiceProduction; delete workspace.voiceProcessing; delete workspace.voiceLocalRepair
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId) throw new Error('[avg-voice-repair] 撤销期间草稿已变化')
    await assertAvgMediaProductionDraftEditableV1(input.scope, current, 'voice')
    return saveAvgAuthorWorkspaceV1(input.scope, current.revision, workspace)
  })
}
