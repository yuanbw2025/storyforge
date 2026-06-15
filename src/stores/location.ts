/**
 * Phase 25.3 — 重要地点 Store
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ImportantLocation } from '../lib/types'

/** 树形节点（带 children，UI 用） */
export interface LocationTreeNode extends ImportantLocation {
  children: LocationTreeNode[]
}

interface LocationStore {
  locations: ImportantLocation[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addLocation: (data: Omit<ImportantLocation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateLocation: (id: number, patch: Partial<ImportantLocation>) => Promise<void>
  deleteLocation: (id: number) => Promise<void>
  /** 移动地点到新父节点 */
  moveLocation: (id: number, newParentId: number | null) => Promise<void>
  /** 构建树形结构 */
  getTree: () => LocationTreeNode[]
}

export const useLocationStore = create<LocationStore>((set, get) => ({
  locations: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const locations = await db.importantLocations
      .where('projectId')
      .equals(projectId)
      .sortBy('sortOrder')
    set({ locations, loading: false })
  },

  addLocation: async (data) => {
    const now = Date.now()
    const id = await db.importantLocations.add({
      ...data,
      createdAt: now,
      updatedAt: now,
    } as ImportantLocation) as number
    // 局部 set：不触发 loading 闪烁，避免编辑中的 input 失焦
    const newRow: ImportantLocation = { ...data, id, createdAt: now, updatedAt: now } as ImportantLocation
    set({ locations: [...get().locations, newRow].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) })
    return id
  },

  updateLocation: async (id, patch) => {
    const now = Date.now()
    await db.importantLocations.update(id, { ...patch, updatedAt: now })
    // 关键修复：原实现走 loadAll(projectId)，会先 set({ loading: true })，
    // 让 LocationPanel 顶层 `if (loading)` 分支命中 skeleton，导致正在编辑的
    // input 被卸载重建、焦点丢失（表现为"每输入一个字符就退出编辑"）。
    // 改为局部 patch：只替换数组里那一项，loading 不再翻转。
    const next = get().locations.map(l =>
      l.id === id ? ({ ...l, ...patch, updatedAt: now } as ImportantLocation) : l
    )
    set({ locations: next })
  },

  deleteLocation: async (id) => {
    const loc = await db.importantLocations.get(id)
    if (!loc) return

    // 递归删除所有子地点
    const allLocs = await db.importantLocations
      .where('projectId')
      .equals(loc.projectId)
      .toArray()

    const toDelete = new Set<number>()
    const collect = (parentId: number) => {
      toDelete.add(parentId)
      for (const l of allLocs) {
        if (l.parentId === parentId && l.id != null) {
          collect(l.id)
        }
      }
    }
    collect(id)

    await db.importantLocations.bulkDelete([...toDelete])
    // 局部 set，避免 loading 闪烁
    set({ locations: get().locations.filter(l => l.id != null && !toDelete.has(l.id)) })
  },

  moveLocation: async (id, newParentId) => {
    const now = Date.now()
    await db.importantLocations.update(id, {
      parentId: newParentId,
      updatedAt: now,
    })
    // 局部 set，避免 loading 闪烁
    const next = get().locations.map(l =>
      l.id === id ? ({ ...l, parentId: newParentId, updatedAt: now } as ImportantLocation) : l
    )
    set({ locations: next })
  },

  getTree: () => {
    const { locations } = get()
    const map = new Map<number, LocationTreeNode>()
    const roots: LocationTreeNode[] = []

    for (const loc of locations) {
      map.set(loc.id!, { ...loc, children: [] })
    }

    for (const loc of locations) {
      const node = map.get(loc.id!)!
      if (loc.parentId == null) {
        roots.push(node)
      } else {
        const parent = map.get(loc.parentId)
        if (parent) {
          parent.children.push(node)
        } else {
          roots.push(node) // 父不存在当根
        }
      }
    }

    return roots
  },
}))
