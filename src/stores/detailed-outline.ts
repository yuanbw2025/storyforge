import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { DetailedOutline } from '../lib/types'
import { normalizeDetailedScenes } from '../lib/types/detailed-outline'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

interface DetailedOutlineStore {
  detailedOutlines: DetailedOutline[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  /** 获取或创建某章节的细纲 */
  getOrCreate: (scope: WorkspaceScopeLike, outlineNodeId: number) => Promise<DetailedOutline>
  save: (id: number, patch: Partial<DetailedOutline>) => Promise<void>
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

  save: async (id, patch) => {
    const current = get().detailedOutlines.find(d => d.id === id) ?? await db.detailedOutlines.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'detailedOutlines', current, { owner: 'work' })) return
    const updated = { ...patch, updatedAt: now() }
    await db.detailedOutlines.update(id, updated)
    set({
      detailedOutlines: get().detailedOutlines.map(d =>
        d.id === id ? { ...d, ...updated } : d
      ),
    })
  },

  remove: async (id) => {
    const current = get().detailedOutlines.find(d => d.id === id) ?? await db.detailedOutlines.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'detailedOutlines', current, { owner: 'work' })) return
    await db.detailedOutlines.delete(id)
    set({ detailedOutlines: get().detailedOutlines.filter(d => d.id !== id) })
  },
}))
