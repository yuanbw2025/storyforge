import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  branchSimulationSession,
  commitNarrativeChoice,
  advanceSimulationNarrative,
  createSimulationCheckpoint,
  deleteSimulationSession,
  readSimulationState,
  readSimulationStateVersion,
  verifySimulationCheckpoint,
} from '../lib/simulation/runtime'
import {
  assertGameReleaseUnchanged,
  parseGameReleaseManifest,
  parseWorldReleasePlayerCharacter,
  parseWorldReleaseSpeakerNames,
  type WorldReleasePlayerCharacter,
} from '../lib/text-game/releases'
import { assertInstanceBinding, createStoryGameInstance, readBoundInstances } from '../lib/world-engine/instances'
import type {
  GameRelease,
  GameReleaseManifestV1,
  SimulationCheckpoint,
  SimulationEvent,
  SimulationRuntimeState,
  SimulationSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_SIMULATION_STATE } from '../lib/types'

export interface StoryGameLibraryItem {
  release: GameRelease
  manifest: GameReleaseManifestV1 | null
  speakerNames: Record<string, string>
  playerCharacter: WorldReleasePlayerCharacter | null
  error: string
}

interface StoryGamePlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: StoryGameLibraryItem[]
  sessions: SimulationSession[]
  selectedSessionId: number | null
  events: SimulationEvent[]
  checkpoints: SimulationCheckpoint[]
  runtimeState: SimulationRuntimeState
  speakerNames: Record<string, string>
  loading: boolean
  busy: boolean
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null, openLibrary?: boolean): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(gameReleaseId: number, title?: string): Promise<number>
  choose(choiceKey: string): Promise<void>
  advanceLegacy(targetNodeKey: string): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readLibrary(scope: WorkspaceScope): Promise<StoryGameLibraryItem[]> {
  const rows = (await db.gameReleases.where('projectId').equals(scope.projectId).toArray())
    .filter(row => row.worldId === scope.worldId && row.workId === scope.workId)
    .sort((left, right) => right.createdAt - left.createdAt)
  const storyReleases = rows.filter(release => {
    try {
      return (JSON.parse(release.manifestJson) as { productType?: string }).productType === 'storygame'
    } catch {
      return false
    }
  })
  return Promise.all(storyReleases.map(async release => {
    try {
      await assertGameReleaseUnchanged(release.id!)
      const worldRelease = await db.worldReleases.get(release.worldReleaseId)
      return {
        release,
        manifest: parseGameReleaseManifest(release.manifestJson),
        speakerNames: worldRelease ? parseWorldReleaseSpeakerNames(worldRelease.manifestJson) : {},
        playerCharacter: worldRelease ? parseWorldReleasePlayerCharacter(worldRelease.manifestJson) : null,
        error: '',
      }
    } catch (error) {
      return {
        release,
        manifest: null,
        speakerNames: {},
        playerCharacter: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }))
}

async function readSessionDetails(scope: WorkspaceScope, sessionId: number) {
  const session = await assertStoryGameSession(scope, sessionId)
  const [events, checkpoints, runtimeState, worldRelease] = await Promise.all([
    db.simulationEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.simulationCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readSimulationState(sessionId),
    session.worldReleaseId == null ? null : db.worldReleases.get(session.worldReleaseId),
  ])
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  return {
    events,
    checkpoints,
    runtimeState,
    speakerNames: worldRelease ? parseWorldReleaseSpeakerNames(worldRelease.manifestJson) : {},
  }
}

async function assertStoryGameSession(scope: WorkspaceScope, sessionId: number): Promise<SimulationSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'storygame') throw new Error('该存档不是文字游戏存档。')
  return session
}

async function ensureAutomaticCheckpoint(sessionId: number): Promise<void> {
  const state = await readSimulationState(sessionId)
  const narrative = state.narrative
  const node = narrative?.nodes.find(candidate => candidate.key === narrative.currentNodeKey)
  if (!narrative || narrative.version !== 2 || !node || narrative.completed) return
  const existing = await db.simulationCheckpoints
    .where('sessionId').equals(sessionId)
    .filter(checkpoint => checkpoint.throughSequence === state.lastSequence && checkpoint.name.startsWith('自动 · '))
    .first()
  if (!existing) {
    await createSimulationCheckpoint({
      sessionId,
      name: `自动 · ${node.title}`,
      throughSequence: state.lastSequence,
    })
  }
}

export const useStoryGamePlayerStore = create<StoryGamePlayerState>((set, get) => {
  const refreshSelected = async () => {
    const scope = get().scope
    const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) return
    set(await readSessionDetails(scope, sessionId))
  }

  const reload = async (selectedSessionId?: number | null) => {
    const scope = get().scope
    if (!scope) return
    const worldGroupId = get().worldGroupId
    const releases = await readLibrary(scope)
    const sessions = (await readBoundInstances(scope))
      .filter(session => session.kind === 'storygame'
        && (session.worldGroupId ?? null) === worldGroupId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const explicitlySelected = selectedSessionId !== undefined
    const requested = explicitlySelected ? selectedSessionId : get().selectedSessionId
    const nextSelected = requested != null && sessions.some(session => session.id === requested)
      ? requested
      : explicitlySelected ? null : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId: nextSelected })
    if (nextSelected != null) await refreshSelected()
    else set({
      events: [],
      checkpoints: [],
      runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
      speakerNames: {},
    })
  }

  return {
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
    speakerNames: {},
    loading: false,
    busy: false,
    error: '',

    load: async (scope, worldGroupId, openLibrary = false) => {
      const scopeChanged = get().scope?.projectId !== scope.projectId
        || get().scope?.worldId !== scope.worldId
        || get().scope?.workId !== scope.workId
        || get().worldGroupId !== worldGroupId
      set({ scope, worldGroupId, loading: true, error: '', ...(scopeChanged ? { selectedSessionId: null } : {}) })
      try {
        await reload(openLibrary ? null : undefined)
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ loading: false })
      }
    },

    select: async sessionId => {
      set({ selectedSessionId: sessionId, loading: true, error: '' })
      try {
        if (sessionId == null) {
          set({
            events: [],
            checkpoints: [],
            runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
            speakerNames: {},
          })
        } else {
          await refreshSelected()
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ loading: false })
      }
    },

    start: async (gameReleaseId, title) => {
      const scope = get().scope
      const item = get().releases.find(candidate => candidate.release.id === gameReleaseId)
      if (!scope || !item?.manifest || item.error) throw new Error('请选择一个可用的正式游戏发布。')
      set({ busy: true, error: '' })
      try {
        const session = await createStoryGameInstance({
          scope,
          gameReleaseId,
          title: title?.trim() || `${item.manifest.definition.title} · 新游戏`,
          worldGroupId: get().worldGroupId,
        })
        await ensureAutomaticCheckpoint(session.id!)
        await reload(session.id!)
        return session.id!
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ error: message })
        throw error
      } finally {
        set({ busy: false })
      }
    },

    choose: async choiceKey => {
      const sessionId = get().selectedSessionId
      const scope = get().scope
      if (sessionId == null || !scope) throw new Error('请先开始或继续一个游戏。')
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, sessionId)
        const base = await readSimulationStateVersion(sessionId)
        await commitNarrativeChoice({
          sessionId,
          choiceKey,
          commandId: `storygame:${sessionId}:${crypto.randomUUID()}`,
          baseSequence: base.sequence,
          baseStateHash: base.stateHash,
        })
        await ensureAutomaticCheckpoint(sessionId)
        await refreshSelected()
        set(state => ({
          sessions: state.sessions.map(session => session.id === sessionId
            ? { ...session, updatedAt: Date.now() }
            : session),
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ error: message })
        try { await refreshSelected() } catch { /* retain the actionable original error */ }
        throw error
      } finally {
        set({ busy: false })
      }
    },

    advanceLegacy: async targetNodeKey => {
      const sessionId = get().selectedSessionId
      const scope = get().scope
      if (sessionId == null || !scope) throw new Error('请先选择旧版文字游戏存档。')
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, sessionId)
        await advanceSimulationNarrative({
          sessionId,
          targetNodeKey,
          baseSequence: get().runtimeState.lastSequence,
        })
        await refreshSelected()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set({ busy: false })
      }
    },

    saveCheckpoint: async name => {
      const sessionId = get().selectedSessionId
      const scope = get().scope
      if (sessionId == null || !scope) throw new Error('请先开始或继续一个游戏。')
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, sessionId)
        await createSimulationCheckpoint({ sessionId, name })
        await refreshSelected()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set({ busy: false })
      }
    },

    forkCheckpoint: async (checkpointId, title) => {
      const checkpoint = get().checkpoints.find(candidate => candidate.id === checkpointId)
      const parent = get().sessions.find(candidate => candidate.id === checkpoint?.sessionId)
      const scope = get().scope
      if (!scope || !checkpoint || !parent || !await verifySimulationCheckpoint(checkpointId)) {
        throw new Error('检查点不存在或完整性校验失败。')
      }
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, parent.id!)
        const child = await branchSimulationSession({
          parentSessionId: parent.id!,
          throughSequence: checkpoint.throughSequence,
          title: title?.trim() || `${parent.title} · ${checkpoint.name}`,
        })
        await reload(child.id!)
        return child.id!
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set({ busy: false })
      }
    },

    forkCurrent: async title => {
      const sessionId = get().selectedSessionId
      const parent = get().sessions.find(candidate => candidate.id === sessionId)
      const scope = get().scope
      if (!scope || !parent) throw new Error('当前游戏存档不存在。')
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, parent.id!)
        const child = await branchSimulationSession({
          parentSessionId: parent.id!,
          throughSequence: get().runtimeState.lastSequence,
          title: title?.trim() || `${parent.title} · 新时间线`,
        })
        await reload(child.id!)
        return child.id!
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set({ busy: false })
      }
    },

    remove: async sessionId => {
      const scope = get().scope
      if (!scope) throw new Error('当前 World/Work 尚未就绪。')
      set({ busy: true, error: '' })
      try {
        await assertStoryGameSession(scope, sessionId)
        await deleteSimulationSession(sessionId)
        await reload(get().selectedSessionId === sessionId ? null : undefined)
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        set({ busy: false })
      }
    },
  }
})
