/**
 * 物品流水 store — Phase 25.5.2-b
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ItemLedgerEntry } from '../lib/types'

interface ItemLedgerStore {
  entries: ItemLedgerEntry[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addEntry: (entry: Omit<ItemLedgerEntry, 'id' | 'createdAt'>) => Promise<number>
  addEntries: (entries: Omit<ItemLedgerEntry, 'id' | 'createdAt'>[]) => Promise<void>
  updateEntry: (id: number, patch: Partial<ItemLedgerEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>
  /** 删除某章节的所有提取记录（重新提取前清理，避免重复） */
  deleteByChapter: (projectId: number, chapterId: number) => Promise<void>
}

const now = () => Date.now()

export const useItemLedgerStore = create<ItemLedgerStore>((set, get) => ({
  entries: [],
  loading: false,

  loadAll: async (projectId) => {
    set({ loading: true })
    const entries = await db.itemLedger.where('projectId').equals(projectId).toArray()
    set({ entries, loading: false })
  },

  addEntry: async (entry) => {
    const id = await db.itemLedger.add({ ...entry, createdAt: now() } as ItemLedgerEntry) as number
    set({ entries: [...get().entries, { ...entry, id, createdAt: now() } as ItemLedgerEntry] })
    return id
  },

  addEntries: async (entries) => {
    if (entries.length === 0) return
    const ts = now()
    const rows = entries.map(e => ({ ...e, createdAt: ts })) as ItemLedgerEntry[]
    const ids = await db.itemLedger.bulkAdd(rows, { allKeys: true }) as number[]
    const withIds = rows.map((r, i) => ({ ...r, id: ids[i] }))
    set({ entries: [...get().entries, ...withIds] })
  },

  updateEntry: async (id, patch) => {
    await db.itemLedger.update(id, patch)
    set({ entries: get().entries.map(e => e.id === id ? { ...e, ...patch } : e) })
  },

  deleteEntry: async (id) => {
    await db.itemLedger.delete(id)
    set({ entries: get().entries.filter(e => e.id !== id) })
  },

  deleteByChapter: async (projectId, chapterId) => {
    const toDelete = get().entries.filter(e => e.projectId === projectId && e.chapterId === chapterId)
    await db.itemLedger.bulkDelete(toDelete.map(e => e.id!).filter(Boolean))
    set({ entries: get().entries.filter(e => !(e.projectId === projectId && e.chapterId === chapterId)) })
  },
}))
