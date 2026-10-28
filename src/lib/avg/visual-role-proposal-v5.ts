import type { ProductProductionPlanTaskV3 } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { avgHash,avgKey,avgProtocolBody,avgRecord } from './protocol-validation'
import { avgMediaBriefArtifactKeyV1 } from './visual-planning-contract'
import { parseAvgVisualPlanningScopeV2,type AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
import { AVG_VISUAL_PLANNING_ROLES_V5 } from './visual-planning-roles-v5'
import { avgVisualPlanningTargetKeysV4 } from './visual-planning-reuse-contract'
import { avgVisualProposalArtifactKeyV4 } from './visual-planning-plan'
import { validateAvgVisualSemanticV4,type AvgVisualRoleProposalV1 } from './visual-role-proposal'

export interface AvgVisualRoleProposalV5 extends Omit<AvgVisualRoleProposalV1,'version'>{version:3}
export interface AvgVisualRoleProposalReuseV5 extends Omit<AvgVisualRoleProposalV5,'version'>{version:4;modelPayload:AvgVisualRoleProposalV1['payload']}
export function isAvgVisualReuseTaskV5(task:ProductProductionPlanTaskV3){
  return task.kind==='avg-v5-visual-proposal-reuse'&&task.executionMode==='deterministic'&&task.skillId===null
    &&task.contextProfile==='avg-visual-planning-v5'&&task.capabilityRequirementKeys.length===0&&task.maxAttempts===1&&task.reuse===null
    &&task.budgetReservation.modelCalls===0&&task.budgetReservation.mediaCalls===0&&task.budgetReservation.maximumCostUsd===0
}
export function avgVisualRoleTargetV5(task:ProductProductionPlanTaskV3,value:AvgVisualPlanningScopeV2):string{
  const scope=parseAvgVisualPlanningScopeV2(value)
  if(isAvgVisualReuseTaskV5(task)){
    const targets=avgVisualPlanningTargetKeysV4(scope).filter(key=>task.outputArtifactKeys.length===1
      &&task.outputArtifactKeys[0]===key.replace(/^avg\.media\./,'avg.proposal.'))
    if(targets.length!==1)throw new Error('[avg-visual-reuse] V5 确定性任务与准确岗位不一致')
    return targets[0]
  }
  const role=AVG_VISUAL_PLANNING_ROLES_V5.find(r=>r.skillId===task.skillId)
  if(!role||task.executionMode!=='model'||task.outputArtifactKeys.length!==1||task.maxAttempts!==1
    ||task.kind!==(role.subjectKind===null?'avg-v5-visual-direction-proposal':'avg-v5-subject-visual-proposal'))throw new Error('[avg-visual-plan] 新方案任务不属于准确新版岗位')
  if(role.subjectKind===null&&task.outputArtifactKeys[0]===avgVisualProposalArtifactKeyV4(null))return 'avg.media.visual-bible'
  const selected=[...new Map(scope.templates.map(t=>[t.parameters.family.subjectKey,t.subjectKind])).entries()]
    .filter(([key,kind])=>kind===role.subjectKind&&task.outputArtifactKeys[0]===avgVisualProposalArtifactKeyV4(kind,key))
  if(selected.length!==1)throw new Error('[avg-visual-plan] 新岗位与准确主体写域不一致')
  return avgMediaBriefArtifactKeyV1(selected[0][1],selected[0][0])
}
export async function prepareAvgVisualRoleProposalV5(output:string,task:ProductProductionPlanTaskV3,scope:AvgVisualPlanningScopeV2):Promise<AvgVisualRoleProposalV5>{
  const targetArtifactKey=avgVisualRoleTargetV5(task,scope)
  return {schema:'storyforge.avg.visual-role-proposal',version:3,targetArtifactKey,scopeHash:await hashProductProductionValueV2(scope),
    payload:validateAvgVisualSemanticV4(parseProductionModelJsonObjectV1(output,task.taskKey),scope,targetArtifactKey)}
}
export async function assertAvgVisualRoleProposalV5(value:unknown,task:ProductProductionPlanTaskV3,scope:AvgVisualPlanningScopeV2){
  const reuse=isAvgVisualReuseTaskV5(task)
  const r=avgRecord(avgProtocolBody(value),['schema','version','targetArtifactKey','scopeHash','payload',...(reuse?['modelPayload']:[])],'V5 visual role proposal')
  if(r.schema!=='storyforge.avg.visual-role-proposal'||r.version!==(reuse?4:3)||avgKey(r.targetArtifactKey,'proposal target')!==avgVisualRoleTargetV5(task,scope)
    ||avgHash(r.scopeHash,'scopeHash')!==await hashProductProductionValueV2(scope))throw new Error('[avg-visual-plan] 新原始方案与准确冻结范围/岗位不一致')
  const payload=validateAvgVisualSemanticV4(r.payload,scope,String(r.targetArtifactKey))
  if(canonicalProductProductionJsonV2(payload)!==canonicalProductProductionJsonV2(r.payload))throw new Error('[avg-visual-plan] 新原始方案不是严格语义输出')
  const base={schema:r.schema,targetArtifactKey:String(r.targetArtifactKey),scopeHash:String(r.scopeHash),payload}
  if(!reuse)return {...base,version:3 as const}
  const modelPayload=validateAvgVisualSemanticV4(r.modelPayload,scope,String(r.targetArtifactKey))
  if(canonicalProductProductionJsonV2(modelPayload)!==canonicalProductProductionJsonV2(r.modelPayload))throw new Error('[avg-visual-reuse] V5 原模型内容不是准确语义输出')
  return {...base,version:4 as const,modelPayload}
}
