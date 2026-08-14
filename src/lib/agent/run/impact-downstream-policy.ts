import {
  resolveImpactHandoffModuleV2,
  type ImpactHandoffModuleV2,
} from '../../consistency/impact-handoff'
import type { ImpactRemediationItemV1 } from '../../consistency/impact-remediation-plan'

export type ImpactDownstreamExecutorV1 =
  | 'author-review'
  | 'deterministic-remediation'
  | 'outline-regeneration'
  | 'story-timeline-regeneration'

export type ImpactDownstreamPolicyIdV1 =
  | 'deterministic-summary-v1'
  | 'deterministic-retrieval-v1'
  | 'author-source-v1'
  | 'author-fact-v1'
  | 'author-source-record-v1'
  | 'author-current-outline-v1'
  | 'author-downstream-chapter-v1'
  | 'author-coupled-derived-v1'
  | 'outline-regeneration-v1'
  | 'story-timeline-regeneration-v1'

export interface ImpactDownstreamExecutorPolicyV1 {
  version: 1
  policyId: ImpactDownstreamPolicyIdV1
  executor: ImpactDownstreamExecutorV1
  reason: string
  manualModule: ImpactHandoffModuleV2 | null
}

const SOURCE_RECORD_TABLES_V1: ReadonlySet<string> = new Set([
  'worldRules',
  'worldviews',
  'powerSystems',
  'cultivationSystems',
  'storyCores',
  'characters',
  'characterRelations',
  'storyArcs',
  'storylineProgress',
  'storylineCrossings',
  'outlineNodes',
  'detailedOutlines',
  'creativeRules',
  'references',
])

function fail(item: ImpactRemediationItemV1): never {
  throw new Error(
    `H57 下游项没有受治理执行器政策：${item.kind}/${item.action}/${item.table}/${item.mode}。`,
  )
}

function hasRecordNode(item: ImpactRemediationItemV1, prefix: string): boolean {
  return Number.isInteger(item.recordId)
    && Number(item.recordId) > 0
    && item.nodeId === `${prefix}:${item.recordId}`
}

function authorPolicy(
  item: ImpactRemediationItemV1,
  policyId: ImpactDownstreamPolicyIdV1,
  reason: string,
): ImpactDownstreamExecutorPolicyV1 {
  return {
    version: 1,
    policyId,
    executor: 'author-review',
    reason,
    manualModule: resolveImpactHandoffModuleV2(item),
  }
}

/**
 * Closed executor policy for every node shape currently emitted by the H57
 * planner. A new or mismatched kind/action/table/mode combination must be
 * reviewed explicitly instead of silently inheriting model or write access.
 */
export function resolveImpactDownstreamExecutorPolicyV1(input: {
  item: ImpactRemediationItemV1
  sourceOutlineNodeId: number | null
}): ImpactDownstreamExecutorPolicyV1 {
  const { item } = input
  if (item.id !== `impact-remediation:${item.nodeId}`) return fail(item)
  if (
    item.mode === 'deterministic'
    && item.kind === 'summary'
    && item.action === 'rebuild-summary'
    && item.table === 'narrativeSummaryNodes'
    && hasRecordNode(item, 'summary')
  ) {
    return {
      version: 1,
      policyId: 'deterministic-summary-v1',
      executor: 'deterministic-remediation',
      reason: '层级摘要是可由当前正文与大纲确定性重建的派生投影。',
      manualModule: null,
    }
  }
  if (
    item.mode === 'deterministic'
    && item.kind === 'retrieval-chunk'
    && item.action === 'rebuild-retrieval'
    && item.table === 'retrievalChunks'
    && hasRecordNode(item, 'retrieval-chunk')
  ) {
    return {
      version: 1,
      policyId: 'deterministic-retrieval-v1',
      executor: 'deterministic-remediation',
      reason: '检索块是绑定正文 hash 的确定性派生投影。',
      manualModule: null,
    }
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'changed-source'
    && item.action === 'review-source'
    && item.table === 'chapters'
    && hasRecordNode(item, 'source:chapters')
  ) {
    return authorPolicy(item, 'author-source-v1', '作者手稿不能由影响调度自动覆盖。')
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'fact'
    && item.action === 'review-fact'
    && item.table === 'temporalFacts'
    && hasRecordNode(item, 'fact')
  ) {
    return authorPolicy(item, 'author-fact-v1', 'Canon 事实必须由作者复核或经可信人工修正。')
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'source-record'
    && item.action === 'review-source-record'
    && SOURCE_RECORD_TABLES_V1.has(item.table)
    && Number.isInteger(item.recordId)
    && Number(item.recordId) > 0
    && item.nodeId === `source-record:${item.table}:${item.recordId}`
  ) {
    return authorPolicy(item, 'author-source-record-v1', '上游正式记录只能进入精确现有面板人工复核。')
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'outline'
    && item.action === 'review-outline'
    && item.table === 'outlineNodes'
    && hasRecordNode(item, 'outline')
  ) {
    if (item.recordId === input.sourceOutlineNodeId) {
      return authorPolicy(item, 'author-current-outline-v1', '来源章纲与当前手稿同属作者边界，不能自动重写。')
    }
    return {
      version: 1,
      policyId: 'outline-regeneration-v1',
      executor: 'outline-regeneration',
      reason: '后续章纲只允许 H77 为精确 summary 生成作者确认候选。',
      manualModule: null,
    }
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'chapter'
    && item.action === 'review-downstream-chapter'
    && item.table === 'chapters'
    && hasRecordNode(item, 'chapter')
  ) {
    return authorPolicy(item, 'author-downstream-chapter-v1', '后续正文不能自动级联重写。')
  }
  if (
    item.mode === 'author-confirmed'
    && item.action === 'review-derived-state'
    && (
      (item.kind === 'storyline-progress' && item.table === 'storylineProgress' && hasRecordNode(item, 'storyline-progress'))
      || (item.kind === 'storyline-crossing' && item.table === 'storylineCrossings' && hasRecordNode(item, 'storyline-crossing'))
      || (item.kind === 'state-card' && item.table === 'stateCards' && hasRecordNode(item, 'state-card'))
      || (item.kind === 'item-ledger' && item.table === 'itemLedger' && hasRecordNode(item, 'item-ledger'))
    )
  ) {
    return authorPolicy(
      item,
      'author-coupled-derived-v1',
      '该记录属于耦合或整章集合产物；单条 H57 item 不得扩大为集合替换。',
    )
  }
  if (
    item.mode === 'author-confirmed'
    && item.kind === 'timeline-event'
    && item.action === 'review-derived-state'
    && item.table === 'storyTimelineEvents'
    && hasRecordNode(item, 'timeline-event')
  ) {
    return {
      version: 1,
      policyId: 'story-timeline-regeneration-v1',
      executor: 'story-timeline-regeneration',
      reason: '既有年表事件只允许 H79 更新精确三个可变字段。',
      manualModule: null,
    }
  }
  return fail(item)
}
