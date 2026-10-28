import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { putMediaBlobObject, readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { assertAvgRawImageOriginV1 } from './media-recovery'
import { processAvgImageBytesV1,processAvgImageBytesV2 } from './image-processing'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'
import { parseAvgProcessedImagePayload } from './image-processing-contract-v2'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'

export async function executeAvgImageProcessingTaskV1(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    const {assembly:a}=await assertAvgImageProductionDefinitionV3(brief),entry=a.imageProcessing?.entries.find(e=>input.task.taskKey===`avg.media.process.${e.requirementKey}`)
    const build=await db.productBuilds.get(input.buildId),source=input.inputArtifacts[0],task=input.task
    if(!entry||!build||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'})||build.controlEpoch!==input.controlEpoch
      ||build.planHash!==input.planHash||build.briefHash!==await hashProductProductionValueV2(brief)||!['building','integrating'].includes(build.status)
      ||!source||input.inputArtifacts.length!==1||source.artifactKey!==`avg.media.raw.${entry.requirementKey}`||!input.taskRunId
      ||task.kind!=='avg-media-image-process'||task.executionMode!=='deterministic'||task.skillId!==null||task.maxAttempts!==1||input.attempt!==1
      ||task.budgetReservation.mediaCalls!==0||task.budgetReservation.modelCalls!==0||task.outputArtifactKeys.length!==1||task.outputArtifactKeys[0]!==avgProcessedImageArtifactKeyV1(entry.requirementKey))throw new Error('[avg-process] 加工任务不属于准确的有界原生 Plan')
    const readRaw=async()=>{
      const raw=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,artifactKey:source.artifactKey,version:source.version,contentHash:source.contentHash})
      if(raw.controlEpoch!==input.controlEpoch)throw new Error('[avg-process] 原图控制版本已变化')
      await assertAvgRawImageOriginV1({scope:input.scope,productionId:build.productionId,brief,build,artifact:raw,requirementKey:entry.requirementKey,taskKey:`avg.media.generate.${entry.requirementKey}`},[build.buildNumber])
      return {row:raw,...await assertAvgRawImageArtifactV1(brief,raw)}
    }
    const raw=await readRaw(),blob=raw.row.blobObjectId===null?null:await db.mediaBlobObjects.get(raw.row.blobObjectId)
    if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==raw.asset.contentHash)throw new Error('[avg-process] 原图字节缺失或跨作品')
    if(entry.recipe.version===3)throw new Error('[avg-composite] 旧制作执行器不能解释双输入局部合成')
    const pixels={data:await readVerifiedMediaBlobObjectData(blob),source:{contentHash:raw.asset.contentHash,mimeType:raw.asset.mimeType,width:raw.asset.width!,height:raw.asset.height!},signal:input.signal}
    const result=entry.recipe.version===1?await processAvgImageBytesV1({...pixels,recipe:entry.recipe})
      :await processAvgImageBytesV2({...pixels,recipe:entry.recipe,frozenRequirement:raw.payload.requirement})
    await readRaw()
    if(input.signal.aborted)throw new Error('[avg-process] 加工已停止，未调用供应商')
    const payload=await parseAvgProcessedImagePayload({schema:'storyforge.avg.processed-image',version:entry.recipe.version,requirementKey:entry.requirementKey,
      raw:{artifactKey:raw.row.artifactKey,version:raw.row.version,contentHash:raw.row.contentHash,producerReceiptHash:raw.row.producerReceiptHash!},sourceAsset:raw.asset,recipe:entry.recipe,receipt:result.receipt})
    if(input.signal.aborted)throw new Error('[avg-process] 加工已停止，未接收新字节')
    const output=await putMediaBlobObject({scope:input.scope,data:result.data,mimeType:'image/png',expectedContentHash:result.receipt.output.contentHash})
    const asset:FrozenRuntimeMediaAssetV2={...raw.asset,version:raw.asset.version+1,contentHash:output.contentHash,blobContentHash:output.contentHash,mimeType:'image/png',byteSize:output.byteSize,width:entry.recipe.width,height:entry.recipe.height,source:result.receipt.processor}
    return {artifacts:[{artifactKey:avgProcessedImageArtifactKeyV1(entry.requirementKey),kind:'image',mediaKind:raw.asset.kind,payload,metadata:asset,
      contentHash:output.contentHash,blobObjectId:output.id!,mimeType:'image/png',byteSize:output.byteSize,
      quality:{processingReceiptHash:result.receipt.receiptHash,rawProducerReceiptHash:raw.row.producerReceiptHash,noProviderRequest:true,decoderVerified:true},
      rights:{origin:'local-processing',sourceContentHash:raw.row.contentHash,sourceLicense:raw.asset.license,declaration:entry.recipe.declaration}}],
      passedGateIds:[...task.acceptanceGateIds],usage:usage(output.byteSize+new TextEncoder().encode(canonicalProductProductionJsonV2(payload)).byteLength)}
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'[avg-process] 本地加工失败',usage())}
}
