import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  readProductRuntimeState,
  verifyProductRuntimeCheckpoint,
} from '../lib/ttrpg/runtime-api'
import {
  EMPTY_PRODUCT_RUNTIME_STATE,
  type ProductRuntimeCheckpoint,
  type ProductRuntimeEvent,
  type ProductRuntimeState,
  type ProductRuntimeSession,
} from '../lib/types'

interface TtrpgRuntimePlayerStore {
  projectId: number | null
  worldGroupId: number | null
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  runtimeState: ProductRuntimeState
  loading: boolean
  error: string
  load(projectId: number, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  checkpoint(name: string): Promise<void>
  branch(title: string): Promise<number>
  restoreCheckpoint(checkpointId: number): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readSessionDetails(sessionId: number) {
  const [events, checkpoints, runtimeState] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray(),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
  ])
  events.sort((left, right) => left.sequence - right.sequence)
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  return {
    events,
    checkpoints,
    runtimeState,
  }
}

export const useTtrpgRuntimePlayerStore = create<TtrpgRuntimePlayerStore>((set, get) => {
  const refreshSelected = async () => {
    const sessionId = get().selectedSessionId
    if (sessionId == null) return
    const details = await readSessionDetails(sessionId)
    set(details)
  }

  return {
    projectId: null,
    worldGroupId: null,
    sessions: [],
    selectedSessionId: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    loading: false,
    error: '',

    load: async (projectId, worldGroupId) => {
      set({ loading: true, error: '' })
      try {
        const sessions = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())
          .filter(session => (session.worldGroupId ?? null) === worldGroupId)
        sessions.sort((left, right) => right.updatedAt - left.updatedAt)
        const current = get().projectId === projectId && get().worldGroupId === worldGroupId
          ? get().selectedSessionId
          : null
        const selectedSessionId = current != null && sessions.some(row => row.id === current)
          ? current
          : sessions[0]?.id ?? null
        set({ projectId, worldGroupId, sessions, selectedSessionId, loading: false })
        if (selectedSessionId != null) await refreshSelected()
        else set({
          events: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
        })
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    select: async sessionId => {
      set({ selectedSessionId: sessionId, error: '' })
      if (sessionId == null) {
        set({
          events: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
        })
        return
      }
      try {
        set(await readSessionDetails(sessionId))
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    checkpoint: async name => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await createProductRuntimeCheckpoint({ sessionId, name })
      await refreshSelected()
    },

    branch: async title => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      const parent = get().sessions.find(row => row.id === sessionId)
      if (!parent) throw new Error('当前运行时会话不存在。')
      const child = await branchProductRuntimeSession({
        parentSessionId: sessionId,
        throughSequence: get().runtimeState.lastSequence,
        title,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    restoreCheckpoint: async checkpointId => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      const parent = get().sessions.find(row => row.id === checkpoint?.sessionId)
      if (!checkpoint || !parent) throw new Error('要恢复的检查点不存在。')
      if (!await verifyProductRuntimeCheckpoint(checkpointId)) {
        throw new Error('检查点内容校验失败，不能用于恢复。')
      }
      const child = await branchProductRuntimeSession({
        parentSessionId: parent.id!,
        throughSequence: checkpoint.throughSequence,
        title: `${parent.title} · ${checkpoint.name}`,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    remove: async sessionId => {
      const projectId = get().projectId
      const worldGroupId = get().worldGroupId
      await deleteProductRuntimeSession(sessionId)
      if (projectId != null) await get().load(projectId, worldGroupId)
    },
  }
})
