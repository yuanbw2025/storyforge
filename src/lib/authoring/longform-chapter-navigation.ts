import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScopeLike } from '../workspace/scope'

export type LongformChapterModuleV1 = 'outline' | 'detailed-outline' | 'chapters-list'

/** 跳转只承接当前作者作品的章纲身份；等待保存期间切换作品则拒绝旧目标。 */
export async function resolveLongformChapterNavigationV1(input: {
  scope: WorkspaceScope
  outlineNodeId: number
  module: LongformChapterModuleV1
}): Promise<string> {
  if (!['outline', 'detailed-outline', 'chapters-list'].includes(input.module) || !Number.isSafeInteger(input.outlineNodeId) || input.outlineNodeId < 1) throw new Error('章节跳转目标无效')
  const current = await resolveScopeLike(input.scope.projectId)
  if (current.workId !== input.scope.workId || current.worldId !== input.scope.worldId) throw new Error('当前作品已切换，未打开旧章节目标')
  const node = await db.outlineNodes.get(input.outlineNodeId)
  if (!node || node.type !== 'chapter' || !await assertRecordInScope(input.scope, 'outlineNodes', node, { owner: 'work' })) throw new Error('章纲节点已删除或不属于当前作品')
  const query = new URLSearchParams({ module: input.module, chapter: String(node.id), work: String(input.scope.workId) })
  return `/workspace/${input.scope.projectId}?${query}`
}
