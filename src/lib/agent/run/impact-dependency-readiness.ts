import type { ImpactRemediationItemV1 } from '../../consistency/impact-remediation-plan'
import type { WorkspaceScope } from '../../types'
import { hashCanonicalValue } from './hash'
import {
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanResultV1,
} from './impact-post-correction-replan-durable'
import { readImpactAuthorReviewsV1 } from './impact-review-durable'

export interface ImpactDependencyProofV1 {
  version: 1
  kind: 'impact-author-review-dependency'
  nodeId: string
  itemId: string
  reviewRunId: number
  reviewReceiptHash: string
  decision: 'acknowledged'
}

export interface ImpactTargetReadinessV1 {
  itemId: string
  ready: boolean
  proofs: ImpactDependencyProofV1[]
  blockers: string[]
  proofHash: string
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

export function assertImpactDependencyProofV1(value: unknown): asserts value is ImpactDependencyProofV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('影响目标依赖证明无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, [
    'version', 'kind', 'nodeId', 'itemId', 'reviewRunId', 'reviewReceiptHash', 'decision',
  ], '影响目标依赖证明 ')
  if (row.version !== 1 || row.kind !== 'impact-author-review-dependency'
    || typeof row.nodeId !== 'string' || typeof row.itemId !== 'string'
    || !Number.isInteger(row.reviewRunId) || (row.reviewRunId as number) < 1
    || !isHash(row.reviewReceiptHash) || row.decision !== 'acknowledged') {
    throw new Error('影响目标依赖证明不完整。')
  }
}

export async function assertExpectedImpactReplanCurrentV1(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
}): Promise<ImpactPostCorrectionReplanResultV1> {
  const { outputHash, ...body } = input.expectedReplan.output
  if (await hashCanonicalValue(body) !== outputHash) throw new Error('H57 重规划输出已损坏。')
  const current = await readCurrentImpactPostCorrectionReplanV1({
    scope: input.scope,
    chapterId: input.expectedReplan.output.sourceChapterId,
  })
  if (!current
    || current.snapshot.run.id !== input.expectedReplan.snapshot.run.id
    || current.receiptHash !== input.expectedReplan.receiptHash
    || current.output.outputHash !== input.expectedReplan.output.outputHash) {
    throw new Error('H57 重规划已过期，请先恢复当前影响计划。')
  }
  return current
}

export async function resolveImpactDependencyReadinessV1(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
  item: ImpactRemediationItemV1
}): Promise<ImpactTargetReadinessV1> {
  const reviews = await readImpactAuthorReviewsV1({
    scope: input.scope,
    plan: input.replan.output.plan,
  })
  const reviewByItem = new Map(reviews.map(review => [review.output.itemId, review]))
  const itemByNode = new Map(input.replan.output.plan.items.map(item => [item.nodeId, item]))
  const proofs: ImpactDependencyProofV1[] = []
  const blockers: string[] = []
  for (const nodeId of [...new Set(input.item.dependencyNodeIds)].sort()) {
    const dependency = itemByNode.get(nodeId)
    if (!dependency) {
      blockers.push(`直接依赖 ${nodeId} 未映射到 H57 当前计划。`)
      continue
    }
    if (dependency.mode !== 'author-confirmed') {
      blockers.push(`直接依赖 ${dependency.id} 必须先完成确定性重建证明。`)
      continue
    }
    const review = reviewByItem.get(dependency.id)
    if (!review) {
      blockers.push(`直接依赖 ${dependency.id} 尚无作者复核回执。`)
      continue
    }
    if (review.output.decision !== 'acknowledged') {
      blockers.push(`直接依赖 ${dependency.id} 仍标记为需人工处理。`)
      continue
    }
    proofs.push({
      version: 1,
      kind: 'impact-author-review-dependency',
      nodeId,
      itemId: dependency.id,
      reviewRunId: review.runId,
      reviewReceiptHash: review.receiptHash,
      decision: 'acknowledged',
    })
  }
  return {
    itemId: input.item.id,
    ready: blockers.length === 0,
    proofs,
    blockers,
    proofHash: await hashCanonicalValue(proofs),
  }
}
