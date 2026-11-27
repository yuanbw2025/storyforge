import { create } from 'zustand'
import Dexie, { type Transaction } from 'dexie'
import { db } from '../lib/db/schema'
import type { Reference, CreateReferenceInput, ReferenceChunkAnalysis, WorkspaceScope, ImportSession } from '../lib/types'
import {
  deleteReferenceWithAnalysis,
  getReferenceAnalysisRunChunks,
} from '../lib/reference-analysis/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScope, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../lib/authoring/local-save-evidence'
import { assertRecordTextSaveExpectedV1, recordTextSaveAckV1, recordTextSaveRequestV1 } from '../lib/authoring/record-text-save-evidence'

interface ReferenceAuthorUpdateV1 {
  (id: number, data: Partial<Reference>, options?: { scope?: WorkspaceScope; expected?: Partial<Reference> }): Promise<void>
  (id: number, data: Partial<Reference>, options: { scope: WorkspaceScope; expected?: Partial<Reference>; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
const authorFields = new Set(['title', 'author', 'type', 'note', 'url'])
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
let loadSequence = 0, writeRevision = 0

interface ReferenceStore {
  references: Reference[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addReference: (data: CreateReferenceInput, scope?: WorkspaceScope) => Promise<number>
  updateReference: ReferenceAuthorUpdateV1
  deleteReference: (id: number) => Promise<void>

  // ── 深度分析相关 ──
  /** 获取某个参考的所有分块分析 */
  getChunkAnalyses: (refId: number, runId?: number) => Promise<ReferenceChunkAnalysis[]>
}

export function referenceCreationTablesV1() {
  return scopeTransactionTables(db.references)
}

function stampNewReference(data: CreateReferenceInput, scope: WorkspaceScope) {
  const now = Date.now()
  return stampNewRecord(scope, 'references', { ...data, createdAt: now, updatedAt: now } as Reference, { owner: 'work' }) as Reference
}

/** Used when the author confirmation must commit its new reference and receipt atomically. */
export async function addReferenceInTransactionV1(data: CreateReferenceInput, input: { scope: WorkspaceScope; transaction: Transaction }) {
  const { scope, transaction } = input
  if (transaction.db !== db || transaction.mode !== 'readwrite' || !transaction.active ||
    Dexie.currentTransaction !== transaction || referenceCreationTablesV1().some(table => !transaction.storeNames.includes(table.name)))
    throw new Error('缺少原项目参考写入事务。')
  const owner = await Dexie.waitFor(resolveScope({ projectId: data.projectId, scope }))
  return transaction.table<Reference, number>(db.references.name).add(stampNewReference(data, owner))
}

export function importedReferenceDataV1(session: ImportSession & { id: number }, depth: 'quick' | 'deep'): CreateReferenceInput {
  return {
    projectId: session.projectId, title: session.filename.replace(/\.[^.]+$/, ''), author: '', type: 'story',
    note: `从「${session.filename}」导入 · ${session.totalChars.toLocaleString()} 字`, url: '', fileHash: session.fileHash,
    importSessionId: session.id, analysisDepth: depth, importedData: {
      worldview: session.merged.worldview, geography: session.merged.geography, history: session.merged.history,
      characters: session.merged.characters, outline: session.merged.outline,
      writingTechniques: session.merged.writingTechniques, codexCandidates: session.merged.codexCandidates,
      sourceFilename: session.filename, importedAt: Date.now(),
    },
  }
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: [],
  loading: false,
  loadedScope: null,
  loadError: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++loadSequence
    set({ loading: true, loadError: null })
    try {
      const scope = await resolveScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
      if (request !== loadSequence) return
      if (!sameWork(get().loadedScope, scope)) set({ references: [], loadedScope: null })
      let references: Reference[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision
        references = await readOwnedRows<Reference>(scope, 'references', { owner: 'work' })
        if (request !== loadSequence) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间参考持续变化，请重新读取。')
      if (request === loadSequence) set({ references, loading: false, loadedScope: scope })
    } catch (error) {
      if (request === loadSequence) set({ loading: false, loadError: error instanceof Error ? error.message : '参考读取失败。' })
      throw error
    }
  },

  addReference: async (data: CreateReferenceInput, explicitScope?: WorkspaceScope) => {
    const scope = await resolveScope({ projectId: data.projectId,
      ...(explicitScope ? { scope: structuredClone(explicitScope) } : {}) })
    const id = await db.references.add(stampNewReference(data, scope))
    await get().loadAll(explicitScope ? scope : data.projectId)
    return id as number
  },

  updateReference: ((id: number, input: Partial<Reference>, options?: { scope?: WorkspaceScope; expected?: Partial<Reference>; confirmation?: LocalSaveIntentV1 }) => {
    const data = structuredClone(input), expected = structuredClone(options?.expected ?? get().references.find(row => row.id === id))
    const confirmation = options?.confirmation ? structuredClone(options.confirmation) : undefined
    if (confirmation && Dexie.currentTransaction) return Promise.reject(new Error('参考保存确认需要独立提交。'))
    const explicitScope = options?.scope ? { ...options.scope } : undefined
    const captured = (async () => {
      if (explicitScope) return resolveScopeLike(explicitScope)
      const row = await db.references.get(id)
      if (!row) throw new Error('参考已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })()
    void captured.catch(() => undefined)
    return coordinatePendingEditV1({
      key: `reference:${id}`,
      persist: async () => {
        const scope = await captured
        for (const [field, value] of Object.entries(data)) {
          if (!authorFields.has(field) || typeof value !== 'string' || (field === 'type' && !['story', 'style', 'historical'].includes(value))) throw new Error('参考修改包含身份、分析结果或未登记的作者字段。')
        }
        const proof = confirmation ? recordTextSaveRequestV1('references', id, data, explicitScope, confirmation) : undefined
        let saved = await db.transaction('rw', referenceCreationTablesV1(), async transaction => {
          const table = transaction.table<Reference, number>('references'), update = db.references.update.bind(table)
          const current = await table.get(id)
          if (!current || !await assertRecordInScope(scope, 'references', current, { owner: 'work' })) throw new Error('参考不属于当前作品或已删除，输入尚未保存。')
          if (expected && Object.keys(data).some(field => Reflect.get(current, field) !== Reflect.get(expected, field))) throw new Error('参考字段已被其他页面修改，输入已保留。')
          if (confirmation) await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, confirmation, transaction))
          if (await update(id, { ...data, updatedAt: Math.max(Date.now(), current.updatedAt + 1) }) !== 1) throw new Error('参考写入0行，输入尚未保存。')
          const actual = await table.get(id)
          if (confirmation && proof) await Dexie.waitFor(recordTextSaveAckV1(actual, confirmation, proof.raw))
          if (!actual || !await assertRecordInScope(scope, 'references', actual, { owner: 'work' })) throw new Error('保存后的参考归属异常，输入已保留。')
          return actual
        })
        const revision = ++writeRevision
        let ack: LocalSaveAckV1 | undefined
        if (confirmation && proof) {
          const actual = await db.references.get(id)
          ack = await recordTextSaveAckV1(actual, confirmation, proof.raw); saved = actual!
        }
        if (revision === writeRevision && sameWork(get().loadedScope, scope)) set({ references: get().references.map(row => row.id === id ? saved : row) })
        return ack
      },
    })
  }) as ReferenceAuthorUpdateV1,

  deleteReference: async (id: number) => {
    const current = get().references.find(r => r.id === id) ?? await db.references.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'references', current, { owner: 'work' })) return
    const projectId = await deleteReferenceWithAnalysis(id)
    if (projectId) await get().loadAll(projectId)
  },

  // ── 深度分析相关 ──

  getChunkAnalyses: getReferenceAnalysisRunChunks,
}))
