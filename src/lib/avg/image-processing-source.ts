import Dexie from 'dexie'
import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { verifyAcceptedProductBuildArtifactV1,verifyAvgProcessedImageArtifactV1 } from '../product-production/artifact-store'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'
import { assertAvgProcessedImageArtifact,type AvgProcessedImagePayload } from './image-processing-contract-v2'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { readAvgImageRecoverySourceV1 } from './media-recovery'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readAvgImageDefinitionV3 } from './media-production-definition'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { readAvgRegionCompositeInputsV1 } from './image-region-composite-source'
import { verifyAvgRegionCompositeWorkerV1 } from './image-region-composite-worker-client'

export interface AvgInspectedProcessedImageV1<R extends Omit<AvgVisualProductionRequirementV1,'references'>=AvgVisualProductionRequirementV1> {
  payload:AvgProcessedImagePayload;asset:FrozenRuntimeMediaAssetV2;requirement:R
  row:ProductBuildArtifactRecordV1;measured:Awaited<ReturnType<typeof inspectAvgImageBytesV1>>
}

/** Current or caller-proved historical producer. No adopt/carry authority. */
export async function inspectAvgProcessedImageSourceV1(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;processed:ProductBuildArtifactRecordV1}):Promise<AvgInspectedProcessedImageV1>{
  if(input.brief.avgVisualPlanning){
    const build=await db.productBuilds.get(input.raw.buildId)
    if(!build)throw new Error('[avg-process] 当前加工 Build 缺失')
    const load=()=>Promise.all([import('./visual-planning-image-definition'),import('./visual-image-processing')])
    const [{readAvgCompiledImageDefinitionV4},{inspectAvgVisualProcessedImageV4}]=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    const compiled=await readAvgCompiledImageDefinitionV4({scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,
      controlEpoch:build.controlEpoch,expectedBrief:input.brief,purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly'})
    const image=await inspectAvgVisualProcessedImageV4({scope:input.scope,compiled,raw:input.raw,artifact:input.processed})
    return inspectAvgProcessedImageBytesV1({...input,image})
  }
  const image=await assertAvgProcessedImageArtifact(input.brief,input.processed),raw=await assertAvgRawImageArtifactV1(input.brief,input.raw)
  if(canonicalProductProductionJsonV2(image.payload.sourceAsset)!==canonicalProductProductionJsonV2(raw.asset))throw new Error('[avg-process] 加工原图元数据已变化')
  return inspectAvgProcessedImageBytesV1({...input,image})
}

/** Byte/decoder inspection only. The caller proves the real definition,
 * recipe, raw source and producer authority before supplying this image. */
export async function inspectAvgProcessedImageBytesV1<R extends Omit<AvgVisualProductionRequirementV1,'references'>>(input:{scope:WorkspaceScope;raw:ProductBuildArtifactRecordV1;processed:ProductBuildArtifactRecordV1;
  image:Pick<AvgInspectedProcessedImageV1<R>,'payload'|'asset'|'requirement'>}):Promise<AvgInspectedProcessedImageV1<R>>{
  const {image}=input
  const ref={artifactKey:input.raw.artifactKey,version:input.raw.version,contentHash:input.raw.contentHash,producerReceiptHash:input.raw.producerReceiptHash}
  if(canonicalProductProductionJsonV2(image.payload.raw)!==canonicalProductProductionJsonV2(ref)
    ||input.processed.buildId!==input.raw.buildId||input.processed.controlEpoch!==input.raw.controlEpoch)throw new Error('[avg-process] 加工图缺少准确的原始 producer/版本/元数据')
  const quality=JSON.parse(input.processed.qualityJson)
  if(quality.processingReceiptHash!==image.payload.receipt.receiptHash||quality.rawProducerReceiptHash!==input.raw.producerReceiptHash
    ||quality.noProviderRequest!==true||quality.decoderVerified!==true)throw new Error('[avg-process] 加工图来源回执已变化')
  const blob=input.processed.blobObjectId===null?null:await db.mediaBlobObjects.get(input.processed.blobObjectId)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==image.asset.contentHash
    ||blob.mimeType!==image.asset.mimeType||blob.byteSize!==image.asset.byteSize)throw new Error('[avg-process] 加工图缺少同作品准确字节')
  if(image.payload.version===3){
    const payload=image.payload
    const verify=async()=>{
      const build=await db.productBuilds.get(input.raw.buildId)
      if(!build)throw new Error('[avg-composite] 合成输入 Build 缺失')
      const stored=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
      if(!stored)throw new Error('[avg-composite] 合成输入 Brief 缺失')
      const brief=parseProductProductionBriefV3(stored.briefJson),plan=JSON.parse(build.planJson)
      const production=await db.productProductions.get(build.productionId)
      const historical=production?.currentBuildNumber!==build.buildNumber||build.controlEpoch!==input.raw.controlEpoch
        ||['cancelled','failed','recovery-required','paused','preview-ready','release-ready','released'].includes(build.status)
      const source=await readAvgRegionCompositeInputsV1({scope:input.scope,recipe:payload.recipe,
        raw:{buildId:build.id!,artifactKey:input.raw.artifactKey,version:input.raw.version,contentHash:input.raw.contentHash},
        source:historical?{mode:'historical',frozen:{expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,controlEpoch:plan.controlEpoch}}:{mode:'current',brief}})
      if(canonicalProductProductionJsonV2(source.evidence)!==canonicalProductProductionJsonV2(payload.inputEvidence))throw new Error('[avg-composite] 合成来源与实际两输入证明不同')
      const bytes=()=>readVerifiedMediaBlobObjectData(blob)
      const data=Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(bytes),20_000):await bytes()
      const pixels=()=>verifyAvgRegionCompositeWorkerV1({...source.input,data,receipt:payload.receipt})
      if(Dexie.currentTransaction)await Dexie.waitFor(Dexie.ignoreTransaction(pixels),120_000);else await pixels()
    }
    // Author adoption holds an rw transaction on these source tables. Its DB
    // reads must retain that transaction; moving them out waits on our own
    // write lock. Only the pure worker computation leaves the transaction.
    await verify()
  }
  const inspect=async()=>inspectAvgImageBytesV1({data:await readVerifiedMediaBlobObjectData(blob),...image.asset})
  const measured=Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(inspect),20_000):await inspect()
  if(measured.hasAlpha!==image.payload.receipt.output.hasAlpha)throw new Error('[avg-process] 加工回执与实际透明像素不符')
  return {...image,row:input.processed,measured}
}
export async function readAvgProcessedImageSourceV1(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;version?:number;contentHash?:string}):Promise<AvgInspectedProcessedImageV1>{
  const load=()=>import('./image-consumption')
  const {assertAvgConsumedRawImageV4}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  const requirementKey=(await assertAvgConsumedRawImageV4({...input,row:input.raw})).requirement.requirementKey
  const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.buildId,avgProcessedImageArtifactKeyV1(requirementKey)])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===input.raw.controlEpoch).limit(2).toArray()
  const row=rows[0]
  if(rows.length!==1||!row||input.version!==undefined&&row.version!==input.version||input.contentHash!==undefined&&row.contentHash!==input.contentHash)throw new Error('[avg-process] 当前版本缺少准确加工图')
  const proved=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
  return inspectAvgProcessedImageSourceV1({...input,processed:proved})
}

/** A stale draft pixel slot gains no use authority. Only an exact retained
 * parent raw/derived source may be replaced by a newly adopted current choice. */
export async function verifyAvgRecoveryPlaceholderV1(input:{scope:WorkspaceScope;productionId:number;brief:ProductProductionBriefV3;requirementKey:string;asset:FrozenRuntimeMediaAssetV2}){
  if(!input.brief.avgAssembly||input.brief.avgAssembly.version===1||input.brief.avgAssembly.version===3&&!input.brief.avgAssembly.image)return false
  const a=readAvgImageDefinitionV3(input.brief)
  if(!a.imageRecovery?.retained.some(e=>e.requirementKey===input.requirementKey))return false
  const prior=await readAvgImageRecoverySourceV1({...input}),same=(x:unknown,y:unknown)=>canonicalProductProductionJsonV2(x)===canonicalProductProductionJsonV2(y)
  if(same(prior.asset,input.asset))return true
  const parent=await db.productBuilds.get(prior.artifact.buildId)
  if(!parent||!await assertRecordInScope(input.scope,'productBuilds',parent,{owner:'work'}))throw new Error('[avg-process] 待替换占位缺少准确父版本')
  const row=await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId,parent.briefRevision]).first()
  if(!row||row.briefHash!==parent.briefHash||!await assertRecordInScope(input.scope,'productProductionBriefs',row,{owner:'work'}))throw new Error('[avg-process] 待替换占位缺少准确父 Brief')
  const brief=parseProductProductionBriefV3(row.briefJson)
  const images=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([parent.id!,avgProcessedImageArtifactKeyV1(input.requirementKey)])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===prior.proof.controlEpoch).limit(2).toArray()
  if(images.length!==1||!same(JSON.parse(images[0].metadataJson),input.asset))return false
  const image=await verifyAvgProcessedImageArtifactV1({scope:input.scope,buildId:parent.id!,expectedBuildRevision:parent.stateRevision,expectedBriefHash:parent.briefHash,
    expectedPlanHash:parent.planHash,sourceControlEpoch:prior.proof.controlEpoch,artifactKey:images[0].artifactKey,version:images[0].version,contentHash:images[0].contentHash})
  return same((await inspectAvgProcessedImageSourceV1({scope:input.scope,brief,raw:prior.artifact,processed:image.artifact})).asset,input.asset)
}
