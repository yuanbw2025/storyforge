import Dexie from 'dexie'
import { avgVisualRawReuseDescriptorV4, type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'
import { db } from '../db/schema'
import { readAvgHistoricalVisualCompilationInputs,assertAvgHistoricalVisualSourcesFresh,type AvgHistoricalVisualBoundary } from './visual-history-authority'
import type { ProductBuildArtifactRecordV1 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyHistoricalAvgVisualImageProducerV4 } from '../product-production/artifact-store'
import { assertAvgVisualPlanningProposalV1 } from './media-source'
import { verifyAvgReferenceBytesV1 } from './media-reference-contract'
import { readAvgDraftReferenceBytesV1 } from './editor-service'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { assertAvgRawImageArtifactFromDefinitionV1 } from './media-raw-contract'
import { avgRawMediaArtifactKeyV1 } from './media-production-contract'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'

type Ref={artifactKey:string;version:number;contentHash:string}
const ref=(row:ProductBuildArtifactRecordV1):Ref=>({artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
export type AvgHistoricalVisualBoundaryV4=AvgHistoricalVisualBoundary

/** Read the original stopped/frozen compilation through its actual author,
 * model and compiler receipts. No substitute Brief, current adoption or
 * request permission is created. A partial image prefix needs no Stage. */
export async function readAvgHistoricalCompiledImageDefinitionV4(input:AvgHistoricalVisualBoundaryV4){
  const {scope,brief,planning,build,production,plan,compiler,compilation,capability,inputs,visual,systemPlan,rule,scripts,records}=await readAvgHistoricalVisualCompilationInputs(input,4)
  const visualBible=visual.find(v=>v.payload.schema==='storyforge.avg.visual-bible')?.payload
  const mediaBriefs=visual.filter(v=>v.payload.schema==='storyforge.avg.media-brief').map(v=>v.payload)
  const proposal=await assertAvgVisualPlanningProposalV1(compilation.payloadJson,{scope:planning.scope,visualBible,mediaBriefs,
    source:{systemPlan,scripts:scripts.map(s=>s.payload),presentation:{aspectRatio:planning.scope.aspectRatio}}})
  if(!same(JSON.parse(compilation.qualityJson),{schema:'storyforge.avg.visual-compilation-evidence',version:1,
    scopeHash:await hashProductProductionValueV2(planning.scope),inputs:inputs.map(ref)}))throw new Error('[avg-visual-history] 原编译工件与作者输入不一致')
  for(const requirement of proposal.batch.requirements){
    for(const reference of requirement.references)await verifyAvgReferenceBytesV1(reference,await readAvgDraftReferenceBytesV1(scope,reference))
    await validateAvgGeneratedReferencesV1(scope,requirement.references,requirement.family)
  }
  await assertAvgHistoricalVisualSourcesFresh({scope,build,production,records})
  return {scope,brief,planning,build,production,plan,compiler,compilation,proposal,capability,records,
    source:{plan:systemPlan,artifact:ref(rule),scripts},visual,
    definition:{schema:'storyforge.avg.compiled-image-definition' as const,version:4 as const,assembly:planning.assembly,
      mediaBatch:proposal.batch,imageBinding:planning.imageBinding,...(planning.imageProcessing?{imageProcessing:planning.imageProcessing}:{}),compilation:ref(compilation)}}
}

/** Full original definition + intrinsic producer evidence. Author selection,
 * new reference consent and current consumption remain separate decisions. */
export async function readAvgHistoricalRawImageV4(input:AvgHistoricalVisualBoundaryV4&{artifact:Ref}){
  const resolved=await readAvgHistoricalCompiledImageDefinitionV4(input)
  return inspectHistoricalRaw(resolved,input.artifact)
}

type HistoricalDefinition=Awaited<ReturnType<typeof readAvgHistoricalCompiledImageDefinitionV4>>
async function assertFresh(resolved:HistoricalDefinition){await assertAvgHistoricalVisualSourcesFresh(resolved)}

async function inspectHistoricalRaw(resolved:HistoricalDefinition,artifact:Ref){
  const {build,plan}=resolved
  const proof=await verifyHistoricalAvgVisualImageProducerV4({scope:resolved.scope,buildId:build.id!,
    expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
    sourceControlEpoch:plan.controlEpoch,...artifact})
  const raw=await assertAvgRawImageArtifactFromDefinitionV1({...resolved.definition,capability:resolved.capability,
    qualityProfile:resolved.brief.qualityProfile},proof.artifact)
  const quality=JSON.parse(proof.artifact.qualityJson)
  if(!same(quality.sourceCompilation,resolved.definition.compilation)||!same(quality.sourceRule,resolved.source.artifact)
    ||!same(quality.sourceScripts,resolved.source.scripts.map(s=>s.artifact)))throw new Error('[avg-visual-history] 原图未绑定原已采用编译来源')
  await assertFresh(resolved)
  if(!same(await db.productBuildArtifacts.get(proof.artifact.id!),proof.artifact))throw new Error('[avg-visual-history] 原图在读取期间变化')
  return {...resolved,raw:proof.artifact,provenance:proof.provenance,payload:raw.payload,asset:raw.asset}
}

/** All original slots remain visible, including absent or invalid images.
 * Compiler verification is shared within this one read, never persisted as
 * a grant. Pixels are read again through their exact boundary on expansion. */
export async function readAvgHistoricalImageCandidatesV4(input:Omit<AvgHistoricalVisualBoundaryV4,'controlEpoch'>&{productionId:number}){
  const build=await db.productBuilds.get(input.buildId)
  if(!build||build.productionId!==input.productionId)throw new Error('[avg-visual-history] 图片来源制作记录已变化')
  const controlEpoch=(JSON.parse(build.planJson) as {controlEpoch:number}).controlEpoch
  const boundary={...input,controlEpoch},resolved=await readAvgHistoricalCompiledImageDefinitionV4(boundary)
  const candidates=[]
  for(const requirement of resolved.definition.mediaBatch.requirements){
    const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,avgRawMediaArtifactKeyV1(requirement.requirementKey)])
      .filter(r=>r.status==='accepted'&&r.controlEpoch===controlEpoch).toArray()
    if(!rows.length){candidates.push({requirement,available:false as const,issue:'本版暂无可核对的原图记录'});continue}
    try{
      if(rows.length!==1)throw new Error('[avg-visual-history] 原图版本不唯一')
      const image=await inspectHistoricalRaw(resolved,ref(rows[0]))
      candidates.push({requirement,available:true as const,asset:image.asset,raw:ref(image.raw),reuseSource:await avgVisualRawReuseDescriptorV4(image),costUsd:image.payload.provider.costUsd})
    }catch(error){candidates.push({requirement,available:false as const,issue:error instanceof Error?error.message:'原图来源未通过核验'})}
  }
  await assertFresh(resolved)
  const {scope:_scope,productionId:_production,...previewBoundary}=boundary
  return {boundary:previewBoundary,buildNumber:build.buildNumber,candidates}
}

/** Same owner/hash reader for native preview; never an HTTP image URL. */
export async function readAvgHistoricalImageCandidateBytesV4(input:AvgHistoricalVisualBoundaryV4&{
  productionId:number;requirementKey:string;version:number;contentHash:string;source?:AvgVisualRawReuseSourceV4
}){
  let image:Awaited<ReturnType<typeof readAvgHistoricalRawImageV4>>
  if(input.source){
    const load=()=>import('./visual-image-reuse')
    const {readAvgVisualRawReuseSourceV4}=await (Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    image=await readAvgVisualRawReuseSourceV4({scope:input.scope,source:input.source})
    if(image.build.id!==input.buildId||image.build.stateRevision!==input.expectedBuildRevision||image.plan.controlEpoch!==input.controlEpoch
      ||image.build.briefHash!==input.expectedBriefHash||image.build.planHash!==input.expectedPlanHash
      ||image.raw.artifactKey!==avgRawMediaArtifactKeyV1(input.requirementKey)||image.raw.version!==input.version
      ||image.raw.contentHash!==input.contentHash)throw new Error('[avg-visual-history] 便携原图与所选来源边界不一致')
  }else image=await readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:avgRawMediaArtifactKeyV1(input.requirementKey),version:input.version,contentHash:input.contentHash}})
  if(image.production.id!==input.productionId)throw new Error('[avg-visual-history] 原图不属于所选制作记录')
  const blob=image.raw.blobObjectId===null?null:await db.mediaBlobObjects.get(image.raw.blobObjectId)
  if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==image.asset.contentHash
    ||blob.byteSize!==image.asset.byteSize||blob.mimeType!==image.asset.mimeType)throw new Error('[avg-visual-history] 原图字节不存在或已变化')
  const data=await readVerifiedMediaBlobObjectData(blob)
  await assertFresh(image)
  if(!same(await db.productBuildArtifacts.get(image.raw.id!),image.raw))throw new Error('[avg-visual-history] 原图版本在读取期间变化')
  return {asset:image.asset,data}
}
