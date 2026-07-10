import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { detachTemporalFactsForDeletedChapters } from '../lib/fact-ledger/lifecycle'
import { pickBestChapterForOutline } from '../lib/chapters/selectors'
import { transactionTablesFor } from '../lib/registry/lifecycle'
import type { Chapter } from '../lib/types'

interface ChapterStore {
  chapters: Chapter[]
  currentChapter: Chapter | null
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  selectChapter: (id: number) => void
  addChapter: (ch: Omit<Chapter, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  getOrCreateByOutlineNode: (
    projectId: number,
    outlineNodeId: number,
    create: Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Chapter>
  updateChapter: (id: number, data: Partial<Chapter>) => Promise<void>
  /** adopt()/事务写回后只刷新内存，不重复写数据库。 */
  refreshChapter: (id: number) => Promise<void>
  deleteChapter: (id: number) => Promise<void>
  /**
   * 章节删除的【唯一入口】(Phase 0.7)。
   * 删 chapters + 紧耦合子表(emotionBeatCards),并更新内存。
   * deleteChapter(单个) 和 outline.deleteNode(批量,删大纲带正文) 都必须走这里,
   * 否则会出现"绕过级联 → emotionBeatCards 残留"的孤儿数据。
   */
  cascadeDeleteChapters: (ids: number[]) => Promise<void>
}

const now = () => Date.now()

export const useChapterStore = create<ChapterStore>((set, get) => ({
  chapters: [],
  currentChapter: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const chapters = await db.chapters
      .where('projectId').equals(projectId)
      .sortBy('order')
    set({ chapters, loading: false })
  },

  selectChapter: (id: number) => {
    const ch = get().chapters.find(c => c.id === id) || null
    set({ currentChapter: ch })
  },

  addChapter: async (ch) => {
    const newCh: Chapter = { ...ch, createdAt: now(), updatedAt: now() }
    const id = await db.chapters.add(newCh) as number
    const withId = { ...newCh, id }
    set({ chapters: [...get().chapters, withId] })
    return id
  },

  getOrCreateByOutlineNode: async (projectId, outlineNodeId, create) => {
    const chapter = await db.transaction('rw', db.chapters, async () => {
      const existing = await db.chapters
        .where('outlineNodeId')
        .equals(outlineNodeId)
        .and(row => row.projectId === projectId)
        .toArray()
      const best = pickBestChapterForOutline(existing)
      if (best?.id) return best

      const ts = now()
      const newChapter: Chapter = {
        ...create,
        projectId,
        outlineNodeId,
        createdAt: ts,
        updatedAt: ts,
      }
      const id = await db.chapters.add(newChapter) as number
      return { ...newChapter, id }
    })

    const current = get().chapters
    const known = current.some(row => row.id === chapter.id)
    set({
      chapters: known
        ? current.map(row => row.id === chapter.id ? chapter : row)
        : [...current, chapter],
    })
    return chapter
  },

  updateChapter: async (id, data) => {
    const updated = { ...data, updatedAt: now() }
    await db.chapters.update(id, updated)
    if (Object.prototype.hasOwnProperty.call(data, 'content')) {
      const projectId = get().chapters.find(c => c.id === id)?.projectId ?? (await db.chapters.get(id))?.projectId
      if (projectId != null) {
        const summaryNodes = await db.narrativeSummaryNodes.where('projectId').equals(projectId).toArray()
        for (const node of summaryNodes) {
          if (node.id == null) continue
          if (node.level === 'book' || node.level === 'volume' || node.sourceChapterId === id) {
            await db.narrativeSummaryNodes.update(node.id, { status: 'stale', updatedAt: now() })
          }
        }
      }
    }
    const chapters = get().chapters.map(c =>
      c.id === id ? { ...c, ...updated } : c
    )
    const currentChapter = get().currentChapter?.id === id
      ? { ...get().currentChapter!, ...updated }
      : get().currentChapter
    set({ chapters, currentChapter })
  },

  refreshChapter: async (id) => {
    const fresh = await db.chapters.get(id)
    if (!fresh) return
    set({
      chapters: get().chapters.map(chapter => chapter.id === id ? fresh : chapter),
      currentChapter: get().currentChapter?.id === id ? fresh : get().currentChapter,
    })
  },

  deleteChapter: async (id) => {
    // 复用唯一入口,保证级联一致(Phase 0.7)
    await get().cascadeDeleteChapters([id])
  },

  cascadeDeleteChapters: async (ids) => {
    if (!ids.length) return
    // DB 层:删章节 + 紧耦合的情感节拍(按 chapterId),包事务保证原子
    await db.transaction('rw', transactionTablesFor('deleteChapters'), async () => {
      await detachTemporalFactsForDeletedChapters(ids)
      await db.chapters.bulkDelete(ids)
      const beatKeys = (await db.emotionBeatCards
        .where('chapterId').anyOf(ids).primaryKeys()) as number[]
      if (beatKeys.length) await db.emotionBeatCards.bulkDelete(beatKeys)
      const chunkKeys = (await db.retrievalChunks
        .where('sourceChapterId').anyOf(ids).primaryKeys()) as number[]
      if (chunkKeys.length) await db.retrievalChunks.bulkDelete(chunkKeys)
      const summaryKeys = (await db.narrativeSummaryNodes
        .where('sourceChapterId').anyOf(ids).primaryKeys()) as number[]
      if (summaryKeys.length) await db.narrativeSummaryNodes.bulkDelete(summaryKeys)
    })
    // 注：物品栏/故事年表/伏笔 中以 chapterId 关联的记录保留(含冗余章节标题,属独立产物,
    //     是否随章删除语义不明确,不强删以免误删用户产物)。
    // 内存层:从 chapters 移除,currentChapter 若被删则置空
    const idSet = new Set(ids)
    const cur = get().currentChapter
    set({
      chapters: get().chapters.filter(c => !idSet.has(c.id!)),
      currentChapter: cur && idSet.has(cur.id!) ? null : cur,
    })
  },
}))
