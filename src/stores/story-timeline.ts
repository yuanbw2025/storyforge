/**
 * 故事进程年表 store — Phase 25.5.2-a
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StoryTimelineEvent } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface StoryTimelineStore {
  events: StoryTimelineEvent[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addEvent: (e: Omit<StoryTimelineEvent, 'id' | 'createdAt'>) => Promise<number>
  addEvents: (es: Omit<StoryTimelineEvent, 'id' | 'createdAt'>[]) => Promise<void>
  updateEvent: (id: number, patch: Partial<StoryTimelineEvent>) => Promise<void>
  deleteEvent: (id: number) => Promise<void>
  deleteByChapter: (scope: WorkspaceScopeLike, chapterId: number) => Promise<void>
}

const now = () => Date.now()

export const useStoryTimelineStore = create<StoryTimelineStore>((set, get) => ({
  events: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    const events = await readOwnedRows<StoryTimelineEvent>(await resolveScopeLike(scopeInput), 'storyTimelineEvents', { owner: 'work' })
    set({ events, loading: false })
  },

  addEvent: async (e) => {
    const stamped = stampNewRecord(await resolveScopeLike(e.projectId), 'storyTimelineEvents', { ...e, createdAt: now() } as StoryTimelineEvent, { owner: 'work' }) as StoryTimelineEvent
    const id = await db.storyTimelineEvents.add(stamped) as number
    set({ events: [...get().events, { ...stamped, id }] })
    return id
  },

  addEvents: async (es) => {
    if (es.length === 0) return
    const ts = now()
    const scope = await resolveScopeLike(es[0].projectId)
    if (es.some(e => e.projectId !== scope.projectId)) throw new Error('[StoryTimeline] 批量写入跨工作区')
    const rows = es.map(e => stampNewRecord(scope, 'storyTimelineEvents', { ...e, createdAt: ts } as StoryTimelineEvent, { owner: 'work' })) as StoryTimelineEvent[]
    const ids = await db.storyTimelineEvents.bulkAdd(rows, { allKeys: true }) as number[]
    set({ events: [...get().events, ...rows.map((r, i) => ({ ...r, id: ids[i] }))] })
  },

  updateEvent: async (id, patch) => {
    const current = get().events.find(e => e.id === id) ?? await db.storyTimelineEvents.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'storyTimelineEvents', current, { owner: 'work' })) return
    await db.storyTimelineEvents.update(id, patch)
    set({ events: get().events.map(e => e.id === id ? { ...e, ...patch } : e) })
  },

  deleteEvent: async (id) => {
    const current = get().events.find(e => e.id === id) ?? await db.storyTimelineEvents.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'storyTimelineEvents', current, { owner: 'work' })) return
    await db.storyTimelineEvents.delete(id)
    set({ events: get().events.filter(e => e.id !== id) })
  },

  deleteByChapter: async (scopeInput, chapterId) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    const toDelete: StoryTimelineEvent[] = []
    for (const event of get().events) {
      if (event.projectId === projectId && event.chapterId === chapterId && event.id != null
        && await assertRecordInScope(scope, 'storyTimelineEvents', event, { owner: 'work' })) toDelete.push(event)
    }
    await db.storyTimelineEvents.bulkDelete(toDelete.map(e => e.id!).filter(Boolean))
    const deletedIds = new Set(toDelete.map(e => e.id))
    set({ events: get().events.filter(e => !deletedIds.has(e.id)) })
  },
}))
