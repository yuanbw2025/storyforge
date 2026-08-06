/**
 * Phase 25.4 — 多世界系统 Store
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldGroup, WorldGroupLink } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { cascadeDeleteGroup, stampPrimaryWorld } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

const now = () => Date.now()

// Phase 1.1b: 原 PROJECT_TABLES_ALL 手写 45 表清单已删除,
// deleteGroup/migrate 改用 lib/registry/lifecycle 派生 API。

interface WorldGroupStore {
  groups: WorldGroup[]
  links: WorldGroupLink[]
  activeGroupId: number | null
  loading: boolean

  // 加载
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  // 世界组 CRUD
  createGroup: (data: Omit<WorldGroup, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateGroup: (id: number, patch: Partial<WorldGroup>) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  reorderGroups: (scope: WorkspaceScopeLike, orderedIds: number[]) => Promise<void>

  // 世界间关系
  createLink: (data: Omit<WorldGroupLink, 'id' | 'createdAt'>) => Promise<number>
  deleteLink: (id: number) => Promise<void>

  // 确保默认主世界组存在
  ensurePrimaryGroup: (scope: WorkspaceScopeLike) => Promise<number>

  // 开启多世界：确保主世界组 + 把现有项目级数据归属到主世界组
  migrateToMultiWorld: (scope: WorkspaceScopeLike) => Promise<boolean>

  // 切换活跃世界
  setActiveGroup: (id: number | null) => void
}

export const useWorldGroupStore = create<WorldGroupStore>((set, get) => ({
  groups: [],
  links: [],
  activeGroupId: null,
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const scope = await resolveScopeLike(scopeInput)
    const [groups, links] = await Promise.all([
      readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }).then(rows => rows.sort((a, b) => a.order - b.order)),
      readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' }),
    ])
    const primary = groups.find(g => g.type === 'primary')
    set({
      groups,
      links,
      activeGroupId: primary?.id ?? groups[0]?.id ?? null,
      loading: false,
    })
  },

  createGroup: async (data) => {
    const scope = await resolveScopeLike(data.projectId)
    const id = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      ...data,
      createdAt: now(),
      updatedAt: now(),
    } as WorldGroup, { owner: 'world' })) as number
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    set({ groups })
    return id
  },

  updateGroup: async (id, patch) => {
    const current = get().groups.find(g => g.id === id) ?? await db.worldGroups.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'worldGroups', current, { owner: 'world' })) return
    await db.worldGroups.update(id, { ...patch, updatedAt: now() })
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, ...patch, updatedAt: now() } : g
    )
    set({ groups })
  },

  deleteGroup: async (id) => {
    const group = get().groups.find(g => g.id === id)
    if (!group || group.type === 'primary') return // 不允许删主世界
    if (!await assertRecordInScope(await resolveScopeLike(group.projectId), 'worldGroups', group, { owner: 'world' })) return

    // 数据红线:删世界组前强制提示备份(Pre-Phase 0 安全网)
    const proceed = await requireBackupBefore({
      operation: `删除世界「${group.name}」`,
      projectId: group.projectId,
      details: '此操作将清除该世界的全部设定数据(世界观、力量体系、地理、历史、词条等),不可恢复。',
    })
    if (!proceed) return  // 用户取消


    const pid = group.projectId

    // Phase 1.1b: 级联删除从 PROJECT_TABLES 注册表派生(worldScoped 表 + 角色归属清除 +
    // 大纲 setNull + 内置词条分类保留 + 删世界组本身)。行为与手写版等价(R-01 保证)。
    await cascadeDeleteGroup(pid, id)

    // 刷新 store
    const groups = get().groups.filter(g => g.id !== id)
    const links = get().links.filter(l => l.fromGroupId !== id && l.toGroupId !== id)
    const activeGroupId = get().activeGroupId === id
      ? (groups.find(g => g.type === 'primary')?.id ?? groups[0]?.id ?? null)
      : get().activeGroupId
    set({ groups, links, activeGroupId })
  },

  reorderGroups: async (scopeInput, orderedIds) => {
    const scope = await resolveScopeLike(scopeInput)
    for (const id of orderedIds) {
      const group = await db.worldGroups.get(id)
      if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) {
        throw new Error('[WorldGroup] 排序包含其它 World 的节点')
      }
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await db.worldGroups.update(orderedIds[i], { order: i, updatedAt: now() })
    }
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    set({ groups })
  },

  createLink: async (data) => {
    const scope = await resolveScopeLike(data.projectId)
    const [from, to] = await Promise.all([db.worldGroups.get(data.fromGroupId), db.worldGroups.get(data.toGroupId)])
    if (!from || !to || !await assertRecordInScope(scope, 'worldGroups', from, { owner: 'world' })
      || !await assertRecordInScope(scope, 'worldGroups', to, { owner: 'world' })) {
      throw new Error('[WorldGroup] 世界关系端点不属于当前 World')
    }
    const id = await db.worldGroupLinks.add(stampNewRecord(scope, 'worldGroupLinks', {
      ...data,
      createdAt: now(),
    } as WorldGroupLink, { owner: 'world' })) as number
    const links = await readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' })
    set({ links })
    return id
  },

  deleteLink: async (id) => {
    const current = get().links.find(l => l.id === id) ?? await db.worldGroupLinks.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'worldGroupLinks', current, { owner: 'world' })) return
    await db.worldGroupLinks.delete(id)
    set({ links: get().links.filter(l => l.id !== id) })
  },

  ensurePrimaryGroup: async (scopeInput: WorkspaceScopeLike) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    const id = await db.transaction('rw', db.worldGroups, async () => {
      const existing = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }))
        .find(g => g.type === 'primary')
      if (existing?.id) return existing.id

      return db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
        projectId,
        name: '主世界',
        description: '',
        type: 'primary',
        icon: '🏠',
        order: 0,
        createdAt: now(),
        updatedAt: now(),
      } as WorldGroup, { owner: 'world' })) as Promise<number>
    })

    // 刷新
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    set({ groups, activeGroupId: id })
    return id
  },

  migrateToMultiWorld: async (scopeInput: WorkspaceScopeLike) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    // 数据红线:启用多世界前强制提示备份(Pre-Phase 0 安全网)
    // 理由:此操作会给现有数据盖章 worldGroupId,虽然不删数据,但当前代码已知有
    //       P0-1/P0-2/P0-8 三处事务作用域 + 漏盖章问题,失败时可能让大纲消失。
    //       Phase 0 修完后这个安全网可以减弱(但保留)。
    const proceed = await requireBackupBefore({
      operation: '启用多世界模式',
      projectId,
      details: '此操作将把现有项目数据(世界观、力量体系、大纲、词条等)迁移到「主世界」归属。建议先导出备份。',
    })
    if (!proceed) return false  // 用户取消

    // 1. 确保主世界组存在
    const primaryId = await get().ensurePrimaryGroup(scope)

    // 2. Phase 1.1b: 盖章从 PROJECT_TABLES 注册表派生(所有 worldScoped 表的 null 记录
    //    盖章到主世界；codexCategories 是项目级共享 schema，不在 worldScoped 清单中)。
    await stampPrimaryWorld(projectId, primaryId)
    return true
  },

  setActiveGroup: (id) => {
    set({ activeGroupId: id })
  },
}))
