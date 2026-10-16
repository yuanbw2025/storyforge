import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { DetailedOutline, DetailedScene } from '../lib/types'
import { normalizeDetailedScenes } from '../lib/types/detailed-outline'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

export type DetailedSceneEditV1 =
  | { kind: 'add'; scene: DetailedScene }
  | { kind: 'patch'; sceneId: string; patch: Partial<Omit<DetailedScene, 'sceneId'>> }
  | { kind: 'remove'; sceneId: string }

interface DetailedOutlineStore {
  detailedOutlines: DetailedOutline[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  /** 获取或创建某章节的细纲 */
  getOrCreate: (scope: WorkspaceScopeLike, outlineNodeId: number) => Promise<DetailedOutline>
  save: (id: number, patch: Partial<DetailedOutline>, scope?: WorkspaceScopeLike) => Promise<void>
  /** 人工操作在同一队列内读取最新数组再合并，不从过期 UI 数组重写其它场景。 */
  editScene: (id: number, edit: DetailedSceneEditV1, scope: WorkspaceScopeLike, chapterSummary: string) => Promise<void>
  remove: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useDetailedOutlineStore = create<DetailedOutlineStore>((set, get) => ({
  detailedOutlines: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const list = await readOwnedRows<DetailedOutline>(await resolveScopeLike(scopeInput), 'detailedOutlines', { owner: 'work' })
    // CF-2 自愈：旧库可能把 scenes 存成字符串，读入时统一回数组，避免渲染端 .map/.reduce 崩溃
    set({ detailedOutlines: list.map(d => ({ ...d, scenes: normalizeDetailedScenes(d.scenes) })), loading: false })
  },

  getOrCreate: async (scopeInput: WorkspaceScopeLike, outlineNodeId: number): Promise<DetailedOutline> => {
    const scope = await resolveScopeLike(scopeInput)
    const outlineNode = await db.outlineNodes.get(outlineNodeId)
    if (!outlineNode || !await assertRecordInScope(scope, 'outlineNodes', outlineNode, { owner: 'work' })) {
      throw new Error('[DetailedOutline] 大纲节点不属于当前 Work')
    }
    const existing = get().detailedOutlines.find(d => d.outlineNodeId === outlineNodeId)
    if (existing && await assertRecordInScope(scope, 'detailedOutlines', existing, { owner: 'work' })) return existing
    // 内存没有时以 DB 为准再查一次，避免 store 未加载/竞态导致同一节点重复建细纲
    const inDb = await db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first()
    if (inDb && await assertRecordInScope(scope, 'detailedOutlines', inDb, { owner: 'work' })) {
      const normalized = { ...inDb, scenes: normalizeDetailedScenes(inDb.scenes) }
      if (!get().detailedOutlines.some(d => d.id === normalized.id)) {
        set({ detailedOutlines: [...get().detailedOutlines, normalized] })
      }
      return normalized
    }
    const fresh: DetailedOutline = {
      projectId: scope.projectId, outlineNodeId, scenes: [],
      createdAt: now(), updatedAt: now(),
    }
    const stamped = stampNewRecord(scope, 'detailedOutlines', fresh, { owner: 'work' }) as DetailedOutline
    const id = await db.detailedOutlines.add(stamped) as number
    const withId = { ...stamped, id }
    set({ detailedOutlines: [...get().detailedOutlines, withId] })
    return withId
  },

  save: async (id, patch, scopeInput) => {
    await coordinatePendingEditV1({
      key: `detailed-outline:${id}`,
      persist: async () => {
        const initial = await db.detailedOutlines.get(id)
        if (!initial) return
        const scope = await resolveScopeLike(scopeInput ?? initial.projectId)
        const current = await db.detailedOutlines.get(id)
        if (!current || !await assertRecordInScope(scope, 'detailedOutlines', current, { owner: 'work' })) return
        const updated = { ...patch, updatedAt: now() }
        if (patch.scenes !== undefined) normalizeDetailedScenes(patch.scenes)
        await db.detailedOutlines.update(id, updated)
        set({
          detailedOutlines: get().detailedOutlines.map(d =>
            d.id === id ? { ...d, ...updated } : d
          ),
        })
      },
    })
  },

  editScene: async (id, edit, scopeInput, chapterSummary) => {
    await coordinatePendingEditV1({
      key: `detailed-outline:${id}`,
      persist: async () => {
        const scope = await resolveScopeLike(scopeInput)
        const updated = await db.transaction('rw', scopeTransactionTables(db.detailedOutlines, db.outlineNodes), async () => {
          const row = await db.detailedOutlines.get(id)
          if (!row || !await assertRecordInScope(scope, 'detailedOutlines', row, { owner: 'work' })) throw new Error('细纲已删除或不属于指定作品，编辑未写入')
          const node = await db.outlineNodes.get(row.outlineNodeId)
          if (!node || node.type !== 'chapter' || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' })) throw new Error('细纲的章纲目标无效，编辑未写入')
          const scenes = normalizeDetailedScenes(row.scenes)
          let next: DetailedScene[]
          if (edit.kind === 'add') {
            if (!edit.scene.sceneId || scenes.some(scene => scene.sceneId === edit.scene.sceneId)) throw new Error('新增场景标识无效或重复')
            next = [...scenes, edit.scene]
          } else {
            if (!scenes.some(scene => scene.sceneId === edit.sceneId)) throw new Error('场景已变化或删除，编辑未写入')
            if (edit.kind === 'patch' && 'sceneId' in edit.patch) throw new Error('场景编辑不能改变稳定标识')
            next = edit.kind === 'remove' ? scenes.filter(scene => scene.sceneId !== edit.sceneId) : scenes.map(scene => scene.sceneId === edit.sceneId ? { ...scene, ...edit.patch } : scene)
          }
          normalizeDetailedScenes(next)
          const data = { scenes: next, lastUsedSummary: row.lastUsedSummary ?? chapterSummary, updatedAt: now() }
          await db.detailedOutlines.update(id, data)
          return data
        })
        set({ detailedOutlines: get().detailedOutlines.map(row => row.id === id ? { ...row, ...updated } : row) })
      },
    })
  },

  remove: async (id) => {
    const current = get().detailedOutlines.find(d => d.id === id) ?? await db.detailedOutlines.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'detailedOutlines', current, { owner: 'work' })) return
    await db.detailedOutlines.delete(id)
    set({ detailedOutlines: get().detailedOutlines.filter(d => d.id !== id) })
  },
}))
