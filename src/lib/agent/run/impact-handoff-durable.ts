import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import {
  buildEditImpactGraphV1,
  type EditImpactGraphV1,
} from '../../consistency/impact-analysis'
import type { ImpactHandoffV2 } from '../../consistency/impact-handoff'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from '../../consistency/impact-remediation-plan'
import { assertRecordInScope } from '../../world-engine/scope'
import {
  readImpactAuthorReviewsV1,
  type ImpactAuthorReviewRecordV1,
} from './impact-review-durable'

export interface CurrentImpactHandoffStateV2 {
  graph: EditImpactGraphV1
  plan: ImpactRemediationPlanV1
  review: ImpactAuthorReviewRecordV1
}

/**
 * Authenticate a URL handoff against the current graph, plan and durable
 * author-review receipt. A structurally valid URL is never trusted alone.
 */
export async function validateCurrentImpactHandoffV2(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
}): Promise<CurrentImpactHandoffStateV2 | null> {
  const { handoff, scope } = input
  const chapter = await db.chapters.get(handoff.sourceChapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) return null
  if (
    (chapter.outlineNodeId ?? null) !== handoff.sourceOutlineNodeId
    || handoff.returnNodeId !== (chapter.outlineNodeId ?? null)
  ) return null

  const graph = await buildEditImpactGraphV1(scope, handoff.sourceChapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  if (
    graph.graphHash !== handoff.graphHash
    || graph.source.sourceTextHash !== handoff.sourceTextHash
    || plan.planHash !== handoff.planHash
  ) return null

  const item = plan.items.find(candidate => candidate.id === handoff.itemId)
  if (
    !item
    || item.mode !== 'author-confirmed'
    || item.action !== handoff.action
    || item.table !== handoff.table
    || item.recordId !== handoff.recordId
  ) return null

  const reviews = await readImpactAuthorReviewsV1({ scope, plan })
  const review = reviews.find(candidate => candidate.output.itemId === handoff.itemId)
  if (
    !review
    || review.output.decision !== 'needs-manual-action'
    || review.runId !== handoff.reviewRunId
    || review.receiptHash !== handoff.reviewReceiptHash
  ) return null

  return { graph, plan, review }
}
