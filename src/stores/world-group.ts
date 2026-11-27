/** 当前多世界创作域 Store。 */
import { create } from 'zustand'
import { isPortableResourceUidV1 } from '../lib/context-gateway/resource-uid'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { db } from '../lib/db/schema'
import type { WorldGroup, WorldGroupLink, WorkspaceScope } from '../lib/types'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { assignUnscopedRecordsToPrimaryWorld, cascadeDeleteGroup, transactionTablesFor, worldScopedTables } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { updateWorkspace } from '../lib/workspace/works'
import { WORLD_GROUP_TYPE_LABELS, WORLD_LINK_TYPE_LABELS } from '../lib/types/world-group'

const now = () => Date.now()
let groupReadRequest = 0, groupWriteRevision = 0
const GROUP_AUTHOR_FIELDS = ['name', 'description', 'type', 'icon', 'color', 'entryCondition', 'exitCondition', 'plannedChapterCount', 'powerRestriction', 'takeawayRules', 'order'] as const
type GroupAuthorPatch = Partial<Pick<WorldGroup, typeof GROUP_AUTHOR_FIELDS[number]>>
interface GroupSaveOptions { scope?: WorkspaceScope; expected?: WorldGroup }
const LINK_AUTHOR_FIELDS = ['fromGroupId', 'toGroupId', 'linkType', 'name', 'description', 'bidirectional'] as const
type LinkAuthorPatch = Partial<Pick<WorldGroupLink, typeof LINK_AUTHOR_FIELDS[number]>>
interface LinkSaveOptions { scope?: WorkspaceScope; expected?: WorldGroupLink }
function validateLinkPatch(patch: LinkAuthorPatch) {
  if (Object.keys(patch).some(key => !LINK_AUTHOR_FIELDS.includes(key as typeof LINK_AUTHOR_FIELDS[number]))) throw new Error('世界关系更新包含身份或非作者字段。')
  for (const field of ['fromGroupId', 'toGroupId'] as const) if (field in patch && (!Number.isSafeInteger(patch[field]) || patch[field]! < 1)) throw new Error('世界关系端点必须是有效ID。')
  if ('linkType' in patch && !Object.prototype.hasOwnProperty.call(WORLD_LINK_TYPE_LABELS, patch.linkType!)) throw new Error('世界关系类型无效。')
  for (const field of ['name', 'description'] as const) if (patch[field] !== undefined && typeof patch[field] !== 'string') throw new Error('世界关系字段必须是原文。')
  if ('bidirectional' in patch && typeof patch.bidirectional !== 'boolean') throw new Error('世界关系方向必须明确。')
}
function linkFieldsMatch(row: WorldGroupLink, patch: LinkAuthorPatch) {
  return Object.entries(patch).every(([field, value]) => Reflect.get(row, field) === value)
}
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
  updateLink: (id: number, patch: LinkAuthorPatch, options?: LinkSaveOptions) => Promise<WorldGroupLink>
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
      let groups: WorldGroup[] = [], links: WorldGroupLink[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = groupWriteRevision
        ;[groups, links] = await Promise.all([
          readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }).then(rows => rows.sort((a, b) => a.order - b.order)),
          readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' }),
        ])
        if (request !== groupReadRequest) return
        if (observed === groupWriteRevision) break
      }
      if (observed !== groupWriteRevision) throw new Error('读取期间世界信息持续变化，请重新读取。')
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
    patch = structuredClone(patch)
    const expected = options?.expected ? structuredClone(options.expected) : undefined
    const explicitScope = options?.scope ? { ...options.scope } : undefined
    if (Object.keys(patch).some(key => !GROUP_AUTHOR_FIELDS.includes(key as typeof GROUP_AUTHOR_FIELDS[number]))) throw new Error('世界更新包含非作者字段。')
    const selected = explicitScope ? resolveScopeLike(explicitScope) : db.worldGroups.get(id).then(row => {
      if (!row) throw new Error('该世界已删除，草稿尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    const scope = await selected
    const committed = await db.transaction('rw', scopeTransactionTables(db.worldGroups), async transaction => {
      const table = transaction.table<WorldGroup, number>('worldGroups'), update = db.worldGroups.update.bind(table)
      await resolveScopeLike(scope)
      const current = await db.worldGroups.get(id)
      if (!current || !await assertRecordInScope(scope, 'worldGroups', current, { owner: 'world' })) throw new Error('世界已删除或作用域发生变化；草稿尚未保存。')
      if (expected && GROUP_AUTHOR_FIELDS.some(field => JSON.stringify(current[field]) !== JSON.stringify(expected[field]))) throw new Error('世界信息已被其他页面修改；草稿已保留，请核对后再保存。')
      if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('请填写世界名称。')
      if (patch.type !== undefined && (typeof patch.type !== 'string' || !Object.prototype.hasOwnProperty.call(WORLD_GROUP_TYPE_LABELS, patch.type) || (patch.type === 'primary') !== (current.type === 'primary'))) throw new Error('世界类型无效，或试图改变主世界身份。')
      for (const field of GROUP_AUTHOR_FIELDS.filter(field => !['type', 'plannedChapterCount', 'order'].includes(field))) {
        if (patch[field] !== undefined && typeof patch[field] !== 'string') throw new Error(`世界字段 ${field} 必须是文本。`)
      }
      for (const field of ['plannedChapterCount', 'order'] as const) if (patch[field] !== undefined && (!Number.isSafeInteger(patch[field]) || patch[field]! < 0)) throw new Error('章节数和排序必须是非负整数。')
      if (await update(id, { ...patch, updatedAt: Math.max(now(), current.updatedAt + 1) }) !== 1) throw new Error('该世界已删除，草稿尚未保存。')
      const actual = await table.get(id)
      if (!actual || actual.ragDocumentId !== current.ragDocumentId || !await assertRecordInScope(scope, 'worldGroups', actual, { owner: 'world' })
        || Object.entries(patch).some(([field, value]) => JSON.stringify(Reflect.get(actual, field)) !== JSON.stringify(value))) throw new Error('保存后未读到相同世界身份与输入原文，草稿已保留。')
      return actual
    })
    const revision = ++groupWriteRevision
    const updated = await db.worldGroups.get(id)
    if (!updated || updated.ragDocumentId !== committed.ragDocumentId || !await assertRecordInScope(scope, 'worldGroups', updated, { owner: 'world' })
      || Object.entries(patch).some(([field, value]) => JSON.stringify(Reflect.get(updated, field)) !== JSON.stringify(value))) throw new Error('提交后世界记录已变化，未确认当前草稿保存。')
    if (revision === groupWriteRevision && sameWorld(get().loadedScope, scope)) set({ groups: get().groups.map(group => group.id === id ? updated : group) })
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

  createLink: async (input, frozenScope) => {
    const data = structuredClone(input), target = frozenScope ? { ...frozenScope } : data.projectId
    const { projectId, ...patch } = data
    validateLinkPatch(patch)
    if (['fromGroupId', 'toGroupId', 'linkType', 'bidirectional'].some(field => !Object.prototype.hasOwnProperty.call(patch, field))) throw new Error('世界关系缺少端点、类型或方向。')
    const scope = await resolveScopeLike(target)
    if (scope.projectId !== projectId) throw new Error('世界关系创建作用域不匹配。')
    const created = await db.transaction('rw', scopeTransactionTables(db.worldGroupLinks, db.worldGroups), async transaction => {
      const table = transaction.table<WorldGroupLink, number>('worldGroupLinks'), groups = transaction.table<WorldGroup, number>('worldGroups')
      await resolveScopeLike(scope)
      if (data.fromGroupId === data.toGroupId) throw new Error('[WorldGroup] 世界关系不能连接同一世界')
      const [from, to] = await Promise.all([groups.get(data.fromGroupId), groups.get(data.toGroupId)])
      if (!from || !to || !await assertRecordInScope(scope, 'worldGroups', from, { owner: 'world' })
        || !await assertRecordInScope(scope, 'worldGroups', to, { owner: 'world' })) throw new Error('[WorldGroup] 世界关系端点不属于当前 World')
      const original = stampNewRecord(scope, 'worldGroupLinks', { ...data, createdAt: now(), updatedAt: now() } as WorldGroupLink, { owner: 'world' })
      const id = await db.worldGroupLinks.add.bind(table)(original) as number
      const actual = await table.get(id)
      if (!actual || !isPortableResourceUidV1(actual.ragDocumentId, 'world-group-link') || !await assertRecordInScope(scope, 'worldGroupLinks', actual, { owner: 'world' })
        || !linkFieldsMatch(actual, patch)) throw new Error('世界关系创建后未能确认相同身份与原文。')
      return actual
    })
    groupWriteRevision++
    let actual: WorldGroupLink | undefined
    try {
      actual = await db.worldGroupLinks.get(created.id!)
      if (!actual || actual.ragDocumentId !== created.ragDocumentId || !await assertRecordInScope(scope, 'worldGroupLinks', actual, { owner: 'world' })
        || !linkFieldsMatch(actual, patch)) throw new Error('提交后关系已变化。')
    } catch {
      throw Object.assign(new Error('世界关系已提交，但尚未确认回读；请重试读取，不会重复创建。'), { committedWorldLink: { id: created.id!, ragDocumentId: created.ragDocumentId } })
    }
    if (sameWorld(get().loadedScope, scope)) set({ links: [...get().links.filter(link => link.id !== actual!.id), actual] })
    return actual.id!
  },

  updateLink: async (id, input, options) => {
    const patch = structuredClone(input), config = options ? structuredClone(options) : undefined
    validateLinkPatch(patch)
    const initialRead = db.worldGroupLinks.get(id)
    void initialRead.catch(() => undefined)
    const selected = config?.scope ? resolveScopeLike(config.scope) : initialRead.then(row => {
      if (!row) throw new Error('[WorldGroup] 世界关系不存在')
      return resolveScopeLike(row.projectId)
    })
    void selected.catch(() => undefined)
    return coordinatePendingEditV1({ key: `world-link:${id}`, persist: async () => {
      const scope = await selected, initial = await initialRead
      const updated = await db.transaction('rw', scopeTransactionTables(db.worldGroupLinks, db.worldGroups), async transaction => {
        const table = transaction.table<WorldGroupLink, number>('worldGroupLinks'), groups = transaction.table<WorldGroup, number>('worldGroups')
        const update = db.worldGroupLinks.update.bind(table)
        await resolveScopeLike(scope)
        const current = await table.get(id)
        if (!current || !initial || current.ragDocumentId !== initial.ragDocumentId || !await assertRecordInScope(scope, 'worldGroupLinks', current, { owner: 'world' })) throw new Error('世界关系已不存在或不属于当前 World，输入已保留。')
        if (config?.expected && (current.id !== config.expected.id || current.ragDocumentId !== config.expected.ragDocumentId
          || !isPortableResourceUidV1(current.ragDocumentId, 'world-group-link') || !linkFieldsMatch(current, Object.fromEntries(LINK_AUTHOR_FIELDS.map(field => [field, config.expected![field]]))))) throw new Error('世界关系已被其他页面修改，输入已保留。')
        const fromId = patch.fromGroupId ?? current.fromGroupId, toId = patch.toGroupId ?? current.toGroupId
        if (fromId === toId) throw new Error('[WorldGroup] 世界关系不能连接同一世界')
        const [from, to] = await Promise.all([groups.get(fromId), groups.get(toId)])
        if (!from || !to || !await assertRecordInScope(scope, 'worldGroups', from, { owner: 'world' })
          || !await assertRecordInScope(scope, 'worldGroups', to, { owner: 'world' })) throw new Error('[WorldGroup] 世界关系端点不属于当前 World')
        if (await update(id, { ...patch, updatedAt: Math.max(now(), current.updatedAt + 1) }) !== 1) throw new Error('世界关系更新0行，输入已保留。')
        const actual = await table.get(id)
        if (!actual || actual.ragDocumentId !== current.ragDocumentId || !await assertRecordInScope(scope, 'worldGroupLinks', actual, { owner: 'world' }) || !linkFieldsMatch(actual, patch)) throw new Error('世界关系精确保存校验失败，输入已保留。')
        return actual
      })
      groupWriteRevision++
      let actual: WorldGroupLink | undefined
      try {
        actual = await db.worldGroupLinks.get(id)
        if (!actual || actual.ragDocumentId !== updated.ragDocumentId || !await assertRecordInScope(scope, 'worldGroupLinks', actual, { owner: 'world' }) || !linkFieldsMatch(actual, patch)) throw new Error('关系提交后内容已变化。')
      } catch {
        throw Object.assign(new Error('世界关系已提交，但尚未确认回读；请重试读取。'), { committedWorldLink: { id, ragDocumentId: updated.ragDocumentId } })
      }
      if (sameWorld(get().loadedScope, scope)) {
        const cached = get().links
        set({ links: cached.some(link => link.id === id) ? cached.map(link => link.id === id ? actual! : link) : [...cached, actual] })
      }
      return actual
    } })
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
