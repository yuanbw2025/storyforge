import type { ProductProductionBriefV3,ProductProductionPlanV3 } from '../types'
import { buildAvgVisualPlanningTopologyV1 } from './visual-planning-plan-kernel'
import { parseAvgVisualPlanningBriefV5,type AvgVisualPlanningBriefV5 } from './visual-planning-brief-v5'
import { avgVisualPlanningTemplateRequirementsV2 } from './visual-planning-contract-v2'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4,avgVisualProposalArtifactKeyV4 } from './visual-planning-plan'
import { avgVisualPlanningRoleV5 } from './visual-planning-roles-v5'
export { avgVisualPlanningRoleV5 } from './visual-planning-roles-v5'

export const AVG_COMPILED_IMAGE_SKILL_V5='avg.compiled-image-request.v2'
export function buildAvgVisualPlanningPlanV5(input:{
  brief:Pick<ProductProductionBriefV3,'capabilityRequirements'>&{avgVisualPlanning:AvgVisualPlanningBriefV5}
  briefHash:string;buildNumber:number;controlEpoch:number
}):ProductProductionPlanV3 {
  const v=parseAvgVisualPlanningBriefV5(input.brief.avgVisualPlanning)
  const mediaBatch={schema:'storyforge.avg.visual-production-batch' as const,version:2 as const,batchKey:v.scope.batchKey,revision:v.scope.revision,
    aspectRatio:v.scope.aspectRatio,sourceInputHash:v.scope.sourceInputHash,visualReviewPolicy:'author-visual-v1' as const,
    requirements:avgVisualPlanningTemplateRequirementsV2(v.scope)}
  const plan=buildAvgVisualPlanningTopologyV1(input,v,mediaBatch,{contextProfile:'avg-visual-planning-v5',directionKind:'avg-v5-visual-direction-proposal',
    subjectKind:'avg-v5-subject-visual-proposal',compileKind:'avg-v5-visual-requirements-compile',imageSkillId:AVG_COMPILED_IMAGE_SKILL_V5,
    compiledArtifactKey:AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4,proposalKey:avgVisualProposalArtifactKeyV4,role:avgVisualPlanningRoleV5})
  // Both paths verify the exact current compiled source and Build snapshot.
  // Keep this still-gated V5 processing topology serial through the existing
  // scheduler lock; one task must not invalidate another task's admission.
  // Original-only V5 plans and every already-supported V4 plan stay unchanged.
  if(v.imageProcessing)plan.tasks=plan.tasks.map(task=>['avg-media-image-generate','avg-media-image-process'].includes(task.kind)
    ?{...task,subjectLockKeys:[...new Set([...task.subjectLockKeys,AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4])]}:task)
  return plan
}
