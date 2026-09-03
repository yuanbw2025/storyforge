import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { availableAdventureActions } from '../lib/adventure/runtime'
import {
  adoptOpenWorldRuntimeCandidateV1,
  generateOpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeSkillIdV1,
} from '../lib/open-world/harness'
import {
  branchProductRuntimeSession,
  commitAdventureAction,
  commitNarrativeChoice,
  commitOpenWorldCommand,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  verifyProductRuntimeCheckpoint,
  type OpenWorldCommand,
} from '../lib/open-world/runtime-api'
import { verifyProductRuntimeSessionSourceV1 } from '../lib/product-production/preview-source'
import { assertProductReleaseUnchanged, parseTextOpenWorldProductReleaseManifest } from '../lib/product/releases'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'
import type {
  AIConfig,
  ProductRelease,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  TextOpenWorldProductRuntimePackageV1,
  WorkspaceScope,
} from '../lib/types'
import { assertInstanceBinding, createTextOpenWorldInstance, readBoundInstances } from '../lib/product/runtime-instances'

export interface TextOpenWorldLibraryItem {
  release: ProductRelease
  manifest: TextOpenWorldProductRuntimePackageV1 | null
  error: string
}

interface TextOpenWorldPlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: TextOpenWorldLibraryItem[]
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  runtimeState: ProductRuntimeState
  selectedManifest: TextOpenWorldProductRuntimePackageV1 | null
  generatedCandidate: OpenWorldRuntimeCandidateV1 | null
  loading: boolean
  busy: boolean
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(productReleaseId: number, title?: string): Promise<number>
  command(command: OpenWorldCommand): Promise<void>
  resolveAdventureAction(actionKey: string): Promise<void>
  choose(choiceKey: string): Promise<void>
  generatePresentation(skillId: OpenWorldRuntimeSkillIdV1, objective: string, aiConfig: AIConfig): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readLibrary(scope: WorkspaceScope): Promise<TextOpenWorldLibraryItem[]> {
  const releases = (await db.productReleases.where('workId').equals(scope.workId).toArray())
    .filter(release => {
      try { return (JSON.parse(release.manifestJson) as { productType?: string }).productType === 'text-open-world' }
      catch { return false }
    })
    .sort((left, right) => right.createdAt - left.createdAt)
  return Promise.all(releases.map(async release => {
    try {
      await assertProductReleaseUnchanged(release.id!)
      return { release, manifest: parseTextOpenWorldProductReleaseManifest(release.manifestJson), error: '' }
    } catch (error) {
      return { release, manifest: null, error: error instanceof Error ? error.message : String(error) }
    }
  }))
}

async function assertSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'text-open-world') throw new Error('[text-open-world] 该存档不是文字开放世界。')
  return session
}

function playableManifest(runtimePackage: Awaited<ReturnType<typeof verifyProductRuntimeSessionSourceV1>>['runtimePackage']) {
  if (runtimePackage.productType !== 'text-open-world' || !runtimePackage.openWorld
    || !runtimePackage.adventure || !runtimePackage.openWorldEvolution || !runtimePackage.interaction) {
    throw new Error('[text-open-world] 该存档没有绑定有效的 Product Build 或 ProductRelease。')
  }
  return structuredClone(runtimePackage) as TextOpenWorldProductRuntimePackageV1
}

async function readDetails(scope: WorkspaceScope, sessionId: number) {
  const session = await assertSession(scope, sessionId)
  const [events, checkpoints, runtimeState, playable] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
    verifyProductRuntimeSessionSourceV1({ scope, session }),
  ])
  return {
    events,
    checkpoints: checkpoints.sort((left, right) => right.createdAt - left.createdAt),
    runtimeState,
    selectedManifest: playableManifest(playable.runtimePackage),
  }
}

export const useTextOpenWorldPlayerStore = create<TextOpenWorldPlayerState>((set, get) => {
  const refresh = async () => {
    const scope = get().scope
    const sessionId = get().selectedSessionId
    if (!scope || sessionId == null) return
    set(await readDetails(scope, sessionId))
  }
  const reload = async (requested?: number | null) => {
    const scope = get().scope
    if (!scope) return
    if (requested !== undefined) set({ generatedCandidate: null })
    const [releases, sessions] = await Promise.all([
      readLibrary(scope),
      readBoundInstances(scope).then(rows => rows.filter(row => row.kind === 'text-open-world'
        && (row.worldGroupId ?? null) === get().worldGroupId).sort((left, right) => right.updatedAt - left.updatedAt)),
    ])
    const desired = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = desired != null && sessions.some(row => row.id === desired) ? desired : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, generatedCandidate: null })
  }
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    set({ busy: true, error: '' })
    try { return await operation() }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); throw error }
    finally { set({ busy: false }) }
  }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null, events: [], checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, generatedCandidate: null, loading: false, busy: false, error: '',
    load: async (scope, worldGroupId) => {
      set({ scope, worldGroupId, loading: true, error: '', generatedCandidate: null })
      try { await reload() } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
      finally { set({ loading: false }) }
    },
    select: async sessionId => {
      set({ selectedSessionId: sessionId, loading: true, generatedCandidate: null })
      try { if (sessionId == null) set({ runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, generatedCandidate: null }); else await refresh() }
      finally { set({ loading: false }) }
    },
    start: async (productReleaseId, title) => run(async () => {
      const item = get().releases.find(row => row.release.id === productReleaseId)
      if (!item?.manifest || !get().scope) throw new Error('[text-open-world] 请选择有效发布。')
      const session = await createTextOpenWorldInstance({ scope: get().scope!, productReleaseId, title: title?.trim() || `${item.manifest.definition.title} · 新旅程`, worldGroupId: get().worldGroupId })
      await reload(session.id!)
      return session.id!
    }),
    command: async command => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[text-open-world] 请先开始正式开放世界。')
      await assertSession(get().scope!, sessionId)
      const base = await readProductRuntimeStateVersion(sessionId)
      await commitOpenWorldCommand({ sessionId, command, commandId: `text-open-world:${command.kind}:${sessionId}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
      set({ generatedCandidate: null })
      await refresh()
    }),
    resolveAdventureAction: async actionKey => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[text-open-world] 请先开始正式开放世界。')
      await assertSession(get().scope!, sessionId)
      const base = await readProductRuntimeStateVersion(sessionId)
      await commitAdventureAction({ sessionId, actionKey, commandId: `text-open-world:adventure:${sessionId}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
      set({ generatedCandidate: null })
      await refresh()
    }),
    choose: async choiceKey => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[text-open-world] 请先开始正式开放世界。')
      await assertSession(get().scope!, sessionId)
      const base = await readProductRuntimeStateVersion(sessionId)
      await commitNarrativeChoice({ sessionId, choiceKey, commandId: `text-open-world:ending:${sessionId}:${crypto.randomUUID()}`, baseSequence: base.sequence, baseStateHash: base.stateHash })
      set({ generatedCandidate: null })
      await refresh()
    }),
    generatePresentation: async (skillId, objective, aiConfig) => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const generated = await generateOpenWorldRuntimeCandidateV1({
        scope: get().scope!,
        productRuntimeSessionId: sessionId,
        skillId,
        objective,
        aiConfig,
      })
      await adoptOpenWorldRuntimeCandidateV1({ scope: get().scope!, runId: generated.snapshot.run.id })
      set({ generatedCandidate: generated.candidate })
    }),
    saveCheckpoint: async name => run(async () => {
      if (get().selectedSessionId == null) throw new Error('[text-open-world] 请先开始正式开放世界。')
      await createProductRuntimeCheckpoint({ sessionId: get().selectedSessionId!, name })
      await refresh()
    }),
    forkCheckpoint: async (checkpointId, title) => run(async () => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      if (!checkpoint || !await verifyProductRuntimeCheckpoint(checkpointId)) throw new Error('[text-open-world] 检查点无效。')
      const child = await branchProductRuntimeSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: title?.trim() || `世界分支 · ${checkpoint.name}` })
      await reload(child.id!)
      return child.id!
    }),
    forkCurrent: async title => run(async () => {
      if (get().selectedSessionId == null) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const state = await readProductRuntimeState(get().selectedSessionId!)
      const child = await branchProductRuntimeSession({ parentSessionId: get().selectedSessionId!, throughSequence: state.lastSequence, title: title?.trim() || '开放世界分支' })
      await reload(child.id!)
      return child.id!
    }),
    remove: async sessionId => run(async () => {
      if (!get().scope) throw new Error('[text-open-world] scope 缺失。')
      await assertSession(get().scope!, sessionId)
      await deleteProductRuntimeSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})

export function selectTextOpenWorldAdventureActions(state: TextOpenWorldPlayerState) {
  if (!state.selectedManifest || !state.runtimeState.adventure) return []
  return availableAdventureActions(state.selectedManifest.adventure, state.runtimeState.adventure, state.runtimeState.narrative?.variables)
    .filter(item => item.action.kind !== 'move')
}
