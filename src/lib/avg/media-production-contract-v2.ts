import { parseAvgVisualProductionBatchWithCodecs,parseAvgVisualProductionRequirementWithReferences,
  type AvgVisualProductionRequirementV1,type AvgVisualProductionBatchV1 } from './media-production-contract'
import { parseAvgMediaReferencesV2,type AvgMediaReferenceV2 } from './media-reference-contract-v2'
import { parseAvgCharacterFamilyBatchV2,type AvgCharacterFamilyBatchV2 } from './character-family-contract-v2'

export interface AvgVisualProductionRequirementV2 extends Omit<AvgVisualProductionRequirementV1,'references'> {
  references:AvgMediaReferenceV2[]
}
/** A separate frozen envelope. V1 readers cannot interpret these references. */
export interface AvgVisualProductionBatchV2 extends Omit<AvgVisualProductionBatchV1,'version'|'requirements'|'characterFamily'> {
  version:2
  requirements:AvgVisualProductionRequirementV2[]
  characterFamily?:AvgCharacterFamilyBatchV2
}
export function parseAvgVisualProductionRequirementV2(value:unknown):AvgVisualProductionRequirementV2 {
  return parseAvgVisualProductionRequirementWithReferences(value,parseAvgMediaReferencesV2)
}
export function parseAvgVisualProductionBatchV2(value:unknown):AvgVisualProductionBatchV2 {
  return parseAvgVisualProductionBatchWithCodecs(value,2,parseAvgVisualProductionRequirementV2,parseAvgCharacterFamilyBatchV2)
}
