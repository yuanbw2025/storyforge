/**
 * R-32 · 「前一章」必须按叙事顺序取，而非 chapter.order（入库序）
 *
 * 症状：第 2 章生成正文时，"前一章结尾"注入为空、被 chapter-adapter 判成"（这是第一章）"。
 *
 * 根因：`Chapter.order` 是正文记录**入库时的序号**（建章处写死 `order: chapters.length`），
 *       记录"第几个被创建"，不是章节的叙事位置。用户若先进第 2 章写作，其正文记录先建、
 *       order=0，`filter(c => c.order < currentChapter.order).pop()` 恒为空 → 判成第一章。
 *       且 `.pop()` 依赖数组有序，而 addChapter 是无序 append，进一步放大。
 *
 * 修复：新增纯函数 findPrevChapter/findNextChapter，按大纲树前序 DFS 序（叙事顺序，
 *       与 ChaptersListPanel 展示一致）经 chapter.outlineNodeId 定位相邻章，不看 chapter.order。
 *
 * 本测试锁定：入库序与叙事序颠倒时仍能取对前/后章；跨中间层嵌套；边界（首章无前、末章无后）。
 */
import { describe, it, expect } from 'vitest'
import type { OutlineNode, Chapter } from '../../src/lib/types'
import { findPrevChapter, findNextChapter, buildChapterNarrativeOrder } from '../../src/lib/outline/selectors'

function node(id: number, parentId: number | null, type: OutlineNode['type'], order: number): OutlineNode {
  return { id, projectId: 1, parentId, type, title: `n${id}`, summary: '', order, createdAt: 0, updatedAt: 0 }
}
function chapter(id: number, outlineNodeId: number, order: number): Chapter {
  return { id, projectId: 1, outlineNodeId, title: `ch${id}`, content: '', wordCount: 0, status: 'outline', order, notes: '', createdAt: 0, updatedAt: 0 }
}

describe('R-32 · findPrevChapter 按叙事序而非入库序', () => {
  // 大纲：卷(1) → 章节点 10（第1章）、11（第2章），叙事序 10 在 11 前
  const nodes: OutlineNode[] = [
    node(1, null, 'volume', 0),
    node(10, 1, 'chapter', 0),   // 第1章（叙事上更早）
    node(11, 1, 'chapter', 1),   // 第2章
  ]

  it('入库序颠倒（先建第2章）时，第2章仍能取到第1章为前一章', () => {
    // 用户先进第2章写作 → 第2章正文先建 order=0；再建第1章 order=1（入库序与叙事序颠倒）
    const ch2 = chapter(100, 11, 0)   // 第2章：order=0
    const ch1 = chapter(101, 10, 1)   // 第1章：order=1
    const chapters = [ch2, ch1]       // 数组顺序也无序（模拟 append）

    const prev = findPrevChapter(nodes, chapters, ch2)
    expect(prev?.id).toBe(101)        // 旧写法这里会得 undefined → 判成第一章
  })

  it('真正的第一章没有前一章', () => {
    const ch1 = chapter(101, 10, 1)
    const ch2 = chapter(100, 11, 0)
    expect(findPrevChapter(nodes, [ch2, ch1], ch1)).toBeUndefined()
  })

  it('findNextChapter：第1章的后一章是第2章；第2章无后章', () => {
    const ch1 = chapter(101, 10, 1)
    const ch2 = chapter(100, 11, 0)
    const chapters = [ch2, ch1]
    expect(findNextChapter(nodes, chapters, ch1)?.id).toBe(100)
    expect(findNextChapter(nodes, chapters, ch2)).toBeUndefined()
  })

  it('跨中间层嵌套：叙事序取相邻，忽略 order 与数组序', () => {
    const deep: OutlineNode[] = [
      node(1, null, 'volume', 0),
      node(2, 1, 'chapter', 0),        // 叙事序 pos1（卷 pos0）
      node(3, 1, 'storyBlock', 1),
      node(4, 3, 'chapter', 0),        // 叙事序 pos3
      node(5, 3, 'chapter', 1),        // 叙事序 pos4
    ]
    const c2 = chapter(200, 2, 5)
    const c4 = chapter(201, 4, 3)
    const c5 = chapter(202, 5, 9)
    const chapters = [c5, c2, c4]
    // c5 的前一章应是 c4（叙事相邻），而不是 order/数组序意义上的邻居
    expect(findPrevChapter(deep, chapters, c5)?.id).toBe(201)
    // c4 的前一章是 c2（跨过 storyBlock 中间层）
    expect(findPrevChapter(deep, chapters, c4)?.id).toBe(200)
  })

  it('currentChapter 的节点不在大纲树中（悬空）时返回 undefined', () => {
    const orphan = chapter(300, 999, 0)
    expect(findPrevChapter(nodes, [orphan], orphan)).toBeUndefined()
  })

  it('buildChapterNarrativeOrder：前序 DFS，卷排在其子章之前', () => {
    const order = buildChapterNarrativeOrder(nodes)
    expect(order.get(1)).toBe(0)   // 卷
    expect(order.get(10)).toBe(1)  // 第1章
    expect(order.get(11)).toBe(2)  // 第2章
  })
})
