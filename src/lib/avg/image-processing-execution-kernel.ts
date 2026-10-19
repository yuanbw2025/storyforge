import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2,ProductBuildArtifactRecordV1,ProductProductionPlanTaskV3 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { putMediaBlobObject,readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import type { ProductProductionTaskExecutionInputV1,ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { processAvgImageBytesV1 } from './image-processing'
import { AVG_IMAGE_PROCESSOR_V1,type AvgImageProcessingPlanV1,type AvgProcessedImagePayloadV1 } from './image-processing-contract'

/** Physical execution only. The versioned caller proves the exact original
 * Brief/compiled task/raw/recipe/claim, then rechecks them after processing.
 * Returned artifacts still require the shared sealed producer admission. */
export async function executeAvgBoundedImageProcessingV1(input:{
  request:ProductProductionTaskExecutionInputV1;started:number;task:ProductProductionPlanTaskV3;
  raw:{row:ProductBuildArtifactRecordV1;asset:FrozenRuntimeMediaAssetV2};entry:AvgImageProcessingPlanV1['entries'][number];
  recheck:()=>Promise<void>;quality:(receiptHash:string)=>Record<string,unknown>
}):Promise<ProductProductionTaskExecutionResultV1>{
  const {request,raw,entry,task}=input,blob=raw.row.blobObjectId===null?null:await db.mediaBlobObjects.get(raw.row.blobObjectId)
  if(!blob||!await assertRecordInScope(request.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==raw.asset.contentHash
    ||blob.mimeType!==raw.asset.mimeType||blob.byteSize!==raw.asset.byteSize)throw new Error('[avg-process] 加工原图缺少准确同作品字节')
  const result=await processAvgImageBytesV1({data:await readVerifiedMediaBlobObjectData(blob),source:{contentHash:raw.asset.contentHash,mimeType:raw.asset.mimeType,
    width:raw.asset.width!,height:raw.asset.height!},recipe:entry.recipe,signal:request.signal})
  await input.recheck()
  if(request.signal.aborted)throw new Error('[avg-process] 加工已停止，原图与供应商记录保留')
  const quality=input.quality(result.receipt.receiptHash)
  const output=await putMediaBlobObject({scope:request.scope,data:result.data,mimeType:'image/png',expectedContentHash:result.receipt.output.contentHash})
  const asset:FrozenRuntimeMediaAssetV2={...raw.asset,version:raw.asset.version+1,contentHash:output.contentHash,blobContentHash:output.contentHash,
    mimeType:'image/png',byteSize:output.byteSize,width:entry.recipe.width,height:entry.recipe.height,source:AVG_IMAGE_PROCESSOR_V1}
  const payload:AvgProcessedImagePayloadV1={schema:'storyforge.avg.processed-image',version:1,requirementKey:entry.requirementKey,
    raw:{artifactKey:raw.row.artifactKey,version:raw.row.version,contentHash:raw.row.contentHash,producerReceiptHash:raw.row.producerReceiptHash!},
    sourceAsset:raw.asset,recipe:entry.recipe,receipt:result.receipt}
  const artifact={artifactKey:task.outputArtifactKeys[0],requirementKey:null,kind:'image' as const,mediaKind:raw.asset.kind,payload,metadata:asset,
    contentHash:output.contentHash,blobObjectId:output.id!,mimeType:'image/png',byteSize:output.byteSize,quality,
    rights:{origin:'local-processing',sourceContentHash:raw.row.contentHash,sourceLicense:raw.asset.license,declaration:entry.recipe.declaration}}
  return {artifacts:[artifact],passedGateIds:[...task.acceptanceGateIds],usage:{modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,
    durationMs:Date.now()-input.started,storageBytes:output.byteSize+new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength}}
}
