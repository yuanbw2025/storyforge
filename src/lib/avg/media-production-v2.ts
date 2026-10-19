/** Headless AVG R4b1 preparation boundary. These strict codecs and deterministic
 * proposals/requests have no DB writes, provider, Run or adoption authority.
 * Formal Brief/Plan/producer registration must precede any future dispatch. */
export { parseAvgVisualPlanningScopeV2,type AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
export { parseAvgVisualProductionRequirementV2,parseAvgVisualProductionBatchV2,
  type AvgVisualProductionRequirementV2,type AvgVisualProductionBatchV2 } from './media-production-contract-v2'
export { parseAvgCharacterFamilyPlanV2,parseAvgCharacterFamilyProposalV2,parseAvgCharacterFamilyBatchV2,
  composeAvgCharacterFamilyRequirementsV2,hashAvgCharacterFamilyProposalV2,
  type AvgCharacterFamilyPlanV2,type AvgCharacterFamilyProposalV2,type AvgCharacterFamilyBatchV2 } from './character-family-contract-v2'
export { freezeAvgVisualPlanningScopeV2,compileAvgVisualPlanningProposalV2,assertAvgVisualPlanningProposalV2,
  freezeAvgVisualProductionBatchV2,validateAvgVisualProductionBatchSourceV2 } from './media-source-v2'
export { prepareAvgRawImageRequestFromBatchV2 } from './media-request-v2'
