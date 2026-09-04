import type { OutlineNode } from '../types'

/** Enforce the single current OutlineNode shape at every UI/store boundary. */
export function normalizeOutlineNode(node: OutlineNode): OutlineNode {
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
