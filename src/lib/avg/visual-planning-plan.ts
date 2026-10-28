import type { ProductProductionBriefV3, ProductProductionPlanV3 } from '../types'
import { buildAvgVisualPlanningTopologyV1 } from './visual-planning-plan-kernel'
import { parseAvgVisualPlanningBriefV4, type AvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { avgVisualPlanningTemplateRequirementsV1, type AvgVisualDesignKindV1 } from './visual-planning-contract'
import { avgKey } from './protocol-validation'
import { AVG_COMPILED_IMAGE_SKILL_V4, avgVisualPlanningRoleV1 } from './visual-planning-roles'

export const AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 = 'avg.media.compiled-visual-requirements'
export function avgVisualProposalArtifactKeyV4(kind: AvgVisualDesignKindV1 | null, subjectKey?: string): string {
  return avgKey(kind === null ? 'avg.proposal.visual-bible' : `avg.proposal.${kind}-brief.${avgKey(subjectKey, 'subjectKey')}`, 'proposal artifactKey')
}

/** Explicit V4 parser and original graph identity remain unchanged. */
export function buildAvgVisualPlanningPlanV4(input:{
  brief:Pick<ProductProductionBriefV3,'capabilityRequirements'>&{avgVisualPlanning:AvgVisualPlanningBriefV4}
  briefHash:string;buildNumber:number;controlEpoch:number
}):ProductProductionPlanV3 {
  const v=parseAvgVisualPlanningBriefV4(input.brief.avgVisualPlanning)
  const mediaBatch = { schema: 'storyforge.avg.visual-production-batch' as const, version: 1 as const,
    batchKey: v.scope.batchKey, revision: v.scope.revision, aspectRatio: v.scope.aspectRatio, sourceInputHash: v.scope.sourceInputHash,
    visualReviewPolicy: 'author-visual-v1' as const,
    requirements: avgVisualPlanningTemplateRequirementsV1(v.scope) }
  return buildAvgVisualPlanningTopologyV1(input,v,mediaBatch,{
    contextProfile:'avg-visual-planning-v4',directionKind:'avg-v4-visual-direction-proposal',subjectKind:'avg-v4-subject-visual-proposal',
    compileKind:'avg-v4-visual-requirements-compile',reuseProposalKind:'avg-v4-visual-proposal-reuse',imageSkillId:AVG_COMPILED_IMAGE_SKILL_V4,
    compiledArtifactKey:AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4,proposalKey:avgVisualProposalArtifactKeyV4,role:avgVisualPlanningRoleV1})
}
