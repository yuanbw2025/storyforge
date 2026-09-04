/**
 * R-FB2 · 大纲章节拖动排序 / 任意位置插入
 *
 * ① computeReorder 纯函数:把拖起项移到目标项位置,顺序正确。
 * ② store.reorderNodes:同级 order 重写为 0..n-1,DB + 内存一致。
 * ③ store.insertNodeAt:在任意位置插入,插入后同级 order 连续无重复。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { computeReorder } from '../../src/components/outline/useDragReorder'
import { seedCurrentProject } from '../helpers/current-workspace'

async function seedVolumeWithChapters(projectId: number, n: number): Promise<{ volId: number; chapterIds: number[] }> {
  const store = useOutlineStore.getState()
  const volId = await store.addNode({ projectId, parentId: null, type: 'volume', title: '卷一', summary: '', order: 0 } as any)
  const chapterIds: number[] = []
  for (let i = 0; i < n; i++) {
    const id = await store.addNode({ projectId, parentId: volId, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i } as any)
    chapterIds.push(id)
  }
  return { volId, chapterIds }
}

describe('R-FB2 · 大纲排序/插入', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useOutlineStore.setState({ nodes: [], loading: false }) })
  afterEach(async () => { db.close() })

  it('computeReorder:把首项拖到末位 / 末项拖到首位', () => {
    expect(computeReorder([1, 2, 3], 1, 3)).toEqual([2, 3, 1])
    expect(computeReorder([1, 2, 3], 3, 1)).toEqual([3, 1, 2])
    expect(computeReorder([1, 2, 3], 2, 2)).toEqual([1, 2, 3]) // 拖到自己原地：不变
  })

  it('reorderNodes:同级 order 重写为 0..n-1（DB + 内存一致）', async () => {
    const pid = await seedCurrentProject({ name: 'P', genres: [], description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: Date.now(), updatedAt: Date.now() } as any) as number
    const { chapterIds } = await seedVolumeWithChapters(pid, 3)
    const [a, b, c] = chapterIds

    // 把第 1 章拖到最后 → 期望顺序 [b, c, a]
    await useOutlineStore.getState().reorderNodes([b, c, a])

    const orderOf = async (id: number) => (await db.outlineNodes.get(id))!.order
    expect(await orderOf(b)).toBe(0)
    expect(await orderOf(c)).toBe(1)
    expect(await orderOf(a)).toBe(2)

    // 内存状态同步
    const mem = useOutlineStore.getState().nodes
    expect(mem.find(n => n.id === b)!.order).toBe(0)
    expect(mem.find(n => n.id === a)!.order).toBe(2)
  })

  it('insertNodeAt:在中间插入,插入后 order 连续无重复', async () => {
    const pid = await seedCurrentProject({ name: 'P2', genres: [], description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: Date.now(), updatedAt: Date.now() } as any) as number
    const { volId, chapterIds } = await seedVolumeWithChapters(pid, 3)

    // 在第 1 章(index 0)之后插入一章 → 新章应排在 index 1
    const newId = await useOutlineStore.getState().insertNodeAt(
      { projectId: pid, parentId: volId, type: 'chapter', title: '插入章', summary: '', order: 0 } as any,
      chapterIds,
      1,
    )

    const chapters = (await db.outlineNodes.where('parentId').equals(volId).toArray())
      .filter(n => n.type === 'chapter')
      .sort((a, b) => a.order - b.order)

    // 顺序：第1章、插入章、第2章、第3章
    expect(chapters.map(c => c.id)).toEqual([chapterIds[0], newId, chapterIds[1], chapterIds[2]])
    // order 连续 0..3 无重复
    expect(chapters.map(c => c.order)).toEqual([0, 1, 2, 3])
  })
})
