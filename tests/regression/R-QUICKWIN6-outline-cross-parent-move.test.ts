import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { chapterDropProps } from '../../src/components/outline/chapter-drag'

async function createProject(): Promise<number> {
  return await db.projects.add({
    name: 'P',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any) as number
}

describe('R-QUICKWIN6 · 大纲章节跨卷/跨故事块移动', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useOutlineStore.setState({ nodes: [], loading: false })
  })

  afterEach(async () => { db.close() })

  it('把第一卷中间章节移动到第二卷指定位置,源卷和目标卷 order 都连续', async () => {
    const projectId = await createProject()
    const store = useOutlineStore.getState()
    const volA = await store.addNode({ projectId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0 } as any)
    const volB = await store.addNode({ projectId, parentId: null, type: 'volume', title: '第二卷', summary: '', order: 1 } as any)
    const a1 = await store.addNode({ projectId, parentId: volA, type: 'chapter', title: 'A1', summary: '', order: 0 } as any)
    const a2 = await store.addNode({ projectId, parentId: volA, type: 'chapter', title: 'A2', summary: '', order: 1 } as any)
    const a3 = await store.addNode({ projectId, parentId: volA, type: 'chapter', title: 'A3', summary: '', order: 2 } as any)
    const b1 = await store.addNode({ projectId, parentId: volB, type: 'chapter', title: 'B1', summary: '', order: 0 } as any)
    const b2 = await store.addNode({ projectId, parentId: volB, type: 'chapter', title: 'B2', summary: '', order: 1 } as any)

    await store.moveNodeToParent(a2, volB, 1)

    const source = (await db.outlineNodes.where('parentId').equals(volA).toArray())
      .filter(node => node.type === 'chapter')
      .sort((a, b) => a.order - b.order)
    const target = (await db.outlineNodes.where('parentId').equals(volB).toArray())
      .filter(node => node.type === 'chapter')
      .sort((a, b) => a.order - b.order)

    expect(source.map(node => node.id)).toEqual([a1, a3])
    expect(source.map(node => node.order)).toEqual([0, 1])
    expect(target.map(node => node.id)).toEqual([b1, a2, b2])
    expect(target.map(node => node.order)).toEqual([0, 1, 2])
    expect((await db.outlineNodes.get(a2))?.parentId).toBe(volB)

    const mem = useOutlineStore.getState().nodes
    expect(mem.find(node => node.id === a2)?.parentId).toBe(volB)
    expect(mem.find(node => node.id === a3)?.order).toBe(1)
  })

  it('章节可从卷直挂移动到故事块,正文关联 outlineNodeId 不变', async () => {
    const projectId = await createProject()
    const store = useOutlineStore.getState()
    const vol = await store.addNode({ projectId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0 } as any)
    const block = await store.addNode({ projectId, parentId: vol, type: 'storyBlock', title: '转折', summary: '', order: 0 } as any)
    const chapter = await store.addNode({ projectId, parentId: vol, type: 'chapter', title: '直挂章', summary: '', order: 0 } as any)
    const chapterRecord = await db.chapters.add({
      projectId,
      outlineNodeId: chapter,
      title: '直挂章',
      content: '<p>正文</p>',
      wordCount: 2,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number

    await store.moveNodeToParent(chapter, block, 0)

    expect((await db.outlineNodes.get(chapter))?.parentId).toBe(block)
    expect((await db.chapters.get(chapterRecord))?.outlineNodeId).toBe(chapter)
  })

  it('移动同一父级章节时复用重排语义', async () => {
    const projectId = await createProject()
    const store = useOutlineStore.getState()
    const vol = await store.addNode({ projectId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0 } as any)
    const a = await store.addNode({ projectId, parentId: vol, type: 'chapter', title: 'A', summary: '', order: 0 } as any)
    const b = await store.addNode({ projectId, parentId: vol, type: 'chapter', title: 'B', summary: '', order: 1 } as any)
    const c = await store.addNode({ projectId, parentId: vol, type: 'chapter', title: 'C', summary: '', order: 2 } as any)

    await store.moveNodeToParent(c, vol, 0)

    const chapters = (await db.outlineNodes.where('parentId').equals(vol).toArray())
      .filter(node => node.type === 'chapter')
      .sort((x, y) => x.order - y.order)
    expect(chapters.map(node => node.id)).toEqual([c, a, b])
    expect(chapters.map(node => node.order)).toEqual([0, 1, 2])
  })

  it('drop 事件读不到自定义 MIME 时,仍使用当前章节拖拽会话完成跨卷移动', async () => {
    const activeDrag = { chapterId: 21, sourceParentId: 10 }
    const onMoveChapter = vi.fn(async () => {})
    const clearActiveChapterDrag = vi.fn()
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const event = {
      dataTransfer: {
        types: [],
        getData: () => '',
        dropEffect: 'none',
      },
      preventDefault,
      stopPropagation,
    } as any
    const handlers = chapterDropProps({
      targetParentId: 20,
      targetIndex: 0,
      onMoveChapter,
      getActiveChapterDrag: () => activeDrag,
      clearActiveChapterDrag,
    })

    handlers.onDragOver(event)
    await handlers.onDrop(event)

    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onMoveChapter).toHaveBeenCalledWith(21, 20, 0)
    expect(clearActiveChapterDrag).toHaveBeenCalledOnce()
  })
})
