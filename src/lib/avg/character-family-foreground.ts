import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../product-production/character-alpha-matting'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1, AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from './image-foreground-contract'
import { composeAvgCharacterFamilyRequirementsV1, parseAvgCharacterFamilyPlanV1, type AvgCharacterFamilyPlanV1 } from './character-family-contract'
import { assertAvgImageProcessingRequirements, parseAvgImageProcessingPlanV2, type AvgImageProcessingPlanV2 } from './image-processing-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from './image-foreground-boundary-unmix'
import { AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3 } from './image-foreground-estimated-magenta-v3'

type EditableFamily = Pick<AvgCharacterFamilyPlanV1,'alpha'|'identityInvariants'|'forbiddenDepictions'>
export function hasAvgCharacterFamilyReservedBackdropV1(plan:EditableFamily):boolean {
  return plan.identityInvariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)
    && plan.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
}

/** Editable author proposal only. The existing proposal hash and explicit
 * baseline permissions must be recalculated/reconfirmed after this change. */
export function setAvgCharacterFamilyReservedBackdropV1<T extends EditableFamily>(value:T,enabled:boolean):T {
  if(enabled&&value.alpha!=='required')throw new Error('[avg-family] 保留底色只适用于明确要求透明前景的家族')
  const plan=structuredClone(value)
  plan.identityInvariants=plan.identityInvariants.filter(text=>text!==AVG_RESERVED_MAGENTA_INVARIANT_V1)
  plan.forbiddenDepictions=plan.forbiddenDepictions.filter(text=>text!==AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  if(enabled){plan.identityInvariants.push(AVG_RESERVED_MAGENTA_INVARIANT_V1);plan.forbiddenDepictions.push(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)}
  return plan
}

/** Local recipe proposal for every exact variant. This never amends a family
 * or grants permissions: missing pre-request declarations are rejected. */
export function buildAvgCharacterFamilyForegroundProcessingPlanV1(value:AvgCharacterFamilyPlanV1,declaration:string):AvgImageProcessingPlanV2 {
  const plan=parseAvgCharacterFamilyPlanV1(value),requirements=composeAvgCharacterFamilyRequirementsV1(plan)
  const result=parseAvgImageProcessingPlanV2({schema:'storyforge.avg.image-processing-plan',version:2,
    entries:requirements.map(requirement=>({requirementKey:requirement.requirementKey,recipe:{
      schema:'storyforge.avg.image-processing-recipe',version:2,crop:null,width:plan.width,height:plan.height,
      fit:'contain',anchor:{x:5000,y:5000},background:null,declaration,
      foreground:{schema:'storyforge.avg.foreground-policy',version:1,method:'reserved-magenta',reservedColor:'#FF00FF',
        subjectUsesReservedColor:false,algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,declaration},
    }}))})
  assertAvgImageProcessingRequirements(result,requirements)
  return result
}

/** Explicit editable proposal only. Shared canvas/reservation requirements
 * reuse the existing builder; no old Run, producer or author approval is
 * relabelled. The actual new policy is reparsed before any draft can freeze. */
export function buildAvgCharacterFamilyForegroundProcessingPlan(value:AvgCharacterFamilyPlanV1,declaration:string,policyVersion:1|2|3):AvgImageProcessingPlanV2 {
  if(policyVersion===1)return buildAvgCharacterFamilyForegroundProcessingPlanV1(value,declaration)
  if(policyVersion!==2&&policyVersion!==3)throw new Error('[avg-family] 未登记的前景策略版本')
  const base=buildAvgCharacterFamilyForegroundProcessingPlanV1(value,declaration)
  return parseAvgImageProcessingPlanV2({...base,entries:base.entries.map(entry=>{
    if(entry.recipe.version!==2)throw new Error('[avg-family] 家族缺少明确前景配方')
    return {...entry,recipe:{...entry.recipe,foreground:policyVersion===2
      ?{...entry.recipe.foreground,version:2,method:'reserved-magenta',algorithm:AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2}
      :{...entry.recipe.foreground,version:3,method:'estimated-magenta-family',algorithm:AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3}}}
  })})
}
