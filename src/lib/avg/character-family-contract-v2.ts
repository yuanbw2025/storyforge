import { composeAvgCharacterFamilyRequirementsWithReferences,parseAvgCharacterFamilyBatchWithProposal,
  parseAvgCharacterFamilyPlanWithBaseline,parseAvgCharacterFamilyProposalWithPlan,
  type AvgCharacterFamilyPlanV1,type AvgCharacterFamilyBatchV1 } from './character-family-contract'
import { parseAvgMediaReferencesV2,type AvgMediaReferenceV2 } from './media-reference-contract-v2'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'
import { hashProductProductionValueV2 } from '../product-production/hash'

/** Exact outbound reference, including selected original/processed source and
 * content limits. Parsing remains inert; current author approval is separate. */
export interface AvgCharacterFamilyPlanV2 extends Omit<AvgCharacterFamilyPlanV1,'version'|'baseline'> {
  version:2
  baseline:AvgMediaReferenceV2
}
export interface AvgCharacterFamilyProposalV2 {
  schema:'storyforge.avg.character-family-proposal';version:2;plan:AvgCharacterFamilyPlanV2
  sourceInputHash:string;sourceDraftHash:string;proposalHash:string
}
export interface AvgCharacterFamilyBatchV2 {
  proposal:AvgCharacterFamilyProposalV2
  approval:AvgCharacterFamilyBatchV1['approval']
}
export function parseAvgCharacterFamilyPlanV2(value:unknown):AvgCharacterFamilyPlanV2 {
  return parseAvgCharacterFamilyPlanWithBaseline(value,2,value=>{
    const baseline=parseAvgMediaReferencesV2([value])[0]!
    if(baseline.purpose!=='identity')throw new Error('[avg-family] 人物家族基准必须明确用于身份参考')
    return baseline
  })
}
export function parseAvgCharacterFamilyProposalV2(value:unknown):AvgCharacterFamilyProposalV2 {
  return parseAvgCharacterFamilyProposalWithPlan(value,2,parseAvgCharacterFamilyPlanV2)
}
export function parseAvgCharacterFamilyBatchV2(value:unknown):AvgCharacterFamilyBatchV2 {
  return parseAvgCharacterFamilyBatchWithProposal(value,parseAvgCharacterFamilyProposalV2)
}
export async function hashAvgCharacterFamilyProposalV2(value:Omit<AvgCharacterFamilyProposalV2,'proposalHash'>){
  return hashProductProductionValueV2(value)
}

/** Same deterministic actor targets; no image, Run, adoption or provider grant.
 * Per-reference limits and family/variant instructions all survive composition. */
export function composeAvgCharacterFamilyRequirementsV2(value:AvgCharacterFamilyPlanV2):AvgVisualProductionRequirementV2[]{
  const plan=parseAvgCharacterFamilyPlanV2(value)
  return composeAvgCharacterFamilyRequirementsWithReferences(plan,v=>parseAvgMediaReferencesV2([{...plan.baseline,
    allowedChange:`${plan.baseline.allowedChange}\n本家族允许：${plan.allowedChange}\n本变体允许：${v.changeDescription}`}]))
}
