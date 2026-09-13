import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { availableAdventureActions } from '../lib/adventure/runtime'
import { createTextOpenWorldActionRegistryV1 } from '../lib/open-world/action-registry'
import {
  executeTextOpenWorldActionV1,
  resumeTextOpenWorldSystemWorkV1,
} from '../lib/open-world/action-executor'
import { getTextOpenWorldCommandStatusV1 } from '../lib/open-world/commands'
import { readTextOpenWorldFeedbackV1 } from '../lib/open-world/feedback'
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
  migrateTextOpenWorldSaveToReleaseV1,
  previewTextOpenWorldSaveMigrationV1,
  type TextOpenWorldSaveMigrationPreviewV1,
} from '../lib/open-world/player-save-migration'
import {
  classifyTextOpenWorldPlayerIssueV1,
  type TextOpenWorldPlayerIssueSurfaceV1,
  type TextOpenWorldPlayerIssueV1,
} from '../lib/open-world/player-resilience'
import type { TextOpenWorldRuntimeIntentAuthorizationV1 } from '../lib/open-world/runtime-intent'
import type {
  TextOpenWorldRuntimeDirectionOutcomeV1,
  TextOpenWorldRuntimeDirectionRunAIV1,
} from '../lib/open-world/runtime-direction'
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
  runtimeIntentAuthorization?: TextOpenWorldRuntimeIntentAuthorizationV1
  runtimeDirectionAIConfig?: AIConfig
  runtimeDirectionRunAI?: TextOpenWorldRuntimeDirectionRunAIV1
}

export type TextOpenWorldPlayerRecoveryRequestV1 =
  | { kind: 'refresh-session'; sessionId: number }
  | { kind: 'resume-settlement'; sessionId: number; commandId: string }

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
  /** Latest optional Director-advice result for this tab; canonical gameplay stays in Event state. */
  lastDirectionOutcome: TextOpenWorldRuntimeDirectionOutcomeV1 | null
  generatedCandidate: OpenWorldRuntimeCandidateV1 | null
  /** Optional AI expression has its own lifecycle and never locks deterministic gameplay. */
  presentationBusy: boolean
  presentationIssue: TextOpenWorldPlayerIssueV1 | null
  /** Player-safe structured issue; raw diagnostics remain in `error` for development only. */
  issue: TextOpenWorldPlayerIssueV1 | null
  recovery: TextOpenWorldPlayerRecoveryRequestV1 | null
  recoveryNotice: string
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
  cancelPresentation(): void
  saveCheckpoint(name: string): Promise<void>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  deleteCheckpoint(checkpointId: number): Promise<void>
  repairCheckpoint(checkpointId: number): Promise<void>
  repairRuntimeHead(sessionId: number): Promise<void>
  refreshSaveCenter(): Promise<void>
  previewReleaseMigration(targetProductReleaseId: number): Promise<TextOpenWorldSaveMigrationPreviewV1>
  migrateRelease(
    targetProductReleaseId: number,
    expectedPreviewHash: string,
  ): Promise<number>
  recover(): Promise<void>
  dismissIssue(): void
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
    presentationBusy: false,
    presentationIssue: null,
    lastFeedback: null,
    lastDirectionOutcome: null,
    issue: null,
    recovery: null,
    recoveryNotice: '',
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
  let recoveredFeedback: TextOpenWorldFeedbackReceiptV1 | null = null
  if (selectedManifest.textOpenWorldVNext) {
    recoveredFeedback = await resumeTextOpenWorldSystemWorkV1(sessionId)
    await reconcileTextOpenWorldAutomaticSavesV1({
      owner: { scope, worldGroupId },
      sessionId,
    })
  }
  // Freeze one authoritative state prefix first. Event rows are append-only,
  // so a concurrent tab may only add a newer suffix; trimming that suffix
  // prevents UI projectors from observing state N with events N+1.
  const runtimeState = await readProductRuntimeState(sessionId)
  const [allEvents, allCheckpoints, session, saveProjection, versionCompatibility] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    assertSession(scope, sessionId),
    projectTextOpenWorldPlayerSavesV1({
      owner: { scope, worldGroupId },
      currentSessionId: sessionId,
      includeBuildPreviews: selectedSession.productReleaseId == null,
    }),
    projectTextOpenWorldPlayerVersionCompatibilityV1({ scope, currentSessionId: sessionId }),
  ])
  const events = allEvents.filter(event => event.sequence <= runtimeState.lastSequence)
  const checkpoints = allCheckpoints.filter(checkpoint => (
    checkpoint.throughSequence <= runtimeState.lastSequence
  ))
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
    lastFeedback: recoveredFeedback,
    lastDirectionOutcome: null,
    recoveryNotice: recoveredFeedback
      ? '检测到一项已记录但未完成展示的操作；播放器已沿用原命令完成核对，没有重复提交。'
      : '',
  }
}

export const useTextOpenWorldPlayerStore = create<TextOpenWorldPlayerState>((set, get) => {
  let projectionRequestRevision = 0
  let actionRequestRevision = 0
  let sessionOperationRevision = 0
  let presentationRequestRevision = 0
  let presentationAbortController: AbortController | null = null
  let presentationInFlight: Promise<void> | null = null
  const publishDetails = (details: Awaited<ReturnType<typeof readDetails>>) => {
    set(current => ({
      ...details,
      sessions: current.sessions.map(session => (
        session.id === details.selectedSession.id ? details.selectedSession : session
      )),
    }))
  }
  const startOperationInFlight = new Map<string, Promise<number>>()
  const legacyOperationInFlight = new Map<string, Promise<void>>()
  const invalidatePresentation = () => {
    presentationRequestRevision += 1
    presentationAbortController?.abort()
    presentationAbortController = null
    presentationInFlight = null
  }
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
      if (mayPublish()) publishDetails(details)
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
    options: {
      surface?: TextOpenWorldPlayerIssueSurfaceV1
      recovery?: () => TextOpenWorldPlayerRecoveryRequestV1 | null
    } = {},
  ): Promise<T> => {
    if (mayPublish()) set({
      busy: true,
      error: '',
      issue: null,
      recovery: null,
      recoveryNotice: '',
    })
    try { return await operation() }
    catch (error) {
      if (mayPublish()) set({
        error: error instanceof Error ? error.message : String(error),
        issue: classifyTextOpenWorldPlayerIssueV1({
          error,
          surface: options.surface ?? 'runtime-operation',
        }),
        recovery: options.recovery?.()
          ?? (get().selectedSessionId == null
            ? null
            : { kind: 'refresh-session', sessionId: get().selectedSessionId! }),
      })
      throw error
    }
    finally { if (mayPublish()) set({ busy: false }) }
  }
  const runLegacyMutation = (
    identity: string,
    commit: (input: {
      sessionId: number
      commandId: string
      baseSequence: number
      baseStateHash: string
    }) => Promise<unknown>,
  ): Promise<void> => {
    const selectedSessionId = get().selectedSessionId
    const scope = get().scope
    if (selectedSessionId == null || !scope) {
      return run(async () => {
        throw new Error('[text-open-world] 请先开始正式开放世界。')
      })
    }
    const operationKey = `${selectedSessionId}:${identity}`
    const existing = legacyOperationInFlight.get(operationKey)
    if (existing) return existing

    invalidatePresentation()
    set({ presentationBusy: false, presentationIssue: null })
    const request = beginSessionOperation()
    const mayPublish = () => isCurrentSessionOperation(request)
    const commandId = `text-open-world:legacy:${selectedSessionId}:${crypto.randomUUID()}`
    const operation = run(async () => {
      const projection = sessionOperationProjection(request)
      if (!projection || request.selectedSessionId !== selectedSessionId) {
        throw new Error('[text-open-world] 运行中的操作不属于当前存档。')
      }
      await assertSessionProjection(projection.scope, projection.worldGroupId, selectedSessionId)
      const base = await readProductRuntimeStateVersion(selectedSessionId)
      await commit({
        sessionId: selectedSessionId,
        commandId,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      if (mayPublish()) set({ generatedCandidate: null })
      await refresh(projection, selectedSessionId, mayPublish)
    }, mayPublish, {
      recovery: () => ({ kind: 'refresh-session', sessionId: selectedSessionId }),
    })
    legacyOperationInFlight.set(operationKey, operation)
    const clear = () => {
      if (legacyOperationInFlight.get(operationKey) === operation) {
        legacyOperationInFlight.delete(operationKey)
      }
    }
    operation.then(clear, clear)
    return operation
  }
  return {
    scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
    selectedSession: null, selectedSessionSource: null, events: [], checkpoints: [],
    saveProjection: emptySaveProjection(), versionCompatibility: null,
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), selectedManifest: null, lastFeedback: null,
    lastDirectionOutcome: null,
    generatedCandidate: null, presentationBusy: false, presentationIssue: null,
    issue: null, recovery: null, recoveryNotice: '',
    loading: false, busy: false, error: '',
    load: async (scope, worldGroupId, initialSessionId) => {
      invalidatePresentation()
      const request = beginProjectionRequest(scope, worldGroupId)
      set({
        scope, worldGroupId, releases: [], sessions: [], loading: true, busy: false,
        ...emptySelectionState(),
      })
      try { await reload(initialSessionId ?? null, request) }
      catch (error) {
        if (!isCurrentProjectionRequest(request)) return
        const detail = error instanceof Error ? error.message : String(error)
        const diagnostic = `[text-open-world] 存档加载失败，可返回游戏库重试：${detail}`
        set({
          ...emptySelectionState(diagnostic),
          issue: classifyTextOpenWorldPlayerIssueV1({
            error: diagnostic,
            surface: initialSessionId == null ? 'library-load' : 'runtime-load',
          }),
        })
      }
      finally {
        if (isCurrentProjectionRequest(request)) set({ loading: false })
      }
    },
    select: async sessionId => {
      invalidatePresentation()
      const scope = get().scope
      if (!scope) {
        projectionRequestRevision += 1
        set({ ...emptySelectionState('[text-open-world] scope 缺失。'), loading: false })
        return
      }
      const request = beginProjectionRequest(scope, get().worldGroupId)
      set({
        loading: true,
        busy: false,
        error: '',
        issue: null,
        recovery: null,
        recoveryNotice: '',
        generatedCandidate: null,
        presentationBusy: false,
        presentationIssue: null,
        lastFeedback: null,
      })
      try {
        if (sessionId == null) {
          if (isCurrentProjectionRequest(request)) set(emptySelectionState())
        }
        else {
          const details = await readDetails(request.scope, request.worldGroupId, sessionId)
          if (isCurrentProjectionRequest(request)) publishDetails(details)
        }
      } catch (error) {
        if (!isCurrentProjectionRequest(request)) return
        const detail = error instanceof Error ? error.message : String(error)
        const diagnostic = `[text-open-world] 存档加载失败，可返回游戏库重试：${detail}`
        set({
          ...emptySelectionState(diagnostic),
          issue: classifyTextOpenWorldPlayerIssueV1({ error: diagnostic, surface: 'runtime-load' }),
        })
      } finally {
        if (isCurrentProjectionRequest(request)) set({ loading: false })
      }
    },
    start: (productReleaseId, title) => {
      const request = captureProjectionRequest()
      const item = get().releases.find(row => row.release.id === productReleaseId)
      if (!request || !item?.manifest) {
        return run(async () => {
          throw new Error('[text-open-world] 请选择有效发布。')
        })
      }
      const displayTitle = item.manifest.definition.title
      const requestedTitle = title?.trim() || `${displayTitle} · 新旅程`
      const operationKey = [
        request.scope.projectId,
        request.scope.worldId,
        request.scope.workId,
        request.worldGroupId ?? 'root',
        productReleaseId,
        requestedTitle,
      ].join(':')
      const existing = startOperationInFlight.get(operationKey)
      if (existing) return existing

      invalidatePresentation()
      set({ presentationBusy: false, presentationIssue: null })
      const mayPublish = () => isCurrentProjectionRequest(request)
      const operation = run(async () => {
        const session = await createTextOpenWorldInstance({
          scope: request.scope,
          productReleaseId,
          title: requestedTitle,
          worldGroupId: request.worldGroupId,
        })
        await reload(session.id!, request, mayPublish)
        return session.id!
      }, mayPublish)
      startOperationInFlight.set(operationKey, operation)
      const clear = () => {
        if (startOperationInFlight.get(operationKey) === operation) {
          startOperationInFlight.delete(operationKey)
        }
      }
      operation.then(clear, clear)
      return operation
    },
    command: command => runLegacyMutation(
      `command:${JSON.stringify(command)}`,
      input => commitOpenWorldCommand({ ...input, command }),
    ),
    resolveAdventureAction: actionKey => runLegacyMutation(
      `adventure:${actionKey}`,
      input => commitAdventureAction({ ...input, actionKey }),
    ),
    choose: choiceKey => runLegacyMutation(
      `ending:${choiceKey}`,
      input => commitNarrativeChoice({ ...input, choiceKey }),
    ),
    executeVNextAction: async (actionKey, targetKey, options) => {
      const sessionId = get().selectedSessionId
      const request = captureProjectionRequest()
      if (sessionId == null || !request) throw new Error('[text-open-world] 请先开始正式开放世界。')
      const requestedTargetKey = targetKey ?? null
      const expectedBaseSequence = options?.expectedBaseSequence ?? get().runtimeState.lastSequence
      // The player client owns one stable identity before dispatch. If the
      // caller loses the return value after the Command became durable, the
      // same identity can be queried/resumed instead of generating a retry.
      const commandId = options?.commandId
        ?? `text-open-world:action:${sessionId}:${crypto.randomUUID()}`
      let commandNeedsSettlement = false
      let terminalFeedback: TextOpenWorldFeedbackReceiptV1 | null = null
      let directionOutcome: TextOpenWorldRuntimeDirectionOutcomeV1 | null = null
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
            commandId,
            confirmed: options?.confirmed,
            source: options?.source,
            expectedBaseSequence,
            quantity: options?.quantity,
            itemKey: options?.itemKey,
            runtimeIntentAuthorization: options?.runtimeIntentAuthorization,
            runtimeDirectionAIConfig: options?.runtimeDirectionAIConfig,
            runtimeDirectionRunAI: options?.runtimeDirectionRunAI,
            onRuntimeDirectionOutcome: outcome => { directionOutcome = outcome },
          })
          assertActionFeedbackIdentity(feedback, {
            sessionId,
            actionKey,
            targetKey: requestedTargetKey,
            commandId,
            expectedBaseSequence,
          })
          await refresh(request, sessionId)
          if (mayPublish()) set({
            generatedCandidate: null,
            lastFeedback: feedback,
            lastDirectionOutcome: directionOutcome,
          })
          return feedback
        } catch (error) {
          // Querying is read-only. Distinguish an actually pending envelope
          // from a terminal receipt whose subsequent UI refresh failed.
          if (mayPublish()) {
            // Failure to verify canonical evidence is deliberately allowed to
            // replace the original diagnostic: it is the more severe failure
            // and must not be flattened to an ordinary retry.
            const status = await getTextOpenWorldCommandStatusV1({
              sessionId,
              commandId,
            })
            if (status.status === 'committed') {
              const observed = await readTextOpenWorldFeedbackV1({ sessionId, commandId })
              assertActionFeedbackIdentity(observed, {
                sessionId,
                actionKey,
                targetKey: requestedTargetKey,
                commandId,
                expectedBaseSequence,
              })
              if (observed.phase === 'terminal') terminalFeedback = observed
              else commandNeedsSettlement = true
            }
            if (terminalFeedback) set({ lastFeedback: terminalFeedback })
            if (!commandNeedsSettlement && !terminalFeedback) {
              // A stale confirmation is expected under another tab/process.
              // Refresh only the captured Session before exposing the failure.
              try { await refresh(request, sessionId) } catch { /* Preserve the action failure. */ }
            }
          }
          if (commandNeedsSettlement) {
            throw new Error('[text-open-world] 请求结果未知；原命令已记录，必须核对并恢复，不能重新提交。')
          }
          throw error
        }
      }, mayPublish, {
        recovery: () => commandNeedsSettlement
          ? { kind: 'resume-settlement', sessionId, commandId }
          : { kind: 'refresh-session', sessionId },
      })
    },
    generatePresentation: (skillId, objective, aiConfig) => {
      if (presentationInFlight) return presentationInFlight
      const request = captureProjectionRequest()
      const sessionId = get().selectedSessionId
      if (!request || sessionId == null) {
        return Promise.reject(new Error('[text-open-world] 请先开始正式开放世界。'))
      }
      const revision = ++presentationRequestRevision
      const controller = new AbortController()
      presentationAbortController = controller
      const mayPublish = () => presentationRequestRevision === revision
        && isCurrentSessionRequest(request, sessionId)
      set({ presentationBusy: true, presentationIssue: null })
      const operation = (async () => {
        try {
          await assertSessionProjection(request.scope, request.worldGroupId, sessionId)
          const generated = await generateOpenWorldRuntimeCandidateV1({
            scope: request.scope,
            productRuntimeSessionId: sessionId,
            skillId,
            objective,
            aiConfig,
            signal: controller.signal,
          })
          if (!mayPublish()) return
          await adoptOpenWorldRuntimeCandidateV1({
            scope: request.scope,
            runId: generated.snapshot.run.id,
          })
          if (mayPublish()) set({
            generatedCandidate: generated.candidate,
            presentationIssue: null,
          })
        } catch (error) {
          if (mayPublish()) set({
            presentationIssue: classifyTextOpenWorldPlayerIssueV1({
              error,
              surface: 'optional-ai',
            }),
          })
          throw error
        }
      })()
      presentationInFlight = operation
      const clear = () => {
        if (presentationRequestRevision !== revision) return
        if (presentationInFlight === operation) presentationInFlight = null
        if (presentationAbortController === controller) presentationAbortController = null
        if (mayPublish()) set({ presentationBusy: false })
      }
      operation.then(clear, clear)
      return operation
    },
    cancelPresentation: () => {
      invalidatePresentation()
      set({ presentationBusy: false, presentationIssue: null })
    },
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
    previewReleaseMigration: async targetProductReleaseId => {
      const scope = get().scope
      const sourceSessionId = get().selectedSessionId
      if (!scope || sourceSessionId == null) {
        throw new Error('[text-open-world] 请先打开正式Release存档。')
      }
      return previewTextOpenWorldSaveMigrationV1({
        scope,
        sourceSessionId,
        targetProductReleaseId,
      })
    },
    migrateRelease: async (targetProductReleaseId, expectedPreviewHash) => {
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const sourceSessionId = request.selectedSessionId
        const projection = sessionOperationProjection(request)
        if (sourceSessionId == null || !projection) {
          throw new Error('[text-open-world] 请先打开正式Release存档。')
        }
        await assertSessionProjection(
          projection.scope,
          projection.worldGroupId,
          sourceSessionId,
        )
        const migrated = await migrateTextOpenWorldSaveToReleaseV1({
          scope: projection.scope,
          sourceSessionId,
          targetProductReleaseId,
          expectedPreviewHash,
        })
        await reloadSessionOperation(request, migrated.session.id)
        return migrated.session.id
      }, mayPublish)
    },
    recover: async () => {
      const recovery = get().recovery
      if (!recovery) throw new Error('[text-open-world] 当前没有可执行的恢复请求。')
      let nextRecovery: TextOpenWorldPlayerRecoveryRequestV1 | null = recovery
      const request = beginSessionOperation()
      const mayPublish = () => isCurrentSessionOperation(request)
      return run(async () => {
        const projection = sessionOperationProjection(request)
        if (!projection || request.selectedSessionId !== recovery.sessionId) {
          throw new Error('[text-open-world] 恢复请求不属于当前存档。')
        }
        await assertSessionProjection(projection.scope, projection.worldGroupId, recovery.sessionId)
        let feedback: TextOpenWorldFeedbackReceiptV1 | null = null
        if (recovery.kind === 'resume-settlement') {
          const status = await getTextOpenWorldCommandStatusV1({
            sessionId: recovery.sessionId,
            commandId: recovery.commandId,
          })
          if (status.status !== 'committed') {
            // The exact command is no longer recoverable. Do not keep offering
            // resume-settlement for an identity that canonical storage cannot
            // prove; downgrade the next action to a fresh read-only verification.
            nextRecovery = { kind: 'refresh-session', sessionId: recovery.sessionId }
            throw new Error('[text-open-world] 原命令记录未通过完整性校验，已停止续结。')
          }
          await resumeTextOpenWorldSystemWorkV1(recovery.sessionId)
          feedback = await readTextOpenWorldFeedbackV1({
            sessionId: recovery.sessionId,
            commandId: recovery.commandId,
          })
          if (feedback.phase !== 'terminal') {
            throw new Error('[text-open-world] 请求结果未知；原命令仍未形成终态。')
          }
        }
        await refresh(projection, recovery.sessionId, mayPublish)
        if (mayPublish()) set({
          error: '',
          issue: null,
          recovery: null,
          ...(feedback ? { lastFeedback: feedback } : {}),
          recoveryNotice: recovery.kind === 'resume-settlement'
            ? '已从事件时间线核对并续结原操作；没有创建新的命令或重复写入。'
            : '已核对当前存档并恢复到最新安全状态。',
        })
      }, mayPublish, {
        surface: 'runtime-load',
        recovery: () => nextRecovery,
      })
    },
    dismissIssue: () => {
      const issue = get().issue
      if (!issue || issue.state === 'blocking-error') return
      set({ error: '', issue: null, recovery: null })
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
        if (state.textOpenWorld?.state.endings.reachedKey != null) {
          throw new Error('[text-open-world] 结局后的当前进度只能读取；请从结局前存档建立分支。')
        }
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
