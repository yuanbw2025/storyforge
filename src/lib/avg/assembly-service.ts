import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'
import { readAvgDraftV1, bindAvgDraftProductionV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { AVG_ASSEMBLY_GATE_IDS_V1, avgMediaProductionEnabledV2, avgVoiceProductionEnabledV3, avgMediaAssemblyGateIdsV2, type AvgAssemblyBrief, type AvgAssemblyBriefV2 } from './assembly-contract'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../product-production/consultation'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { beginProductProductionEvolutionV1, readProductProductionDetailsV1, authorizeProductProductionStartV1, stopProductProductionV1, type ProductProductionDetailsV1 } from '../product-production/service'
import { verifyStoredProductBuildPreview } from '../product-production/preview-manifest'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1, selectProductBuildCompatibilityBaselineV1,projectProductProductionSchedulerV1,projectProductProductionRecordedUsageV1 } from '../product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../product-production/production-executor'
import { readAvgMediaChoicesForConfigurationV2, readAvgVoiceChoicesForConfigurationV3, stageAvgAuthorArtifactV1 } from './author-artifacts'
import { assertAvgStoredAssemblyBriefV3, encodeAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1, avgVoiceChoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1, avgVoiceAssemblyGateIdsV3 } from './voice-assembly-contract'
import { assertAvgVoiceDraftV1, readAvgVoiceDraftV1, validateAvgVoiceDraftSourcesV1 } from './voice-draft-contract'
import { avgVoiceProductionBudgetV3, avgVoiceProductionDataClassesV3 } from './voice-production-policy'
import { readAvgRawVoiceSourceV1 } from './voice-choice-validation'
import { applyAvgVoiceChoicesToDraftV1 } from './voice-configuration'
import { assertAvgNoUnresolvedVoiceRequestsV1 } from './voice-request-safety'
import type { AvgAuthorVoiceChoiceV1 } from './voice-choice-contract'
import { listAvgDraftMediaV1, saveAvgAuthorWorkspaceV1 } from './editor-service'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { assertAvgMediaConsumerDeclarationsV1, validateAvgVisualProductionBatchSourceV1 } from './media-source'
import { avgVisualProductionBudgetV2, avgVisualProductionDataClassesV2 } from './media-production-policy'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from './media-reference-contract'
import { resolveAvgImageExecutionCapabilityV2, resolveAvgVoiceExecutionCapabilityV3 } from './media-capability'
import { avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1, avgVisualReviewArtifactKeyV1, type AvgAuthorMediaChoice, type AvgVisualProductionRequirementV1 } from './media-production-contract'
import type { AvgReviewIssuesV1 } from './artifact-contract'
import type { ProductProductionBriefV3, ProviderCapabilityRequirementV1 } from '../types'
import { verifyAcceptedProductBuildArtifactV1, verifyRetainedAvgRawImageArtifactV1, verifyAvgReferenceRawImageArtifactV1, verifyAvgProcessedImageArtifactV1, verifyHistoricalAvgVisualPlanningArtifactV4,verifyHistoricalAvgVisualPlanningArtifactV5 } from '../product-production/artifact-store'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { assertAvgConsumedRawImageV4, readAvgImageConsumptionDefinitionV4 } from './image-consumption'
import { readAvgCurrentImageConsumptionDefinition } from './current-image-consumption'
export { stageAvgVisualReviewV2,stageAvgMediaChoiceV5 } from './visual-review-service-v5'
export { configureAvgChosenSoundDraftV1 } from './sound-author-service'
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief'
import { freezeAvgVisualProductionBatchV1 } from './media-source'
import { applyAvgMediaChoicesToDraftV2, applyAvgMediaChoicesToDraftV1, prepareAvgMediaConsumerDeclarationsV1, resetAvgUnconsumedMediaDeclarationsV1 } from './media-configuration'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertAvgKnownImageRetriesV1, prepareAvgImageRecoveryV1, readAvgImageRecoverySourceV1, validateAvgImageRecoveryV1,assertAvgRawImageOriginV1 } from './media-recovery'
import { parseAvgImageRecoveryV1, type AvgImageRecoveryV1 } from './media-recovery-contract'
import { listWorldReferenceCatalogV1 } from '../product/source'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { prepareAvgInheritedStageDraftV1, readAvgInheritedStageImagesV1 } from './stage-image-sources'
import { prepareAvgInheritedVoiceDraftV1 } from './stage-voice-sources'
import { prepareAvgInheritedSoundDraftV1, readAvgInheritedStageSoundsV1 } from './stage-sound-sources'
import { assertAvgProcessedImageArtifact } from './image-processing-contract-v2'
import { parseAvgImageProcessingPlan, compileAvgImageProcessingRequirementDeclarations, assertAvgImageProcessingRequirements,
  avgProcessedImageArtifactKeyV1, type AvgImageProcessingPlan } from './image-processing-contract'
import { inspectAvgProcessedImageSourceV1, readAvgProcessedImageSourceV1,verifyAvgRecoveryPlaceholderV1 } from './image-processing-source'
import { assertAvgImageProductionDefinitionV3, readAvgOptionalImageDefinitionV3 } from './media-production-definition'
import type { ProductProductionCapabilityBindingV1 } from '../product-production/scheduler'
import { avgPendingVoiceRequestsV1, hashAvgVoiceDeclarationForRecoveryV1, prepareAvgVoiceRecoveryV1,
  readAvgVoiceRecoveryReplacementV1, validateAvgVoiceRecoveryV1 } from './voice-recovery'
import { parseAvgVoiceRecoveryV1, type AvgVoiceRecoveryV1 } from './voice-recovery-contract'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import type { AvgVisualPlanningDraftV4,AvgVisualPlanningDraftV5 } from './visual-planning-workspace'
import { assertAvgVisualPlanningRestartKnownV4, assertAvgVisualStageRetentionKnownV4 } from './visual-planning-restart'

const commandId = (label: string) => `avg.assembly.${label}.${crypto.randomUUID()}`

/** Only saved, never-started intents can release prospective item slots. */
function unstartedAvgVisualPlanningScopes(details: Awaited<ReturnType<typeof readProductProductionDetailsV1>>) {
  return details.briefHistory.filter(row=>row.authorizedAt===null&&row.revision>(details.build?.briefRevision??0)).flatMap(row => {
    const planning = parseProductProductionBriefV3(row.briefJson).avgVisualPlanning
    return planning?.version===4 ? [planning.scope] : []
  })
}

function unstartedAvgVisualPlanningScopesV5(details:Awaited<ReturnType<typeof readProductProductionDetailsV1>>){
  return details.briefHistory.filter(row=>row.authorizedAt===null&&row.revision>(details.build?.briefRevision??0)).flatMap(row=>{
    const planning=parseProductProductionBriefV3(row.briefJson).avgVisualPlanning
    return planning?.version===5?[planning.scope]:[]
  })
}

/** A new Build freezes this separately from the original provider request.
 * Saving does not execute processing, adopt an image or change an old Build. */
export async function saveAvgImageProcessingDraftV1(input:{scope:WorkspaceScope;expectedDraftRevision:number;plan:AvgImageProcessingPlan|null}){
  return db.transaction('rw',scopeTransactionTables(db.avgAuthoringDrafts,db.productProductions,db.productBuilds),async()=>{
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision)throw new Error('[avg-process] 加工草稿已变化')
  if(draft.productionId){
    const production=await db.productProductions.get(draft.productionId)
    if(!production||production.productType!=='avg'||!await assertRecordInScope(input.scope,'productProductions',production,{owner:'work'}))throw new Error('[avg-process] 加工制作指针不存在或跨作品')
    if(production.currentBuildNumber!==null){
      const build=await db.productBuilds.where('[productionId+buildNumber]').equals([production.id!,production.currentBuildNumber]).first()
      if(!build||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-process] 加工制作版本不存在或跨作品')
      if(!build.previewHash&&production.status!=='brief-ready'&&!['cancelled','failed','recovery-required'].includes(build.status))throw new Error('[avg-process] 当前加工方案已开始；请先明确停止并保留记录后准备新版本')
    }
  }
  const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  const nextPlan=input.plan===null?null:parseAvgImageProcessingPlan(input.plan)
  if(workspace.mediaBatch){
    if(workspace.mediaBatch.characterFamily){
      // Family approval is over its exact original proposal. Recipe saving
      // cannot rewrite or re-sign that proposal or its provider permissions.
      if(nextPlan)assertAvgImageProcessingRequirements(nextPlan,workspace.mediaBatch.requirements)
    }else workspace.mediaBatch.requirements=compileAvgImageProcessingRequirementDeclarations(
      workspace.mediaBatch.requirements,nextPlan,workspace.imageProcessing)
  }
  if(nextPlan===null)delete workspace.imageProcessing
  else workspace.imageProcessing=nextPlan
  return saveAvgAuthorWorkspaceV1(input.scope,draft.revision,workspace)
  })
}

/** Saves a proposed batch and prospective item image references only. The
 * author still reviews a Brief, starts production and confirms each choice. */
export async function saveAvgVisualBatchDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number;
  batchKey: string; revision: number; requirements: AvgVisualProductionRequirementV1[];visualReviewPolicy?:'author-visual-v1' }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-media] 编辑草稿已变化')
  if(parseAvgAuthorWorkspaceV1(draft.editorJson).mediaBatch?.characterFamily)throw new Error('[avg-family] 请通过人物家族编辑保留身份方案，或明确结束当前家族批次后再新建普通需求')
  const workspace = prepareAvgMediaConsumerDeclarationsV1(resetAvgUnconsumedMediaDeclarationsV1(parseAvgAuthorWorkspaceV1(draft.editorJson)), input.requirements)
  workspace.mediaBatch = await freezeAvgVisualProductionBatchV1({ schema: 'storyforge.avg.visual-production-batch', version: 1,
    batchKey: input.batchKey, revision: input.revision, requirements: input.requirements,...(input.visualReviewPolicy||workspace.mediaBatch?.visualReviewPolicy?{visualReviewPolicy:input.visualReviewPolicy??workspace.mediaBatch!.visualReviewPolicy!}:{}) }, workspace)
  return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, workspace)
}

/** Explicitly remove an unused batch, retaining imported references/Blobs and
 * every production receipt. A live or already consumed batch is not erased. */
export async function clearAvgVisualBatchDraftV1(input: { scope: WorkspaceScope; expectedDraftRevision: number }) {
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const draft = await readAvgDraftV1(input.scope)
    if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg-media] 编辑草稿已变化')
    const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    if (draft.productionId) {
      const production = await db.productProductions.get(draft.productionId)
      if (!production || production.productType !== 'avg' || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) throw new Error('[avg-media] 制作记录不存在或跨作品')
      if (production.currentBuildNumber !== null) {
        const build = await db.productBuilds.where('[productionId+buildNumber]').equals([draft.productionId, production.currentBuildNumber]).first()
        if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-media] 当前制作版本不存在或跨作品')
        if (!build.previewHash && production.status !== 'brief-ready' && !['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
          throw new Error('[avg-media] 已开始的图片批次须保留；请先明确停止或修订制作')
        }
      }
    }
    if (workspace.mediaBatch?.requirements.some(r => workspace.presentation.stage.assets.some(a => a.assetKey === r.assetKey))) {
      throw new Error('[avg-media] 图片已进入演出草稿，不能丢弃其生产来源；请保留批次并显式修订')
    }
    const next = resetAvgUnconsumedMediaDeclarationsV1(workspace)
    delete next.mediaBatch
    delete next.imageProcessing
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
  })
}

/** An explicit new-scope proposal: keep adopted stage images, retire only the
 * editable generation batch, retain all old Runs, pending bills and Blobs. */
export async function keepAvgGeneratedStageDraftV1(input:{scope:WorkspaceScope;productionId:number;expectedDraftRevision:number;expectedBuildId:number}){
  const draft=await readAvgDraftV1(input.scope),details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId||details.build?.id!==input.expectedBuildId
    ||!details.executionBrief?.avgAssembly||!details.build.previewHash&&!['cancelled','failed','recovery-required'].includes(details.build.status))throw new Error('[avg-media] 请先明确停止或完成当前批次，再保留演出图')
  const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  if(!workspace.mediaBatch)throw new Error('[avg-media] 当前草稿没有待结束的图片批次')
  const next=resetAvgUnconsumedMediaDeclarationsV1(await prepareAvgInheritedStageDraftV1({scope:input.scope,workspace,build:details.build,productionKey:details.production.productionKey,
    targetBuildNumber:Math.max(...details.buildHistory.map(row=>row.buildNumber))+1,worldContentHash:details.executionBrief.source.worldContentHash}))
  if(!next.presentation.inheritedImages?.length)throw new Error('[avg-media] 没有可保留的已采用演出图片')
  delete next.mediaBatch
  delete next.imageProcessing
  return saveAvgAuthorWorkspaceV1(input.scope,draft.revision,next)
}

/** Explicitly finish a consumed voice batch while retaining proved audio in
 * the editable stage. No old call/receipt/Blob is deleted, no old choice is
 * adopted into a new Build, and no provider request is made. */
export async function keepAvgGeneratedVoiceStageDraftV1(input: { scope: WorkspaceScope; productionId: number;
  expectedDraftRevision: number; expectedBuildId: number }) {
  const draft = await readAvgDraftV1(input.scope), details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId || build?.id !== input.expectedBuildId
    || brief?.avgAssembly?.version !== 3 || !build.previewHash && !['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
    throw new Error('[avg-voice] 请先明确停止或完成当前配音批次，再保留已采用音频')
  }
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (!workspace.voiceProduction) throw new Error('[avg-voice] 当前草稿没有待结束的配音批次')
  const current = await assertAvgVoiceDraftV1(workspace.voiceProduction), frozen = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  if (await hashAvgVoiceDeclarationForRecoveryV1(current.voice) !== await hashAvgVoiceDeclarationForRecoveryV1(frozen.assembly.voice)) {
    throw new Error('[avg-voice] 当前配音需求已不同于原冻结批次，请先处理编辑冲突')
  }
  const consumed = current.voice.batch.requirements.filter(r => workspace.presentation.stage.assets.some(asset => asset.assetKey === r.assetKey))
  if (!consumed.length) throw new Error('[avg-voice] 没有可保留的本批演出配音；未使用的批次请明确移除')
  delete workspace.voiceProduction
  const next = await prepareAvgInheritedVoiceDraftV1({ scope: input.scope, workspace, build,
    productionKey: details.production.productionKey, targetBuildNumber: Math.max(...details.buildHistory.map(row => row.buildNumber)) + 1,
    worldContentHash: brief.source.worldContentHash })
  if (consumed.some(r => !next.presentation.inheritedVoices?.some(entry => entry.assetKey === r.assetKey))) {
    throw new Error('[avg-voice] 不能把缺少原作者采用证明的音频当成已采用配音沿用')
  }
  return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
}

/** Finish only a frozen, consumed batch. The draft proposes original sound
 * sources; original Runs, bills, choices, Preview and Release stay immutable. */
export async function keepAvgGeneratedSoundStageDraftV1(input: { scope: WorkspaceScope; productionId: number;
  expectedDraftRevision: number; expectedBuildId: number }) {
  const draft = await readAvgDraftV1(input.scope), details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief, workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId || build?.id !== input.expectedBuildId
    || !build.previewHash || !brief?.avgSoundPlanning || !workspace.soundProduction
    || !sameSoundScope(workspace.soundProduction.scope, brief.avgSoundPlanning.scope)) throw new Error('[avg-sound] 请先完成准确原声音版本；需求或制作版本已变化')
  const next = await prepareAvgInheritedSoundDraftV1({ scope: input.scope, workspace, build, productionKey: details.production.productionKey,
    targetBuildNumber: Math.max(...details.buildHistory.map(row => row.buildNumber)) + 1, worldContentHash: brief.source.worldContentHash })
  if (brief.avgSoundPlanning.scope.templates.some(t => !next.presentation.inheritedSounds?.some(entry => entry.assetKey === t.assetKey))) {
    throw new Error('[avg-sound] 不能沿用缺少准确原作者选用证明的声音')
  }
  delete next.soundProduction
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productProductions, db.productBuilds), async () => {
    const current = await db.productBuilds.get(build.id!), production = await db.productProductions.get(input.productionId)
    if (!current || !sameSoundScope(current, build) || !production || production.stateRevision !== details.production.stateRevision
      || production.currentBuildNumber !== build.buildNumber || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) throw new Error('[avg-sound] 沿用核对期间制作版本已变化')
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
  })
}
const sameSoundScope = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

export async function stageAvgMediaChoiceV2(input: { scope: WorkspaceScope; productionId: number; requirementKey: string;
  rawVersion: number; rawContentHash: string; declaration: string;processed?:{version:number;contentHash:string} }) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || !brief) throw new Error('[avg-media] 当前版本不是已开始的图片批次')
  const a = await readAvgImageConsumptionDefinitionV4({scope:input.scope,buildId:build.id,brief})
  const r = a.mediaBatch.requirements.find(r => r.requirementKey === input.requirementKey)
  if (!r) throw new Error('[avg-media] 图片需求不在当前冻结批次')
  const raw = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: build.id, artifactKey: avgRawMediaArtifactKeyV1(r.requirementKey),
    version: input.rawVersion, contentHash: input.rawContentHash })
  const candidate = await assertAvgConsumedRawImageV4({scope:input.scope,brief,row:raw})
  const needsProcessing=a.imageProcessing?.entries.some(e=>e.requirementKey===r.requirementKey)
  if(!!needsProcessing!==!!input.processed)throw new Error('[avg-process] 请明确核对本次冻结加工图；不能跳过或夹带加工版本')
  const processed=input.processed?await readAvgProcessedImageSourceV1({scope:input.scope,buildId:build.id,brief,raw,...input.processed}):undefined
  const base = { schema: 'storyforge.avg.media-choice' as const, requirementKey: r.requirementKey,
    requirementRevision: r.revision, raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash }, asset: processed?.asset??candidate.asset,
    referenceOnly: r.consumer.domain === 'reference', declaration: input.declaration }
  const payload:AvgAuthorMediaChoice=processed?{...base,version:2,processed:{artifactKey:processed.row.artifactKey,version:processed.row.version,contentHash:processed.row.contentHash}}:{...base,version:1}
  return stageAvgAuthorArtifactV1({ scope: input.scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    taskKey: `avg.author.media.${r.requirementKey}`, artifactKey: avgMediaChoiceArtifactKeyV1(r.requirementKey), kind: 'presentation', payload, declaration: input.declaration })
}

export async function stageAvgVisualReviewV1(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;rawVersion:number;rawContentHash:string;report:AvgReviewIssuesV1;declaration:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build,brief=details.executionBrief
  if(!build?.id||!brief||input.report.targetKey!==input.requirementKey)throw new Error('[avg-review] 评审不属于当前批次或准确图片')
  const image=await readAvgImageConsumptionDefinitionV4({scope:input.scope,buildId:build.id,brief})
  if(!image.mediaBatch.visualReviewPolicy)throw new Error('[avg-review] 当前冻结批次没有作者视觉评审合同')
  await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:build.id,artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),version:input.rawVersion,contentHash:input.rawContentHash})
  return stageAvgAuthorArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:`avg.author.visual-review.${input.requirementKey}`,artifactKey:avgVisualReviewArtifactKeyV1(input.requirementKey),kind:'quality-report',payload:input.report,declaration:input.declaration})
}

export async function readAvgRawImageCandidateBytesV2(input: { scope: WorkspaceScope; productionId: number; requirementKey: string; version: number; contentHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  if (!details.build?.id || !details.executionBrief || !details.executionBrief.avgVisualPlanning&&!readAvgOptionalImageDefinitionV3(details.executionBrief)) throw new Error('[avg-media] 当前版本不是图片批次')
  const raw = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: details.build.id,
    artifactKey: avgRawMediaArtifactKeyV1(input.requirementKey), version: input.version, contentHash: input.contentHash })
  const candidate = await assertAvgConsumedRawImageV4({scope:input.scope,brief:details.executionBrief,row:raw})
  const blob = raw.blobObjectId === null ? null : await db.mediaBlobObjects.get(raw.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== candidate.asset.contentHash
    || blob.byteSize !== candidate.asset.byteSize || blob.mimeType !== candidate.asset.mimeType) throw new Error('[avg-media] 原始图片对象不存在或已变化')
  return { asset: candidate.asset, data: await readVerifiedMediaBlobObjectData(blob) }
}

/** Exact read-only processed preview, including stopped/imported history. */
export async function readAvgProcessedImageCandidateBytesV1(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;version:number;contentHash:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const briefRow=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=briefRow?parseProductProductionBriefV3(briefRow.briefJson):null
  if(!build?.id||!brief||!brief.avgVisualPlanning&&!readAvgOptionalImageDefinitionV3(brief))throw new Error('[avg-process] 当前版本没有准确加工来源')
  const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  if(brief.avgVisualPlanning){
    const [{readAvgCompiledImageDefinitionV4},{readAvgHistoricalCompiledImageDefinitionV4},{readAvgVisualProcessingEvidenceV4}]=await Promise.all([
      import('./visual-planning-image-definition'),import('./visual-image-history'),import('./visual-image-processing')])
    const boundary={scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,controlEpoch:plan.controlEpoch}
    const compiled=['paused','cancelled','failed','recovery-required'].includes(build.status)?await readAvgHistoricalCompiledImageDefinitionV4(boundary)
      :await readAvgCompiledImageDefinitionV4({...boundary,expectedBrief:brief,purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly'})
    const proved=await readAvgVisualProcessingEvidenceV4({scope:input.scope,compiled,artifact:{artifactKey:avgProcessedImageArtifactKeyV1(input.requirementKey),version:input.version,contentHash:input.contentHash}})
    const blob=await db.mediaBlobObjects.get(proved.processing.blobObjectId!)
    if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'}))throw new Error('[avg-process] 加工图字节不存在或跨作品')
    return {asset:proved.image.asset,data:await readVerifiedMediaBlobObjectData(blob)}
  }
  const boundary={scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch}
  const proved=await verifyAvgProcessedImageArtifactV1({...boundary,artifactKey:avgProcessedImageArtifactKeyV1(input.requirementKey),version:input.version,contentHash:input.contentHash})
  const p=(await assertAvgProcessedImageArtifact(brief,proved.artifact)).payload
  const raw=await verifyAvgReferenceRawImageArtifactV1({...boundary,...p.raw})
  await assertAvgRawImageOriginV1({scope:input.scope,productionId:input.productionId,brief,build,artifact:raw.artifact,requirementKey:input.requirementKey,taskKey:raw.provenance.taskKey},[build.buildNumber])
  const image=await inspectAvgProcessedImageSourceV1({scope:input.scope,brief,raw:raw.artifact,processed:proved.artifact})
  const blob=await db.mediaBlobObjects.get(proved.artifact.blobObjectId!)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'}))throw new Error('[avg-process] 加工图字节不存在或跨作品')
  return {asset:image.asset,data:await readVerifiedMediaBlobObjectData(blob)}
}

async function reviewRetainedImage(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;version?:number;contentHash?:string}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const row=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=row?parseProductProductionBriefV3(row.briefJson):null,stored=brief?.avgAssembly
  const a=brief?readAvgOptionalImageDefinitionV3(brief):null
  if(!build?.id||!a||!stored||!['cancelled','failed','recovery-required'].includes(build.status))throw new Error('[avg-media] 当前版本不是可查看的已停止图片批次')
  const plan=parseProductProductionPlanV3(build.planJson,brief!,build.briefHash)
  const raws=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id,avgRawMediaArtifactKeyV1(input.requirementKey)])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===plan.controlEpoch).limit(2).toArray()
  const raw=raws[0]
  if(raws.length!==1||!raw||input.version!==undefined&&raw.version!==input.version||input.contentHash!==undefined&&raw.contentHash!==input.contentHash)throw new Error('[avg-media] 该项没有准确的已接收原图')
  const proved=await verifyRetainedAvgRawImageArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash})
  const query=parseAvgImageRecoveryV1({schema:'storyforge.avg.image-recovery',version:1,sourceBuildNumber:build.buildNumber,sourceBuildRevision:build.stateRevision,
    sourceBriefHash:build.briefHash,sourcePlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,sourceBatchHash:await hashProductProductionValueV2(a.mediaBatch),
    retained:[{requirementKey:input.requirementKey,proof:proved.provenance}],rerunRequirementKeys:a.mediaBatch.requirements.filter(r=>r.requirementKey!==input.requirementKey).map(r=>r.requirementKey),
    declaration:'只读原图核验，不授权调用、采用或新版本'},a.mediaBatch)
  return readAvgImageRecoverySourceV1({scope:input.scope,productionId:input.productionId,brief:{avgAssembly:stored.version===3
    ?{...stored,image:{...stored.image!,imageRecovery:query}}:{...a,imageRecovery:query}},requirementKey:input.requirementKey})
}

export async function readAvgRetainedImageCandidateBytesV1(input:{scope:WorkspaceScope;productionId:number;requirementKey:string;version:number;contentHash:string}){
  const candidate=await reviewRetainedImage(input)
  const blob=candidate.artifact.blobObjectId===null?null:await db.mediaBlobObjects.get(candidate.artifact.blobObjectId)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'}))throw new Error('[avg-media] 保留原图对象不存在或跨作品')
  return {asset:candidate.asset,data:await readVerifiedMediaBlobObjectData(blob)}
}

export async function readAvgImageRecoveryOptionsV1(scope:WorkspaceScope,productionId:number){
  const details=await readProductProductionDetailsV1(scope,productionId,['avg']),build=details.build
  const row=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=row?parseProductProductionBriefV3(row.briefJson):null
  const a=brief?readAvgOptionalImageDefinitionV3(brief):null
  if(!build?.id||!a||build.previewHash||!['cancelled','failed','recovery-required'].includes(build.status))throw new Error('[avg-media] 当前版本不能准备未封存图片恢复')
  const items=[]
  for(const r of a.mediaBatch.requirements){
    let candidate:Awaited<ReturnType<typeof reviewRetainedImage>>|null=null,issue='',retryBlocker=''
    try{candidate=await reviewRetainedImage({scope,productionId,requirementKey:r.requirementKey})}catch(error){issue=error instanceof Error?error.message:String(error)}
    try{await assertAvgKnownImageRetriesV1(scope,build,[r.requirementKey])}catch(error){retryBlocker=error instanceof Error?error.message:String(error)}
    items.push({requirementKey:r.requirementKey,name:r.name,asset:candidate?.asset??null,proof:candidate?.proof??null,issue,retryBlocker})
  }
  return {buildId:build.id,buildRevision:build.stateRevision,items}
}

/** Read-only recovery inventory from the exact stopped Build's authorized
 * Brief, not a coexisting reviewable child. No selection, repair, ledger
 * resolution, author adoption, transport or new Build authority is granted. */
export async function readAvgVoiceRecoveryOptionsV1(scope: WorkspaceScope, productionId: number) {
  const details = await readProductProductionDetailsV1(scope, productionId, ['avg']), build = details.build
  const row = build ? details.briefHistory.find(r => r.revision === build.briefRevision && r.briefHash === build.briefHash) : null
  const brief = row ? parseProductProductionBriefV3(row.briefJson) : null
  if (!build?.id || brief?.avgAssembly?.version !== 3 || build.previewHash
    || !['cancelled', 'failed', 'recovery-required'].includes(build.status)
    || !['authorized', 'superseded'].includes(row!.status) || row!.authorizedAt !== build.authorizedAt
    || await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('[avg-voice] 请先明确停止未封存批次或处理失败，再核对配音恢复项目')
  const { assembly, requests } = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (await hashProductProductionValueV2(plan) !== build.planHash) throw new Error('[avg-voice] 恢复清单的原始计划已变化')
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)!
  const voices = []
  for (const r of assembly.voice.batch.requirements) {
    const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, `avg.voice.raw.${r.requirementKey}`])
      .filter(a => a.status === 'accepted' && a.controlEpoch === plan.controlEpoch).limit(2).toArray()
    let selected: Awaited<ReturnType<typeof readAvgRawVoiceSourceV1>> | null = null, issue = '', retryBlocker = ''
    try {
      if (rows.length !== 1) throw new Error('[avg-voice] 本句没有准确的已接收原音频')
      const raw = rows[0]!
      selected = await readAvgRawVoiceSourceV1({ scope, buildId: build.id, assembly, capability,
        raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash },
        historicalReadOnly: { expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash,
          expectedPlanHash: build.planHash, sourceControlEpoch: plan.controlEpoch } })
    } catch (error) { issue = error instanceof Error ? error.message : String(error) }
    try { await assertAvgNoUnresolvedVoiceRequestsV1({ scope, requests: requests.filter(request => request.requirementKey === r.requirementKey) }) }
    catch (error) { retryBlocker = error instanceof Error ? error.message : String(error) }
    voices.push({ requirementKey: r.requirementKey, text: r.text, asset: selected?.asset ?? null,
      version: selected?.raw.version ?? null, contentHash: selected?.raw.contentHash ?? null,
      voiceId: assembly.voice.batch.presets.find(p => p.presetKey === r.presetKey)!.voiceId,
      costUsd: selected?.payload.provider.costUsd ?? null, issue, retryBlocker })
  }
  const images = assembly.image ? await readAvgImageRecoveryOptionsV1(scope, productionId) : null
  const current = await db.productBuilds.get(build.id), production = await db.productProductions.get(productionId)
  if (!current || !production || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.briefHash !== build.briefHash || current.planHash !== build.planHash || production.currentBuildNumber !== build.buildNumber
    || !await assertRecordInScope(scope, 'productBuilds', current, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || images && (images.buildId !== build.id || images.buildRevision !== build.stateRevision)) throw new Error('[avg-voice] 核对恢复清单期间版本已变化，请重新读取')
  return { buildId: build.id, buildRevision: build.stateRevision, voices, images }
}

/** Applies only actually adopted choices into an editable stage proposal. */
export async function configureAvgChosenMediaDraftV2(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg-media] 编辑草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || !brief || build.previewHash) throw new Error('[avg-media] 当前版本不能配置生成媒资')
  const image = await readAvgCurrentImageConsumptionDefinition({scope:input.scope,buildId:build.id,brief})
  if (brief.avgVisualPlanning ? !!workspace.mediaBatch
    : canonicalProductProductionJsonV2(workspace.mediaBatch ?? null) !== canonicalProductProductionJsonV2(image.mediaBatch)) throw new Error('[avg-media] 草稿需求与冻结批次已不一致')
  if(brief.avgVisualPlanning?!!workspace.imageProcessing:canonicalProductProductionJsonV2(workspace.imageProcessing??null)!==canonicalProductProductionJsonV2(image.imageProcessing??null))throw new Error('[avg-process] 加工草稿与本次冻结配方不一致，请明确准备新版本')
  const source = await readAvgMediaChoicesForConfigurationV2({ scope: input.scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
  await readAvgInheritedStageImagesV1({scope:input.scope,payload:workspace.presentation,productionKey:details.production.productionKey,
    targetBuildNumber:build.buildNumber,worldContentHash:brief.source.worldContentHash})
  const replaceablePlaceholders:Array<{assetKey:string;contentHash:string}>=[]
  for(const choice of source.mediaChoices??[]){
    const existing=workspace.presentation.stage.assets.find(asset=>asset.assetKey===choice.payload.asset.assetKey)
    if(existing&&canonicalProductProductionJsonV2(existing)!==canonicalProductProductionJsonV2(choice.payload.asset)&&!workspace.presentation.inheritedImages?.some(e=>e.assetKey===existing.assetKey)
      &&await verifyAvgRecoveryPlaceholderV1({scope:input.scope,productionId:input.productionId,brief,requirementKey:choice.payload.requirementKey,asset:existing}))replaceablePlaceholders.push({assetKey:existing.assetKey,contentHash:existing.contentHash})
  }
  const configuration={workspace,choices:(source.mediaChoices??[]).map(choice=>choice.payload),replaceablePlaceholders}
  const next = await (image.mediaBatch.version===2
    ?applyAvgMediaChoicesToDraftV2({...configuration,batch:image.mediaBatch})
    :applyAvgMediaChoicesToDraftV1({...configuration,batch:image.mediaBatch}))
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productBuilds, db.productProductions), async () => {
    const current = await db.productBuilds.get(build.id!), production = await db.productProductions.get(input.productionId)
    if (!current || !production || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
      || current.briefHash !== build.briefHash || current.planHash !== build.planHash || current.previewHash
      || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch) throw new Error('[avg-media] 图片配置期间制作版本已变化')
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
  })
}

/** Read the actual current producer/response/Blob for audition. No credential,
 * invocation, author adoption or immutable-release change occurs here. */
export async function readAvgRawVoiceCandidateV3(input: { scope: WorkspaceScope; productionId: number; requirementKey: string;
  version: number; contentHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || brief?.avgAssembly?.version !== 3) throw new Error('[avg-voice] 当前版本不是准确配音批次')
  const { assembly } = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  const r = assembly.voice.batch.requirements.find(r => r.requirementKey === input.requirementKey)
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (!r || !capability) throw new Error('[avg-voice] 当前批次没有该句配音需求')
  const selected = await readAvgRawVoiceSourceV1({ scope: input.scope, buildId: build.id, assembly, capability,
    raw: { artifactKey: `avg.voice.raw.${r.requirementKey}`, version: input.version, contentHash: input.contentHash },
    historicalReadOnly: { expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash,
      sourceControlEpoch: parseProductProductionPlanV3(build.planJson, brief, build.briefHash).controlEpoch } })
  const blob = await db.mediaBlobObjects.get(selected.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== selected.asset.contentHash || blob.byteSize !== selected.asset.byteSize || blob.mimeType !== selected.asset.mimeType) throw new Error('[avg-voice] 已验证的音频 Blob 不存在或来源已变化')
  const data = await readVerifiedMediaBlobObjectData(blob)
  const current = await db.productBuilds.get(build.id), production = await db.productProductions.get(input.productionId)
  if (!current || !production || current.controlEpoch !== build.controlEpoch || current.planHash !== build.planHash
    || current.briefHash !== build.briefHash || production.currentBuildNumber !== build.buildNumber) throw new Error('[avg-voice] 音频读取期间制作版本已变化')
  return { ...selected, data, buildId: build.id, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    sourceKey: `${input.scope.workId}:${build.id}:${build.controlEpoch}:${selected.raw.version}` }
}

export async function stageAvgAudioReviewV3(input: { scope: WorkspaceScope; productionId: number; requirementKey: string;
  rawVersion: number; rawContentHash: string; report: AvgReviewIssuesV1; declaration: string }) {
  const selected = await readAvgRawVoiceCandidateV3({ ...input, version: input.rawVersion, contentHash: input.rawContentHash })
  const build = await db.productBuilds.get(selected.buildId)
  if (!build || build.controlEpoch !== selected.controlEpoch || input.report.targetKey !== input.requirementKey) throw new Error('[avg-voice] 审听目标或生产来源已变化')
  return stageAvgAuthorArtifactV1({ scope: input.scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    taskKey: `avg.author.voice-review.${input.requirementKey}`, artifactKey: avgVoiceReviewArtifactKeyV1(input.requirementKey), kind: 'quality-report',
    payload: input.report, declaration: input.declaration })
}

export async function stageAvgVoiceChoiceV3(input: { scope: WorkspaceScope; productionId: number; requirementKey: string;
  rawVersion: number; rawContentHash: string; declaration: string }) {
  const selected = await readAvgRawVoiceCandidateV3({ ...input, version: input.rawVersion, contentHash: input.rawContentHash })
  const build = await db.productBuilds.get(selected.buildId), reviewKey = avgVoiceReviewArtifactKeyV1(input.requirementKey)
  if (!build || build.controlEpoch !== selected.controlEpoch) throw new Error('[avg-voice] 选择来源已变化')
  const reviews = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, reviewKey])
    .filter(row => row.status === 'accepted' && row.controlEpoch === build.controlEpoch).toArray()
  if (reviews.length !== 1) throw new Error('[avg-voice] 请先确认准确音频的审听记录')
  const payload: AvgAuthorVoiceChoiceV1 = { schema: 'storyforge.avg.voice-choice', version: 1, requirementKey: input.requirementKey,
    requestIdentityHash: selected.payload.request.identityHash,
    raw: { artifactKey: selected.raw.artifactKey, version: selected.raw.version, contentHash: selected.raw.contentHash },
    review: { artifactKey: reviewKey, version: reviews[0]!.version, contentHash: reviews[0]!.contentHash }, asset: selected.asset, declaration: input.declaration }
  return stageAvgAuthorArtifactV1({ scope: input.scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
    taskKey: `avg.author.voice-choice.${input.requirementKey}`, artifactKey: avgVoiceChoiceArtifactKeyV1(input.requirementKey), kind: 'presentation', payload, declaration: input.declaration })
}

/** Produces an editable proposal after actual choices are adopted. Stage
 * adoption independently rechecks the exact source and reading consumers. */
export async function configureAvgChosenVoiceDraftV3(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg-voice] 编辑草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg']), build = details.build, brief = details.executionBrief
  if (!build?.id || brief?.avgAssembly?.version !== 3 || build.previewHash) throw new Error('[avg-voice] 当前版本不能配置生成配音')
  const { assembly } = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  const source = await readAvgVoiceChoicesForConfigurationV3({ scope: input.scope, buildId: build.id,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
  const requiredScripts = new Set(assembly.voice.batch.requirements.map(requirement => requirement.script.artifactKey))
  const replaceableAssets = []
  for (const choice of source.voiceChoices ?? []) {
    const old = workspace.presentation.stage.assets.find(asset => asset.assetKey === choice.payload.asset.assetKey)
    if (!old || canonicalProductProductionJsonV2(old) === canonicalProductProductionJsonV2(choice.payload.asset)) continue
    const prior = await readAvgVoiceRecoveryReplacementV1({ scope: input.scope, productionId: input.productionId,
      assembly, requirementKey: choice.payload.requirementKey })
    if (old.kind !== 'voice' || canonicalProductProductionJsonV2(old) !== canonicalProductProductionJsonV2(prior.asset)) {
      throw new Error('[avg-voice] 当前草稿中的旧配音不是准确恢复来源，请先明确解决媒资冲突')
    }
    replaceableAssets.push({ assetKey: old.assetKey, contentHash: old.contentHash })
  }
  const next = await applyAvgVoiceChoicesToDraftV1({ workspace, assembly,
    sourceScripts: source.scripts.filter(script => requiredScripts.has(script.artifact.artifactKey)).map(s => ({ ...s.artifact, payload: s.payload })),
    choices: (source.voiceChoices ?? []).map(choice => choice.payload), replaceableAssets })
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts, db.productBuilds, db.productProductions), async () => {
    const current = await db.productBuilds.get(build.id!), production = await db.productProductions.get(input.productionId)
    if (!current || !production || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
      || current.briefHash !== build.briefHash || current.planHash !== build.planHash || current.previewHash
      || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch) throw new Error('[avg-voice] 配音配置期间制作版本已变化')
    return saveAvgAuthorWorkspaceV1(input.scope, draft.revision, next)
  })
}

function runtimeMediaKeys(workspace: ReturnType<typeof parseAvgAuthorWorkspaceV1>) {
  return [...new Set([...workspace.presentation.stage.assets.map(asset => asset.assetKey),
    ...(workspace.mediaBatch?.requirements.filter(r => r.consumer.domain !== 'reference').map(r => r.assetKey) ?? []),
    ...(workspace.voiceProduction ? readAvgVoiceDraftV1(workspace.voiceProduction).voice.batch.requirements.map(r => r.assetKey) : [])])]
}

async function assemblyExecutionOptions(scope: WorkspaceScope, brief: ProductProductionBriefV3, productionId: number, buildId?: number) {
  if (brief.avgVisualPlanning) {
    const readers=await import('./visual-planning-workspace')
    return (brief.avgVisualPlanning.version===5?readers.resolveAvgVisualPlanningExecutionV5:readers.resolveAvgVisualPlanningExecutionV4)(scope,brief,buildId)
  }
  const mediaCapabilities = new Map<string, ResolvedProductMediaCapabilityV1>()
  const capabilityBindings: ProductProductionCapabilityBindingV1[] = []
  let avgVoiceTransport: Awaited<ReturnType<typeof resolveAvgVoiceExecutionCapabilityV3>> | undefined
  let avgImageEndpointRouteHash: string | undefined
  if (brief.avgAssembly?.version === 3) {
    const resolved = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly), { assembly } = resolved
    await validateAvgVoiceRecoveryV1({ scope, productionId, brief,
      ...(buildId ? { targetBuild: await db.productBuilds.get(buildId) } : {}), checkProspectiveRequests: false })
    const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
    if (!capability) throw new Error('[avg-voice] 缺少准确冻结的配音能力')
    capabilityBindings.push({ requirementKey: assembly.voice.binding.requirementKey, adapterId: assembly.voice.binding.adapterId,
      bindingHash: assembly.voice.binding.bindingHash, provider: assembly.voice.protocol.provider, model: assembly.voice.protocol.model })
    const pending = avgPendingVoiceRequestsV1(assembly, resolved.requests)
    let received = pending.length === 0 || buildId !== undefined
    if (buildId !== undefined) for (const r of pending) {
      const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([buildId, `avg.voice.raw.${r.requirementKey}`])
        .filter(row => row.status === 'accepted').toArray()
      if (rows.length !== 1) { received = false; break }
    }
    // Presence selects zero-network settlement recovery, not acceptance. The
    // scheduler and author readers still prove producer/ledger/response/bytes.
    if (!received) {
      if (!avgMediaProductionEnabledV2() || !avgVoiceProductionEnabledV3()) throw new Error('[avg-voice] 配音生产尚未开放，已有候选仍可只读核验')
      avgVoiceTransport = await resolveAvgVoiceExecutionCapabilityV3({ projectId: scope.projectId, assembly, capability })
    }
  }
  const image = readAvgOptionalImageDefinitionV3(brief)
  if (image) {
    const { capability } = await assertAvgImageProductionDefinitionV3(brief)
    const binding = { requirementKey: image.imageBinding.requirementKey, adapterId: image.imageBinding.adapterId, bindingHash: image.imageBinding.bindingHash }
    capabilityBindings.push(binding)
    // A fully retained image batch needs no current provider route. Otherwise
    // prove every received raw, or resolve the exact pending image route.
    let received = image.imageRecovery?.rerunRequirementKeys.length === 0 || buildId !== undefined
    if (image.imageRecovery?.rerunRequirementKeys.length !== 0 && buildId !== undefined) for (const r of image.mediaBatch.requirements) {
      const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([buildId, avgRawMediaArtifactKeyV1(r.requirementKey)])
        .filter(row => row.status === 'accepted').toArray()
      if (rows.length !== 1) { received = false; break }
      try { await verifyAcceptedProductBuildArtifactV1({ scope, buildId, artifactKey: rows[0]!.artifactKey, version: rows[0]!.version, contentHash: rows[0]!.contentHash }) }
      catch { received = false; break }
    }
    if (!received) {
      if (!avgMediaProductionEnabledV2() || brief.avgAssembly?.version === 3 && !avgVoiceProductionEnabledV3()) throw new Error('[avg-media] 当前媒资生产尚未开放；已有回执和候选仍可读取')
      const configured = await resolveAvgImageExecutionCapabilityV2({ projectId: scope.projectId, requirement: capability })
      if (configured.binding.bindingHash !== binding.bindingHash || configured.endpointRouteHash !== image.imageBinding.endpointRouteHash) throw new Error('[avg-media] Agnes 图片路由已变化，请重新核对制作方案')
      mediaCapabilities.set(binding.requirementKey, configured.resolved)
      avgImageEndpointRouteHash = configured.endpointRouteHash
    }
  }
  return { mediaCapabilities, capabilityBindings, avgVoiceTransport, avgImageEndpointRouteHash }
}

export async function readAvgAssemblyWorkspaceV1(scope: WorkspaceScope, selectedProductionId?: number | null) {
  const draft = await readAvgDraftV1(scope)
  if (selectedProductionId && draft.productionId && selectedProductionId !== draft.productionId) throw new Error('[avg] 当前草稿属于另一制作记录，请返回作品库选择准确版本')
  const productionId = selectedProductionId ?? draft.productionId
  const details = productionId ? await readProductProductionDetailsV1(scope,productionId,['avg']) : null
  if (details?.brief) {
    const brief = parseProductProductionBriefV3(details.brief.briefJson)
    if (!brief.avgAssembly && !brief.avgVisualPlanning && !brief.avgSoundPlanning) throw new Error('[avg] 此记录使用旧版制作流程；请在新 AVG 作品中试用系统组装')
  }
  const artifacts = []
  if (details?.build?.planRevision && details.executionBrief) {
    // A reviewable revision Brief can coexist with the previous immutable Build.
    // Its task/media domains must never be used to reinterpret that old Plan.
    const frozenBrief = details.briefHistory.find(row=>row.revision===details.build!.briefRevision&&row.briefHash===details.build!.briefHash)
    if(!frozenBrief||frozenBrief.status!=='authorized')throw new Error('[avg] 当前 Build 缺少准确的已授权方案')
    const plan = parseProductProductionPlanV3(details.build.planJson,parseProductProductionBriefV3(frozenBrief.briefJson),details.build.briefHash)
    const retainedVisual = !!details.executionBrief.avgVisualPlanning && ['paused','cancelled','failed','recovery-required'].includes(details.build.status)
    const artifactEpoch = retainedVisual ? plan.controlEpoch : details.build.controlEpoch
    const keys = [...new Set([...plan.tasks.filter(task=>details.executionBrief!.avgVisualPlanning||details.executionBrief!.avgSoundPlanning||task.executionMode==='human-import'||['avg-media-image-generate','avg-media-image-reuse','avg-media-image-process','avg-media-voice-generate','avg-media-voice-reuse'].includes(task.kind)).flatMap(task=>task.outputArtifactKeys),'runtime.package','quality.report'])]
    for (const key of keys) {
      const accepted = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key])
        .filter(row=>row.status==='accepted'&&row.controlEpoch===artifactEpoch).limit(2).toArray()
      const pending = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([details.build.id!,key]).reverse()
        .filter(row=>row.status==='pending'&&row.controlEpoch===artifactEpoch).limit(1).toArray()
      for (const row of [...accepted,...pending]) if (!await assertRecordInScope(scope,'productBuildArtifacts',row,{owner:'work'})) throw new Error('[avg] 作者输入跨作品')
      if(retainedVisual)for(const row of accepted.filter(r=>r.artifactKey.startsWith('avg.proposal.')))await (details.executionBrief.avgVisualPlanning?.version===5?verifyHistoricalAvgVisualPlanningArtifactV5:verifyHistoricalAvgVisualPlanningArtifactV4)({scope,buildId:details.build.id!,
        expectedBuildRevision:details.build.stateRevision,expectedBriefHash:details.build.briefHash,expectedPlanHash:details.build.planHash,sourceControlEpoch:artifactEpoch,
        artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
      artifacts.push(...accepted,...pending)
    }
  }
  const processingTasks=details?.build?.planRevision&&details.brief?.revision===details.build.briefRevision&&details.executionBrief&&(details.executionBrief.avgVisualPlanning?.imageProcessing??readAvgOptionalImageDefinitionV3(details.executionBrief)?.imageProcessing)
    ?(await projectProductProductionSchedulerV1({scope,productionId:details.production.id!})).tasks.filter(task=>task.taskKey.startsWith('avg.media.process.')):[]
  const visualRecordedUsage=details?.build?.planRevision&&details.executionBrief?.avgVisualPlanning?projectProductProductionRecordedUsageV1(details.build.budgetLedgerJson):null
  const visualProgress=details?.build?.planRevision&&details.executionBrief?.avgVisualPlanning&&details.brief?.revision===details.build.briefRevision
    ?await projectProductProductionSchedulerV1({scope,productionId:details.production.id!}):null
  // Import intentionally stales completed producer Runs. Reading the saved
  // workspace or an immutable published Release must not rehydrate them or
  // require current compilation authority merely to render release controls.
  // Exact compilation/author/producer readers remain mandatory for actual
  // consumption and publication; their explicit import recovery is separate.
  const visualProofRecoveryRequired=!!details?.build?.previewHash&&details.executionBrief?.avgVisualPlanning?.version===5
    &&visualProgress!=null&&!visualProgress.terminal
  // A pending Brief owns no current image task. Original images are read via
  // their exact historical source when explicitly preparing retention.
  const imageDefinition: (Awaited<ReturnType<typeof readAvgCurrentImageConsumptionDefinition>>&Pick<AvgAssemblyBriefV2,'imageRecovery'>)|null = visualProofRecoveryRequired?null:details?.build?.id && details.executionBrief?.avgVisualPlanning
    && details.brief?.revision===details.build.briefRevision
    && ['building','integrating','validating','preview-ready','release-ready','released'].includes(details.build.status)
    ? artifacts.some(row => row.artifactKey === 'avg.media.compiled-visual-requirements' && row.status === 'accepted')
      ? await readAvgCurrentImageConsumptionDefinition({scope,buildId:details.build.id,brief:details.executionBrief}) : null
    : details?.executionBrief ? readAvgOptionalImageDefinitionV3(details.executionBrief) : null
  const soundProgress = details?.build?.planRevision && details.executionBrief?.avgSoundPlanning && details.brief?.revision === details.build.briefRevision
    ? await projectProductProductionSchedulerV1({ scope, productionId: details.production.id! }) : null
  const soundRecordedUsage = details?.build?.planRevision && details.executionBrief?.avgSoundPlanning
    ? projectProductProductionRecordedUsageV1(details.build.budgetLedgerJson) : null
  return { draft,details,artifacts,media:await listAvgDraftMediaV1(scope),processingTasks,imageDefinition,visualProgress,visualRecordedUsage,visualProofRecoveryRequired,soundProgress,soundRecordedUsage }
}

export async function confirmAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; artifactKey: string; candidateVersion: number; candidateHash: string }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly&&!details.executionBrief?.avgVisualPlanning&&!details.executionBrief?.avgSoundPlanning) throw new Error('[avg] 当前制作缺少作者组装 Build')
  if (details.executionBrief.avgSoundPlanning && !avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 正式声音工作流尚未开放')
  const result = await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'adopt-avg-artifact',
    commandId:commandId('confirm'),expectedStateRevision:details.production.stateRevision,expectedBuildRevision:details.build.stateRevision,
    buildNumber:details.build.buildNumber,controlEpoch:details.build.controlEpoch,artifactKey:input.artifactKey,candidateVersion:input.candidateVersion,candidateHash:input.candidateHash}})
  if (!result.ok) throw new Error(String(result.result.message??result.errorCode))
  return result
}

async function expectedBaselinePackageHash(details: ProductProductionDetailsV1) {
  if (!details.build) return null
  const targetNumber = Math.max(...details.buildHistory.map(build=>build.buildNumber)) + 1
  const selected = selectProductBuildCompatibilityBaselineV1({ currentBuildNumber:targetNumber,parentBuildNumber:details.build.buildNumber,priorBuilds:details.buildHistory })
  if (!selected) return null
  const build = details.buildHistory.find(build=>build.id===selected.id)!
  const preview = await verifyStoredProductBuildPreview(build)
  if (!preview || !build.rootTerminalReceiptHash) throw new Error('[avg] 修订基线缺少可验证的正式组装回执')
  return preview.packageHash
}

/** Prepare a reviewable Brief only. User start and per-artifact adoption remain explicit. */
export async function prepareAvgAssemblyBriefV1(input: { scope: WorkspaceScope; expectedDraftRevision: number;
  imageRecovery?:AvgImageRecoveryV1; voiceRecovery?: AvgVoiceRecoveryV1; visualPlanning?: AvgVisualPlanningDraftV4|AvgVisualPlanningDraftV5;
  visualStageContinuation?:{expectedBuildId:number;expectedBuildRevision:number} }) {
  let draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision) throw new Error('[avg] 编辑草稿已变化，请刷新后再准备方案')
  let workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (workspace.soundProduction && (input.visualPlanning || input.imageRecovery || input.voiceRecovery || input.visualStageContinuation)) throw new Error('[avg-sound] 请单独准备已保存的声音制作范围')
  const soundServices = workspace.soundProduction ? await import('./sound-planning-workspace') : null
  const sound = soundServices ? await soundServices.prepareAvgSoundPlanningConfigurationV1(input.scope, workspace) : null
  if(input.visualStageContinuation&&!avgMediaProductionEnabledV2())throw new Error('[avg-visual-retain] 实验性图片沿用未启用')
  if(input.visualStageContinuation&&(!draft.productionId||input.visualPlanning||input.imageRecovery||input.voiceRecovery||workspace.mediaBatch||workspace.voiceProduction))throw new Error('[avg-visual-retain] 请单独保留专业演出图并准备零调用组装方案')
  if (input.visualPlanning && (input.imageRecovery || input.voiceRecovery)) throw new Error('[avg-visual-plan] 专业视觉不能借用旧批次恢复合同')
  let visualAdapter:import('./media-reference-contract').AvgImageAdapterIdV4='agnes.image-2.1-flash.v1'
  if(input.visualPlanning){
    const existing=draft.productionId?await readProductProductionDetailsV1(input.scope,draft.productionId,['avg']):null
    if(existing?.brief){
      const saved=parseProductProductionBriefV3(existing.brief.briefJson).avgVisualPlanning
      if(saved){
        if(saved.version!==(input.visualPlanning.version===2?5:4))throw new Error('[avg-visual-plan] 已保存的专业方案版本不同，请保留原版本并使用匹配的修订流程')
        visualAdapter=saved.imageBinding.adapterId
      }
    }
    const source=await import('./visual-planning-scope-draft')
    workspace=input.visualPlanning.version===2
      ?(await source.prepareAvgVisualPlanningSourceDraftV5({workspace,planning:input.visualPlanning,previous:existing?unstartedAvgVisualPlanningScopesV5(existing):[]})).workspace
      :(await source.prepareAvgVisualPlanningSourceDraftV4({workspace,planning:input.visualPlanning,previous:existing?unstartedAvgVisualPlanningScopes(existing):[]})).workspace
  }
  const planningServices=input.visualPlanning?await import('./visual-planning-workspace'):null
  const visual=input.visualPlanning?(input.visualPlanning.version===2
    ?{version:5 as const,configuration:await planningServices!.prepareAvgVisualPlanningConfigurationV5(input.scope,workspace,input.visualPlanning,visualAdapter)}
    :{version:4 as const,configuration:await planningServices!.prepareAvgVisualPlanningConfigurationV4(input.scope,workspace,input.visualPlanning,visualAdapter)}):null
  const voice = workspace.voiceProduction ? await validateAvgVoiceDraftSourcesV1(workspace.voiceProduction, workspace) : null
  if (voice && (!avgVoiceProductionEnabledV3() || !avgMediaProductionEnabledV2())) throw new Error('[avg-voice] 配音生产尚未开放；已保存批次不能按零调用流程开始')
  if (workspace.mediaBatch) {
    await validateAvgVisualProductionBatchSourceV1(workspace.mediaBatch, workspace)
    if (!avgMediaProductionEnabledV2()) throw new Error('[avg-media] 媒资生产流程尚未开放；不能把待生成批次按零调用组装执行')
    assertAvgMediaConsumerDeclarationsV1(workspace.mediaBatch, workspace.systemPlan)
    for(const r of workspace.mediaBatch.requirements)await validateAvgGeneratedReferencesV1(input.scope,r.references,r.family)
  }
  if (!draft.worldReleaseId) throw new Error('[avg] 请先在产品定向选择冻结世界版本')
  const work = await db.works.get(input.scope.workId)
  if (!work || work.kind !== 'avg' || !await assertRecordInScope(input.scope,'works',work,{owner:'work'})) throw new Error('[avg] 当前作品不是 AVG')
  const mediaCapability: ProviderCapabilityRequirementV1 | null = workspace.mediaBatch ? {
    requirementKey: 'avg.media.image', mediaClass: 'image', operation: 'generate', adapterFamily: 'agnes', minimumCapabilityVersion: '1',
    allowedDataClasses: avgVisualProductionDataClassesV2({ mediaBatch: workspace.mediaBatch }), maximumRequestCost: null, maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-avg-image-rights.v1', capabilityHash: await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1), required: true,
  } : null
  const voiceCapability: ProviderCapabilityRequirementV1 | null = voice ? {
    requirementKey: AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1, mediaClass: 'voice', operation: 'speech',
    adapterFamily: voice.voice.protocol.adapterId, minimumCapabilityVersion: '1', allowedDataClasses: ['voice-script'],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-avg-voice-rights.v1',
    capabilityHash: voice.requests[0]!.capabilityHash, required: true,
  } : null
  const recovery=input.imageRecovery&&workspace.mediaBatch?parseAvgImageRecoveryV1(input.imageRecovery,workspace.mediaBatch):null
  if(input.imageRecovery&&!recovery)throw new Error('[avg-media] 恢复缺少准确图片批次')
  const voiceRecovery = input.voiceRecovery && voice ? parseAvgVoiceRecoveryV1(input.voiceRecovery, voice.voice.batch) : null
  if (input.voiceRecovery && !voiceRecovery) throw new Error('[avg-voice] 恢复缺少准确已保存配音批次')
  if (voiceRecovery) {
    if (!draft.productionId) throw new Error('[avg-voice] 恢复缺少当前制作记录')
    const current = await readProductProductionDetailsV1(input.scope, draft.productionId, ['avg'])
    if (!current.build || current.build.buildNumber !== voiceRecovery.sourceBuildNumber
      || current.build.stateRevision !== voiceRecovery.sourceBuildRevision || current.build.previewHash
      || current.executionBrief?.avgAssembly?.version !== 3) throw new Error('[avg-voice] 配音恢复来源或草稿已变化')
    const old = await assertAvgStoredAssemblyBriefV3(current.executionBrief.avgAssembly)
    if (await hashAvgVoiceDeclarationForRecoveryV1(voice!.voice) !== await hashAvgVoiceDeclarationForRecoveryV1(old.assembly.voice)) throw new Error('[avg-voice] 配音草稿与原冻结批次不一致')
    await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: draft.productionId,
      brief: { ...current.executionBrief, avgAssembly: await encodeAvgStoredAssemblyBriefV3({ ...old.assembly,
        voice: { ...voice!.voice, recovery: voiceRecovery } }),
        capabilityRequirements: current.executionBrief.capabilityRequirements.map(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 ? voiceCapability! : c) } })
  }
  if (voice) {
    const pending = voice.requests.filter(r => !voiceRecovery?.retained.some(item => item.requirementKey === r.requirementKey))
    if (pending.length) await assertAvgNoUnresolvedVoiceRequestsV1({ scope: input.scope, requests: pending })
  }
  let retainedBinding: import('./assembly-contract').AvgAssemblyBriefV2['imageBinding']|null=null
  if(recovery){
    if(!draft.productionId)throw new Error('[avg-media] 恢复缺少当前制作记录')
    const current=await readProductProductionDetailsV1(input.scope,draft.productionId,['avg']),old=current.executionBrief?readAvgOptionalImageDefinitionV3(current.executionBrief):null
    if(!current.build||current.build.buildNumber!==recovery.sourceBuildNumber||current.build.stateRevision!==recovery.sourceBuildRevision
      ||current.build.previewHash||!old||canonicalProductProductionJsonV2(old.mediaBatch)!==canonicalProductProductionJsonV2(workspace.mediaBatch))throw new Error('[avg-media] 恢复来源或草稿批次已变化')
    retainedBinding=old.imageBinding
    const frozen = current.executionBrief!.avgAssembly!
    await validateAvgImageRecoveryV1({scope:input.scope,productionId:draft.productionId,brief:{...current.executionBrief!,
      avgAssembly:frozen.version===3?{...frozen,image:{...frozen.image!,imageRecovery:recovery}}:{...old,imageRecovery:recovery}}})
  }
  const configured = mediaCapability&&(!recovery||recovery.rerunRequirementKeys.length>0) ? await resolveAvgImageExecutionCapabilityV2({ projectId: input.scope.projectId, requirement: mediaCapability }) : null
  const imageBinding=configured?{...configured.binding,endpointRouteHash:configured.endpointRouteHash}:retainedBinding
  if(recovery&&canonicalProductProductionJsonV2(imageBinding)!==canonicalProductProductionJsonV2(retainedBinding))throw new Error('[avg-media] 图片路由已改变，不能在同一恢复中复用旧原图')
  if (sound) {
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.productionId !== draft.productionId || current.editorJson !== draft.editorJson) throw new Error('[avg-sound] 准备期间作者草稿已变化')
  }
  let productionId = draft.productionId
  let basePackageHash: string | null = null
  let continuationState: {productionRevision:number;buildId:number;buildRevision:number}|null=null
  if (productionId != null) {
    const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
    if(input.visualStageContinuation&&!details.build)throw new Error('[avg-visual-retain] 原专业版本已变化或不存在')
    if (details.build) {
      const old = details.executionBrief
      const frozenSource=details.briefHistory.find(row=>row.revision===details.build!.briefRevision&&row.briefHash===details.build!.briefHash)
      const reference=(await listWorldReferenceCatalogV1(input.scope)).find(entry=>entry.reference.localReleaseRecordId===draft.worldReleaseId)?.reference
      if ((!old?.avgAssembly&&!(old?.avgVisualPlanning&&(visual||input.visualStageContinuation))&&!(old?.avgSoundPlanning&&(sound||workspace.presentation.inheritedSounds?.length))) || !frozenSource || frozenSource.sourceWorldReleaseId!==draft.worldReleaseId || !reference
        ||reference.releaseHash!==old.source.worldContentHash||frozenSource.sourceWorldContentHash!==reference.releaseHash) throw new Error('[avg] 当前修订不能替换产品协议或世界来源')
      if (old.avgSoundPlanning && !sound) {
        if (!details.build.previewHash || workspace.soundProduction) throw new Error('[avg-sound] 请先完成并明确结束原声音批次')
        await readAvgInheritedStageSoundsV1({ scope: input.scope, payload: workspace.presentation, scripts: workspace.scripts,
          productionKey: details.production.productionKey, targetBuildNumber: Math.max(...details.buildHistory.map(row => row.buildNumber)) + 1,
          worldContentHash: old.source.worldContentHash })
        if (old.avgSoundPlanning.scope.templates.some(t => !workspace.presentation.inheritedSounds?.some(e => e.assetKey === t.assetKey
          && e.source.productionKey === details.production.productionKey && e.source.buildNumber === details.build!.buildNumber))) throw new Error('[avg-sound] 后继方案须保留原批全部已确认声音来源')
      }
      if(old.avgVisualPlanning){
        const continuation=input.visualStageContinuation
        if(continuation){
          if(details.build.id!==continuation.expectedBuildId||details.build.stateRevision!==continuation.expectedBuildRevision
            ||!details.build.previewHash&&!['cancelled','failed','recovery-required'].includes(details.build.status))throw new Error('[avg-visual-retain] 原专业版本或草稿已变化，请重新核对')
          continuationState={productionRevision:details.production.stateRevision,buildId:details.build.id!,buildRevision:details.build.stateRevision}
        }else if(details.build.previewHash||!['cancelled','failed','recovery-required'].includes(details.build.status))throw new Error('[avg-visual-restart] 请先处理未封存的失败或明确停止；已冻结版本须走媒资沿用合同')
        if(continuation)await assertAvgVisualStageRetentionKnownV4(input.scope,details.build)
        else await assertAvgVisualPlanningRestartKnownV4(input.scope,details.build)
        if(!continuation&&old.avgVisualPlanning.scope.templates.some(t=>workspace.presentation.stage.assets.some(a=>a.assetKey===t.parameters.assetKey)))throw new Error('[avg-visual-restart] 已选图片仍在演出草稿；须通过准确媒资沿用合同保留，不能按全新请求覆盖')
      }
      else if(input.visualStageContinuation)throw new Error('[avg-visual-retain] 此操作只接受原专业视觉版本')
      const pending = details.production.status === 'brief-ready' && details.brief?.revision !== details.build.briefRevision
        ? parseProductProductionBriefV3(details.brief!.briefJson) : null
      if (details.build.previewHash) {
        if (workspace.basePreviewHash !== details.build.previewHash) throw new Error('[avg] 修订基线已变化，请读取准确预览后再创建新 Build')
        const preview = await verifyStoredProductBuildPreview(details.build)
        if (!preview) throw new Error('[avg] 修订基线缺少正式预览')
        basePackageHash = preview.packageHash
      } else {
        if (!['cancelled','failed','recovery-required'].includes(details.build.status)) throw new Error('[avg] 当前制作仍在执行；请先停止并保留记录，再准备新 Build')
        if(workspace.mediaBatch&&!recovery)await assertAvgKnownImageRetriesV1(input.scope,details.build,workspace.mediaBatch.requirements.map(r=>r.requirementKey))
        basePackageHash = await expectedBaselinePackageHash(details)
      }
      const inherited=old.avgVisualPlanning&&!input.visualStageContinuation?workspace:await prepareAvgInheritedStageDraftV1({scope:input.scope,workspace,build:details.build,
        productionKey:details.production.productionKey,targetBuildNumber:Math.max(...details.buildHistory.map(row=>row.buildNumber))+1,
        worldContentHash:old.source.worldContentHash,...(voiceRecovery ? { voiceRecovery } : {})})
      // A later stopped batch may have no selected output of its own. The
      // source reader above still proves every saved older choice and pixel.
      if(input.visualStageContinuation&&!inherited.presentation.inheritedImages?.some(entry=>(entry.source.version===2||entry.source.version===3||entry.source.version===4||entry.source.version===5||entry.source.version===6)
        &&entry.source.productionKey===details.production.productionKey&&entry.source.raw.buildNumber<=details.build!.buildNumber))throw new Error('[avg-visual-retain] 当前演出没有准确已采用的专业旧图')
      const continuationCommandId=input.visualStageContinuation?`avg.keep.${await hashProductProductionValueV2({schema:'storyforge.avg.visual-stage-continuation',version:1,
        productionKey:details.production.productionKey,buildNumber:details.build.buildNumber,briefHash:details.build.briefHash,planHash:details.build.planHash,workspace:inherited})}`:undefined
      if(input.visualStageContinuation&&pending){
        const prior=await db.productProductionCommands.where('[productionId+commandId]').equals([productionId,continuationCommandId!]).first()
        if(!prior||!await assertRecordInScope(input.scope,'productProductionCommands',prior,{owner:'work'})||prior.type!=='evolve'||prior.status!=='succeeded'
          ||JSON.parse(prior.resultJson).briefRevision!==details.brief!.revision)throw new Error('[avg-visual-retain] 已有其他待开始方案，请先核对；不会覆盖现有方案')
      }
      // Persist the reviewable source draft before creating an evolution Brief.
      // The deterministic existing command lets an explicit identical retry
      // finish after a later Brief-save failure, including after full remap.
      if(continuationState){
        const expected=continuationState
        draft=await db.transaction('rw',scopeTransactionTables(db.avgAuthoringDrafts,db.productProductions,db.productBuilds),async()=>{
          const current=await db.productProductions.get(details.production.id!),build=await db.productBuilds.get(expected.buildId)
          if(!current||!await assertRecordInScope(input.scope,'productProductions',current,{owner:'work'})
            ||current.stateRevision!==expected.productionRevision||!build||build.stateRevision!==expected.buildRevision
            ||current.currentBuildNumber!==build.buildNumber)throw new Error('[avg-visual-retain] 制作方案或原版本在核对期间变化，请刷新后重试')
          return canonicalProductProductionJsonV2(inherited)!==canonicalProductProductionJsonV2(workspace)
            ? saveAvgAuthorWorkspaceV1(input.scope,draft.revision,inherited) : draft
        });workspace=inherited
      }
      // Every new stopped/frozen parent owns a fresh evolution baseline. A
      // professional parent may itself descend from a native recovery; copying
      // its older impact would make the next Build name its grandparent.
      if (!pending) {
        await beginProductProductionEvolutionV1({ scope:input.scope,productionId,expectedStateRevision:details.production.stateRevision,
        userText:'作者修订 AVG 系统、对白、演出和媒资，生成新预览并保留旧版本及存档',affectedLanes:['content','product','visual','audio'],...(continuationCommandId?{commandId:continuationCommandId}:{}) })
        if(continuationState)continuationState.productionRevision++
      }
      if(canonicalProductProductionJsonV2(inherited)!==canonicalProductProductionJsonV2(workspace)){
        draft=await saveAvgAuthorWorkspaceV1(input.scope,draft.revision,inherited);workspace=inherited
      }
    }
  } else {
    const created = await executeProductProductionCommand({ scope:input.scope,command:{ type:'create-intent',commandId:commandId('intent'),
      productionKey:`avg.assembly.${crypto.randomUUID()}`,productType:'avg',worldReleaseId:draft.worldReleaseId,userText:'作者组装 AVG 系统与表现' } })
    if (!created.ok) throw new Error(String(created.result.message ?? created.errorCode))
    productionId = created.productionId
    draft=await bindAvgDraftProductionV1(input.scope,draft.revision,productionId)
  }
  const details = await readProductProductionDetailsV1(input.scope,productionId,['avg'])
  if(continuationState&&(details.production.stateRevision!==continuationState.productionRevision
    ||details.build?.id!==continuationState.buildId||details.build.stateRevision!==continuationState.buildRevision))throw new Error('[avg-visual-retain] 制作方案或原版本在核对期间变化，请刷新后重试')
  const priorBrief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  if (priorBrief?.avgVisualPlanning && !visual&&!input.visualStageContinuation) throw new Error('[avg-visual-plan] 当前专业视觉方案不能按旧版组装重新解释')
  const sourceValue = priorBrief ?? await (async () => {
    const suggestions = await suggestProductStartingPoints({ scope:input.scope,worldReleaseId:draft.worldReleaseId! })
    if (!suggestions.suggestions[0]) throw new Error('[avg] 当前来源没有可用定向入口')
    return draftProductProductionBriefV3({ scope:input.scope,worldReleaseId:draft.worldReleaseId!,
      suggestionKey:suggestions.suggestions[0].suggestionKey,productType:'avg',scale:'scene',visualLevel:'none',audioLevel:'none',requiredFacts:[],forbiddenChanges:['源世界只读'] })
  })()
  const { avgVisualPlanning: _priorVisual, avgSoundPlanning: _priorSound, ...sourceBrief } = sourceValue
  const assets = workspace.presentation.stage.assets
  const baseAssembly = { schema: 'storyforge.avg.assembly-brief' as const, title: work.title,
    sceneKeys: workspace.systemPlan.scenes.map(scene => scene.key), mediaAssetKeys: runtimeMediaKeys(workspace), basePackageHash }
  const image = workspace.mediaBatch ? { mediaBatch: workspace.mediaBatch, imageBinding: imageBinding!,
    ...(recovery ? { imageRecovery: recovery } : {}), ...(workspace.imageProcessing ? { imageProcessing: workspace.imageProcessing } : {}) } : null
  const voiceAssembly = voice ? { ...baseAssembly, version: 3 as const, image,
    voice: { ...voice.voice, ...(voiceRecovery ? { recovery: voiceRecovery } : {}) } } : null
  const avgAssembly: AvgAssemblyBrief = voiceAssembly ? await encodeAvgStoredAssemblyBriefV3(voiceAssembly)
    : image ? { ...baseAssembly, version: 2, ...image } : { ...baseAssembly, version: 1 }
  let brief = parseProductProductionBriefV3({ ...sourceBrief,
    // A portable Brief retains its original hash/host IDs. A new explicit
    // child uses the registry-remapped host locator to the same frozen hash.
    source:{...sourceBrief.source,worldReleaseId:draft.worldReleaseId},
    scale:{...sourceBrief.scale,scope:'scene',targetWordCount:workspace.scripts.flatMap(script=>script.lines).reduce((sum,line)=>sum+line.text.length,0),
      targetEndingCount:workspace.systemPlan.scenes.filter(scene=>scene.kind==='ending').length},
    media:{visualLevel:assets.some(asset=>asset.mimeType.startsWith('image/'))||workspace.mediaBatch?'key-scenes':'none',audioLevel:voice||assets.some(asset=>asset.mimeType.startsWith('audio/'))?'full':'none',
      imageCount:assets.filter(asset=>asset.mimeType.startsWith('image/')).length+(workspace.mediaBatch?.requirements.length??0),musicTrackCount:assets.filter(asset=>['bgm','ambience'].includes(asset.kind)).length,
      sfxCount:assets.filter(asset=>asset.kind==='sfx').length,voiceLineCount:assets.filter(asset=>asset.kind==='voice').length
        +(voice?.voice.batch.requirements.filter(r=>!assets.some(a=>a.assetKey===r.assetKey)).length??0),
      requiredMediaKinds:[...new Set([...assets.map(asset=>asset.kind),...(workspace.mediaBatch?.requirements.map(r=>r.mediaKind)??[]),...(voice?['voice' as const]:[])])]},
    intent:{ ...sourceBrief.intent,openingSituation:'作者确认的系统、固定文本与合法媒资联合预览',coreExperience:['作者编辑、明确确认、确定性组装和试玩'] },
    ...(priorBrief?.evolution ? { evolution:priorBrief.evolution } : {}),
    avgAssembly,
    qualityProfile:'prototype',capabilityRequirements:[...(mediaCapability?[mediaCapability]:[]),...(voiceCapability?[voiceCapability]:[])],
    consultationBudget:{maximumModelCalls:0,maximumInputTokens:0,maximumOutputTokens:0,maximumCostUsd:0},
    productionBudget:voiceAssembly ? avgVoiceProductionBudgetV3(voiceAssembly) : workspace.mediaBatch ? avgVisualProductionBudgetV2(workspace.mediaBatch.requirements.length,null,recovery?.retained.length??0,workspace.imageProcessing?.entries.length??0) : { ...sourceBrief.productionBudget,maximumModelCalls:0,maximumInputTokens:100_000,maximumOutputTokens:0,maximumMediaCalls:0,
      maximumCostUsd:0,maximumDurationMs:180_000,maximumStorageBytes:64*1024*1024 },
    ...(workspace.mediaBatch || voiceAssembly ? { externalDataPolicy: { ...sourceBrief.externalDataPolicy,
      allowedDataClasses: voiceAssembly ? avgVoiceProductionDataClassesV3(voiceAssembly) : [...new Set([...sourceBrief.externalDataPolicy.allowedDataClasses, ...mediaCapability!.allowedDataClasses])],
      allowReferenceImages: workspace.mediaBatch?.requirements.some(r => r.references.length > 0) ?? false, allowVoiceScripts: !!voiceAssembly },
      fallbackPolicy: { allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' } } : {}),
    completionContract:{ requiresPlayablePreview:true,requiredGateIds:voiceAssembly ? avgVoiceAssemblyGateIdsV3(voiceAssembly) : workspace.mediaBatch ? avgMediaAssemblyGateIdsV2(workspace.mediaBatch,workspace.imageProcessing) : [...AVG_ASSEMBLY_GATE_IDS_V1],minimumMediaCoverage:1,allowSoftWaivers:false },
    unresolvedDecisionKeys:[] })
  if(visual)brief=parseProductProductionBriefV3(visual.version===5?planningServices!.completeAvgVisualPlanningBriefV5(brief,visual.configuration):planningServices!.completeAvgVisualPlanningBriefV4(brief,visual.configuration))
  if(sound)brief=soundServices!.completeAvgSoundPlanningBriefV1(brief,sound)
  const saved = await executeProductProductionCommand({ scope:input.scope,productionId,command:{ type:'save-brief-revision',commandId:commandId('brief'),
    expectedStateRevision:continuationState?.productionRevision??details.production.stateRevision,parentRevision:details.brief?.revision ?? null,brief } })
  if (!saved.ok) throw new Error(String(saved.result.message ?? saved.errorCode))
  // Persist the reviewable intent first. If the independent draft CAS fails,
  // explicit start can finish this exact saved proposal after revalidation.
  if(visual&&canonicalProductProductionJsonV2(workspace)!==canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(draft.editorJson))){
    try { await saveAvgAuthorWorkspaceV1(input.scope,draft.revision,workspace) }
    catch(cause) { throw Object.assign(new Error('[avg-visual-plan] 制作方案已保存，但消费槽草稿未保存；请刷新后重新核对方案再明确开始'), {cause}) }
  }
  return readProductProductionDetailsV1(input.scope,productionId,['avg'])
}

export async function startAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; expectedBriefHash: string }) {
  let details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const brief = details.brief ? parseProductProductionBriefV3(details.brief.briefJson) : null
  const assembly = brief?.avgAssembly ?? brief?.avgVisualPlanning?.assembly ?? brief?.avgSoundPlanning?.assembly
  if (!brief || !assembly || details.brief!.briefHash !== input.expectedBriefHash) throw new Error('[avg] 制作方案已变化，请重新核对')
  if(brief.avgVisualPlanning?.version===5&&!avgVisualPlanningExecutionReadyV5())throw new Error('[avg] 新版参考媒资工作台尚未开放')
  const draft=await readAvgDraftV1(input.scope)
  let workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
  if (workspace.soundProduction && !brief.avgSoundPlanning) throw new Error('[avg-sound] 已保存声音需求尚未包含在本方案中，请重新准备制作方案')
  if (brief.avgVisualPlanning) {
    if(details.build&&details.build.briefRevision!==details.brief!.revision)await assertAvgVisualPlanningRestartKnownV4(input.scope,details.build)
    const sources=await import('./visual-planning-scope-draft'),services=await import('./visual-planning-workspace')
    if(brief.avgVisualPlanning.version===5){
      const {sourceInputHash:_hash,aspectRatio:_ratio,...planning}=brief.avgVisualPlanning.scope
      workspace=(await sources.prepareAvgVisualPlanningSourceDraftV5({workspace,planning,previous:unstartedAvgVisualPlanningScopesV5(details)})).workspace
      await services.assertAvgVisualPlanningDraftMatchesV5(input.scope,workspace,brief)
    }else{
    const {sourceInputHash:_hash,aspectRatio:_ratio,...planning}=brief.avgVisualPlanning.scope
    workspace=(await(await import('./visual-planning-scope-draft')).prepareAvgVisualPlanningSourceDraftV4({workspace,planning,previous:unstartedAvgVisualPlanningScopes(details)})).workspace
    await (await import('./visual-planning-workspace')).assertAvgVisualPlanningDraftMatchesV4(input.scope,workspace,brief)
    await (await import('./visual-planning-reuse-workspace')).assertAvgVisualProposalReuseSourcesV4(input.scope,input.productionId,brief,
      1+Math.max(0,...details.buildHistory.map(b=>b.buildNumber)))
    await (await import('./visual-image-reuse-workspace')).assertAvgVisualRawReuseSourcesV4(input.scope,input.productionId,brief,
      1+Math.max(0,...details.buildHistory.map(b=>b.buildNumber)))
    }
  }
  if (workspace.voiceProduction && assembly.version !== 3) throw new Error('[avg-voice] 草稿已包含配音批次，请重新准备匹配的制作方案')
  if (assembly.version === 3) {
    if (!avgVoiceProductionEnabledV3() || !avgMediaProductionEnabledV2()) throw new Error('[avg-voice] 配音生产尚未开放')
    if (!workspace.voiceProduction) throw new Error('[avg-voice] 草稿缺少冻结的准确配音批次')
    const draftVoice = await validateAvgVoiceDraftSourcesV1(workspace.voiceProduction, workspace)
    const storedVoice = await assertAvgStoredAssemblyBriefV3(assembly)
    if (await hashAvgVoiceDeclarationForRecoveryV1(draftVoice.voice) !== await hashAvgVoiceDeclarationForRecoveryV1(storedVoice.assembly.voice)) throw new Error('[avg-voice] 配音批次、音色、演法或路由已变化，请重新核对制作方案')
    await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: input.productionId, brief })
  }
  const image = readAvgOptionalImageDefinitionV3(brief)
  if (workspace.mediaBatch && !image) throw new Error('[avg-media] 草稿已包含待生成媒资批次，请重新准备匹配的制作方案')
  if (image) {
    if(!avgMediaProductionEnabledV2())throw new Error('[avg-media] 实验性图片生产尚未启用')
    if (canonicalProductProductionJsonV2(workspace.mediaBatch ?? null) !== canonicalProductProductionJsonV2(image.mediaBatch)) throw new Error('[avg-media] 媒资批次已变化，请重新核对制作方案')
    if (canonicalProductProductionJsonV2(workspace.imageProcessing ?? null) !== canonicalProductProductionJsonV2(image.imageProcessing ?? null)) throw new Error('[avg-process] 加工草稿与冻结方案不一致，请重新核对')
    await validateAvgVisualProductionBatchSourceV1(image.mediaBatch, workspace)
    assertAvgMediaConsumerDeclarationsV1(image.mediaBatch, workspace.systemPlan)
    await validateAvgImageRecoveryV1({scope:input.scope,productionId:input.productionId,brief})
    for(const r of image.mediaBatch.requirements)await validateAvgGeneratedReferencesV1(input.scope,r.references,r.family)
  }
  const same=(a:string[],b:string[])=>canonicalProductProductionJsonV2([...a].sort())===canonicalProductProductionJsonV2([...b].sort())
  if(draft.productionId!==input.productionId||draft.worldReleaseId!==brief.source.worldReleaseId
    ||!same(assembly.sceneKeys,workspace.systemPlan.scenes.map(scene=>scene.key))
    ||!same(assembly.mediaAssetKeys,[...new Set([...runtimeMediaKeys(workspace),...(brief.avgVisualPlanning?.scope.templates.filter(t=>t.parameters.consumer.domain!=='reference').map(t=>t.parameters.assetKey)??[]),...(brief.avgSoundPlanning?.scope.templates.map(t=>t.assetKey)??[])])])) throw new Error('[avg] 场景、媒资或来源清单已变化，请重新准备制作方案')
  if (assembly.basePackageHash !== await expectedBaselinePackageHash(details)) throw new Error('[avg] 组装修订基线与实际 Build 谱系不一致，请重新准备方案')
  const execution = await assemblyExecutionOptions(input.scope, brief, input.productionId)
  if(brief.avgVisualPlanning&&canonicalProductProductionJsonV2(workspace)!==canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(draft.editorJson))){
    await saveAvgAuthorWorkspaceV1(input.scope,draft.revision,workspace)
  }
  await authorizeProductProductionStartV1({ scope:input.scope,details })
  details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  // Freezes the real shared Plan/root and waits for manual inputs; never runs a provider.
  await runProductProductionSchedulerCycleV1({ scope:input.scope,productionId:input.productionId,
    ...execution, executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief,...execution }) })
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}

/** Staging and confirmation are separate UI actions; payload is always from a saved draft. */
export async function stageAvgWorkspaceInputV1(input: { scope: WorkspaceScope; productionId: number; expectedDraftRevision: number; artifactKey: string; declaration: string }) {
  const draft = await readAvgDraftV1(input.scope)
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId) throw new Error('[avg] 草稿或制作指针已变化')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (!details.build || !details.executionBrief?.avgAssembly&&!details.executionBrief?.avgVisualPlanning&&!details.executionBrief?.avgSoundPlanning) throw new Error('[avg] 请先明确开始作者组装')
  if (details.executionBrief?.avgSoundPlanning && !avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 正式声音工作流尚未开放')
  const plan = JSON.parse(details.build.planJson) as { tasks:Array<{taskKey:string;outputArtifactKeys:string[]}> }
  const task = plan.tasks.find(task=>task.outputArtifactKeys.includes(input.artifactKey))
  if (!task) throw new Error('[avg] 输入不在冻结写域')
  const payload = input.artifactKey === 'avg.system.plan' ? workspace.systemPlan : input.artifactKey === 'avg.author.stage' ? workspace.presentation
    : workspace.scripts.find(script=>`avg.content.scene-script.${script.sceneKey}` === input.artifactKey)
  if (!payload) throw new Error('[avg] 已保存草稿中不存在该输入')
  return stageAvgAuthorArtifactV1({ scope:input.scope,buildId:details.build.id!,expectedBuildRevision:details.build.stateRevision,
    controlEpoch:details.build.controlEpoch,taskKey:task.taskKey,artifactKey:input.artifactKey,
    kind:input.artifactKey === 'avg.system.plan' ? 'product-module' : input.artifactKey === 'avg.author.stage' ? 'presentation' : 'narrative',payload,declaration:input.declaration })
}

export async function runAvgAssemblyV1(input: { scope: WorkspaceScope; productionId: number; signal?: AbortSignal }) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if (details.executionBrief?.avgSoundPlanning) return (await import('./sound-production-service')).runAvgSoundProductionV1({
    ...input, expectedBuildId: details.build?.id,
  })
  if (!details.executionBrief?.avgAssembly&&!details.executionBrief?.avgVisualPlanning || !details.build || !['authorized','building','integrating'].includes(details.build.status)) throw new Error('[avg] 当前 Build 不可组装')
  const execution = await assemblyExecutionOptions(input.scope, details.executionBrief, input.productionId, details.build.id!)
  return runProductProductionUntilBlockedV1({ ...input, ...execution, executor:createConfiguredProductProductionExecutorV1({ production:details.production,brief:details.executionBrief,...execution }) })
}

/** Creates a reviewable child Brief only. Start, each choice and stage adoption
 * remain separate. Retained rows never become fake imported-media entries. */
export async function prepareAvgImageRecoveryBriefV1(input:{scope:WorkspaceScope;productionId:number;expectedDraftRevision:number;expectedBuildId:number;
  expectedBuildRevision:number;retainedRequirementKeys:string[];declaration:string}){
  const draft=await readAvgDraftV1(input.scope),details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId||details.build?.id!==input.expectedBuildId)throw new Error('[avg-media] 恢复草稿或当前 Build 已变化')
  if (details.executionBrief?.avgAssembly?.version === 3) throw new Error('[avg-voice] 联合图音恢复须明确逐句配音和图片各自的保留或重做集合')
  const {recovery}=await prepareAvgImageRecoveryV1(input)
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision,imageRecovery:recovery})
}

/** One reviewable recovery proposal. Both media lanes must be explicit in a
 * mixed batch, so a voice-only edit cannot silently regenerate paid images. */
export async function prepareAvgVoiceRecoveryBriefV1(input: {
  scope: WorkspaceScope; productionId: number; expectedDraftRevision: number; expectedBuildId: number
  expectedBuildRevision: number; retainedRequirementKeys: string[]; retainedImageRequirementKeys?: string[]; declaration: string
}) {
  const draft = await readAvgDraftV1(input.scope), details = await readProductProductionDetailsV1(input.scope, input.productionId, ['avg'])
  if (draft.revision !== input.expectedDraftRevision || draft.productionId !== input.productionId || details.build?.id !== input.expectedBuildId) throw new Error('[avg-voice] 恢复草稿或当前配音版本已变化')
  const { recovery, sourceBrief } = await prepareAvgVoiceRecoveryV1(input)
  const image = readAvgOptionalImageDefinitionV3(sourceBrief)
  if (image && input.retainedImageRequirementKeys === undefined || !image && input.retainedImageRequirementKeys?.length) {
    throw new Error('[avg-voice] 请明确本次联合恢复的图片保留或全部重做选择')
  }
  const imageRecovery = input.retainedImageRequirementKeys?.length
    ? (await prepareAvgImageRecoveryV1({ ...input, retainedRequirementKeys: input.retainedImageRequirementKeys })).recovery : undefined
  return prepareAvgAssemblyBriefV1({ scope: input.scope, expectedDraftRevision: input.expectedDraftRevision,
    voiceRecovery: recovery, ...(imageRecovery ? { imageRecovery } : {}) })
}

/** Explicit restart for unsealed attempts; the old Run, inputs and failures remain. */
export async function restartAvgAssemblyFromDraftV1(input: { scope: WorkspaceScope; productionId: number; expectedBuildId: number; expectedDraftRevision: number }) {
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId)throw new Error('[avg] 编辑草稿或制作指针已变化')
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  if(!details.executionBrief?.avgAssembly||details.build?.id!==input.expectedBuildId||details.build.previewHash)throw new Error('[avg] 当前版本不能按未封存组装重建')
  if(!['cancelled','failed'].includes(details.build.status))await stopProductProductionV1({scope:input.scope,production:details.production})
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision})
}

/** A new reviewable, explicitly versioned Brief in the same Work/Production. No old candidate,
 * Run or bill is changed and no request is dispatched. Explicit start and
 * every current-version adoption remain separate actions. */
type VisualRestartInput={scope:WorkspaceScope;productionId:number;expectedBuildId:number;expectedBuildRevision:number;expectedDraftRevision:number}
export async function restartAvgVisualPlanningFromDraftV4(input:VisualRestartInput){return restartVisualPlanning(input,4)}
export async function restartAvgVisualPlanningFromDraftV5(input:VisualRestartInput){return restartVisualPlanning(input,5)}
async function restartVisualPlanning(input:VisualRestartInput,version:4|5){
  const draft=await readAvgDraftV1(input.scope),details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const build=details.build,planning=details.executionBrief?.avgVisualPlanning
  if(draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId||!build?.id||planning?.version!==version
    ||build.id!==input.expectedBuildId||build.stateRevision!==input.expectedBuildRevision||build.previewHash
    ||!['cancelled','failed','recovery-required'].includes(build.status)
    ||details.production.status==='brief-ready')throw new Error('[avg-visual-restart] 当前失败版本或草稿已变化，请重新核对')
  const {sourceInputHash:_hash,aspectRatio:_ratio,...scope}=planning.scope
  return prepareAvgAssemblyBriefV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision,visualPlanning:scope})
}
