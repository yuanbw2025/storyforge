import { db } from '../db/schema'
import { normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import { assertRecordInScope, readOwnedRows } from '../workspace/scope'
import type { OutlineGenerationRequest } from './generation-request'

function sameWorldGroup(row: OutlineNode, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function descendantIds(rows: readonly OutlineNode[], rootId: number): Set<number> {
  const result = new Set<number>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (row.id == null || row.parentId == null || result.has(row.id) || !result.has(row.parentId)) continue
      result.add(row.id)
      changed = true
    }
  }
  return result
}

/**
 * A point rewrite is legal only inside the unwritten future. Batch generation
 * appends new nodes and therefore does not alter the protected written region.
 */
export async function assertOutlineRequestTargetsUnwrittenFutureV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  request: OutlineGenerationRequest
}): Promise<void> {
  if (input.request.kind === 'volumes' || input.request.kind === 'chapters') return
  const targetId = input.request.kind === 'single-volume'
    ? input.request.volumeId
    : input.request.chapterId
  const target = await db.outlineNodes.get(targetId)
  if (!target
    || !await assertRecordInScope(input.scope, 'outlineNodes', target, { owner: 'work' })
    || !sameWorldGroup(target, input.worldGroupId)) {
    throw new Error('大纲定点生成目标不存在或越出当前世界作用域。')
  }
  const outlines = (await readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' }))
    .filter(row => sameWorldGroup(row, input.worldGroupId))
  const protectedOutlineIds = input.request.kind === 'single-volume'
    ? descendantIds(outlines, targetId)
    : new Set([targetId])
  const written = (await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' }))
    .find(chapter => (
      protectedOutlineIds.has(chapter.outlineNodeId)
      && normalizeChapterText(chapter.content).length > 0
    ))
  if (written) {
    throw new Error(
      `大纲目标位于已写正文保护区（${written.title || `章节 #${written.id ?? '?'}`}），只能规划未写未来，已阻止生成或采纳。`,
    )
  }
}

/** Detail planning may only target a chapter whose prose has not been written. */
export async function assertDetailedOutlineTargetsUnwrittenFutureV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  outlineNodeId: number
}): Promise<void> {
  const target = await db.outlineNodes.get(input.outlineNodeId)
  if (!target
    || target.type !== 'chapter'
    || !await assertRecordInScope(input.scope, 'outlineNodes', target, { owner: 'work' })
    || !sameWorldGroup(target, input.worldGroupId)) {
    throw new Error('细纲目标章节不存在或越出当前世界作用域。')
  }
  const written = (await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' }))
    .find(chapter => (
      chapter.outlineNodeId === input.outlineNodeId
      && normalizeChapterText(chapter.content).length > 0
    ))
  if (written) {
    throw new Error(
      `细纲目标位于已写正文保护区（${written.title || `章节 #${written.id ?? '?'}`}），请进入独立改稿流程。`,
    )
  }
}
