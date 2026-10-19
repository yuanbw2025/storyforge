import { avgProtocolBody,avgRecord } from './protocol-validation'
import { parseAvgAssemblyBriefV1 } from './assembly-contract'
import { parseAvgVisualPlanningScopeV2,type AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
import { assertAvgVisualPlanningAssemblyTargetsV1,parseAvgVisualImageBindingV4,avgVisualPlanningExecutionReadyV4,type AvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { assertAvgImageProcessingRequirementsV1,parseAvgImageProcessingPlanV1 } from './image-processing-contract'

/** Explicit new contract. Old reuse packets cannot claim a model used the new
 * per-reference policy; current V5 production must get its own actual evidence. */
export interface AvgVisualPlanningBriefV5 extends Omit<AvgVisualPlanningBriefV4,'version'|'scope'|'proposalReuse'|'rawReuse'> {
  version:5
  scope:AvgVisualPlanningScopeV2
  proposalReuse?:never
  rawReuse?:never
}
export function parseAvgVisualPlanningBriefV5(value:unknown):AvgVisualPlanningBriefV5 {
  const body=avgProtocolBody(value),hasProcessing=Object.prototype.hasOwnProperty.call(body??{},'imageProcessing')
  const r=avgRecord(body,['schema','version','assembly','scope','imageBinding',...(hasProcessing?['imageProcessing']:[])],'V5 visual planning Brief')
  if(r.schema!=='storyforge.avg.visual-planning-brief'||r.version!==5)throw new Error('[avg-visual-plan] V5 专业视觉 Brief 版本无效')
  const assembly=parseAvgAssemblyBriefV1(r.assembly),scope=parseAvgVisualPlanningScopeV2(r.scope),imageBinding=parseAvgVisualImageBindingV4(r.imageBinding)
  assertAvgVisualPlanningAssemblyTargetsV1(assembly,scope)
  const imageProcessing=hasProcessing?parseAvgImageProcessingPlanV1(r.imageProcessing):undefined
  if(imageProcessing)assertAvgImageProcessingRequirementsV1(imageProcessing,scope.templates.map(t=>t.parameters))
  return {schema:r.schema,version:5,assembly,scope,imageBinding,...(imageProcessing?{imageProcessing}:{})}
}
/** The connected workbench shares the original two default-off experiment
 * switches. Actual Brief/start, versioned inputs and per-task authority remain
 * mandatory; this never promotes an old V4 packet into a V5 request. */
export function avgVisualPlanningExecutionReadyV5():boolean{return avgVisualPlanningExecutionReadyV4()}
