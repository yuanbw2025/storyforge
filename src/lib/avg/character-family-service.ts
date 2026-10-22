import type { WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgDraftV1 } from './draft-service'
import { readAvgDraftReferenceBytesV1, saveAvgAuthorWorkspaceV1 } from './editor-service'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { composeAvgCharacterFamilyRequirementsV1, hashAvgCharacterFamilyProposalV1, parseAvgCharacterFamilyBatchV1,
  parseAvgCharacterFamilyPlanV1, parseAvgCharacterFamilyProposalV1, type AvgCharacterFamilyPlanV1, type AvgCharacterFamilyProposalV1 } from './character-family-contract'
import { freezeAvgVisualProductionBatchV1, hashAvgMediaSourceInputV1 } from './media-source'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { verifyAvgReferenceBytesV1 } from './media-reference-contract'
import { parseAvgImageProcessingPlan,assertAvgImageProcessingRequirements,type AvgImageProcessingPlan } from './image-processing-contract'

/** Replace only the current same-family draft's automatic actor cues. Custom
 * uses of those pictures need an explicit author edit, never a guessed rewrite. */
function familyDraft(workspace:AvgAuthorWorkspaceV1,plan:AvgCharacterFamilyPlanV1){
  const next=parseAvgAuthorWorkspaceV1(workspace),old=next.mediaBatch?.characterFamily?.proposal.plan
  if(!old||old.familyKey!==plan.familyKey)return next
  if(old.subjectKey!==plan.subjectKey)throw new Error('[avg-family] 不能将同一家族改为另一人物')
  const requirements=next.mediaBatch!.requirements,keys=new Set(requirements.map(r=>r.assetKey))
  for(const cue of next.presentation.stage.cues){
    if(!cue.assetKey||!keys.has(cue.assetKey))continue
    const r=requirements.find(r=>r.assetKey===cue.assetKey)!
    if(cue.cueKey!==`avg.media.${r.requirementKey}`||cue.type!=='show-actor'||cue.actorKey!==old.subjectKey||cue.beatKey!==r.triggerBeatKey)throw new Error('[avg-family] 旧家族图还有自定义演出引用，请先明确调整这些引用')
  }
  next.presentation.stage.cues=next.presentation.stage.cues.filter(cue=>!cue.assetKey||!keys.has(cue.assetKey))
  next.presentation.stage.assets=next.presentation.stage.assets.filter(asset=>!keys.has(asset.assetKey))
  if(next.presentation.inheritedImages)next.presentation.inheritedImages=next.presentation.inheritedImages.filter(entry=>!keys.has(entry.assetKey))
  return next
}

/** Deterministic author proposal; it grants no provider permission or adoption. */
export async function prepareAvgCharacterFamilyProposalV1(input:{scope:WorkspaceScope;expectedDraftRevision:number;plan:AvgCharacterFamilyPlanV1}){
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision)throw new Error('[avg-family] 编辑草稿已变化')
  const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson),plan=parseAvgCharacterFamilyPlanV1(input.plan),next=familyDraft(workspace,plan)
  const batch=await freezeAvgVisualProductionBatchV1({schema:'storyforge.avg.visual-production-batch',version:1,batchKey:`family.${plan.familyKey}`,
    revision:(workspace.mediaBatch?.revision??0)+1,requirements:composeAvgCharacterFamilyRequirementsV1(plan),visualReviewPolicy:'author-visual-v1'},next)
  await validateAvgGeneratedReferencesV1(input.scope,batch.requirements[0].references,batch.requirements[0].family)
  const baseline=batch.requirements[0].references[0]
  await verifyAvgReferenceBytesV1(baseline,await readAvgDraftReferenceBytesV1(input.scope,baseline))
  const body={schema:'storyforge.avg.character-family-proposal' as const,version:1 as const,plan,sourceInputHash:batch.sourceInputHash,
    sourceDraftHash:await hashProductProductionValueV2(workspace)}
  return parseAvgCharacterFamilyProposalV1({...body,proposalHash:await hashAvgCharacterFamilyProposalV1(body)})
}

/** Saves a reviewed finite family batch into the ordinary author draft. Only
 * the existing Brief/start/Skill/choice/stage-adopt path may produce or use it. */
export async function saveAvgCharacterFamilyBatchDraftV1(input:{scope:WorkspaceScope;expectedDraftRevision:number;proposal:AvgCharacterFamilyProposalV1;
  imageProcessing?:AvgImageProcessingPlan|null;
  approval:{proposalHash:string;providerInputAllowed:boolean;derivativeUseAllowed:boolean;declaration:string}}){
  const family=parseAvgCharacterFamilyBatchV1({proposal:input.proposal,approval:input.approval})
  const processingSpecified=Object.prototype.hasOwnProperty.call(input,'imageProcessing')
  const processing=processingSpecified?(input.imageProcessing===null?null:parseAvgImageProcessingPlan(input.imageProcessing)):undefined
  const fresh=await prepareAvgCharacterFamilyProposalV1({scope:input.scope,expectedDraftRevision:input.expectedDraftRevision,plan:family.proposal.plan})
  if(canonicalProductProductionJsonV2(fresh)!==canonicalProductProductionJsonV2(family.proposal))throw new Error('[avg-family] 提案或编辑草稿已变化，请重新核对准确方案')
  const draft=await readAvgDraftV1(input.scope)
  if(draft.revision!==input.expectedDraftRevision)throw new Error('[avg-family] 编辑草稿已变化')
  const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson),next=familyDraft(workspace,family.proposal.plan)
  if(await hashAvgMediaSourceInputV1(next)!==family.proposal.sourceInputHash)throw new Error('[avg-family] 来源已变化')
  next.mediaBatch=await freezeAvgVisualProductionBatchV1({schema:'storyforge.avg.visual-production-batch',version:1,batchKey:`family.${family.proposal.plan.familyKey}`,
    revision:(workspace.mediaBatch?.revision??0)+1,requirements:composeAvgCharacterFamilyRequirementsV1(family.proposal.plan),characterFamily:family,visualReviewPolicy:'author-visual-v1'},next)
  if(processing)assertAvgImageProcessingRequirements(processing,next.mediaBatch.requirements)
  if(processingSpecified){if(processing===null)delete next.imageProcessing;else next.imageProcessing=processing}
  return saveAvgAuthorWorkspaceV1(input.scope,draft.revision,next)
}
