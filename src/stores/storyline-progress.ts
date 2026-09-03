import { create } from 'zustand'
import type { StorylineCrossing, StorylineProgress } from '../lib/types'
import { readOwnedRows, resolveReadScopeLike, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface StorylineProgressStore {
  progress: StorylineProgress[]
  crossings: StorylineCrossing[]
  loading: boolean
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
}

export const useStorylineProgressStore = create<StorylineProgressStore>((set) => ({
  progress: [],
  crossings: [],
  loading: false,
  loadAll: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const [progress, crossings] = await Promise.all([
        readOwnedRows<StorylineProgress>(scope, 'storylineProgress', { owner: 'work' }),
        readOwnedRows<StorylineCrossing>(scope, 'storylineCrossings', { owner: 'work' }),
      ])
      set({ progress, crossings, loading: false })
    } catch (error) {
      console.error('[StorylineProgress] loadAll 失败:', error)
      set({ loading: false })
    }
  },
}))
