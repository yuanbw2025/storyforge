import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1 } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyHistoricalAvgVisualImageProducerV5 } from '../product-production/artifact-store'
import { readAvgHistoricalVisualCompilationInputs,assertAvgHistoricalVisualSourcesFresh,type AvgHistoricalVisualBoundary } from './visual-history-authority'
import { assertAvgVisualPlanningProposalV2 } from './media-source-v2'
import { readAvgDraftReferenceBytesV2 } from './editor-service'
import { verifyAvgReferenceBytesV1 } from './media-reference-contract'
import { assertAvgRawImageArtifactFromDefinitionV2,assertAvgRawImageReceptionV2 } from './media-raw-contract-v2'

type Ref={artifactKey:string;version:number;contentHash:string}
const ref=(r:ProductBuildArtifactRecordV1):Ref=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash})
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)

/** Reconstruct the original new semantic compilation through actual producer
 * and author receipts. Stopped/imported history grants no current authority. */
export async function readAvgHistoricalCompiledImageDefinitionV5(input:AvgHistoricalVisualBoundary){
  const original=await readAvgHistoricalVisualCompilationInputs(input,5)
  const {scope,planning,compilation,inputs,visual,source}=original
  const visualBible=visual.find(v=>v.payload.schema==='storyforge.avg.visual-bible')?.payload
  const mediaBriefs=visual.filter(v=>v.payload.schema==='storyforge.avg.media-brief').map(v=>v.payload)
  const proposal=await assertAvgVisualPlanningProposalV2(compilation.payloadJson,{scope:planning.scope,visualBible,mediaBriefs,
    source:{systemPlan:source.plan,scripts:source.scripts.map(s=>s.payload),presentation:{aspectRatio:planning.scope.aspectRatio}}})
  if(!same(JSON.parse(compilation.qualityJson),{schema:'storyforge.avg.visual-compilation-evidence',version:2,
    scopeHash:await hashProductProductionValueV2(planning.scope),inputs:inputs.map(ref)}))throw new Error('[avg-visual-history] 新编译与原作者输入不一致')
  for(const r of proposal.batch.requirements)for(const reference of r.references){
    await verifyAvgReferenceBytesV1(reference,await readAvgDraftReferenceBytesV2(scope,reference,r.family))
  }
  await assertAvgHistoricalVisualSourcesFresh(original)
  return {...original,proposal,definition:{schema:'storyforge.avg.compiled-image-definition' as const,version:5 as const,
    assembly:planning.assembly,mediaBatch:proposal.batch,imageBinding:planning.imageBinding,
    ...(planning.imageProcessing?{imageProcessing:planning.imageProcessing}:{}),compilation:ref(compilation)}}
}

/** Original raw2 request, exact policy transmission and HTTP producer5. Author
 * review2/choice and the actual selected pixels remain separate witnesses. */
export async function readAvgHistoricalRawImageV5(input:AvgHistoricalVisualBoundary&{artifact:Ref}){
  const original=await readAvgHistoricalCompiledImageDefinitionV5(input)
  const proof=await verifyHistoricalAvgVisualImageProducerV5({...input,sourceControlEpoch:input.controlEpoch,...input.artifact})
  const raw=await assertAvgRawImageArtifactFromDefinitionV2({...original.definition,capability:original.capability,qualityProfile:original.brief.qualityProfile},proof.artifact)
  assertAvgRawImageReceptionV2(proof.artifact.qualityJson,{request:raw.payload.request,rule:original.source.artifact,
    scripts:original.source.scripts.map(s=>s.artifact),compilation:original.definition.compilation})
  await assertAvgHistoricalVisualSourcesFresh(original)
  if(!same(await db.productBuildArtifacts.get(proof.artifact.id!),proof.artifact))throw new Error('[avg-visual-history] 新原图在读取期间变化')
  return {...original,raw:proof.artifact,provenance:proof.provenance,payload:raw.payload,asset:raw.asset}
}
