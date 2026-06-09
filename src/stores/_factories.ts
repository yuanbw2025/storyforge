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
import { db } from '../lib/db/schema'

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
  /** 当前加载的世界组（null = 单世界 / 未指定，Phase 25.4） */
  activeWorldGroupId: number | null
  loadAll: (projectId: number, worldGroupId?: number | null) => Promise<void>
  save: (data: Partial<T>) => Promise<void>
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
    const initialState = {
      [key]: null,
      loading: false,
      activeWorldGroupId: null,
    } as unknown as State

    return {
      ...initialState,

      loadAll: async (projectId: number, worldGroupId: number | null = null) => {
        set({ loading: true, activeWorldGroupId: worldGroupId } as unknown as Partial<State> as State)
        let record: T | undefined
        if (worldGroupId == null) {
          // 单世界 / 未指定：取第一条
          record = await getTable().where('projectId').equals(projectId).first()
        } else {
          // 多世界：取匹配该世界组的记录
          const all = await getTable().where('projectId').equals(projectId).toArray()
          record = all.find(r => (r as { worldGroupId?: number | null }).worldGroupId === worldGroupId)
        }
        set({ [key]: record ?? null, loading: false } as unknown as Partial<State> as State)
      },

      save: async (data: Partial<T>) => {
        const state = get()
        let current = (state as unknown as Record<string, T | null>)[key]
        const activeWorldGroupId = (state as unknown as { activeWorldGroupId: number | null }).activeWorldGroupId

        // 以 DB 为准定位既有记录，避免内存为 null/陈旧时误新增重复记录
        // （与 saveWorldview 同类修复：单例表应每 (projectId, worldGroupId) 仅一条）
        const projectId = data.projectId ?? (current as { projectId?: number } | null)?.projectId
        if (!current?.id && projectId != null) {
          const all = await getTable().where('projectId').equals(projectId).toArray()
          current = (activeWorldGroupId == null
            ? (all.find(r => ((r as { worldGroupId?: number | null }).worldGroupId ?? null) === null) ?? all[0])
            : all.find(r => (r as { worldGroupId?: number | null }).worldGroupId === activeWorldGroupId)) ?? null
        }

        if (current?.id) {
          const ts = now()
          await getTable().update(
            current.id,
            { ...data, updatedAt: ts } as UpdateSpec<T>,
          )
          set({
            [key]: { ...current, ...data, updatedAt: ts },
          } as unknown as Partial<State> as State)
          return
        }

        if (data.projectId) {
          const ts = now()
          const toInsert = {
            ...(defaults as object),
            projectId: data.projectId,
            // 多世界模式下盖章当前世界组（单世界时为 null，不影响）
            ...(activeWorldGroupId != null ? { worldGroupId: activeWorldGroupId } : {}),
            createdAt: ts,
            updatedAt: ts,
            ...data,
          } as T
          const id = (await getTable().add(toInsert)) as number
          set({
            [key]: { ...toInsert, id },
          } as unknown as Partial<State> as State)
        }
      },
    }
  })
}
