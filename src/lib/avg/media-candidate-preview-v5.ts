import { db } from '../db/schema'
import type { WorkspaceScope,FrozenRuntimeMediaAssetV2,ProductBuildArtifactRecordV1 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgHistoricalRawImageV5,readAvgHistoricalCompiledImageDefinitionV5 } from './visual-image-history-v5'
import { readAvgVisualProcessingEvidenceV5 } from './visual-image-processing-v5'
import { avgRawMediaArtifactKeyV1 } from './media-production-contract'
import type { AvgHistoricalVisualBoundary } from './visual-history-authority'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'
import { avgVisualRawReuseDescriptorV5 } from './visual-image-reuse-contract'
import type { AvgForegroundProcessingObservationAny } from './image-processing-contract-v2'

export type AvgV5PreviewBoundary=Omit<AvgHistoricalVisualBoundary,'scope'>
type Selection={scope:WorkspaceScope;productionId:number;requirementKey:string;version:number;contentHash:string;historical?:AvgV5PreviewBoundary}
export interface AvgV5ProcessedImageDisplayEvidence {
  contentHash:string
  foreground:AvgForegroundProcessingObservationAny|null
  output:{width:number;height:number;hasAlpha:boolean}
}
async function originalBoundary(input:Pick<Selection,'scope'|'productionId'|'historical'>){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const build=input.historical?details.buildHistory.find(row=>row.id===input.historical!.buildId):details.build
  const row=build?details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash):null
  const brief=row?parseProductProductionBriefV3(row.briefJson):null
  if(!build?.id||brief?.avgVisualPlanning?.version!==5)throw new Error('[avg-media] 新版图像预览要求准确原始V5版本')
  const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  if(input.historical&&(build.id!==input.historical.buildId||build.stateRevision!==input.historical.expectedBuildRevision||build.briefHash!==input.historical.expectedBriefHash
    ||build.planHash!==input.historical.expectedPlanHash||plan.controlEpoch!==input.historical.controlEpoch
    ||!['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(build.status)))throw new Error('[avg-media] 新版历史预览来源已变化')
  return {brief,build,historical:['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(build.status),
    boundary:{scope:input.scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
      expectedPlanHash:build.planHash,controlEpoch:plan.controlEpoch}}
}
async function bytes(scope:WorkspaceScope,row:ProductBuildArtifactRecordV1,asset:FrozenRuntimeMediaAssetV2){
  const blob=row.blobObjectId===null?null:await db.mediaBlobObjects.get(row.blobObjectId)
  if(!blob||!await assertRecordInScope(scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==asset.contentHash
    ||blob.byteSize!==asset.byteSize||blob.mimeType!==asset.mimeType)throw new Error('[avg-media] 新版预览缺少同作品准确字节')
  return {asset,data:await readVerifiedMediaBlobObjectData(blob)}
}
/** Display authority only, including completed prefixes after stop/import.
 * The actual original V5 compiler/HTTP producer is read, never resumed. */
export async function readAvgRawImageCandidateBytesV5(input:Selection){
  const {brief,historical,boundary}=await originalBoundary(input)
  const artifact={artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),version:input.version,contentHash:input.contentHash}
  if(historical){const original=await readAvgHistoricalRawImageV5({...boundary,artifact});return bytes(input.scope,original.raw,original.asset)}
  const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:boundary.buildId,...artifact})
  const raw=await assertAvgConsumedRawImageV5({scope:input.scope,brief,row})
  return bytes(input.scope,row,raw.asset)
}
export async function readAvgProcessedImageCandidateBytesV5(input:Selection){
  const evidence=await readAvgProcessedImageCandidateEvidenceV5(input)
  const foreground=evidence.image.payload.version===2?evidence.image.payload.receipt.foreground:null
  return {...await bytes(input.scope,evidence.processing,evidence.image.asset),processingEvidence:{contentHash:evidence.processing.contentHash,
    foreground,output:evidence.image.measured}}
}
async function readAvgProcessedImageCandidateEvidenceV5(input:Selection){
  const {brief,build,historical,boundary}=await originalBoundary(input)
  const compiled=historical?await readAvgHistoricalCompiledImageDefinitionV5(boundary)
    :await readAvgCompiledImageDefinitionV5({...boundary,expectedBrief:brief,purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly'})
  return readAvgVisualProcessingEvidenceV5({scope:input.scope,compiled,artifact:{artifactKey:avgProcessedImageArtifactKeyV1(input.requirementKey),
    version:input.version,contentHash:input.contentHash}})
}

/** Metadata/provenance inventory only. Individual display still verifies exact
 * owned bytes. No historical image becomes a current candidate or reuse plan. */
export async function readAvgHistoricalImageCandidatesV5(input:{scope:WorkspaceScope;productionId:number;historical:AvgV5PreviewBoundary}){
  const {boundary,build}=await originalBoundary(input)
  const compiled=await readAvgHistoricalCompiledImageDefinitionV5(boundary)
  const rows=await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const candidates=await Promise.all(compiled.definition.mediaBatch.requirements.map(async requirement=>{
    const raws=rows.filter(row=>row.artifactKey===avgRawMediaArtifactKeyV1(requirement.requirementKey)&&row.status==='accepted'&&row.controlEpoch===boundary.controlEpoch)
    if(raws.length!==1)return {requirement,available:false as const,issue:'准确原图缺失或版本不唯一'}
    try{
      const original=await readAvgHistoricalRawImageV5({...boundary,artifact:{artifactKey:raws[0].artifactKey,version:raws[0].version,contentHash:raws[0].contentHash}})
      const expected=compiled.definition.imageProcessing?.entries.some(e=>e.requirementKey===requirement.requirementKey)
      let processed:null|{row:ProductBuildArtifactRecordV1;asset:FrozenRuntimeMediaAssetV2}=null,processingIssue=''
      if(expected){
        const images=rows.filter(row=>row.artifactKey===avgProcessedImageArtifactKeyV1(requirement.requirementKey)&&row.status==='accepted'&&row.controlEpoch===boundary.controlEpoch)
        try{
          if(images.length!==1)throw new Error('尚无准确加工结果')
          const evidence=await readAvgVisualProcessingEvidenceV5({scope:input.scope,compiled,artifact:{artifactKey:images[0].artifactKey,version:images[0].version,contentHash:images[0].contentHash}})
          processed={row:evidence.processing,asset:evidence.image.asset}
        }catch(cause){processingIssue=String(cause)}
      }
      return {requirement,available:true as const,raw:original.raw,asset:original.asset,
        reuseSource:await avgVisualRawReuseDescriptorV5(original),processed,processingIssue}
    }catch(cause){return {requirement,available:false as const,issue:String(cause)}}
  }))
  await originalBoundary(input)
  return {buildNumber:build.buildNumber,boundary:input.historical,candidates}
}
