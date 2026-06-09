import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { DetailedOutline } from '../lib/types'

interface DetailedOutlineStore {
  detailedOutlines: DetailedOutline[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  /** 获取或创建某章节的细纲 */
  getOrCreate: (projectId: number, outlineNodeId: number) => Promise<DetailedOutline>
  save: (id: number, patch: Partial<DetailedOutline>) => Promise<void>
  remove: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useDetailedOutlineStore = create<DetailedOutlineStore>((set, get) => ({
  detailedOutlines: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const list = await db.detailedOutlines.where('projectId').equals(projectId).toArray()
    set({ detailedOutlines: list, loading: false })
  },

  getOrCreate: async (projectId: number, outlineNodeId: number): Promise<DetailedOutline> => {
    const existing = get().detailedOutlines.find(d => d.outlineNodeId === outlineNodeId)
    if (existing) return existing
    // 内存没有时以 DB 为准再查一次，避免 store 未加载/竞态导致同一节点重复建细纲
    const inDb = await db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first()
    if (inDb) {
      if (!get().detailedOutlines.some(d => d.id === inDb.id)) {
        set({ detailedOutlines: [...get().detailedOutlines, inDb] })
      }
      return inDb
    }
    const fresh: DetailedOutline = {
      projectId, outlineNodeId, scenes: [],
      createdAt: now(), updatedAt: now(),
    }
    const id = await db.detailedOutlines.add(fresh) as number
    const withId = { ...fresh, id }
    set({ detailedOutlines: [...get().detailedOutlines, withId] })
    return withId
  },

  save: async (id, patch) => {
    const updated = { ...patch, updatedAt: now() }
    await db.detailedOutlines.update(id, updated)
    set({
      detailedOutlines: get().detailedOutlines.map(d =>
        d.id === id ? { ...d, ...updated } : d
      ),
    })
  },

  remove: async (id) => {
    await db.detailedOutlines.delete(id)
    set({ detailedOutlines: get().detailedOutlines.filter(d => d.id !== id) })
  },
}))
