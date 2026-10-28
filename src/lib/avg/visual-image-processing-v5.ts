import Dexie from 'dexie'
import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1,verifyHistoricalAvgImageProcessingProducerV1,verifyHistoricalAvgVisualImageProducerV5 } from '../product-production/artifact-store'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { readAvgVisualPlanningExecutionSourcesV5 } from './visual-planning-task-source-v5'
import { assertAvgRawImageArtifactFromDefinitionV2,assertAvgRawImageReceptionV2 } from './media-raw-contract-v2'
import { executeAvgBoundedImageProcessingV1 } from './image-processing-execution-kernel'
import type { AvgProcessedImageArtifactFieldsV1 } from './image-processing-contract'
import { assertAvgProcessedImageArtifactFromDefinition } from './image-processing-contract-v2'
import { inspectAvgProcessedImageBytesV1 } from './image-processing-source'
import { avgVisualProcessingQuality,inspectAvgVisualProcessingBinding } from './visual-processing-binding'
import type { AvgVisualRawReuseCompiledV5 } from './visual-image-revalidation-v5'

type Definition=Awaited<ReturnType<typeof readAvgCompiledImageDefinitionV5>>
export type AvgVerifiedCompiledImageDefinitionV5=Pick<Definition,'definition'|'planning'|'plan'|'build'|'brief'|'capability'|'production'>&{source:{
  artifact:Definition['source']['artifact'];scripts:Array<{artifact:Definition['source']['scripts'][number]['artifact']}>}}
type Compiled=AvgVerifiedCompiledImageDefinitionV5
type Raw=ProductBuildArtifactRecordV1
type Processed=AvgProcessedImageArtifactFieldsV1&Pick<ProductBuildArtifactRecordV1,'qualityJson'|'requirementKey'>
const binding=(d:Compiled)=>({compilation:d.definition.compilation,rule:d.source.artifact,scripts:d.source.scripts.map(s=>s.artifact)})
const ref=(r:ProductBuildArtifactRecordV1)=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash,producerReceiptHash:r.producerReceiptHash})

/** Actual V5 request/policy semantics only; callers separately prove the
 * original durable producer and physical bytes, current or historical. */
export async function inspectAvgCompiledRawImageV5(compiled:Compiled,artifact:Raw,scope:WorkspaceScope){
  if(compiled.planning.rawReuse?.some(source=>artifact.artifactKey===`avg.media.raw.${source.requirementKey}`)){
    const load=()=>import('./visual-image-revalidation-v5')
    const {inspectAvgRevalidatedRawImageV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    return inspectAvgRevalidatedRawImageV5({scope,compiled:compiled as AvgVisualRawReuseCompiledV5,artifact})
  }
  const raw=await assertAvgRawImageArtifactFromDefinitionV2({...compiled.definition,capability:compiled.capability,qualityProfile:compiled.brief.qualityProfile},artifact)
  assertAvgRawImageReceptionV2(artifact.qualityJson,{...binding(compiled),request:raw.payload.request})
  return {...raw,requirement:raw.payload.requirement}
}
export async function inspectAvgVisualProcessedImageV5(input:{scope:WorkspaceScope;compiled:Compiled;raw:ProductBuildArtifactRecordV1;artifact:Processed}){
  const {scope,compiled,raw,artifact}=input,original=await inspectAvgCompiledRawImageV5(compiled,raw,scope)
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
      return {row,...await inspectAvgCompiledRawImageV5(compiled,row,input.scope)}
    }
    const raw=await readRaw(),sourceContextHash=await hashProductProductionValueV2(input.contextText)
    return await executeAvgBoundedImageProcessingV1({request:input,started,raw,entry,task,requirement:raw.requirement,
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
  const payload=await assertAvgProcessedImageArtifactFromDefinition(compiled.definition,processing.artifact)
  const reused=compiled.planning.rawReuse?.some(source=>source.requirementKey===payload.payload.requirementKey)
  const rawProof=reused?await (async()=>{
    // A cold browser module fetch must not commit the caller's proof snapshot.
    // Load outside it; the raw-history reads still run inside that snapshot.
    const load=()=>import('./visual-image-revalidation-v5')
    const {readAvgVisualRawReuseEvidenceV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    return readAvgVisualRawReuseEvidenceV5({scope:input.scope,compiled,artifact:payload.payload.raw})
  })():await verifyHistoricalAvgVisualImageProducerV5({...boundary,...payload.payload.raw})
  const rawRow='raw' in rawProof?rawProof.raw:rawProof.artifact
  const checked=await inspectAvgVisualProcessedImageV5({scope:input.scope,compiled,raw:rawRow,artifact:processing.artifact})
  const image=await inspectAvgProcessedImageBytesV1({scope:input.scope,raw:rawRow,processed:processing.artifact,image:checked})
  return {raw:rawRow,rawProof:rawProof.provenance,...(reused&&'original'in rawProof?{originalReuseSource:rawProof.original}:{}),
    processing:processing.artifact,processingProof:processing.provenance,image}
}
