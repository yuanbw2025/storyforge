import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { ItemSystem } from '../lib/types'

interface ItemSystemStore {
  itemSystem: ItemSystem | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  save: (data: Partial<ItemSystem>) => Promise<void>
}

const now = () => Date.now()

export const useItemSystemStore = create<ItemSystemStore>((set, get) => ({
  itemSystem: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const is = await db.itemSystems.where('projectId').equals(projectId).first()
    set({ itemSystem: is || null, loading: false })
  },

  save: async (data: Partial<ItemSystem>) => {
    const { itemSystem } = get()
    if (itemSystem?.id) {
      await db.itemSystems.update(itemSystem.id, { ...data, updatedAt: now() })
      set({ itemSystem: { ...itemSystem, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newIs: ItemSystem = {
        projectId: data.projectId,
        overview: '',
        items: '[]',
        createdAt: now(),
        updatedAt: now(),
        ...data,
      }
      const id = await db.itemSystems.add(newIs)
      set({ itemSystem: { ...newIs, id: id as number } })
    }
  },
}))
