/**
 * Phase 25.3 — 重要地点 Store
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ImportantLocation } from '../lib/types'
import { clearImportantLocationReferences } from '../lib/location/lifecycle'
import { transactionTablesForReferences } from '../lib/registry/lifecycle'
import { REGISTRY_BY_NAME } from '../lib/registry/project-tables'
import { assertRegisteredTreeParentV1 } from '../lib/registry/tree-relations'
import { collectLocationSubtreeV1, projectLocationForestV1, type LocationTreeNode } from '../lib/location/hierarchy'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

export type { LocationTreeNode } from '../lib/location/hierarchy'

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
    const capturedData = { ...data }
    const now = Date.now()
    const scope = await resolveScopeLike(capturedData.projectId)
    const newRow = await db.transaction('rw', scopeTransactionTables(db.importantLocations), async () => {
      await resolveScopeLike(scope)
      await assertRegisteredTreeParentV1({ spec: REGISTRY_BY_NAME.get('importantLocations')!, scope, parentId: capturedData.parentId })
      const row = stampNewRecord(scope, 'importantLocations', {
        ...capturedData, createdAt: now, updatedAt: now,
      } as ImportantLocation, { owner: 'world' }) as ImportantLocation
      const id = await db.importantLocations.add(row) as number
      return { ...row, id }
    })
    // 局部 set：不触发 loading 闪烁，避免编辑中的 input 失焦
    set({ locations: [...get().locations, newRow].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) })
    return newRow.id
  },

  updateLocation: async (id, patch) => {
    const capturedPatch = { ...patch }
    const now = Date.now()
    const existing = await db.importantLocations.get(id)
    if (!existing) return
    const scope = await resolveScopeLike(existing.projectId)
    const nextRow = await db.transaction('rw', scopeTransactionTables(db.importantLocations), async () => {
      await resolveScopeLike(scope)
      const current = await db.importantLocations.get(id)
      if (!current || !await assertRecordInScope(scope, 'importantLocations', current, { owner: 'world' })) return null
      const next = { ...current, ...capturedPatch, updatedAt: now }
      if ((capturedPatch.id != null && capturedPatch.id !== id)
        || !await assertRecordInScope(scope, 'importantLocations', next, { owner: 'world' })) {
        throw new Error('地点身份或归属不能随内容编辑改变。')
      }
      if (Object.prototype.hasOwnProperty.call(capturedPatch, 'parentId')) {
        await assertRegisteredTreeParentV1({ spec: REGISTRY_BY_NAME.get('importantLocations')!, scope, recordId: id, parentId: capturedPatch.parentId })
      }
      await db.importantLocations.update(id, { ...capturedPatch, updatedAt: now })
      return next
    })
    if (!nextRow) return
    // 关键修复：原实现走 loadAll(projectId)，会先 set({ loading: true })，
    // 让 LocationPanel 顶层 `if (loading)` 分支命中 skeleton，导致正在编辑的
    // input 被卸载重建、焦点丢失（表现为"每输入一个字符就退出编辑"）。
    // 改为局部 patch：只替换数组里那一项，loading 不再翻转。
    const next = get().locations.map(l =>
      l.id === id ? nextRow : l
    )
    set({ locations: next })
  },

  deleteLocation: async (id) => {
    const loc = await db.importantLocations.get(id)
    if (!loc) return
    const scope = await resolveScopeLike(loc.projectId)
    const toDelete = await db.transaction(
      'rw',
      scopeTransactionTables(...transactionTablesForReferences('importantLocations')),
      async () => {
        await resolveScopeLike(scope)
        const current = await db.importantLocations.get(id)
        if (!current || !await assertRecordInScope(scope, 'importantLocations', current, { owner: 'world' })) return null
        const all = await readOwnedRows<ImportantLocation>(scope, 'importantLocations', { owner: 'world' })
        const selected = collectLocationSubtreeV1(all, id)
        await clearImportantLocationReferences(scope.projectId, selected)
        await db.importantLocations.bulkDelete([...selected])
        return selected
      },
    )
    if (!toDelete) return
    // 局部 set，避免 loading 闪烁
    set({ locations: get().locations.filter(l => l.id != null && !toDelete.has(l.id)) })
  },

  moveLocation: async (id, newParentId) => {
    await get().updateLocation(id, { parentId: newParentId })
  },

  getTree: () => projectLocationForestV1(get().locations),
}))
