/**
 * 物品流水 store — Phase 25.5.2-b
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ItemLedgerEntry } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface ItemLedgerStore {
  entries: ItemLedgerEntry[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addEntry: (entry: Omit<ItemLedgerEntry, 'id' | 'createdAt'>) => Promise<number>
  addEntries: (entries: Omit<ItemLedgerEntry, 'id' | 'createdAt'>[]) => Promise<void>
  updateEntry: (id: number, patch: Partial<ItemLedgerEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>
  /** 删除某章节的所有提取记录（重新提取前清理，避免重复） */
  deleteByChapter: (scope: WorkspaceScopeLike, chapterId: number) => Promise<void>
}

const now = () => Date.now()

export const useItemLedgerStore = create<ItemLedgerStore>((set, get) => ({
  entries: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    const entries = await readOwnedRows<ItemLedgerEntry>(await resolveScopeLike(scopeInput), 'itemLedger', { owner: 'work' })
    set({ entries, loading: false })
  },

  addEntry: async (entry) => {
    const stamped = stampNewRecord(await resolveScopeLike(entry.projectId), 'itemLedger', { ...entry, createdAt: now() } as ItemLedgerEntry, { owner: 'work' }) as ItemLedgerEntry
    const id = await db.itemLedger.add(stamped) as number
    set({ entries: [...get().entries, { ...stamped, id }] })
    return id
  },

  addEntries: async (entries) => {
    if (entries.length === 0) return
    const ts = now()
    const scope = await resolveScopeLike(entries[0].projectId)
    if (entries.some(e => e.projectId !== scope.projectId)) throw new Error('[ItemLedger] 批量写入跨工作区')
    const rows = entries.map(e => stampNewRecord(scope, 'itemLedger', { ...e, createdAt: ts } as ItemLedgerEntry, { owner: 'work' })) as ItemLedgerEntry[]
    const ids = await db.itemLedger.bulkAdd(rows, { allKeys: true }) as number[]
    const withIds = rows.map((r, i) => ({ ...r, id: ids[i] }))
    set({ entries: [...get().entries, ...withIds] })
  },

  updateEntry: async (id, patch) => {
    const current = get().entries.find(e => e.id === id) ?? await db.itemLedger.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'itemLedger', current, { owner: 'work' })) return
    await db.itemLedger.update(id, patch)
    set({ entries: get().entries.map(e => e.id === id ? { ...e, ...patch } : e) })
  },

  deleteEntry: async (id) => {
    const current = get().entries.find(e => e.id === id) ?? await db.itemLedger.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'itemLedger', current, { owner: 'work' })) return
    await db.itemLedger.delete(id)
    set({ entries: get().entries.filter(e => e.id !== id) })
  },

  deleteByChapter: async (scopeInput, chapterId) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    const toDelete: ItemLedgerEntry[] = []
    for (const entry of get().entries) {
      if (entry.projectId === projectId && entry.chapterId === chapterId && entry.id != null
        && await assertRecordInScope(scope, 'itemLedger', entry, { owner: 'work' })) toDelete.push(entry)
    }
    await db.itemLedger.bulkDelete(toDelete.map(e => e.id!).filter(Boolean))
    const deletedIds = new Set(toDelete.map(e => e.id))
    set({ entries: get().entries.filter(e => !deletedIds.has(e.id)) })
  },
}))
