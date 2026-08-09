import { buildEditImpactGraphV1, type EditImpactGraphV1 } from './impact-analysis'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from './impact-remediation-plan'
import type { WorkspaceScope } from '../types'

export const IMPACT_REMEDIATION_REPLAN_VERSION_V1 = 1 as const

export type ImpactRemediationReplanReasonV1 =
  | 'source-stale'
  | 'graph-stale'
  | 'author-requested'

export interface ImpactRemediationReplanV1 {
  version: typeof IMPACT_REMEDIATION_REPLAN_VERSION_V1
  previousPlanHash: string
  reason: ImpactRemediationReplanReasonV1
  changed: boolean
  graph: EditImpactGraphV1
  plan: ImpactRemediationPlanV1
}

/**
 * Rebuild a remediation graph/plan after a stale boundary is observed.
 * Replanning is read-only: the previous plan remains an audit artifact and
 * no Canon row is changed until a later, independently verified execution.
 */
export async function replanImpactRemediationV1(input: {
  scope: WorkspaceScope
  previousPlan: ImpactRemediationPlanV1
  reason?: ImpactRemediationReplanReasonV1
}): Promise<ImpactRemediationReplanV1> {
  if (
    input.previousPlan.version !== 1
    || input.previousPlan.source.table !== 'chapters'
    || input.previousPlan.source.recordId == null
    || !/^[a-f0-9]{64}$/.test(input.previousPlan.planHash)
  ) throw new Error('旧影响处理计划无效，不能重规划。')

  const graph = await buildEditImpactGraphV1(input.scope, input.previousPlan.source.recordId)
  const plan = await buildImpactRemediationPlanV1(graph)
  return {
    version: IMPACT_REMEDIATION_REPLAN_VERSION_V1,
    previousPlanHash: input.previousPlan.planHash,
    reason: input.reason ?? 'author-requested',
    changed: plan.planHash !== input.previousPlan.planHash,
    graph,
    plan,
  }
}
