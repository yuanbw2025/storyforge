import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { branchProductRuntimeSession, commitNarrativeChoice, createProductRuntimeCheckpoint, deleteProductRuntimeSession, reachAvgPresentationBeat, readProductRuntimeState, readProductRuntimeStateVersion, recordAvgMediaFailure, verifyProductRuntimeCheckpoint } from '../lib/avg/runtime-api'
import { assertProductReleaseUnchanged, parseAvgProductReleaseManifest, runtimePackageSpeakerNames } from '../lib/product/releases'
import { assertInstanceBinding, createAvgGameInstance, readBoundInstances } from '../lib/product/runtime-instances'
import { resolveProductRuntimeSource } from '../lib/product-production/preview-source'
import type { AvgProductRuntimePackageV1, ProductMediaResolverV1, ProductRelease, ProductRuntimePackageV1, ProductRuntimeCheckpoint, ProductRuntimeEvent, ProductRuntimeState, ProductRuntimeSession, WorkspaceScope } from '../lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'

export interface AvgLibraryItem { release: ProductRelease; manifest: AvgProductRuntimePackageV1 | null; error: string }
interface AvgGamePlayerState {
  scope: WorkspaceScope | null; worldGroupId: number | null; releases: AvgLibraryItem[]; sessions: ProductRuntimeSession[]
  selectedSessionId: number | null; events: ProductRuntimeEvent[]; checkpoints: ProductRuntimeCheckpoint[]; runtimeState: ProductRuntimeState
  selectedManifest: AvgProductRuntimePackageV1 | null; selectedMediaResolver: ProductMediaResolverV1 | null
  selectedSourceSessionId: number | null; speakerNames: Record<string, string>; loading: boolean; busy: boolean; error: string
  load(scope: WorkspaceScope, worldGroupId: number | null, openLibrary?: boolean): Promise<void>; select(id: number | null): Promise<void>
  start(releaseId: number, title?: string): Promise<number>; reachBeat(beatKey: string): Promise<void>; choose(choiceKey: string): Promise<void>
  preloadMedia(maximumBytes?: number): Promise<{ urls: Record<string, string>; failures: Array<{ assetKey: string; reason: string }> }>
  recordMediaFailures(failures: Array<{ assetKey: string; reason: string }>): Promise<void>
  saveCheckpoint(name: string): Promise<void>; forkCheckpoint(id: number, title?: string): Promise<number>; remove(id: number): Promise<void>
}

function playableManifest(runtimePackage: ProductRuntimePackageV1): AvgProductRuntimePackageV1 {
  if (runtimePackage.productType !== 'avg' || !runtimePackage.presentation) {
    throw new Error('[avg] 当前可玩来源不是完整 AVG RuntimePackage')
  }
  return structuredClone(runtimePackage) as AvgProductRuntimePackageV1
}

async function library(scope: WorkspaceScope): Promise<AvgLibraryItem[]> {
  const rows = (await db.productReleases.where('workId').equals(scope.workId).toArray()).filter(row => {
    try { return (JSON.parse(row.manifestJson) as { productType?: string }).productType === 'avg' } catch { return false }
  })
  return Promise.all(rows.map(async release => {
    try { await assertProductReleaseUnchanged(release.id!); return { release, manifest: parseAvgProductReleaseManifest(release.manifestJson), error: '' } }
    catch (error) { return { release, manifest: null, error: error instanceof Error ? error.message : String(error) } }
  }))
}

async function assertSession(scope: WorkspaceScope, id: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(id, scope)
  if (session.kind !== 'avg') throw new Error('[avg] 该存档不是视觉小说存档')
  return session
}

async function ensureAutomaticCheckpoint(sessionId: number): Promise<void> {
  const state = await readProductRuntimeState(sessionId)
  const node = state.narrative?.nodes.find(item => item.key === state.narrative?.currentNodeKey)
  if (!node) return
  const existing = await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId)
    .filter(item => item.throughSequence === state.lastSequence && item.name.startsWith('自动 · ')).first()
  if (!existing) await createProductRuntimeCheckpoint({ sessionId, name: `自动 · ${node.title}`, throughSequence: state.lastSequence })
}

export const useAvgGamePlayerStore = create<AvgGamePlayerState>((set, get) => {
  const details = async (id: number) => {
    const scope = get().scope!; const session = await assertSession(scope, id)
    const [events, checkpoints, runtimeState] = await Promise.all([
      db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence'), db.productRuntimeCheckpoints.where('sessionId').equals(id).toArray(), readProductRuntimeState(id),
    ])
    let selectedManifest = get().selectedManifest
    let selectedMediaResolver = get().selectedMediaResolver
    if (get().selectedSourceSessionId !== id || !selectedManifest || !selectedMediaResolver) {
      const source = session.productBuildId != null
        ? {
            kind: 'build' as const,
            productBuildId: session.productBuildId,
            expectedPreviewHash: (await db.productBuilds.get(session.productBuildId))?.previewHash ?? '',
          }
        : session.productReleaseId != null
          ? { kind: 'release' as const, productReleaseId: session.productReleaseId }
          : null
      if (!source) throw new Error('[avg] 正式 AVG 存档缺少 Build/Release 可玩来源')
      const resolved = await resolveProductRuntimeSource({ scope, source })
      get().selectedMediaResolver?.dispose()
      selectedManifest = playableManifest(resolved.runtimePackage)
      selectedMediaResolver = resolved.mediaResolver
    }
    set({
      events, checkpoints: checkpoints.sort((a, b) => b.createdAt - a.createdAt), runtimeState,
      selectedManifest, selectedMediaResolver, selectedSourceSessionId: id,
      speakerNames: runtimePackageSpeakerNames(selectedManifest),
    })
  }
  const reload = async (selected?: number | null) => {
    const scope = get().scope!; const worldGroupId = get().worldGroupId
    const [releases, sessions] = await Promise.all([library(scope), readBoundInstances(scope).then(rows => rows.filter(row => row.kind === 'avg' && (row.worldGroupId ?? null) === worldGroupId))])
    const explicitlySelected = selected !== undefined
    const wanted = explicitlySelected ? selected : get().selectedSessionId
    const id = wanted != null && sessions.some(row => row.id === wanted)
      ? wanted
      : explicitlySelected ? null : sessions[0]?.id ?? null
    set({ releases, sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt), selectedSessionId: id })
    if (id != null) await details(id); else {
      get().selectedMediaResolver?.dispose()
      set({ events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, selectedMediaResolver: null, selectedSourceSessionId: null, speakerNames: {} })
    }
  }
  const act = async (fn: () => Promise<unknown>) => { set({ busy: true, error: '' }); try { await fn() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error } finally { set({ busy: false }) } }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null, events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, selectedMediaResolver: null, selectedSourceSessionId: null, speakerNames: {}, loading: false, busy: false, error: '',
    load: async (scope, worldGroupId, openLibrary = false) => { set({ scope, worldGroupId, loading: true, error: '' }); try { await reload(openLibrary ? null : undefined) } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) } finally { set({ loading: false }) } },
    select: async id => { set({ selectedSessionId: id, loading: true }); try { if (id == null) { get().selectedMediaResolver?.dispose(); set({ runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, selectedMediaResolver: null, selectedSourceSessionId: null, speakerNames: {} }) } else await details(id) } finally { set({ loading: false }) } },
    start: async (releaseId, title) => { let id = 0; await act(async () => { const item = get().releases.find(row => row.release.id === releaseId); if (!item?.manifest || !get().scope) throw new Error('[avg] 请选择有效发布'); const session = await createAvgGameInstance({ scope: get().scope!, productReleaseId: releaseId, title: title || `${item.manifest.definition.title} · 新游戏`, worldGroupId: get().worldGroupId }); id = session.id!; await ensureAutomaticCheckpoint(id); await reload(id) }); return id },
    preloadMedia: async (maximumBytes = 64 * 1024 * 1024) => {
      const resolver = get().selectedMediaResolver
      const assets = get().selectedManifest?.presentation.assets ?? []
      if (!resolver) return { urls: {}, failures: assets.map(asset => ({ assetKey: asset.assetKey, reason: '可玩媒资解析器未就绪' })) }
      const result = await resolver.preload({ assetKeys: assets.map(asset => asset.assetKey), maximumBytes })
      return { urls: result.urls, failures: result.failures }
    },
    reachBeat: async beatKey => act(async () => { const id = get().selectedSessionId; if (id == null || !get().scope) throw new Error('[avg] 请先开始游戏'); await assertSession(get().scope!, id); const base = await readProductRuntimeStateVersion(id); const nodeKey = get().runtimeState.narrative?.currentNodeKey ?? 'unknown'; const visit = get().runtimeState.narrative?.visitedNodeKeys.filter(key => key === nodeKey).length ?? 0; await reachAvgPresentationBeat({ sessionId: id, beatKey, commandId: `avg:beat:${id}:${nodeKey}:${visit}:${beatKey}`, baseSequence: base.sequence, baseStateHash: base.stateHash, snapshotKey: `node:${nodeKey}:visit:${visit}` }); await details(id) }),
    choose: async choiceKey => act(async () => { const id = get().selectedSessionId; if (id == null || !get().scope) throw new Error('[avg] 请先开始游戏'); await assertSession(get().scope!, id); const base = await readProductRuntimeStateVersion(id); await commitNarrativeChoice({ sessionId: id, choiceKey, commandId: `avg:choice:${id}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash }); await ensureAutomaticCheckpoint(id); await details(id) }),
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
    saveCheckpoint: async name => act(async () => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); await createProductRuntimeCheckpoint({ sessionId: id, name }); await details(id) }),
    forkCheckpoint: async (checkpointId, title) => { let id = 0; await act(async () => { const checkpoint = get().checkpoints.find(row => row.id === checkpointId); if (!checkpoint || !await verifyProductRuntimeCheckpoint(checkpointId)) throw new Error('[avg] 检查点无效'); const child = await branchProductRuntimeSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: title || `AVG 分支 · ${checkpoint.name}` }); id = child.id!; await reload(id) }); return id },
    remove: async id => act(async () => { if (!get().scope) throw new Error('[avg] scope 缺失'); await assertSession(get().scope!, id); await deleteProductRuntimeSession(id); await reload(get().selectedSessionId === id ? null : undefined) }),
  }
})
