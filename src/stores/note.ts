/** Work-local notes. Persistence stays in the original notes table and writer. */
import { create } from 'zustand'
import Dexie from 'dexie'
import { db } from '../lib/db/schema'
import { NOTE_COLORS } from '../lib/types/note'
import type { Note, NoteColor, WorkspaceScope } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { assertRecordTextSaveExpectedV1, recordTextSaveAckV1, recordTextSaveRequestV1 } from '../lib/authoring/record-text-save-evidence'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../lib/authoring/local-save-evidence'

const now = () => Date.now()
let readSequence = 0, writeRevision = 0
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
const sortNotes = (notes: Note[]) => notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
interface NoteAuthorUpdateV1 {
  (id: number, data: Partial<Note>, options?: { scope?: WorkspaceScope }): Promise<void>
  (id: number, data: Partial<Note>, options: { scope: WorkspaceScope; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
function validatePatch(data: Partial<Note>) {
  if (Object.keys(data).some(key => !['content', 'chapterId', 'color', 'pinned'].includes(key))) throw new Error('便签修改不能改变原记录身份或归属。')
  if ('content' in data && typeof data.content !== 'string') throw new Error('便签内容必须是原文。')
  if ('color' in data && !Object.prototype.hasOwnProperty.call(NOTE_COLORS, data.color!)) throw new Error('便签颜色无效。')
  if ('pinned' in data && typeof data.pinned !== 'boolean') throw new Error('便签置顶状态无效。')
  if (data.chapterId != null && (!Number.isSafeInteger(data.chapterId) || data.chapterId < 1)) throw new Error('便签章节无效。')
}
interface NoteStore {
  notes: Note[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addNote: (projectId: number, content?: string, chapterId?: number, color?: NoteColor, scope?: WorkspaceScope) => Promise<number>
  updateNote: NoteAuthorUpdateV1
  deleteNote: (id: number, scope?: WorkspaceScope) => Promise<void>
  togglePin: (id: number, scope?: WorkspaceScope) => Promise<void>
  getChapterNotes: (chapterId: number) => Note[]
  getGlobalNotes: () => Note[]
}
export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [], loading: false, loadedScope: null,
  loadAll: async input => {
    const request = ++readSequence; set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(typeof input === 'number' ? input : { ...input })
      let notes: Note[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision; notes = await readOwnedRows<Note>(scope, 'notes', { owner: 'work' })
        if (request !== readSequence) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间便签持续变化，请重新读取。')
      if (request === readSequence) set({ notes: sortNotes(notes), loading: false, loadedScope: scope })
    } catch (cause) { if (request === readSequence) set({ loading: false }); throw cause }
  },
  addNote: async (projectId, content = '', chapterId, color = 'yellow', frozenScope) => {
    const data = { content, chapterId, color, pinned: false }; validatePatch(data)
    const scope = await resolveScopeLike(frozenScope ? { ...frozenScope } : projectId)
    if (scope.projectId !== projectId) throw new Error('便签创建作用域不匹配。')
    const created = await db.transaction('rw', scopeTransactionTables(db.notes, db.chapters), async transaction => {
      const table = transaction.table<Note, number>('notes')
      await resolveScopeLike(scope)
      if (chapterId != null) {
        const chapter = await transaction.table('chapters').get(chapterId)
        if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('便签关联章节不属于当前作品')
      }
      const note = stampNewRecord(scope, 'notes', { projectId, ...data, createdAt: now(), updatedAt: now() } as Note, { owner: 'work' })
      const id = await db.notes.add.bind(table)(note) as number, actual = await table.get(id)
      if (!actual || !await assertRecordInScope(scope, 'notes', actual, { owner: 'work' }) || Object.entries(data).some(([key, value]) => Reflect.get(actual, key) !== value)) throw new Error('新便签未能精确保存。')
      return actual
    })
    writeRevision++
    const actual = await db.notes.get(created.id!)
    if (!actual || actual.createdAt !== created.createdAt || !await assertRecordInScope(scope, 'notes', actual, { owner: 'work' }) || Object.entries(data).some(([key, value]) => Reflect.get(actual, key) !== value)) throw new Error('新便签尚未确认回读，请重新读取列表后核对，避免重复创建。')
    if (!get().loadedScope || sameWork(get().loadedScope, scope)) set({ notes: sortNotes([actual, ...get().notes.filter(note => note.id !== actual.id)]), loadedScope: scope })
    return actual.id!
  },
  updateNote: ((id: number, input: Partial<Note>, options?: { scope?: WorkspaceScope; confirmation?: LocalSaveIntentV1 }) => {
    const data = structuredClone(input), config = options ? structuredClone(options) : undefined
    const selected = (async () => {
      if (config?.scope) return resolveScopeLike(config.scope)
      const row = await db.notes.get(id)
      if (!row) throw new Error('原便签已删除，输入已保留。')
      return resolveScopeLike(row.projectId)
    })()
    void selected.catch(() => undefined)
    return coordinatePendingEditV1({ key: `note:${id}`, persist: async () => {
      validatePatch(data)
      const scope = await selected, confirmation = config?.confirmation
      if (confirmation && Dexie.currentTransaction) throw new Error('便签保存确认需要独立提交。')
      const proof = confirmation ? recordTextSaveRequestV1('notes', id, data, config?.scope, confirmation) : undefined
      const saved = await db.transaction('rw', scopeTransactionTables(db.notes, db.chapters), async transaction => {
        const table = transaction.table<Note, number>('notes'), current = await table.get(id)
        if (!current || !await assertRecordInScope(scope, 'notes', current, { owner: 'work' })) throw new Error('原便签不存在或不属于当前作品，输入已保留。')
        if (data.chapterId != null) {
          const chapter = await transaction.table('chapters').get(data.chapterId)
          if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('便签关联章节不属于当前作品')
        }
        if (confirmation) await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, confirmation, transaction))
        if (await db.notes.update.bind(table)(id, { ...data, updatedAt: Math.max(now(), current.updatedAt + 1) }) !== 1) throw new Error('便签写入0行，输入已保留。')
        const actual = await table.get(id)
        if (!actual || actual.createdAt !== current.createdAt || !await assertRecordInScope(scope, 'notes', actual, { owner: 'work' }) || Object.entries(data).some(([key, value]) => Reflect.get(actual, key) !== value)) throw new Error('便签精确保存校验失败，输入已保留。')
        if (confirmation && proof) await Dexie.waitFor(recordTextSaveAckV1(actual, confirmation, proof.raw))
        return actual
      })
      const revision = ++writeRevision, actual = await db.notes.get(id)
      if (!actual || actual.createdAt !== saved.createdAt || !await assertRecordInScope(scope, 'notes', actual, { owner: 'work' }) || Object.entries(data).some(([key, value]) => Reflect.get(actual, key) !== value)) throw new Error('便签提交后尚未确认原文，输入已保留。')
      const ack = confirmation && proof ? await recordTextSaveAckV1(actual, confirmation, proof.raw) : undefined
      if (revision === writeRevision && sameWork(get().loadedScope, scope)) set({ notes: sortNotes(get().notes.map(note => note.id === id ? actual : note)) })
      return ack
    } })
  }) as NoteAuthorUpdateV1,
  deleteNote: async (id, explicitScope) => {
    const row = await db.notes.get(id)
    if (!row) return
    const scope = await resolveScopeLike(explicitScope ? { ...explicitScope } : row.projectId)
    if (!await assertRecordInScope(scope, 'notes', row, { owner: 'work' })) throw new Error('便签不属于当前作品。')
    await db.notes.delete(id); writeRevision++
    if (sameWork(get().loadedScope, scope)) set({ notes: get().notes.filter(note => note.id !== id) })
  },
  togglePin: async (id, explicitScope) => {
    const note = await db.notes.get(id)
    if (!note) throw new Error('原便签已删除。')
    await get().updateNote(id, { pinned: !note.pinned }, { scope: explicitScope })
  },
  getChapterNotes: chapterId => get().notes.filter(note => note.chapterId === chapterId),
  getGlobalNotes: () => get().notes.filter(note => !note.chapterId),
}))
