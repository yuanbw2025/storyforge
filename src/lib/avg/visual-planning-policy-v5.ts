import { buildAvgVisualPlanningPlanV5 } from './visual-planning-plan-v5'
import { assertAvgVisualPlanningPolicyFieldsV1,deriveAvgVisualPlanningGateIdsV1,sumAvgVisualPlanningBudgetV1,type AvgVisualPlanningPolicyInputV1 } from './visual-planning-policy'
import type { ProductProductionBudgetV3 } from '../types'

export const AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5='avg-visual-planning-text-v5'
type PlanInput=Pick<AvgVisualPlanningPolicyInputV1,'avgVisualPlanning'|'capabilityRequirements'>
function topology(input:PlanInput){
  const v=input.avgVisualPlanning
  if(v?.version!==5)throw new Error('[avg-visual-plan] 缺少准确 V5 专业视觉合同')
  return buildAvgVisualPlanningPlanV5({brief:{...input,avgVisualPlanning:v},briefHash:'0'.repeat(64),buildNumber:1,controlEpoch:0})
}
export function avgVisualPlanningBudgetV5(input:PlanInput):ProductProductionBudgetV3{return sumAvgVisualPlanningBudgetV1(topology(input))}
export function avgVisualPlanningGateIdsV5(input:PlanInput):string[]{return deriveAvgVisualPlanningGateIdsV1(topology(input))}
export function assertAvgVisualPlanningPolicyV5(brief:AvgVisualPlanningPolicyInputV1):void {
  return assertAvgVisualPlanningPolicyFieldsV1(brief,{version:5,textDataClass:AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5,
    budget:()=>avgVisualPlanningBudgetV5(brief),gates:()=>avgVisualPlanningGateIdsV5(brief)})
}
