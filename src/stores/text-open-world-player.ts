import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { availableAdventureActions } from '../lib/adventure/runtime'
import { createTextOpenWorldActionRegistryV1 } from '../lib/open-world/action-registry'
import {
  executeTextOpenWorldActionV1,
  resumeTextOpenWorldSystemWorkV1,
} from '../lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
  retryDefeatedTextOpenWorldCombatV1,
} from '../lib/open-world/checkpoints'
import {
  branchTextOpenWorldPlayerSaveV1,
  createTextOpenWorldManualSaveV1,
  deleteTextOpenWorldPlayerBranchV1,
  deleteTextOpenWorldPlayerCheckpointV1,
  projectTextOpenWorldPlayerSavesV1,
  reconcileTextOpenWorldAutomaticSavesV1,
  repairTextOpenWorldPlayerCheckpointV1,
  repairTextOpenWorldPlayerRuntimeHeadV1,
  type TextOpenWorldPlayerSavesProjectionV1,
} from '../lib/open-world/player-saves'
import {
  projectTextOpenWorldPlayerVersionCompatibilityV1,
  type TextOpenWorldPlayerVersionCompatibilityProjectionV1,
} from '../lib/open-world/player-version-compatibility'
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
  readProductRuntimeState,
  readProductRuntimeStateVersion,
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
  quantity?: number
  itemKey?: string
}

interface TextOpenWorldProjectionRequest {
  revision: number
  scope: WorkspaceScope
  worldGroupId: number | null
}

interface TextOpenWorldSessionOperationRequest {
  revision: number
  projectionRevision: number
  scope: WorkspaceScope | null
  worldGroupId: number | null
  selectedSessionId: number | null
  selectedThroughSequence: number
  publishedSessionId: number | null
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
  /** Player-safe save/branch catalog for this owner; action ids are non-display handles. */
  saveProjection: TextOpenWorldPlayerSavesProjectionV1
  /** Read-only compatibility evidence for the selected immutable Release. */
  versionCompatibility: TextOpenWorldPlayerVersionCompatibilityProjectionV1 | null
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
  deleteCheckpoint(checkpointId: number): Promise<void>
  repairCheckpoint(checkpointId: number): Promise<void>
  repairRuntimeHead(sessionId: number): Promise<void>
  refreshSaveCenter(): Promise<void>
  retryDefeatedCombat(title?: string): Promise<number>
  forkCurrent(title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

function emptySaveProjection(): TextOpenWorldPlayerSavesProjectionV1 {
  return { groups: [], totalBranches: 0, totalCheckpoints: 0 }
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

async function assertSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'text-open-world') throw new Error('[text-open-world] 该存档不是文字开放世界。')
  return session
}

async function assertSessionProjection(
  scope: WorkspaceScope,
  worldGroupId: number | null,
  sessionId: number,
): Promise<ProductRuntimeSession> {
  const session = await assertSession(scope, sessionId)
  if ((session.worldGroupId ?? null) !== (worldGroupId ?? null)) {
    throw new Error('[text-open-world] 该存档不属于当前世界分组。')
  }
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
    saveProjection: emptySaveProjection(),
    versionCompatibility: null,
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

function assertActionFeedbackIdentity(
  feedback: TextOpenWorldFeedbackReceiptV1,
  request: {
    sessionId: number
    actionKey: string
    targetKey: string | null
    commandId?: string
    expectedBaseSequence?: number
  },
) {
  if (feedback.sessionId !== request.sessionId
    || feedback.actionKey !== request.actionKey
    || feedback.targetKey !== request.targetKey) {
    throw new Error('[text-open-world] Action回执与发起请求的Session或目标不一致。')
  }
  if (request.expectedBaseSequence != null
    && feedback.baseSequence !== request.expectedBaseSequence) {
    throw new Error('[text-open-world] Action回执属于过期的Session事件基线。')
  }
  if (feedback.phase !== 'preflight'
    && request.commandId != null
    && feedback.commandId !== request.commandId) {
    throw new Error('[text-open-world] Action回执与发起请求的commandId不一致。')
  }
}

async function readDetails(scope: WorkspaceScope, worldGroupId: number | null, sessionId: number) {
  const selectedSession = await assertSessionProjection(scope, worldGroupId, sessionId)
  const playable = await verifyProductRuntimeSessionSourceV1({ scope, session: selectedSession })
  const selectedManifest = playableManifest(playable.runtimePackage)
  // Legacy open-world packages do not own the vNext Action/Effect projection.
  // Only the frozen vNext package may enter system follow-up recovery.
  if (selectedManifest.textOpenWorldVNext) {
    await resumeTextOpenWorldSystemWorkV1(sessionId)
    await reconcileTextOpenWorldAutomaticSavesV1({
      owner: { scope, worldGroupId },
      sessionId,
    })
  }
  const session = await assertSession(scope, sessionId)
  const [events, checkpoints, runtimeState, saveProjection, versionCompatibility] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
    projectTextOpenWorldPlayerSavesV1({
      owner: { scope, worldGroupId },
      currentSessionId: sessionId,
      includeBuildPreviews: session.productReleaseId == null,
    }),
    projectTextOpenWorldPlayerVersionCompatibilityV1({ scope, currentSessionId: sessionId }),
  ])
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
    saveProjection,
    versionCompatibility,
    runtimeState,
    selectedManifest,
  }
}

export const useTextOpenWorldPlayerStore = create<TextOpenWorldPlayerState>((set, get) => {
  let projectionRequestRevision = 0
  let actionRequestRevision = 0
  let sessionOperationRevision = 0
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
  const beginSessionOperation = (): TextOpenWorldSessionOperationRequest => {
    const current = get()
    return {
      revision: ++sessionOperationRevision,
      projectionRevision: projectionRequestRevision,
      scope: current.scope ? { ...current.scope } : null,
      worldGroupId: current.worldGroupId,
      selectedSessionId: current.selectedSessionId,
      selectedThroughSequence: current.runtimeState.lastSequence,
      publishedSessionId: current.selectedSessionId,
    }
  }
  const sessionOperationProjection = (
    request: TextOpenWorldSessionOperationRequest,
  ): TextOpenWorldProjectionRequest | null => request.scope ? {
    revision: request.projectionRevision,
    scope: request.scope,
    worldGroupId: request.worldGroupId,
  } : null
  const isCurrentSessionOperation = (
    request: TextOpenWorldSessionOperationRequest,
  ): boolean => {
    const currentScope = get().scope
    return sessionOperationRevision === request.revision
      && projectionRequestRevision === request.projectionRevision
      && ((currentScope == null && request.scope == null)
        || (currentScope != null
          && request.scope != null
          && currentScope.projectId === request.scope.projectId
          && currentScope.worldId === request.scope.worldId
          && currentScope.workId === request.scope.workId))
      && (get().worldGroupId ?? null) === (request.worldGroupId ?? null)
      && get().selectedSessionId === request.publishedSessionId
  }
  const refresh = async (
    providedRequest?: TextOpenWorldProjectionRequest,
    providedSessionId?: number,
    publishGuard: () => boolean = () => true,
  ) => {
    const request = providedRequest ?? captureProjectionRequest()
    const sessionId = providedSessionId ?? get().selectedSessionId
    const mayPublish = () => request != null
      && isCurrentSessionRequest(request, sessionId!)
      && publishGuard()
    if (!request || sessionId == null || !mayPublish()) return
    try {
      const details = await readDetails(request.scope, request.worldGroupId, sessionId)
      if (mayPublish()) set(details)
    } catch (error) {
      if (!mayPublish()) return
      throw error
    }
  }
  const reload = async (
    requested?: number | null,
    providedRequest?: TextOpenWorldProjectionRequest,
    publishGuard: () => boolean = () => true,
  ): Promise<boolean> => {
    const request = providedRequest ?? captureProjectionRequest()
    const mayPublish = () => request != null
      && isCurrentProjectionRequest(request)
      && publishGuard()
    if (!request || !mayPublish()) return false
    const desired = requested === undefined ? get().selectedSessionId : requested
    if (requested !== undefined && mayPublish()) set({ generatedCandidate: null, lastFeedback: null })
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
      if (!mayPublish()) return false
      throw error
    }
    if (!mayPublish()) return false
    set({ releases, sessions })
    if (desired == null) {
      if (!mayPublish()) return false
      set(emptySelectionState())
      return true
    }
    try {
      const details = await readDetails(request.scope, request.worldGroupId, desired)
      if (!mayPublish()) return false
      set(details)
      return true
    } catch (error) {
      if (!mayPublish()) return false
      throw error
    }
  }
  const reloadSessionOperation = async (
    request: TextOpenWorldSessionOperationRequest,
    selectedSessionId: number | null,
  ) => {
    const projection = sessionOperationProjection(request)
    if (!projection || !isCurrentSessionOperation(request)) return
    const published = await reload(
      selectedSessionId,
      projection,
      () => isCurrentSessionOperation(request),
    )
    if (published) request.publishedSessionId = selectedSessionId
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
    saveProjection: emptySaveProjection(), versionCompatibility: null,
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
      const requestedTargetKey = targetKey ?? null
      const actionRevision = ++actionRequestRevision
      const mayPublish = () => actionRequestRevision === actionRevision
        && isCurrentSessionRequest(request, sessionId)
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
            quantity: options?.quantity,
            itemKey: options?.itemKey,
          })
          assertActionFeedbackIdentity(feedback, {
            sessionId,
            actionKey,
            targetKey: requestedTargetKey,
            commandId: options?.commandId,
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
    saveCheckpoint: async name => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await assertSessionProjection(projection.scope, projection.worldGroupId, sessionId)
        await createTextOpenWorldManualSaveV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          sessionId,
          name,
          expectedThroughSequence: request.selectedThroughSequence,
        })
        await refresh(projection, sessionId, mayPublish)
      }, mayPublish)
    },
    forkCheckpoint: async (checkpointId, title) => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await assertSessionProjection(projection.scope, projection.worldGroupId, sessionId)
        const child = await branchTextOpenWorldPlayerSaveV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          checkpointId,
          title: title?.trim() || '开放世界存档分支',
        })
        const childSessionId = child.id
        if (childSessionId == null) throw new Error('[text-open-world] 分支Session缺少身份。')
        await reloadSessionOperation(request, childSessionId)
        return childSessionId
      }, mayPublish)
    },
    deleteCheckpoint: async checkpointId => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await deleteTextOpenWorldPlayerCheckpointV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          checkpointId,
        })
        await refresh(projection, sessionId, mayPublish)
      }, mayPublish)
    },
    repairCheckpoint: async checkpointId => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await repairTextOpenWorldPlayerCheckpointV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          checkpointId,
        })
        await refresh(projection, sessionId, mayPublish)
      }, mayPublish)
    },
    repairRuntimeHead: async targetSessionId => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await repairTextOpenWorldPlayerRuntimeHeadV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          sessionId: targetSessionId,
        })
        await refresh(projection, sessionId, mayPublish)
      }, mayPublish)
    },
    refreshSaveCenter: async () => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await refresh(projection, sessionId, mayPublish)
      }, mayPublish)
    },
    retryDefeatedCombat: async title => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        await assertSessionProjection(projection.scope, projection.worldGroupId, sessionId)
        const child = await retryDefeatedTextOpenWorldCombatV1({ sessionId, title })
        const childSessionId = child.id
        if (childSessionId == null) throw new Error('[text-open-world] 重试Session缺少身份。')
        await reloadSessionOperation(request, childSessionId)
        return childSessionId
      }, mayPublish)
    },
    forkCurrent: async title => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sessionId == null || !projection) throw new Error('[text-open-world] 请先开始正式开放世界。')
        const session = await assertSessionProjection(projection.scope, projection.worldGroupId, sessionId)
        if (session.productReleaseId == null || session.productBuildId != null) {
          throw new Error('[text-open-world] 制作预览不提供正式手动存档或时间线分支；请先发布Release。')
        }
        const state = await readProductRuntimeState(sessionId)
        const child = state.textOpenWorld
          ? await (async () => {
              const checkpoint = await createTextOpenWorldCheckpointV1({
                sessionId,
                throughSequence: request.selectedThroughSequence,
                purpose: 'system',
                subjectKey: null,
                name: title?.trim() || '开放世界分支点',
              })
              return branchTextOpenWorldSessionFromCheckpointV1({
                checkpointId: checkpoint.id!,
                title: title?.trim() || '开放世界分支',
              })
            })()
          : await branchProductRuntimeSession({
              parentSessionId: sessionId,
              throughSequence: request.selectedThroughSequence,
              title: title?.trim() || '开放世界分支',
            })
        const childSessionId = child.id
        if (childSessionId == null) throw new Error('[text-open-world] 分支Session缺少身份。')
        await reloadSessionOperation(request, childSessionId)
        return childSessionId
      }, mayPublish)
    },
    remove: async sessionId => {
      const request = beginSessionOperation()
      const selectedSessionIdAfterRemoval = request.selectedSessionId === sessionId
        ? null
        : request.selectedSessionId
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const projection = sessionOperationProjection(request)
        if (!projection) throw new Error('[text-open-world] scope 缺失。')
        await deleteTextOpenWorldPlayerBranchV1({
          owner: { scope: projection.scope, worldGroupId: projection.worldGroupId },
          sessionId,
        })
        await reloadSessionOperation(request, selectedSessionIdAfterRemoval)
      }, mayPublish)
    },
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
