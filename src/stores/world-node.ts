/**
 * 世界节点（世界树）store
 * 支持多世界/多位面的树形管理
 */

import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldNode, WorldPortal } from '../lib/types'

/** 树形节点（带 children） */
export interface WorldTreeNode extends WorldNode {
  children: WorldTreeNode[]
}

interface WorldNodeStore {
  /** 当前项目的所有世界节点（平铺） */
  nodes: WorldNode[]
  /** 当前选中的世界 ID */
  activeWorldId: number | null
  /** 是否加载中 */
  loading: boolean

  /** 加载项目的所有世界节点 */
  loadNodes: (projectId: number) => Promise<void>
  /** 选中某个世界 */
  setActiveWorld: (id: number | null) => void
  /** 新建世界节点 */
  createNode: (data: Omit<WorldNode, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 更新世界节点 */
  updateNode: (id: number, patch: Partial<WorldNode>) => Promise<void>
  /** 删除世界节点（及所有子节点） */
  deleteNode: (id: number) => Promise<void>
  /** 移动世界节点（更改父节点） */
  moveNode: (id: number, newParentId: number | null) => Promise<void>
  /** 添加传送门 */
  addPortal: (worldId: number, portal: WorldPortal) => Promise<void>
  /** 删除传送门 */
  removePortal: (worldId: number, targetWorldId: number) => Promise<void>
  /** 构建树形结构 */
  getTree: () => WorldTreeNode[]
  /** 确保项目至少有一个根世界 */
  ensureRootWorld: (projectId: number) => Promise<void>
}

export const useWorldNodeStore = create<WorldNodeStore>((set, get) => ({
  nodes: [],
  activeWorldId: null,
  loading: false,

  loadNodes: async (projectId: number) => {
    set({ loading: true })
    const nodes = await db.worldNodes
      .where('projectId')
      .equals(projectId)
      .sortBy('sortOrder')
    set({ nodes, loading: false })

    // 如果没有选中的世界，自动选第一个根世界
    const { activeWorldId } = get()
    if (!activeWorldId || !nodes.find(n => n.id === activeWorldId)) {
      const root = nodes.find(n => n.parentId === null)
      set({ activeWorldId: root?.id ?? null })
    }
  },

  setActiveWorld: (id) => set({ activeWorldId: id }),

  createNode: async (data) => {
    const now = Date.now()
    const id = await db.worldNodes.add({
      ...data,
      createdAt: now,
      updatedAt: now,
    } as WorldNode)
    await get().loadNodes(data.projectId)
    return id
  },

  updateNode: async (id, patch) => {
    await db.worldNodes.update(id, { ...patch, updatedAt: Date.now() })
    const node = await db.worldNodes.get(id)
    if (node) await get().loadNodes(node.projectId)
  },

  deleteNode: async (id) => {
    const node = await db.worldNodes.get(id)
    if (!node) return

    // 递归删除所有子节点
    const allNodes = await db.worldNodes
      .where('projectId')
      .equals(node.projectId)
      .toArray()

    const toDelete = new Set<number>()
    const collect = (parentId: number) => {
      toDelete.add(parentId)
      for (const n of allNodes) {
        if (n.parentId === parentId && n.id != null) {
          collect(n.id)
        }
      }
    }
    collect(id)

    await db.worldNodes.bulkDelete([...toDelete])
    await get().loadNodes(node.projectId)
  },

  moveNode: async (id, newParentId) => {
    await db.worldNodes.update(id, {
      parentId: newParentId,
      updatedAt: Date.now(),
    })
    const node = await db.worldNodes.get(id)
    if (node) await get().loadNodes(node.projectId)
  },

  addPortal: async (worldId, portal) => {
    const node = await db.worldNodes.get(worldId)
    if (!node) return
    const portals: WorldPortal[] = node.portalsJSON
      ? JSON.parse(node.portalsJSON)
      : []
    portals.push(portal)
    await db.worldNodes.update(worldId, {
      portalsJSON: JSON.stringify(portals),
      updatedAt: Date.now(),
    })
    await get().loadNodes(node.projectId)
  },

  removePortal: async (worldId, targetWorldId) => {
    const node = await db.worldNodes.get(worldId)
    if (!node) return
    const portals: WorldPortal[] = node.portalsJSON
      ? JSON.parse(node.portalsJSON)
      : []
    const filtered = portals.filter(p => p.targetWorldId !== targetWorldId)
    await db.worldNodes.update(worldId, {
      portalsJSON: JSON.stringify(filtered),
      updatedAt: Date.now(),
    })
    await get().loadNodes(node.projectId)
  },

  getTree: () => {
    const { nodes } = get()
    const map = new Map<number, WorldTreeNode>()
    const roots: WorldTreeNode[] = []

    // 先创建所有树节点
    for (const n of nodes) {
      map.set(n.id!, { ...n, children: [] })
    }

    // 组装树
    for (const n of nodes) {
      const treeNode = map.get(n.id!)!
      if (n.parentId == null) {
        roots.push(treeNode)
      } else {
        const parent = map.get(n.parentId)
        if (parent) {
          parent.children.push(treeNode)
        } else {
          roots.push(treeNode) // 父节点不存在，当作根
        }
      }
    }

    return roots
  },

  ensureRootWorld: async (projectId) => {
    const existing = await db.worldNodes
      .where('projectId')
      .equals(projectId)
      .count()
    if (existing > 0) return

    // 创建默认根世界
    const now = Date.now()
    const id = await db.worldNodes.add({
      projectId,
      parentId: null,
      name: '主世界',
      description: '故事发生的主要世界',
      sortOrder: 0,
      icon: '🌍',
      createdAt: now,
      updatedAt: now,
    } as WorldNode)

    set({
      nodes: [{ id, projectId, parentId: null, name: '主世界', description: '故事发生的主要世界', sortOrder: 0, icon: '🌍', createdAt: now, updatedAt: now }],
      activeWorldId: id,
    })
  },
}))
