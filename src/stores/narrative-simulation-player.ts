import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  adoptNarrativeSimulationRuntimeCandidateV1,
  generateNarrativeSimulationRuntimeCandidateV1,
  type NarrativeSimulationRuntimeCandidateV1,
  type NarrativeSimulationRuntimeSkillIdV1,
} from '../lib/narrative-simulation/harness'
import { availableNarrativeSimulationActions } from '../lib/narrative-simulation/runtime'
import {
  branchSimulationSession,
  commitNarrativeChoice,
  commitNarrativeSimulationTurn,
  createSimulationCheckpoint,
  deleteSimulationSession,
  readSimulationState,
  readSimulationStateVersion,
  verifySimulationCheckpoint,
} from '../lib/simulation/runtime'
import { verifyPlayableSessionPackageV2 } from '../lib/game-production/preview-source'
import { assertGameReleaseUnchanged, parseNarrativeSimulationGameReleaseManifest } from '../lib/text-game/releases'
import type {
  AIConfig,
  GameRelease,
  NarrativeSimulationGameRuntimePackageV2,
  SimulationCheckpoint,
  SimulationEvent,
  SimulationRuntimeState,
  SimulationSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_SIMULATION_STATE } from '../lib/types'
import { assertInstanceBinding, createNarrativeSimulationInstance, readBoundInstances } from '../lib/world-engine/instances'

export interface NarrativeSimulationLibraryItem {
  release: GameRelease
  manifest: NarrativeSimulationGameRuntimePackageV2 | null
  error: string
}

interface NarrativeSimulationPlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: NarrativeSimulationLibraryItem[]
  sessions: SimulationSession[]
  selectedSessionId: number | null
  events: SimulationEvent[]
  checkpoints: SimulationCheckpoint[]
  runtimeState: SimulationRuntimeState
  selectedManifest: NarrativeSimulationGameRuntimePackageV2 | null
  generatedCandidate: NarrativeSimulationRuntimeCandidateV1 | null
  loading: boolean
  busy: boolean
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(gameReleaseId: number, title?: string): Promise<number>
  settleTurn(decisionKeys: string[]): Promise<void>
  choose(choiceKey: string): Promise<void>
  generatePresentation(skillId: NarrativeSimulationRuntimeSkillIdV1, objective: string, aiConfig: AIConfig): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readLibrary(scope: WorkspaceScope): Promise<NarrativeSimulationLibraryItem[]> {
  const releases = (await db.gameReleases.where('workId').equals(scope.workId).toArray())
    .filter(release => {
      try { return (JSON.parse(release.manifestJson) as { productType?: string }).productType === 'narrative-simulation' }
      catch { return false }
    })
    .sort((left, right) => right.createdAt - left.createdAt)
  return Promise.all(releases.map(async release => {
    try {
      await assertGameReleaseUnchanged(release.id!)
      return { release, manifest: parseNarrativeSimulationGameReleaseManifest(release.manifestJson), error: '' }
    } catch (error) {
      return { release, manifest: null, error: error instanceof Error ? error.message : String(error) }
    }
  }))
}

async function assertSession(scope: WorkspaceScope, sessionId: number): Promise<SimulationSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'textsimulation') throw new Error('[textsim] 该存档不是叙事模拟。')
  return session
}

function playableManifest(runtimePackage: Awaited<ReturnType<typeof verifyPlayableSessionPackageV2>>['runtimePackage']) {
  if (runtimePackage.productType !== 'narrative-simulation' || !runtimePackage.simulation) {
    throw new Error('[textsim] 该存档没有绑定有效的 Product Build 或 GameRelease。')
  }
  return structuredClone(runtimePackage) as NarrativeSimulationGameRuntimePackageV2
}

async function readDetails(scope: WorkspaceScope, sessionId: number) {
  const session = await assertSession(scope, sessionId)
  const [events, checkpoints, runtimeState, playable] = await Promise.all([
    db.simulationEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.simulationCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readSimulationState(sessionId),
    verifyPlayableSessionPackageV2({ scope, session }),
  ])
  return {
    events,
    checkpoints: checkpoints.sort((left, right) => right.createdAt - left.createdAt),
    runtimeState,
    selectedManifest: playableManifest(playable.runtimePackage),
  }
}

export const useNarrativeSimulationPlayerStore = create<NarrativeSimulationPlayerState>((set, get) => {
  const refresh = async () => {
    const scope = get().scope
    const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) return
    set(await readDetails(scope, sessionId))
  }
  const reload = async (requested?: number | null) => {
    const scope = get().scope
    if (!scope) return
    const [releases, sessions] = await Promise.all([
      readLibrary(scope),
      readBoundInstances(scope).then(rows => rows
        .filter(row => row.kind === 'textsimulation' && (row.worldGroupId ?? null) === get().worldGroupId)
        .sort((left, right) => right.updatedAt - left.updatedAt)),
    ])
    const desired = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = desired != null && sessions.some(row => row.id === desired)
      ? desired : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null })
  }
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    set({ busy: true, error: '' })
    try { return await operation() }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error }
    finally { set({ busy: false }) }
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
    selectedManifest: null,
    generatedCandidate: null,
    loading: false,
    busy: false,
    error: '',
    load: async (scope, worldGroupId) => {
      set({ scope, worldGroupId, loading: true, error: '', generatedCandidate: null })
      try { await reload() }
      catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
      finally { set({ loading: false }) }
    },
    select: async sessionId => {
      set({ selectedSessionId: sessionId, loading: true, generatedCandidate: null })
      try {
        if (sessionId == null) set({ runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null })
        else await refresh()
      } finally { set({ loading: false }) }
    },
    start: async (gameReleaseId, title) => run(async () => {
      const item = get().releases.find(row => row.release.id === gameReleaseId)
      if (!item?.manifest || !get().scope) throw new Error('[textsim] 请选择有效发布。')
      const session = await createNarrativeSimulationInstance({
        scope: get().scope!,
        gameReleaseId,
        title: title?.trim() || `${item.manifest.definition.title} · 新局`,
        worldGroupId: get().worldGroupId,
      })
      await reload(session.id!)
      return session.id!
    }),
    settleTurn: async decisionKeys => run(async () => {
      const sessionId = get().selectedSessionId
      const state = get().runtimeState.narrativeSimulation
      const manifest = get().selectedManifest
      if (sessionId == null || !state || !manifest || !get().scope) throw new Error('[textsim] 请先开始正式模拟。')
      await assertSession(get().scope!, sessionId)
      const availability = new Map(availableNarrativeSimulationActions(manifest.simulation, state)
        .map(item => [item.action.key, item]))
      if (decisionKeys.some(key => !availability.get(key)?.available)) throw new Error('[textsim] 决策队列包含不可执行行动。')
      const base = await readSimulationStateVersion(sessionId)
      await commitNarrativeSimulationTurn({
        sessionId,
        decisionKeys,
        commandId: `textsim:turn:${sessionId}:${state.turn}:${crypto.randomUUID()}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      set({ generatedCandidate: null })
      await refresh()
    }),
    choose: async choiceKey => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[textsim] 请先开始正式模拟。')
      await assertSession(get().scope!, sessionId)
      const base = await readSimulationStateVersion(sessionId)
      await commitNarrativeChoice({
        sessionId,
        choiceKey,
        commandId: `textsim:ending:${sessionId}:${crypto.randomUUID()}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      await refresh()
    }),
    generatePresentation: async (skillId, objective, aiConfig) => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[textsim] 请先开始正式模拟。')
      const generated = await generateNarrativeSimulationRuntimeCandidateV1({
        scope: get().scope!,
        simulationSessionId: sessionId,
        skillId,
        objective,
        aiConfig,
      })
      await adoptNarrativeSimulationRuntimeCandidateV1({ scope: get().scope!, runId: generated.snapshot.run.id })
      set({ generatedCandidate: generated.candidate })
    }),
    saveCheckpoint: async name => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('[textsim] 请先开始正式模拟。')
      await createSimulationCheckpoint({ sessionId, name })
      await refresh()
    }),
    forkCheckpoint: async (checkpointId, title) => run(async () => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      if (!checkpoint || !await verifySimulationCheckpoint(checkpointId)) throw new Error('[textsim] 检查点无效。')
      const child = await branchSimulationSession({
        parentSessionId: checkpoint.sessionId,
        throughSequence: checkpoint.throughSequence,
        title: title?.trim() || `模拟分支 · ${checkpoint.name}`,
      })
      await reload(child.id!)
      return child.id!
    }),
    forkCurrent: async title => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('[textsim] 请先开始正式模拟。')
      const state = await readSimulationState(sessionId)
      const child = await branchSimulationSession({
        parentSessionId: sessionId,
        throughSequence: state.lastSequence,
        title: title?.trim() || '叙事模拟分支',
      })
      await reload(child.id!)
      return child.id!
    }),
    remove: async sessionId => run(async () => {
      if (!get().scope) throw new Error('[textsim] scope 缺失。')
      await assertSession(get().scope!, sessionId)
      await deleteSimulationSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})

export function selectNarrativeSimulationActions(state: NarrativeSimulationPlayerState) {
  const simulation = state.runtimeState.narrativeSimulation
  return simulation && state.selectedManifest
    ? availableNarrativeSimulationActions(state.selectedManifest.simulation, simulation)
    : []
}
