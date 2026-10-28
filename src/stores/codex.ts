import { transactionTablesForReferences } from '../lib/registry/lifecycle'
/**
 * Phase 35-a — 词条系统 store
 *
 * 管理词条分类（内置 + 自定义，树状）与词条条目。
 * 首次加载某项目时自动播种 7 类内置分类（幂等）。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorkspaceScope } from '../lib/types'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { removeCodexEntryReferences } from '../lib/codex/references'
import {
  BUILTIN_CATEGORIES, stringifyFieldSchema, codexCategoryFormatIssueV1, codexEntryFormatIssueV1,
  type CodexCategory, type CodexEntry, type CodexDomain, type CodexFieldDef,
} from '../lib/types/codex'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface CodexStore {
  categories: CodexCategory[]
  entries: CodexEntry[]
  loading: boolean
  loadedProjectId: number | null
  loadedScope: WorkspaceScope | null
  loadError: string | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  /** 只读加载现有分类/词条，不播种内置分类（供正文档案提示等纯读入口）。 */
  loadExisting: (scope: WorkspaceScopeLike) => Promise<void>
  ensureBuiltIns: (scope: WorkspaceScopeLike) => Promise<void>

  // 分类
  addCategory: (c: Omit<CodexCategory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCategory: (id: number, patch: Partial<CodexCategory>, options?: { scope?: WorkspaceScope; expected?: CodexCategory }) => Promise<void>
  deleteCategory: (id: number) => Promise<void>   // 仅自定义可删（连带词条）
  setCategoryHidden: (id: number, hidden: boolean) => Promise<void>

  // 词条
  addEntry: (e: Omit<CodexEntry,
    'id' | 'createdAt' | 'updatedAt' | 'origin' | 'sourceEvidenceQuotes'
    | 'sourceContentHash' | 'producerRunId' | 'producerCandidateHash'>
    & Partial<Pick<CodexEntry,
      'origin' | 'sourceEvidenceQuotes' | 'sourceContentHash' | 'producerRunId' | 'producerCandidateHash'>>
  ) => Promise<number>
  updateEntry: (id: number, patch: Partial<CodexEntry>, options?: { scope?: WorkspaceScope; expected?: CodexEntry }) => Promise<CodexEntry>
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
let loadSequence = 0
const sameWorld = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId
const AUTHOR_FIELDS = ['categoryId', 'name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags', 'importance', 'cultivationSystemId', 'cultivationStageId', 'importantLocationId', 'order', 'worldGroupId'] as const
async function loadRows(input: WorkspaceScopeLike, seed: boolean, set: (patch: Partial<CodexStore>) => void, get: () => CodexStore) {
  const request = ++loadSequence
  set({ loading: true, loadError: null })
  try {
    const scope = await (seed ? resolveScopeLike(input) : resolveReadScopeLike(input))
    if (request !== loadSequence) return
    if (!sameWorld(get().loadedScope, scope)) set({ categories: [], entries: [], loadedProjectId: null, loadedScope: null })
    if (seed) await get().ensureBuiltIns(scope)
    const [categories, entries] = await Promise.all([
      readOwnedRows<CodexCategory>(scope, 'codexCategories', { owner: 'world' }),
      readOwnedRows<CodexEntry>(scope, 'codexEntries', { owner: 'world' }),
    ])
    if (request === loadSequence) set({ categories, entries, loading: false, loadedProjectId: scope.projectId, loadedScope: scope })
  } catch (cause) {
    if (request === loadSequence) set({ loading: false, loadError: cause instanceof Error ? cause.message : '词条读取失败。' })
  }
}

export const useCodexStore = create<CodexStore>((set, get) => ({
  categories: [],
  entries: [],
  loading: false,
  loadedProjectId: null,

  loadedScope: null,
  loadError: null,
  loadAll: input => loadRows(input, true, set, get),
  loadExisting: input => loadRows(input, false, set, get),

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
    const scope = await resolveScopeLike(c.projectId)
    const row = stampNewRecord(scope, 'codexCategories', { ...c, createdAt: ts, updatedAt: ts } as CodexCategory, { owner: 'world' }) as CodexCategory
    const id = await db.codexCategories.add(row) as number
    if (sameWorld(get().loadedScope, scope)) set({ categories: [...get().categories, { ...row, id }] })
    return id
  },

  updateCategory: async (id, patch, options) => {
    const cached = get().categories.find(category => category.id === id)
    const scope = options?.scope ?? (cached ? get().loadedScope : null)
    const currentScope = scope ?? await db.codexCategories.get(id).then(row => {
      if (!row) throw new Error('分类已删除，修改尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    if (!currentScope) throw new Error('分类所属的世界不可用，修改尚未保存。')
    const allowed = ['name', 'icon', 'parentId', 'fieldSchema', 'hidden', 'order']
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('分类更新包含非作者字段。')
    if ('fieldSchema' in patch && (typeof patch.fieldSchema !== 'string' || codexCategoryFormatIssueV1({ fieldSchema: patch.fieldSchema }))) throw new Error('专属字段格式异常，请检查字段名称、类型及选项。')
    {
      const next = await db.transaction('rw', scopeTransactionTables(db.codexCategories), async () => {
        await resolveScopeLike(currentScope)
        const current = await db.codexCategories.get(id)
        if (!current || !await assertRecordInScope(currentScope, 'codexCategories', current, { owner: 'world' })) throw new Error('分类已删除或不属于原来的世界；修改尚未保存。')
        if (options?.expected && Object.keys(patch).some(key => JSON.stringify(current[key as keyof CodexCategory]) !== JSON.stringify(options.expected![key as keyof CodexCategory]))) throw new Error('分类已被其他页面修改；输入已保留，请核对后再保存。')
        const written = { ...current, ...patch, updatedAt: now() }
        if (await db.codexCategories.update(id, { ...patch, updatedAt: written.updatedAt }) !== 1) throw new Error('分类已删除，修改尚未保存。')
        return written
      })
      if (sameWorld(get().loadedScope, currentScope)) set({ categories: get().categories.map(category => category.id === id ? next : category) })
    }
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
    await db.transaction('rw', [db.codexCategories, ...transactionTablesForReferences('codexEntries')], async () => {
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
    if (sameWorld(get().loadedScope, scope)) set({ entries: [...get().entries, { ...row, id }] })
    return id
  },

  updateEntry: (id, patch, options) => {
    const cached = get().entries.find(entry => entry.id === id)
    const loadedScope = get().loadedScope
    const selected = options?.scope ?? (cached?.projectId === loadedScope?.projectId ? loadedScope ?? undefined : undefined)
    const scopePromise = selected ? Promise.resolve(selected) : db.codexEntries.get(id).then(row => {
      if (!row) throw new Error('词条已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    void scopePromise.catch(() => undefined)
    return coordinatePendingEditV1({ key: `codex-entry:${id}`, persist: async () => {
      if (Object.keys(patch).some(key => !AUTHOR_FIELDS.includes(key as typeof AUTHOR_FIELDS[number]))) throw new Error('词条更新包含非作者字段。')
      const scope = await scopePromise
      const updated = await db.transaction('rw', scopeTransactionTables(db.codexEntries, db.codexCategories, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const current = await db.codexEntries.get(id)
        if (!current || !await assertRecordInScope(scope, 'codexEntries', current, { owner: 'world' })) throw new Error('词条已删除或不属于原来的 World；输入尚未保存。')
        if (options?.expected && Object.keys(patch).some(key => JSON.stringify(current[key as keyof CodexEntry]) !== JSON.stringify(options.expected![key as keyof CodexEntry]))) throw new Error('词条已被其他页面修改；输入已保留，请核对后再保存。')
        if (patch.categoryId != null) {
          const category = await db.codexCategories.get(patch.categoryId)
          if (!category || !await assertRecordInScope(scope, 'codexCategories', category, { owner: 'world' })) throw new Error('分类不属于原来的 World。')
        }
        if (patch.worldGroupId != null) {
          const group = await db.worldGroups.get(patch.worldGroupId)
          if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) throw new Error('世界分组不属于原来的 World。')
        }
        for (const key of ['name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags'] as const) if (key in patch && typeof patch[key] !== 'string') throw new Error('词条文本字段格式异常；原文保持不变。')
        const next = { ...current, ...patch, updatedAt: Math.max(now(), (Number.isFinite(current.updatedAt) ? current.updatedAt : 0) + 1) }
        const issue = codexEntryFormatIssueV1(next)
        if (issue) throw new Error(`词条格式异常：${issue}；原始数据已保留。`)
        if (await db.codexEntries.update(id, { ...patch, updatedAt: next.updatedAt }) !== 1) throw new Error('词条已删除，输入尚未保存。')
        return next
      })
      if (sameWorld(get().loadedScope, scope)) set({ entries: get().entries.map(entry => entry.id === id ? updated : entry) })
      return updated
    } })
  },

  deleteEntry: async (id) => {
    const existingEntry = get().entries.find(item => item.id === id) ?? await db.codexEntries.get(id)
    if (!existingEntry) return
    const scope = await resolveScopeLike(existingEntry.projectId)
    const entry = await db.codexEntries.get(id)
    if (!entry || !await assertRecordInScope(scope, 'codexEntries', entry, { owner: 'world' })) return
    await db.transaction('rw', transactionTablesForReferences('codexEntries'), async () => {
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
