/** 当前多世界创作域 Store。 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldGroup, WorldGroupLink } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { assignUnscopedRecordsToPrimaryWorld, cascadeDeleteGroup } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

const now = () => Date.now()

// 删除、重分配作用域均由 PROJECT_TABLES 派生完整生命周期。

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
  createLink: (data: Omit<WorldGroupLink, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateLink: (id: number, patch: Partial<Pick<WorldGroupLink,
    'fromGroupId' | 'toGroupId' | 'linkType' | 'name' | 'description' | 'bidirectional'>>) => Promise<void>
  deleteLink: (id: number) => Promise<void>

  // 确保默认主世界组存在
  ensurePrimaryGroup: (scope: WorkspaceScopeLike) => Promise<number>

  // 开启多世界：确保主世界组 + 把现有项目级数据归属到主世界组
  enableMultiWorld: (scope: WorkspaceScopeLike) => Promise<boolean>

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

    // 删除世界组会级联清除当前世界的数据，执行前必须显式备份确认。
    const proceed = await requireBackupBefore({
      operation: `删除世界「${group.name}」`,
      projectId: group.projectId,
      details: '此操作将清除该世界的全部设定数据(世界观、力量体系、地理、历史、词条等),不可恢复。',
    })
    if (!proceed) return  // 用户取消


    const pid = group.projectId

    // 级联删除从 PROJECT_TABLES 派生：世界作用域表、角色归属、
    // 大纲引用、内置词条分类和世界组本身共享同一生命周期定义。
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
      updatedAt: now(),
    } as WorldGroupLink, { owner: 'world' })) as number
    const links = await readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' })
    set({ links })
    return id
  },

  updateLink: async (id, patch) => {
    const current = get().links.find(link => link.id === id) ?? await db.worldGroupLinks.get(id)
    if (!current) throw new Error('[WorldGroup] 世界关系不存在')
    const scope = await resolveScopeLike(current.projectId)
    if (!await assertRecordInScope(scope, 'worldGroupLinks', current, { owner: 'world' })) {
      throw new Error('[WorldGroup] 世界关系不属于当前 World')
    }
    const fromGroupId = patch.fromGroupId ?? current.fromGroupId
    const toGroupId = patch.toGroupId ?? current.toGroupId
    if (fromGroupId === toGroupId) throw new Error('[WorldGroup] 世界关系不能连接同一世界')
    const [from, to] = await Promise.all([db.worldGroups.get(fromGroupId), db.worldGroups.get(toGroupId)])
    if (!from || !to || !await assertRecordInScope(scope, 'worldGroups', from, { owner: 'world' })
      || !await assertRecordInScope(scope, 'worldGroups', to, { owner: 'world' })) {
      throw new Error('[WorldGroup] 世界关系端点不属于当前 World')
    }
    const updatedAt = now()
    await db.worldGroupLinks.update(id, { ...patch, updatedAt })
    set({
      links: get().links.map(link => link.id === id ? { ...link, ...patch, updatedAt } : link),
    })
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

  enableMultiWorld: async (scopeInput: WorkspaceScopeLike) => {
    const scope = await resolveScopeLike(scopeInput)
    const projectId = scope.projectId
    // 从单世界创作切换到多世界创作会批量重分配语义记录的 worldGroupId，
    // 因此即使不删除数据，也必须先经过显式备份确认。
    const proceed = await requireBackupBefore({
      operation: '启用多世界模式',
      projectId,
      details: '此操作将把现有项目数据(世界观、力量体系、大纲、词条等)迁移到「主世界」归属。建议先导出备份。',
    })
    if (!proceed) return false  // 用户取消

    // 1. 确保主世界组存在
    const primaryId = await get().ensurePrimaryGroup(scope)

    // 2. 从 PROJECT_TABLES 派生所有需要重分配的世界作用域记录；
    // codexCategories 是工作区共享分类，不参与世界作用域变更。
    await assignUnscopedRecordsToPrimaryWorld(projectId, primaryId)
    return true
  },

  setActiveGroup: (id) => {
    set({ activeGroupId: id })
  },
}))
