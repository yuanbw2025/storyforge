import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Chapter } from '../lib/types'

interface ChapterStore {
  chapters: Chapter[]
  currentChapter: Chapter | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  selectChapter: (id: number) => void
  addChapter: (ch: Omit<Chapter, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateChapter: (id: number, data: Partial<Chapter>) => Promise<void>
  deleteChapter: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useChapterStore = create<ChapterStore>((set, get) => ({
  chapters: [],
  currentChapter: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const chapters = await db.chapters
      .where('projectId').equals(projectId)
      .sortBy('order')
    set({ chapters, loading: false })
  },

  selectChapter: (id: number) => {
    const ch = get().chapters.find(c => c.id === id) || null
    set({ currentChapter: ch })
  },

  addChapter: async (ch) => {
    const newCh: Chapter = { ...ch, createdAt: now(), updatedAt: now() }
    const id = await db.chapters.add(newCh) as number
    const withId = { ...newCh, id }
    set({ chapters: [...get().chapters, withId] })
    return id
  },

  updateChapter: async (id, data) => {
    const updated = { ...data, updatedAt: now() }
    await db.chapters.update(id, updated)
    const chapters = get().chapters.map(c =>
      c.id === id ? { ...c, ...updated } : c
    )
    const currentChapter = get().currentChapter?.id === id
      ? { ...get().currentChapter!, ...updated }
      : get().currentChapter
    set({ chapters, currentChapter })
  },

  deleteChapter: async (id) => {
    await db.chapters.delete(id)
    set({
      chapters: get().chapters.filter(c => c.id !== id),
      currentChapter: get().currentChapter?.id === id ? null : get().currentChapter,
    })
  },
}))
