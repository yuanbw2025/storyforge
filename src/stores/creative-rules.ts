import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { CreativeRules } from '../lib/types'

interface CreativeRulesStore {
  creativeRules: CreativeRules | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  save: (data: Partial<CreativeRules>) => Promise<void>
}

const now = () => Date.now()

export const useCreativeRulesStore = create<CreativeRulesStore>((set, get) => ({
  creativeRules: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const cr = await db.creativeRules.where('projectId').equals(projectId).first()
    set({ creativeRules: cr || null, loading: false })
  },

  save: async (data: Partial<CreativeRules>) => {
    const { creativeRules } = get()
    if (creativeRules?.id) {
      await db.creativeRules.update(creativeRules.id, { ...data, updatedAt: now() })
      set({ creativeRules: { ...creativeRules, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newCr: CreativeRules = {
        projectId: data.projectId,
        writingStyle: '',
        narrativePOV: 'third-limited',
        toneAndMood: '',
        prohibitions: '[]',
        consistencyRules: '[]',
        specialRequirements: '',
        referenceWorks: '[]',
        createdAt: now(),
        updatedAt: now(),
        ...data,
      }
      const id = await db.creativeRules.add(newCr)
      set({ creativeRules: { ...newCr, id: id as number } })
    }
  },
}))
