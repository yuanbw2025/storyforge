import { create } from 'zustand'
import type { StorylineCrossing, StorylineProgress, WorkspaceScope } from '../lib/types'
import { readOwnedRows, resolveReadScopeLike, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface StorylineProgressStore {
  progress: StorylineProgress[]
  crossings: StorylineCrossing[]
  loading: boolean
  loadError: string | null
  loadedScope: WorkspaceScope | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
}

let latestLoad = 0

export const useStorylineProgressStore = create<StorylineProgressStore>((set) => ({
  progress: [],
  crossings: [],
  loading: false,
  loadError: null,
  loadedScope: null,
  loadAll: async (scopeInput) => {
    const request = ++latestLoad
    set({ progress: [], crossings: [], loading: true, loadError: null, loadedScope: null })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const [progress, crossings] = await Promise.all([
        readOwnedRows<StorylineProgress>(scope, 'storylineProgress', { owner: 'work' }),
        readOwnedRows<StorylineCrossing>(scope, 'storylineCrossings', { owner: 'work' }),
      ])
      if (request === latestLoad) set({ progress, crossings, loading: false, loadError: null, loadedScope: { ...scope } })
    } catch (error) {
      if (request === latestLoad) set({ progress: [], crossings: [], loading: false, loadedScope: null, loadError: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },
}))
