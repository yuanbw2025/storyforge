import { transactionTablesForReferences, transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'
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
import { cascadeRegisteredReferences } from '../lib/workspace/lifecycle'
import { assertRegisteredTreeParentV1 } from '../lib/registry/tree-relations'
import {
  BUILTIN_CATEGORIES, stringifyFieldSchema, codexCategoryFormatIssueV1, codexEntryFormatIssueV1,
  type CodexCategory, type CodexEntry, type CodexDomain, type CodexFieldDef,
} from '../lib/types/codex'
import { assertRecordInScope, getTableSpec, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

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

/** Read the actual descendant graph inside the deletion transaction. A linked
 * row from another owner is a broken edge, never extra deletion authority. */
async function categorySubtree(scope: WorkspaceScope, root: CodexCategory): Promise<CodexCategory[]> {
  const rows = await db.codexCategories.toArray()
  const children = new Map<number, CodexCategory[]>()
  for (const row of rows) {
    if (row.parentId == null) continue
    const siblings = children.get(row.parentId) ?? []
    siblings.push(row)
    children.set(row.parentId, siblings)
  }
  const pending = [root]
  const seen = new Set<number>()
  for (let index = 0; index < pending.length; index++) {
    const row = pending[index]
    if (row.id == null || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id)) {
      throw new Error('分类层级已有循环或无效编号；未删除任何内容，请先修复层级。')
    }
    if (row.builtInKey) throw new Error('分类下包含不可删除的内置分类；请先修复层级。')
    seen.add(row.id)
    pending.push(...(children.get(row.id) ?? []))
  }
  const ownership = await Promise.all(pending.map(row => assertRecordInScope(scope, 'codexCategories', row, { owner: 'world' })))
  if (ownership.some(owned => !owned)) throw new Error('分类层级包含其他世界的记录；未删除任何内容。')
  return pending
}

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
    const input = { ...c }
    const ts = now()
    const scope = await resolveScopeLike(input.projectId)
    const created = await db.transaction('rw', scopeTransactionTables(db.codexCategories), async () => {
      await resolveScopeLike(scope)
      await assertRegisteredTreeParentV1({ spec: getTableSpec('codexCategories'), scope, parentId: input.parentId })
      const row = stampNewRecord(scope, 'codexCategories', { ...input, createdAt: ts, updatedAt: ts } as CodexCategory, { owner: 'world' }) as CodexCategory
      const id = await db.codexCategories.add(row) as number
      return { ...row, id }
    })
    if (sameWorld(get().loadedScope, scope)) set({ categories: [...get().categories, created] })
    return created.id
  },

  updateCategory: async (id, patch, options) => {
    const capturedPatch = { ...patch }
    const expected = options?.expected ? { ...options.expected } : undefined
    const requestedScope = options?.scope ? { ...options.scope } : undefined
    const cached = get().categories.find(category => category.id === id)
    const loaded = get().loadedScope
    const scope = requestedScope ?? (cached && loaded ? { ...loaded } : null)
    const currentScope = scope ?? await db.codexCategories.get(id).then(row => {
      if (!row) throw new Error('分类已删除，修改尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    if (!currentScope) throw new Error('分类所属的世界不可用，修改尚未保存。')
    const allowed = ['name', 'icon', 'parentId', 'fieldSchema', 'hidden', 'order']
    if (Object.keys(capturedPatch).some(key => !allowed.includes(key))) throw new Error('分类更新包含非作者字段。')
    if ('fieldSchema' in capturedPatch && (typeof capturedPatch.fieldSchema !== 'string' || codexCategoryFormatIssueV1({ fieldSchema: capturedPatch.fieldSchema }))) throw new Error('专属字段格式异常，请检查字段名称、类型及选项。')
    {
      const next = await db.transaction('rw', scopeTransactionTables(db.codexCategories), async () => {
        await resolveScopeLike(currentScope)
        const current = await db.codexCategories.get(id)
        if (!current || !await assertRecordInScope(currentScope, 'codexCategories', current, { owner: 'world' })) throw new Error('分类已删除或不属于原来的世界；修改尚未保存。')
        if (expected && Object.keys(capturedPatch).some(key => JSON.stringify(current[key as keyof CodexCategory]) !== JSON.stringify(expected[key as keyof CodexCategory]))) throw new Error('分类已被其他页面修改；输入已保留，请核对后再保存。')
        if (Object.prototype.hasOwnProperty.call(capturedPatch, 'parentId')) {
          await assertRegisteredTreeParentV1({ spec: getTableSpec('codexCategories'), scope: currentScope, recordId: id, parentId: capturedPatch.parentId })
        }
        const written = { ...current, ...capturedPatch, updatedAt: now() }
        if (await db.codexCategories.update(id, { ...capturedPatch, updatedAt: written.updatedAt }) !== 1) throw new Error('分类已删除，修改尚未保存。')
        return written
      })
      if (sameWorld(get().loadedScope, currentScope)) set({ categories: get().categories.map(category => category.id === id ? next : category) })
    }
  },

  deleteCategory: async (id) => {
    const request = loadSequence
    const loaded = get().loadedScope
    const requestedScope = loaded ? { ...loaded } : undefined
    const existing = await db.codexCategories.get(id)
    if (!existing) return
    const scope = await resolveScopeLike(requestedScope ?? existing.projectId)
    const deleted = await db.transaction('rw', scopeTransactionTables(...transactionTablesForReferenceCascade('codexCategories')), async () => {
      await resolveScopeLike(scope)
      const current = await db.codexCategories.get(id)
      if (!current) return null
      if (!await assertRecordInScope(scope, 'codexCategories', current, { owner: 'world' })) {
        throw new Error('分类已不属于当前世界；未删除任何内容。')
      }
      if (current.builtInKey) {
        console.warn('[Codex] 内置分类不可删除，仅可隐藏')
        return null
      }
      await assertRegisteredTreeParentV1({ spec: getTableSpec('codexCategories'), scope, recordId: id, parentId: current.parentId })
      const categories = await categorySubtree(scope, current)
      const categoryIds = new Set(categories.map(category => category.id!))
      const entries = await db.codexEntries.where('categoryId').anyOf([...categoryIds]).toArray()
      const ownership = await Promise.all(entries.map(entry => assertRecordInScope(scope, 'codexEntries', entry, { owner: 'world' })))
      if (ownership.some(owned => !owned)) throw new Error('分类包含其他世界的词条；未删除任何内容。')
      const entryIds = new Set(entries.map(entry => entry.id!))
      await removeCodexEntryReferences(scope.projectId, entryIds)
      for (const category of categories.reverse()) {
        await cascadeRegisteredReferences('codexCategories', category.id!)
        await db.codexCategories.delete(category.id!)
      }
      return { categoryIds, entryIds }
    })
    if (!deleted || !sameWorld(get().loadedScope, scope)) return
    set({
      categories: get().categories.filter(category => !deleted.categoryIds.has(category.id!)),
      entries: get().entries.filter(entry => !deleted.entryIds.has(entry.id!)),
    })
    // Never cancel a newer view load to refresh this completed deletion.
    if (request === loadSequence && sameWorld(get().loadedScope, scope)) await get().loadExisting(scope)
  },

  setCategoryHidden: async (id, hidden) => {
    await get().updateCategory(id, { hidden })
  },

  addEntry: async (e) => {
    const input = { ...e }
    const ts = now()
    const scope = await resolveScopeLike(input.projectId)
    const created = await db.transaction('rw', scopeTransactionTables(db.codexEntries, db.codexCategories), async () => {
      await resolveScopeLike(scope)
      const category = await db.codexCategories.get(input.categoryId)
      if (!category || !await assertRecordInScope(scope, 'codexCategories', category, { owner: 'world' })) {
        throw new Error('[Codex] 分类不属于当前 World')
      }
      const row = stampNewRecord(scope, 'codexEntries', {
        ...input,
        origin: 'manual',
        sourceEvidenceQuotes: '[]',
        sourceContentHash: '',
        producerRunId: null,
        producerCandidateHash: null,
        ...(input.origin ? { origin: input.origin } : {}),
        ...(input.sourceEvidenceQuotes ? { sourceEvidenceQuotes: input.sourceEvidenceQuotes } : {}),
        ...(input.sourceContentHash ? { sourceContentHash: input.sourceContentHash } : {}),
        ...(input.producerRunId != null ? { producerRunId: input.producerRunId } : {}),
        ...(input.producerCandidateHash != null ? { producerCandidateHash: input.producerCandidateHash } : {}),
        createdAt: ts,
        updatedAt: ts,
      } as CodexEntry, { owner: 'world' }) as CodexEntry
      const id = await db.codexEntries.add(row) as number
      return { ...row, id }
    })
    if (sameWorld(get().loadedScope, scope)) set({ entries: [...get().entries, created] })
    return created.id
  },

  updateEntry: (id, patch, options) => {
    const capturedPatch = { ...patch }
    const expected = options?.expected ? { ...options.expected } : undefined
    const cached = get().entries.find(entry => entry.id === id)
    const loadedScope = get().loadedScope
    const selectedScope = options?.scope ?? (cached?.projectId === loadedScope?.projectId ? loadedScope ?? undefined : undefined)
    const selected = selectedScope ? { ...selectedScope } : undefined
    const scopePromise = selected ? Promise.resolve(selected) : db.codexEntries.get(id).then(row => {
      if (!row) throw new Error('词条已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    void scopePromise.catch(() => undefined)
    return coordinatePendingEditV1({ key: `codex-entry:${id}`, persist: async () => {
      if (Object.keys(capturedPatch).some(key => !AUTHOR_FIELDS.includes(key as typeof AUTHOR_FIELDS[number]))) throw new Error('词条更新包含非作者字段。')
      const scope = await scopePromise
      const updated = await db.transaction('rw', scopeTransactionTables(db.codexEntries, db.codexCategories, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const current = await db.codexEntries.get(id)
        if (!current || !await assertRecordInScope(scope, 'codexEntries', current, { owner: 'world' })) throw new Error('词条已删除或不属于原来的 World；输入尚未保存。')
        if (expected && Object.keys(capturedPatch).some(key => JSON.stringify(current[key as keyof CodexEntry]) !== JSON.stringify(expected[key as keyof CodexEntry]))) throw new Error('词条已被其他页面修改；输入已保留，请核对后再保存。')
        const categoryId = Object.prototype.hasOwnProperty.call(capturedPatch, 'categoryId') ? capturedPatch.categoryId : current.categoryId
        if (typeof categoryId !== 'number' || !Number.isSafeInteger(categoryId) || categoryId < 1) throw new Error('分类编号无效；原文保持不变。')
        const category = await db.codexCategories.get(categoryId)
        if (!category || !await assertRecordInScope(scope, 'codexCategories', category, { owner: 'world' })) throw new Error('分类不属于原来的 World。')
        if (capturedPatch.worldGroupId != null) {
          const group = await db.worldGroups.get(capturedPatch.worldGroupId)
          if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) throw new Error('世界分组不属于原来的 World。')
        }
        for (const key of ['name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags'] as const) if (key in capturedPatch && typeof capturedPatch[key] !== 'string') throw new Error('词条文本字段格式异常；原文保持不变。')
        const next = { ...current, ...capturedPatch, updatedAt: Math.max(now(), (Number.isFinite(current.updatedAt) ? current.updatedAt : 0) + 1) }
        const issue = codexEntryFormatIssueV1(next)
        if (issue) throw new Error(`词条格式异常：${issue}；原始数据已保留。`)
        if (await db.codexEntries.update(id, { ...capturedPatch, updatedAt: next.updatedAt }) !== 1) throw new Error('词条已删除，输入尚未保存。')
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
