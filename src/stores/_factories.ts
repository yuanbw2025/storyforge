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
import Dexie, { type Table, type Transaction, type UpdateSpec } from 'dexie'
import type { History, WorkspaceScope, WorldOwnerScope } from '../lib/types'
import {
  copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1, copyHistoryTextPatchV1,
  historyAuthorRecordV1, HISTORY_TEXT_DEFAULTS_V1,
  type HistoryAuthorOriginV1, type HistoryAuthorPartitionV1, type HistoryAuthorSelectionV1, type HistoryTextPatchV1,
} from '../lib/types/history'
import { db } from '../lib/db/schema'
import { assertRecordInScope, getTableSpec, readOwnedRows, readOwnedRowsInTransactionV1, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { resolveHistoryWorkAuthorScopeV1, resolveWorldAuthoringOwnershipV1 } from '../lib/workspace/ownership'
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

export interface HistoryAuthorSingletonStateV1 {
  loadedHistoryAuthorOrigin: HistoryAuthorOriginV1 | null
  loadedHistoryAuthorSelection: HistoryAuthorSelectionV1 | null
  loadForHistoryAuthorV1: (input: { origin: HistoryAuthorOriginV1; selection: HistoryAuthorSelectionV1 }) => Promise<void>
  saveForHistoryAuthorV1: (input: { origin: HistoryAuthorOriginV1; selection: HistoryAuthorPartitionV1; patch: HistoryTextPatchV1 }) => Promise<void>
}

interface FactoryOptions<K extends string, T extends ProjectScopedRecord, HistoryAuthoring extends boolean> {
  /** Dexie 表名，例如 `'geographies'` */
  table: DbTableKey
  /** 暴露到 store state 的字段名，例如 `'geography'` */
  key: K
  /** 新建记录时用到的默认字段（不含 id/projectId/createdAt/updatedAt） */
  defaults: Omit<T, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
  /** Only the history singleton opts in; existing factory callers keep their API. */
  historyAuthoring?: HistoryAuthoring
}

function historyRootTransactionV1(): Transaction | undefined {
  let transaction = Dexie.currentTransaction
  while (transaction?.parent) transaction = transaction.parent
  return transaction?.db === db && transaction.mode === 'readwrite' && transaction.active ? transaction : undefined
}

function historyRootCompletionV1(root: Transaction): Promise<void> {
  const completion = new Dexie.Promise<void>((resolve, reject) => {
    root.on('complete', resolve)
    root.on('abort', () => reject(root.idbtrans.error ?? new Error('历史保存的原事务已回滚')))
  })
  void completion.catch(() => undefined)
  return completion
}

function assertHistoryTransactionV1(transaction: Transaction, native: IDBTransaction, tables: readonly Table[], write = false): void {
  let root = transaction
  while (root.parent) root = root.parent
  if (transaction.db !== db || !transaction.active || !native || transaction.idbtrans !== native
    || root.db !== db || !root.active || root.idbtrans !== native || (write && transaction.mode !== 'readwrite')
    || tables.some(table => !transaction.storeNames.includes(table.name) || !native.objectStoreNames.contains(table.name))) {
    throw new Error('历史保存或读取的原事务已失效或缺少作用域表')
  }
  const current = Dexie.currentTransaction
  if (current && (current.db !== db || current.idbtrans !== native)) throw new Error('历史保存或读取的原事务已变化')
}

function sameHistoryOriginV1(left: HistoryAuthorOriginV1, right: HistoryAuthorOriginV1): boolean {
  return left.kind === right.kind && left.scope.projectId === right.scope.projectId && left.scope.worldId === right.scope.worldId
    && (left.kind !== 'work' || right.kind === 'work' && left.scope.workId === right.scope.workId)
}

function sameHistorySelectionV1(left: HistoryAuthorSelectionV1, right: HistoryAuthorSelectionV1): boolean {
  return left.kind === right.kind && (left.kind === 'all' || right.kind === 'partition' && left.worldGroupId === right.worldGroupId)
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
export function createProjectSingletonStore<K extends string, T extends ProjectScopedRecord, HistoryAuthoring extends boolean = false>(
  options: FactoryOptions<K, T, HistoryAuthoring>,
) {
  const { table, key, defaults } = options
  const historyAuthoring = options.historyAuthoring === true
  if (historyAuthoring && (table !== 'histories' || key !== 'history')) throw new Error('历史作者接口只允许历史单例启用')
  // 必要的强转：TS 无法从字符串 key 静态推导出 `db[table]` 的元素类型，
  // 但运行时 Dexie 会保证 table 里存的是 T。调用方在 `table` 字段上受
  // `DbTableKey` 约束，不会传错表名；记录类型交给返回类型控制。
  const getTable = () => (db as unknown as Record<string, Table<T, number>>)[table]

  type State = ProjectSingletonStore<K, T> & (HistoryAuthoring extends true ? HistoryAuthorSingletonStateV1 : unknown)

  return create<State>((set, get) => {
    let loadRequest = 0
    let historyView: { request: number; origin: HistoryAuthorOriginV1; selection: HistoryAuthorSelectionV1 } | null = null
    const historyAdmissions = new Map<number, Promise<void>>()
    // Reserve registration order at API invocation, before a legacy numeric
    // scope can finish resolving. A slot waits only for target registration,
    // never for its write/parent commit. Keep the legacy pending lookup slot
    // separate: a named call must not acknowledge its unresolved Work failure.
    const admitHistoryWrite = (projectId: number, register: () => Promise<{ write: Promise<void> }>) => {
      const previous = historyAdmissions.get(projectId) ?? Promise.resolve()
      const admitted = Dexie.Promise.resolve(previous).catch(() => undefined).then(register)
      const tail = admitted.then(() => undefined, () => undefined)
      historyAdmissions.set(projectId, tail)
      void tail.then(() => { if (historyAdmissions.get(projectId) === tail) historyAdmissions.delete(projectId) })
      return admitted
    }
    const sameScope = (left: WorkspaceScope | null, right: WorkspaceScope) =>
      left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
    const initialState = {
      [key]: null,
      loading: false,
      loadError: null,
      loadedScope: null,
      activeWorldGroupId: null,
      ...(historyAuthoring ? { loadedHistoryAuthorOrigin: null, loadedHistoryAuthorSelection: null } : {}),
    } as unknown as State

    const authorTables = (origin: HistoryAuthorOriginV1): Table[] => [
      db.projects, db.worlds, db.worldGroups, db.histories, ...(origin.kind === 'work' ? [db.works] : []),
    ]
    const resolveAuthor = (origin: HistoryAuthorOriginV1, transaction: Transaction): Promise<WorldOwnerScope> => {
      if (origin.kind === 'world') return resolveWorldAuthoringOwnershipV1(origin.scope, transaction).then(result => result.scope)
      return resolveHistoryWorkAuthorScopeV1(origin.scope, transaction)
    }
    const readAuthorPartition = (origin: HistoryAuthorOriginV1, selection: HistoryAuthorSelectionV1, transaction: Transaction): Promise<{ scope: WorldOwnerScope; record: History | null }> => {
      const native = transaction.idbtrans
      const check = () => assertHistoryTransactionV1(transaction, native, authorTables(origin))
      check()
      return resolveAuthor(origin, transaction).then(scope => {
        check()
        if (selection.kind === 'all') return { scope, record: null }
        const groupId = selection.worldGroupId
        const group = groupId == null ? Dexie.Promise.resolve(true)
          : readOwnedRowsInTransactionV1<{ id?: number }>(transaction, scope, 'worldGroups', { owner: 'world' })
            .then(groups => groups.some(row => row.id === groupId))
        return group.then(valid => {
          check()
          if (!valid) throw new Error('历史分区不属于指定 World')
          return readOwnedRowsInTransactionV1<History>(transaction, scope, 'histories', { owner: 'world' }).then(rows => {
            check()
            const matches = rows.filter(row => (row.worldGroupId ?? null) === groupId)
            if (matches.length > 1) throw new Error('该历史分区有多条单例记录，请先核对原始数据')
            return { scope, record: matches[0] ?? null }
          })
        })
      })
    }
    const readCommittedAuthor = (origin: HistoryAuthorOriginV1, selection: HistoryAuthorSelectionV1) =>
      db.transaction('r', authorTables(origin), () => {
        const transaction = Dexie.currentTransaction
        if (!transaction) throw new Error('历史读取缺少原事务')
        // Every helper returns the Dexie chain; no native async bridge can let
        // the original native transaction finish between owner and row reads.
        return readAuthorPartition(origin, selection, transaction).then(result => result.record)
      })
    const ownsAuthorView = (request: number, origin: HistoryAuthorOriginV1, selection: HistoryAuthorSelectionV1) =>
      request === loadRequest && historyView?.request === request
      && sameHistoryOriginV1(historyView.origin, origin) && sameHistorySelectionV1(historyView.selection, selection)
    const publishAuthor = (request: number, origin: HistoryAuthorOriginV1, selection: HistoryAuthorSelectionV1, record: History | null) => {
      if (!ownsAuthorView(request, origin, selection)) return
      set({
        [key]: record, loading: false, loadError: null,
        loadedScope: origin.kind === 'work' ? { ...origin.scope } : null,
        activeWorldGroupId: selection.kind === 'partition' ? selection.worldGroupId : null,
        loadedHistoryAuthorOrigin: copyHistoryAuthorOriginV1(origin),
        loadedHistoryAuthorSelection: copyHistoryAuthorSelectionV1(selection),
      } as unknown as Partial<State>)
    }
    const failAuthorLoad = (request: number, error: unknown) => {
      if (request === loadRequest) set({ loading: false, loadedScope: null,
        loadedHistoryAuthorOrigin: null, loadError: error instanceof Error ? error.message : String(error) } as unknown as Partial<State>)
    }
    const authorActions: HistoryAuthorSingletonStateV1 = {
      loadedHistoryAuthorOrigin: null,
      loadedHistoryAuthorSelection: null,
      loadForHistoryAuthorV1: input => {
        try {
          historyAuthorRecordV1(input, ['origin', 'selection'], '读取')
          const origin = copyHistoryAuthorOriginV1(input.origin)
          const selection = copyHistoryAuthorSelectionV1(input.selection)
          const prior = historyView
          const preserve = prior && sameHistoryOriginV1(prior.origin, origin) && sameHistorySelectionV1(prior.selection, selection)
          const request = ++loadRequest
          historyView = { request, origin, selection }
          set({ loading: true, loadError: null, loadedScope: null, loadedHistoryAuthorOrigin: null,
            loadedHistoryAuthorSelection: copyHistoryAuthorSelectionV1(selection), ...(!preserve ? { [key]: null } : {}) } as unknown as Partial<State>)
          const root = historyRootTransactionV1()
          const completion = root ? historyRootCompletionV1(root) : null
          return readCommittedAuthor(origin, selection).then(record => {
            if (completion) {
              void completion.then(() => Dexie.ignoreTransaction(() => readCommittedAuthor(origin, selection))).then(committed => {
                publishAuthor(request, origin, selection, committed)
              }).catch(error => failAuthorLoad(request, error))
            } else publishAuthor(request, origin, selection, record)
          }).catch(error => { failAuthorLoad(request, error); throw error })
        } catch (error) { return Dexie.Promise.reject(error) }
      },
      saveForHistoryAuthorV1: input => {
        try {
          historyAuthorRecordV1(input, ['origin', 'selection', 'patch'], '保存')
          const origin = copyHistoryAuthorOriginV1(input.origin)
          const selection = copyHistoryAuthorSelectionV1(input.selection)
          if (selection.kind !== 'partition') throw new Error('历史一览为只读，不能保存')
          const patch = copyHistoryTextPatchV1(input.patch)
          const tables = authorTables(origin)
          const ambient = Dexie.currentTransaction
          if (ambient && (ambient.db !== db || ambient.mode !== 'readwrite' || !ambient.active
            || tables.some(table => !ambient.storeNames.includes(table.name)))) throw new Error('历史保存缺少原写事务或完整作用域表')
          const native = ambient?.idbtrans
          const root = historyRootTransactionV1()
          const completion = root ? historyRootCompletionV1(root) : null
          const request = loadRequest
          const targetKey = `project-singleton:histories:${origin.scope.projectId}:${origin.scope.worldId}:${selection.worldGroupId ?? 'default'}`
          const persist = () => {
            // A captured caller transaction must not turn into a detached write.
            if (ambient && native) assertHistoryTransactionV1(ambient, native, tables, true)
            const write = (transaction: Transaction) => {
              const originalNative = transaction.idbtrans
              const check = () => assertHistoryTransactionV1(transaction, originalNative, tables, true)
              check()
              return readAuthorPartition(origin, selection, transaction).then(({ scope, record: current }) => {
                check()
                const history = transaction.table<History, number>(getTableSpec('histories').table.name)
                const ts = now()
                if (current?.id != null) {
                  return history.update(current.id, { ...patch, updatedAt: ts }).then(written => {
                    check()
                    if (!written) throw new Error('历史保存目标已不存在')
                  })
                }
                return history.add(stampNewRecord(scope, 'histories', {
                  ...HISTORY_TEXT_DEFAULTS_V1, ...patch, projectId: scope.projectId, worldGroupId: selection.worldGroupId,
                  createdAt: ts, updatedAt: ts,
                }, { owner: 'world' })).then(() => { check() })
              })
            }
            if (ambient) return write(ambient)
            return db.transaction('rw', tables, () => {
              const transaction = Dexie.currentTransaction
              if (!transaction) throw new Error('历史保存缺少原事务')
              return write(transaction)
            })
          }
          // Serialize the formal target across both APIs. A separate fieldset
          // identity keeps another field's success from acknowledging failed text.
          const admitted = admitHistoryWrite(origin.scope.projectId, () => Dexie.Promise.resolve({
            write: coordinatePendingEditV1({ key: targetKey, persist }),
          }))
          const written = admitted.then(slot => slot.write)
          const committed = written.then(() => completion ?? Dexie.Promise.resolve())
            .then(() => Dexie.ignoreTransaction(() => readCommittedAuthor(origin, selection))).then(record => {
              publishAuthor(request, origin, selection, record)
            })
          void committed.catch(() => undefined)
          const pending = coordinatePendingEditV1({ key: `history-author-fields:${targetKey}:${Object.keys(patch).sort().join('+')}`, persist: () => committed })
          // Parent code must be able to continue and commit/abort. Its completion
          // remains registered with the pending-edit barrier independently.
          return root ? written : pending
        } catch (error) { return Dexie.Promise.reject(error) }
      },
    }

    return {
      ...initialState,

      loadAll: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
        const request = ++loadRequest
        historyView = null
        set({ loading: true, loadError: null, loadedScope: null, activeWorldGroupId: worldGroupId,
          ...(historyAuthoring ? { loadedHistoryAuthorOrigin: null, loadedHistoryAuthorSelection: null } : {}) } as Partial<State> as State)
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
              if (request === loadRequest && historyView === null && !current.loading && sameScope(current.loadedScope, scope)
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
        const register = async () => ({ write: writeForOwner(typeof scopeInput === 'number' ? await scopePromise : scopeInput) })
        const historyAdmission = historyAuthoring ? admitHistoryWrite(pendingProjectId, register) : null
        const admitted = await coordinatePendingEditV1({
          key: `project-singleton-lookup:${String(table)}:${pendingProjectId}`,
          persist: () => historyAdmission ?? register(),
        })
        await admitted.write
      },
      ...(historyAuthoring ? authorActions : {}),
    } as State
  })
}
