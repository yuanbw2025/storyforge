import { create } from 'zustand'
import type { CultivationProgress } from '../lib/types'
import { deleteCultivationProgressEvent } from '../lib/cultivation/progress'
import { readOwnedRows, resolveReadScopeLike, type WorkspaceScopeLike } from '../lib/world-engine/scope'

interface CultivationProgressStore {
  events: CultivationProgress[]
  loading: boolean
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  deleteEvent: (id: number) => Promise<void>
}

export const useCultivationProgressStore = create<CultivationProgressStore>((set, get) => ({
  events: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    const scope = await resolveReadScopeLike(scopeInput)
    const events = await readOwnedRows<CultivationProgress>(scope, 'cultivationProgress', { owner: 'work' })
    set({ events, loading: false })
  },

  deleteEvent: async (id) => {
    const row = get().events.find(event => event.id === id)
    if (!row) return
    await deleteCultivationProgressEvent(row.projectId, id)
    set({ events: get().events.filter(event => event.id !== id) })
  },
}))
