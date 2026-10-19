import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1,verifyHistoricalAvgImageProcessingProducerV1,verifyHistoricalAvgVisualImageProducerV5 } from '../product-production/artifact-store'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { readAvgVisualPlanningExecutionSourcesV5 } from './visual-planning-task-source-v5'
import { assertAvgRawImageArtifactFromDefinitionV2,assertAvgRawImageReceptionV2 } from './media-raw-contract-v2'
import { executeAvgBoundedImageProcessingV1 } from './image-processing-execution-kernel'
import { assertAvgProcessedImageArtifactFromDefinitionV1,type AvgProcessedImageArtifactFieldsV1 } from './image-processing-contract'
import { inspectAvgProcessedImageBytesV1 } from './image-processing-source'
import { avgVisualProcessingQuality,inspectAvgVisualProcessingBinding } from './visual-processing-binding'

type Definition=Awaited<ReturnType<typeof readAvgCompiledImageDefinitionV5>>
export type AvgVerifiedCompiledImageDefinitionV5=Pick<Definition,'definition'|'planning'|'plan'|'build'|'brief'|'capability'>&{source:{
  artifact:Definition['source']['artifact'];scripts:Array<{artifact:Definition['source']['scripts'][number]['artifact']}>}}
type Compiled=AvgVerifiedCompiledImageDefinitionV5
type Raw=Parameters<typeof assertAvgRawImageArtifactFromDefinitionV2>[1]&Pick<ProductBuildArtifactRecordV1,'qualityJson'>
type Processed=AvgProcessedImageArtifactFieldsV1&Pick<ProductBuildArtifactRecordV1,'qualityJson'|'requirementKey'>
const binding=(d:Compiled)=>({compilation:d.definition.compilation,rule:d.source.artifact,scripts:d.source.scripts.map(s=>s.artifact)})
const ref=(r:ProductBuildArtifactRecordV1)=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash,producerReceiptHash:r.producerReceiptHash})

/** Actual V5 request/policy semantics only; callers separately prove the
 * original durable producer and physical bytes, current or historical. */
export async function inspectAvgCompiledRawImageV5(compiled:Compiled,artifact:Raw){
  const raw=await assertAvgRawImageArtifactFromDefinitionV2({...compiled.definition,capability:compiled.capability,qualityProfile:compiled.brief.qualityProfile},artifact)
  assertAvgRawImageReceptionV2(artifact.qualityJson,{...binding(compiled),request:raw.payload.request})
  return {...raw,requirement:raw.payload.requirement}
}
export async function inspectAvgVisualProcessedImageV5(input:{compiled:Compiled;raw:ProductBuildArtifactRecordV1;artifact:Processed}){
  const {compiled,raw,artifact}=input,original=await inspectAvgCompiledRawImageV5(compiled,raw)
  return inspectAvgVisualProcessingBinding({version:2,definition:compiled.definition,binding:binding(compiled),raw,original:original.asset,artifact,
    task:compiled.plan.tasks.find(t=>t.outputArtifactKeys.includes(artifact.artifactKey))})
}

/** No model/HTTP route: actual V5 frozen Plan, registered context and exact
 * original V2 producer surround the shared bounded native pixel processor. */
export async function executeAvgVisualImageProcessingTaskV5(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=()=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes:0})
  try{
    if(input.signal.aborted||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-process] 单次零调用加工领取已失效')
    const claim=await readAvgVisualPlanningExecutionSourcesV5(input,brief)
    const compiled=await readAvgCompiledImageDefinitionV5({scope:input.scope,buildId:input.buildId,expectedBuildRevision:claim.build.stateRevision,
      controlEpoch:input.controlEpoch,expectedBrief:brief})
    const task=compiled.plan.tasks.find(t=>t.taskKey===input.task.taskKey),entry=compiled.planning.imageProcessing?.entries.find(e=>task?.taskKey===`avg.media.process.${e.requirementKey}`)
    const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
    const supplied=input.inputArtifacts.filter(r=>r.artifactKey===`avg.media.raw.${entry?.requirementKey}`)
    if(!entry||!task||!same(task,input.task)||task.kind!=='avg-media-image-process'||task.contextProfile!=='avg-visual-planning-v5'
      ||claim.packet.operation!=='process-compiled-image'||!same(claim.packet.processing,entry)||supplied.length!==1)throw new Error('[avg-process] 加工不属于准确冻结的新版本任务与登记输入')
    const readRaw=async()=>{
      const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,...ref(supplied[0])})
      return {row,...await inspectAvgCompiledRawImageV5(compiled,row)}
    }
    const raw=await readRaw(),sourceContextHash=await hashProductProductionValueV2(input.contextText)
    return await executeAvgBoundedImageProcessingV1({request:input,started,raw,entry,task,
      recheck:async()=>{await readRaw();await readAvgVisualPlanningExecutionSourcesV5(input,brief)},
      quality:receiptHash=>avgVisualProcessingQuality(2,binding(compiled),raw.row,receiptHash,sourceContextHash)})
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'[avg-process] 本地加工失败',usage())}
}

/** Original completed V5/raw2 producer plus local processor1 physical proof.
 * Semantic evidence2 is independently checked against the actual V5 compiler;
 * no old review, author authority or imported Run resumption is granted. */
export async function readAvgVisualProcessingEvidenceV5(input:{scope:WorkspaceScope;compiled:Compiled;artifact:{artifactKey:string;version:number;contentHash:string}}){
  const {compiled}=input,build=compiled.build
  const boundary={scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:compiled.plan.controlEpoch}
  const processing=await verifyHistoricalAvgImageProcessingProducerV1({...boundary,...input.artifact})
  const payload=await assertAvgProcessedImageArtifactFromDefinitionV1(compiled.definition,processing.artifact)
  const rawProof=await verifyHistoricalAvgVisualImageProducerV5({...boundary,...payload.payload.raw})
  const checked=await inspectAvgVisualProcessedImageV5({compiled,raw:rawProof.artifact,artifact:processing.artifact})
  const image=await inspectAvgProcessedImageBytesV1({scope:input.scope,raw:rawProof.artifact,processed:processing.artifact,image:checked})
  return {raw:rawProof.artifact,rawProof:rawProof.provenance,processing:processing.artifact,processingProof:processing.provenance,image}
}
