import type { FrozenRuntimeMediaAssetV2,ProductBuildArtifactRecordV1,ProductProductionPlanTaskV3 } from '../types'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type { AvgProcessedImageArtifactFieldsV1 } from './image-processing-contract'
import { assertAvgProcessedImageArtifactFromDefinition } from './image-processing-contract-v2'
import { avgHash,avgRecord } from './protocol-validation'

type Definition<R extends Omit<AvgVisualProductionRequirementV1,'references'>> = Parameters<typeof assertAvgProcessedImageArtifactFromDefinition<R>>[0]
export interface AvgVisualProcessingBinding {
  compilation:{artifactKey:string;version:number;contentHash:string}
  rule:{artifactKey:string;version:number;contentHash:string}
  scripts:Array<{artifactKey:string;version:number;contentHash:string}>
}
export function avgVisualProcessingQuality(version:1|2,binding:AvgVisualProcessingBinding,raw:ProductBuildArtifactRecordV1,receiptHash:string,sourceContextHash:string){
  return {schema:'storyforge.avg.visual-image-processing-evidence',version,noProviderRequest:true,decoderVerified:true,
    processingReceiptHash:receiptHash,rawProducerReceiptHash:raw.producerReceiptHash,
    sourceCompilation:binding.compilation,sourceRule:binding.rule,sourceScripts:binding.scripts,sourceContextHash}
}
/** Common physical recipe/claim bindings. The version-specific caller proves
 * the actual Brief, compiler, original request and producer independently. */
export async function inspectAvgVisualProcessingBinding<R extends Omit<AvgVisualProductionRequirementV1,'references'>>(input:{
  version:1|2;definition:Definition<R>;binding:AvgVisualProcessingBinding;raw:ProductBuildArtifactRecordV1;
  original:FrozenRuntimeMediaAssetV2;task:ProductProductionPlanTaskV3|undefined;
  artifact:AvgProcessedImageArtifactFieldsV1&Pick<ProductBuildArtifactRecordV1,'qualityJson'|'requirementKey'>
}){
  const {task,raw,artifact:a,version}=input,image=await assertAvgProcessedImageArtifactFromDefinition<R>(input.definition,a)
  const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
  const q=avgRecord(JSON.parse(a.qualityJson),['schema','version','noProviderRequest','decoderVerified','processingReceiptHash','rawProducerReceiptHash',
    'sourceCompilation','sourceRule','sourceScripts','sourceContextHash'],version===1?'V4 processing evidence':'V5 processing evidence')
  if(!task||task.kind!=='avg-media-image-process'||task.executionMode!=='deterministic'||task.contextProfile!==(version===1?'avg-visual-planning-v4':'avg-visual-planning-v5')
    ||task.skillId!==null||task.capabilityRequirementKeys.length||task.maxAttempts!==1||task.reuse!==null
    ||task.budgetReservation.modelCalls!==0||task.budgetReservation.mediaCalls!==0||task.budgetReservation.maximumCostUsd!==0
    ||task.taskKey!==`avg.media.process.${image.payload.requirementKey}`||task.outputArtifactKeys.length!==1||task.outputArtifactKeys[0]!==a.artifactKey
    ||!task.inputArtifactKeys.includes(raw.artifactKey)||!task.inputArtifactKeys.includes(input.binding.compilation.artifactKey)
    ||a.requirementKey!==null||!same(image.payload.raw,{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash,producerReceiptHash:raw.producerReceiptHash})
    ||!same(image.payload.sourceAsset,input.original)
    ||!same(q,avgVisualProcessingQuality(version,input.binding,raw,image.payload.receipt.receiptHash,avgHash(q.sourceContextHash,'processing context hash'))))throw new Error('[avg-process] 加工图没有绑定准确原图、配方、当前编译与零调用任务')
  return {...image,sourceContextHash:q.sourceContextHash as string}
}
