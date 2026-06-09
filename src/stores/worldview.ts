import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Worldview, StoryCore, PowerSystem } from '../lib/types'
import { adopt } from '../lib/registry/adopt'

interface WorldviewStore {
  worldview: Worldview | null
  storyCore: StoryCore | null
  powerSystem: PowerSystem | null
  loading: boolean
  /** 当前加载的世界组（null = 单世界模式 / 未指定） */
  activeWorldGroupId: number | null

  loadAll: (projectId: number, worldGroupId?: number | null) => Promise<void>

  saveWorldview: (data: Partial<Worldview>) => Promise<void>
  saveStoryCore: (data: Partial<StoryCore>) => Promise<void>
  savePowerSystem: (data: Partial<PowerSystem>) => Promise<void>
}

const now = () => Date.now()

export const useWorldviewStore = create<WorldviewStore>((set, get) => ({
  worldview: null,
  storyCore: null,
  powerSystem: null,
  loading: false,
  activeWorldGroupId: null,

  loadAll: async (projectId: number, worldGroupId: number | null = null) => {
    set({ loading: true, activeWorldGroupId: worldGroupId })
    const [wvList, sc, psList] = await Promise.all([
      db.worldviews.where('projectId').equals(projectId).toArray(),
      db.storyCores.where('projectId').equals(projectId).first(),
      db.powerSystems.where('projectId').equals(projectId).toArray(),
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
      worldview: wv || null,
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
    const list = await db.worldviews.where('projectId').equals(projectId).toArray()
    const next = (targetWorldGroupId == null
      ? (list.find(w => w.worldGroupId == null) ?? list[0])
      : list.find(w => w.worldGroupId === targetWorldGroupId)) ?? null
    set({ worldview: next })
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
    const next = await db.storyCores.where('projectId').equals(projectId).first() ?? null
    set({ storyCore: next })
  },

  savePowerSystem: async (data: Partial<PowerSystem>) => {
    const { powerSystem, activeWorldGroupId } = get()
    const projectId = data.projectId ?? powerSystem?.projectId
    let target = powerSystem
    if (!target?.id && projectId != null) {
      const list = await db.powerSystems.where('projectId').equals(projectId).toArray()
      target = (activeWorldGroupId == null
        ? (list.find(p => p.worldGroupId == null) ?? list[0])
        : list.find(p => p.worldGroupId === activeWorldGroupId)) ?? null
    }
    if (target?.id) {
      await db.powerSystems.update(target.id, { ...data, updatedAt: now() })
      set({ powerSystem: { ...target, ...data, updatedAt: now() } })
    } else if (projectId != null) {
      const newPs: PowerSystem = {
        projectId,
        name: '', description: '', levels: '', rules: '',
        worldGroupId: activeWorldGroupId,   // 多世界模式下盖章当前世界组
        createdAt: now(), updatedAt: now(),
        ...data,
      }
      const id = await db.powerSystems.add(newPs)
      set({ powerSystem: { ...newPs, id: id as number } })
    }
  },
}))
