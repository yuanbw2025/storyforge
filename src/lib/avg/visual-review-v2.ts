import type { FrozenRuntimeMediaAssetV2,ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { readAvgDraftReferenceBytesV2 } from './editor-service'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { assertAvgVisualObservationScopeV1,assertAvgVisualObservationSelectableV1,validateAvgVisualObservedBytesV1 } from './visual-review'
import { assertAvgReferencePolicyReviewV2,assertAvgReferencePolicySelectableV2,parseAvgAuthorVisualReviewV2 } from './visual-review-contract-v2'
import { inspectAvgProcessedImageSourceV5 } from './image-processing-source-v5'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'

/** New policy observations remain explicit author input. A transmitted policy
 * or a received/decoded original never becomes a fabricated review pass. */
export async function validateAvgAuthorVisualReviewV2(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;payload:unknown;processed?:ProductBuildArtifactRecordV1}){
  const raw=await assertAvgConsumedRawImageV5({...input,row:input.raw}),report=parseAvgAuthorVisualReviewV2(input.payload)
  if(!raw.compiled.definition.mediaBatch.visualReviewPolicy)throw new Error('[avg-review] 新版批次未声明作者评审合同')
  const frozenProcessing=raw.compiled.planning.imageProcessing?.entries.some(e=>e.requirementKey===raw.requirement.requirementKey)??false
  if(frozenProcessing!==Boolean(input.processed))throw new Error('[avg-review] 评审必须绑定准确冻结的加工图，不能改用原图绕过')
  const processed=input.processed?await inspectAvgProcessedImageSourceV5({...input,processed:input.processed}):undefined
  return validateAvgAuthorVisualReviewFromSourceV2({scope:input.scope,payload:report,requirement:raw.requirement,image:processed?.row??input.raw,asset:processed?.asset??raw.asset})
}
/** Original source authority is proved by the versioned caller. Observation
 * and exact Work bytes use the same checks for current and historical reads. */
export async function validateAvgAuthorVisualReviewFromSourceV2(input:{scope:WorkspaceScope;payload:unknown;
  requirement:AvgVisualProductionRequirementV2;image:ProductBuildArtifactRecordV1;asset:FrozenRuntimeMediaAssetV2}){
  const report=parseAvgAuthorVisualReviewV2(input.payload),{requirement:r}=input
  assertAvgVisualObservationScopeV1(report,r,input.image.contentHash)
  await assertAvgReferencePolicyReviewV2(report,r)
  return validateAvgVisualObservedBytesV1({scope:input.scope,report,requirement:r,image:input.image,asset:input.asset,
    readReference:reference=>readAvgDraftReferenceBytesV2(input.scope,reference,r.family)})
}
export async function assertAvgVisualReviewSelectableV2(value:unknown,requirement:AvgVisualProductionRequirementV2,rawHash:string){
  const report=parseAvgAuthorVisualReviewV2(value)
  assertAvgVisualObservationScopeV1(report,requirement,rawHash)
  await assertAvgReferencePolicyReviewV2(report,requirement)
  assertAvgVisualObservationSelectableV1(report);assertAvgReferencePolicySelectableV2(report)
  return report
}
