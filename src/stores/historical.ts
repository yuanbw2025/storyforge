import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { HistoricalTimelineEvent, HistoricalKeyword } from '../lib/types'

interface HistoricalStore {
  events: HistoricalTimelineEvent[]
  keywords: HistoricalKeyword[]
  loading: boolean
  loadingKeywords: boolean

  // ── 历史时间线事件 ──
  /** 加载某个项目的所有历史时间线事件（按数字化年份 year 升序排序） */
  loadEvents: (projectId: number) => Promise<void>
  /** 添加历史事件 */
  addEvent: (event: Omit<HistoricalTimelineEvent, 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 更新历史事件 */
  updateEvent: (id: number, patch: Partial<HistoricalTimelineEvent>) => Promise<void>
  /** 删除历史事件 */
  deleteEvent: (id: number) => Promise<void>

  // ── 历史关键词与细节 ──
  /** 加载某个项目的所有历史关键词 */
  loadKeywords: (projectId: number) => Promise<void>
  /** 添加历史关键词 */
  addKeyword: (keyword: Omit<HistoricalKeyword, 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 更新历史关键词 */
  updateKeyword: (id: number, patch: Partial<HistoricalKeyword>) => Promise<void>
  /** 删除历史关键词 */
  deleteKeyword: (id: number) => Promise<void>
}

export const useHistoricalStore = create<HistoricalStore>((set, get) => ({
  events: [],
  keywords: [],
  loading: false,
  loadingKeywords: false,

  // ── 历史时间线事件 ──
  loadEvents: async (projectId: number) => {
    set({ loading: true })
    try {
      const events = await db.historicalTimelineEvents
        .where('projectId')
        .equals(projectId)
        .sortBy('year') // 按年份升序排序，形成时间轴
      set({ events, loading: false })
    } catch (err) {
      console.error('[HistoricalStore] loadEvents failed:', err)
      set({ loading: false })
    }
  },

  addEvent: async (event) => {
    const now = Date.now()
    const row: HistoricalTimelineEvent = {
      ...event,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.historicalTimelineEvents.add(row) as number
    // 刷新内存
    await get().loadEvents(event.projectId)
    return id
  },

  updateEvent: async (id, patch) => {
    const now = Date.now()
    const next = {
      ...patch,
      updatedAt: now,
    }
    await db.historicalTimelineEvents.update(id, next)
    // 同步内存
    const events = get().events.map(e => e.id === id ? { ...e, ...next } as HistoricalTimelineEvent : e)
    // 重新按年份排序
    events.sort((a, b) => a.year - b.year)
    set({ events })
  },

  deleteEvent: async (id) => {
    const event = await db.historicalTimelineEvents.get(id)
    if (!event) return
    await db.historicalTimelineEvents.delete(id)
    await get().loadEvents(event.projectId)
  },

  // ── 历史关键词与细节 ──
  loadKeywords: async (projectId: number) => {
    set({ loadingKeywords: true })
    try {
      const keywords = await db.historicalKeywords
        .where('projectId')
        .equals(projectId)
        .reverse()
        .sortBy('updatedAt') // 按更新时间倒序排列
      set({ keywords, loadingKeywords: false })
    } catch (err) {
      console.error('[HistoricalStore] loadKeywords failed:', err)
      set({ loadingKeywords: false })
    }
  },

  addKeyword: async (keyword) => {
    const now = Date.now()
    const row: HistoricalKeyword = {
      ...keyword,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.historicalKeywords.add(row) as number
    await get().loadKeywords(keyword.projectId)
    return id
  },

  updateKeyword: async (id, patch) => {
    const now = Date.now()
    const next = {
      ...patch,
      updatedAt: now,
    }
    await db.historicalKeywords.update(id, next)
    // 同步内存并重新按更新时间排序
    const keywords = get().keywords.map(k => k.id === id ? { ...k, ...next } as HistoricalKeyword : k)
    keywords.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ keywords })
  },

  deleteKeyword: async (id) => {
    const keyword = await db.historicalKeywords.get(id)
    if (!keyword) return
    await db.historicalKeywords.delete(id)
    await get().loadKeywords(keyword.projectId)
  },
}))
