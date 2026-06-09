/**
 * Phase 32 — 世界规则 Store（按 projectId + worldGroupId 维护 profile）
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type {
  WorldRulesProfile,
  WorldRuleEntry,
  CustomWorldRuleNode,
  ConflictPriority,
} from '../lib/types/world-rules'
import { createEmptyEntry, isEntryEmpty, countFilledEntries } from '../lib/types/world-rules'

interface WorldRulesState {
  profile: WorldRulesProfile | null
  activeWorldGroupId: number | null
  loading: boolean

  /** 加载项目的世界规则 */
  loadProfile: (projectId: number, worldGroupId?: number | null) => Promise<void>

  /** 保存整个 profile（内部使用） */
  _persist: () => Promise<void>

  /** 获取某节点的 entry（不存在则返回 undefined） */
  getEntry: (nodeId: string) => WorldRuleEntry | undefined

  /** 更新某节点的 entry */
  updateEntry: (nodeId: string, field: keyof WorldRuleEntry, value: string | ConflictPriority) => Promise<void>

  /** 删除某节点的 entry */
  deleteEntry: (nodeId: string) => Promise<void>

  /** 更新全局补充说明 */
  updateGlobalNote: (note: string) => Promise<void>

  /** 新增自定义节点 */
  addCustomNode: (node: Omit<CustomWorldRuleNode, 'id'>) => Promise<string>

  /** 更新自定义节点 */
  updateCustomNode: (id: string, updates: Partial<Pick<CustomWorldRuleNode, 'label' | 'icon' | 'hints'>>) => Promise<void>

  /** 删除自定义节点（连带清空 entry） */
  deleteCustomNode: (id: string) => Promise<void>

  /** 已填节点数 */
  filledCount: () => number
}

export const useWorldRulesStore = create<WorldRulesState>((set, get) => ({
  profile: null,
  activeWorldGroupId: null,
  loading: false,

  loadProfile: async (projectId: number, worldGroupId: number | null = null) => {
    set({ loading: true })
    try {
      const targetWorldGroupId = worldGroupId ?? null
      const profile = await db.transaction('rw', db.projects, db.worldRulesProfiles, async () => {
        const profiles = await db.worldRulesProfiles
          .where('projectId').equals(projectId)
          .toArray()
        const existing = profiles.find(p => (p.worldGroupId ?? null) === targetWorldGroupId)
        if (existing) return existing

        // 首次访问，创建空 profile
        // Phase 32.9: 检查旧项目是否设过 creativeMode=historical，自动迁移提示
        const project = await db.projects.get(projectId)
        const wasHistorical = project?.creativeMode === 'historical'
        const migrationNote = wasHistorical
          ? '【自动迁移提示】本项目原先使用「历史考证」模式。现已升级为维度级「真实与幻想」规则体系，请在左侧各维度中分别设定哪些内容取自真实、哪些是架空改造。'
          : ''

        const now = Date.now()
        const id = await db.worldRulesProfiles.add({
          projectId,
          worldGroupId: targetWorldGroupId,
          entries: {},
          customNodes: [],
          globalNote: migrationNote,
          createdAt: now,
          updatedAt: now,
        })
        return await db.worldRulesProfiles.get(id) ?? null
      })

      set({ profile: profile || null, activeWorldGroupId: targetWorldGroupId })
    } finally {
      set({ loading: false })
    }
  },

  _persist: async () => {
    const { profile } = get()
    if (!profile?.id) return
    await db.worldRulesProfiles.update(profile.id, {
      entries: profile.entries,
      customNodes: profile.customNodes,
      globalNote: profile.globalNote,
      updatedAt: Date.now(),
    })
  },

  getEntry: (nodeId: string) => {
    return get().profile?.entries[nodeId]
  },

  updateEntry: async (nodeId, field, value) => {
    const { profile, _persist } = get()
    if (!profile) return

    const existing = profile.entries[nodeId] || createEmptyEntry()
    const updated = { ...existing, [field]: value }

    // 如果更新后变空了，移除该 entry
    const entries = { ...profile.entries }
    if (isEntryEmpty(updated)) {
      delete entries[nodeId]
    } else {
      entries[nodeId] = updated
    }

    set({ profile: { ...profile, entries } })
    await _persist()
  },

  deleteEntry: async (nodeId) => {
    const { profile, _persist } = get()
    if (!profile) return

    const entries = { ...profile.entries }
    delete entries[nodeId]
    set({ profile: { ...profile, entries } })
    await _persist()
  },

  updateGlobalNote: async (note) => {
    const { profile, _persist } = get()
    if (!profile) return
    set({ profile: { ...profile, globalNote: note } })
    await _persist()
  },

  addCustomNode: async (nodeData) => {
    const { profile, _persist } = get()
    if (!profile) return ''

    const id = `custom_${Date.now()}`
    const node: CustomWorldRuleNode = { ...nodeData, id }
    const customNodes = [...profile.customNodes, node]
    set({ profile: { ...profile, customNodes } })
    await _persist()
    return id
  },

  updateCustomNode: async (id, updates) => {
    const { profile, _persist } = get()
    if (!profile) return

    const customNodes = profile.customNodes.map(n =>
      n.id === id ? { ...n, ...updates } : n
    )
    set({ profile: { ...profile, customNodes } })
    await _persist()
  },

  deleteCustomNode: async (id) => {
    const { profile, _persist } = get()
    if (!profile) return

    // 删除节点本身 + 所有以它为 parent 的子节点
    const toDelete = new Set<string>([id])
    // 收集子节点
    for (const n of profile.customNodes) {
      if (n.parentId === id) toDelete.add(n.id)
    }

    const customNodes = profile.customNodes.filter(n => !toDelete.has(n.id))

    // 清空对应的 entries
    const entries = { ...profile.entries }
    for (const nid of toDelete) {
      delete entries[nid]
    }

    set({ profile: { ...profile, customNodes, entries } })
    await _persist()
  },

  filledCount: () => {
    const { profile } = get()
    if (!profile) return 0
    return countFilledEntries(profile.entries)
  },
}))
