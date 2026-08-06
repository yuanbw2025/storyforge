/**
 * 便签/笔记 Store — Phase H3
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Note, NoteColor } from '../lib/types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/world-engine/scope'

const now = () => Date.now()

interface NoteStore {
  notes: Note[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addNote: (projectId: number, content?: string, chapterId?: number, color?: NoteColor) => Promise<number>
  updateNote: (id: number, data: Partial<Note>) => Promise<void>
  deleteNote: (id: number) => Promise<void>
  togglePin: (id: number) => Promise<void>

  /** 获取某章节的便签 */
  getChapterNotes: (chapterId: number) => Note[]
  /** 获取未关联章节的便签 */
  getGlobalNotes: () => Note[]
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    const notes = await readOwnedRows<Note>(await resolveReadScopeLike(scopeInput), 'notes', { owner: 'work' })
    set({ notes: notes.sort((a, b) => {
      // 置顶优先，再按时间倒序
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    }), loading: false })
  },

  addNote: async (projectId, content = '', chapterId, color = 'yellow') => {
    const scope = await resolveScopeLike(projectId)
    if (chapterId != null) {
      const chapter = await db.chapters.get(chapterId)
      if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
        throw new Error('便签关联章节不属于当前作品')
      }
    }
    const note = stampNewRecord(scope, 'notes', {
      projectId,
      chapterId,
      content,
      color,
      pinned: false,
      createdAt: now(),
      updatedAt: now(),
    } as Note, { owner: 'work' }) as Note
    const id = await db.notes.add(note) as number
    set({ notes: [{ ...note, id }, ...get().notes] })
    return id
  },

  updateNote: async (id, data) => {
    const beforeMigration = await db.notes.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.notes.get(id)
    if (!current || !await assertRecordInScope(scope, 'notes', current, { owner: 'work' })) return
    if (data.chapterId != null) {
      const chapter = await db.chapters.get(data.chapterId)
      if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) return
    }
    const patch = { ...data, updatedAt: now() }
    await db.notes.update(id, patch)
    set({
      notes: get().notes.map(n => n.id === id ? { ...n, ...patch } : n),
    })
  },

  deleteNote: async (id) => {
    const beforeMigration = await db.notes.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.notes.get(id)
    if (!current || !await assertRecordInScope(scope, 'notes', current, { owner: 'work' })) return
    await db.notes.delete(id)
    set({ notes: get().notes.filter(n => n.id !== id) })
  },

  togglePin: async (id) => {
    const beforeMigration = get().notes.find(n => n.id === id) ?? await db.notes.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const note = await db.notes.get(id)
    if (!note || !await assertRecordInScope(scope, 'notes', note, { owner: 'work' })) return
    const pinned = !note.pinned
    await db.notes.update(id, { pinned, updatedAt: now() })
    const updated = get().notes.map(n => n.id === id ? { ...n, pinned, updatedAt: now() } : n)
    updated.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
    set({ notes: updated })
  },

  getChapterNotes: (chapterId) => {
    return get().notes.filter(n => n.chapterId === chapterId)
  },

  getGlobalNotes: () => {
    return get().notes.filter(n => !n.chapterId)
  },
}))
