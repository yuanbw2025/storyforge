import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Foreshadow, ForeshadowStatus } from '../lib/types'

interface ForeshadowStore {
  foreshadows: Foreshadow[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addForeshadow: (f: Omit<Foreshadow, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateForeshadow: (id: number, data: Partial<Foreshadow>) => Promise<void>
  deleteForeshadow: (id: number) => Promise<void>
  updateStatus: (id: number, status: ForeshadowStatus) => Promise<void>
}

const now = () => Date.now()

export const useForeshadowStore = create<ForeshadowStore>((set, get) => ({
  foreshadows: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const foreshadows = await db.foreshadows
      .where('projectId').equals(projectId)
      .toArray()
    set({ foreshadows, loading: false })
  },

  addForeshadow: async (f) => {
    const newF: Foreshadow = { ...f, createdAt: now(), updatedAt: now() }
    const id = await db.foreshadows.add(newF) as number
    set({ foreshadows: [...get().foreshadows, { ...newF, id }] })
    return id
  },

  updateForeshadow: async (id, data) => {
    await db.foreshadows.update(id, { ...data, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, ...data, updatedAt: now() } : f
      ),
    })
  },

  deleteForeshadow: async (id) => {
    await db.foreshadows.delete(id)
    set({ foreshadows: get().foreshadows.filter(f => f.id !== id) })
  },

  updateStatus: async (id, status) => {
    await db.foreshadows.update(id, { status, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, status, updatedAt: now() } : f
      ),
    })
  },
}))
