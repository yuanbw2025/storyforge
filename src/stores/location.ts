/**
 * Phase 25.3 — 重要地点 Store
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ImportantLocation } from '../lib/types'
import { clearImportantLocationReferences } from '../lib/location/lifecycle'
import { transactionTablesForReferences } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

/** 树形节点（带 children，UI 用） */
export interface LocationTreeNode extends ImportantLocation {
  children: LocationTreeNode[]
}

interface LocationStore {
  locations: ImportantLocation[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
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

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const locations = (await readOwnedRows<ImportantLocation>(await resolveScopeLike(scopeInput), 'importantLocations', { owner: 'world' }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    set({ locations, loading: false })
  },

  addLocation: async (data) => {
    const now = Date.now()
    const scope = await resolveScopeLike(data.projectId)
    if (data.parentId != null) {
      const parent = await db.importantLocations.get(data.parentId)
      if (!parent || !await assertRecordInScope(scope, 'importantLocations', parent, { owner: 'world' })) {
        throw new Error('[Location] 父地点不属于当前 World')
      }
    }
    const row = stampNewRecord(scope, 'importantLocations', {
      ...data,
      createdAt: now,
      updatedAt: now,
    } as ImportantLocation, { owner: 'world' }) as ImportantLocation
    const id = await db.importantLocations.add(row) as number
    // 局部 set：不触发 loading 闪烁，避免编辑中的 input 失焦
    const newRow: ImportantLocation = { ...row, id }
    set({ locations: [...get().locations, newRow].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) })
    return id
  },

  updateLocation: async (id, patch) => {
    const now = Date.now()
    const current = get().locations.find(l => l.id === id) ?? await db.importantLocations.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'importantLocations', current, { owner: 'world' })) return
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
    const scope = await resolveScopeLike(loc.projectId)
    if (!await assertRecordInScope(scope, 'importantLocations', loc, { owner: 'world' })) return

    // 递归删除所有子地点
    const allLocs = await readOwnedRows<ImportantLocation>(scope, 'importantLocations', { owner: 'world' })

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

    await db.transaction(
      'rw',
      transactionTablesForReferences('importantLocations'),
      async () => {
        await clearImportantLocationReferences(loc.projectId, toDelete)
        await db.importantLocations.bulkDelete([...toDelete])
      },
    )
    // 局部 set，避免 loading 闪烁
    set({ locations: get().locations.filter(l => l.id != null && !toDelete.has(l.id)) })
  },

  moveLocation: async (id, newParentId) => {
    const now = Date.now()
    const current = get().locations.find(l => l.id === id) ?? await db.importantLocations.get(id)
    if (!current) return
    const scope = await resolveScopeLike(current.projectId)
    if (!await assertRecordInScope(scope, 'importantLocations', current, { owner: 'world' })) return
    if (newParentId != null) {
      const parent = await db.importantLocations.get(newParentId)
      if (!parent || !await assertRecordInScope(scope, 'importantLocations', parent, { owner: 'world' })) return
    }
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
