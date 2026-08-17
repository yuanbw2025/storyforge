import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  branchSimulationSession,
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  createSimulationCheckpoint,
  deleteSimulationSession,
  readSimulationState,
  readSimulationStateVersion,
  verifySimulationCheckpoint,
} from '../lib/simulation/runtime'
import { availableAdventureActions } from '../lib/adventure/runtime'
import {
  adoptAdventureRuntimeCandidateV1,
  cancelAdventureRuntimeRunV1,
  generateAdventureRuntimeCandidateV1,
  type AdventureIntentCandidateV1,
  type AdventureNarrationCandidateV1,
} from '../lib/adventure/harness'
import { assertGameReleaseUnchanged, parseAdventureGameReleaseManifest } from '../lib/text-game/releases'
import { assertInstanceBinding, createTextAdventureInstance, readBoundInstances } from '../lib/world-engine/instances'
import type {
  AdventureGameReleaseManifestV1,
  AIConfig,
  GameRelease,
  SimulationCheckpoint,
  SimulationEvent,
  SimulationRuntimeState,
  SimulationSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_SIMULATION_STATE } from '../lib/types'

export interface AdventureLibraryItem {
  release: GameRelease
  manifest: AdventureGameReleaseManifestV1 | null
  error: string
}

interface AdventurePlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: AdventureLibraryItem[]
  sessions: SimulationSession[]
  selectedSessionId: number | null
  events: SimulationEvent[]
  checkpoints: SimulationCheckpoint[]
  recoverableRunIds: number[]
  runtimeState: SimulationRuntimeState
  selectedManifest: AdventureGameReleaseManifestV1 | null
  pendingIntent: AdventureIntentCandidateV1 | null
  generatedNarrative: AdventureNarrationCandidateV1 | null
  generatingRunId: number | null
  loading: boolean
  busy: boolean
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(gameReleaseId: number, title?: string): Promise<number>
  act(actionKey: string, commandId?: string): Promise<void>
  generateIntent(text: string, aiConfig: AIConfig): Promise<void>
  adoptPendingIntent(): Promise<void>
  rejectPendingIntent(): Promise<void>
  narrateLastResult(aiConfig: AIConfig): Promise<void>
  cancelGeneration(): Promise<void>
  resumeRun(runId: number): Promise<void>
  choose(choiceKey: string): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

let generationAbortController: AbortController | null = null

async function readLibrary(scope: WorkspaceScope): Promise<AdventureLibraryItem[]> {
  const rows = (await db.gameReleases.where('projectId').equals(scope.projectId).toArray())
    .filter(row => row.worldId === scope.worldId && row.workId === scope.workId)
    .sort((left, right) => right.createdAt - left.createdAt)
  return Promise.all(rows.flatMap(release => {
    try {
      const parsed = JSON.parse(release.manifestJson) as { productType?: string }
      return parsed.productType === 'text-adventure' ? [release] : []
    } catch { return [] }
  }).map(async release => {
    try {
      await assertGameReleaseUnchanged(release.id!)
      return { release, manifest: parseAdventureGameReleaseManifest(release.manifestJson), error: '' }
    } catch (error) {
      return { release, manifest: null, error: error instanceof Error ? error.message : String(error) }
    }
  }))
}

async function assertAdventureSession(scope: WorkspaceScope, sessionId: number) {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'textadventure' || session.gameReleaseId == null) throw new Error('该存档不是正式文字冒险。')
  return session
}

async function details(scope: WorkspaceScope, sessionId: number) {
  const session = await assertAdventureSession(scope, sessionId)
  const [events, checkpoints, runtimeState, release, runRows] = await Promise.all([
    db.simulationEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.simulationCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readSimulationState(sessionId),
    assertGameReleaseUnchanged(session.gameReleaseId!),
    db.agentRuns.where('simulationSessionId').equals(sessionId).toArray(),
  ])
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  const resumableRows = runRows.filter(row => !['completed', 'failed', 'cancelled'].includes(row.status))
  const resumeCheckpoints = resumableRows.length
    ? await db.agentRunCheckpoints.where('runId').anyOf(resumableRows.map(row => row.id!)).toArray()
    : []
  return {
    events,
    checkpoints,
    runtimeState,
    selectedManifest: parseAdventureGameReleaseManifest(release.manifestJson),
    recoverableRunIds: resumableRows
      .filter(row => resumeCheckpoints.some(item => item.runId === row.id && item.resumePayloadJson != null))
      .map(row => row.id!),
  }
}

async function automaticCheckpoint(sessionId: number): Promise<void> {
  const state = await readSimulationState(sessionId)
  if (!state.adventure) return
  const last = state.adventure.actionHistory[state.adventure.actionHistory.length - 1]
  if (!last || state.adventure.actionHistory.length % 5 !== 0) return
  const existing = await db.simulationCheckpoints.where('sessionId').equals(sessionId)
    .filter(item => item.throughSequence === state.lastSequence && item.name.startsWith('自动 · ')).first()
  if (!existing) await createSimulationCheckpoint({
    sessionId, throughSequence: state.lastSequence,
    name: `自动 · ${state.adventure.currentLocationKey} · ${state.adventure.actionHistory.length} 次行动`,
  })
}

export const useAdventureGamePlayerStore = create<AdventurePlayerState>((set, get) => {
  const refresh = async () => {
    const scope = get().scope; const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) return
    set(await details(scope, sessionId))
  }
  const reload = async (requested?: number | null) => {
    const scope = get().scope
    if (!scope) return
    const releases = await readLibrary(scope)
    const sessions = (await readBoundInstances(scope))
      .filter(item => item.kind === 'textadventure' && (item.worldGroupId ?? null) === get().worldGroupId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const desired = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = desired != null && sessions.some(item => item.id === desired) ? desired : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null })
  }
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    set({ busy: true, error: '' })
    try { return await operation() }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error }
    finally { set({ busy: false }) }
  }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
    events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null,
    pendingIntent: null, generatedNarrative: null, generatingRunId: null,
    loading: false, busy: false, error: '',
    load: async (scope, worldGroupId) => {
      const changed = get().scope?.workId !== scope.workId || get().worldGroupId !== worldGroupId
      set({ scope, worldGroupId, loading: true, error: '', ...(changed ? {
        selectedSessionId: null, pendingIntent: null, generatedNarrative: null,
      } : {}) })
      try { await reload() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
      finally { set({ loading: false }) }
    },
    select: async sessionId => {
      set({ selectedSessionId: sessionId, loading: true, error: '', pendingIntent: null, generatedNarrative: null })
      try {
        if (sessionId == null) set({ events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null })
        else await refresh()
      } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
      finally { set({ loading: false }) }
    },
    start: (gameReleaseId, title) => run(async () => {
      const scope = get().scope
      const item = get().releases.find(candidate => candidate.release.id === gameReleaseId)
      if (!scope || !item?.manifest || item.error) throw new Error('请选择可用的文字冒险发布。')
      const session = await createTextAdventureInstance({
        scope, gameReleaseId, worldGroupId: get().worldGroupId,
        title: title?.trim() || `${item.manifest.definition.title} · 新冒险`,
      })
      await reload(session.id!)
      return session.id!
    }),
    act: (actionKey, commandId) => run(async () => {
      const scope = get().scope; const sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先开始或继续一个文字冒险。')
      await assertAdventureSession(scope, sessionId)
      const base = await readSimulationStateVersion(sessionId)
      await commitAdventureAction({
        sessionId, actionKey,
        commandId: commandId ?? `textadv:${sessionId}:${crypto.randomUUID()}`,
        baseSequence: base.sequence, baseStateHash: base.stateHash,
      })
      await automaticCheckpoint(sessionId)
      await refresh()
      set({ generatedNarrative: null })
    }),
    generateIntent: (text, aiConfig) => run(async () => {
      const scope = get().scope; const sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先开始或继续一个文字冒险。')
      generationAbortController?.abort()
      generationAbortController = new AbortController()
      set({ generatingRunId: -1, pendingIntent: null })
      try {
        const generated = await generateAdventureRuntimeCandidateV1({
          scope, simulationSessionId: sessionId, skillId: 'prose.adventure-intent-parser',
          objective: text, aiConfig, signal: generationAbortController.signal,
          onRunCreated: runId => set({ generatingRunId: runId }),
        })
        if (generated.candidate.kind !== 'adventure-intent-candidate') throw new Error('Harness 返回了错误候选类型。')
        set({ pendingIntent: generated.candidate })
      } finally {
        generationAbortController = null
        set({ generatingRunId: null })
      }
    }),
    adoptPendingIntent: () => run(async () => {
      const scope = get().scope; const candidate = get().pendingIntent
      if (!scope || !candidate) throw new Error('当前没有待确认的自由输入候选。')
      await adoptAdventureRuntimeCandidateV1({ scope, runId: candidate.runId })
      set({ pendingIntent: null, generatedNarrative: null })
      await automaticCheckpoint(candidate.simulationSessionId)
      await refresh()
    }),
    rejectPendingIntent: () => run(async () => {
      const scope = get().scope; const candidate = get().pendingIntent
      if (!scope || !candidate) return
      await cancelAdventureRuntimeRunV1({ scope, runId: candidate.runId, reason: 'player-rejected-intent' })
      set({ pendingIntent: null })
    }),
    narrateLastResult: aiConfig => run(async () => {
      const scope = get().scope; const sessionId = get().selectedSessionId
      const last = get().runtimeState.adventure?.actionHistory.slice(-1)[0]
      if (!scope || sessionId == null || !last) throw new Error('没有可以润色的行动结果。')
      generationAbortController?.abort()
      generationAbortController = new AbortController()
      set({ generatingRunId: -1 })
      try {
        const generated = await generateAdventureRuntimeCandidateV1({
          scope, simulationSessionId: sessionId, skillId: 'prose.adventure-result-narrator',
          objective: `润色行动 ${last.actionKey} 的已发生结果，不改变规则事实。`,
          aiConfig, signal: generationAbortController.signal,
          onRunCreated: runId => set({ generatingRunId: runId }),
        })
        const adopted = await adoptAdventureRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
        if (adopted.candidate.kind !== 'adventure-narration-candidate') throw new Error('Harness 返回了错误叙述类型。')
        set({ generatedNarrative: adopted.candidate })
      } finally {
        generationAbortController = null
        set({ generatingRunId: null })
      }
    }),
    cancelGeneration: async () => {
      generationAbortController?.abort()
      const scope = get().scope; const runId = get().generatingRunId
      if (scope && runId != null && runId > 0) {
        try { await cancelAdventureRuntimeRunV1({ scope, runId }) } catch { /* generation owns terminal failure */ }
      }
      set({ generatingRunId: null })
    },
    resumeRun: runId => run(async () => {
      const scope = get().scope
      if (!scope) throw new Error('工作区未就绪。')
      const adopted = await adoptAdventureRuntimeCandidateV1({ scope, runId })
      if (adopted.candidate.kind === 'adventure-intent-candidate') {
        await automaticCheckpoint(adopted.candidate.simulationSessionId)
        set({ pendingIntent: null })
        await refresh()
      } else set({ generatedNarrative: adopted.candidate })
    }),
    choose: choiceKey => run(async () => {
      const scope = get().scope; const sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先开始或继续一个文字冒险。')
      await assertAdventureSession(scope, sessionId)
      await commitAdventureNarrativeChoice({
        sessionId,
        choiceKey,
        commandId: `textadv-narrative:${sessionId}:${crypto.randomUUID()}`,
      })
      await refresh()
    }),
    saveCheckpoint: name => run(async () => {
      const scope = get().scope; const sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先选择文字冒险。')
      await assertAdventureSession(scope, sessionId)
      await createSimulationCheckpoint({ sessionId, name })
      await refresh()
    }),
    forkCheckpoint: (checkpointId, title) => run(async () => {
      const checkpoint = get().checkpoints.find(item => item.id === checkpointId)
      const parent = get().sessions.find(item => item.id === checkpoint?.sessionId)
      if (!checkpoint || !parent || !await verifySimulationCheckpoint(checkpointId)) throw new Error('检查点不存在或完整性失败。')
      const child = await branchSimulationSession({
        parentSessionId: parent.id!, throughSequence: checkpoint.throughSequence,
        title: title?.trim() || `${parent.title} · ${checkpoint.name}`,
      })
      await reload(child.id!); return child.id!
    }),
    forkCurrent: title => run(async () => {
      const parent = get().sessions.find(item => item.id === get().selectedSessionId)
      if (!parent) throw new Error('当前文字冒险存档不存在。')
      const child = await branchSimulationSession({
        parentSessionId: parent.id!, throughSequence: get().runtimeState.lastSequence,
        title: title?.trim() || `${parent.title} · 新时间线`,
      })
      await reload(child.id!); return child.id!
    }),
    remove: sessionId => run(async () => {
      const scope = get().scope
      if (!scope) throw new Error('当前 World/Work 尚未就绪。')
      await assertAdventureSession(scope, sessionId)
      await deleteSimulationSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})

export function selectAdventureActions(state: AdventurePlayerState) {
  if (!state.selectedManifest || !state.runtimeState.adventure) return []
  return availableAdventureActions(
    state.selectedManifest.adventure,
    state.runtimeState.adventure,
    state.runtimeState.narrative?.variables,
  )
}
