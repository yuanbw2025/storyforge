import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { PromptTemplate, PromptModuleKey } from '../lib/types/prompt'
import { SYSTEM_PROMPT_SEEDS } from '../lib/ai/prompt-seeds'
import { decodePromptTemplateExchange, readPromptTemplateContent } from '../lib/ai/prompt-template-exchange'

interface PromptStore {
  templates: PromptTemplate[]
  loaded: boolean

  /** 启动时调用一次：从 IndexedDB 加载，若空则注入系统 seed。 */
  init(): Promise<void>

  /** 同步获取某 moduleKey 当前激活的模板。
   *  正常情况从内存里取；若 store 未初始化或没找到，fallback 到 seed 数组兜底。
   */
  getActive(key: PromptModuleKey): PromptTemplate

  /** 保存（新增或更新）一个模板，并刷新 in-memory 列表。 */
  saveTemplate(t: PromptTemplate, options?: { expectedModuleKey: PromptModuleKey }): Promise<number>

  /** Import a fully validated batch as new, inactive user templates. */
  importTemplates(json: string): Promise<number>

  /** 从已有模板克隆一份给用户编辑（scope='user'，isActive=false）。 */
  cloneTemplate(id: number, newName?: string): Promise<number>

  /** 把某模板设为对应 moduleKey 的激活模板（其他同 key 的取消激活）。 */
  setActive(id: number, options?: { expectedModuleKey: PromptModuleKey }): Promise<void>

  /** 删除一个模板并刷新列表（UI 层不得直接 db.delete，必须走这里）。 */
  deleteTemplate(id: number): Promise<void>

  /** 强制重新从 DB 加载。 */
  reload(): Promise<void>
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  templates: [],
  loaded: false,

  init: async () => {
    if (get().loaded) return
    const existing = await db.promptTemplates.toArray()
    const now = Date.now()
    const { NOVEL_CONTENT_PROMPT_SEEDS } = await import('../lib/ai/prompt-seeds-novel')
    const { CRAFT_PROMPT_SEEDS } = await import('../lib/ai/prompt-seeds-craft')
    const allSystemSeeds = [...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS, ...CRAFT_PROMPT_SEEDS]

    if (existing.length === 0) {
      // 全新库：注入全部 seed
      const rows: PromptTemplate[] = allSystemSeeds.map(seed => ({
        ...seed,
        createdAt: now,
        updatedAt: now,
      }))
      await db.promptTemplates.bulkAdd(rows)
    } else {
      // 已有库：补缺 seed + 更新现有 system seed 的内容（保留用户的 isActive 选择）
      // Phase 13: 同一 moduleKey 下可能有多套 seed（不同 genre），用 name 作为唯一键
      const existingSystemMap = new Map(
        existing.filter(t => t.scope === 'system').map(t => [t.name, t])
      )

      for (const seed of allSystemSeeds) {
        const old = existingSystemMap.get(seed.name)
        if (!old) {
          // 缺 → 补
          await db.promptTemplates.add({ ...seed, createdAt: now, updatedAt: now })
        } else {
          // 已有 → 用代码里的最新内容刷新（除了 isActive，保留用户的激活选择）
          const refreshed: Partial<PromptTemplate> = {
            name: seed.name,
            moduleKey: seed.moduleKey,
            description: seed.description,
            systemPrompt: seed.systemPrompt,
            userPromptTemplate: seed.userPromptTemplate,
            variables: seed.variables,
            promptType: seed.promptType,
            modelOverride: seed.modelOverride,
            isDefault: seed.isDefault,
            genres: seed.genres,
            parameters: seed.parameters,
            examples: seed.examples,
            lengthMode: seed.lengthMode,
            continuityMode: seed.continuityMode,
            assetId: seed.assetId,
            variableBindings: seed.variableBindings,
            applicability: seed.applicability,
            updatedAt: now,
          }
          await db.promptTemplates.update(old.id!, refreshed)
        }
      }
    }

    const reloaded = await db.promptTemplates.toArray()
    set({ templates: reloaded, loaded: true })
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

  saveTemplate: async (t: PromptTemplate, options): Promise<number> => {
    const input = structuredClone(t)
    const content = readPromptTemplateContent(input)
    const expectedModuleKey = options?.expectedModuleKey ?? input.moduleKey
    const now = Date.now()
    const id = await db.transaction('rw', db.promptTemplates, async () => {
      if (input.id === undefined) {
        return db.promptTemplates.add({ ...input, ...content, updatedAt: now, createdAt: input.createdAt || now })
      }
      const current = await db.promptTemplates.get(input.id)
      if (!current) throw new Error('模板已删除，未保存的编辑仍保留；请另存为新模板。')
      if (current.moduleKey !== expectedModuleKey) {
        throw new Error('模板所属模块已在其他位置改变，未保存的编辑仍保留；请重新选择模板后核对。')
      }
      const moved = current.moduleKey !== content.moduleKey
      await db.promptTemplates.put({
        ...current, ...content,
        // Content editing cannot restore a stale activation choice. A route
        // change needs a separate, explicit activation in the new module.
        isActive: moved ? false : current.isActive,
        updatedAt: now,
      })
      return input.id
    })
    await get().reload()
    return id
  },

  importTemplates: async (json: string): Promise<number> => {
    const contents = decodePromptTemplateExchange(json)
    const now = Date.now()
    const rows: PromptTemplate[] = contents.map(content => ({
      ...content, scope: 'user', isActive: false, createdAt: now, updatedAt: now,
    }))
    await db.transaction('rw', db.promptTemplates, async () => {
      if (rows.length) await db.promptTemplates.bulkAdd(rows)
    })
    await get().reload()
    return rows.length
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

  setActive: async (id: number, options): Promise<void> => {
    const expectedModuleKey = options?.expectedModuleKey
    const now = Date.now()
    await db.transaction('rw', db.promptTemplates, async () => {
      const target = await db.promptTemplates.get(id)
      if (!target) throw new Error(`template ${id} not found`)
      if (expectedModuleKey !== undefined && target.moduleKey !== expectedModuleKey) {
        throw new Error('模板所属模块已在其他位置改变，激活未执行；请先核对当前模块。')
      }
      // Resolve the actual route and siblings in the same native transaction
      // that changes activation, including concurrent tabs and content saves.
      const siblings = await db.promptTemplates.where('moduleKey').equals(target.moduleKey).toArray()
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
