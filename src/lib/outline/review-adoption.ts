import type { OutlineNode } from '../types'
import { adopt, hashAdoptRecordFieldsV1 } from '../registry/adopt'
import { resolveScopeLike } from '../workspace/scope'

const REVIEW_FIELDS = ['title', 'summary', 'order', 'parentId']
export interface OutlineReviewTarget { id: number; projectId: number; hash: string; sourceSummary: string }
export async function freezeOutlineReviewTarget(node: OutlineNode): Promise<OutlineReviewTarget> {
  if (!node.id || node.type !== 'chapter') throw new Error('审校目标必须是已保存的章纲。')
  return { id: node.id, projectId: node.projectId, sourceSummary: node.summary ?? '', hash: await hashAdoptRecordFieldsV1(node as unknown as Record<string, unknown>, REVIEW_FIELDS) }
}
export async function adoptOutlineReview(target: OutlineReviewTarget, projectId: number, summary: string): Promise<void> {
  if (target.projectId !== projectId) throw new Error('审校候选不属于当前作品。')
  const scope = await resolveScopeLike(projectId)
  const result = await adopt({ projectId, scope, target: 'outlineNodes', recordId: target.id, mode: 'replace', data: { summary }, compareAndSet: { kind: 'record-fields-value-hash', fields: REVIEW_FIELDS, expectedHash: target.hash } })
  if (!result.written.length) throw new Error(result.skipped[0]?.reason ?? '章纲未能保存，请重新审校。')
}
