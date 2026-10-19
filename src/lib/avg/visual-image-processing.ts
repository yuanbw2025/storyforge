import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1,verifyHistoricalAvgImageProcessingProducerV1,verifyHistoricalAvgImageRevalidationProducerV1,
  verifyHistoricalAvgVisualImageProducerV4 } from '../product-production/artifact-store'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { readAvgVisualPlanningExecutionSourcesV4 } from './visual-planning-task-source'
import { inspectAvgCompiledRawImageV4,type AvgVerifiedCompiledImageDefinitionV4 } from './visual-image-revalidation'
import { executeAvgBoundedImageProcessingV1 } from './image-processing-execution-kernel'
import { assertAvgProcessedImageArtifactFromDefinitionV1,type AvgProcessedImageArtifactFieldsV1 } from './image-processing-contract'
import { avgVisualProcessingQuality,inspectAvgVisualProcessingBinding } from './visual-processing-binding'
import { inspectAvgProcessedImageBytesV1 } from './image-processing-source'

type Compiled=AvgVerifiedCompiledImageDefinitionV4
type Processed=AvgProcessedImageArtifactFieldsV1&Pick<ProductBuildArtifactRecordV1,'qualityJson'|'requirementKey'>
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
const ref=(r:ProductBuildArtifactRecordV1)=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash,producerReceiptHash:r.producerReceiptHash})

const binding=(compiled:Compiled)=>({compilation:compiled.definition.compilation,rule:compiled.source.artifact,scripts:compiled.source.scripts.map(s=>s.artifact)})
function quality(compiled:Compiled,raw:ProductBuildArtifactRecordV1,receiptHash:string,sourceContextHash:string){
  return avgVisualProcessingQuality(1,binding(compiled),raw,receiptHash,sourceContextHash)
}

/** Product semantics only; exact compiler and original producer remain required. */
export async function inspectAvgVisualProcessedImageV4(input:{scope:WorkspaceScope;compiled:Compiled;raw:ProductBuildArtifactRecordV1;artifact:Processed}){
  const {compiled,raw,artifact}=input,original=await inspectAvgCompiledRawImageV4({scope:input.scope,compiled,artifact:raw})
  return inspectAvgVisualProcessingBinding({version:1,definition:compiled.definition,binding:binding(compiled),raw,original:original.asset,artifact,
    task:compiled.plan.tasks.find(t=>t.outputArtifactKeys.includes(artifact.artifactKey))})
}

/** Exact completed producers, original bytes, actual compilation/recipe and
 * decoded output. No current adoption or resumed imported Run authority. */
export async function readAvgVisualProcessingEvidenceV4(input:{scope:WorkspaceScope;compiled:Compiled;artifact:{artifactKey:string;version:number;contentHash:string}}){
  const {compiled}=input,build=compiled.build
  const boundary={scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:compiled.plan.controlEpoch}
  const processing=await verifyHistoricalAvgImageProcessingProducerV1({...boundary,...input.artifact})
  const payload=await assertAvgProcessedImageArtifactFromDefinitionV1(compiled.definition,processing.artifact)
  const original=compiled.planning.rawReuse?.find(s=>s.requirementKey===payload.payload.requirementKey)
  const rawProof=original?await verifyHistoricalAvgImageRevalidationProducerV1({...boundary,...payload.payload.raw})
    :await verifyHistoricalAvgVisualImageProducerV4({...boundary,...payload.payload.raw})
  const checked=await inspectAvgVisualProcessedImageV4({scope:input.scope,compiled,raw:rawProof.artifact,artifact:processing.artifact})
  const image=await inspectAvgProcessedImageBytesV1({scope:input.scope,raw:rawProof.artifact,processed:processing.artifact,image:checked})
  return {raw:rawProof.artifact,rawProof:rawProof.provenance,...(original?{original}:{}),processing:processing.artifact,
    processingProof:processing.provenance,image}
}

/** Same bounded native processor as V2, executed under the actual V4 frozen
 * Brief/claim/Gateway and its own zero-capability producer. No fake V2 Brief. */
export async function executeAvgVisualImageProcessingTaskV4(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    if(input.signal.aborted||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-process] 单次零调用加工领取已失效')
    const claim=await readAvgVisualPlanningExecutionSourcesV4(input,brief)
    const compiled=await readAvgCompiledImageDefinitionV4({scope:input.scope,buildId:input.buildId,expectedBuildRevision:claim.build.stateRevision,
      controlEpoch:input.controlEpoch,expectedBrief:brief})
    const task=compiled.plan.tasks.find(t=>t.taskKey===input.task.taskKey),entry=compiled.planning.imageProcessing?.entries.find(e=>task?.taskKey===`avg.media.process.${e.requirementKey}`)
    const supplied=input.inputArtifacts.filter(r=>r.artifactKey===`avg.media.raw.${entry?.requirementKey}`)
    if(!entry||!task||!same(task,input.task)||task.kind!=='avg-media-image-process'||task.contextProfile!=='avg-visual-planning-v4'
      ||claim.packet.operation!=='process-compiled-image'||!same(claim.packet.processing,entry)||supplied.length!==1)throw new Error('[avg-process] 加工不属于准确冻结任务与登记输入')
    const readRaw=async()=>{
      const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,...ref(supplied[0])})
      return {row,...await inspectAvgCompiledRawImageV4({scope:input.scope,compiled,artifact:row})}
    }
    const raw=await readRaw(),sourceContextHash=await hashProductProductionValueV2(input.contextText)
    return await executeAvgBoundedImageProcessingV1({request:input,started,raw,entry,task,
      recheck:async()=>{await readRaw();await readAvgVisualPlanningExecutionSourcesV4(input,brief)},
      quality:receiptHash=>quality(compiled,raw.row,receiptHash,sourceContextHash)})
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'[avg-process] 本地加工失败',usage())}
}
