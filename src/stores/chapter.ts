import { create } from 'zustand'
import Dexie from 'dexie'
import { db } from '../lib/db/schema'
import { pickBestChapterForOutline } from '../lib/chapters/selectors'
import { cascadeDeleteChapterRecords } from '../lib/chapters/lifecycle'
import type { Chapter, WorkspaceScope } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { assertRecordTextSaveExpectedV1, recordTextSaveAckV1, recordTextSaveRequestV1 } from '../lib/authoring/record-text-save-evidence'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../lib/authoring/local-save-evidence'

interface ChapterAuthorUpdateV1 {
  (id: number, data: Partial<Chapter>): Promise<void>
  (id: number, data: Partial<Chapter>, options: { scope: WorkspaceScope; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
let loadSequence = 0, writeRevision = 0

interface ChapterStore {
  chapters: Chapter[]
  currentChapter: Chapter | null
  loading: boolean
  loadedScope: WorkspaceScope | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  selectChapter: (id: number) => void
  addChapter: (ch: Omit<Chapter, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  getOrCreateByOutlineNode: (
    projectId: number,
    outlineNodeId: number,
    create: Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Chapter>
  updateChapter: ChapterAuthorUpdateV1
  /** adopt()/事务写回后只刷新内存，不重复写数据库。 */
  refreshChapter: (id: number) => Promise<void>
  deleteChapter: (id: number) => Promise<void>
  /**
   * 章节删除的【唯一入口】(Phase 0.7)。
   * 删 chapters + 紧耦合子表(emotionBeatCards),并更新内存。
   * 单章删除与复合大纲删除共用 cascadeDeleteChapterRecords。
   * 大纲在自己的外层事务中调用该唯一生命周期，整棵树提交后才刷新缓存。
   */
  cascadeDeleteChapters: (ids: number[]) => Promise<void>
}

const now = () => Date.now()

export const useChapterStore = create<ChapterStore>((set, get) => ({
  chapters: [],
  currentChapter: null,
  loading: false,
  loadedScope: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++loadSequence
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
      let chapters: Chapter[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision
        chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
        if (request !== loadSequence) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间章节持续变化，请重新读取。')
      if (request === loadSequence) set({ chapters: chapters.sort((a, b) => a.order - b.order), loadedScope: scope, loading: false })
    } catch (cause) { if (request === loadSequence) set({ loading: false }); throw cause }
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

  updateChapter: ((id: number, input: Partial<Chapter>, options?: { scope: WorkspaceScope; confirmation: LocalSaveIntentV1 }) => {
    const data = structuredClone(input), config = options ? structuredClone(options) : undefined
    const selected = (async () => {
      if (config) return resolveScopeLike(config.scope)
      const initial = await db.chapters.get(id)
      if (!initial?.projectId) throw new Error('原章节已不存在；修改仍保留，请重新读取后重试。')
      return resolveScopeLike(initial.projectId)
    })()
    void selected.catch(() => undefined)
    return coordinatePendingEditV1({
      key: `chapter:${id}`,
      persist: async () => {
        const scope = await selected
        if (config) {
          if (Dexie.currentTransaction) throw new Error('作者笔记保存确认需要独立提交。')
          const proof = recordTextSaveRequestV1('chapters', id, data, config.scope, config.confirmation)
          await db.transaction('rw', scopeTransactionTables(db.chapters), async transaction => {
            const table = transaction.table<Chapter, number>('chapters'), current = await table.get(id)
            await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, config.confirmation, transaction))
            if (await db.chapters.update.bind(table)(id, { ...data, updatedAt: Math.max(now(), current!.updatedAt + 1) }) !== 1) throw new Error('作者笔记写入0行，输入已保留。')
            await Dexie.waitFor(recordTextSaveAckV1(await table.get(id), config.confirmation, proof.raw))
          })
          const revision = ++writeRevision
          const actual = await db.chapters.get(id), ack = await recordTextSaveAckV1(actual, config.confirmation, proof.raw)
          if (revision === writeRevision && sameWork(get().loadedScope, scope)) set({
            chapters: get().chapters.map(row => row.id === id ? actual! : row),
            currentChapter: get().currentChapter?.id === id ? actual! : get().currentChapter,
          })
          return ack
        }
        const before = await db.chapters.get(id)
        if (!before || !await assertRecordInScope(scope, 'chapters', before, { owner: 'work' })) throw new Error('原章节已不存在或不属于当前作品；修改仍保留。')
        const updated = { ...data, updatedAt: now() }
        const written = await db.chapters.update(id, updated)
        if (!written) throw new Error('章节未写入：目标已不存在；修改仍保留，请重试。')
        writeRevision++
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
    })
  }) as ChapterAuthorUpdateV1,

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
