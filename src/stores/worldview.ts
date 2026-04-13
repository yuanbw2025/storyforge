import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Worldview, StoryCore, PowerSystem } from '../lib/types'

interface WorldviewStore {
  worldview: Worldview | null
  storyCore: StoryCore | null
  powerSystem: PowerSystem | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>

  saveWorldview: (data: Partial<Worldview>) => Promise<void>
  saveStoryCore: (data: Partial<StoryCore>) => Promise<void>
  savePowerSystem: (data: Partial<PowerSystem>) => Promise<void>
}

const now = () => Date.now()

export const useWorldviewStore = create<WorldviewStore>((set, get) => ({
  worldview: null,
  storyCore: null,
  powerSystem: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const [wv, sc, ps] = await Promise.all([
      db.worldviews.where('projectId').equals(projectId).first(),
      db.storyCores.where('projectId').equals(projectId).first(),
      db.powerSystems.where('projectId').equals(projectId).first(),
    ])
    set({
      worldview: wv || null,
      storyCore: sc || null,
      powerSystem: ps || null,
      loading: false,
    })
  },

  saveWorldview: async (data: Partial<Worldview>) => {
    const { worldview } = get()
    if (worldview?.id) {
      await db.worldviews.update(worldview.id, { ...data, updatedAt: now() })
      set({ worldview: { ...worldview, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newWv: Worldview = {
        projectId: data.projectId,
        geography: '', history: '', society: '',
        culture: '', economy: '', rules: '', summary: '',
        createdAt: now(), updatedAt: now(),
        ...data,
      }
      const id = await db.worldviews.add(newWv)
      set({ worldview: { ...newWv, id: id as number } })
    }
  },

  saveStoryCore: async (data: Partial<StoryCore>) => {
    const { storyCore } = get()
    if (storyCore?.id) {
      await db.storyCores.update(storyCore.id, { ...data, updatedAt: now() })
      set({ storyCore: { ...storyCore, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newSc: StoryCore = {
        projectId: data.projectId,
        theme: '', centralConflict: '', plotPattern: '', storyLines: '',
        createdAt: now(), updatedAt: now(),
        ...data,
      }
      const id = await db.storyCores.add(newSc)
      set({ storyCore: { ...newSc, id: id as number } })
    }
  },

  savePowerSystem: async (data: Partial<PowerSystem>) => {
    const { powerSystem } = get()
    if (powerSystem?.id) {
      await db.powerSystems.update(powerSystem.id, { ...data, updatedAt: now() })
      set({ powerSystem: { ...powerSystem, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newPs: PowerSystem = {
        projectId: data.projectId,
        name: '', description: '', levels: '', rules: '',
        createdAt: now(), updatedAt: now(),
        ...data,
      }
      const id = await db.powerSystems.add(newPs)
      set({ powerSystem: { ...newPs, id: id as number } })
    }
  },
}))
