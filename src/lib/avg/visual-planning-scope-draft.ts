import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgVisualPlanningScopeV1, avgVisualPlanningTemplateRequirementsV1, type AvgVisualPlanningScopeV1 } from './visual-planning-contract'
import { prepareAvgMediaConsumerDeclarationsV1 } from './media-configuration'
import { freezeAvgVisualPlanningScopeV1, hashAvgMediaSourceInputV1 } from './media-source'
import type { AvgVisualPlanningDraftV4 } from './visual-planning-workspace'

/** Pure S2 proposal: only existing item image slots can be declared. No
 * gameplay predicate, canonical rule, media, request or adoption is created. */
export async function prepareAvgVisualPlanningSourceDraftV4(input: {
  workspace: AvgAuthorWorkspaceV1; planning: AvgVisualPlanningDraftV4; previous?: AvgVisualPlanningScopeV1 | AvgVisualPlanningScopeV1[]
}) {
  let workspace=parseAvgAuthorWorkspaceV1(input.workspace)
  const scope=parseAvgVisualPlanningScopeV1({...input.planning,aspectRatio:workspace.presentation.aspectRatio,sourceInputHash:await hashAvgMediaSourceInputV1(workspace)})
  // Revise only exact unused proposals from this Production's saved history.
  // A Brief may have been saved before its consumer draft write failed.
  // Selected media and unrelated
  // author bindings cannot be cleared merely to make a new request fit.
  const previous=input.previous===undefined?[]:Array.isArray(input.previous)?input.previous:[input.previous]
  for(const t of previous.flatMap(s=>s.templates)){
    const p=t.parameters,c=p.consumer
    if(!['inventory','evidence'].includes(c.domain)||workspace.presentation.stage.assets.some(a=>a.assetKey===p.assetKey))continue
    const item=workspace.systemPlan.version===2?workspace.systemPlan.inventory.items.find(i=>i.key===c.subjectKey):undefined
    const view=p.itemVariantKey===null?item:item?.variants.find(v=>v.key===p.itemVariantKey)
    const field=c.domain==='inventory'?'iconAssetKey':'detailAssetKey'
    if(view?.[field]===p.assetKey)view[field]=null
  }
  workspace=prepareAvgMediaConsumerDeclarationsV1(workspace,avgVisualPlanningTemplateRequirementsV1(scope))
  return {workspace,scope:await freezeAvgVisualPlanningScopeV1(input.planning,workspace)}
}
