import type { OutlineNode } from '../types'

/** Enforce the single current OutlineNode shape at every UI/store boundary. */
export function normalizeOutlineNode(node: OutlineNode): OutlineNode {
  if (!['volume', 'arc', 'storyBlock', 'chapter'].includes(node.type)) throw new Error('[outline] 当前大纲节点类型无效')
  if (node.worldGroupId != null && (!Number.isSafeInteger(node.worldGroupId) || node.worldGroupId < 1)) throw new Error('[outline] 当前大纲世界分组必须为正整数或空值')
  if (node.parentId !== null && (!Number.isSafeInteger(node.parentId) || node.parentId! < 1)) {
    throw new Error('[outline] 当前大纲节点 parentId 必须为 null 或正整数')
  }
  if (typeof node.title !== 'string') throw new Error('[outline] 当前大纲节点缺少 title')
  if (typeof node.summary !== 'string') throw new Error('[outline] 当前大纲节点缺少 summary')
  if (!Number.isSafeInteger(node.order) || node.order < 0) {
    throw new Error('[outline] 当前大纲节点 order 必须为非负整数')
  }
  return { ...node }
}
