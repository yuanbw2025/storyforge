import { parseAvgVisualPlanningScopeWithReferences,type AvgVisualPlanningScopeV1 } from './visual-planning-contract'
import { parseAvgMediaReferencesV2,type AvgMediaReferenceV2 } from './media-reference-contract-v2'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'

export interface AvgVisualPlanningScopeV2 extends Omit<AvgVisualPlanningScopeV1,'version'|'referenceCatalog'> {
  version:2
  referenceCatalog:Array<{referenceKey:string;reference:AvgMediaReferenceV2}>
}
export function parseAvgVisualPlanningScopeV2(value:unknown):AvgVisualPlanningScopeV2 {
  return parseAvgVisualPlanningScopeWithReferences(value,2,value=>parseAvgMediaReferencesV2([value])[0]!)
}
/** Inert topology checks only, never a compiled request or dispatch authority. */
export function avgVisualPlanningTemplateRequirementsV2(scope:AvgVisualPlanningScopeV2):AvgVisualProductionRequirementV2[]{
  return scope.templates.map(t=>({...t.parameters,prompt:'Topology validation only',negativePrompt:'',
    invariants:[...new Set(t.requiredDetails)],forbiddenDepictions:[...new Set(t.forbiddenDepictions)],
    references:t.requiredReferenceKeys.map(key=>scope.referenceCatalog.find(r=>r.referenceKey===key)!.reference)}))
}
