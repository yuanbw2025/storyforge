import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { History } from '../lib/types'

interface HistoryStore {
  history: History | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  save: (data: Partial<History>) => Promise<void>
}

const now = () => Date.now()

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  history: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const hist = await db.histories.where('projectId').equals(projectId).first()
    set({ history: hist || null, loading: false })
  },

  save: async (data: Partial<History>) => {
    const { history } = get()
    if (history?.id) {
      await db.histories.update(history.id, { ...data, updatedAt: now() })
      set({ history: { ...history, ...data, updatedAt: now() } })
    } else if (data.projectId) {
      const newHist: History = {
        projectId: data.projectId,
        overview: '',
        eraSystem: '',
        events: '[]',
        createdAt: now(),
        updatedAt: now(),
        ...data,
      }
      const id = await db.histories.add(newHist)
      set({ history: { ...newHist, id: id as number } })
    }
  },
}))
