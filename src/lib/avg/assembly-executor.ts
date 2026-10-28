import { db } from '../db/schema'
import type { ProductBuildQualityReportV1, ProductProductionBriefV3, ProductProductionRecordV1 } from '../types'
import type { ProductProductionTaskArtifactV1, ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import { ProductProductionDraftRejectedErrorV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductRuntimePackageV2 } from '../product-production/runtime-package'
import { AVG_ASSEMBLY_GATE_IDS_V1, avgMediaAssemblyGateIdsV2 } from './assembly-contract'
import { compileAdoptedAvgBuildV2 } from './executable-compiler'
import { executeAvgMediaImageTaskV2 } from './media-production-executor'
import { executeAvgImageRecoveryTaskV1 } from './media-recovery-executor'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { readAvgInheritedStageImagesV1 } from './stage-image-sources'
import { readAvgInheritedStageVoicesV1 } from './stage-voice-sources'
import { readAvgInheritedStageSoundsV1 } from './stage-sound-sources'
import { assertAvgSoundPrototypeWriteEnabledV1 } from './prototype-contract'
import { executeAvgImageProcessingTaskV1 } from './image-processing-executor'
import { executeAvgVoiceTaskV3 } from './voice-production-executor'
import type { createConfiguredAvgVoiceTransportV1 } from './voice-transport'
import { parseAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { avgVoiceAssemblyGateIdsV3 } from './voice-assembly-contract'
import { readAvgOptionalImageDefinitionV3 } from './media-production-definition'
import { executeAvgVoiceRecoveryTaskV1 } from './voice-recovery-executor'
import { avgAssemblyMediaRightsV1 } from './assembly-media-rights'
import { readAvgCurrentImageConsumptionDefinition,readAvgCurrentCompiledImageDefinition } from './current-image-consumption'
import { assertAvgTaskHarnessClaimV1, hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief'
import { readAvgSoundPlanningExecutionSourcesV1 } from './sound-planning-task-source'
import { avgAudioProcessingExecutionReadyV1, avgAudioProcessingForVoiceV3, avgAudioProcessingGateIdsV1 } from './audio-production-brief'

/** V1 remains zero-provider. Opt-in V2 image tasks use the media Harness;
 * human choices/stage stay separate from deterministic package compilation. */
export function createAvgAssemblyExecutorV1(options: { production: ProductProductionRecordV1; brief: ProductProductionBriefV3;
  mediaCapabilities?: ReadonlyMap<string, ResolvedProductMediaCapabilityV1>; imageEndpointRouteHash?: string;
  voiceTransport?: Awaited<ReturnType<typeof createConfiguredAvgVoiceTransportV1>> }): ProductProductionTaskExecutorV1 {
  const brief = structuredClone(options.brief), productionKey = options.production.productionKey
  if (brief.avgAudioProcessing && !avgAudioProcessingExecutionReadyV1()) throw new Error('[avg-audio-process] 正式音频加工尚未就绪，不能借用旧组装执行器')
  if (brief.avgSoundPlanning && !avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音完整工作流尚未开放，不能借用旧组装执行器')
  const legacyImage = readAvgOptionalImageDefinitionV3(brief)
  const assembly=brief.avgAssembly??brief.avgVisualPlanning?.assembly??brief.avgSoundPlanning?.assembly
  return async request => {
    const startedAt = Date.now()
    if (request.signal.aborted) throw new DOMException('Aborted','AbortError')
    if (request.task.kind === 'avg-audio-process') return (await import('./audio-processing-executor')).executeAvgAudioProcessingTaskV1(request, brief)
    const image=brief.avgVisualPlanning?await readAvgCurrentImageConsumptionDefinition({scope:request.scope,buildId:request.buildId,brief}):legacyImage
    if (brief.avgAssembly?.version === 3 && request.task.kind === 'avg-media-voice-reuse') {
      return executeAvgVoiceRecoveryTaskV1(request, { ...brief, avgAssembly: brief.avgAssembly })
    }
    if (brief.avgAssembly?.version === 3 && request.task.kind === 'avg-media-voice-generate') {
      if (!options.voiceTransport) throw new ProductProductionDraftRejectedErrorV1('[avg-voice] 当前执行缺少明确配置的配音路由，未发送请求',
        { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: Date.now() - startedAt, storageBytes: 0 })
      return executeAvgVoiceTaskV3(request, { brief: { ...brief, avgAssembly: brief.avgAssembly }, transport: options.voiceTransport })
    }
    if(brief.avgVisualPlanning?.version===5&&['avg-media-image-process','avg-media-image-reuse','avg-media-image-generate'].includes(request.task.kind))throw new Error('[avg-media] 新图片必须使用准确版本的原始执行器；加工与恢复尚未接通')
    if(image&&request.task.kind==='avg-media-image-process')return executeAvgImageProcessingTaskV1(request,brief)
    if(image&&request.task.kind==='avg-media-image-reuse')return executeAvgImageRecoveryTaskV1(request,brief)
    if (image && request.task.kind === 'avg-media-image-generate') return executeAvgMediaImageTaskV2(request, {
      brief, mediaCapabilities: options.mediaCapabilities ?? new Map(), imageEndpointRouteHash: options.imageEndpointRouteHash,
    })
    if (!assembly || request.task.executionMode !== 'deterministic'
      || !['avg.assembly.integrate','avg.assembly.verify'].includes(request.task.taskKey)) throw new Error('[avg] 作者输入尚未确认或执行任务超出冻结组装域')
    const build = await db.productBuilds.get(request.buildId)
    if (!build || !await assertRecordInScope(request.scope,'productBuilds',build,{ owner:'work' })
      || build.controlEpoch !== request.controlEpoch || build.planHash !== request.planHash
      || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg] 组装执行来源已 stale')
    if(brief.avgVisualPlanning || brief.avgSoundPlanning){
      const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash),task=plan.tasks.find(t=>t.taskKey===request.task.taskKey)
      const claim=await assertAvgTaskHarnessClaimV1(request,build.budgetLedgerJson)
      if(canonicalProductProductionJsonV2(task)!==canonicalProductProductionJsonV2(request.task)
        ||claim.child.contract.runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1(request))throw new Error('[avg-visual-image] 组装不属于准确冻结任务与实际 Harness claim')
    }
    if (brief.avgSoundPlanning) await readAvgSoundPlanningExecutionSourcesV1(request, brief)
    const compiled = await compileAdoptedAvgBuildV2({ scope:request.scope,buildId:request.buildId,controlEpoch:request.controlEpoch,
      expectedBuildRevision:build.stateRevision,product:{ key:productionKey,title:assembly.title,description:brief.intent.openingSituation } })
    const pkg = compiled.runtimePackage, module = pkg.modules.find(row => row.version === 2)!
    if (module.version !== 2) throw new Error('[avg] 组装缺少原生模块')
    const assets = module.stage.assets
    const inherited=await readAvgInheritedStageImagesV1({scope:request.scope,payload:compiled.source.authorStage!.payload,productionKey,
      targetBuildNumber:build.buildNumber,worldContentHash:brief.source.worldContentHash})
    const inheritedVoices = await readAvgInheritedStageVoicesV1({ scope: request.scope, payload: compiled.source.authorStage!.payload,
      scripts: compiled.source.scripts.map(script => script.payload), productionKey,
      targetBuildNumber: build.buildNumber, worldContentHash: brief.source.worldContentHash })
    for (const [key, voice] of inheritedVoices) {
      if (inherited.has(key)) throw new Error('[avg-voice] 图片与配音不能声明同一沿用身份')
      inherited.set(key, voice)
    }
    if (compiled.source.authorStage!.payload.inheritedSounds?.length) assertAvgSoundPrototypeWriteEnabledV1()
    const inheritedSounds = await readAvgInheritedStageSoundsV1({ scope: request.scope, payload: compiled.source.authorStage!.payload,
      scripts: compiled.source.scripts.map(script => script.payload), productionKey,
      targetBuildNumber: build.buildNumber, worldContentHash: brief.source.worldContentHash })
    for (const [key, sound] of inheritedSounds) {
      if (inherited.has(key)) throw new Error('[avg-sound] 不同媒资不能声明同一沿用身份')
      inherited.set(key, sound)
    }
    const expectedKeys = assembly.mediaAssetKeys
    if (assets.length !== expectedKeys.length || expectedKeys.some(key => !assets.some(asset => asset.assetKey === key))) throw new Error('[avg] 组装媒体目录超出冻结 Brief')
    const packageHash = await hashProductProductionValueV2(pkg)
    const visual=brief.avgVisualPlanning?await readAvgCurrentCompiledImageDefinition({scope:request.scope,buildId:request.buildId,
      expectedBuildRevision:build.stateRevision,controlEpoch:request.controlEpoch,expectedBrief:brief,purpose:'assembly'}):null
    const sourceProof = { rule:compiled.source.artifact,ruleReceipt:compiled.source.authorReceiptHash,
      ...(visual?{visualPlanning:{compilation:visual.definition.compilation,scopeHash:await hashProductProductionValueV2(visual.planning.scope),
        adopted:visual.visual.map(row=>({artifact:row.artifact,authorReceiptHash:row.authorReceiptHash}))}}:{}),
      scripts:compiled.source.scripts.map(row => ({ artifact:row.artifact,receiptHash:row.authorReceiptHash })),
      stage:compiled.source.authorStage!.artifact,stageReceipt:compiled.source.authorStage!.authorReceiptHash,
      ...(image ? { mediaChoices: (compiled.source.mediaChoices ?? []).map(choice => ({
        choice: choice.artifact, authorReceiptHash: choice.authorReceiptHash, raw: { artifactKey: choice.raw.artifactKey,
          version: choice.raw.version, contentHash: choice.raw.contentHash }, rawReceiptHash: choice.raw.producerReceiptHash,
        ...(choice.processed?{processing:{artifact:{artifactKey:choice.processed.row.artifactKey,version:choice.processed.row.version,contentHash:choice.processed.row.contentHash},producerReceiptHash:choice.processed.row.producerReceiptHash,processingReceiptHash:choice.processed.payload.receipt.receiptHash}}:{}),
        ...(choice.review?{visualReview:{artifact:choice.review.artifact,authorReceiptHash:choice.review.authorReceiptHash}}:{}) })) } : {}),
      ...(assembly.version === 3 ? { voiceChoices: (compiled.source.voiceChoices ?? []).map(choice => ({
        choice: choice.artifact, authorReceiptHash: choice.authorReceiptHash,
        raw: { artifactKey: choice.raw.artifactKey, version: choice.raw.version, contentHash: choice.raw.contentHash },
        rawProducerReceiptHash: choice.raw.producerReceiptHash,
        responseEvidenceHash: choice.validation.version === 2 ? choice.validation.original.responseEvidenceHash : choice.validation.responseEvidenceHash,
        ...(choice.processed && choice.validation.version === 2 ? { processing: {
          artifact: choice.validation.processed, producerReceiptHash: choice.processed.producerReceiptHash,
          processingReceiptHash: choice.validation.processingReceiptHash, recipeHash: choice.validation.recipeHash,
        } } : {}),
        requestIdentityHash: choice.payload.requestIdentityHash,
        audioReview: { artifact: choice.review.artifact, authorReceiptHash: choice.review.authorReceiptHash } })) } : {}),
      ...(brief.avgSoundPlanning ? { ...(compiled.source.soundPlan ? { soundPlan: compiled.source.soundPlan } : {}),
        soundChoices: (compiled.source.soundChoices ?? []).map(choice => ({ choice: choice.artifact, authorReceiptHash: choice.authorReceiptHash,
          raw: { artifactKey: choice.raw.artifactKey, version: choice.raw.version, contentHash: choice.raw.contentHash },
          rawProducerReceiptHash: choice.raw.producerReceiptHash, responseEvidenceHash: choice.validation.responseEvidenceHash,
          requestSnapshotHash: choice.validation.requestSnapshotHash, requestIdentityHash: choice.payload.requestIdentityHash,
          compiled: choice.validation.compiled, rightsHash: choice.validation.rightsHash,
          audioReview: { artifact: choice.review.artifact, authorReceiptHash: choice.review.authorReceiptHash } })) } : {}),
      sourceContextHash:await hashProductProductionValueV2(request.contextText) }
    let artifacts: ProductProductionTaskArtifactV1[]
    if (request.task.taskKey === 'avg.assembly.integrate') {
      if (!request.contextText.trim()) throw new Error('[avg] 缺少实际冻结来源读取证据')
      artifacts = [{ artifactKey:'runtime.package',kind:'presentation',payload:pkg,quality:sourceProof,
        rights:{ origin:'author-assembly',mediaLicenses:assets.map(asset => ({ assetKey:asset.assetKey,license:asset.license,source:asset.source })) } }]
      for (const [index,key] of expectedKeys.entries()) {
        const asset = assets.find(asset => asset.assetKey === key)!
        const rows = await db.avgDraftMedia.where('workId').equals(request.scope.workId)
          .filter(row => canonicalProductProductionJsonV2(JSON.parse(row.assetJson)) === canonicalProductProductionJsonV2(asset)).limit(2).toArray()
        const choice = compiled.source.mediaChoices?.find(choice => !choice.payload.referenceOnly && choice.payload.asset.assetKey === key)
        const voiceChoice = compiled.source.voiceChoices?.find(choice => choice.payload.asset.assetKey === key)
        const soundChoice = compiled.source.soundChoices?.find(choice => choice.payload.asset.assetKey === key)
        const retained=inherited.get(key)
        if ([!!choice,!!voiceChoice,!!soundChoice,!!retained].filter(Boolean).length > 1)throw new Error('[avg-media] 本批生成媒资与其他采用来源冲突')
        if (choice||voiceChoice||soundChoice||retained ? rows.length > 0 || canonicalProductProductionJsonV2(choice?.payload.asset??voiceChoice?.payload.asset??soundChoice?.payload.asset??retained!.asset) !== canonicalProductProductionJsonV2(asset)
          : rows.length !== 1 || !await assertRecordInScope(request.scope,'avgDraftMedia',rows[0]!,{owner:'work'})) throw new Error('[avg] 正式组装素材引用已变化')
        artifacts.push({ artifactKey:`avg.media.${index}`,kind:asset.mimeType.startsWith('audio/')?'audio':'image',mediaKind:asset.kind,
          payload:{ assetKey:asset.assetKey },metadata:asset,quality:{ actualBytesAndDecoderVerified:true,stageReceipt:sourceProof.stageReceipt },
          rights:avgAssemblyMediaRightsV1(compiled.source,asset),
          contentHash:asset.contentHash,blobObjectId:choice?.image.blobObjectId ?? voiceChoice?.blobObjectId ?? soundChoice?.blobObjectId ?? retained?.blobObjectId ?? rows[0]!.blobObjectId,mimeType:asset.mimeType,byteSize:asset.byteSize })
      }
    } else {
      const actual = request.inputArtifacts.find(row => row.artifactKey === 'runtime.package')
      if (!actual || await hashProductProductionValueV2(parseProductRuntimePackageV2(actual.payloadJson)) !== packageHash
        || actual.contentHash !== packageHash) throw new Error('[avg] 质量校验包与当前正式采用来源不一致')
      for (const [index,key] of expectedKeys.entries()) {
        const asset = assets.find(asset => asset.assetKey === key)!, artifact = request.inputArtifacts.find(row => row.artifactKey === `avg.media.${index}`)
        if (!artifact?.blobObjectId || artifact.contentHash !== asset.contentHash || artifact.mimeType !== asset.mimeType
          || artifact.byteSize !== asset.byteSize || canonicalProductProductionJsonV2(JSON.parse(artifact.metadataJson)) !== canonicalProductProductionJsonV2(asset)) throw new Error('[avg] 质量校验缺少准确媒体 Artifact')
      }
      const usedAssets=new Set([...module.stage.cues.flatMap(cue=>cue.assetKey?[cue.assetKey]:[]),...(module.reading?.voices.map(voice=>voice.assetKey)??[]),
        ...(module.systemPlan.version===2?module.systemPlan.inventory.items.flatMap(item=>[item,...item.variants].flatMap(view=>[view.iconAssetKey,view.detailAssetKey].filter((key):key is string=>key!==null))):[])])
      const unused=assets.filter(asset=>!usedAssets.has(asset.assetKey))
      const report: ProductBuildQualityReportV1 = { schema:'storyforge.product-build-quality-report',version:1,buildNumber:request.buildNumber,packageHash,
        hardGateResults:(brief.avgVisualPlanning || brief.avgSoundPlanning?request.task.acceptanceGateIds:assembly.version === 3 ? [...avgVoiceAssemblyGateIdsV3(parseAvgStoredAssemblyBriefV3(assembly).assembly),
          ...(brief.avgAudioProcessing ? avgAudioProcessingGateIdsV1(avgAudioProcessingForVoiceV3(brief.avgAudioProcessing, parseAvgStoredAssemblyBriefV3(assembly).assembly)) : [])]
          : assembly.version === 2 ? avgMediaAssemblyGateIdsV2(assembly.mediaBatch,assembly.imageProcessing) : AVG_ASSEMBLY_GATE_IDS_V1)
          .map(gateId => ({ gateId,passed:true,evidence:[canonicalProductProductionJsonV2(sourceProof)] })),
        softGateResults:[],mediaCoverage:assets.length?(assets.length-unused.length)/assets.length:1,playable:true,releaseReady:false,
        warnings:['仅通过作者组装技术门；艺术、专业配音、整部作品试玩与发布验收尚待执行。',...(compiled.source.mediaChoices??[]).flatMap(choice=>choice.review?.payload.issues.map(issue=>`作者视觉问题 ${issue.severity} · ${choice.payload.requirementKey}：${issue.evidence}`)??[]),
          ...(compiled.source.voiceChoices??[]).flatMap(choice=>choice.review.payload.issues.map(issue=>`作者审听问题 ${issue.severity} · ${choice.payload.requirementKey}：${issue.evidence}`)),
          ...(compiled.source.soundChoices??[]).flatMap(choice=>choice.review.payload.issues.map(issue=>`作者声音问题 ${issue.severity} · ${choice.payload.requirementKey}：${issue.evidence}`)),...unused.map(asset=>`素材尚未绑定演出、配音或物件消费者：${asset.name}`)] }
      artifacts = [{ artifactKey:'quality.report',kind:'quality-report',payload:report,quality:{ scope:'author-assembly-technical' },rights:{ origin:'deterministic-verification' } }]
    }
    if (request.signal.aborted) throw new DOMException('Aborted','AbortError')
    return { artifacts,passedGateIds:[...request.task.acceptanceGateIds],usage:{ modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,
      durationMs:Date.now()-startedAt,storageBytes:artifacts.reduce((sum,row) => sum+new TextEncoder().encode(canonicalProductProductionJsonV2(row.payload)).byteLength,0) } }
  }
}
