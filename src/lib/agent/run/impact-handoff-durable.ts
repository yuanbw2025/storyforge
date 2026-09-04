import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import {
  buildEditImpactGraphV1,
  type EditImpactGraphV1,
} from '../../consistency/impact-analysis'
import type { ImpactHandoffV2 } from '../../consistency/impact-handoff'
import { resolveImpactHandoffModuleV2 } from '../../consistency/impact-handoff'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from '../../consistency/impact-remediation-plan'
import { assertRecordInScope, getTableSpec } from '../../workspace/scope'
import {
  readImpactAuthorReviewsV1,
  type ImpactAuthorReviewRecordV1,
} from './impact-review-durable'

export interface CurrentImpactHandoffStateV2 {
  graph: EditImpactGraphV1
  plan: ImpactRemediationPlanV1
  review: ImpactAuthorReviewRecordV1
  target: CurrentImpactHandoffTargetV2
}

export interface CurrentImpactHandoffTargetV2 {
  /** Governed table and primary key from the impact plan. */
  table: string
  recordId: number
  /** Existing panels sometimes navigate by an owning outline node instead. */
  moduleRecordId: number
}

/**
 * Resolve the current, scoped business row behind a handoff. The URL record id
 * is never passed straight into a panel because chapter/detail panels navigate
 * by outlineNodeId rather than their own primary key.
 */
export async function resolveCurrentImpactHandoffTargetV2(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
}): Promise<CurrentImpactHandoffTargetV2 | null> {
  const { handoff, scope } = input
  if (resolveImpactHandoffModuleV2(handoff) !== handoff.targetModule) return null

  if (handoff.action === 'review-source') {
    if (handoff.targetRecordId == null || handoff.targetRecordId !== handoff.sourceOutlineNodeId) return null
    const outline = await db.outlineNodes.get(handoff.targetRecordId)
    if (!outline || !await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })) return null
    return {
      table: 'chapters',
      recordId: handoff.sourceChapterId,
      moduleRecordId: handoff.targetRecordId,
    }
  }

  if (handoff.recordId == null || handoff.targetRecordId !== handoff.recordId) return null
  let spec
  try {
    spec = getTableSpec(handoff.table)
  } catch {
    return null
  }
  const record = await spec.table.get(handoff.recordId)
  if (!record || !await assertRecordInScope(scope, handoff.table, record)) return null

  let moduleRecordId = handoff.recordId
  if (handoff.table === 'chapters' || handoff.table === 'detailedOutlines') {
    const outlineNodeId = (record as { outlineNodeId?: unknown }).outlineNodeId
    if (!Number.isInteger(outlineNodeId) || (outlineNodeId as number) < 1) return null
    const outline = await db.outlineNodes.get(outlineNodeId as number)
    if (!outline || !await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })) return null
    moduleRecordId = outlineNodeId as number
  }
  return { table: handoff.table, recordId: handoff.recordId, moduleRecordId }
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

  const target = await resolveCurrentImpactHandoffTargetV2({ scope, handoff })
  if (!target) return null

  const reviews = await readImpactAuthorReviewsV1({ scope, plan })
  const review = reviews.find(candidate => candidate.output.itemId === handoff.itemId)
  if (
    !review
    || review.output.decision !== 'needs-manual-action'
    || review.runId !== handoff.reviewRunId
    || review.receiptHash !== handoff.reviewReceiptHash
  ) return null

  return { graph, plan, review, target }
}
