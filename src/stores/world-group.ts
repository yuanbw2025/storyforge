/**
 * Phase 25.4 — 多世界系统 Store
 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldGroup, WorldGroupLink } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { cascadeDeleteGroup, stampPrimaryWorld } from '../lib/registry/lifecycle'

const now = () => Date.now()

// Phase 1.1b: 原 PROJECT_TABLES_ALL 手写 45 表清单已删除,
// deleteGroup/migrate 改用 lib/registry/lifecycle 派生 API。

interface WorldGroupStore {
  groups: WorldGroup[]
  links: WorldGroupLink[]
  activeGroupId: number | null
  loading: boolean

  // 加载
  loadAll: (projectId: number) => Promise<void>

  // 世界组 CRUD
  createGroup: (data: Omit<WorldGroup, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateGroup: (id: number, patch: Partial<WorldGroup>) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  reorderGroups: (projectId: number, orderedIds: number[]) => Promise<void>

  // 世界间关系
  createLink: (data: Omit<WorldGroupLink, 'id' | 'createdAt'>) => Promise<number>
  deleteLink: (id: number) => Promise<void>

  // 确保默认主世界组存在
  ensurePrimaryGroup: (projectId: number) => Promise<number>

  // 开启多世界：确保主世界组 + 把现有项目级数据归属到主世界组
  migrateToMultiWorld: (projectId: number) => Promise<void>

  // 切换活跃世界
  setActiveGroup: (id: number | null) => void
}

export const useWorldGroupStore = create<WorldGroupStore>((set, get) => ({
  groups: [],
  links: [],
  activeGroupId: null,
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const [groups, links] = await Promise.all([
      db.worldGroups.where('projectId').equals(projectId).sortBy('order'),
      db.worldGroupLinks.where('projectId').equals(projectId).toArray(),
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
    const id = await db.worldGroups.add({
      ...data,
      createdAt: now(),
      updatedAt: now(),
    } as WorldGroup) as number
    const groups = await db.worldGroups
      .where('projectId').equals(data.projectId)
      .sortBy('order')
    set({ groups })
    return id
  },

  updateGroup: async (id, patch) => {
    await db.worldGroups.update(id, { ...patch, updatedAt: now() })
    const groups = get().groups.map(g =>
      g.id === id ? { ...g, ...patch, updatedAt: now() } : g
    )
    set({ groups })
  },

  deleteGroup: async (id) => {
    const group = get().groups.find(g => g.id === id)
    if (!group || group.type === 'primary') return // 不允许删主世界

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

  reorderGroups: async (projectId, orderedIds) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.worldGroups.update(orderedIds[i], { order: i, updatedAt: now() })
    }
    const groups = await db.worldGroups
      .where('projectId').equals(projectId)
      .sortBy('order')
    set({ groups })
  },

  createLink: async (data) => {
    const id = await db.worldGroupLinks.add({
      ...data,
      createdAt: now(),
    } as WorldGroupLink) as number
    const links = await db.worldGroupLinks
      .where('projectId').equals(data.projectId)
      .toArray()
    set({ links })
    return id
  },

  deleteLink: async (id) => {
    await db.worldGroupLinks.delete(id)
    set({ links: get().links.filter(l => l.id !== id) })
  },

  ensurePrimaryGroup: async (projectId: number) => {
    const existing = await db.worldGroups
      .where('projectId').equals(projectId)
      .filter(g => g.type === 'primary')
      .first()
    if (existing?.id) return existing.id

    const id = await db.worldGroups.add({
      projectId,
      name: '主世界',
      description: '',
      type: 'primary',
      icon: '🏠',
      order: 0,
      createdAt: now(),
      updatedAt: now(),
    } as WorldGroup) as number

    // 刷新
    const groups = await db.worldGroups
      .where('projectId').equals(projectId)
      .sortBy('order')
    set({ groups, activeGroupId: id })
    return id
  },

  migrateToMultiWorld: async (projectId: number) => {
    // 数据红线:启用多世界前强制提示备份(Pre-Phase 0 安全网)
    // 理由:此操作会给现有数据盖章 worldGroupId,虽然不删数据,但当前代码已知有
    //       P0-1/P0-2/P0-8 三处事务作用域 + 漏盖章问题,失败时可能让大纲消失。
    //       Phase 0 修完后这个安全网可以减弱(但保留)。
    const proceed = await requireBackupBefore({
      operation: '启用多世界模式',
      projectId,
      details: '此操作将把现有项目数据(世界观、力量体系、大纲、词条等)迁移到「主世界」归属。建议先导出备份。',
    })
    if (!proceed) return  // 用户取消

    // 1. 确保主世界组存在
    const primaryId = await get().ensurePrimaryGroup(projectId)

    // 2. Phase 1.1b: 盖章从 PROJECT_TABLES 注册表派生(所有 worldScoped 表的 null 记录
    //    盖章到主世界;codexCategories 分类结构保持全局不盖)。行为与手写版等价(R-02 保证)。
    await stampPrimaryWorld(projectId, primaryId)
  },

  setActiveGroup: (id) => {
    set({ activeGroupId: id })
  },
}))
