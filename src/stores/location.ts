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
    } as ImportantLocation)
    await get().loadAll(data.projectId)
    return id as number
  },

  updateLocation: async (id, patch) => {
    await db.importantLocations.update(id, { ...patch, updatedAt: Date.now() })
    const loc = await db.importantLocations.get(id)
    if (loc) await get().loadAll(loc.projectId)
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
    await get().loadAll(loc.projectId)
  },

  moveLocation: async (id, newParentId) => {
    await db.importantLocations.update(id, {
      parentId: newParentId,
      updatedAt: Date.now(),
    })
    const loc = await db.importantLocations.get(id)
    if (loc) await get().loadAll(loc.projectId)
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
