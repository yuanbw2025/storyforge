import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { HistoricalTimelineEvent, HistoricalKeyword } from '../lib/types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'

interface HistoricalStore {
  events: HistoricalTimelineEvent[]
  keywords: HistoricalKeyword[]
  loading: boolean
  loadingKeywords: boolean

  // ── 历史时间线事件 ──
  /** 加载某个项目的所有历史时间线事件（按数字化年份 year 升序排序） */
  loadEvents: (scope: WorkspaceScopeLike) => Promise<void>
  /** 添加历史事件 */
  addEvent: (event: Omit<HistoricalTimelineEvent, 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 更新历史事件 */
  updateEvent: (id: number, patch: Partial<HistoricalTimelineEvent>) => Promise<void>
  /** 删除历史事件 */
  deleteEvent: (id: number) => Promise<void>

  // ── 历史关键词与细节 ──
  /** 加载某个项目的所有历史关键词 */
  loadKeywords: (scope: WorkspaceScopeLike) => Promise<void>
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
  loadEvents: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const events = (await readOwnedRows<HistoricalTimelineEvent>(
        scope,
        'historicalTimelineEvents',
        { owner: 'world' },
      )).sort((left, right) => left.year - right.year)
      set({ events, loading: false })
    } catch (err) {
      console.error('[HistoricalStore] loadEvents failed:', err)
      set({ loading: false })
    }
  },

  addEvent: async (event) => {
    const now = Date.now()
    const row = stampNewRecord(
      await resolveScopeLike(event.projectId),
      'historicalTimelineEvents',
      { ...event, createdAt: now, updatedAt: now },
      { owner: 'world' },
    ) as HistoricalTimelineEvent
    const id = await db.historicalTimelineEvents.add(row) as number
    // 刷新内存
    await get().loadEvents(event.projectId)
    return id
  },

  updateEvent: async (id, patch) => {
    const beforeMigration = get().events.find(event => event.id === id)
      ?? await db.historicalTimelineEvents.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.historicalTimelineEvents.get(id)
    if (!current || !await assertRecordInScope(scope, 'historicalTimelineEvents', current, { owner: 'world' })) return
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
    const beforeMigration = await db.historicalTimelineEvents.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const event = await db.historicalTimelineEvents.get(id)
    if (!event || !await assertRecordInScope(scope, 'historicalTimelineEvents', event, { owner: 'world' })) return
    await db.historicalTimelineEvents.delete(id)
    await get().loadEvents(event.projectId)
  },

  // ── 历史关键词与细节 ──
  loadKeywords: async (scopeInput) => {
    set({ loadingKeywords: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const keywords = (await readOwnedRows<HistoricalKeyword>(
        scope,
        'historicalKeywords',
        { owner: 'world' },
      )).sort((left, right) => right.updatedAt - left.updatedAt)
      set({ keywords, loadingKeywords: false })
    } catch (err) {
      console.error('[HistoricalStore] loadKeywords failed:', err)
      set({ loadingKeywords: false })
    }
  },

  addKeyword: async (keyword) => {
    const now = Date.now()
    const row = stampNewRecord(
      await resolveScopeLike(keyword.projectId),
      'historicalKeywords',
      { ...keyword, createdAt: now, updatedAt: now },
      { owner: 'world' },
    ) as HistoricalKeyword
    const id = await db.historicalKeywords.add(row) as number
    await get().loadKeywords(keyword.projectId)
    return id
  },

  updateKeyword: async (id, patch) => {
    const beforeMigration = get().keywords.find(keyword => keyword.id === id)
      ?? await db.historicalKeywords.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.historicalKeywords.get(id)
    if (!current || !await assertRecordInScope(scope, 'historicalKeywords', current, { owner: 'world' })) return
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
    const beforeMigration = await db.historicalKeywords.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const keyword = await db.historicalKeywords.get(id)
    if (!keyword || !await assertRecordInScope(scope, 'historicalKeywords', keyword, { owner: 'world' })) return
    await db.historicalKeywords.delete(id)
    await get().loadKeywords(keyword.projectId)
  },
}))
