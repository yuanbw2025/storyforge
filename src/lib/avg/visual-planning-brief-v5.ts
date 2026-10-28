import { avgProtocolBody,avgRecord } from './protocol-validation'
import { parseAvgAssemblyBriefV1 } from './assembly-contract'
import { parseAvgVisualPlanningScopeV2,type AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
import { assertAvgVisualPlanningAssemblyTargetsV1,parseAvgVisualImageBindingV4,avgVisualPlanningExecutionReadyV4,type AvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { assertAvgImageProcessingRequirements,parseAvgImageProcessingPlan } from './image-processing-contract'
import { parseAvgVisualRawReuseSourcesV5,type AvgVisualRawReuseSourceV5 } from './visual-image-reuse-contract'
import { parseAvgVisualProposalReuseSourcesV5,type AvgVisualProposalReuseSourceV5 } from './visual-planning-reuse-contract'
import { readAvgRegionRecipeReferenceV1 } from './image-region-composite-binding'

/** V5 reuses only a separately proved V5/raw2 source. V4 proof packets remain
 * structurally incompatible and cannot claim the new per-reference policy. */
export interface AvgVisualPlanningBriefV5 extends Omit<AvgVisualPlanningBriefV4,'version'|'scope'|'proposalReuse'|'rawReuse'> {
  version:5
  scope:AvgVisualPlanningScopeV2
  proposalReuse?:AvgVisualProposalReuseSourceV5[]
  rawReuse?:AvgVisualRawReuseSourceV5[]
}
export function parseAvgVisualPlanningBriefV5(value:unknown):AvgVisualPlanningBriefV5 {
  const body=avgProtocolBody(value),hasProcessing=Object.prototype.hasOwnProperty.call(body??{},'imageProcessing'),hasReuse=Object.prototype.hasOwnProperty.call(body??{},'rawReuse'),hasProposalReuse=Object.prototype.hasOwnProperty.call(body??{},'proposalReuse')
  const r=avgRecord(body,['schema','version','assembly','scope','imageBinding',...(hasProcessing?['imageProcessing']:[]),...(hasReuse?['rawReuse']:[]),...(hasProposalReuse?['proposalReuse']:[])],'V5 visual planning Brief')
  if(r.schema!=='storyforge.avg.visual-planning-brief'||r.version!==5)throw new Error('[avg-visual-plan] V5 专业视觉 Brief 版本无效')
  const assembly=parseAvgAssemblyBriefV1(r.assembly),scope=parseAvgVisualPlanningScopeV2(r.scope),imageBinding=parseAvgVisualImageBindingV4(r.imageBinding)
  assertAvgVisualPlanningAssemblyTargetsV1(assembly,scope)
  const imageProcessing=hasProcessing?parseAvgImageProcessingPlan(r.imageProcessing):undefined
  if(imageProcessing)assertAvgImageProcessingRequirements(imageProcessing,scope.templates.map(t=>({...t.parameters,invariants:t.requiredDetails,forbiddenDepictions:t.forbiddenDepictions})))
  for(const entry of imageProcessing?.entries??[])if(entry.recipe.version===3){
    const template=scope.templates.find(t=>t.parameters.requirementKey===entry.requirementKey)!
    readAvgRegionRecipeReferenceV1(entry.recipe,{mediaKind:template.parameters.mediaKind,
      references:scope.referenceCatalog.filter(r=>template.allowedReferenceKeys.includes(r.referenceKey)).map(r=>r.reference)})
  }
  const rawReuse=hasReuse?parseAvgVisualRawReuseSourcesV5(r.rawReuse,scope.templates.map(t=>t.parameters.requirementKey)):undefined
  const proposalReuse=hasProposalReuse?parseAvgVisualProposalReuseSourcesV5(r.proposalReuse,scope):undefined
  return {schema:r.schema,version:5,assembly,scope,imageBinding,...(imageProcessing?{imageProcessing}:{}),...(proposalReuse?{proposalReuse}:{}),...(rawReuse?{rawReuse}:{})}
}
/** The connected workbench shares the original two default-off experiment
 * switches. Actual Brief/start, versioned inputs and per-task authority remain
 * mandatory; this never promotes an old V4 packet into a V5 request. */
export function avgVisualPlanningExecutionReadyV5():boolean{return avgVisualPlanningExecutionReadyV4()}
