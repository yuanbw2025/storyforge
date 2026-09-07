import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { availableAdventureActions } from '../lib/adventure/runtime'
import { createTextOpenWorldActionRegistryV1 } from '../lib/open-world/action-registry'
import { executeTextOpenWorldActionV1 } from '../lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
  inspectTextOpenWorldCheckpointV1,
  retryDefeatedTextOpenWorldCombatV1,
} from '../lib/open-world/checkpoints'
import {
  adoptOpenWorldRuntimeCandidateV1,
  generateOpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeSkillIdV1,
} from '../lib/open-world/harness'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../lib/open-world/session-binding'
import { deriveTextOpenWorldContextsV1 } from '../lib/open-world/session-projection'
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
import { verifyProductReleaseManifestV1 } from '../lib/product-production/runtime-package'
import {
  assertProductReleaseUnchanged,
  classifyTextOpenWorldRuntimePackageShapeV1,
  parseTextOpenWorldProductReleaseManifest,
} from '../lib/product/releases'
import { assertInstanceBinding, createTextOpenWorldInstance, readBoundInstances } from '../lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'
import { resolveScope } from '../lib/workspace/scope'
import type {
  AIConfig,
  ProductRelease,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  PlayableTextOpenWorldProductRuntimePackageV1,
  TextOpenWorldCommandSourceV1,
  TextOpenWorldFeedbackReceiptV1,
  WorkspaceScope,
} from '../lib/types'

export interface TextOpenWorldLibraryItem {
  release: ProductRelease
  manifest: PlayableTextOpenWorldProductRuntimePackageV1 | null
  /** Hash of the verified immutable RuntimePackage inside the release envelope. */
  packageHash: string | null
  error: string
}

export type TextOpenWorldSelectedSessionSource = 'release' | 'build-preview'

export interface TextOpenWorldExecuteActionOptions {
  commandId?: string
  confirmed?: boolean
  source?: TextOpenWorldCommandSourceV1
  expectedBaseSequence?: number
}

interface TextOpenWorldProjectionRequest {
  revision: number
  scope: WorkspaceScope
  worldGroupId: number | null
}

export interface TextOpenWorldPlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: TextOpenWorldLibraryItem[]
  /** All bound sessions; presentation separates formal saves from Build Preview. */
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  /** Explicitly selected row, including a Build Preview handoff omitted from sessions. */
  selectedSession: ProductRuntimeSession | null
  selectedSessionSource: TextOpenWorldSelectedSessionSource | null
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  runtimeState: ProductRuntimeState
  selectedManifest: PlayableTextOpenWorldProductRuntimePackageV1 | null
  lastFeedback: TextOpenWorldFeedbackReceiptV1 | null
  generatedCandidate: OpenWorldRuntimeCandidateV1 | null
  loading: boolean
  busy: boolean
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null, initialSessionId?: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(productReleaseId: number, title?: string): Promise<number>
  command(command: OpenWorldCommand): Promise<void>
  resolveAdventureAction(actionKey: string): Promise<void>
  choose(choiceKey: string): Promise<void>
  executeVNextAction(
    actionKey: string,
    targetKey?: string | null,
    options?: TextOpenWorldExecuteActionOptions,
  ): Promise<TextOpenWorldFeedbackReceiptV1>
  generatePresentation(skillId: OpenWorldRuntimeSkillIdV1, objective: string, aiConfig: AIConfig): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  retryDefeatedCombat(title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readLibrary(scope: WorkspaceScope): Promise<TextOpenWorldLibraryItem[]> {
  const releases = (await db.productReleases.where('workId').equals(scope.workId).toArray())
    .filter(release => release.projectId === scope.projectId
      && release.worldId === scope.worldId
      && release.workId === scope.workId
      && release.productType === 'text-open-world')
    .sort((left, right) => right.createdAt - left.createdAt)
  return Promise.all(releases.map(async release => {
    try {
      const verifiedRelease = await assertProductReleaseUnchanged(release.id!)
      const verified = await verifyProductReleaseManifestV1(verifiedRelease.manifestJson)
      if (verifiedRelease.productionKey !== verified.productionProvenance.productionKey) {
        throw new Error('[text-open-world] ProductRelease 与生产谱系不一致。')
      }
      return {
        release: verifiedRelease,
        manifest: parseTextOpenWorldProductReleaseManifest(verifiedRelease.manifestJson),
        packageHash: verified.packageHash,
        error: '',
      }
    } catch (error) {
      return {
        release,
        manifest: null,
        packageHash: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }))
}

async function assertSessionOwnership(
  scope: WorkspaceScope,
  worldGroupId: number | null,
  sessionId: number,
): Promise<ProductRuntimeSession> {
  const resolved = await resolveScope({ scope })
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session
    || session.projectId !== resolved.projectId
    || session.worldId !== resolved.worldId
    || session.workId !== resolved.workId
    || (session.worldGroupId ?? null) !== (worldGroupId ?? null)
    || session.kind !== 'text-open-world') {
    throw new Error('[text-open-world] 只能删除当前World/Work和世界分组内的文字开放世界存档。')
  }
  return session
}

async function assertSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'text-open-world') throw new Error('[text-open-world] 该存档不是文字开放世界。')
  return session
}

function sessionSource(session: ProductRuntimeSession): TextOpenWorldSelectedSessionSource {
  return session.productReleaseId != null ? 'release' : 'build-preview'
}

function emptySelectionState(error = '') {
  return {
    selectedSessionId: null,
    selectedSession: null,
    selectedSessionSource: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    generatedCandidate: null,
    lastFeedback: null,
    error,
  }
}

function playableManifest(runtimePackage: Awaited<ReturnType<typeof verifyProductRuntimeSessionSourceV1>>['runtimePackage']) {
  if (runtimePackage.productType !== 'text-open-world') {
    throw new Error('[text-open-world] 该存档没有绑定有效的 Product Build 或 ProductRelease。')
  }
  classifyTextOpenWorldRuntimePackageShapeV1(runtimePackage)
  return structuredClone(runtimePackage) as PlayableTextOpenWorldProductRuntimePackageV1
}

async function readDetails(scope: WorkspaceScope, worldGroupId: number | null, sessionId: number) {
  const session = await assertSession(scope, sessionId)
  if ((session.worldGroupId ?? null) !== (worldGroupId ?? null)) {
    throw new Error('[text-open-world] 该存档不属于当前世界分组。')
  }
  const [events, checkpoints, runtimeState, playable] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
    verifyProductRuntimeSessionSourceV1({ scope, session }),
  ])
  const selectedManifest = playableManifest(playable.runtimePackage)
  if (runtimeState.textOpenWorld) {
    const binding = await verifyTextOpenWorldVNextSessionBindingV1(session)
    if (!selectedManifest.textOpenWorldVNext
      || binding.runtimePackage.metadata.packageKey !== selectedManifest.textOpenWorldVNext.metadata.packageKey) {
      throw new Error('[text-open-world] vNext 运行投影与冻结产品来源不一致。')
    }
  }
  return {
    selectedSessionId: session.id!,
    selectedSession: session,
    selectedSessionSource: sessionSource(session),
    events,
    checkpoints: checkpoints.sort((left, right) => right.createdAt - left.createdAt),
    runtimeState,
    selectedManifest,
  }
}

export const useTextOpenWorldPlayerStore = create<TextOpenWorldPlayerState>((set, get) => {
  let projectionRequestRevision = 0
  const beginProjectionRequest = (
    scope: WorkspaceScope,
    worldGroupId: number | null,
  ): TextOpenWorldProjectionRequest => ({
    revision: ++projectionRequestRevision,
    scope: { ...scope },
    worldGroupId,
  })
  const captureProjectionRequest = (): TextOpenWorldProjectionRequest | null => {
    const scope = get().scope
    return scope ? {
      revision: projectionRequestRevision,
      scope: { ...scope },
      worldGroupId: get().worldGroupId,
    } : null
  }
  const isCurrentProjectionRequest = (request: TextOpenWorldProjectionRequest): boolean => {
    const currentScope = get().scope
    return projectionRequestRevision === request.revision
      && currentScope != null
      && currentScope.projectId === request.scope.projectId
      && currentScope.worldId === request.scope.worldId
      && currentScope.workId === request.scope.workId
      && (get().worldGroupId ?? null) === (request.worldGroupId ?? null)
  }
  const isCurrentSessionRequest = (
    request: TextOpenWorldProjectionRequest,
    sessionId: number,
  ): boolean => isCurrentProjectionRequest(request) && get().selectedSessionId === sessionId
  const refresh = async (
    providedRequest?: TextOpenWorldProjectionRequest,
    providedSessionId?: number,
  ) => {
    const request = providedRequest ?? captureProjectionRequest()
    const sessionId = providedSessionId ?? get().selectedSessionId
    if (!request || sessionId == null || !isCurrentSessionRequest(request, sessionId)) return
    try {
      const details = await readDetails(request.scope, request.worldGroupId, sessionId)
      if (isCurrentSessionRequest(request, sessionId)) set(details)
    } catch (error) {
      if (!isCurrentSessionRequest(request, sessionId)) return
      throw error
    }
  }
  const reload = async (
    requested?: number | null,
    providedRequest?: TextOpenWorldProjectionRequest,
  ) => {
    const request = providedRequest ?? captureProjectionRequest()
    if (!request || !isCurrentProjectionRequest(request)) return
    const desired = requested === undefined ? get().selectedSessionId : requested
    if (requested !== undefined) set({ generatedCandidate: null, lastFeedback: null })
    let releases: TextOpenWorldLibraryItem[]
    let sessions: ProductRuntimeSession[]
    try {
      const result = await Promise.all([
        readLibrary(request.scope),
        readBoundInstances(request.scope).then(rows => rows.filter(row => row.kind === 'text-open-world'
          && (row.worldGroupId ?? null) === (request.worldGroupId ?? null))
          .sort((left, right) => right.updatedAt - left.updatedAt)),
      ])
      releases = result[0]
      sessions = result[1]
    } catch (error) {
      if (!isCurrentProjectionRequest(request)) return
      throw error
    }
    if (!isCurrentProjectionRequest(request)) return
    set({ releases, sessions })
    if (desired == null) {
      if (isCurrentProjectionRequest(request)) set(emptySelectionState())
      return
    }
    try {
      const details = await readDetails(request.scope, request.worldGroupId, desired)
      if (isCurrentProjectionRequest(request)) set(details)
    } catch (error) {
      if (!isCurrentProjectionRequest(request)) return
      throw error
    }
  }
  const run = async <T>(
    operation: () => Promise<T>,
    mayPublish: () => boolean = () => true,
  ): Promise<T> => {
    if (mayPublish()) set({ busy: true, error: '' })
    try { return await operation() }
    catch (error) {
      if (mayPublish()) set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    finally { if (mayPublish()) set({ busy: false }) }
  }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
    selectedSession: null, selectedSessionSource: null, events: [], checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, lastFeedback: null,
    generatedCandidate: null, loading: false, busy: false, error: '',
    load: async (scope, worldGroupId, initialSessionId) => {
      const request = beginProjectionRequest(scope, worldGroupId)
      set({
        scope, worldGroupId, releases: [], sessions: [], loading: true, busy: false,
        ...emptySelectionState(),
      })
      try { await reload(initialSessionId ?? null, request) }
      catch (error) {
        if (!isCurrentProjectionRequest(request)) return
        const detail = error instanceof Error ? error.message : String(error)
        set(emptySelectionState(`[text-open-world] 存档加载失败，可返回游戏库重试：${detail}`))
      }
      finally {
        if (isCurrentProjectionRequest(request)) set({ loading: false })
      }
    },
    select: async sessionId => {
      const scope = get().scope
      if (!scope) {
        projectionRequestRevision += 1
        set({ ...emptySelectionState('[text-open-world] scope 缺失。'), loading: false })
        return
      }
      const request = beginProjectionRequest(scope, get().worldGroupId)
      set({ loading: true, busy: false, error: '', generatedCandidate: null, lastFeedback: null })
      try {
        if (sessionId == null) {
          if (isCurrentProjectionRequest(request)) set(emptySelectionState())
        }
        else {
          const details = await readDetails(request.scope, request.worldGroupId, sessionId)
          if (isCurrentProjectionRequest(request)) set(details)
        }
      } catch (error) {
        if (!isCurrentProjectionRequest(request)) return
        const detail = error instanceof Error ? error.message : String(error)
        set(emptySelectionState(`[text-open-world] 存档加载失败，可返回游戏库重试：${detail}`))
      } finally {
        if (isCurrentProjectionRequest(request)) set({ loading: false })
      }
    },
    start: async (productReleaseId, title) => run(async () => {
      const item = get().releases.find(row => row.release.id === productReleaseId)
      if (!item?.manifest || !get().scope) throw new Error('[text-open-world] 请选择有效发布。')
      const displayTitle = item.manifest.definition.title
      const session = await createTextOpenWorldInstance({
        scope: get().scope!, productReleaseId,
        title: title?.trim() || `${displayTitle} · 新旅程`,
        worldGroupId: get().worldGroupId,
      })
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
    executeVNextAction: async (actionKey, targetKey, options) => {
      const sessionId = get().selectedSessionId
      const request = captureProjectionRequest()
      if (sessionId == null || !request) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const mayPublish = () => isCurrentSessionRequest(request, sessionId)
      return run(async () => {
        const session = await assertSession(request.scope, sessionId)
        if (!(await readProductRuntimeState(session.id!)).textOpenWorld) throw new Error('[text-open-world] 当前存档不是vNext运行包。')
        try {
          const feedback = await executeTextOpenWorldActionV1({
            sessionId,
            actionKey,
            targetKey,
            commandId: options?.commandId,
            confirmed: options?.confirmed,
            source: options?.source,
            expectedBaseSequence: options?.expectedBaseSequence,
          })
          await refresh(request, sessionId)
          if (mayPublish()) set({ generatedCandidate: null, lastFeedback: feedback })
          return feedback
        } catch (error) {
          // A stale confirmation is expected under another tab/process. Refresh
          // only the captured Session projection before exposing the original
          // error; a later scope/Session must never receive this receipt.
          if (mayPublish()) {
            try { await refresh(request, sessionId) } catch { /* Preserve the action failure. */ }
          }
          throw error
        }
      }, mayPublish)
    },
    generatePresentation: async (skillId, objective, aiConfig) => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null || !get().scope) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const generated = await generateOpenWorldRuntimeCandidateV1({
        scope: get().scope!, productRuntimeSessionId: sessionId, skillId, objective, aiConfig,
      })
      await adoptOpenWorldRuntimeCandidateV1({ scope: get().scope!, runId: generated.snapshot.run.id })
      set({ generatedCandidate: generated.candidate })
    }),
    saveCheckpoint: async name => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const state = await readProductRuntimeState(sessionId)
      if (state.textOpenWorld) await createTextOpenWorldCheckpointV1({ sessionId, name })
      else await createProductRuntimeCheckpoint({ sessionId, name })
      await refresh()
    }),
    forkCheckpoint: async (checkpointId, title) => run(async () => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      if (!checkpoint) throw new Error('[text-open-world] 检查点无效。')
      const checkpointState = await readProductRuntimeState(checkpoint.sessionId, checkpoint.throughSequence)
      const child = checkpointState.textOpenWorld
        ? await (async () => {
            const inspection = await inspectTextOpenWorldCheckpointV1(checkpointId)
            if (!inspection.valid) throw new Error(`[text-open-world] 检查点无效:${inspection.detail}`)
            return branchTextOpenWorldSessionFromCheckpointV1({ checkpointId, title: title?.trim() || `世界分支 · ${checkpoint.name}` })
          })()
        : await (async () => {
            if (!await verifyProductRuntimeCheckpoint(checkpointId)) throw new Error('[text-open-world] 检查点无效。')
            return branchProductRuntimeSession({ parentSessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence, title: title?.trim() || `世界分支 · ${checkpoint.name}` })
          })()
      await reload(child.id!)
      return child.id!
    }),
    retryDefeatedCombat: async title => run(async () => {
      if (get().selectedSessionId == null) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const child = await retryDefeatedTextOpenWorldCombatV1({ sessionId: get().selectedSessionId!, title })
      await reload(child.id!)
      return child.id!
    }),
    forkCurrent: async title => run(async () => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const state = await readProductRuntimeState(sessionId)
      const child = state.textOpenWorld
        ? await (async () => {
            const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId, name: title?.trim() || '开放世界分支点' })
            return branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: title?.trim() || '开放世界分支' })
          })()
        : await branchProductRuntimeSession({ parentSessionId: sessionId, throughSequence: state.lastSequence, title: title?.trim() || '开放世界分支' })
      await reload(child.id!)
      return child.id!
    }),
    remove: async sessionId => run(async () => {
      if (!get().scope) throw new Error('[text-open-world] scope 缺失。')
      await assertSessionOwnership(get().scope!, get().worldGroupId, sessionId)
      await deleteProductRuntimeSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})

export function selectTextOpenWorldAdventureActions(state: TextOpenWorldPlayerState) {
  if (!state.selectedManifest?.adventure || state.runtimeState.textOpenWorld || !state.runtimeState.adventure) return []
  return availableAdventureActions(state.selectedManifest.adventure, state.runtimeState.adventure, state.runtimeState.narrative?.variables)
    .filter(item => item.action.kind !== 'move')
}

export function selectTextOpenWorldVNextActions(state: TextOpenWorldPlayerState) {
  const runtimePackage = state.selectedManifest?.textOpenWorldVNext
  if (!state.runtimeState.textOpenWorld || !runtimePackage) return []
  return createTextOpenWorldActionRegistryV1(runtimePackage)
    .project(deriveTextOpenWorldContextsV1(state.runtimeState.textOpenWorld).action)
}
