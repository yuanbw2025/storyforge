import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { buildForeshadowTaskContext } from '../lib/foreshadow/context'
import type { Foreshadow, ForeshadowStatus, ForeshadowUrgency } from '../lib/types'

interface ForeshadowStore {
  foreshadows: Foreshadow[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addForeshadow: (f: Omit<Foreshadow, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateForeshadow: (id: number, data: Partial<Foreshadow>) => Promise<void>
  deleteForeshadow: (id: number) => Promise<void>
  updateStatus: (id: number, status: ForeshadowStatus) => Promise<void>

  // ── Phase C1: 逾期检测 ──
  /** 获取已逾期（超过预期回收章节但仍未回收）的伏笔 */
  getOverdue: (currentChapterId: number) => Foreshadow[]
  /** 获取即将需要回收的伏笔（在未来 range 章内） */
  getUpcoming: (currentChapterId: number, range?: number) => Foreshadow[]
  /** 计算单条伏笔的紧急度 */
  computeUrgency: (f: Foreshadow, currentChapterId: number) => ForeshadowUrgency

  // ── Phase C2: 伏笔上下文构建（注入 AI prompt） ──
  buildForeshadowContext: (currentChapterId: number) => string
}

const now = () => Date.now()

export const useForeshadowStore = create<ForeshadowStore>((set, get) => ({
  foreshadows: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const foreshadows = await db.foreshadows
      .where('projectId').equals(projectId)
      .toArray()
    set({ foreshadows, loading: false })
  },

  addForeshadow: async (f) => {
    const newF: Foreshadow = { ...f, createdAt: now(), updatedAt: now() }
    const id = await db.foreshadows.add(newF) as number
    set({ foreshadows: [...get().foreshadows, { ...newF, id }] })
    return id
  },

  updateForeshadow: async (id, data) => {
    await db.foreshadows.update(id, { ...data, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, ...data, updatedAt: now() } : f
      ),
    })
  },

  deleteForeshadow: async (id) => {
    await db.foreshadows.delete(id)
    set({ foreshadows: get().foreshadows.filter(f => f.id !== id) })
  },

  updateStatus: async (id, status) => {
    await db.foreshadows.update(id, { status, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, status, updatedAt: now() } : f
      ),
    })
  },

  // ── Phase C1 ──

  getOverdue: (currentChapterId) => {
    return get().foreshadows.filter(f => {
      if (f.status === 'resolved') return false
      if (!f.expectedResolveChapterId) return false
      return f.expectedResolveChapterId < currentChapterId && !f.resolveChapterId
    })
  },

  getUpcoming: (currentChapterId, range = 5) => {
    return get().foreshadows.filter(f => {
      if (f.status === 'resolved') return false
      if (!f.expectedResolveChapterId) return false
      const diff = f.expectedResolveChapterId - currentChapterId
      return diff > 0 && diff <= range
    })
  },

  computeUrgency: (f, currentChapterId) => {
    if (f.status === 'resolved') return 'low'
    if (!f.expectedResolveChapterId) {
      // 没有预期回收，按重要度粗略判定
      return (f.importance || 5) >= 8 ? 'medium' : 'low'
    }
    const diff = f.expectedResolveChapterId - currentChapterId
    if (diff < 0) return 'critical'  // 已逾期
    if (diff <= 2) return 'high'     // 即将到期
    if (diff <= 5) return 'medium'   // 临近
    return 'low'
  },

  // ── Phase C2 ──

  buildForeshadowContext: (currentChapterId) => {
    return buildForeshadowTaskContext(get().foreshadows, { currentChapterId })
  },
}))
