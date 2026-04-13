import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Geography } from '../lib/types'

interface GeographyStore {
  geography: Geography | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  save: (data: Partial<Geography>) => Promise<void>
}

const now = () => Date.now()

export const useGeographyStore = create<GeographyStore>((set, get) => ({
  geography: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const geo = await db.geographies.where('projectId').equals(projectId).first()
    set({ geography: geo || null, loading: false })
  },

  save: async (data: Partial<Geography>) => {
    const { geography } = get()
    if (geography?.id) {
      await db.geographies.update(geography.id, { ...data, updatedAt: now() })
      set({ geography: { ...geography, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newGeo: Geography = {
        projectId: data.projectId,
        overview: '',
        locations: '[]',
        createdAt: now(),
        updatedAt: now(),
        ...data,
      }
      const id = await db.geographies.add(newGeo)
      set({ geography: { ...newGeo, id: id as number } })
    }
  },
}))
