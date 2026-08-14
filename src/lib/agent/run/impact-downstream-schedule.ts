import { db } from '../../db/schema'
import type { ImpactRemediationItemV1 } from '../../consistency/impact-remediation-plan'
import type { WorkspaceScope } from '../../types'
import { assertRecordInScope } from '../../world-engine/scope'
import {
  assertExpectedImpactReplanCurrentV1,
  resolveImpactDependencyReadinessV1,
} from './impact-dependency-readiness'
import {
  isActiveImpactGenerativeRunV1,
  readImpactGenerativeSiblingRunsV1,
} from './impact-generative-slot'
import {
  readCompletedImpactOutlineRegenerationsV1,
  readPendingImpactOutlineRegenerationCandidateV1,
} from './impact-outline-regeneration-durable'
import {
  readCompletedImpactPostCorrectionRemediationV1,
} from './impact-post-correction-remediation-durable'
import type { ImpactPostCorrectionReplanResultV1 } from './impact-post-correction-replan-durable'
import { readImpactAuthorReviewsV1 } from './impact-review-durable'
import {
  readCompletedImpactStoryTimelineRegenerationsV1,
  readPendingImpactStoryTimelineRegenerationCandidateV1,
} from './impact-story-timeline-regeneration-durable'
import { hashCanonicalValue } from './hash'

export type ImpactDownstreamScheduleStatusV1 =
  | 'blocked'
  | 'ready'
  | 'awaiting-confirmation'
  | 'needs-manual-action'
  | 'completed'

export type ImpactDownstreamExecutorV1 =
  | 'author-review'
  | 'deterministic-remediation'
  | 'outline-regeneration'
  | 'story-timeline-regeneration'

export interface ImpactDownstreamScheduleItemV1 {
  itemId: string
  nodeId: string
  kind: ImpactRemediationItemV1['kind']
  table: string
  recordId: number | null
  action: ImpactRemediationItemV1['action']
  mode: ImpactRemediationItemV1['mode']
  executor: ImpactDownstreamExecutorV1
  status: ImpactDownstreamScheduleStatusV1
  dependencyItemIds: string[]
  blockers: string[]
  evidenceRefs: string[]
}

export interface ImpactDownstreamScheduleV1 {
  version: 1
  kind: 'impact-downstream-schedule'
  portable: false
  sourceChapterId: number
  replanRunId: number
  replanReceiptHash: string
  replanOutputHash: string
  planHash: string
  graphHash: string
  items: ImpactDownstreamScheduleItemV1[]
  counts: Record<ImpactDownstreamScheduleStatusV1, number>
  nextItemIds: string[]
  settled: boolean
  scheduleHash: string
}

function isOutlineTarget(item: ImpactRemediationItemV1, sourceOutlineNodeId: number | null): boolean {
  return item.mode === 'author-confirmed'
    && item.action === 'review-outline'
    && item.kind === 'outline'
    && item.table === 'outlineNodes'
    && Number.isInteger(item.recordId)
    && item.recordId !== sourceOutlineNodeId
}

function isStoryTimelineTarget(item: ImpactRemediationItemV1): boolean {
  return item.mode === 'author-confirmed'
    && item.action === 'review-derived-state'
    && item.kind === 'timeline-event'
    && item.table === 'storyTimelineEvents'
    && Number.isInteger(item.recordId)
    && item.nodeId === `timeline-event:${item.recordId}`
}

function executorFor(
  item: ImpactRemediationItemV1,
  sourceOutlineNodeId: number | null,
): ImpactDownstreamExecutorV1 {
  if (item.mode === 'deterministic') return 'deterministic-remediation'
  if (isOutlineTarget(item, sourceOutlineNodeId)) return 'outline-regeneration'
  if (isStoryTimelineTarget(item)) return 'story-timeline-regeneration'
  return 'author-review'
}

function topologicalItems(items: ImpactRemediationItemV1[]): ImpactRemediationItemV1[] {
  const byNode = new Map<string, ImpactRemediationItemV1>()
  for (const item of items) {
    if (byNode.has(item.nodeId)) throw new Error(`H57 当前计划包含重复节点 ${item.nodeId}。`)
    byNode.set(item.nodeId, item)
  }
  const remaining = new Map(items.map(item => [
    item.nodeId,
    new Set(item.dependencyNodeIds.filter(nodeId => byNode.has(nodeId))),
  ]))
  const ordered: ImpactRemediationItemV1[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([nodeId]) => byNode.get(nodeId)!)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (ready.length === 0) throw new Error('H57 当前计划的下游依赖图存在环，调度已停止。')
    for (const item of ready) {
      ordered.push(item)
      remaining.delete(item.nodeId)
      for (const dependencies of remaining.values()) dependencies.delete(item.nodeId)
    }
  }
  return ordered
}

/**
 * Project a fresh H57 plan and its durable child evidence into one deterministic
 * author-controlled schedule. This is a read model only: it never creates a Run
 * or mutates Canon.
 */
export async function readImpactDownstreamScheduleV1(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
}): Promise<ImpactDownstreamScheduleV1> {
  const replan = await assertExpectedImpactReplanCurrentV1(input)
  const source = await db.chapters.get(replan.output.sourceChapterId)
  if (!source || !await assertRecordInScope(input.scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('H57 下游调度的来源章节不存在或越界。')
  }
  const activeIds = new Set([...replan.output.remainingItemIds, ...replan.output.newItemIds])
  const activeItems = replan.output.plan.items.filter(item => activeIds.has(item.id))
  if (activeItems.length !== activeIds.size) throw new Error('H57 当前差异项未完整映射到计划。')
  const ordered = topologicalItems(activeItems)
  const itemByNode = new Map(activeItems.map(item => [item.nodeId, item]))

  const [reviews, pendingOutline, completedOutlines, pendingTimeline, completedTimeline, siblings, deterministic] = await Promise.all([
    readImpactAuthorReviewsV1({ scope: input.scope, plan: replan.output.plan }),
    readPendingImpactOutlineRegenerationCandidateV1({ scope: input.scope, sourceChapterId: replan.output.sourceChapterId }),
    readCompletedImpactOutlineRegenerationsV1({ scope: input.scope, sourceChapterId: replan.output.sourceChapterId }),
    readPendingImpactStoryTimelineRegenerationCandidateV1({ scope: input.scope, sourceChapterId: replan.output.sourceChapterId }),
    readCompletedImpactStoryTimelineRegenerationsV1({ scope: input.scope, sourceChapterId: replan.output.sourceChapterId }),
    readImpactGenerativeSiblingRunsV1({ scope: input.scope, parentRunId: replan.snapshot.run.id }),
    replan.output.plan.counts.deterministic > 0
      ? readCompletedImpactPostCorrectionRemediationV1({
          scope: input.scope,
          worldGroupId: replan.snapshot.run.worldGroupId ?? null,
          sourceChapterId: replan.output.sourceChapterId,
          expectedReplan: replan,
        })
      : Promise.resolve(null),
  ])

  const activeGenerative = siblings.filter(isActiveImpactGenerativeRunV1)
  if (activeGenerative.length > 1) throw new Error('H57 存在多个活动生成式 child，调度证据冲突。')
  const pendingRuns = [pendingOutline, pendingTimeline].filter(candidate => candidate != null)
  if (pendingRuns.length > 1) throw new Error('H57 同时恢复出多个待确认生成式候选，调度已停止。')
  if (activeGenerative.length === 1 && pendingRuns.length !== 1) {
    throw new Error('H57 活动生成式 child 无法恢复为可信候选，调度已停止。')
  }

  const reviewByItem = new Map(reviews.map(review => [review.output.itemId, review]))
  const completedOutlineByItem = new Map(completedOutlines.map(completion => [completion.candidate.item.id, completion]))
  const completedTimelineByItem = new Map(completedTimeline.map(completion => [completion.candidate.item.id, completion]))
  const pendingOutlineItemId = pendingOutline?.candidate.item.id ?? null
  const pendingTimelineItemId = pendingTimeline?.candidate.item.id ?? null
  const scheduleItems: ImpactDownstreamScheduleItemV1[] = []

  for (const item of ordered) {
    const executor = executorFor(item, source.outlineNodeId ?? null)
    const review = reviewByItem.get(item.id)
    const dependencyItemIds = item.dependencyNodeIds
      .map(nodeId => itemByNode.get(nodeId)?.id)
      .filter((itemId): itemId is string => itemId != null)
      .sort()
    let status: ImpactDownstreamScheduleStatusV1 = 'ready'
    let blockers: string[] = []
    let evidenceRefs: string[] = []

    if (review?.output.decision === 'needs-manual-action') {
      status = 'needs-manual-action'
      blockers = ['该目标已由作者标记为需人工处理，必须完成可信修正与重新规划。']
      evidenceRefs = [`review:${review.runId}:${review.receiptHash}`]
    } else if (review?.output.decision === 'acknowledged') {
      status = 'completed'
      evidenceRefs = [`review:${review.runId}:${review.receiptHash}`]
    } else if (executor === 'deterministic-remediation') {
      if (deterministic) {
        status = 'completed'
        evidenceRefs = [`deterministic:${deterministic.snapshot.run.id}:${deterministic.receiptHash}`]
      }
    } else if (executor === 'outline-regeneration' && completedOutlineByItem.has(item.id)) {
      const completion = completedOutlineByItem.get(item.id)!
      status = 'completed'
      evidenceRefs = [`outline:${completion.snapshot.run.id}:${completion.receiptHash}`]
    } else if (executor === 'story-timeline-regeneration' && completedTimelineByItem.has(item.id)) {
      const completion = completedTimelineByItem.get(item.id)!
      status = 'completed'
      evidenceRefs = [`story-timeline:${completion.snapshot.run.id}:${completion.receiptHash}`]
    } else if (item.id === pendingOutlineItemId || item.id === pendingTimelineItemId) {
      const pending = item.id === pendingOutlineItemId ? pendingOutline! : pendingTimeline!
      status = 'awaiting-confirmation'
      evidenceRefs = [`candidate:${pending.snapshot.run.id}:${pending.candidate.candidateHash}`]
    } else if (executor === 'outline-regeneration' || executor === 'story-timeline-regeneration') {
      const activeSibling = activeGenerative[0]
      if (activeSibling) {
        status = 'blocked'
        blockers = [`生成式 child #${activeSibling.id ?? '?'} 正在等待处理，必须先确认、放弃或完成恢复。`]
        evidenceRefs = [`active-generative:${activeSibling.id ?? 'unknown'}:${activeSibling.status}`]
      } else {
        const readiness = await resolveImpactDependencyReadinessV1({ scope: input.scope, replan, item })
        status = readiness.ready ? 'ready' : 'blocked'
        blockers = readiness.blockers
        evidenceRefs = readiness.proofs.map(proof => `dependency:${proof.reviewRunId}:${proof.reviewReceiptHash}`)
      }
    }

    scheduleItems.push({
      itemId: item.id,
      nodeId: item.nodeId,
      kind: item.kind,
      table: item.table,
      recordId: item.recordId,
      action: item.action,
      mode: item.mode,
      executor,
      status,
      dependencyItemIds,
      blockers,
      evidenceRefs,
    })
  }

  const statuses: ImpactDownstreamScheduleStatusV1[] = [
    'blocked', 'ready', 'awaiting-confirmation', 'needs-manual-action', 'completed',
  ]
  const counts = Object.fromEntries(statuses.map(status => [
    status,
    scheduleItems.filter(item => item.status === status).length,
  ])) as Record<ImpactDownstreamScheduleStatusV1, number>
  const body = {
    version: 1 as const,
    kind: 'impact-downstream-schedule' as const,
    portable: false as const,
    sourceChapterId: replan.output.sourceChapterId,
    replanRunId: replan.snapshot.run.id,
    replanReceiptHash: replan.receiptHash,
    replanOutputHash: replan.output.outputHash,
    planHash: replan.output.plan.planHash,
    graphHash: replan.output.graph.graphHash,
    items: scheduleItems,
    counts,
    nextItemIds: scheduleItems.filter(item => item.status === 'ready').map(item => item.itemId),
    settled: scheduleItems.every(item => item.status === 'completed'),
  }
  return { ...body, scheduleHash: await hashCanonicalValue(body) }
}
