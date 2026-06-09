/**
 * 故事进程年表 store — Phase 25.5.2-a
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StoryTimelineEvent } from '../lib/types'

interface StoryTimelineStore {
  events: StoryTimelineEvent[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addEvent: (e: Omit<StoryTimelineEvent, 'id' | 'createdAt'>) => Promise<number>
  addEvents: (es: Omit<StoryTimelineEvent, 'id' | 'createdAt'>[]) => Promise<void>
  updateEvent: (id: number, patch: Partial<StoryTimelineEvent>) => Promise<void>
  deleteEvent: (id: number) => Promise<void>
  deleteByChapter: (projectId: number, chapterId: number) => Promise<void>
}

const now = () => Date.now()

export const useStoryTimelineStore = create<StoryTimelineStore>((set, get) => ({
  events: [],
  loading: false,

  loadAll: async (projectId) => {
    set({ loading: true })
    const events = await db.storyTimelineEvents.where('projectId').equals(projectId).toArray()
    set({ events, loading: false })
  },

  addEvent: async (e) => {
    const id = await db.storyTimelineEvents.add({ ...e, createdAt: now() } as StoryTimelineEvent) as number
    set({ events: [...get().events, { ...e, id, createdAt: now() } as StoryTimelineEvent] })
    return id
  },

  addEvents: async (es) => {
    if (es.length === 0) return
    const ts = now()
    const rows = es.map(e => ({ ...e, createdAt: ts })) as StoryTimelineEvent[]
    const ids = await db.storyTimelineEvents.bulkAdd(rows, { allKeys: true }) as number[]
    set({ events: [...get().events, ...rows.map((r, i) => ({ ...r, id: ids[i] }))] })
  },

  updateEvent: async (id, patch) => {
    await db.storyTimelineEvents.update(id, patch)
    set({ events: get().events.map(e => e.id === id ? { ...e, ...patch } : e) })
  },

  deleteEvent: async (id) => {
    await db.storyTimelineEvents.delete(id)
    set({ events: get().events.filter(e => e.id !== id) })
  },

  deleteByChapter: async (projectId, chapterId) => {
    const toDelete = get().events.filter(e => e.projectId === projectId && e.chapterId === chapterId)
    await db.storyTimelineEvents.bulkDelete(toDelete.map(e => e.id!).filter(Boolean))
    set({ events: get().events.filter(e => !(e.projectId === projectId && e.chapterId === chapterId)) })
  },
}))
