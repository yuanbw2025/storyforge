import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { buildForeshadowTaskContext } from '../lib/foreshadow/context'
import type { Chapter, Foreshadow, ForeshadowStatus, OutlineNode } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

interface ForeshadowStore {
  foreshadows: Foreshadow[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addForeshadow: (f: Omit<Foreshadow, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateForeshadow: (id: number, data: Partial<Foreshadow>) => Promise<void>
  deleteForeshadow: (id: number) => Promise<void>
  updateStatus: (id: number, status: ForeshadowStatus) => Promise<void>

  // ── Phase C2: 伏笔上下文构建（注入 AI prompt） ──
  // 逾期/临近检测已并入 buildForeshadowTaskContext（按 canonical 章序，需传 chapters/outlineNodes）
  buildForeshadowContext: (currentChapterId: number, chapters?: Chapter[], outlineNodes?: OutlineNode[]) => string
}

const now = () => Date.now()

export const useForeshadowStore = create<ForeshadowStore>((set, get) => ({
  foreshadows: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const foreshadows = await readOwnedRows<Foreshadow>(await resolveScopeLike(scopeInput), 'foreshadows', { owner: 'work' })
    set({ foreshadows, loading: false })
  },

  addForeshadow: async (f) => {
    const newF = stampNewRecord(await resolveScopeLike(f.projectId), 'foreshadows', { ...f, createdAt: now(), updatedAt: now() } as Foreshadow, { owner: 'work' }) as Foreshadow
    const id = await db.foreshadows.add(newF) as number
    set({ foreshadows: [...get().foreshadows, { ...newF, id }] })
    return id
  },

  updateForeshadow: async (id, data) => {
    const current = get().foreshadows.find(f => f.id === id) ?? await db.foreshadows.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'foreshadows', current, { owner: 'work' })) return
    await db.foreshadows.update(id, { ...data, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, ...data, updatedAt: now() } : f
      ),
    })
  },

  deleteForeshadow: async (id) => {
    const current = get().foreshadows.find(f => f.id === id) ?? await db.foreshadows.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'foreshadows', current, { owner: 'work' })) return
    await db.foreshadows.delete(id)
    set({ foreshadows: get().foreshadows.filter(f => f.id !== id) })
  },

  updateStatus: async (id, status) => {
    const current = get().foreshadows.find(f => f.id === id) ?? await db.foreshadows.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'foreshadows', current, { owner: 'work' })) return
    await db.foreshadows.update(id, { status, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, status, updatedAt: now() } : f
      ),
    })
  },

  // ── Phase C2 ──

  buildForeshadowContext: (currentChapterId, chapters = [], outlineNodes = []) => {
    return buildForeshadowTaskContext(get().foreshadows, { currentChapterId, chapters, outlineNodes })
  },
}))
