import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { OutlineNode } from '../lib/types'
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
    set({ nodes, loading: false })
  },

  addNode: async (node) => {
    const newNode: OutlineNode = { ...node, createdAt: now(), updatedAt: now() }
    const id = await db.outlineNodes.add(newNode) as number
    set({ nodes: [...get().nodes, { ...newNode, id }] })
    return id
  },

  updateNode: async (id, data) => {
    await db.outlineNodes.update(id, { ...data, updatedAt: now() })
    set({
      nodes: get().nodes.map(n =>
        n.id === id ? { ...n, ...data, updatedAt: now() } : n
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
    const newNodes = nodes.map(n => ({ ...n, createdAt: now(), updatedAt: now() }))
    const ids = await db.outlineNodes.bulkAdd(newNodes, { allKeys: true }) as number[]
    const withIds = newNodes.map((n, i) => ({ ...n, id: ids[i] }))
    set({ nodes: [...get().nodes, ...withIds] })
  },
}))
