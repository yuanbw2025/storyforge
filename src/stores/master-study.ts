/**
 * 作品学习 store —— Phase 19-a 地基层
 *
 * 薄封装 Dexie 的 masterWorks / masterChunkAnalysis / masterChapterBeats /
 * masterStyleMetrics / masterInsights 5 张表，让 UI 和 pipeline 都不用直接摸 db。
 *
 * 删除作品时会级联清：chunkAnalysis + chapterBeats + styleMetrics，
 * 如果挂了 importSessionId，还会顺手删 importFiles Blob（避免残留）。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type {
  MasterWork,
  MasterChunkAnalysis,
  MasterChapterBeat,
  MasterStyleMetrics,
  MasterInsight,
} from '../lib/types/master-study'

const now = () => Date.now()

interface MasterStudyStore {
  /** 内存里的作品列表（当前上下文） */
  works: MasterWork[]
  /** 内存里的洞察列表 */
  insights: MasterInsight[]
  loading: boolean

  // ── 作品 ───────────────────────────────────────────
  /** 列出所有作品；传 projectId 则只列该项目的（null 保持全局） */
  listWorks: (projectId?: number | null) => Promise<MasterWork[]>
  /** 取单个作品 */
  getWork: (id: number) => Promise<MasterWork | null>
  /** 创建新作品，返回 id */
  createWork: (data: Omit<MasterWork, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 局部更新 */
  patchWork: (id: number, partial: Partial<MasterWork>) => Promise<void>
  /** 删除作品 + 级联清分析数据（+ 附着的 Blob） */
  deleteWork: (id: number) => Promise<void>

  // ── 分析数据 ───────────────────────────────────────
  listChunkAnalysis: (workId: number) => Promise<MasterChunkAnalysis[]>
  listChapterBeats: (workId: number) => Promise<MasterChapterBeat[]>
  getStyleMetrics: (workId: number) => Promise<MasterStyleMetrics | null>

  // ── 跨作品洞察 ─────────────────────────────────────
  listInsights: (genre?: string) => Promise<MasterInsight[]>
  saveInsight: (data: Omit<MasterInsight, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }) => Promise<number>
  deleteInsight: (id: number) => Promise<void>
}

export const useMasterStudyStore = create<MasterStudyStore>((set, get) => ({
  works: [],
  insights: [],
  loading: false,

  // ── 作品 ───────────────────────────────────────────
  listWorks: async (projectId) => {
    set({ loading: true })
    try {
      let rows: MasterWork[]
      if (projectId === undefined) {
        rows = await db.masterWorks.orderBy('updatedAt').reverse().toArray()
      } else {
        // Dexie 的 equals() 不接受 null，直接用过滤
        const all = await db.masterWorks.orderBy('updatedAt').reverse().toArray()
        rows = all.filter(w => (w.projectId ?? null) === (projectId ?? null))
      }
      set({ works: rows })
      return rows
    } finally {
      set({ loading: false })
    }
  },

  getWork: async (id) => {
    return (await db.masterWorks.get(id)) ?? null
  },

  createWork: async (data) => {
    const row: MasterWork = { ...data, createdAt: now(), updatedAt: now() }
    const id = (await db.masterWorks.add(row)) as number
    // 刷新内存
    const works = get().works
    set({ works: [{ ...row, id }, ...works] })
    return id
  },

  patchWork: async (id, partial) => {
    const next = { ...partial, updatedAt: now() }
    await db.masterWorks.update(id, next)
    // 同步内存
    set({
      works: get().works.map(w => w.id === id ? { ...w, ...next } as MasterWork : w),
    })
  },

  deleteWork: async (id) => {
    const work = await db.masterWorks.get(id)
    await db.transaction(
      'rw',
      [
        db.masterWorks,
        db.masterChunkAnalysis,
        db.masterChapterBeats,
        db.masterStyleMetrics,
      ],
      async () => {
        await db.masterWorks.delete(id)
        await db.masterChunkAnalysis.where('workId').equals(id).delete()
        await db.masterChapterBeats.where('workId').equals(id).delete()
        await db.masterStyleMetrics.where('workId').equals(id).delete()
      },
    )
    // 附带清掉 Phase 18 Blob（不强制：有些作品可能是外部导入不走 session）
    if (work?.importSessionId != null) {
      try {
        await db.importFiles.delete(work.importSessionId)
      } catch {
        // Blob 不存在就算了，不让删作品失败
      }
    }
    set({ works: get().works.filter(w => w.id !== id) })
  },

  // ── 分析数据 ───────────────────────────────────────
  listChunkAnalysis: async (workId) => {
    return await db.masterChunkAnalysis
      .where('workId').equals(workId)
      .sortBy('chunkIndex')
  },

  listChapterBeats: async (workId) => {
    const rows = await db.masterChapterBeats
      .where('workId').equals(workId)
      .toArray()
    return rows.sort((a, b) => a.chapterIndex - b.chapterIndex || a.position - b.position)
  },

  getStyleMetrics: async (workId) => {
    return (await db.masterStyleMetrics.where('workId').equals(workId).first()) ?? null
  },

  // ── 跨作品洞察 ─────────────────────────────────────
  listInsights: async (genre) => {
    set({ loading: true })
    try {
      let rows: MasterInsight[]
      if (genre) {
        rows = await db.masterInsights.where('genre').equals(genre).toArray()
      } else {
        rows = await db.masterInsights.orderBy('updatedAt').reverse().toArray()
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      set({ insights: rows })
      return rows
    } finally {
      set({ loading: false })
    }
  },

  saveInsight: async (data) => {
    if (data.id != null) {
      const next: Partial<MasterInsight> = {
        title: data.title,
        genre: data.genre,
        description: data.description,
        bulletPoints: data.bulletPoints,
        sourceWorkIds: data.sourceWorkIds,
        updatedAt: now(),
      }
      await db.masterInsights.update(data.id, next)
      set({
        insights: get().insights.map(i => i.id === data.id ? { ...i, ...next } as MasterInsight : i),
      })
      return data.id
    }
    const row: MasterInsight = {
      title: data.title,
      genre: data.genre,
      description: data.description,
      bulletPoints: data.bulletPoints,
      sourceWorkIds: data.sourceWorkIds,
      createdAt: now(),
      updatedAt: now(),
    }
    const id = (await db.masterInsights.add(row)) as number
    set({ insights: [{ ...row, id }, ...get().insights] })
    return id
  },

  deleteInsight: async (id) => {
    await db.masterInsights.delete(id)
    set({ insights: get().insights.filter(i => i.id !== id) })
  },
}))
