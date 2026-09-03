import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Reference, CreateReferenceInput, ReferenceChunkAnalysis } from '../lib/types'
import {
  deleteReferenceWithAnalysis,
  getReferenceAnalysisRunChunks,
} from '../lib/reference-analysis/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

interface ReferenceStore {
  references: Reference[]
  loading: boolean
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addReference: (data: CreateReferenceInput) => Promise<number>
  updateReference: (id: number, data: Partial<Reference>) => Promise<void>
  deleteReference: (id: number) => Promise<void>

  // ── 深度分析相关 ──
  /** 获取某个参考的所有分块分析 */
  getChunkAnalyses: (refId: number, runId?: number) => Promise<ReferenceChunkAnalysis[]>
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const references = await readOwnedRows<Reference>(await resolveScopeLike(scopeInput), 'references', { owner: 'work' })
    set({ references, loading: false })
  },

  addReference: async (data: CreateReferenceInput) => {
    const now = Date.now()
    const stamped = stampNewRecord(await resolveScopeLike(data.projectId), 'references', { ...data, createdAt: now, updatedAt: now } as Reference, { owner: 'work' }) as Reference
    const id = await db.references.add(stamped)
    await get().loadAll(data.projectId)
    return id as number
  },

  updateReference: async (id: number, data: Partial<Reference>) => {
    await coordinatePendingEditV1({
      key: `reference:${id}`,
      persist: async () => {
        const initial = await db.references.get(id)
        if (!initial) return
        const scope = await resolveScopeLike(initial.projectId)
        const current = await db.references.get(id)
        if (!current || !await assertRecordInScope(scope, 'references', current, { owner: 'work' })) return
        await db.references.update(id, { ...data, updatedAt: Date.now() })
        const ref = await db.references.get(id)
        if (ref) await get().loadAll(ref.projectId)
      },
    })
  },

  deleteReference: async (id: number) => {
    const current = get().references.find(r => r.id === id) ?? await db.references.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'references', current, { owner: 'work' })) return
    const projectId = await deleteReferenceWithAnalysis(id)
    if (projectId) await get().loadAll(projectId)
  },

  // ── 深度分析相关 ──

  getChunkAnalyses: getReferenceAnalysisRunChunks,
}))
