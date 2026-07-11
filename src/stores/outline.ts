import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { OutlineNode } from '../lib/types'
import { normalizeOutlineNode } from '../lib/outline/normalize'
import { useChapterStore } from './chapter'

interface OutlineStore {
  nodes: OutlineNode[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addNode: (node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateNode: (id: number, data: Partial<OutlineNode>) => Promise<void>
  deleteNode: (id: number) => Promise<void>
  /** 批量添加节点（AI 生成大纲后） */
  addNodes: (nodes: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<void>
  /** 同级重排：按给定 id 顺序把 order 重写为 0..n-1（拖动排序 / 任意位置插入用，FB-2） */
  reorderNodes: (orderedIds: number[]) => Promise<void>
  /** 在某同级位置插入新节点（任意位置插入，FB-2）。siblingIds 为当前同级顺序，index 为插入位。返回新 id */
  insertNodeAt: (
    node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>,
    siblingIds: number[],
    index: number,
  ) => Promise<number>
  /**
   * 跨父级移动节点（QUICKWIN-6）。用于把章节从卷 A 拖进卷 B / 故事块,
   * 并同时重排源父级与目标父级的同类型 sibling order。
   */
  moveNodeToParent: (id: number, parentId: number | null, index: number) => Promise<void>
}

const now = () => Date.now()

export const useOutlineStore = create<OutlineStore>((set, get) => ({
  nodes: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const nodes = await db.outlineNodes
      .where('projectId').equals(projectId)
      .sortBy('order')
    set({ nodes: nodes.map(normalizeOutlineNode), loading: false })
  },

  addNode: async (node) => {
    const newNode: OutlineNode = normalizeOutlineNode({ ...node, createdAt: now(), updatedAt: now() } as OutlineNode)
    const id = await db.outlineNodes.add(newNode) as number
    set({ nodes: [...get().nodes, { ...newNode, id }] })
    return id
  },

  updateNode: async (id, data) => {
    const ts = now()
    const before = get().nodes.find(n => n.id === id) ?? await db.outlineNodes.get(id)
    await db.outlineNodes.update(id, { ...data, updatedAt: ts })
    if (
      before?.type === 'chapter'
      && Object.prototype.hasOwnProperty.call(data, 'title')
      && typeof data.title === 'string'
    ) {
      const chapterIds = (await db.chapters.where('outlineNodeId').equals(id).primaryKeys()) as number[]
      if (chapterIds.length) {
        await db.chapters.bulkUpdate(chapterIds.map(chapterId => ({
          key: chapterId,
          changes: { title: data.title, updatedAt: ts },
        })))
        useChapterStore.setState(state => ({
          chapters: state.chapters.map(chapter =>
            chapter.outlineNodeId === id ? { ...chapter, title: data.title!, updatedAt: ts } : chapter,
          ),
          currentChapter: state.currentChapter?.outlineNodeId === id
            ? { ...state.currentChapter, title: data.title!, updatedAt: ts }
            : state.currentChapter,
        }))
      }
    }
    set({
      nodes: get().nodes.map(n =>
        n.id === id ? normalizeOutlineNode({ ...n, ...data, updatedAt: ts }) : n
      ),
    })
  },

  deleteNode: async (id) => {
    // 级联删除子节点
    const children = get().nodes.filter(n => n.parentId === id)
    for (const child of children) {
      if (child.id) await get().deleteNode(child.id)
    }
    // 级联删除挂在本节点上的正文章节 + 细纲（按 outlineNodeId），否则删大纲后正文内容会成孤儿
    // Phase 0.7: 章节删除必须走 chapter store 的唯一入口 cascadeDeleteChapters,
    //            否则会绕过级联 → 章节关联的 emotionBeatCards 残留(孤儿数据)。
    const orphanChapters = (await db.chapters.where('outlineNodeId').equals(id).primaryKeys()) as number[]
    if (orphanChapters.length) await useChapterStore.getState().cascadeDeleteChapters(orphanChapters)
    const orphanDetails = (await db.detailedOutlines.where('outlineNodeId').equals(id).primaryKeys()) as number[]
    if (orphanDetails.length) await db.detailedOutlines.bulkDelete(orphanDetails)
    await db.outlineNodes.delete(id)
    set({ nodes: get().nodes.filter(n => n.id !== id) })
  },

  addNodes: async (nodes) => {
    const newNodes = nodes.map(n => normalizeOutlineNode({ ...n, createdAt: now(), updatedAt: now() } as OutlineNode))
    const ids = await db.outlineNodes.bulkAdd(newNodes, { allKeys: true }) as number[]
    const withIds = newNodes.map((n, i) => ({ ...n, id: ids[i] }))
    set({ nodes: [...get().nodes, ...withIds] })
  },

  reorderNodes: async (orderedIds) => {
    const ts = now()
    const orderById = new Map(orderedIds.map((id, i) => [id, i]))
    await db.transaction('rw', db.outlineNodes, async () => {
      for (const [id, order] of orderById) {
        await db.outlineNodes.update(id, { order, updatedAt: ts })
      }
    })
    set({
      nodes: get().nodes.map(n =>
        n.id != null && orderById.has(n.id)
          ? normalizeOutlineNode({ ...n, order: orderById.get(n.id)!, updatedAt: ts })
          : n,
      ),
    })
  },

  insertNodeAt: async (node, siblingIds, index) => {
    // 先落库（order 临时给末尾），再把它挪到目标位并重排同级，保证 order 连续无重复
    const newId = await get().addNode({ ...node, order: siblingIds.length })
    const clamped = Math.max(0, Math.min(index, siblingIds.length))
    const next = [...siblingIds]
    next.splice(clamped, 0, newId)
    await get().reorderNodes(next)
    return newId
  },

  moveNodeToParent: async (id, parentId, index) => {
    const current = get().nodes.find(n => n.id === id) ?? await db.outlineNodes.get(id)
    if (!current) return
    if (current.parentId === parentId) {
      const siblingIds = get().nodes
        .filter(n => n.parentId === parentId && n.type === current.type && n.id != null)
        .sort((a, b) => a.order - b.order)
        .map(n => n.id!)
      const next = siblingIds.filter(item => item !== id)
      next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
      await get().reorderNodes(next)
      return
    }

    const ts = now()
    const sourceSiblings = get().nodes
      .filter(n => n.parentId === current.parentId && n.type === current.type && n.id != null && n.id !== id)
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const targetSiblings = get().nodes
      .filter(n => n.parentId === parentId && n.type === current.type && n.id != null && n.id !== id)
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const targetIndex = Math.max(0, Math.min(index, targetSiblings.length))
    targetSiblings.splice(targetIndex, 0, id)

    await db.transaction('rw', db.outlineNodes, async () => {
      await db.outlineNodes.update(id, { parentId, order: targetIndex, updatedAt: ts })
      for (let order = 0; order < sourceSiblings.length; order++) {
        await db.outlineNodes.update(sourceSiblings[order], { order, updatedAt: ts })
      }
      for (let order = 0; order < targetSiblings.length; order++) {
        await db.outlineNodes.update(targetSiblings[order], { order, updatedAt: ts })
      }
    })

    const sourceOrder = new Map(sourceSiblings.map((nodeId, order) => [nodeId, order]))
    const targetOrder = new Map(targetSiblings.map((nodeId, order) => [nodeId, order]))
    set({
      nodes: get().nodes.map(n => {
        if (n.id === id) return normalizeOutlineNode({ ...n, parentId, order: targetIndex, updatedAt: ts })
        if (n.id != null && sourceOrder.has(n.id)) {
          return normalizeOutlineNode({ ...n, order: sourceOrder.get(n.id)!, updatedAt: ts })
        }
        if (n.id != null && targetOrder.has(n.id)) {
          return normalizeOutlineNode({ ...n, order: targetOrder.get(n.id)!, updatedAt: ts })
        }
        return n
      }),
    })
  },
}))
