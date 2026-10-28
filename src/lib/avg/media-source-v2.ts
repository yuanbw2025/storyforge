import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgVisualProductionBatchV2,type AvgVisualProductionBatchV2 } from './media-production-contract-v2'
import { composeAvgCharacterFamilyRequirementsV2,hashAvgCharacterFamilyProposalV2 } from './character-family-contract-v2'
import { avgVisualPlanningTemplateRequirementsV2,parseAvgVisualPlanningScopeV2,type AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
import { parseAvgMediaBriefV1,parseAvgVisualBibleV1 } from './visual-planning-contract'
import { assertAvgMediaConsumerDeclarationsV1,assertAvgVisualRequirementSourceConsumersV1,composeAvgVisualPlanningRequirementsV1,
  hasAvgVisualPlanningSubjectV1,hashAvgMediaBriefInputsV1,hashAvgMediaSourceInputV1,normalizeAvgMediaSourceInputV1,type AvgMediaSourceInputV1 } from './media-source'
import { avgList,avgProtocolBody,avgRecord,avgUnique } from './protocol-validation'

/** The existing rules/text owner and consumers remain authoritative. New
 * references do not make new scenes, characters, item variants or slot grants. */
export async function validateAvgVisualProductionBatchSourceV2(value:unknown,input:AvgMediaSourceInputV1):Promise<AvgVisualProductionBatchV2>{
  const batch=parseAvgVisualProductionBatchV2(value),source=normalizeAvgMediaSourceInputV1(input)
  if(batch.aspectRatio!==source.aspectRatio||batch.sourceInputHash!==await hashProductProductionValueV2(source)){
    throw new Error('[avg-media] 系统、文本或画幅已变化，请重新冻结媒资需求')
  }
  if(batch.characterFamily){
    const {proposal}=batch.characterFamily,{proposalHash,...body}=proposal
    if(proposalHash!==await hashAvgCharacterFamilyProposalV2(body)||proposal.sourceInputHash!==batch.sourceInputHash
      ||!source.systemPlan.characters.some(c=>c.key===proposal.plan.subjectKey)
      ||canonicalProductProductionJsonV2(composeAvgCharacterFamilyRequirementsV2(proposal.plan))!==canonicalProductProductionJsonV2(batch.requirements)){
      throw new Error('[avg-family] 家族提案、授权或准确变体需求已变化，请重新核对')
    }
  }
  assertAvgVisualRequirementSourceConsumersV1(batch.requirements,source)
  return batch
}
export async function freezeAvgVisualProductionBatchV2(value:Omit<AvgVisualProductionBatchV2,'sourceInputHash'|'aspectRatio'>,input:AvgMediaSourceInputV1){
  const author=structuredClone(value),source=structuredClone(input)
  return validateAvgVisualProductionBatchSourceV2({...author,aspectRatio:source.presentation.aspectRatio,sourceInputHash:await hashAvgMediaSourceInputV1(source)},source)
}
async function validatePlanningScopeSourceV2(scope:AvgVisualPlanningScopeV2,source:AvgMediaSourceInputV1){
  const skeleton=await validateAvgVisualProductionBatchSourceV2({schema:'storyforge.avg.visual-production-batch',version:2,
    batchKey:scope.batchKey,revision:scope.revision,aspectRatio:scope.aspectRatio,sourceInputHash:scope.sourceInputHash,
    requirements:avgVisualPlanningTemplateRequirementsV2(scope)},source)
  assertAvgMediaConsumerDeclarationsV1(skeleton,source.systemPlan)
  for(const t of scope.templates){
    if(!hasAvgVisualPlanningSubjectV1(source.systemPlan,t.subjectKind,t.parameters.family.subjectKey))throw new Error('[avg-visual-plan] 策划主体种类与准确系统来源不一致')
  }
}
export async function freezeAvgVisualPlanningScopeV2(value:Omit<AvgVisualPlanningScopeV2,'sourceInputHash'|'aspectRatio'>,input:AvgMediaSourceInputV1):Promise<AvgVisualPlanningScopeV2>{
  const author=structuredClone(value),source=structuredClone(input)
  const scope=parseAvgVisualPlanningScopeV2({...author,aspectRatio:source.presentation.aspectRatio,sourceInputHash:await hashAvgMediaSourceInputV1(source)})
  await validatePlanningScopeSourceV2(scope,source)
  return scope
}

/** Same semantic composer, explicit later scope and batch. This produces a
 * deterministic proposal only, not a producer, adoption or model-call receipt. */
export async function compileAvgVisualPlanningProposalV2(input:{scope:unknown;visualBible:unknown;mediaBriefs:unknown;source:AvgMediaSourceInputV1}){
  const selected=structuredClone(input),source=selected.source,scope=parseAvgVisualPlanningScopeV2(selected.scope)
  const bible=parseAvgVisualBibleV1(selected.visualBible)
  const briefs=avgUnique(avgList(selected.mediaBriefs,'media briefs',parseAvgMediaBriefV1,8),b=>b.subjectKey,'media briefs')
  await validatePlanningScopeSourceV2(scope,source)
  const requirements=composeAvgVisualPlanningRequirementsV1(scope,bible,briefs,source.systemPlan)
  const batch=await validateAvgVisualProductionBatchSourceV2({schema:'storyforge.avg.visual-production-batch',version:2,
    batchKey:scope.batchKey,revision:scope.revision,aspectRatio:scope.aspectRatio,sourceInputHash:scope.sourceInputHash,
    visualReviewPolicy:'author-visual-v1',requirements},source)
  assertAvgMediaConsumerDeclarationsV1(batch,source.systemPlan)
  const mediaBriefs=await hashAvgMediaBriefInputsV1(briefs)
  return {schema:'storyforge.avg.visual-planning-proposal' as const,version:2 as const,batch,
    inputHashes:{scope:await hashProductProductionValueV2(scope),visualBible:await hashProductProductionValueV2(bible),mediaBriefs},
    batchHash:await hashProductProductionValueV2(batch)}
}
export async function assertAvgVisualPlanningProposalV2(value:unknown,input:Parameters<typeof compileAvgVisualPlanningProposalV2>[0]){
  const row=avgRecord(avgProtocolBody(value),['schema','version','batch','inputHashes','batchHash'],'visual planning proposal')
  const expected=await compileAvgVisualPlanningProposalV2(input)
  if(canonicalProductProductionJsonV2(row)!==canonicalProductProductionJsonV2(expected))throw new Error('[avg-visual-plan] 策划提案、语义输入或冻结范围已变化')
  return expected
}
