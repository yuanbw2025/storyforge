import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Reference, CreateReferenceInput, ReferenceChunkAnalysis } from '../lib/types'

interface ReferenceStore {
  references: Reference[]
  loading: boolean
  loadAll: (projectId: number) => Promise<void>
  addReference: (data: CreateReferenceInput) => Promise<number>
  updateReference: (id: number, data: Partial<Reference>) => Promise<void>
  deleteReference: (id: number) => Promise<void>

  // ── 深度分析相关 ──
  /** 获取某个参考的所有分块分析 */
  getChunkAnalyses: (refId: number) => Promise<ReferenceChunkAnalysis[]>
  /** 删除某个参考的所有分块分析（重新分析前清理） */
  clearChunkAnalyses: (refId: number) => Promise<void>
  /** 更新分析状态（pipeline 回写用） */
  patchAnalysisStatus: (refId: number, patch: Partial<Reference>) => Promise<void>
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const references = await db.references.where('projectId').equals(projectId).toArray()
    set({ references, loading: false })
  },

  addReference: async (data: CreateReferenceInput) => {
    const now = Date.now()
    const id = await db.references.add({ ...data, createdAt: now, updatedAt: now } as Reference)
    await get().loadAll(data.projectId)
    return id as number
  },

  updateReference: async (id: number, data: Partial<Reference>) => {
    await db.references.update(id, { ...data, updatedAt: Date.now() })
    const ref = await db.references.get(id)
    if (ref) await get().loadAll(ref.projectId)
  },

  deleteReference: async (id: number) => {
    const ref = await db.references.get(id)
    if (!ref) return
    // 级联删除分块分析
    await db.referenceChunkAnalysis.where('referenceId').equals(id).delete()
    await db.references.delete(id)
    await get().loadAll(ref.projectId)
  },

  // ── 深度分析相关 ──

  getChunkAnalyses: async (refId: number) => {
    return db.referenceChunkAnalysis
      .where('referenceId').equals(refId)
      .sortBy('chunkIndex')
  },

  clearChunkAnalyses: async (refId: number) => {
    await db.referenceChunkAnalysis.where('referenceId').equals(refId).delete()
  },

  patchAnalysisStatus: async (refId: number, patch: Partial<Reference>) => {
    await db.references.update(refId, { ...patch, updatedAt: Date.now() })
    const ref = await db.references.get(refId)
    if (ref) await get().loadAll(ref.projectId)
  },
}))
