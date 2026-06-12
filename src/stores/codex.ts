/**
 * Phase 35-a — 词条系统 store
 *
 * 管理词条分类（内置 + 自定义，树状）与词条条目。
 * 首次加载某项目时自动播种 7 类内置分类（幂等）。
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  BUILTIN_CATEGORIES, stringifyFieldSchema,
  type CodexCategory, type CodexEntry, type CodexDomain, type CodexFieldDef,
} from '../lib/types/codex'

interface CodexStore {
  categories: CodexCategory[]
  entries: CodexEntry[]
  loading: boolean
  loadedProjectId: number | null

  loadAll: (projectId: number) => Promise<void>
  ensureBuiltIns: (projectId: number) => Promise<void>

  // 分类
  addCategory: (c: Omit<CodexCategory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCategory: (id: number, patch: Partial<CodexCategory>) => Promise<void>
  deleteCategory: (id: number) => Promise<void>   // 仅自定义可删（连带词条）
  setCategoryHidden: (id: number, hidden: boolean) => Promise<void>

  // 词条
  addEntry: (e: Omit<CodexEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateEntry: (id: number, patch: Partial<CodexEntry>) => Promise<void>
  deleteEntry: (id: number) => Promise<void>

  // 查询辅助
  getCategoriesByDomain: (domain: CodexDomain, worldGroupId?: number | null) => CodexCategory[]
  getEntriesByCategory: (categoryId: number) => CodexEntry[]
}

const now = () => Date.now()

// 并发锁:同一项目的 ensureBuiltIns 同一时刻只跑一次。
// 防止并发调用(如 React StrictMode 开发期把 effect 跑两遍、或多个面板内嵌词条同时挂载)
// 各自判定"内置分类缺失"而重复播种,产生每类两条的重复。
const ensureBuiltInsInFlight = new Map<number, Promise<void>>()

export const useCodexStore = create<CodexStore>((set, get) => ({
  categories: [],
  entries: [],
  loading: false,
  loadedProjectId: null,

  loadAll: async (projectId) => {
    set({ loading: true })
    try {
      await get().ensureBuiltIns(projectId)
      const [categories, entries] = await Promise.all([
        db.codexCategories.where('projectId').equals(projectId).toArray(),
        db.codexEntries.where('projectId').equals(projectId).toArray(),
      ])
      set({ categories, entries, loading: false, loadedProjectId: projectId })
    } catch (err) {
      console.error('[Codex] loadAll 失败:', err)
      set({ loading: false })
    }
  },

  ensureBuiltIns: async (projectId) => {
    // 并发锁:同项目已有调用在跑就复用它,从根上杜绝并发重复播种;
    // 内部仍保留自愈去重,清理历史/其它路径产生的重复。
    const running = ensureBuiltInsInFlight.get(projectId)
    if (running) return running
    const task = (async () => {
    // 自愈式幂等：先去重历史重复，再补齐缺失的内置分类。
    // ① 每个 builtInKey 只保留 id 最小的一条；多余分类下的词条/子分类改挂到保留项后删除多余分类。
    // ② 再只播种当前缺失的内置 key。
    const cats = await db.codexCategories.where('projectId').equals(projectId).toArray()
    const builtins = cats.filter(c => !!c.builtInKey)

    // ① 去重历史重复
    const byKey = new Map<string, CodexCategory[]>()
    for (const c of builtins) {
      const arr = byKey.get(c.builtInKey!) ?? []
      arr.push(c)
      byKey.set(c.builtInKey!, arr)
    }
    for (const group of byKey.values()) {
      if (group.length <= 1) continue
      group.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
      const keep = group[0]
      for (const extra of group.slice(1)) {
        // 多余分类下的词条改挂到保留项，避免删分类时孤立词条
        const orphanEntries = await db.codexEntries
          .where('projectId').equals(projectId)
          .filter(e => e.categoryId === extra.id)
          .toArray()
        for (const e of orphanEntries) {
          await db.codexEntries.update(e.id!, { categoryId: keep.id! })
        }
        // 多余分类的子分类改挂到保留项
        for (const child of cats.filter(c => c.parentId === extra.id)) {
          await db.codexCategories.update(child.id!, { parentId: keep.id! })
        }
        await db.codexCategories.delete(extra.id!)
        console.log('[Codex] 已合并重复内置分类:', extra.builtInKey, '#', extra.id, '→ #', keep.id)
      }
    }

    // ② 补齐缺失的内置 key
    const existingKeys = new Set([...byKey.keys()])
    const missing = BUILTIN_CATEGORIES.filter(seed => !existingKeys.has(seed.builtInKey))
    if (missing.length === 0) return

    const ts = now()
    const baseOrder = cats.length
    const rows: CodexCategory[] = missing.map((seed, i) => ({
      projectId,
      domain: seed.domain,
      parentId: null,
      name: seed.name,
      icon: seed.icon,
      builtInKey: seed.builtInKey,
      fieldSchema: stringifyFieldSchema(seed.fields),
      hidden: false,
      order: baseOrder + i,
      worldGroupId: null,
      createdAt: ts,
      updatedAt: ts,
    }))
    await db.codexCategories.bulkAdd(rows)
    console.log('[Codex] 已播种缺失内置分类:', rows.length)
    })()
    ensureBuiltInsInFlight.set(projectId, task)
    try { await task } finally { ensureBuiltInsInFlight.delete(projectId) }
  },

  addCategory: async (c) => {
    const ts = now()
    const row = { ...c, createdAt: ts, updatedAt: ts } as CodexCategory
    const id = await db.codexCategories.add(row) as number
    set({ categories: [...get().categories, { ...row, id }] })
    return id
  },

  updateCategory: async (id, patch) => {
    const next = { ...patch, updatedAt: now() }
    await db.codexCategories.update(id, next)
    set({ categories: get().categories.map(c => c.id === id ? { ...c, ...next } : c) })
  },

  deleteCategory: async (id) => {
    const cat = get().categories.find(c => c.id === id)
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
    await db.transaction('rw', db.codexCategories, db.codexEntries, async () => {
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
    const row = { ...e, createdAt: ts, updatedAt: ts } as CodexEntry
    const id = await db.codexEntries.add(row) as number
    set({ entries: [...get().entries, { ...row, id }] })
    return id
  },

  updateEntry: async (id, patch) => {
    const next = { ...patch, updatedAt: now() }
    await db.codexEntries.update(id, next)
    set({ entries: get().entries.map(e => e.id === id ? { ...e, ...next } : e) })
  },

  deleteEntry: async (id) => {
    await db.codexEntries.delete(id)
    set({ entries: get().entries.filter(e => e.id !== id) })
  },

  getCategoriesByDomain: (domain, worldGroupId) => {
    return get().categories
      .filter(c => c.domain === domain)
      .filter(c => worldGroupId === undefined ? true : (c.worldGroupId ?? null) === (worldGroupId ?? null))
      .sort((a, b) => a.order - b.order)
  },

  getEntriesByCategory: (categoryId) => {
    return get().entries
      .filter(e => e.categoryId === categoryId)
      .sort((a, b) => a.order - b.order)
  },
}))

export type { CodexFieldDef }
