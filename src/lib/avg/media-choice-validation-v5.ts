import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { parseAvgAuthorMediaChoice,type AvgAuthorMediaChoice } from './media-production-contract'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { inspectAvgChosenImageBytesV1 } from './media-choice-validation'
import { inspectAvgProcessedImageSourceV5,readAvgProcessedImageSourceV5 } from './image-processing-source-v5'

/** Choice identity is still the exact original row/asset/use declaration;
 * request and reference meanings remain in their explicit raw2 proof. */
export async function readAvgChosenMediaSourceV5(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3;choice:AvgAuthorMediaChoice}){
  const choice=parseAvgAuthorMediaChoice(input.choice)
  const row=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,...choice.raw})
  return inspectAvgChosenImageV5({...input,choice,row})
}
export async function inspectAvgChosenImageV5(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;choice:AvgAuthorMediaChoice;row:ProductBuildArtifactRecordV1;processed?:ProductBuildArtifactRecordV1}){
  const choice=parseAvgAuthorMediaChoice(input.choice),raw=await assertAvgConsumedRawImageV5(input)
  const frozenProcessing=raw.compiled.planning.imageProcessing?.entries.some(e=>e.requirementKey===raw.requirement.requirementKey)??false
  if(frozenProcessing!==(choice.version===2))throw new Error('[avg-process] 选择不能绕过冻结的加工步骤，也不能夹带未冻结加工')
  const processed=choice.version===2?(input.processed?await inspectAvgProcessedImageSourceV5({...input,raw:input.row,processed:input.processed})
    :await readAvgProcessedImageSourceV5({scope:input.scope,buildId:input.row.buildId,brief:input.brief,raw:input.row,version:choice.processed.version,contentHash:choice.processed.contentHash})):undefined
  if(choice.version===2&&(!processed||processed.row.artifactKey!==choice.processed.artifactKey||processed.row.version!==choice.processed.version||processed.row.contentHash!==choice.processed.contentHash))throw new Error('[avg-process] 选择的准确加工版本已变化')
  return inspectAvgChosenImageBytesV1({scope:input.scope,choice,row:input.row,processed,image:processed?.row??input.row,asset:processed?.asset??raw.asset,requirement:raw.requirement})
}
