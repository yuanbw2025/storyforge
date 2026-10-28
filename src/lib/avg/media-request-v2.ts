import { prepareAvgRawImageRequestFieldsV1,type prepareAvgRawImageRequestFromBatchV1 } from './media-raw-contract'
import { parseAvgVisualProductionBatchV2,type AvgVisualProductionBatchV2 } from './media-production-contract-v2'
import { freezeAvgImageRequestV2 } from './media-reference-contract-v2'

/** Pure preparation from a versioned compiled batch, not a call or admission.
 * The formal caller must prove its real frozen Brief/Plan/author authority. */
export async function prepareAvgRawImageRequestFromBatchV2(input:Omit<Parameters<typeof prepareAvgRawImageRequestFromBatchV1>[0],'batch'>&{batch:AvgVisualProductionBatchV2}){
  const selected=structuredClone(input),batch=parseAvgVisualProductionBatchV2(selected.batch)
  const fields=await prepareAvgRawImageRequestFieldsV1({...selected,batch})
  return freezeAvgImageRequestV2({request:fields.request,resolutionTier:fields.resolutionTier,
    references:fields.requirement.references,targetFamily:fields.requirement.family})
}
