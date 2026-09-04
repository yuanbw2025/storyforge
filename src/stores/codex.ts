/**
 * Phase 35-a — 词条系统 store
 *
 * 管理词条分类（内置 + 自定义，树状）与词条条目。
 * 首次加载某项目时自动播种 7 类内置分类（幂等）。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { removeCodexEntryReferences } from '../lib/codex/references'
import {
  BUILTIN_CATEGORIES, stringifyFieldSchema,
  type CodexCategory, type CodexEntry, type CodexDomain, type CodexFieldDef,
} from '../lib/types/codex'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface CodexStore {
  categories: CodexCategory[]
  entries: CodexEntry[]
  loading: boolean
  loadedProjectId: number | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  /** 只读加载现有分类/词条，不播种内置分类（供正文档案提示等纯读入口）。 */
  loadExisting: (scope: WorkspaceScopeLike) => Promise<void>
  ensureBuiltIns: (scope: WorkspaceScopeLike) => Promise<void>

  // 分类
  addCategory: (c: Omit<CodexCategory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCategory: (id: number, patch: Partial<CodexCategory>) => Promise<void>
  deleteCategory: (id: number) => Promise<void>   // 仅自定义可删（连带词条）
  setCategoryHidden: (id: number, hidden: boolean) => Promise<void>

  // 词条
  addEntry: (e: Omit<CodexEntry,
    'id' | 'createdAt' | 'updatedAt' | 'origin' | 'sourceEvidenceQuotes'
    | 'sourceContentHash' | 'producerRunId' | 'producerCandidateHash'>
    & Partial<Pick<CodexEntry,
      'origin' | 'sourceEvidenceQuotes' | 'sourceContentHash' | 'producerRunId' | 'producerCandidateHash'>>
  ) => Promise<number>
  updateEntry: (id: number, patch: Partial<CodexEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>

  // 查询辅助
  getCategoriesByDomain: (domain: CodexDomain) => CodexCategory[]
  getEntriesByCategory: (categoryId: number) => CodexEntry[]
}

const now = () => Date.now()

// 并发锁:同一项目的 ensureBuiltIns 同一时刻只跑一次。
// 防止并发调用(如 React StrictMode 开发期把 effect 跑两遍、或多个面板内嵌词条同时挂载)
// 各自判定"内置分类缺失"而重复播种,产生每类两条的重复。
const ensureBuiltInsInFlight = new Map<string, Promise<void>>()
const entryUpdateQueues = new Map<number, Promise<void>>()

function enqueueEntryUpdate(id: number, task: () => Promise<void>): Promise<void> {
  const previous = entryUpdateQueues.get(id) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  entryUpdateQueues.set(id, next)
  return next.finally(() => {
    if (entryUpdateQueues.get(id) === next) entryUpdateQueues.delete(id)
  })
}

export const useCodexStore = create<CodexStore>((set, get) => ({
  categories: [],
  entries: [],
  loading: false,
  loadedProjectId: null,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveScopeLike(scopeInput)
      const projectId = scope.projectId
      await get().ensureBuiltIns(scope)
      const [categories, entries] = await Promise.all([
        readOwnedRows<CodexCategory>(scope, 'codexCategories', { owner: 'world' }),
        readOwnedRows<CodexEntry>(scope, 'codexEntries', { owner: 'world' }),
      ])
      set({ categories, entries, loading: false, loadedProjectId: projectId })
    } catch (err) {
      console.error('[Codex] loadAll 失败:', err)
      set({ categories: [], entries: [], loading: false, loadedProjectId: null })
    }
  },

  loadExisting: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const projectId = scope.projectId
      const [categories, entries] = await Promise.all([
        readOwnedRows<CodexCategory>(scope, 'codexCategories', { owner: 'world' }),
        readOwnedRows<CodexEntry>(scope, 'codexEntries', { owner: 'world' }),
      ])
      set({ categories, entries, loading: false, loadedProjectId: projectId })
    } catch (err) {
      console.error('[Codex] loadExisting 失败:', err)
      set({ categories: [], entries: [], loading: false, loadedProjectId: null })
    }
  },

  ensureBuiltIns: async (scopeInput) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    // 并发锁:同项目已有调用在跑就复用它,从根上杜绝并发重复播种;
    const lockKey = `${projectId}:${scope.worldId}`
    const running = ensureBuiltInsInFlight.get(lockKey)
    if (running) return running
    const task = (async () => {
    // 当前数据只需要幂等补齐内置分类；唯一性由写入口和并发锁保证。
    const cats = await readOwnedRows<CodexCategory>(scope, 'codexCategories', { owner: 'world' })
    const builtins = cats.filter(c => !!c.builtInKey)
    const existingKeys = new Set(builtins.map(category => category.builtInKey!))
    const missing = BUILTIN_CATEGORIES.filter(seed => !existingKeys.has(seed.builtInKey))
    if (missing.length === 0) return

    const ts = now()
    const baseOrder = cats.length
    const rows = missing.map((seed, i) => stampNewRecord(scope, 'codexCategories', {
      projectId,
      domain: seed.domain,
      parentId: null,
      name: seed.name,
      icon: seed.icon,
      builtInKey: seed.builtInKey,
      fieldSchema: stringifyFieldSchema(seed.fields),
      hidden: false,
      order: baseOrder + i,
      createdAt: ts,
      updatedAt: ts,
    }, { owner: 'world' }) as CodexCategory)
    await db.codexCategories.bulkAdd(rows)
    console.log('[Codex] 已播种缺失内置分类:', rows.length)
    })()
    ensureBuiltInsInFlight.set(lockKey, task)
    try { await task } finally { ensureBuiltInsInFlight.delete(lockKey) }
  },

  addCategory: async (c) => {
    const ts = now()
    const row = stampNewRecord(await resolveScopeLike(c.projectId), 'codexCategories', { ...c, createdAt: ts, updatedAt: ts } as CodexCategory, { owner: 'world' }) as CodexCategory
    const id = await db.codexCategories.add(row) as number
    set({ categories: [...get().categories, { ...row, id }] })
    return id
  },

  updateCategory: async (id, patch) => {
    const current = get().categories.find(c => c.id === id) ?? await db.codexCategories.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'codexCategories', current, { owner: 'world' })) return
    const next = { ...patch, updatedAt: now() }
    await db.codexCategories.update(id, next)
    set({ categories: get().categories.map(c => c.id === id ? { ...c, ...next } : c) })
  },

  deleteCategory: async (id) => {
    const cat = get().categories.find(c => c.id === id)
    if (!cat) return
    if (!await assertRecordInScope(await resolveScopeLike(cat.projectId), 'codexCategories', cat, { owner: 'world' })) return
    if (cat?.builtInKey) {
      console.warn('[Codex] 内置分类不可删除，仅可隐藏')
      return
    }
    // 连带删除：该分类下词条 + 其子分类（及子分类词条）
    const allCats = get().categories
    const toDeleteCatIds = new Set<number>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const c of allCats) {
        if (c.id && c.parentId && toDeleteCatIds.has(c.parentId) && !toDeleteCatIds.has(c.id)) {
          toDeleteCatIds.add(c.id); changed = true
        }
      }
    }
    const entryIds = get().entries.filter(e => toDeleteCatIds.has(e.categoryId)).map(e => e.id!).filter(Boolean)
    await db.transaction('rw', db.codexCategories, db.codexEntries, db.characters, async () => {
      await removeCodexEntryReferences(cat.projectId, new Set(entryIds))
      await db.codexEntries.bulkDelete(entryIds)
      await db.codexCategories.bulkDelete([...toDeleteCatIds])
    })
    set({
      categories: get().categories.filter(c => !toDeleteCatIds.has(c.id!)),
      entries: get().entries.filter(e => !toDeleteCatIds.has(e.categoryId)),
    })
  },

  setCategoryHidden: async (id, hidden) => {
    await get().updateCategory(id, { hidden })
  },

  addEntry: async (e) => {
    const ts = now()
    const scope = await resolveScopeLike(e.projectId)
    const category = await db.codexCategories.get(e.categoryId)
    if (!category || !await assertRecordInScope(scope, 'codexCategories', category, { owner: 'world' })) {
      throw new Error('[Codex] 分类不属于当前 World')
    }
    const row = stampNewRecord(scope, 'codexEntries', {
      ...e,
      origin: 'manual',
      sourceEvidenceQuotes: '[]',
      sourceContentHash: '',
      producerRunId: null,
      producerCandidateHash: null,
      ...(e.origin ? { origin: e.origin } : {}),
      ...(e.sourceEvidenceQuotes ? { sourceEvidenceQuotes: e.sourceEvidenceQuotes } : {}),
      ...(e.sourceContentHash ? { sourceContentHash: e.sourceContentHash } : {}),
      ...(e.producerRunId != null ? { producerRunId: e.producerRunId } : {}),
      ...(e.producerCandidateHash != null ? { producerCandidateHash: e.producerCandidateHash } : {}),
      createdAt: ts,
      updatedAt: ts,
    } as CodexEntry, { owner: 'world' }) as CodexEntry
    const id = await db.codexEntries.add(row) as number
    set({ entries: [...get().entries, { ...row, id }] })
    return id
  },

  updateEntry: (id, patch) => enqueueEntryUpdate(id, async () => {
    const existingEntry = get().entries.find(e => e.id === id) ?? await db.codexEntries.get(id)
    if (!existingEntry) return
    const scope = await resolveScopeLike(existingEntry.projectId)
    const current = await db.codexEntries.get(id)
    if (!current || !await assertRecordInScope(scope, 'codexEntries', current, { owner: 'world' })) return
    if (patch.categoryId != null) {
      const category = await db.codexCategories.get(patch.categoryId)
      if (!category || !await assertRecordInScope(scope, 'codexCategories', category, { owner: 'world' })) return
    }
    const next = { ...patch, updatedAt: now() }
    await db.codexEntries.update(id, next)
    set({ entries: get().entries.map(e => e.id === id ? { ...e, ...next } : e) })
  }),

  deleteEntry: async (id) => {
    const existingEntry = get().entries.find(item => item.id === id) ?? await db.codexEntries.get(id)
    if (!existingEntry) return
    const scope = await resolveScopeLike(existingEntry.projectId)
    const entry = await db.codexEntries.get(id)
    if (!entry || !await assertRecordInScope(scope, 'codexEntries', entry, { owner: 'world' })) return
    await db.transaction('rw', db.codexEntries, db.characters, async () => {
      await removeCodexEntryReferences(entry.projectId, new Set([id]))
      await db.codexEntries.delete(id)
    })
    set({ entries: get().entries.filter(e => e.id !== id) })
  },

  getCategoriesByDomain: (domain) => {
    return get().categories
      .filter(c => c.domain === domain)
      .sort((a, b) => a.order - b.order)
  },

  getEntriesByCategory: (categoryId) => {
    return get().entries
      .filter(e => e.categoryId === categoryId)
      .sort((a, b) => a.order - b.order)
  },
}))

export type { CodexFieldDef }
