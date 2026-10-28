import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { OutlineNode, WorkspaceScope } from '../lib/types'
import { normalizeOutlineNode } from '../lib/outline/normalize'
import { useChapterStore } from './chapter'
import { useDetailedOutlineStore } from './detailed-outline'
import { cascadeDeleteChapterRecords } from '../lib/chapters/lifecycle'
import { cascadeRegisteredReferences } from '../lib/workspace/lifecycle'
import { transactionTablesFor, transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'

interface OutlineStore {
  nodes: OutlineNode[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addNode: (node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<number>
  updateNode: (id: number, data: Partial<OutlineNode>, options?: { scope?: WorkspaceScope; expected?: Partial<OutlineNode> }) => Promise<void>
  deleteNode: (id: number, scope?: WorkspaceScope) => Promise<void>
  deleteNodes: (ids: number[], scope?: WorkspaceScope) => Promise<void>
  /** 批量添加节点（AI 生成大纲后） */
  addNodes: (nodes: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>[], scope?: WorkspaceScope) => Promise<void>
  /** 同级重排：按给定 id 顺序把 order 重写为 0..n-1（拖动排序 / 任意位置插入用，FB-2） */
  reorderNodes: (orderedIds: number[], scope?: WorkspaceScope) => Promise<void>
  /** 在某同级位置插入新节点（任意位置插入，FB-2）。siblingIds 为当前同级顺序，index 为插入位。返回新 id */
  insertNodeAt: (
    node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>,
    siblingIds: number[],
    index: number,
    scope?: WorkspaceScope,
  ) => Promise<number>
  /**
   * 跨父级移动节点（QUICKWIN-6）。用于把章节从卷 A 拖进卷 B / 故事块,
   * 并同时重排源父级与目标父级的同类型 sibling order。
   */
  moveNodeToParent: (id: number, parentId: number | null, index: number, scope?: WorkspaceScope) => Promise<void>
}

const now = () => Date.now()
let loadSequence = 0
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
const authorFields = new Map((FIELD_BY_TARGET.get('outlineNodes') ?? []).filter(field => !field.adoptionPolicy).map(field => [field.field, field]))


// Commands have no unsaved text to retain after a reported failure. Serialize
// their native transactions without leaving a failed draft key in the edit barrier.
let structureTail = Promise.resolve()
function serializeStructure<T>(persist: () => Promise<T>): Promise<T> {
  const operation = structureTail.catch(() => undefined).then(persist)
  structureTail = operation.then(() => undefined, () => undefined)
  void operation.catch(() => undefined)
  return operation
}
function captureTreeScope(explicit: WorkspaceScope | undefined, displayed: WorkspaceScope | null, projectId?: number, nodeId?: number): Promise<WorkspaceScope> {
  const selected = explicit ?? (projectId == null || displayed?.projectId === projectId ? displayed : null)
  const operation = selected ? Promise.resolve({ ...selected }) : projectId != null ? resolveScopeLike(projectId) : (async () => {
    const row = nodeId == null ? undefined : await db.outlineNodes.get(nodeId)
    const work = row?.workId == null ? undefined : await db.works.get(row.workId)
    if (!row || !work) throw new Error('大纲已删除或缺少有效作品归属。')
    return resolveScopeLike({ projectId: row.projectId, worldId: work.worldId, workId: work.id! })
  })()
  void operation.catch(() => undefined)
  return operation
}
function assertIds(ids: number[]): void {
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new Error('大纲标识无效或重复。')
}
function assertPosition(index: number): void {
  if (!Number.isSafeInteger(index)) throw new Error('大纲插入位置无效。')
}
async function ownedNode(scope: WorkspaceScope, id: number): Promise<OutlineNode> {
  const row = await db.outlineNodes.get(id)
  if (!row || !await assertRecordInScope(scope, 'outlineNodes', row, { owner: 'work' })) throw new Error('大纲已删除或不属于原作品。')
  return normalizeOutlineNode(row)
}
async function assertParentPath(scope: WorkspaceScope, parentId: number | null, childId?: number): Promise<void> {
  const seen = new Set(childId == null ? [] : [childId])
  let cursor = parentId
  while (cursor != null) {
    if (seen.has(cursor)) throw new Error('大纲父节点形成循环，操作未保存。')
    seen.add(cursor)
    const parent = await ownedNode(scope, cursor)
    await assertGroup(scope, parent.worldGroupId)
    cursor = parent.parentId
  }
}
async function assertGroup(scope: WorkspaceScope, groupId: number | null | undefined): Promise<void> {
  if (groupId == null) return
  const group = await db.worldGroups.get(groupId)
  if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) throw new Error('大纲世界分组不属于原 World。')
}
function assertStructuralPreimage(row: OutlineNode, expected?: OutlineNode): void {
  if (expected && (row.parentId !== expected.parentId || row.type !== expected.type || row.order !== expected.order)) throw new Error('大纲顺序或父级已变化，请核对后重试。')
}
function siblings(rows: OutlineNode[], parentId: number | null, type: OutlineNode['type']): OutlineNode[] {
  return rows.filter(row => row.parentId === parentId && row.type === type).sort((a, b) => a.order - b.order || a.id! - b.id!)
}
function assertCompleteSiblings(rows: OutlineNode[], ids: number[]): void {
  if (rows.length !== ids.length || rows.some(row => row.id == null || !ids.includes(row.id))) throw new Error('同级大纲已变化，排序未保存。')
}
async function writeOrderedNodes(rows: OutlineNode[], ids: number[], parentId?: number | null): Promise<OutlineNode[]> {
  const byId = new Map(rows.map(row => [row.id, row]))
  const saved: OutlineNode[] = []
  for (let order = 0; order < ids.length; order++) {
    const row = byId.get(ids[order])
    if (!row) throw new Error('大纲节点已删除，排序未保存。')
    const patch = { order, ...(parentId === undefined ? {} : { parentId }), updatedAt: Math.max(now(), row.updatedAt + 1) }
    if (await db.outlineNodes.update(ids[order], patch) !== 1) throw new Error('大纲节点已删除，排序未保存。')
    saved.push({ ...row, ...patch })
  }
  return saved
}
function prepareNewNode(scope: WorkspaceScope, input: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>): OutlineNode {
  if (input.projectId !== scope.projectId) throw new Error('新建大纲的作品归属不符。')
  for (const key of Object.keys(input)) if (key !== 'projectId' && !authorFields.has(key)) throw new Error('新建大纲包含身份、归属或未登记字段。')
  return stampNewRecord(scope, 'outlineNodes', normalizeOutlineNode({ ...input, createdAt: now(), updatedAt: now() }), { owner: 'work' })
}

export const useOutlineStore = create<OutlineStore>((set, get) => ({
  nodes: [],
  loading: false,
  loadedScope: null,
  loadError: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++loadSequence
    set({ loading: true, loadError: null })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      if (request !== loadSequence) return
      if (!sameWork(get().loadedScope, scope)) set({ nodes: [], loadedScope: null })
      const nodes = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })).sort((a, b) => a.order - b.order).map(normalizeOutlineNode)
      if (request === loadSequence) set({ nodes, loading: false, loadedScope: scope })
    } catch (cause) {
      if (request === loadSequence) set({ loading: false, loadError: cause instanceof Error ? cause.message : '大纲读取失败。' })
    }
  },

  addNode: (input, explicitScope) => {
    const node = structuredClone(input)
    const captured = captureTreeScope(explicitScope, get().loadedScope, node.projectId)
    return serializeStructure(async () => {
      const scope = await captured
      const saved = await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const row = prepareNewNode(scope, node)
        const peers = siblings(await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }), row.parentId, row.type)
        row.order = peers.reduce((tail, peer) => Math.max(tail, peer.order + 1), row.order)
        normalizeOutlineNode(row)
        await assertParentPath(scope, row.parentId)
        await assertGroup(scope, row.worldGroupId)
        const id = await db.outlineNodes.add(row) as number
        return { ...row, id }
      })
      if (sameWork(get().loadedScope, scope) || (!get().loadedScope && get().nodes.length === 0)) set({ loadedScope: scope, nodes: [...get().nodes, saved] })
      return saved.id
    })
  },

  updateNode: (id, input, options) => {
    const data = structuredClone(input)
    const cached = get().nodes.find(node => node.id === id)
    const selected = options?.scope ? { ...options.scope } : (cached ? get().loadedScope ?? undefined : undefined)
    const expected = structuredClone(options?.expected ?? cached)
    const scopePromise = selected ? Promise.resolve(selected) : db.outlineNodes.get(id).then(row => {
      if (!row) throw new Error('大纲节点已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    void scopePromise.catch(() => undefined)
    return coordinatePendingEditV1({
      key: `outline-node:${id}`,
      persist: async () => {
        for (const [key, value] of Object.entries(data)) {
          const spec = authorFields.get(key)
          if (!spec) throw new Error('大纲更新包含非作者字段或归属字段。')
          if (value == null) {
            if (!['parentId', 'worldGroupId'].includes(key)) throw new Error(`大纲 ${key} 格式异常。`)
          } else if ((['string', 'longtext'].includes(spec.type) && typeof value !== 'string')
            || (spec.type === 'enum' && !spec.enums?.includes(value as string))
            || (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error(`大纲 ${key} 格式异常。`)
        }
        const scope = await scopePromise
        const saved = await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.chapters, db.worldGroups), async () => {
          await resolveScopeLike(scope)
          const before = await db.outlineNodes.get(id)
          if (!before || !await assertRecordInScope(scope, 'outlineNodes', before, { owner: 'work' })) throw new Error('大纲节点已删除或作品归属已变化，输入尚未保存。')
          if (expected && Object.keys(data).some(key => JSON.stringify(before[key as keyof OutlineNode]) !== JSON.stringify(expected[key as keyof OutlineNode]))) throw new Error('大纲字段已被其他页面修改，输入已保留，请核对后保存。')
          const ts = Math.max(now(), (Number.isFinite(before.updatedAt) ? before.updatedAt : 0) + 1)
          const next = normalizeOutlineNode({ ...before, ...data, updatedAt: ts })
          if ('parentId' in data) await assertParentPath(scope, next.parentId, id)
          if ('worldGroupId' in data) await assertGroup(scope, next.worldGroupId)
          if (await db.outlineNodes.update(id, { ...data, updatedAt: ts }) !== 1) throw new Error('大纲节点已删除，输入尚未保存。')
          const chapterIds: number[] = []
          if (before.type === 'chapter' && 'title' in data) {
            for (const chapter of await db.chapters.where('outlineNodeId').equals(id).toArray()) {
              if (chapter.id == null || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('关联正文的作品归属不符，标题未保存。')
              chapterIds.push(chapter.id)
            }
            if (chapterIds.length && await db.chapters.bulkUpdate(chapterIds.map(key => ({ key, changes: { title: next.title, updatedAt: ts } }))) !== chapterIds.length) throw new Error('正文标题未完整保存，请重试。')
          }
          return { next, chapterIds }
        })
        if (saved.chapterIds.length) {
          const ids = new Set(saved.chapterIds)
          useChapterStore.setState(state => ({
            chapters: state.chapters.map(chapter => chapter.id != null && ids.has(chapter.id) ? { ...chapter, title: saved.next.title, updatedAt: saved.next.updatedAt } : chapter),
            currentChapter: state.currentChapter?.id != null && ids.has(state.currentChapter.id) ? { ...state.currentChapter, title: saved.next.title, updatedAt: saved.next.updatedAt } : state.currentChapter,
          }))
        }
        if (sameWork(get().loadedScope, scope)) set({ nodes: get().nodes.map(node => node.id === id ? saved.next : node) })
      },
    })
  },

  deleteNode: (id, scope) => get().deleteNodes([id], scope),

  deleteNodes: (input, explicitScope) => {
    const ids = [...input]
    if (!ids.length) return Promise.resolve()
    const captured = captureTreeScope(explicitScope, get().loadedScope, undefined, ids[0])
    const expected = new Map(get().nodes.map(row => [row.id, structuredClone(row)]))
    return serializeStructure(async () => {
      assertIds(ids)
      const scope = await captured
      const removed = await db.transaction('rw', scopeTransactionTables(...transactionTablesFor('deleteChapters'), ...transactionTablesForReferenceCascade('outlineNodes')), async () => {
        await resolveScopeLike(scope)
        const visiting = new Set<number>(), finished = new Set<number>(), postorder: number[] = []
        const stack = ids.map(id => ({ id, exit: false }))
        while (stack.length) {
          const item = stack.pop()!
          if (item.exit) { visiting.delete(item.id); finished.add(item.id); postorder.push(item.id); continue }
          if (finished.has(item.id)) continue
          if (visiting.has(item.id)) throw new Error('大纲父节点形成循环，删除未执行。')
          const row = await ownedNode(scope, item.id)
          assertStructuralPreimage(row, expected.get(item.id))
          visiting.add(item.id); stack.push({ id: item.id, exit: true })
          const children = await db.outlineNodes.where('parentId').equals(item.id).toArray()
          for (const child of children) {
            if (child.id == null || !await assertRecordInScope(scope, 'outlineNodes', child, { owner: 'work' })) throw new Error('子大纲存在其他作品或未知归属，删除未执行。')
            stack.push({ id: child.id, exit: false })
          }
        }
        const chapterIds: number[] = [], detailIds: number[] = []
        for (const chapter of await db.chapters.where('outlineNodeId').anyOf(postorder).toArray()) {
          if (chapter.id == null || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) throw new Error('关联正文的作品归属不符，删除未执行。')
          chapterIds.push(chapter.id)
        }
        for (const detail of await db.detailedOutlines.where('outlineNodeId').anyOf(postorder).toArray()) {
          if (detail.id == null || !await assertRecordInScope(scope, 'detailedOutlines', detail, { owner: 'work' })) throw new Error('关联细纲的作品归属不符，删除未执行。')
          detailIds.push(detail.id)
        }
        // This shared lifecycle owns prose evidence detachment and dependent rows.
        await cascadeDeleteChapterRecords(chapterIds)
        for (const id of postorder) { await cascadeRegisteredReferences('outlineNodes', id); await db.outlineNodes.delete(id) }
        return { nodeIds: postorder, chapterIds, detailIds }
      })
      const nodeIds = new Set(removed.nodeIds), chapterIds = new Set(removed.chapterIds), detailIds = new Set(removed.detailIds)
      if (sameWork(get().loadedScope, scope)) set({ nodes: get().nodes.filter(row => !nodeIds.has(row.id!)) })
      useChapterStore.setState(state => ({ chapters: state.chapters.filter(row => !chapterIds.has(row.id!)), currentChapter: state.currentChapter && chapterIds.has(state.currentChapter.id!) ? null : state.currentChapter }))
      useDetailedOutlineStore.setState(state => ({ detailedOutlines: state.detailedOutlines.filter(row => !detailIds.has(row.id!)) }))
    })
  },

  addNodes: (input, explicitScope) => {
    const nodes = structuredClone(input)
    if (!nodes.length) return Promise.resolve()
    const captured = captureTreeScope(explicitScope, get().loadedScope, nodes[0].projectId)
    return serializeStructure(async () => {
      const scope = await captured
      const saved = await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const rows: OutlineNode[] = []
        for (const node of nodes) {
          const row = prepareNewNode(scope, node)
          await assertParentPath(scope, row.parentId); await assertGroup(scope, row.worldGroupId)
          const id = await db.outlineNodes.add(row) as number
          rows.push({ ...row, id })
        }
        return rows
      })
      if (sameWork(get().loadedScope, scope) || (!get().loadedScope && get().nodes.length === 0)) set({ loadedScope: scope, nodes: [...get().nodes, ...saved] })
    })
  },

  reorderNodes: (input, explicitScope) => {
    const ids = [...input]
    if (!ids.length) return Promise.resolve()
    const captured = captureTreeScope(explicitScope, get().loadedScope, undefined, ids[0])
    const expected = new Map(get().nodes.map(row => [row.id, structuredClone(row)]))
    return serializeStructure(async () => {
      assertIds(ids)
      const scope = await captured
      const saved = await db.transaction('rw', scopeTransactionTables(db.outlineNodes), async () => {
        await resolveScopeLike(scope)
        const selected: OutlineNode[] = []
        for (const id of ids) { const row = await ownedNode(scope, id); assertStructuralPreimage(row, expected.get(id)); selected.push(row) }
        const first = selected[0]
        if (selected.some(row => row.parentId !== first.parentId || row.type !== first.type)) throw new Error('只能重排原作品的同级大纲。')
        const all = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
        assertCompleteSiblings(siblings(all, first.parentId, first.type), ids)
        return writeOrderedNodes(selected, ids)
      })
      if (sameWork(get().loadedScope, scope)) { const byId = new Map(saved.map(row => [row.id, row])); set({ nodes: get().nodes.map(row => byId.get(row.id) ?? row) }) }
    })
  },

  insertNodeAt: (input, siblingInput, index, explicitScope) => {
    const node = structuredClone(input), siblingIds = [...siblingInput]
    const captured = captureTreeScope(explicitScope, get().loadedScope, node.projectId)
    const expected = new Map(get().nodes.map(row => [row.id, structuredClone(row)]))
    return serializeStructure(async () => {
      assertIds(siblingIds); assertPosition(index)
      const scope = await captured
      const result = await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const row = prepareNewNode(scope, { ...node, order: siblingIds.length })
        await assertParentPath(scope, row.parentId); await assertGroup(scope, row.worldGroupId)
        const all = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
        const current = siblings(all, row.parentId, row.type)
        assertCompleteSiblings(current, siblingIds)
        for (const item of current) assertStructuralPreimage(item, expected.get(item.id))
        const id = await db.outlineNodes.add(row) as number
        const ids = [...siblingIds]; ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
        return { id, rows: await writeOrderedNodes([...current, { ...row, id }], ids) }
      })
      if (sameWork(get().loadedScope, scope) || (!get().loadedScope && get().nodes.length === 0)) {
        const byId = new Map(result.rows.map(row => [row.id, row]))
        set({ loadedScope: scope, nodes: [...get().nodes.map(row => byId.get(row.id) ?? row), result.rows.find(row => row.id === result.id)!] })
      }
      return result.id
    })
  },

  moveNodeToParent: (id, parentId, index, explicitScope) => {
    const captured = captureTreeScope(explicitScope, get().loadedScope, undefined, id)
    const expected = new Map(get().nodes.map(row => [row.id, structuredClone(row)]))
    return serializeStructure(async () => {
      assertIds([id]); assertPosition(index)
      const scope = await captured
      const saved = await db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        const current = await ownedNode(scope, id)
        await assertGroup(scope, current.worldGroupId)
        assertStructuralPreimage(current, expected.get(id))
        await assertParentPath(scope, parentId, id)
        const all = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })).map(normalizeOutlineNode)
        if ((await db.projects.get(scope.projectId))?.enableMultiWorld) {
          const byId = new Map(all.map(row => [row.id, row]))
          const groups = await readOwnedRows<{ id?: number; type: string }>(scope, 'worldGroups', { owner: 'world' })
          const primary = groups.find(group => group.type === 'primary')?.id ?? null
          const groupFor = (start: number | null): number | null => {
            const seen = new Set<number>(); let cursor = start
            while (cursor != null) {
              if (seen.has(cursor)) throw new Error('大纲父节点形成循环。')
              seen.add(cursor)
              const row = byId.get(cursor)
              if (!row) throw new Error('大纲父节点已变化。')
              if (row.worldGroupId != null) return row.worldGroupId
              cursor = row.parentId
            }
            return primary
          }
          if (groupFor(id) !== groupFor(parentId)) throw new Error('不能将章节移动到其他世界分组。')
        }
        const source = siblings(all, current.parentId, current.type).filter(row => row.id !== id)
        const target = current.parentId === parentId ? source : siblings(all, parentId, current.type).filter(row => row.id !== id)
        for (const row of [...source, ...target]) assertStructuralPreimage(row, expected.get(row.id))
        const ids = target.map(row => row.id!)
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
        const sourceSaved = current.parentId === parentId ? [] : await writeOrderedNodes(source, source.map(row => row.id!))
        return [...sourceSaved, ...await writeOrderedNodes([...target, current], ids, parentId)]
      })
      if (sameWork(get().loadedScope, scope)) { const byId = new Map(saved.map(row => [row.id, row])); set({ nodes: get().nodes.map(row => byId.get(row.id) ?? row) }) }
    })
  },
}))
