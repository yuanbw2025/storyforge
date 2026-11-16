/**
 * Store 工厂集合
 * ------------------------------------------------------------
 * 抽出"项目级单例 store"的公共样板 —— 即每个 project 对应
 * 一条记录的 Dexie 表所对应的 store（geography / history /
 * itemSystem / creativeRules 等）。
 *
 * 调用方仍然使用 `create` 返回的 hook，API 与原手写 store 100%
 * 一致：`{ [key]: T | null, loading, loadAll(projectId), save(data) }`。
 */

import { create } from 'zustand'
import type { Table, UpdateSpec } from 'dexie'
import type { WorkspaceScope } from '../lib/types'
import { db } from '../lib/db/schema'
import { assertRecordInScope, getTableSpec, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

const now = () => Date.now()

/** 项目级单例记录的最小形状 */
interface ProjectScopedRecord {
  id?: number
  projectId: number
  createdAt: number
  updatedAt: number
}

/**
 * `db` 实例里所有"值为 Dexie Table"的键，用来约束 table 参数
 * 必须是数据库里真实存在的表。
 */
type DbTableKey = {
  [K in keyof typeof db]: (typeof db)[K] extends Table<infer _U, any> ? K : never
}[keyof typeof db]

/**
 * 单例 store 的公共状态 & 动作
 * - `K` 是暴露给 UI 的字段名（例如 `'geography'`）
 * - `T` 是记录类型（例如 `Geography`）
 */
export type ProjectSingletonStore<K extends string, T extends ProjectScopedRecord> = {
  loading: boolean
  loadError: string | null
  loadedScope: WorkspaceScope | null
  /** 当前加载的世界组（null = 单世界 / 未指定，Phase 25.4） */
  activeWorldGroupId: number | null
  loadAll: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>
  save: (data: Partial<T>, scope?: WorkspaceScopeLike) => Promise<void>
} & { [P in K]: T | null }

interface FactoryOptions<K extends string, T extends ProjectScopedRecord> {
  /** Dexie 表名，例如 `'geographies'` */
  table: DbTableKey
  /** 暴露到 store state 的字段名，例如 `'geography'` */
  key: K
  /** 新建记录时用到的默认字段（不含 id/projectId/createdAt/updatedAt） */
  defaults: Omit<T, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
}

/**
 * 创建"一个项目对应一条记录"的 Zustand store。
 *
 * 行为语义与原 4 个手写 store 保持一致：
 * - `loadAll(projectId)`：按 projectId 取唯一一条记录，写入 state
 * - `save(data)`：
 *    - 已有记录 → `update(id, { ...data, updatedAt })`
 *    - 没记录但传了 `projectId` → 用 defaults + data `add(...)`，拿回 id 回填 state
 */
export function createProjectSingletonStore<K extends string, T extends ProjectScopedRecord>(
  options: FactoryOptions<K, T>,
) {
  const { table, key, defaults } = options
  // 必要的强转：TS 无法从字符串 key 静态推导出 `db[table]` 的元素类型，
  // 但运行时 Dexie 会保证 table 里存的是 T。调用方在 `table` 字段上受
  // `DbTableKey` 约束，不会传错表名；记录类型交给返回类型控制。
  const getTable = () => (db as unknown as Record<string, Table<T, number>>)[table]

  type State = ProjectSingletonStore<K, T>

  return create<State>((set, get) => {
    let loadRequest = 0
    const sameScope = (left: WorkspaceScope | null, right: WorkspaceScope) =>
      left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
    const initialState = {
      [key]: null,
      loading: false,
      loadError: null,
      loadedScope: null,
      activeWorldGroupId: null,
    } as unknown as State

    return {
      ...initialState,

      loadAll: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
        const request = ++loadRequest
        set({ loading: true, loadError: null, loadedScope: null, activeWorldGroupId: worldGroupId } as Partial<State> as State)
        try {
          const scope = await resolveScopeLike(scopeInput)
          const owner = getTableSpec(String(table)).domainOwner?.defaultOwner
          const scopedRows = await readOwnedRows<T>(scope, String(table), {
            owner: owner === 'world' || owner === 'work' ? owner : undefined,
          })
          // Retain the existing single-world first-row selection contract.
          const record = worldGroupId == null ? scopedRows[0]
            : scopedRows.find(r => (r as { worldGroupId?: number | null }).worldGroupId === worldGroupId)
          if (request === loadRequest) set({ [key]: record ?? null, loadedScope: scope } as unknown as Partial<State> as State)
        } catch (cause) {
          if (request === loadRequest) set({ loadError: cause instanceof Error ? cause.message : String(cause) } as Partial<State> as State)
          throw cause
        } finally {
          if (request === loadRequest) set({ loading: false } as Partial<State> as State)
        }
      },

      save: async (input: Partial<T>, targetScope?: WorkspaceScopeLike) => {
        const data = { ...input }
        const state = get()
        const memoryCurrent = (state as unknown as Record<string, T | null>)[key]
        const spec = getTableSpec(String(table))
        const suppliedGroup = (data as { worldGroupId?: number | null }).worldGroupId
        const groupId = spec.worldScoped ? (suppliedGroup !== undefined ? suppliedGroup : state.activeWorldGroupId) : null
        const pendingProjectId = data.projectId ?? (memoryCurrent as { projectId?: number } | null)?.projectId
        if (pendingProjectId == null) throw new Error('单例保存缺少工作区')
        // Start scope resolution before queue admission, never after a later owner switch.
        const scopeInput = typeof targetScope === 'object' ? { ...targetScope } : targetScope ?? pendingProjectId
        const scopePromise = resolveScopeLike(scopeInput)
        void scopePromise.catch(() => undefined)
        const request = loadRequest
        const owner = spec.domainOwner?.defaultOwner
        const ownerField = owner === 'world' ? 'worldId' : owner === 'work' ? 'workId' : 'projectId'
        const writeForOwner = (target: WorkspaceScope) => coordinatePendingEditV1({
          key: `project-singleton:${String(table)}:${pendingProjectId}:${target[ownerField]}:${groupId ?? 'default'}`,
          persist: async () => {
            const projectId = pendingProjectId
            const scope = await scopePromise
            if (scope.projectId !== projectId) throw new Error('单例保存目标与工作区作用域不一致')
            if (groupId != null && !await assertRecordInScope(scope, 'worldGroups', await db.worldGroups.get(groupId), { owner: 'world' })) {
              throw new Error('单例保存世界组不属于指定作用域')
            }
            const publish = (record: T) => {
              const current = get()
              if (request === loadRequest && !current.loading && sameScope(current.loadedScope, scope)
                && (current.activeWorldGroupId === groupId
                  || (current.activeWorldGroupId == null && memoryCurrent?.id === record.id))) {
                set({ [key]: record } as unknown as Partial<State> as State)
              }
            }
            // 缓存只能供界面展示；每次写入都从指定 owner 作用域定位真实单例。
            const all = await readOwnedRows<T>(scope, String(table), {
              owner: owner === 'world' || owner === 'work' ? owner : undefined,
            })
            const current = (groupId == null
              ? (all.find(r => ((r as { worldGroupId?: number | null }).worldGroupId ?? null) === null) ?? all[0])
              : all.find(r => (r as { worldGroupId?: number | null }).worldGroupId === groupId)) ?? null
            if (data.id != null && data.id !== current?.id) {
              throw new Error('单例保存记录不属于指定作用域')
            }
            if (ownerField !== 'projectId') {
              const supplied = (data as Record<string, unknown>)[ownerField]
              if (supplied != null && supplied !== scope[ownerField]) {
                throw new Error('单例保存不能更改数据 owner')
              }
            }

            if (current?.id) {
              const ts = now()
              const written = await getTable().update(
                current.id,
                { ...data, updatedAt: ts } as UpdateSpec<T>,
              )
              if (!written) throw new Error('单例保存目标已不存在，请重新读取')
              publish({ ...current, ...data, updatedAt: ts })
              return
            }

            if (data.projectId) {
              const ts = now()
              const toInsert = stampNewRecord(scope, String(table), {
                ...(defaults as object),
                projectId: data.projectId,
                // 多世界模式下盖章当前世界组（单世界时为 null，不影响）
                ...(groupId != null ? { worldGroupId: groupId } : {}),
                createdAt: ts,
                updatedAt: ts,
                ...data,
              } as T, {
                owner: owner === 'world' ? 'world' : 'work',
              })
              const id = (await getTable().add(toInsert)) as number
              publish({ ...toInsert, id })
            }
          },
        })
        // Admit in call order even when a numeric project must first read its active pointers.
        // The lookup slot only awaits registration. Actual write failures belong to the owner slot.
        const admitted = await coordinatePendingEditV1({
          key: `project-singleton-lookup:${String(table)}:${pendingProjectId}`,
          persist: async () => ({ write: writeForOwner(typeof scopeInput === 'number' ? await scopePromise : scopeInput) }),
        })
        await admitted.write
      },
    }
  })
}
