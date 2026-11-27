import { transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'
import { cascadeRegisteredReferences } from '../lib/workspace/lifecycle'
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { buildForeshadowTaskContext } from '../lib/foreshadow/context'
import type { Chapter, Foreshadow, ForeshadowStatus, OutlineNode, WorkspaceScope } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import Dexie from 'dexie'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../lib/authoring/local-save-evidence'
import { assertRecordTextSaveExpectedV1, recordTextSaveAckV1, recordTextSaveRequestV1 } from '../lib/authoring/record-text-save-evidence'

interface AuthorOptions { scope?: WorkspaceScope; expected?: Partial<Foreshadow> }
interface ForeshadowAuthorUpdateV1 {
  (id: number, data: Partial<Foreshadow>, options?: AuthorOptions): Promise<void>
  (id: number, data: Partial<Foreshadow>, options: AuthorOptions & { scope: WorkspaceScope; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
const authorFields = new Map((FIELD_BY_TARGET.get('foreshadows') ?? []).filter(field => !field.adoptionPolicy).map(field => [field.field, field]))
const chapterFields = new Set(['plantChapterId', 'resolveChapterId', 'expectedResolveChapterId'])
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
let readRequest = 0, writeRevision = 0

interface ForeshadowStore {
  foreshadows: Foreshadow[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addForeshadow: (f: Omit<Foreshadow, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<number>
  updateForeshadow: ForeshadowAuthorUpdateV1
  deleteForeshadow: (id: number) => Promise<void>
  updateStatus: (id: number, status: ForeshadowStatus, options?: AuthorOptions) => Promise<void>

  // ── Phase C2: 伏笔上下文构建（注入 AI prompt） ──
  // 逾期/临近检测已并入 buildForeshadowTaskContext（按 canonical 章序，需传 chapters/outlineNodes）
  buildForeshadowContext: (currentChapterId: number, chapters?: Chapter[], outlineNodes?: OutlineNode[]) => string
}

const now = () => Date.now()

export const useForeshadowStore = create<ForeshadowStore>((set, get) => ({
  foreshadows: [],
  loading: false,
  loadedScope: null,
  loadError: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++readRequest
    set({ loading: true, loadError: null })
    try {
      const scope = await resolveScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
      if (request !== readRequest) return
      if (!sameWork(get().loadedScope, scope)) set({ foreshadows: [], loadedScope: null })
      let foreshadows: Foreshadow[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision
        foreshadows = await readOwnedRows<Foreshadow>(scope, 'foreshadows', { owner: 'work' })
        if (request !== readRequest) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间伏笔持续变化，请重新读取。')
      if (request === readRequest) set({ foreshadows, loading: false, loadedScope: scope })
    } catch (error) {
      if (request === readRequest) set({ loading: false, loadError: error instanceof Error ? error.message : '伏笔读取失败。' })
      throw error
    }
  },

  addForeshadow: async (f, explicitScope) => {
    f = structuredClone(f)
    const scope = await resolveScopeLike(explicitScope ? { ...explicitScope } : f.projectId)
    if (f.projectId !== scope.projectId) throw new Error('伏笔创建作用域不匹配。')
    const newF = stampNewRecord(scope, 'foreshadows', { ...f, createdAt: now(), updatedAt: now() } as Foreshadow, { owner: 'work' }) as Foreshadow
    const id = await db.foreshadows.add(newF) as number
    writeRevision++
    if (!get().loadedScope || sameWork(get().loadedScope, scope)) set({ foreshadows: [...get().foreshadows, { ...newF, id }], loadedScope: scope })
    return id
  },

  updateForeshadow: ((id: number, input: Partial<Foreshadow>, options?: AuthorOptions & { confirmation?: LocalSaveIntentV1 }) => {
    const data = structuredClone(input), expected = structuredClone(options?.expected ?? get().foreshadows.find(row => row.id === id))
    const confirmation = options?.confirmation ? structuredClone(options.confirmation) : undefined
    if (confirmation && Dexie.currentTransaction) return Promise.reject(new Error('伏笔保存确认需要独立提交。'))
    const explicitScope = options?.scope ? { ...options.scope } : undefined
    const captured = (async () => {
      if (explicitScope) return resolveScopeLike(explicitScope)
      const row = await db.foreshadows.get(id)
      if (!row) throw new Error('伏笔已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })()
    void captured.catch(() => undefined)
    return coordinatePendingEditV1({ key: `foreshadow:${id}`, persist: async () => {
      const scope = await captured
      const references: number[] = []
      for (const [field, value] of Object.entries(data)) {
        const spec = authorFields.get(field)
        if (!spec) throw new Error('伏笔修改包含身份、归属或未登记作者字段。')
        if (value == null && chapterFields.has(field)) continue
        if ((['string', 'longtext'].includes(spec.type) && typeof value !== 'string')
          || (spec.type === 'enum' && !spec.enums?.includes(value as string))
          || (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error(`伏笔 ${field} 格式异常。`)
        if (chapterFields.has(field)) references.push(value as number)
        if (field === 'echoChapterIds') {
          let ids: unknown
          try { ids = typeof value === 'string' ? JSON.parse(value) : null } catch { throw new Error('呼应章节必须是有效章节数组。') }
          if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('呼应章节必须是有效章节数组。')
          references.push(...ids)
        }
      }
      const proof = confirmation ? recordTextSaveRequestV1('foreshadows', id, data, explicitScope, confirmation) : undefined
      let saved = await db.transaction('rw', scopeTransactionTables(db.foreshadows, db.chapters), async transaction => {
        const table = transaction.table<Foreshadow, number>('foreshadows'), update = db.foreshadows.update.bind(table)
        const current = await table.get(id)
        if (!current || !await assertRecordInScope(scope, 'foreshadows', current, { owner: 'work' })) throw new Error('伏笔已删除或不属于当前作品，输入尚未保存。')
        if (expected && Object.keys(data).some(field => Reflect.get(current, field) !== Reflect.get(expected, field))) throw new Error('伏笔字段已被其他页面修改，输入已保留。')
        for (const chapterId of references) {
          if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new Error('伏笔章节标识无效。')
          const chapter = await transaction.table<Chapter, number>('chapters').get(chapterId)
          if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('伏笔引用章节已删除或不属于原作品。')
        }
        if (confirmation) await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, confirmation, transaction))
        if (await update(id, { ...data, updatedAt: Math.max(now(), current.updatedAt + 1) }) !== 1) throw new Error('伏笔写入0行，输入尚未保存。')
        const actual = await table.get(id)
        if (!actual || !await assertRecordInScope(scope, 'foreshadows', actual, { owner: 'work' }) || actual.ragDocumentId !== current.ragDocumentId
          || Object.entries(data).some(([field, value]) => Reflect.get(actual, field) !== value)) throw new Error('保存后未读到相同伏笔身份与输入原文。')
        if (confirmation && proof) await Dexie.waitFor(recordTextSaveAckV1(actual, confirmation, proof.raw))
        return actual
      })
      const revision = ++writeRevision
      let ack: LocalSaveAckV1 | undefined
      if (confirmation && proof) {
        const actual = await db.foreshadows.get(id)
        ack = await recordTextSaveAckV1(actual, confirmation, proof.raw); saved = actual!
      }
      if (revision === writeRevision && sameWork(get().loadedScope, scope)) set({ foreshadows: get().foreshadows.map(row => row.id === id ? saved : row) })
      return ack
    } })
  }) as ForeshadowAuthorUpdateV1,

  deleteForeshadow: async (id) => {
    const current = get().foreshadows.find(f => f.id === id) ?? await db.foreshadows.get(id)
    if (!current) return
    const scope = await resolveScopeLike(current.projectId)
    if (!await assertRecordInScope(scope, 'foreshadows', current, { owner: 'work' })) return
    await db.transaction('rw', transactionTablesForReferenceCascade('foreshadows'), async () => {
      await resolveScopeLike(scope)
      const persisted = await db.foreshadows.get(id)
      if (!persisted) return
      if (!await assertRecordInScope(scope, 'foreshadows', persisted, { owner: 'work' })) throw new Error('伏笔归属已变化；删除已取消，原数据保留。')
      await cascadeRegisteredReferences('foreshadows', id)
      await db.foreshadows.delete(id)
    })
    set({ foreshadows: get().foreshadows.filter(f => f.id !== id) })
  },

  updateStatus: (id, status, options) => get().updateForeshadow(id, { status }, options),

  // ── Phase C2 ──

  buildForeshadowContext: (currentChapterId, chapters = [], outlineNodes = []) => {
    return buildForeshadowTaskContext(get().foreshadows, { currentChapterId, chapters, outlineNodes })
  },
}))
