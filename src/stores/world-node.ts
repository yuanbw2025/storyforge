/**
 * 世界节点（世界树）store
 * 支持多世界/多位面的树形管理
 *
 * Phase 25.4：世界树隶属于世界组（WorldGroup）。
 * - 单世界模式（worldGroupId=null）：加载项目全部节点，行为同旧逻辑
 * - 多世界模式：节点按 worldGroupId 隔离，每个世界组有自己的世界树
 */

import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldNode, WorldPortal } from '../lib/types'
import { parseWorldPortals, stringifyWorldPortals } from '../lib/utils/world-portals'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'

/** 树形节点（带 children） */
export interface WorldTreeNode extends WorldNode {
  children: WorldTreeNode[]
}

/** 防止 StrictMode 双调用产生两个根世界的互斥锁（key = projectId:worldGroupId） */
const _ensureRootLocks = new Map<string, Promise<void>>()

interface WorldNodeStore {
  /** 当前作用域内的世界节点（平铺） */
  nodes: WorldNode[]
  /** 当前选中的世界 ID */
  activeWorldId: number | null
  /** 当前世界组作用域（null = 单世界 / 未指定） */
  activeWorldGroupId: number | null
  /** 是否加载中 */
  loading: boolean

  /** 加载某世界组（或全项目）的世界节点 */
  loadNodes: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>
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
  /** 确保该世界组（或项目）至少有一个根世界 */
  ensureRootWorld: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>
}

export const useWorldNodeStore = create<WorldNodeStore>((set, get) => ({
  nodes: [],
  activeWorldId: null,
  activeWorldGroupId: null,
  loading: false,

  loadNodes: async (scopeInput, worldGroupId: number | null = null) => {
    set({ loading: true, activeWorldGroupId: worldGroupId })
    const scope = await resolveReadScopeLike(scopeInput)
    const all = (await readOwnedRows<WorldNode>(scope, 'worldNodes', { owner: 'world' }))
      .sort((left, right) => left.sortOrder - right.sortOrder)
    // 多世界模式只取本世界组的节点；单世界取全部
    const nodes = worldGroupId == null
      ? all
      : all.filter(n => n.worldGroupId === worldGroupId)
    set({ nodes, loading: false })

    // 如果没有选中的世界，或选中的世界已不在当前作用域内，自动选第一个根世界
    const { activeWorldId } = get()
    if (!activeWorldId || !nodes.find(n => n.id === activeWorldId)) {
      const root = nodes.find(n => n.parentId === null)
      set({ activeWorldId: root?.id ?? null })
    }
  },

  setActiveWorld: (id) => set({ activeWorldId: id }),

  createNode: async (data) => {
    const now = Date.now()
    const scope = await resolveScopeLike(data.projectId)
    if (data.parentId != null) {
      const parent = await db.worldNodes.get(data.parentId)
      if (!parent || !await assertRecordInScope(scope, 'worldNodes', parent, { owner: 'world' })) {
        throw new Error('[WorldNode] 父节点不属于当前 World')
      }
    }
    // 多世界模式下，新节点自动归属当前世界组（若调用方未显式指定）
    const worldGroupId = data.worldGroupId !== undefined
      ? data.worldGroupId
      : get().activeWorldGroupId
    const row = stampNewRecord(scope, 'worldNodes', {
      ...data, worldGroupId, createdAt: now, updatedAt: now,
    } as WorldNode, { owner: 'world' }) as WorldNode
    const id = await db.worldNodes.add(row)
    await get().loadNodes(scope, get().activeWorldGroupId)
    return id
  },

  updateNode: async (id, patch) => {
    const beforeMigration = await db.worldNodes.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.worldNodes.get(id)
    if (!current || !await assertRecordInScope(scope, 'worldNodes', current, { owner: 'world' })) return
    if (patch.parentId != null) {
      const parent = await db.worldNodes.get(patch.parentId)
      if (!parent || !await assertRecordInScope(scope, 'worldNodes', parent, { owner: 'world' })) return
    }
    await db.worldNodes.update(id, { ...patch, updatedAt: Date.now() })
    await get().loadNodes(scope, get().activeWorldGroupId)
  },

  deleteNode: async (id) => {
    const beforeMigration = await db.worldNodes.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const node = await db.worldNodes.get(id)
    if (!node || !await assertRecordInScope(scope, 'worldNodes', node, { owner: 'world' })) return

    const allNodes = await readOwnedRows<WorldNode>(scope, 'worldNodes', { owner: 'world' })

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

    await db.transaction('rw', db.worldNodes, async () => {
      const deleteIds = [...toDelete]
      const remaining = allNodes.filter(n => n.id != null && !toDelete.has(n.id))
      for (const n of remaining) {
        const portals = parseWorldPortals(n.portalsJSON)
        const filtered = portals.filter(p => !toDelete.has(p.targetWorldId))
        if (filtered.length !== portals.length && n.id != null) {
          await db.worldNodes.update(n.id, {
            portalsJSON: stringifyWorldPortals(filtered),
            updatedAt: Date.now(),
          })
        }
      }
      await db.worldNodes.bulkDelete(deleteIds)
    })
    await get().loadNodes(scope, get().activeWorldGroupId)
  },

  moveNode: async (id, newParentId) => {
    await get().updateNode(id, { parentId: newParentId })
  },

  addPortal: async (worldId, portal) => {
    const beforeMigration = await db.worldNodes.get(worldId)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const [node, target] = await Promise.all([
      db.worldNodes.get(worldId),
      db.worldNodes.get(portal.targetWorldId),
    ])
    if (!node || !target
      || !await assertRecordInScope(scope, 'worldNodes', node, { owner: 'world' })
      || !await assertRecordInScope(scope, 'worldNodes', target, { owner: 'world' })) return
    const portals = parseWorldPortals(node.portalsJSON)
    portals.push(portal)
    await db.worldNodes.update(worldId, {
      portalsJSON: stringifyWorldPortals(portals),
      updatedAt: Date.now(),
    })
    await get().loadNodes(scope, get().activeWorldGroupId)
  },

  removePortal: async (worldId, targetWorldId) => {
    const beforeMigration = await db.worldNodes.get(worldId)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const node = await db.worldNodes.get(worldId)
    if (!node || !await assertRecordInScope(scope, 'worldNodes', node, { owner: 'world' })) return
    const portals = parseWorldPortals(node.portalsJSON)
    const filtered = portals.filter(p => p.targetWorldId !== targetWorldId)
    await db.worldNodes.update(worldId, {
      portalsJSON: stringifyWorldPortals(filtered),
      updatedAt: Date.now(),
    })
    await get().loadNodes(scope, get().activeWorldGroupId)
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
          roots.push(treeNode) // 父节点不存在（或在别的世界组），当作根
        }
      }
    }

    return roots
  },

  ensureRootWorld: async (scopeInput, worldGroupId: number | null = null) => {
    const scope = await resolveScopeLike(scopeInput)
    // 互斥锁：防止 React StrictMode 下两次 useEffect 同时执行导致双根世界
    // key 含 worldGroupId，避免不同世界组互相阻塞
    const lockKey = `${scope.worldId}:${worldGroupId ?? 'none'}`
    const existing = _ensureRootLocks.get(lockKey)
    if (existing) { await existing; return }

    const task = (async () => {
      try {
        const all = await readOwnedRows<WorldNode>(scope, 'worldNodes', { owner: 'world' })
        const scoped = worldGroupId == null
          ? all
          : all.filter(n => n.worldGroupId === worldGroupId)
        if (scoped.length > 0) return

        // 创建默认根世界（多世界模式下盖章所属世界组）
        const now = Date.now()
        const root = stampNewRecord(scope, 'worldNodes', {
          projectId: scope.projectId,
          parentId: null,
          name: '主世界',
          description: '故事发生的主要世界',
          sortOrder: 0,
          icon: '🌍',
          worldGroupId,
          createdAt: now,
          updatedAt: now,
        } as WorldNode, { owner: 'world' }) as WorldNode
        const id = await db.worldNodes.add(root)
        set({
          nodes: [{ ...root, id }],
          activeWorldId: id,
          activeWorldGroupId: worldGroupId,
        })
      } finally {
        _ensureRootLocks.delete(lockKey)
      }
    })()

    _ensureRootLocks.set(lockKey, task)
    await task
  },
}))
