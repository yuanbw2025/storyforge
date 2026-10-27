import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Worldview, StoryCore, PowerSystem, WorkspaceScope, DivineDesign, NaturalResources } from '../lib/types'
import { EMPTY_DIVINE_DESIGN, EMPTY_NATURAL_RESOURCES } from '../lib/types/worldview'
import type { AdoptResult } from '../lib/registry/types'
import { adopt } from '../lib/registry/adopt'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

export type WorldviewAuthorPatch = Partial<Omit<Worldview, 'divineDesign' | 'naturalResources'>> & {
  divineDesign?: Partial<DivineDesign>
  naturalResources?: Partial<NaturalResources>
}

interface WorldviewStore {
  worldview: Worldview | null
  storyCore: StoryCore | null
  powerSystem: PowerSystem | null
  loading: boolean
  loadedProjectId: number | null
  loadedScope: WorkspaceScope | null
  /** 当前加载的世界组（null = 单世界模式 / 未指定） */
  activeWorldGroupId: number | null

  loadAll: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>

  saveWorldview: (data: WorldviewAuthorPatch) => Promise<void>
  saveStoryCore: (data: Partial<StoryCore>) => Promise<void>
  savePowerSystem: (data: Partial<PowerSystem>) => Promise<void>
}

const now = () => Date.now()
let worldviewLoadRequest = 0

function captureScope(projectId: number) {
  const promise = resolveScopeLike(projectId)
  // Queue admission can precede execution. Observe early read failure while
  // retaining the rejected promise for the writer/navigation barrier.
  void promise.catch(() => undefined)
  return promise
}

function sameScope(left: WorkspaceScope | null, right: WorkspaceScope) {
  return left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
}

function requireWritten(result: AdoptResult, fields: string[]) {
  if (result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length
    || fields.some(field => !result.written.some(row => row.fields.includes(field)))) {
    throw new Error(`编辑未保存：${result.typeErrors[0]?.got || result.skipped[0]?.reason || (result.unknown.length ? '包含未登记字段' : '字段未写入')}`)
  }
}

function mergeAuthorWorldviewObjects(current: Worldview | undefined, patch: Record<string, unknown>) {
  for (const [field, defaults] of [['divineDesign', EMPTY_DIVINE_DESIGN], ['naturalResources', EMPTY_NATURAL_RESOURCES]] as const) {
    const delta = patch[field]
    if (delta === undefined) continue
    const before = current?.[field]
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)
      || Object.entries(delta).some(([key, value]) => !Object.prototype.hasOwnProperty.call(defaults, key)
        || typeof value !== typeof (defaults as Record<string, unknown>)[key])) {
      throw new Error(`编辑未保存：${field} 子项格式无效`)
    }
    if (before != null && (typeof before !== 'object' || Array.isArray(before)
      || Object.entries(defaults).some(([key, value]) => Object.prototype.hasOwnProperty.call(before, key)
        && typeof (before as unknown as Record<string, unknown>)[key] !== typeof value))) {
      throw new Error(`编辑未保存：已有 ${field} 数据格式无效，请先恢复数据`)
    }
    patch[field] = { ...defaults, ...before, ...delta }
  }
  return patch
}

export const useWorldviewStore = create<WorldviewStore>((set, get) => ({
  worldview: null,
  storyCore: null,
  powerSystem: null,
  loading: false,
  loadedProjectId: null,
  loadedScope: null,
  activeWorldGroupId: null,

  loadAll: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
    const request = ++worldviewLoadRequest
    set({ loading: true, activeWorldGroupId: worldGroupId })
    const scope = await resolveScopeLike(scopeInput)
    if (request !== worldviewLoadRequest) return
    set({ loadedProjectId: scope.projectId, loadedScope: scope })
    const [wvList, sc, psList] = await Promise.all([
      readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }),
      readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }).then(rows => rows[0]),
      readOwnedRows<PowerSystem>(scope, 'powerSystems', { owner: 'world' }),
    ])
    if (request !== worldviewLoadRequest || get().loadedProjectId !== scope.projectId || get().activeWorldGroupId !== worldGroupId) return
    // 单世界模式（worldGroupId == null）：取第一条
    // 多世界模式：取匹配该世界组的记录
    const wv = worldGroupId == null
      ? wvList.find(w => w.worldGroupId == null)
      : wvList.find(w => w.worldGroupId === worldGroupId)
    const ps = psList.find(p => (p.worldGroupId ?? null) === worldGroupId)
    set({
      worldview: wv ?? null,
      storyCore: sc || null,   // 故事核心归当前作品，不分世界组
      powerSystem: ps || null,
      loading: false,
    })
  },

  saveWorldview: (data: WorldviewAuthorPatch) => {
    const { worldview, activeWorldGroupId } = get()
    const projectId = data.projectId ?? worldview?.projectId
    if (projectId == null) return Promise.reject(new Error('编辑未保存：缺少工作区'))
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, worldGroupId, ...patch } = data
    const targetWorldGroupId = worldGroupId !== undefined ? worldGroupId : activeWorldGroupId
    const scopePromise = captureScope(projectId)
    return coordinatePendingEditV1({
      key: `worldview:${projectId}:${targetWorldGroupId ?? 'default'}`,
      persist: async () => {
        const scope = await scopePromise
        const list = await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' })
        const target = list.find(row => (row.worldGroupId ?? null) === targetWorldGroupId)
        const merged = mergeAuthorWorldviewObjects(target, { ...patch })
        const result = await adopt({
          projectId, scope, worldGroupId: targetWorldGroupId, target: 'worldviews', mode: 'replace',
          ...(target?.id != null ? { recordId: target.id, preserveAuthorText: true } : {}),
          data: merged,
        })
        requireWritten(result, Object.keys(merged))
        const next = (await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }))
          .find(row => (row.worldGroupId ?? null) === targetWorldGroupId) ?? null
        const current = get()
        if (sameScope(current.loadedScope, scope) && current.activeWorldGroupId === targetWorldGroupId) set({ worldview: next })
      },
    })
  },

  saveStoryCore: (data: Partial<StoryCore>) => {
    const { storyCore } = get()
    const projectId = data.projectId ?? storyCore?.projectId
    if (projectId == null) return Promise.reject(new Error('编辑未保存：缺少工作区'))
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, ...patch } = data
    const scopePromise = captureScope(projectId)
    return coordinatePendingEditV1({
      key: `story-core:${projectId}`,
      persist: async () => {
        const scope = await scopePromise
        const target = (await readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }))[0]
        const result = await adopt({
          projectId, scope, target: 'storyCores', mode: 'replace',
          ...(target?.id != null ? { recordId: target.id, preserveAuthorText: true } : {}),
          data: patch as Record<string, unknown>,
        })
        requireWritten(result, Object.keys(patch))
        const next = (await readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }))[0] ?? null
        if (sameScope(get().loadedScope, scope)) set({ storyCore: next })
      },
    })
  },

  savePowerSystem: (data: Partial<PowerSystem>) => {
    const { powerSystem, activeWorldGroupId } = get()
    const projectId = data.projectId ?? powerSystem?.projectId
    if (projectId == null) return Promise.resolve()
    const worldGroupId = data.worldGroupId !== undefined ? data.worldGroupId : activeWorldGroupId
    // Capture scope and field patch before the queued write; never borrow a newly
    // selected project's/group's record from the global store inside persist().
    const patch = Object.fromEntries(
      (['name', 'description', 'levels', 'rules'] as const)
        .filter(field => data[field] !== undefined).map(field => [field, data[field]]),
    )
    if (!Object.keys(patch).length) return Promise.resolve()
    const scopePromise = captureScope(projectId)
    return coordinatePendingEditV1({
      key: `power-system:${projectId}:${worldGroupId ?? 'default'}`,
      persist: async () => {
        const scope = await scopePromise
        const list = await readOwnedRows<PowerSystem>(scope, 'powerSystems', { owner: 'world' })
        const target = list.find(row => (row.worldGroupId ?? null) === worldGroupId)
        let next: PowerSystem
        if (target?.id) {
          const updatedAt = now()
          await db.powerSystems.update(target.id, { ...patch, updatedAt })
          await refreshSettingAssertionSourceStatus({
            projectId, table: 'powerSystems', recordId: target.id,
            changedFields: Object.keys(patch),
          })
          next = { ...target, ...patch, updatedAt }
        } else {
          const row = stampNewRecord(scope, 'powerSystems', {
            projectId, name: '', description: '', levels: '', rules: '',
            ...patch, worldGroupId, createdAt: now(), updatedAt: now(),
          }, { owner: 'world' }) as PowerSystem
          const id = await db.powerSystems.add(row)
          next = { ...row, id: id as number }
        }
        const current = get()
        if (current.activeWorldGroupId === worldGroupId
          && sameScope(current.loadedScope, scope)) {
          set({ powerSystem: next })
        }
      },
    })
  },
}))
