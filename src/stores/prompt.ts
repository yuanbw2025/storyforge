import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { PromptTemplate, PromptModuleKey } from '../lib/types/prompt'
import { SYSTEM_PROMPT_SEEDS, type PromptSeed } from '../lib/ai/prompt-seeds'

const systemSeedIdentity = (template: Pick<PromptTemplate, 'name' | 'library'>): string =>
  template.library?.assetId ? `library:${template.library.assetId}` : `name:${template.name}`

const systemSeedComparable = (template: PromptTemplate | PromptSeed) => ({
  scope: template.scope,
  name: template.name,
  moduleKey: template.moduleKey,
  description: template.description,
  systemPrompt: template.systemPrompt,
  userPromptTemplate: template.userPromptTemplate,
  variables: template.variables,
  promptType: template.promptType,
  modelOverride: template.modelOverride,
  isDefault: template.isDefault,
  genres: template.genres,
  parameters: template.parameters,
  examples: template.examples,
  lengthMode: template.lengthMode,
  continuityMode: template.continuityMode,
  library: template.library,
})

export function systemSeedNeedsRefresh(existing: PromptTemplate, seed: PromptSeed): boolean {
  return JSON.stringify(systemSeedComparable(existing)) !== JSON.stringify(systemSeedComparable(seed))
}

function materializeSystemSeed(seed: PromptSeed, old: PromptTemplate, now: number): PromptTemplate {
  return {
    id: old.id,
    scope: seed.scope,
    moduleKey: seed.moduleKey,
    promptType: seed.promptType,
    name: seed.name,
    description: seed.description,
    systemPrompt: seed.systemPrompt,
    userPromptTemplate: seed.userPromptTemplate,
    variables: seed.variables,
    modelOverride: seed.modelOverride,
    isActive: old.isActive,
    isDefault: seed.isDefault,
    genres: seed.genres,
    parameters: seed.parameters,
    examples: seed.examples,
    lengthMode: seed.lengthMode,
    continuityMode: seed.continuityMode,
    library: seed.library,
    createdAt: old.createdAt,
    updatedAt: now,
  }
}

async function syncSystemSeeds(seeds: readonly PromptSeed[], existing: PromptTemplate[]): Promise<void> {
  const now = Date.now()
  const existingSystemMap = new Map(
    existing.filter(template => template.scope === 'system').map(template => [systemSeedIdentity(template), template]),
  )
  const changedRows: PromptTemplate[] = []
  for (const seed of seeds) {
    const old = existingSystemMap.get(systemSeedIdentity(seed))
    if (!old) {
      changedRows.push({ ...seed, createdAt: now, updatedAt: now })
    } else if (systemSeedNeedsRefresh(old, seed)) {
      changedRows.push(materializeSystemSeed(seed, old, now))
    }
  }
  if (!changedRows.length) return
  await db.transaction('rw', db.promptTemplates, async () => {
    await db.promptTemplates.bulkPut(changedRows)
  })
}

let libraryLoadPromise: Promise<void> | null = null

interface PromptStore {
  templates: PromptTemplate[]
  loaded: boolean
  libraryLoaded: boolean

  /** 启动时调用一次：从 IndexedDB 加载，若空则注入系统 seed。 */
  init(): Promise<void>

  /** 用户进入小说创作库时动态加载并增量同步 118 个资产。 */
  ensureLibraryLoaded(): Promise<void>

  /** 同步获取某 moduleKey 当前激活的模板。
   *  正常情况从内存里取；若 store 未初始化或没找到，fallback 到 seed 数组兜底。
   */
  getActive(key: PromptModuleKey): PromptTemplate

  /** 保存（新增或更新）一个模板，并刷新 in-memory 列表。 */
  saveTemplate(t: PromptTemplate): Promise<number>

  /** 从已有模板克隆一份给用户编辑（scope='user'，isActive=false）。 */
  cloneTemplate(id: number, newName?: string): Promise<number>

  /** 把某模板设为对应 moduleKey 的激活模板（其他同 key 的取消激活）。 */
  setActive(id: number): Promise<void>

  /** 删除一个模板并刷新列表（UI 层不得直接 db.delete，必须走这里）。 */
  deleteTemplate(id: number): Promise<void>

  /** 强制重新从 DB 加载。 */
  reload(): Promise<void>
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  templates: [],
  loaded: false,
  libraryLoaded: false,

  init: async () => {
    if (get().loaded) return
    const existing = await db.promptTemplates.toArray()
    await syncSystemSeeds(SYSTEM_PROMPT_SEEDS, existing)

    const reloaded = await db.promptTemplates.toArray()
    set({ templates: reloaded, loaded: true })
  },

  ensureLibraryLoaded: async () => {
    if (get().libraryLoaded) return
    if (!libraryLoadPromise) {
      libraryLoadPromise = (async () => {
        const { NOVEL_PROMPT_LIBRARY_SEEDS } = await import('../lib/ai/prompt-library-seeds')
        const existing = await db.promptTemplates.toArray()
        await syncSystemSeeds(NOVEL_PROMPT_LIBRARY_SEEDS, existing)
        const reloaded = await db.promptTemplates.toArray()
        set({ templates: reloaded, libraryLoaded: true })
      })().finally(() => { libraryLoadPromise = null })
    }
    await libraryLoadPromise
  },

  getActive: (key: PromptModuleKey): PromptTemplate => {
    const list = get().templates
    // 优先用户激活的
    const userActive = list.find(t => t.moduleKey === key && t.scope === 'user' && t.isActive)
    if (userActive) return userActive
    // 其次系统激活的
    const sysActive = list.find(t => t.moduleKey === key && t.scope === 'system' && t.isActive)
    if (sysActive) return sysActive
    // 再次任意同 key 模板
    const any = list.find(t => t.moduleKey === key)
    if (any) return any
    // 最后兜底：seed 数组（store 未初始化时保命用）
    const seed = SYSTEM_PROMPT_SEEDS.find(s => s.moduleKey === key)
    if (seed) {
      const now = Date.now()
      return { ...seed, createdAt: now, updatedAt: now }
    }
    throw new Error(`[prompt-store] no template found for moduleKey: ${key}`)
  },

  saveTemplate: async (t: PromptTemplate): Promise<number> => {
    const now = Date.now()
    const row: PromptTemplate = { ...t, updatedAt: now, createdAt: t.createdAt || now }
    const id = await db.promptTemplates.put(row)
    await get().reload()
    return id as number
  },

  cloneTemplate: async (id: number, newName?: string): Promise<number> => {
    const src = await db.promptTemplates.get(id)
    if (!src) throw new Error(`template ${id} not found`)
    const now = Date.now()
    const { id: _drop, ...rest } = src
    void _drop
    const cloneRow: PromptTemplate = {
      ...rest,
      scope: 'user',
      name: newName || `${src.name} (副本)`,
      parentId: src.id,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }
    const newId = await db.promptTemplates.add(cloneRow)
    await get().reload()
    return newId as number
  },

  setActive: async (id: number): Promise<void> => {
    const target = await db.promptTemplates.get(id)
    if (!target) throw new Error(`template ${id} not found`)
    // 同 moduleKey 的其他模板取消激活
    const siblings = await db.promptTemplates.where('moduleKey').equals(target.moduleKey).toArray()
    const now = Date.now()
    await db.transaction('rw', db.promptTemplates, async () => {
      for (const s of siblings) {
        if (s.id === id) {
          await db.promptTemplates.update(s.id!, { isActive: true, updatedAt: now })
        } else if (s.isActive) {
          await db.promptTemplates.update(s.id!, { isActive: false, updatedAt: now })
        }
      }
    })
    await get().reload()
  },

  deleteTemplate: async (id: number): Promise<void> => {
    await db.promptTemplates.delete(id)
    await get().reload()
  },

  reload: async () => {
    const all = await db.promptTemplates.toArray()
    set({ templates: all })
  },
}))
