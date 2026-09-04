import { describe, expect, it } from 'vitest'
import { getTopLevelVolumes } from '../../src/lib/outline/selectors'
import { normalizeOutlineNode } from '../../src/lib/outline/normalize'
import type { OutlineNode } from '../../src/lib/types'

const baseNode = {
  id: 1,
  projectId: 1,
  parentId: null,
  type: 'volume',
  title: '第一卷',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
} satisfies Omit<OutlineNode, 'summary'>

describe('R-CURRENT-OUTLINE · 当前大纲结构严格边界', () => {
  it('选择器拒绝缺少 summary 的非当前节点', () => {
    const invalid = { ...baseNode } as unknown as OutlineNode
    expect(() => getTopLevelVolumes([invalid])).toThrow('当前大纲节点缺少 summary')
  })

  it('单节点规范化拒绝缺少 title/order/parentId 的非当前节点', () => {
    const invalid = {
      ...baseNode,
      parentId: undefined,
      title: undefined,
      summary: undefined,
      order: undefined,
    } as unknown as OutlineNode
    expect(() => normalizeOutlineNode(invalid)).toThrow('parentId 必须为 null 或正整数')
  })
})
