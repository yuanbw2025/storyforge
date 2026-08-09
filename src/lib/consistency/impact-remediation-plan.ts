import { hashCanonicalValue } from '../agent/run/hash'
import type {
  EditImpactGraphNodeKindV1,
  EditImpactGraphV1,
} from './impact-analysis'

export const IMPACT_REMEDIATION_PLAN_VERSION_V1 = 1 as const

export type ImpactRemediationModeV1 = 'deterministic' | 'author-confirmed'

export type ImpactRemediationActionV1 =
  | 'review-source'
  | 'review-fact'
  | 'review-source-record'
  | 'rebuild-summary'
  | 'rebuild-retrieval'
  | 'review-derived-state'
  | 'review-outline'
  | 'review-downstream-chapter'

export interface ImpactRemediationItemV1 {
  id: string
  nodeId: string
  kind: EditImpactGraphNodeKindV1
  table: string
  recordId: number | null
  action: ImpactRemediationActionV1
  mode: ImpactRemediationModeV1
  reason: string
  dependencyNodeIds: string[]
}

export interface ImpactRemediationPlanV1 {
  version: typeof IMPACT_REMEDIATION_PLAN_VERSION_V1
  source: EditImpactGraphV1['source']
  graphHash: string
  items: ImpactRemediationItemV1[]
  counts: {
    total: number
    deterministic: number
    authorConfirmed: number
  }
  planHash: string
}

const DERIVED_REVIEW_KINDS: ReadonlySet<EditImpactGraphNodeKindV1> = new Set([
  'storyline-progress',
  'storyline-crossing',
  'state-card',
  'item-ledger',
  'timeline-event',
])

function classifyNode(
  node: EditImpactGraphV1['nodes'][number],
  sourceOutlineNodeIds: ReadonlySet<string>,
): Omit<ImpactRemediationItemV1, 'id' | 'dependencyNodeIds'> {
  if (node.kind === 'changed-source') {
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'review-source',
      mode: 'author-confirmed',
      reason: '正文已变化；先确认当前正文是否仍是作者版本。',
    }
  }
  if (node.kind === 'fact') {
    const stale = node.status === 'stale' || node.status === 'source-missing' || node.status === 'invalid-range'
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'review-fact',
      mode: 'author-confirmed',
      reason: stale
        ? '事实证据已失效或状态异常，必须由作者重新确认。'
        : '事实来自被修改正文，写作前仍需复核证据是否保持成立。',
    }
  }
  if (node.kind === 'source-record') {
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'review-source-record',
      mode: 'author-confirmed',
      reason: '上游设定或实体被正文事实引用，不能静默改写。',
    }
  }
  if (node.kind === 'summary') {
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'rebuild-summary',
      mode: 'deterministic',
      reason: '摘要是正文或大纲的派生数据，可按当前 hash 确定性重建。',
    }
  }
  if (node.kind === 'retrieval-chunk') {
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'rebuild-retrieval',
      mode: 'deterministic',
      reason: '检索块绑定旧正文 hash，应重建后再允许检索命中。',
    }
  }
  if (DERIVED_REVIEW_KINDS.has(node.kind)) {
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'review-derived-state',
      mode: 'author-confirmed',
      reason: '状态、物品、年表或故事线是受治理产物，需候选复核后才能写回。',
    }
  }
  if (node.kind === 'outline') {
    const current = sourceOutlineNodeIds.has(node.id)
    return {
      nodeId: node.id,
      kind: node.kind,
      table: node.table,
      recordId: node.recordId,
      action: 'review-outline',
      mode: 'author-confirmed',
      reason: current
        ? '当前章纲与正文关联，确认正文版本后再决定是否需要修订。'
        : '后续大纲受正文变化影响，只允许作者确认式摘要候选。',
    }
  }
  return {
    nodeId: node.id,
    kind: node.kind,
    table: node.table,
    recordId: node.recordId,
    action: 'review-downstream-chapter',
    mode: 'author-confirmed',
    reason: '后续正文不能自动级联重写，需作者决定是否重新规划或生成。',
  }
}

/**
 * Build a read-only remediation plan from the deterministic impact graph.
 * It classifies work only; execution is intentionally left to later units.
 */
export async function buildImpactRemediationPlanV1(
  graph: EditImpactGraphV1,
): Promise<ImpactRemediationPlanV1> {
  if (graph.version !== 1 || !graph.graphHash || !graph.source.sourceTextHash) {
    throw new Error('影响图版本或 hash 无效。')
  }
  const sourceNodeId = `source:chapters:${graph.source.recordId}`
  const sourceOutlineNodeIds = new Set(
    graph.edges
      .filter(edge => edge.from === sourceNodeId && edge.relation === 'chapter-outline')
      .map(edge => edge.to),
  )
  const incoming = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const dependencies = incoming.get(edge.to) ?? []
    dependencies.push(edge.from)
    incoming.set(edge.to, dependencies)
  }
  const items = graph.nodes
    .map(node => {
      const classified = classifyNode(node, sourceOutlineNodeIds)
      return {
        ...classified,
        id: `impact-remediation:${node.id}`,
        dependencyNodeIds: [...new Set(incoming.get(node.id) ?? [])].sort(),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const body = {
    version: IMPACT_REMEDIATION_PLAN_VERSION_V1,
    source: graph.source,
    graphHash: graph.graphHash,
    items,
    counts: {
      total: items.length,
      deterministic: items.filter(item => item.mode === 'deterministic').length,
      authorConfirmed: items.filter(item => item.mode === 'author-confirmed').length,
    },
  }
  return { ...body, planHash: await hashCanonicalValue(body) }
}
