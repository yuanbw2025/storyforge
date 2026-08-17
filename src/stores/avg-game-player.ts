import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { branchSimulationSession, commitNarrativeChoice, createSimulationCheckpoint, deleteSimulationSession, reachAvgPresentationBeat, readSimulationState, readSimulationStateVersion, recordAvgMediaFailure, verifySimulationCheckpoint } from '../lib/simulation/runtime'
import { assertGameReleaseUnchanged, parseAvgGameReleaseManifest, parseWorldReleaseSpeakerNames } from '../lib/text-game/releases'
import { assertInstanceBinding, createAvgGameInstance, readBoundInstances } from '../lib/world-engine/instances'
import type { AvgGameReleaseManifestV1, GameRelease, SimulationCheckpoint, SimulationEvent, SimulationRuntimeState, SimulationSession, WorkspaceScope } from '../lib/types'
import { EMPTY_SIMULATION_STATE } from '../lib/types'

export interface AvgLibraryItem { release: GameRelease; manifest: AvgGameReleaseManifestV1 | null; error: string }
interface AvgGamePlayerState {
  scope: WorkspaceScope | null; worldGroupId: number | null; releases: AvgLibraryItem[]; sessions: SimulationSession[]
  selectedSessionId: number | null; events: SimulationEvent[]; checkpoints: SimulationCheckpoint[]; runtimeState: SimulationRuntimeState
  selectedManifest: AvgGameReleaseManifestV1 | null; speakerNames: Record<string, string>; loading: boolean; busy: boolean; error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>; select(id: number | null): Promise<void>
  start(releaseId: number, title?: string): Promise<number>; reachBeat(beatKey: string): Promise<void>; choose(choiceKey: string): Promise<void>
  recordMediaFailures(failures: Array<{ assetKey: string; reason: string }>): Promise<void>
  saveCheckpoint(name: string): Promise<void>; forkCheckpoint(id: number, title?: string): Promise<number>; remove(id: number): Promise<void>
}

async function library(scope: WorkspaceScope): Promise<AvgLibraryItem[]> {
  const rows = (await db.gameReleases.where('workId').equals(scope.workId).toArray()).filter(row => {
    try { return (JSON.parse(row.manifestJson) as { productType?: string }).productType === 'avg' } catch { return false }
  })
  return Promise.all(rows.map(async release => {
    try { await assertGameReleaseUnchanged(release.id!); return { release, manifest: parseAvgGameReleaseManifest(release.manifestJson), error: '' } }
    catch (error) { return { release, manifest: null, error: error instanceof Error ? error.message : String(error) } }
  }))
}

async function assertSession(scope: WorkspaceScope, id: number): Promise<SimulationSession> {
  const session = await assertInstanceBinding(id, scope)
  if (session.kind !== 'avg') throw new Error('[avg] 该存档不是视觉小说存档')
  return session
}

async function ensureAutomaticCheckpoint(sessionId: number): Promise<void> {
  const state = await readSimulationState(sessionId)
  const node = state.narrative?.nodes.find(item => item.key === state.narrative?.currentNodeKey)
  if (!node) return
  const existing = await db.simulationCheckpoints.where('sessionId').equals(sessionId)
    .filter(item => item.throughSequence === state.lastSequence && item.name.startsWith('自动 · ')).first()
  if (!existing) await createSimulationCheckpoint({ sessionId, name: `自动 · ${node.title}`, throughSequence: state.lastSequence })
}

export const useAvgGamePlayerStore = create<AvgGamePlayerState>((set, get) => {
  const details = async (id: number) => {
    const scope = get().scope!; const session = await assertSession(scope, id)
    const [events, checkpoints, runtimeState, release, worldRelease] = await Promise.all([
      db.simulationEvents.where('sessionId').equals(id).sortBy('sequence'), db.simulationCheckpoints.where('sessionId').equals(id).toArray(), readSimulationState(id),
      session.gameReleaseId == null ? null : assertGameReleaseUnchanged(session.gameReleaseId),
      session.worldReleaseId == null ? null : db.worldReleases.get(session.worldReleaseId),
    ])
    set({ events, checkpoints: checkpoints.sort((a, b) => b.createdAt - a.createdAt), runtimeState, selectedManifest: release ? parseAvgGameReleaseManifest(release.manifestJson) : null, speakerNames: worldRelease ? parseWorldReleaseSpeakerNames(worldRelease.manifestJson) : {} })
  }
  const reload = async (selected?: number | null) => {
    const scope = get().scope!; const worldGroupId = get().worldGroupId
    const [releases, sessions] = await Promise.all([library(scope), readBoundInstances(scope).then(rows => rows.filter(row => row.kind === 'avg' && (row.worldGroupId ?? null) === worldGroupId))])
    const wanted = selected === undefined ? get().selectedSessionId : selected
    const id = wanted != null && sessions.some(row => row.id === wanted) ? wanted : sessions[0]?.id ?? null
    set({ releases, sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt), selectedSessionId: id })
    if (id != null) await details(id); else set({ events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null, speakerNames: {} })
  }
  const act = async (fn: () => Promise<unknown>) => { set({ busy: true, error: '' }); try { await fn() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error } finally { set({ busy: false }) } }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null, events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null, speakerNames: {}, loading: false, busy: false, error: '',
    load: async (scope, worldGroupId) => { set({ scope, worldGroupId, loading: true, error: '' }); try { await reload() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) } finally { set({ loading: false }) } },
    select: async id => { set({ selectedSessionId: id, loading: true }); try { if (id == null) set({ runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null, speakerNames: {} }); else await details(id) } finally { set({ loading: false }) } },
    start: async (releaseId, title) => { let id = 0; await act(async () => { const item = get().releases.find(row => row.release.id === releaseId); if (!item?.manifest || !get().scope) throw new Error('[avg] 请选择有效发布'); const session = await createAvgGameInstance({ scope: get().scope!, gameReleaseId: releaseId, title: title || `${item.manifest.definition.title} · 新游戏`, worldGroupId: get().worldGroupId }); id = session.id!; await ensureAutomaticCheckpoint(id); await reload(id) }); return id },
    reachBeat: async beatKey => act(async () => { const id = get().selectedSessionId; if (id == null || !get().scope) throw new Error('[avg] 请先开始游戏'); await assertSession(get().scope!, id); const base = await readSimulationStateVersion(id); const nodeKey = get().runtimeState.narrative?.currentNodeKey ?? 'unknown'; const visit = get().runtimeState.narrative?.visitedNodeKeys.filter(key => key === nodeKey).length ?? 0; await reachAvgPresentationBeat({ sessionId: id, beatKey, commandId: `avg:beat:${id}:${nodeKey}:${visit}:${beatKey}`, baseSequence: base.sequence, baseStateHash: base.stateHash, snapshotKey: `node:${nodeKey}:visit:${visit}` }); await details(id) }),
    choose: async choiceKey => act(async () => { const id = get().selectedSessionId; if (id == null || !get().scope) throw new Error('[avg] 请先开始游戏'); await assertSession(get().scope!, id); const base = await readSimulationStateVersion(id); await commitNarrativeChoice({ sessionId: id, choiceKey, commandId: `avg:choice:${id}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash }); await ensureAutomaticCheckpoint(id); await details(id) }),
    recordMediaFailures: async failures => {
      const id = get().selectedSessionId
      const manifest = get().selectedManifest
      const recordedKeys = new Set(get().runtimeState.presentation?.mediaFailures.map(item => item.assetKey) ?? [])
      const pending = failures.filter(failure => !recordedKeys.has(failure.assetKey))
      if (id == null || !get().scope || !manifest || pending.length === 0) return
      await act(async () => {
        await assertSession(get().scope!, id)
        for (const failure of pending) {
          const asset = manifest.presentation.assets.find(item => item.assetKey === failure.assetKey)
          if (!asset) continue
          await recordAvgMediaFailure({ sessionId: id, assetKey: failure.assetKey, reason: failure.reason, commandId: `avg:media-failed:${id}:${failure.assetKey}:${asset.version}` })
        }
        await details(id)
      })
    },
    saveCheckpoint: async name => act(async () => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); await createSimulationCheckpoint({ sessionId: id, name }); await details(id) }),
    forkCheckpoint: async (checkpointId, title) => { let id = 0; await act(async () => { const checkpoint = get().checkpoints.find(row => row.id === checkpointId); if (!checkpoint || !await verifySimulationCheckpoint(checkpointId)) throw new Error('[avg] 检查点无效'); const child = await branchSimulationSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: title || `AVG 分支 · ${checkpoint.name}` }); id = child.id!; await reload(id) }); return id },
    remove: async id => act(async () => { if (!get().scope) throw new Error('[avg] scope 缺失'); await assertSession(get().scope!, id); await deleteSimulationSession(id); await reload(get().selectedSessionId === id ? null : undefined) }),
  }
})
