/**
 * Phase 32 — 世界规则 Store（按 projectId + worldGroupId 维护 profile）
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorkspaceScope } from '../lib/types'
import type {
  WorldRulesProfile,
  WorldRuleEntry,
  CustomWorldRuleNode,
  ConflictPriority,
} from '../lib/types/world-rules'
import { createEmptyEntry, isEntryEmpty, countFilledEntries } from '../lib/types/world-rules'
import { assertRecordInScope, getTableSpec, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { isPortableResourceUidV1 } from '../lib/context-gateway/resource-uid'
import { acknowledgePendingEditFailureV1, capturePendingEditFailureV1, coordinatePendingEditV1, type PendingEditFailureTokenV1 } from '../lib/authoring/pending-edit-coordinator'

let profileReadRequest = 0
let profileEditRevision = 0
const sameScope = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId

interface WorldRulesState {
  profile: WorldRulesProfile | null
  activeWorldGroupId: number | null
  loading: boolean
  loadedScope: WorkspaceScope | null
  pendingSaves: number
  dirty: boolean
  saveError: string
  failureToken: PendingEditFailureTokenV1 | null

  /** 加载项目的世界规则 */
  loadProfile: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>

  /** 保存整个 profile（内部使用） */
  _persist: (profile?: WorldRulesProfile | null, scope?: WorkspaceScope | null) => Promise<void>
  discardDraft: () => void

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
  loadedScope: null,
  pendingSaves: 0,
  dirty: false,
  saveError: '',
  failureToken: null,

  loadProfile: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
    if (get().dirty || get().pendingSaves) throw new Error('当前规则草稿尚未保存，请先重试或导出并放弃未保存输入。')
    const request = ++profileReadRequest
    set({ loading: true })
    try {
      const targetWorldGroupId = worldGroupId ?? null
      const scope = await resolveScopeLike(scopeInput)
      const profile = await db.transaction('rw', db.worldRulesProfiles, async () => {
        const profiles = await readOwnedRows<WorldRulesProfile>(scope, 'worldRulesProfiles', { owner: 'world' })
        const existing = profiles.find(p => (p.worldGroupId ?? null) === targetWorldGroupId)
        if (existing) return existing

        // 首次访问，创建当前架构的空 profile。
        const now = Date.now()
        const id = await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', {
          projectId: scope.projectId,
          worldGroupId: targetWorldGroupId,
          entries: {},
          customNodes: [],
          globalNote: '',
          createdAt: now,
          updatedAt: now,
        }, { owner: 'world' }))
        return await db.worldRulesProfiles.get(id) ?? null
      })

      if (request !== profileReadRequest) return
      if (get().dirty || get().pendingSaves) throw new Error('规则加载期间又有作者输入，已保留原编辑目标和草稿。')
      set({ profile: profile || null, loadedScope: scope, activeWorldGroupId: targetWorldGroupId, dirty: false, saveError: '', failureToken: null })
    } finally {
      if (request === profileReadRequest) set({ loading: false })
    }
  },

  _persist: async (profile = get().profile, frozenScope = get().loadedScope) => {
    if (!profile?.id || !frozenScope) {
      const error = new Error('规则编辑目标尚未加载，输入未保存。')
      set({ saveError: error.message, dirty: profile != null })
      throw error
    }
    const scope = { ...frozenScope }, id = profile.id
    const revision = ++profileEditRevision
    const identity = getTableSpec('worldRulesProfiles').resourceIdentity!
    const uid = Reflect.get(profile, identity.field)
    set({ pendingSaves: get().pendingSaves + 1, dirty: true, saveError: '' })
    try {
      const snapshot = structuredClone(profile)
      await coordinatePendingEditV1({
        key: `world-rules:${scope.projectId}:${scope.worldId}:${id}:${String(uid)}`,
        persist: () => db.transaction('rw', scopeTransactionTables(db.worldRulesProfiles), async () => {
          await resolveScopeLike(scope)
          const current = await db.worldRulesProfiles.get(id)
          if (!current) throw new Error('规则目标已删除，输入已保留；请导出草稿，不能自动重建已删除目标。')
          if (snapshot.projectId !== scope.projectId || !await assertRecordInScope(scope, 'worldRulesProfiles', current, { owner: 'world' })
            || (current.worldGroupId ?? null) !== (snapshot.worldGroupId ?? null)) {
            throw new Error('规则目标的归属已变化，输入已保留，未写入其他世界。')
          }
          if (!isPortableResourceUidV1(uid, identity.resourceKind) || Reflect.get(current, identity.field) !== uid) {
            throw new Error('规则目标的身份已变化，输入已保留，请检查原规则。')
          }
          const patch = { entries: snapshot.entries, customNodes: snapshot.customNodes, globalNote: snapshot.globalNote, updatedAt: Date.now() }
          if (await db.worldRulesProfiles.update(id, patch) !== 1) throw new Error('规则目标已删除或未更新，输入已保留。')
          const saved = await db.worldRulesProfiles.get(id)
          if (!saved || JSON.stringify([saved.entries, saved.customNodes, saved.globalNote]) !== JSON.stringify([patch.entries, patch.customNodes, patch.globalNote])) {
            throw new Error('规则保存回读未通过，输入已保留，请重试。')
          }
        }),
      })
      if (revision === profileEditRevision && get().profile?.id === id && sameScope(get().loadedScope, scope)) {
        set({ dirty: false, saveError: '', failureToken: null })
      }
    } catch (cause) {
      if (revision === profileEditRevision && get().profile?.id === id && sameScope(get().loadedScope, scope)) {
        set({ dirty: true, saveError: cause instanceof Error ? cause.message : '规则保存失败，输入已保留。', failureToken: capturePendingEditFailureV1(cause) ?? null })
      }
      throw cause
    } finally { set({ pendingSaves: Math.max(0, get().pendingSaves - 1) }) }
  },

  discardDraft: () => {
    if (get().pendingSaves) throw new Error('规则仍在保存，请等待保存结束后再处理草稿。')
    const token = get().failureToken
    if (token) acknowledgePendingEditFailureV1({ token, decision: 'abandon-command' })
    profileReadRequest++; profileEditRevision++
    set({ profile: null, loadedScope: null, dirty: false, saveError: '', failureToken: null, loading: false })
  },

  getEntry: (nodeId: string) => {
    return get().profile?.entries[nodeId]
  },

  updateEntry: async (nodeId, field, value) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')

    const existing = profile.entries[nodeId] || createEmptyEntry()
    const updated = { ...existing, [field]: value }

    // 如果更新后变空了，移除该 entry
    const entries = { ...profile.entries }
    if (isEntryEmpty(updated)) {
      delete entries[nodeId]
    } else {
      entries[nodeId] = updated
    }

    const next = { ...profile, entries }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
  },

  deleteEntry: async (nodeId) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')

    const entries = { ...profile.entries }
    delete entries[nodeId]
    const next = { ...profile, entries }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
  },

  updateGlobalNote: async (note) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')
    const next = { ...profile, globalNote: note }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
  },

  addCustomNode: async (nodeData) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')

    const id = `custom_${Date.now()}`
    const node: CustomWorldRuleNode = { ...nodeData, id }
    const customNodes = [...profile.customNodes, node]
    const next = { ...profile, customNodes }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
    return id
  },

  updateCustomNode: async (id, updates) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')

    const customNodes = profile.customNodes.map(n =>
      n.id === id ? { ...n, ...updates } : n
    )
    const next = { ...profile, customNodes }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
  },

  deleteCustomNode: async (id) => {
    const { profile, loadedScope, _persist } = get()
    if (!profile) throw new Error('规则尚未加载，输入未保存。')

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

    const next = { ...profile, customNodes, entries }
    set({ profile: next, dirty: true })
    await _persist(next, loadedScope)
  },

  filledCount: () => {
    const { profile } = get()
    if (!profile) return 0
    return countFilledEntries(profile.entries)
  },
}))
