import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { pickBestChapterForOutline } from '../lib/chapters/selectors'
import { cascadeDeleteChapterRecords } from '../lib/chapters/lifecycle'
import type { Chapter } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

interface ChapterStore {
  chapters: Chapter[]
  currentChapter: Chapter | null
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
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

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const chapters = (await readOwnedRows<Chapter>(await resolveReadScopeLike(scopeInput), 'chapters', { owner: 'work' }))
      .sort((a, b) => a.order - b.order)
    set({ chapters, loading: false })
  },

  selectChapter: (id: number) => {
    const ch = get().chapters.find(c => c.id === id) || null
    set({ currentChapter: ch })
  },

  addChapter: async (ch) => {
    const newCh = stampNewRecord(await resolveScopeLike(ch.projectId), 'chapters', {
      ...ch, createdAt: now(), updatedAt: now(),
    } as Chapter, { owner: 'work' })
    const id = await db.chapters.add(newCh) as number
    const withId = { ...newCh, id }
    set({ chapters: [...get().chapters, withId] })
    return id
  },

  getOrCreateByOutlineNode: async (projectId, outlineNodeId, create) => {
    const scope = await resolveScopeLike(projectId)
    const chapter = await db.transaction('rw', scopeTransactionTables(db.chapters), async () => {
      const candidates = await db.chapters
        .where('outlineNodeId')
        .equals(outlineNodeId)
        .toArray()
      const existing = [] as Chapter[]
      for (const row of candidates) {
        if (row.projectId === projectId && await assertRecordInScope(scope, 'chapters', row, { owner: 'work' })) existing.push(row)
      }
      const best = pickBestChapterForOutline(existing)
      if (best?.id) return best

      const ts = now()
      const newChapter = stampNewRecord(scope, 'chapters', {
        ...create,
        projectId,
        outlineNodeId,
        createdAt: ts,
        updatedAt: ts,
      }, { owner: 'work' }) as Chapter
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
    const beforeMigration = get().chapters.find(c => c.id === id) ?? await db.chapters.get(id)
    if (!beforeMigration?.projectId) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const before = await db.chapters.get(id)
    if (!before || !await assertRecordInScope(scope, 'chapters', before, { owner: 'work' })) return
    const updated = { ...data, updatedAt: now() }
    await db.chapters.update(id, updated)
    if (Object.prototype.hasOwnProperty.call(data, 'content')) {
      const projectId = before.projectId
      if (projectId != null) {
        const summaryNodes = await readOwnedRows<any>(scope, 'narrativeSummaryNodes', { owner: 'work' })
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
    await cascadeDeleteChapterRecords(ids)
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
