import { db } from '../db/schema'
import type { ProductBuildQualityReportV1, ProductProductionBriefV3, ProductProductionRecordV1 } from '../types'
import type { ProductProductionTaskArtifactV1, ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductRuntimePackageV2 } from '../product-production/runtime-package'
import { AVG_ASSEMBLY_GATE_IDS_V1 } from './assembly-contract'
import { compileAdoptedAvgBuildV2 } from './executable-compiler'

/** Zero-provider deterministic tasks. Human rows are confirmed through the
 * registered author command, then receive the shared scheduler's carry receipt. */
export function createAvgAssemblyExecutorV1(options: { production: ProductProductionRecordV1; brief: ProductProductionBriefV3 }): ProductProductionTaskExecutorV1 {
  const brief = structuredClone(options.brief), productionKey = options.production.productionKey
  return async request => {
    const startedAt = Date.now()
    if (request.signal.aborted) throw new DOMException('Aborted','AbortError')
    if (!brief.avgAssembly || request.task.executionMode !== 'deterministic'
      || !['avg.assembly.integrate','avg.assembly.verify'].includes(request.task.taskKey)) throw new Error('[avg] 作者输入尚未确认或执行任务超出冻结组装域')
    const build = await db.productBuilds.get(request.buildId)
    if (!build || !await assertRecordInScope(request.scope,'productBuilds',build,{ owner:'work' })
      || build.controlEpoch !== request.controlEpoch || build.planHash !== request.planHash
      || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg] 组装执行来源已 stale')
    const compiled = await compileAdoptedAvgBuildV2({ scope:request.scope,buildId:request.buildId,controlEpoch:request.controlEpoch,
      expectedBuildRevision:build.stateRevision,product:{ key:productionKey,title:brief.avgAssembly.title,description:brief.intent.openingSituation } })
    const pkg = compiled.runtimePackage, module = pkg.modules.find(row => row.version === 2)!
    if (module.version !== 2) throw new Error('[avg] 组装缺少原生模块')
    const assets = module.stage.assets
    const expectedKeys = brief.avgAssembly.mediaAssetKeys
    if (assets.length !== expectedKeys.length || expectedKeys.some(key => !assets.some(asset => asset.assetKey === key))) throw new Error('[avg] 组装媒体目录超出冻结 Brief')
    const packageHash = await hashProductProductionValueV2(pkg)
    const sourceProof = { rule:compiled.source.artifact,ruleReceipt:compiled.source.authorReceiptHash,
      scripts:compiled.source.scripts.map(row => ({ artifact:row.artifact,receiptHash:row.authorReceiptHash })),
      stage:compiled.source.authorStage!.artifact,stageReceipt:compiled.source.authorStage!.authorReceiptHash,
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
        if (rows.length !== 1 || !await assertRecordInScope(request.scope,'avgDraftMedia',rows[0]!,{owner:'work'})) throw new Error('[avg] 正式组装素材引用已变化')
        artifacts.push({ artifactKey:`avg.media.${index}`,kind:asset.mimeType.startsWith('audio/')?'audio':'image',mediaKind:asset.kind,
          payload:{ assetKey:asset.assetKey },metadata:asset,quality:{ actualBytesAndDecoderVerified:true,stageReceipt:sourceProof.stageReceipt },
          rights:{ origin:'author-import',license:asset.license,source:asset.source,authorStageReceipt:sourceProof.stageReceipt },
          contentHash:asset.contentHash,blobObjectId:rows[0]!.blobObjectId,mimeType:asset.mimeType,byteSize:asset.byteSize })
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
        hardGateResults:AVG_ASSEMBLY_GATE_IDS_V1.map(gateId => ({ gateId,passed:true,evidence:[canonicalProductProductionJsonV2(sourceProof)] })),
        softGateResults:[],mediaCoverage:assets.length?(assets.length-unused.length)/assets.length:1,playable:true,releaseReady:false,
        warnings:['仅通过作者组装技术门；艺术、专业配音、整部作品试玩与发布验收尚待执行。',...unused.map(asset=>`素材尚未绑定演出、配音或物件消费者：${asset.name}`)] }
      artifacts = [{ artifactKey:'quality.report',kind:'quality-report',payload:report,quality:{ scope:'author-assembly-technical' },rights:{ origin:'deterministic-verification' } }]
    }
    if (request.signal.aborted) throw new DOMException('Aborted','AbortError')
    return { artifacts,passedGateIds:[...request.task.acceptanceGateIds],usage:{ modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,
      durationMs:Date.now()-startedAt,storageBytes:artifacts.reduce((sum,row) => sum+new TextEncoder().encode(canonicalProductProductionJsonV2(row.payload)).byteLength,0) } }
  }
}
