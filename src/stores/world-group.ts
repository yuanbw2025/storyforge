/** 当前多世界创作域 Store。 */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { WorldGroup, WorldGroupLink, WorkspaceScope } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { assignUnscopedRecordsToPrimaryWorld, cascadeDeleteGroup, transactionTablesFor, worldScopedTables } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { updateWorkspace } from '../lib/workspace/works'
import { WORLD_GROUP_TYPE_LABELS } from '../lib/types/world-group'

const now = () => Date.now()
let groupReadRequest = 0
const GROUP_AUTHOR_FIELDS = ['name', 'description', 'type', 'icon', 'color', 'entryCondition', 'exitCondition', 'plannedChapterCount', 'powerRestriction', 'takeawayRules', 'order'] as const
type GroupAuthorPatch = Partial<Pick<WorldGroup, typeof GROUP_AUTHOR_FIELDS[number]>>
interface GroupSaveOptions { scope?: WorkspaceScope; expected?: WorldGroup }
const sameWorld = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId

async function ensurePrimaryInDatabase(scope: WorkspaceScope): Promise<number> {
  const primary = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).filter(group => group.type === 'primary')
  if (primary.length > 1) throw new Error('当前 World 有多个主世界，请先检查已有世界记录。')
  if (primary[0]?.id) return primary[0].id
  return db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId: scope.projectId, name: '主世界', description: '', type: 'primary', icon: '🏠', order: 0,
    createdAt: now(), updatedAt: now(),
  } as WorldGroup, { owner: 'world' })) as Promise<number>
}

// 删除、重分配作用域均由 PROJECT_TABLES 派生完整生命周期。

interface WorldGroupStore {
  groups: WorldGroup[]
  links: WorldGroupLink[]
  activeGroupId: number | null
  loading: boolean
  loadedScope: WorkspaceScope | null

  // 加载
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  // 世界组 CRUD
  createGroup: (data: Omit<WorldGroup, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<number>
  updateGroup: (id: number, patch: GroupAuthorPatch, options?: GroupSaveOptions) => Promise<WorldGroup>
  deleteGroup: (id: number) => Promise<void>
  reorderGroups: (scope: WorkspaceScopeLike, orderedIds: number[]) => Promise<void>

  // 世界间关系
  createLink: (data: Omit<WorldGroupLink, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<number>
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
  loadedScope: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++groupReadRequest
    set({ loading: true })
    try {
      const scope = await resolveScopeLike(scopeInput)
      const [groups, links] = await Promise.all([
        readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }).then(rows => rows.sort((a, b) => a.order - b.order)),
        readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' }),
      ])
      if (request !== groupReadRequest) return
      const current = get()
      const activeGroupId = sameWorld(current.loadedScope, scope) && groups.some(group => group.id === current.activeGroupId)
        ? current.activeGroupId : groups.find(group => group.type === 'primary')?.id ?? groups[0]?.id ?? null
      set({ groups, links, activeGroupId, loadedScope: scope, loading: false })
    } finally { if (request === groupReadRequest) set({ loading: false }) }
  },

  createGroup: async (data, frozenScope) => {
    const scope = await resolveScopeLike(frozenScope ?? data.projectId)
    if (scope.projectId !== data.projectId) throw new Error('世界创建作用域不匹配。')
    const id = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      ...data,
      createdAt: now(),
      updatedAt: now(),
    } as WorldGroup, { owner: 'world' })) as number
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    if (sameWorld(get().loadedScope, scope)) set({ groups })
    return id
  },

  updateGroup: async (id, patch, options) => {
    if (Object.keys(patch).some(key => !GROUP_AUTHOR_FIELDS.includes(key as typeof GROUP_AUTHOR_FIELDS[number]))) throw new Error('世界更新包含非作者字段。')
    const selected = options?.scope ? Promise.resolve(options.scope) : db.worldGroups.get(id).then(row => {
      if (!row) throw new Error('该世界已删除，草稿尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    const scope = await selected
    const updated = await db.transaction('rw', scopeTransactionTables(db.worldGroups), async () => {
      await resolveScopeLike(scope)
      const current = await db.worldGroups.get(id)
      if (!current || !await assertRecordInScope(scope, 'worldGroups', current, { owner: 'world' })) throw new Error('世界已删除或作用域发生变化；草稿尚未保存。')
      if (options?.expected && GROUP_AUTHOR_FIELDS.some(field => JSON.stringify(current[field]) !== JSON.stringify(options.expected![field]))) throw new Error('世界信息已被其他页面修改；草稿已保留，请核对后再保存。')
      if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('请填写世界名称。')
      if (patch.type !== undefined && (typeof patch.type !== 'string' || !Object.prototype.hasOwnProperty.call(WORLD_GROUP_TYPE_LABELS, patch.type) || (patch.type === 'primary') !== (current.type === 'primary'))) throw new Error('世界类型无效，或试图改变主世界身份。')
      for (const field of GROUP_AUTHOR_FIELDS.filter(field => !['type', 'plannedChapterCount', 'order'].includes(field))) {
        if (patch[field] !== undefined && typeof patch[field] !== 'string') throw new Error(`世界字段 ${field} 必须是文本。`)
      }
      for (const field of ['plannedChapterCount', 'order'] as const) if (patch[field] !== undefined && (!Number.isSafeInteger(patch[field]) || patch[field]! < 0)) throw new Error('章节数和排序必须是非负整数。')
      const next = { ...current, ...patch, updatedAt: now() }
      if (await db.worldGroups.update(id, { ...patch, updatedAt: next.updatedAt }) !== 1) throw new Error('该世界已删除，草稿尚未保存。')
      return next
    })
    if (sameWorld(get().loadedScope, scope)) set({ groups: get().groups.map(group => group.id === id ? updated : group) })
    return updated
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

  createLink: async (data, frozenScope) => {
    const scope = await resolveScopeLike(frozenScope ?? data.projectId)
    if (scope.projectId !== data.projectId) throw new Error('世界关系创建作用域不匹配。')
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
    if (sameWorld(get().loadedScope, scope)) set({ links })
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
    const id = await db.transaction('rw', db.worldGroups, () => ensurePrimaryInDatabase(scope))

    // 刷新
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    if (sameWorld(get().loadedScope, scope)) set({ groups, activeGroupId: get().activeGroupId ?? id })
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

    // 整个工作区的开关只提交一次；每个 World 使用自己的主世界。
    // 在事务确认前，不把临时主世界发布进全局缓存。
    let primaryId: number | null = null
    await db.transaction('rw', transactionTablesFor('assignPrimaryWorld'), async () => {
      await resolveScopeLike(scope)
      const works = await db.works.where('projectId').equals(projectId).toArray()
      const worlds = new Map(works.map(work => [work.worldId, work]))
      for (const work of worlds.values()) {
        const ownedScope = await resolveScopeLike({ projectId, worldId: work.worldId, workId: work.id! })
        const id = await ensurePrimaryInDatabase(ownedScope)
        await assignUnscopedRecordsToPrimaryWorld(projectId, id)
        if (ownedScope.worldId === scope.worldId) primaryId = id
      }
      for (const spec of worldScopedTables()) {
        const field = spec.worldGroupField ?? 'worldGroupId'
        if ((await spec.table.where('projectId').equals(projectId).toArray()).some(row => row[field] == null)) throw new Error(`有未能确认归属的 ${spec.name} 记录；已撤销本次调整，请先备份并检查数据。`)
      }
      await updateWorkspace(projectId, { enableMultiWorld: true })
    })
    const groups = (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).sort((a, b) => a.order - b.order)
    if (sameWorld(get().loadedScope, scope)) set({ groups, activeGroupId: primaryId })
    return true
  },

  setActiveGroup: (id) => {
    set({ activeGroupId: id })
  },
}))
