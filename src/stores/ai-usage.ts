/**
 * AI 消耗统计 store — 读取 aiUsageLog 持久化记录
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { AIUsageEntry } from '../lib/ai/usage-log'

interface AIUsageStore {
  entries: AIUsageEntry[]
  loading: boolean
  loadAll: (projectId?: number | null) => Promise<void>
  clearAll: (projectId?: number | null) => Promise<void>
}

export const useAIUsageStore = create<AIUsageStore>((set) => ({
  entries: [],
  loading: false,

  loadAll: async (projectId) => {
    set({ loading: true })
    try {
      const all = await db.aiUsageLog.orderBy('timestamp').reverse().toArray()
      const entries = projectId == null ? all : all.filter(e => e.projectId === projectId)
      set({ entries, loading: false })
    } catch (err) {
      console.error('[AIUsage] loadAll 失败:', err)
      set({ loading: false })
    }
  },

  clearAll: async (projectId) => {
    if (projectId == null) {
      await db.aiUsageLog.clear()
    } else {
      const ids = (await db.aiUsageLog.where('projectId').equals(projectId).toArray()).map(e => e.id!).filter(Boolean)
      await db.aiUsageLog.bulkDelete(ids)
    }
    set({ entries: [] })
  },
}))
