import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { OutlineNode, WorkspaceScope } from '../lib/types'
import { normalizeOutlineNode } from '../lib/outline/normalize'
import { useChapterStore } from './chapter'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'

interface OutlineStore {
  nodes: OutlineNode[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addNode: (node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateNode: (id: number, data: Partial<OutlineNode>, options?: { scope?: WorkspaceScope; expected?: Partial<OutlineNode> }) => Promise<void>
  deleteNode: (id: number) => Promise<void>
  /** 批量添加节点（AI 生成大纲后） */
  addNodes: (nodes: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<void>
  /** 同级重排：按给定 id 顺序把 order 重写为 0..n-1（拖动排序 / 任意位置插入用，FB-2） */
  reorderNodes: (orderedIds: number[]) => Promise<void>
  /** 在某同级位置插入新节点（任意位置插入，FB-2）。siblingIds 为当前同级顺序，index 为插入位。返回新 id */
  insertNodeAt: (
    node: Omit<OutlineNode, 'id' | 'createdAt' | 'updatedAt'>,
    siblingIds: number[],
    index: number,
  ) => Promise<number>
  /**
   * 跨父级移动节点（QUICKWIN-6）。用于把章节从卷 A 拖进卷 B / 故事块,
   * 并同时重排源父级与目标父级的同类型 sibling order。
   */
  moveNodeToParent: (id: number, parentId: number | null, index: number) => Promise<void>
}

const now = () => Date.now()
let loadSequence = 0
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
const authorFields = new Map((FIELD_BY_TARGET.get('outlineNodes') ?? []).filter(field => !field.adoptionPolicy).map(field => [field.field, field]))

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

  addNode: async (node) => {
    const scope = await resolveScopeLike(node.projectId)
    const newNode: OutlineNode = stampNewRecord(scope, 'outlineNodes', normalizeOutlineNode({ ...node, createdAt: now(), updatedAt: now() } as OutlineNode), { owner: 'work' })
    const id = await db.outlineNodes.add(newNode) as number
    set({ nodes: [...get().nodes, { ...newNode, id }] })
    return id
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
          if (data.parentId != null) {
            const parent = await db.outlineNodes.get(data.parentId)
            if (data.parentId === id || !parent || !await assertRecordInScope(scope, 'outlineNodes', parent, { owner: 'work' })) throw new Error('大纲父节点无效或属于其他作品。')
          }
          if (data.worldGroupId != null) {
            const group = await db.worldGroups.get(data.worldGroupId)
            if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) throw new Error('大纲世界分组不属于原 World。')
          }
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

  deleteNode: async (id) => {
    // 级联删除子节点
    const children = get().nodes.filter(n => n.parentId === id)
    for (const child of children) {
      if (child.id) await get().deleteNode(child.id)
    }
    // 级联删除挂在本节点上的正文章节 + 细纲（按 outlineNodeId），否则删大纲后正文内容会成孤儿
    // Phase 0.7: 章节删除必须走 chapter store 的唯一入口 cascadeDeleteChapters,
    //            否则会绕过级联 → 章节关联的 emotionBeatCards 残留(孤儿数据)。
    const orphanChapters = (await db.chapters.where('outlineNodeId').equals(id).primaryKeys()) as number[]
    if (orphanChapters.length) await useChapterStore.getState().cascadeDeleteChapters(orphanChapters)
    const orphanDetails = (await db.detailedOutlines.where('outlineNodeId').equals(id).primaryKeys()) as number[]
    if (orphanDetails.length) await db.detailedOutlines.bulkDelete(orphanDetails)
    await db.outlineNodes.delete(id)
    set({ nodes: get().nodes.filter(n => n.id !== id) })
  },

  addNodes: async (nodes) => {
    const newNodes = await Promise.all(nodes.map(async n => stampNewRecord(
      await resolveScopeLike(n.projectId),
      'outlineNodes',
      normalizeOutlineNode({ ...n, createdAt: now(), updatedAt: now() } as OutlineNode),
      { owner: 'work' },
    )))
    const ids = await db.outlineNodes.bulkAdd(newNodes, { allKeys: true }) as number[]
    const withIds = newNodes.map((n, i) => ({ ...n, id: ids[i] }))
    set({ nodes: [...get().nodes, ...withIds] })
  },

  reorderNodes: async (orderedIds) => {
    const ts = now()
    const orderById = new Map(orderedIds.map((id, i) => [id, i]))
    await db.transaction('rw', db.outlineNodes, async () => {
      for (const [id, order] of orderById) {
        await db.outlineNodes.update(id, { order, updatedAt: ts })
      }
    })
    set({
      nodes: get().nodes.map(n =>
        n.id != null && orderById.has(n.id)
          ? normalizeOutlineNode({ ...n, order: orderById.get(n.id)!, updatedAt: ts })
          : n,
      ),
    })
  },

  insertNodeAt: async (node, siblingIds, index) => {
    // 先落库（order 临时给末尾），再把它挪到目标位并重排同级，保证 order 连续无重复
    const newId = await get().addNode({ ...node, order: siblingIds.length })
    const clamped = Math.max(0, Math.min(index, siblingIds.length))
    const next = [...siblingIds]
    next.splice(clamped, 0, newId)
    await get().reorderNodes(next)
    return newId
  },

  moveNodeToParent: async (id, parentId, index) => {
    const current = get().nodes.find(n => n.id === id) ?? await db.outlineNodes.get(id)
    if (!current) return
    if (current.parentId === parentId) {
      const siblingIds = get().nodes
        .filter(n => n.parentId === parentId && n.type === current.type && n.id != null)
        .sort((a, b) => a.order - b.order)
        .map(n => n.id!)
      const next = siblingIds.filter(item => item !== id)
      next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
      await get().reorderNodes(next)
      return
    }

    const ts = now()
    const sourceSiblings = get().nodes
      .filter(n => n.parentId === current.parentId && n.type === current.type && n.id != null && n.id !== id)
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const targetSiblings = get().nodes
      .filter(n => n.parentId === parentId && n.type === current.type && n.id != null && n.id !== id)
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const targetIndex = Math.max(0, Math.min(index, targetSiblings.length))
    targetSiblings.splice(targetIndex, 0, id)

    await db.transaction('rw', db.outlineNodes, async () => {
      await db.outlineNodes.update(id, { parentId, order: targetIndex, updatedAt: ts })
      for (let order = 0; order < sourceSiblings.length; order++) {
        await db.outlineNodes.update(sourceSiblings[order], { order, updatedAt: ts })
      }
      for (let order = 0; order < targetSiblings.length; order++) {
        await db.outlineNodes.update(targetSiblings[order], { order, updatedAt: ts })
      }
    })

    const sourceOrder = new Map(sourceSiblings.map((nodeId, order) => [nodeId, order]))
    const targetOrder = new Map(targetSiblings.map((nodeId, order) => [nodeId, order]))
    set({
      nodes: get().nodes.map(n => {
        if (n.id === id) return normalizeOutlineNode({ ...n, parentId, order: targetIndex, updatedAt: ts })
        if (n.id != null && sourceOrder.has(n.id)) {
          return normalizeOutlineNode({ ...n, order: sourceOrder.get(n.id)!, updatedAt: ts })
        }
        if (n.id != null && targetOrder.has(n.id)) {
          return normalizeOutlineNode({ ...n, order: targetOrder.get(n.id)!, updatedAt: ts })
        }
        return n
      }),
    })
  },
}))
