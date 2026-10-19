import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,ProductProductionPlanV3,WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgVisualRoleProposalV5 } from './visual-role-proposal-v5'
import { validateAvgVisualSemanticV4 } from './visual-role-proposal'
import { readAvgVisualProposalEvidenceV5 } from './visual-planning-evidence'
import type { AvgVisualBibleV1,AvgMediaBriefV1 } from './visual-planning-contract'

/** Same generic author-candidate@6 semantics: exact original proposal, scope
 * hash, edited payload hash and author decision. The new Brief/Plan and new
 * actual producer proof own the version, never a renamed legacy request. */
export async function validateAvgVisualAuthorProposalV5(context:{scope:WorkspaceScope;brief:ProductProductionBriefV3;plan:ProductProductionPlanV3},
  payload:AvgVisualBibleV1|AvgMediaBriefV1,artifactKey:string,inputs:ProductBuildArtifactRecordV1[]):Promise<{
    proposal:{artifactKey:string;version:number;contentHash:string};scopeHash:string;originalPayloadHash:string;authorEdited:boolean;reuseSourceHash?:never
  }>{
  const planning=context.brief.avgVisualPlanning,originals=inputs.filter(r=>r.artifactKey.startsWith('avg.proposal.'))
  if(planning?.version!==5||originals.length!==1)throw new Error('[avg-visual-plan] 新采用必须绑定唯一新版原始方案')
  const original=originals[0],task=context.plan.tasks.find(t=>t.outputArtifactKeys.includes(original.artifactKey))
  if(!task||original.producerRunId===null||original.producerReceiptHash===null)throw new Error('[avg-visual-plan] 新原始方案缺少实际 producer')
  const proposal=await assertAvgVisualRoleProposalV5(original.payloadJson,task,planning.scope)
  if(proposal.targetArtifactKey!==artifactKey)throw new Error('[avg-visual-plan] 新采用不能借用其他岗位或主体')
  validateAvgVisualSemanticV4(payload,planning.scope,artifactKey)
  await readAvgVisualProposalEvidenceV5(context.scope,original)
  return {proposal:{artifactKey:original.artifactKey,version:original.version,contentHash:original.contentHash},scopeHash:proposal.scopeHash,
    originalPayloadHash:await hashProductProductionValueV2(proposal.payload),authorEdited:canonicalProductProductionJsonV2(payload)!==canonicalProductProductionJsonV2(proposal.payload)}
}
