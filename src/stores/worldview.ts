import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Worldview, StoryCore, PowerSystem, DivineDesign, NaturalResources } from '../lib/types'
import { adopt } from '../lib/registry/adopt'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/world-engine/scope'

interface WorldviewStore {
  worldview: Worldview | null
  storyCore: StoryCore | null
  powerSystem: PowerSystem | null
  loading: boolean
  /** 当前加载的世界组（null = 单世界模式 / 未指定） */
  activeWorldGroupId: number | null

  loadAll: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>

  saveWorldview: (data: Partial<Worldview>) => Promise<void>
  saveStoryCore: (data: Partial<StoryCore>) => Promise<void>
  savePowerSystem: (data: Partial<PowerSystem>) => Promise<void>
}

const now = () => Date.now()

function parseObjectField<T extends object>(value: unknown): T | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : undefined
  } catch {
    return undefined
  }
}

/** 兼容 adopt 旧版曾把原生对象字段序列化成 JSON string 的记录。 */
export function normalizeWorldviewRecord(row: Worldview | null | undefined): Worldview | null {
  if (!row) return null
  return {
    ...row,
    divineDesign: parseObjectField<DivineDesign>(row.divineDesign),
    naturalResources: parseObjectField<NaturalResources>(row.naturalResources),
  }
}

export const useWorldviewStore = create<WorldviewStore>((set, get) => ({
  worldview: null,
  storyCore: null,
  powerSystem: null,
  loading: false,
  activeWorldGroupId: null,

  loadAll: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
    set({ loading: true, activeWorldGroupId: worldGroupId })
    const scope = await resolveScopeLike(scopeInput)
    const [wvList, sc, psList] = await Promise.all([
      readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }),
      readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }).then(rows => rows[0]),
      readOwnedRows<PowerSystem>(scope, 'powerSystems', { owner: 'world' }),
    ])
    // 单世界模式（worldGroupId == null）：取第一条
    // 多世界模式：取匹配该世界组的记录
    const wv = worldGroupId == null
      ? wvList[0]
      : wvList.find(w => w.worldGroupId === worldGroupId)
    const ps = worldGroupId == null
      ? psList[0]
      : psList.find(p => p.worldGroupId === worldGroupId)
    set({
      worldview: normalizeWorldviewRecord(wv),
      storyCore: sc || null,   // 故事核心是项目级，不分世界
      powerSystem: ps || null,
      loading: false,
    })
  },

  saveWorldview: async (data: Partial<Worldview>) => {
    const { worldview, activeWorldGroupId } = get()
    const projectId = data.projectId ?? worldview?.projectId
    if (projectId == null) return
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, worldGroupId, ...patch } = data
    const targetWorldGroupId = worldGroupId ?? activeWorldGroupId
    await adopt({
      projectId,
      worldGroupId: targetWorldGroupId,
      target: 'worldviews',
      mode: 'replace',
      data: patch as Record<string, unknown>,
    })
    const list = await readOwnedRows<Worldview>(await resolveScopeLike(projectId), 'worldviews', { owner: 'world' })
    const next = (targetWorldGroupId == null
      ? (list.find(w => w.worldGroupId == null) ?? list[0])
      : list.find(w => w.worldGroupId === targetWorldGroupId)) ?? null
    set({ worldview: normalizeWorldviewRecord(next) })
  },

  saveStoryCore: async (data: Partial<StoryCore>) => {
    const { storyCore } = get()
    const projectId = data.projectId ?? storyCore?.projectId
    if (projectId == null) return
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, ...patch } = data
    await adopt({
      projectId,
      target: 'storyCores',
      mode: 'replace',
      data: patch as Record<string, unknown>,
    })
    const next = (await readOwnedRows<StoryCore>(await resolveScopeLike(projectId), 'storyCores', { owner: 'work' }))[0] ?? null
    set({ storyCore: next })
  },

  savePowerSystem: async (data: Partial<PowerSystem>) => {
    const { powerSystem, activeWorldGroupId } = get()
    const projectId = data.projectId ?? powerSystem?.projectId
    let target = powerSystem
    if (!target?.id && projectId != null) {
      const list = await readOwnedRows<PowerSystem>(await resolveScopeLike(projectId), 'powerSystems', { owner: 'world' })
      target = (activeWorldGroupId == null
        ? (list.find(p => p.worldGroupId == null) ?? list[0])
        : list.find(p => p.worldGroupId === activeWorldGroupId)) ?? null
    }
    if (target?.id) {
      await db.powerSystems.update(target.id, { ...data, updatedAt: now() })
      await refreshSettingAssertionSourceStatus({
        projectId: target.projectId,
        table: 'powerSystems',
        recordId: target.id,
        changedFields: Object.keys(data),
      })
      set({ powerSystem: { ...target, ...data, updatedAt: now() } })
    } else if (projectId != null) {
      const newPs = stampNewRecord(await resolveScopeLike(projectId), 'powerSystems', {
        projectId,
        name: '', description: '', levels: '', rules: '',
        worldGroupId: activeWorldGroupId,   // 多世界模式下盖章当前世界组
        createdAt: now(), updatedAt: now(),
        ...data,
      }, { owner: 'world' }) as PowerSystem
      const id = await db.powerSystems.add(newPs)
      set({ powerSystem: { ...newPs, id: id as number } })
    }
  },
}))
