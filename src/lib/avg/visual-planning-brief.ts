import { parseAvgVisualRawReuseSourcesV4, type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'
import { avgKey, avgHash, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgAssemblyBriefV1, type AvgAssemblyBriefV1, type AvgAssemblyBriefV2 } from './assembly-contract'
import { parseAvgVisualPlanningScopeV1, type AvgVisualPlanningScopeV1 } from './visual-planning-contract'
import { avgMediaProductionEnabledV2 } from './assembly-contract'
import { parseAvgVisualProposalReuseSourcesV4, type AvgVisualProposalReuseSourceV4 } from './visual-planning-reuse-contract'
import { avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from './media-reference-contract'
import { parseAvgImageProcessingPlan,assertAvgImageProcessingRequirements,type AvgImageProcessingPlan } from './image-processing-contract'

export interface AvgVisualImageBindingV4 extends Omit<AvgAssemblyBriefV2['imageBinding'],'adapterId'> {adapterId:AvgImageAdapterIdV4}

/** Explicit next private contract. Existing assembly V1/V2/V3 bytes retain
 * their original meaning; no placeholder request is stored in this Brief. */
export interface AvgVisualPlanningBriefV4 {
  schema: 'storyforge.avg.visual-planning-brief'
  version: 4
  assembly: AvgAssemblyBriefV1
  scope: AvgVisualPlanningScopeV1
  imageBinding: AvgVisualImageBindingV4
  proposalReuse?: AvgVisualProposalReuseSourceV4[]
  rawReuse?: AvgVisualRawReuseSourceV4[]
  imageProcessing?:AvgImageProcessingPlan
}

export function parseAvgVisualPlanningBriefV4(value: unknown): AvgVisualPlanningBriefV4 {
  const body=avgProtocolBody(value)
  const hasRawReuse=Object.prototype.hasOwnProperty.call(body??{},'rawReuse')
  const hasReuse=Object.prototype.hasOwnProperty.call(body??{},'proposalReuse')
  const hasProcessing=Object.prototype.hasOwnProperty.call(body??{},'imageProcessing')
  const r = avgRecord(body, ['schema', 'version', 'assembly', 'scope', 'imageBinding',
    ...(hasReuse?['proposalReuse']:[]),...(hasRawReuse?['rawReuse']:[]),...(hasProcessing?['imageProcessing']:[])], 'visual planning Brief')
  if (r.schema !== 'storyforge.avg.visual-planning-brief' || r.version !== 4) throw new Error('[avg-visual-plan] 专业视觉 Brief 版本无效')
  const assembly = parseAvgAssemblyBriefV1(r.assembly), scope = parseAvgVisualPlanningScopeV1(r.scope)
  const imageProcessing=hasProcessing?parseAvgImageProcessingPlan(r.imageProcessing):undefined
  if(imageProcessing)assertAvgImageProcessingRequirements(imageProcessing,scope.templates.map(t=>({...t.parameters,invariants:t.requiredDetails,forbiddenDepictions:t.forbiddenDepictions})))
  const imageBinding=parseAvgVisualImageBindingV4(r.imageBinding)
  assertAvgVisualPlanningAssemblyTargetsV1(assembly,scope)
  return { schema: r.schema, version: 4, assembly, scope, imageBinding,
    ...(hasReuse?{proposalReuse:parseAvgVisualProposalReuseSourcesV4(r.proposalReuse,scope)}:{}),
    ...(hasRawReuse?{rawReuse:parseAvgVisualRawReuseSourcesV4(r.rawReuse,scope.templates.map(t=>t.parameters.requirementKey))}:{}),
    ...(imageProcessing?{imageProcessing}:{}) }
}

/** Same frozen route/binding grammar for explicit private Brief versions. */
export function parseAvgVisualImageBindingV4(value:unknown):AvgVisualImageBindingV4 {
  const b=avgRecord(value,['requirementKey','adapterId','bindingHash','endpointRouteHash'],'planning image binding')
  const selected=avgImageReferenceCapabilityV2(String(b.adapterId))
  if(b.requirementKey!=='avg.media.image')throw new Error('[avg-visual-plan] 图片能力与准确 Agnes 路由不一致')
  return {requirementKey:avgKey(b.requirementKey,'requirementKey'),adapterId:selected.adapterId,
    bindingHash:avgHash(b.bindingHash,'bindingHash'),endpointRouteHash:avgHash(b.endpointRouteHash,'endpointRouteHash')}
}
export function assertAvgVisualPlanningAssemblyTargetsV1(assembly:AvgAssemblyBriefV1,scope:Pick<AvgVisualPlanningScopeV1,'templates'>){
  for(const template of scope.templates){
    const p=template.parameters
    if(p.consumer.sceneKey!==null&&!assembly.sceneKeys.includes(p.consumer.sceneKey))throw new Error('[avg-visual-plan] 消费槽不在冻结场景中')
    if(assembly.mediaAssetKeys.includes(p.assetKey)===(p.consumer.domain==='reference'))throw new Error('[avg-visual-plan] runtime 媒资目录与图片用途不一致')
  }
}

/** Separate default-off professional workbench experiment. Both switches,
 * explicit start and the existing per-task authority remain required. */
export function avgVisualPlanningExecutionReadyV4(): boolean {
  return avgMediaProductionEnabledV2() && import.meta.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING === '1'
}
