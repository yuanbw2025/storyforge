import { commitAvgVoiceCommandV1 } from '../lib/avg/runtime-api'
import { commitAvgOnceAudioCommandV1 } from '../lib/avg/runtime-api'
import type { AvgOnceAudioActionV1 } from '../lib/avg/once-audio-commands'
import type { AVG_VOICE_OUTCOMES_V1 } from '../lib/avg/reading-contract'
import { commitAvgInventoryActionV1 } from '../lib/avg/runtime-api'
import type { AvgInventoryPlanV1 } from '../lib/avg/inventory-contract'
import { avgRuntimeStage } from '../lib/avg/executable-module'
import { sameAvgPlayerScopeV1 } from '../lib/avg/player-source-identity'
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { branchProductRuntimeSession, commitNarrativeChoice, createProductRuntimeCheckpoint, deleteProductRuntimeSession, reachAvgPresentationBeat, readProductRuntimeState, readProductRuntimeStateVersion, recordAvgMediaFailure, verifyProductRuntimeCheckpoint } from '../lib/avg/runtime-api'
import { assertProductReleaseUnchanged, parseAvgProductReleaseManifest, runtimePackageSpeakerNames } from '../lib/product/releases'
import { assertInstanceBinding, createAvgGameInstance, readBoundInstances } from '../lib/product/runtime-instances'
import { resolveProductRuntimeSource } from '../lib/product-production/preview-source'
import type { AvgPlayableRuntimePackage, ProductMediaResolverV1, ProductRelease, AnyProductRuntimePackage, ProductRuntimeCheckpoint, ProductRuntimeEvent, ProductRuntimeState, ProductRuntimeSession, WorkspaceScope } from '../lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'

export interface AvgLibraryItem { release: ProductRelease; manifest: AvgPlayableRuntimePackage | null; error: string }
interface AvgGamePlayerState {
  scope: WorkspaceScope | null; worldGroupId: number | null; releases: AvgLibraryItem[]; sessions: ProductRuntimeSession[]
  selectedSessionId: number | null; events: ProductRuntimeEvent[]; checkpoints: ProductRuntimeCheckpoint[]; runtimeState: ProductRuntimeState
  selectedManifest: AvgPlayableRuntimePackage | null; selectedMediaResolver: ProductMediaResolverV1 | null
  selectedSourceSessionId: number | null; speakerNames: Record<string, string>; loading: boolean; busy: boolean; error: string
  load(scope: WorkspaceScope, worldGroupId: number | null, openLibrary?: boolean): Promise<void>; select(id: number | null): Promise<void>
  start(releaseId: number, title?: string): Promise<number>; reachBeat(beatKey: string): Promise<void>; choose(choiceKey: string): Promise<void>
  voiceCommand(input: { lineKey: string; visit: number; expectedSessionId?:number } & ({ type: 'start' } | { type: 'observe'; generation: string; outcome: typeof AVG_VOICE_OUTCOMES_V1[number]; reason: string; playedMs: number })): Promise<string>
  onceAudioCommand(input: AvgOnceAudioActionV1 & { cueKey: string; visit: number; expectedSessionId: number }): Promise<number>
  actOnItem(actionKey: string, target: AvgInventoryPlanV1['actions'][number]['target']): Promise<void>
  preloadMedia(maximumBytes?: number, windowKeys?: readonly string[]): Promise<{ urls: Record<string, string>; failures: Array<{ assetKey: string; reason: string }> }>
  recordMediaFailures(failures: Array<{ assetKey: string; reason: string }>): Promise<void>
  saveCheckpoint(name: string): Promise<void>; forkCheckpoint(id: number, title?: string): Promise<number>; remove(id: number): Promise<void>
}

function playableManifest(runtimePackage: AnyProductRuntimePackage): AvgPlayableRuntimePackage {
  if (runtimePackage.productType !== 'avg' || !avgRuntimeStage(runtimePackage)) {
    throw new Error('[avg] 当前可玩来源不是完整 AVG RuntimePackage')
  }
  return structuredClone(runtimePackage) as AvgPlayableRuntimePackage
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
  let detailRequest = 0, libraryRequest = 0, ownerEpoch = 0, viewRequest = 0, actionRequest = 0
  const owner = () => {
    const scope=get().scope
    if(!scope)throw new Error('[avg] 请先读取作品')
    return {scope:{...scope},worldGroupId:get().worldGroupId,epoch:ownerEpoch,view:viewRequest}
  }
  const isCurrentOwner = (context:ReturnType<typeof owner>) => context.epoch===ownerEpoch&&context.view===viewRequest
    &&sameAvgPlayerScopeV1(context.scope,get().scope)&&context.worldGroupId===get().worldGroupId
  const clearSource = () => {
    ++detailRequest
    get().selectedMediaResolver?.dispose()
    set({events:[],checkpoints:[],runtimeState:structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),selectedManifest:null,
      selectedMediaResolver:null,selectedSourceSessionId:null,speakerNames:{}})
  }
  const details = async (id: number, context=owner()) => {
    if(!isCurrentOwner(context))return
    const request = ++detailRequest
    const scope = context.scope; const session = await assertSession(scope, id)
    const [events, checkpoints, runtimeState] = await Promise.all([
      db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence'), db.productRuntimeCheckpoints.where('sessionId').equals(id).toArray(), readProductRuntimeState(id),
    ])
    let createdResolver = false
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
      createdResolver = true
      selectedManifest = playableManifest(resolved.runtimePackage)
      selectedMediaResolver = resolved.mediaResolver
    }
    if (request !== detailRequest || !isCurrentOwner(context) || get().selectedSessionId !== id) {
      if (createdResolver) selectedMediaResolver?.dispose()
      return
    }
    if (createdResolver) get().selectedMediaResolver?.dispose()
    set({
      events, checkpoints: checkpoints.sort((a, b) => b.createdAt - a.createdAt), runtimeState,
      selectedManifest, selectedMediaResolver, selectedSourceSessionId: id,
      speakerNames: runtimePackageSpeakerNames(selectedManifest),
    })
  }
  const reload = async (selected?: number | null, context=owner()) => {
    if(!isCurrentOwner(context))return
    const request=++libraryRequest
    const scope = context.scope; const worldGroupId = context.worldGroupId
    const [releases, sessions] = await Promise.all([library(scope), readBoundInstances(scope).then(rows => rows.filter(row => row.kind === 'avg' && (row.worldGroupId ?? null) === worldGroupId))])
    if(request!==libraryRequest||!isCurrentOwner(context))return
    const explicitlySelected = selected !== undefined
    const wanted = explicitlySelected ? selected : get().selectedSessionId
    const id = wanted != null && sessions.some(row => row.id === wanted)
      ? wanted
      : explicitlySelected ? null : sessions[0]?.id ?? null
    set({ releases, sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt), selectedSessionId: id })
    if (id != null) await details(id,context); else clearSource()
  }
  const act = async (fn: (context:ReturnType<typeof owner>) => Promise<unknown>) => {
    if(get().loading)throw new Error('[avg] 当前存档正在读取，请等待完成')
    const context=owner(),request=++actionRequest
    set({busy:true,error:''})
    try{await fn(context)}catch(error){if(isCurrentOwner(context))set({error:error instanceof Error?error.message:String(error)});throw error}
    finally{if(request===actionRequest&&isCurrentOwner(context))set({busy:false})}
  }
  // Simultaneously due channels share one CAS state. Serialize their original
  // commands, never retry a rejected/unknown result, and pin the queued owner.
  let transportTail: Promise<unknown> = Promise.resolve()
  const transportAct = (sessionId: number, fn: (context:ReturnType<typeof owner>) => Promise<unknown>) => {
    const context = owner()
    const result = transportTail.then(() => {
      if (!isCurrentOwner(context) || get().selectedSessionId !== sessionId) throw new Error('[avg] 声音回调不属于当前存档')
      return act(fn)
    })
    transportTail = result.catch(() => undefined)
    return result
  }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null, events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, selectedMediaResolver: null, selectedSourceSessionId: null, speakerNames: {}, loading: false, busy: false, error: '',
    load: async (scope, worldGroupId, openLibrary = false) => {
      ++ownerEpoch;++libraryRequest
      const request=++viewRequest,changed=!sameAvgPlayerScopeV1(scope,get().scope)||worldGroupId!==get().worldGroupId
      if(changed||openLibrary){clearSource();set({sessions:[],releases:[],selectedSessionId:null,busy:false})}
      set({scope:{...scope},worldGroupId,loading:true,busy:false,error:''})
      const context=owner()
      try{await reload(openLibrary?null:undefined,context)}catch(error){if(isCurrentOwner(context))set({error:error instanceof Error?error.message:String(error)})}
      finally{if(request===viewRequest&&isCurrentOwner(context))set({loading:false})}
    },
    select: async id => {
      if(id===null&&!get().scope){++viewRequest;clearSource();set({selectedSessionId:null,loading:false});return}
      const request=++viewRequest,context=owner()
      clearSource();set({selectedSessionId:id,loading:true,busy:false,error:''})
      try{if(id!=null)await details(id,context)}
      catch(error){if(request===viewRequest&&isCurrentOwner(context))set({selectedSessionId:null,error:error instanceof Error?error.message:String(error)});throw error}
      finally{if(request===viewRequest&&isCurrentOwner(context))set({loading:false})}
    },
    start: async (releaseId, title) => { let id = 0; await act(async context => { const item = get().releases.find(row => row.release.id === releaseId); if (!item?.manifest) throw new Error('[avg] 请选择有效发布'); const session = await createAvgGameInstance({ scope: context.scope, productReleaseId: releaseId, title: title || `${item.manifest.definition.title} · 新游戏`, worldGroupId: context.worldGroupId }); id = session.id!; await ensureAutomaticCheckpoint(id); await reload(id,context) }); return id },
    preloadMedia: async (maximumBytes = 64 * 1024 * 1024, windowKeys) => {
      const resolver = get().selectedMediaResolver
      const selected = get().selectedManifest
      const assets = selected ? avgRuntimeStage(selected)?.assets ?? [] : []
      if (!resolver) return { urls: {}, failures: assets.map(asset => ({ assetKey: asset.assetKey, reason: '可玩媒资解析器未就绪' })) }
      const result = await resolver.preload({ assetKeys: windowKeys ? [...windowKeys] : assets.map(asset => asset.assetKey), maximumBytes,
        ...(windowKeys ? {retainOnlyRequested:true} : {}) })
      return { urls: result.urls, failures: result.failures }
    },
    reachBeat: async beatKey => act(async context => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); const nodeKey = get().runtimeState.narrative?.currentNodeKey ?? 'unknown'; const visit = get().runtimeState.narrative?.visitedNodeKeys.filter(key => key === nodeKey).length ?? 0; await assertSession(context.scope, id); const base = await readProductRuntimeStateVersion(id); await reachAvgPresentationBeat({ sessionId: id, beatKey, commandId: `avg:beat:${id}:${nodeKey}:${visit}:${beatKey}`, baseSequence: base.sequence, baseStateHash: base.stateHash, snapshotKey: `node:${nodeKey}:visit:${visit}` }); await details(id,context) }),
    choose: async choiceKey => act(async context => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); await assertSession(context.scope, id); const base = await readProductRuntimeStateVersion(id); await commitNarrativeChoice({ sessionId: id, choiceKey, commandId: `avg:choice:${id}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash }); await ensureAutomaticCheckpoint(id); await details(id,context) }),
    voiceCommand: async input => {
      let generation = ''
      const { expectedSessionId, ...command } = input
      if (expectedSessionId !== undefined && expectedSessionId !== get().selectedSessionId) throw new Error('[avg] 声音回调不属于当前存档')
      await transportAct(expectedSessionId ?? get().selectedSessionId!, async context => {
        const id = get().selectedSessionId
        if (id == null) throw new Error('[avg] 请先开始游戏')
        if (expectedSessionId !== undefined && expectedSessionId !== id) throw new Error('[avg] 声音回调不属于当前存档')
        await assertSession(context.scope, id)
        const base = await readProductRuntimeStateVersion(id)
        const event = await commitAvgVoiceCommandV1({ ...command, sessionId: id, commandId: `avg:voice:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
        generation = JSON.parse(event.payloadJson).generation as string
        await details(id, context)
      })
      // Release playback only after the already queued channel admissions have
      // settled. Short SFX must not finish while another due channel is writing.
      if (command.type === 'start') await transportTail
      return generation
    },
    onceAudioCommand: async input => {
      let generation = 0
      const { expectedSessionId, ...command } = input
      await transportAct(expectedSessionId, async context => {
        await assertSession(context.scope, expectedSessionId)
        const base = await readProductRuntimeStateVersion(expectedSessionId)
        const event = await commitAvgOnceAudioCommandV1({ ...command, sessionId: expectedSessionId,
          commandId: `avg:audio:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
        generation = JSON.parse(event.payloadJson).generation as number
        await details(expectedSessionId, context)
      })
      if (command.type === 'start') await transportTail
      return generation
    },
    actOnItem: async (actionKey, target) => act(async context => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); await assertSession(context.scope, id); const base = await readProductRuntimeStateVersion(id); await commitAvgInventoryActionV1({ sessionId: id, actionKey, target, commandId: `avg:item:${id}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash }); await details(id,context) }),
    recordMediaFailures: async failures => {
      const id = get().selectedSessionId
      const manifest = get().selectedManifest
      const recordedKeys = new Set(get().runtimeState.presentation?.mediaFailures.map(item => item.assetKey) ?? [])
      const pending = failures.filter(failure => !recordedKeys.has(failure.assetKey))
      if (id == null || !get().scope || !manifest || pending.length === 0) return
      await act(async context => {
        await assertSession(context.scope, id)
        for (const failure of pending) {
          const asset = avgRuntimeStage(manifest)!.assets.find(item => item.assetKey === failure.assetKey)
          if (!asset) continue
          await recordAvgMediaFailure({ sessionId: id, assetKey: failure.assetKey, reason: failure.reason, commandId: `avg:media-failed:${id}:${failure.assetKey}:${asset.version}` })
        }
        await details(id,context)
      })
    },
    saveCheckpoint: async name => act(async context => { const id = get().selectedSessionId; if (id == null) throw new Error('[avg] 请先开始游戏'); await assertSession(context.scope,id);await createProductRuntimeCheckpoint({ sessionId: id, name }); await details(id,context) }),
    forkCheckpoint: async (checkpointId, title) => { let id = 0; await act(async context => { const checkpoint = get().checkpoints.find(row => row.id === checkpointId); if (!checkpoint || !await verifyProductRuntimeCheckpoint(checkpointId)) throw new Error('[avg] 检查点无效'); const child = await branchProductRuntimeSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: title || `AVG 分支 · ${checkpoint.name}` }); id = child.id!; await reload(id,context) }); return id },
    remove: async id => act(async context => { const selected=get().selectedSessionId;await assertSession(context.scope, id); await deleteProductRuntimeSession(id); await reload(selected === id ? null : undefined,context) }),
  }
})
