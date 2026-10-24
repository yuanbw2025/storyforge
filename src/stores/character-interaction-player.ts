import {applyChatMemoryManagementPlanV1, type ChatMemoryManagementPlanV1, type ChatMemoryManagementActionV1} from '../lib/character-interaction/memory-management'
import {CHAT_ACTION_REVISION_SKILL, readChatActionRevisionSourceV1} from '../lib/character-interaction/action-revision'
import type {ChatSchedulingModeV1} from '../lib/character-interaction/narrative-scheduling'
import {applyChatMessageRetrievalPlanV1, type ChatMessageRetrievalPlanV1} from '../lib/character-interaction/narrative-retrieval-service'
import { create } from 'zustand'
import type {ChatComposerSendBindingV1} from '../lib/character-interaction/runtime-api'
import {ChatComposerConflictError} from '../lib/character-interaction/composer-draft-contract'
import {resolveChatOpeningSceneV1} from '../lib/character-interaction/release-preview'
import { db } from '../lib/db/schema'
import {readInstanceAgentRunV1} from '../lib/agent/run/event-store'
import {chatActionChoiceVersionForContractV1} from '../lib/character-interaction/action-choice-budget'
import {CHAT_ACTION_CHOICE_STEP_V1} from '../lib/character-interaction/action-choice-contract'
import {
  readInteractionDirectorPlanV1,
  adoptInteractionRuntimeCandidateV1,
  cancelInteractionRuntimeRunV1,
  generateInteractionRuntimeCandidateV1,
  resumeChatNarrativeReviewV1,
  resumeChatNarrativeActionV1,
  resumeChatMemoryReviewV1,
} from '../lib/character-interaction/harness'
import {
  branchProductRuntimeSession,
  changeInteractionRelationship,
  commitInteractionPlayerMessage,
  commitNarrativeChoice,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  endInteractionScene,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  startInteractionScene,
  joinInteractionParticipant,
  leaveInteractionParticipant,
  updateChatMessageEditDraft,
} from '../lib/character-interaction/runtime-api'
import {
  assertProductReleaseUnchanged,
  parseAnyProductReleaseManifest,
  parseInteractionProductReleaseManifest,
} from '../lib/product/releases'
import { verifyProductRuntimeSessionSourceV1 } from '../lib/product-production/preview-source'
import {
  assertInstanceBinding,
  createCharacterInteractionInstance,
} from '../lib/product/runtime-instances'
import type {
  AIConfig,
  ProductRelease,
  CharacterInteractionProductRuntimePackageV1,
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../lib/types'
import { advanceChatNarrativeTurnV1, createChatNarrativeSituationV1, readChatNarrativeTurnResumeV1, readPendingChatNarrativeRunsV1, resumeChatNarrativeTurnV1, type ChatNarrativeTurnResumeV1, type ChatPlayerTriggerV1 } from '../lib/character-interaction/narrative-turn'
import {readChatNarrativeOptionsPreviewV1, type ChatNarrativeOptionsPreviewV1} from '../lib/character-interaction/narrative-options-preview'
import type {ChatNarrativeOptionKeyV1} from '../lib/character-interaction/narrative-options'
import {readResumableInteractionRunsV1} from '../lib/character-interaction/runtime-run-recovery'
import {applyChatMessageEditV1, forkChatMessageEditV1, type ChatMessageEditPlanV1} from '../lib/character-interaction/narrative-edit'
import {forkChatHistoricalOptionV1, readChatHistoricalOptionMessageIdsV1, type ChatHistoricalOptionsPlanV1} from '../lib/character-interaction/narrative-options-history'

export interface CharacterInteractionLibraryItem {
  release: ProductRelease
  manifest: CharacterInteractionProductRuntimePackageV1 | null
  error: string
}

interface CharacterInteractionPlayerState {
  scope: WorkspaceScope | null
  worldGroupId: number | null
  releases: CharacterInteractionLibraryItem[]
  sessions: ProductRuntimeSession[]
  selectedSessionId: number | null
  events: ProductRuntimeEvent[]
  checkpoints: ProductRuntimeCheckpoint[]
  recoverableRunIds: number[]
  pendingNarrativeRunIds: number[]
  narrativeTurnResume: ChatNarrativeTurnResumeV1 | null
  pendingNarrativeReviewRunIds: number[]
  pendingNarrativeActionRunIds: number[]
  pendingMemoryReviewRunIds: number[]
  pendingActionReviewRunIds: number[]
  actionRevisionRunId: number | null
  narrativeOptions: ChatNarrativeOptionsPreviewV1[]
  narrativeOptionRunIds: number[]
  historicalOptionMessageIds: string[]
  runtimeState: ProductRuntimeState
  loading: boolean
  busy: boolean
  generatingRunId: number | null
  error: string
  load(scope: WorkspaceScope, worldGroupId: number | null, initialSessionId?: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  start(productReleaseId: number, title?: string, options?: {sceneKey?: string}): Promise<number>
  startScene(sceneKey: string): Promise<void>
  setParticipantPresence(participantKey: string, present: boolean): Promise<void>
  sendPlayerMessage(text: string, audienceKeys?: string[] | null, draft?: {binding: ChatComposerSendBindingV1; onCommitted: () => void}): Promise<number>
  applyFixedAction(ruleKey: string): Promise<void>
  generateReplies(input: { aiConfig: AIConfig; replyToSequence: number; preferredParticipantKey?: string; actionLimit?: number; schedulingMode?: ChatSchedulingModeV1; audienceKeys?: string[] | null }): Promise<void>
  advanceNarrative(input: { aiConfig: AIConfig; kind: ChatPlayerTriggerV1; compare?: boolean; participantKey?: string; actionLimit?: number; schedulingMode?: ChatSchedulingModeV1; audienceKeys?: string[] | null }): Promise<void>
  resumeNarrativeTurn(input: {aiConfig: AIConfig; situationAiConfig?: AIConfig; participantKey?: string}): Promise<void>
  createSituation(input: {aiConfig: AIConfig; actionAiConfig?: AIConfig; seed: string; participantKey?: string; actionLimit?: number; schedulingMode?: ChatSchedulingModeV1; audienceKeys?: string[] | null}): Promise<void>
  reviseNarrativeAction(runId: number, aiConfig: AIConfig): Promise<void>
  resumeNarrativeReview(runId: number, aiConfig: AIConfig): Promise<void>
  resumeNarrativeAction(runId: number, aiConfig: AIConfig): Promise<void>
  selectNarrativeOption(runId: number, optionKey: ChatNarrativeOptionKeyV1): Promise<void>
  applyMessageRetrieval(plan: ChatMessageRetrievalPlanV1): Promise<void>
  forkMessageEdit(plan: ChatMessageEditPlanV1, text: string): Promise<void>
  forkHistoricalOption(plan: ChatHistoricalOptionsPlanV1, optionKey: ChatNarrativeOptionKeyV1): Promise<void>
  applyMessageEdit(text: string, aiConfig?: AIConfig): Promise<void>
  cancelMessageEdit(): Promise<void>
  cancelPendingRun(runId: number): Promise<void>
  retryReply(input: { aiConfig: AIConfig; replySequence: number }): Promise<void>
  cancelGeneration(): Promise<void>
  resumeRun(runId: number): Promise<void>
  manageMemory(plan: ChatMemoryManagementPlanV1, action: ChatMemoryManagementActionV1): Promise<void>
  finishScene(reason?: string, aiConfig?: AIConfig): Promise<void>
  chooseNarrative(choiceKey: string): Promise<void>
  saveCheckpoint(name: string): Promise<void>
  forkCurrent(title?: string): Promise<number>
  forkCheckpoint(checkpointId: number, title?: string): Promise<number>
  remove(sessionId: number): Promise<void>
}

let generationAbortController: AbortController | null = null

async function readLibrary(scope: WorkspaceScope): Promise<CharacterInteractionLibraryItem[]> {
  const rows = (await db.productReleases.where('projectId').equals(scope.projectId).toArray())
    .filter(row => row.worldId === scope.worldId && row.workId === scope.workId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const items: CharacterInteractionLibraryItem[] = []
  for (const release of rows) {
    try {
      await assertProductReleaseUnchanged(release.id!)
      if (parseAnyProductReleaseManifest(release.manifestJson).productType !== 'character-interaction') continue
      const manifest = parseInteractionProductReleaseManifest(release.manifestJson)
      items.push({ release, manifest, error: '' })
    } catch (reason) {
      items.push({
        release,
        manifest: null,
        error: reason instanceof Error ? reason.message : String(reason),
      })
    }
  }
  return items
}

async function assertInteractionSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  const session = await assertInstanceBinding(sessionId, scope)
  if (session.kind !== 'character-interaction') throw new Error('该存档不是角色互动存档。')
  const playable = await verifyProductRuntimeSessionSourceV1({ scope, session })
  if (playable.runtimePackage.productType !== 'character-interaction'
    || !playable.runtimePackage.interaction) {
    throw new Error('该存档没有绑定有效的角色互动 Product Build 或 ProductRelease。')
  }
  const state = await readProductRuntimeState(sessionId)
  if (!state.interaction) throw new Error('该存档不符合角色互动运行协议。')
  return session
}

async function readInteractionSessions(
  scope: WorkspaceScope,
  worldGroupId: number | null,
): Promise<ProductRuntimeSession[]> {
  const rows = await db.productRuntimeSessions.where('projectId').equals(scope.projectId).toArray()
  return rows.filter(row => {
    return row.kind === 'character-interaction'
      && (row.productReleaseId != null || row.productBuildId != null)
      && (row.worldGroupId ?? null) === worldGroupId
      && row.worldId === scope.worldId
      && row.workId === scope.workId
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

async function assertReadableInteractionSession(scope: WorkspaceScope, sessionId: number): Promise<ProductRuntimeSession> {
  return assertInteractionSession(scope, sessionId)
}

async function details(scope: WorkspaceScope, sessionId: number) {
  await assertReadableInteractionSession(scope, sessionId)
  const [events, checkpoints, runtimeState, runRows] = await Promise.all([
    db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readProductRuntimeState(sessionId),
    readResumableInteractionRunsV1(scope, sessionId),
  ])
  checkpoints.sort((a, b) => b.createdAt - a.createdAt)
  const resumableRows = runRows.filter(row => !['completed', 'failed', 'cancelled'].includes(row.status))
  const resumeCheckpoints = resumableRows.length
    ? await db.agentRunCheckpoints.where('runId').anyOf(resumableRows.map(row => row.id!)).toArray()
    : []
  const optionRows = resumableRows.filter(row => JSON.parse(row.contractJson).executionBindings?.some((b: {skillId?: string}) => b.skillId === 'character.chat-narrative-options'))
  const optionRunIds = optionRows.map(row => row.id!)
  const choiceStageRunIds = resumableRows.filter(row => {
    if (chatActionChoiceVersionForContractV1(JSON.parse(row.contractJson)) !== 1) return false
    const saved = resumeCheckpoints.filter(c => c.runId === row.id).sort((a, b) => b.throughSequence - a.throughSequence)[0]
    return !saved?.resumePayloadJson || !['chat-narrative-action-candidate', 'chat-control-handoff-candidate'].includes(JSON.parse(saved.resumePayloadJson).kind)
  }).map(row => row.id!)
  const pendingNarrativeActionRunIds: number[] = []
  for (const runId of choiceStageRunIds) {
    const snapshot = await readInstanceAgentRunV1(scope, runId)
    if (snapshot.projection.state !== 'running' || snapshot.contract.scope.runtime?.baseSequence !== runtimeState.lastSequence) continue
    const requested = (step: string) => snapshot.events.filter(event => event.type === 'model.requested' && event.payload.stepId === step)
    const responses = (step: string) => snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === step && event.payload.artifactKind === 'raw-response')
    if (requested(CHAT_ACTION_CHOICE_STEP_V1).length === 1 && responses(CHAT_ACTION_CHOICE_STEP_V1).length === 1
      && (!requested('interaction:runtime-candidate').length || responses('interaction:runtime-candidate').length === 1)) pendingNarrativeActionRunIds.push(runId)
  }
  const revision = runtimeState.interaction?.chatNarrative ? await readChatActionRevisionSourceV1({scope, sessionId}).catch(() => null) : null
  return {
    actionRevisionRunId: revision?.runId ?? null,
    historicalOptionMessageIds: runtimeState.interaction?.chatNarrative ? await readChatHistoricalOptionMessageIdsV1(scope, sessionId) : [],
    narrativeTurnResume: runtimeState.interaction?.chatNarrative
      ? await readChatNarrativeTurnResumeV1(scope, sessionId, runtimeState.interaction) : null,
    narrativeOptionRunIds: optionRunIds,
    narrativeOptions: await Promise.all(optionRows.filter(row => resumeCheckpoints.some(c => c.runId === row.id && c.resumePayloadJson && JSON.parse(c.resumePayloadJson).review)).map(row => readChatNarrativeOptionsPreviewV1(scope, sessionId, row.id!))),
    events,
    checkpoints,
    runtimeState,
    pendingNarrativeActionRunIds,
    pendingNarrativeRunIds: [...new Set([
      ...(runtimeState.interaction?.chatNarrative ? await readPendingChatNarrativeRunsV1(scope, sessionId, runtimeState.interaction) : []),
      ...resumableRows.filter(row => JSON.parse(row.contractJson).executionBindings?.some((b: {skillId?: string}) => b.skillId === 'character.interaction-memory-curator')).map(row => row.id!),
    ])],
    pendingNarrativeReviewRunIds: resumableRows.filter(row => {
      const saved = resumeCheckpoints.filter(c => c.runId === row.id).sort((a, b) => b.throughSequence - a.throughSequence)[0]
      if (!saved?.resumePayloadJson) return false
      const candidate = JSON.parse(saved.resumePayloadJson)
      return (['chat-situation-candidate', 'chat-narrative-action-candidate', 'chat-control-handoff-candidate', 'chat-narrative-options-candidate'].includes(candidate.kind) && !candidate.review)
        || (candidate.kind === 'memory-curator-candidate' && !candidate.contentReview)
    }).map(row => row.id!),
    pendingMemoryReviewRunIds: resumableRows.filter(row => {
      const saved = resumeCheckpoints.filter(c => c.runId === row.id).sort((a, b) => b.throughSequence - a.throughSequence)[0]
      return saved?.resumePayloadJson && JSON.parse(saved.resumePayloadJson).kind === 'memory-curator-candidate'
    }).map(row => row.id!),
    pendingActionReviewRunIds: resumableRows.filter(row => {
      const saved = resumeCheckpoints.filter(c => c.runId === row.id).sort((a, b) => b.throughSequence - a.throughSequence)[0]
      if (!saved?.resumePayloadJson) return false
      const candidate = JSON.parse(saved.resumePayloadJson)
      return ['chat-narrative-action-candidate', 'chat-control-handoff-candidate', 'chat-narrative-options-candidate'].includes(candidate.kind) && !candidate.review
    }).map(row => row.id!),
    recoverableRunIds: resumableRows
      .filter(row => !optionRunIds.includes(row.id!) && !choiceStageRunIds.includes(row.id!) && resumeCheckpoints.some(item => item.runId === row.id && item.resumePayloadJson != null))
      .map(row => row.id!),
  }
}

function commandId(prefix: string, sessionId: number): string {
  return `${prefix}:${sessionId}:${crypto.randomUUID()}`
}

export const useCharacterInteractionPlayerStore = create<CharacterInteractionPlayerState>((set, get) => {
  let loadEpoch = 0
  let refreshEpoch = 0
  const refresh = async () => {
    const epoch = ++refreshEpoch
    const navigation = loadEpoch
    const scope = get().scope
    const id = get().selectedSessionId
    if (!scope || id == null) return
    const result = await details(scope, id)
    if (get().scope === scope && get().selectedSessionId === id && epoch === refreshEpoch && navigation === loadEpoch) set(result)
  }
  const reload = async (requested?: number | null) => {
    const epoch = loadEpoch
    const scope = get().scope
    const worldGroupId = get().worldGroupId
    if (!scope) return
    const [releases, sessions] = await Promise.all([
      readLibrary(scope),
      readInteractionSessions(scope, worldGroupId),
    ])
    if (epoch !== loadEpoch || get().scope !== scope || get().worldGroupId !== worldGroupId) return
    const current = requested === undefined ? get().selectedSessionId : requested
    const selectedSessionId = current != null && sessions.some(row => row.id === current)
      ? current : sessions[0]?.id ?? null
    set({ releases, sessions, selectedSessionId })
    if (selectedSessionId != null) await refresh()
    else set({ events: [], checkpoints: [], recoverableRunIds: [], pendingNarrativeRunIds: [], narrativeTurnResume: null, pendingNarrativeReviewRunIds: [], pendingNarrativeActionRunIds: [], pendingActionReviewRunIds: [], pendingMemoryReviewRunIds: [], actionRevisionRunId: null, narrativeOptions: [], narrativeOptionRunIds: [], historicalOptionMessageIds: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE) })
  }
  const withBusy = async <T>(operation: () => Promise<T>, reportError = true): Promise<T> => {
    if (get().busy) throw new Error('当前操作尚未结束，请稍后再试。')
    set({ busy: true, error: '' })
    try { return await operation() } catch (reason) {
      // The composer presents both drafts and owns this actionable conflict.
      set({ error: !reportError || reason instanceof ChatComposerConflictError ? '' : reason instanceof Error ? reason.message : String(reason) })
      throw reason
    } finally {
      generationAbortController = null
      try { await refresh() } finally { set({ busy: false, generatingRunId: null }) }
    }
  }
  const version = async () => {
    const id = get().selectedSessionId
    if (id == null) throw new Error('请先选择角色互动存档。')
    await assertInteractionSession(get().scope!, id)
    return { id, ...await readProductRuntimeStateVersion(id) }
  }
  const performNarrative = async (input: {aiConfig: AIConfig; kind: ChatPlayerTriggerV1; compare?: boolean; participantKey?: string; actionLimit?: number; schedulingMode?: ChatSchedulingModeV1; audienceKeys?: string[] | null; replyToSequence?: number}) => {
    const scope = get().scope, sessionId = get().selectedSessionId
    if (!scope || sessionId == null) throw new Error('请先选择角色聊天存档。')
    const controller = new AbortController()
    generationAbortController = controller
    try {
      await advanceChatNarrativeTurnV1({...input, scope, sessionId, settleSituation: true, expectedSequence: get().runtimeState.lastSequence,
        signal: controller.signal, onRunCreated: id => set({generatingRunId: id})})
    } catch (reason) {
      if (!controller.signal.aborted) throw reason
    }
  }

  return {
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    events: [],
    checkpoints: [],
    recoverableRunIds: [],
    pendingNarrativeRunIds: [], narrativeTurnResume: null, pendingNarrativeReviewRunIds: [], pendingNarrativeActionRunIds: [], pendingActionReviewRunIds: [], pendingMemoryReviewRunIds: [], actionRevisionRunId: null, narrativeOptions: [], narrativeOptionRunIds: [], historicalOptionMessageIds: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    loading: false,
    busy: false,
    generatingRunId: null,
    error: '',

    load: async (scope, worldGroupId, initialSessionId) => {
      const epoch = ++loadEpoch
      if (get().busy) await new Promise<void>(resolve => {
        const unsubscribe = useCharacterInteractionPlayerStore.subscribe(state => {
          if (!state.busy) { unsubscribe(); resolve() }
        })
      })
      if (epoch !== loadEpoch) return
      const changed = get().scope?.projectId !== scope.projectId || get().scope?.worldId !== scope.worldId
        || get().scope?.workId !== scope.workId || get().worldGroupId !== worldGroupId
      set({ scope, worldGroupId, loading: true, error: '', ...(changed ? { selectedSessionId: null } : {}) })
      try { await reload(initialSessionId ?? undefined) } catch (reason) {
        if (epoch === loadEpoch) set({ error: reason instanceof Error ? reason.message : String(reason) })
      } finally { if (epoch === loadEpoch) set({ loading: false }) }
    },

    select: async selectedSessionId => {
      if (get().busy) return
      const epoch = ++loadEpoch
      set({ selectedSessionId, loading: true, error: '' })
      try {
        if (selectedSessionId == null) set({ events: [], checkpoints: [], recoverableRunIds: [], pendingNarrativeRunIds: [], narrativeTurnResume: null, pendingNarrativeReviewRunIds: [], pendingNarrativeActionRunIds: [], pendingActionReviewRunIds: [], pendingMemoryReviewRunIds: [], actionRevisionRunId: null, narrativeOptions: [], narrativeOptionRunIds: [], historicalOptionMessageIds: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE) })
        else await refresh()
      } catch (reason) { if (epoch === loadEpoch) set({ error: reason instanceof Error ? reason.message : String(reason) }) }
      finally { if (epoch === loadEpoch) set({ loading: false }) }
    },

    start: async (productReleaseId, title, options) => withBusy(async () => {
      const scope = get().scope
      const item = get().releases.find(row => row.release.id === productReleaseId)
      if (!scope || !item?.manifest || item.error) throw new Error('请选择可用的角色互动发布。')
      const sceneKey = resolveChatOpeningSceneV1(item.manifest, options?.sceneKey)
      const session = await createCharacterInteractionInstance({
        scope,
        productReleaseId,
        title: title?.trim() || `${item.manifest.definition.title} · 新会话`,
        worldGroupId: get().worldGroupId,
      })
      {
        const base = await readProductRuntimeStateVersion(session.id!)
        await startInteractionScene({
          sessionId: session.id!,
          commandId: commandId('interaction.scene.start', session.id!),
          baseSequence: base.sequence,
          baseStateHash: base.stateHash,
          sceneId: `scene:${sceneKey}:${crypto.randomUUID()}`,
          sceneKey,
        })
      }
      await reload(session.id!)
      return session.id!
    }),

    startScene: async sceneKey => withBusy(async () => {
      const base = await version()
      await startInteractionScene({
        sessionId: base.id,
        commandId: commandId('interaction.scene.start', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        sceneId: `scene:${sceneKey}:${crypto.randomUUID()}`,
        sceneKey,
      })
      await refresh()
    }),

    setParticipantPresence: async (participantKey, present) => withBusy(async () => {
      const base = await version()
      const command = {sessionId: base.id, commandId: commandId('interaction.presence', base.id),
        baseSequence: base.sequence, baseStateHash: base.stateHash, participantKey}
      if (present) await joinInteractionParticipant(command)
      else await leaveInteractionParticipant(command)
      await refresh()
    }),

    sendPlayerMessage: async (text, audienceKeys, draft) => {
      const save = async () => {
        const base = await version()
        if (draft && (base.id !== draft.binding.sessionId || get().scope?.projectId !== draft.binding.scope.projectId
          || get().scope?.worldId !== draft.binding.scope.worldId || get().scope?.workId !== draft.binding.scope.workId)) throw new Error('已经切换存档，未发送原草稿。')
        const event = await commitInteractionPlayerMessage({
          sessionId: base.id,
          commandId: commandId('interaction.message', base.id),
          baseSequence: base.sequence,
          baseStateHash: base.stateHash,
          messageId: `message:player:${crypto.randomUUID()}`,
          text,
          audienceKeys: audienceKeys ?? null,
          ...(draft ? {composerDraft: draft.binding} : {}),
        })
        // The message and consumed draft are durable even if the following UI refresh fails.
        draft?.onCommitted()
        await refresh()
        return event.sequence
      }
      if (get().busy && get().runtimeState.interaction?.chatNarrative && generationAbortController) {
        await get().cancelGeneration()
        // Save the interruption immediately even if the provider ignores abort.
        // The old run stays cancelled; its late result cannot adopt over this input.
        return save()
      }
      return withBusy(save)
    },

    applyFixedAction: async ruleKey => withBusy(async () => {
      const state = get().runtimeState.interaction
      if (state?.chatNarrative) throw new Error('主动叙事通过实际对话产生关系后果，不支持固定加分行动。')
      const rule = state?.activeScene?.relationshipRules.find(item => item.ruleKey === ruleKey)
      if (!state?.activeScene || !rule) throw new Error('固定行动不在当前场景中。')
      const messageBase = await version()
      const message = await commitInteractionPlayerMessage({
        sessionId: messageBase.id,
        commandId: commandId('interaction.fixed-message', messageBase.id),
        baseSequence: messageBase.sequence,
        baseStateHash: messageBase.stateHash,
        messageId: `message:fixed:${rule.ruleKey}:${crypto.randomUUID()}`,
        text: rule.playerText,
        audienceKeys: null,
      })
      const relationshipBase = await readProductRuntimeStateVersion(messageBase.id)
      await changeInteractionRelationship({
        sessionId: messageBase.id,
        commandId: commandId('interaction.fixed-relationship', messageBase.id),
        baseSequence: relationshipBase.sequence,
        baseStateHash: relationshipBase.stateHash,
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: message.sequence,
        significantEventKey: rule.significantEventKey,
      })
      await refresh()
    }),

    generateReplies: async input => withBusy(async () => {
      if (get().runtimeState.interaction?.chatNarrative) {
        await performNarrative({aiConfig: input.aiConfig, kind: 'player-response', replyToSequence: input.replyToSequence, participantKey: input.preferredParticipantKey, actionLimit: input.actionLimit, schedulingMode: input.schedulingMode, audienceKeys: input.audienceKeys})
        return
      }
      const scope = get().scope
      const sessionId = get().selectedSessionId
      const state = get().runtimeState.interaction
      if (!scope || sessionId == null || !state?.activeScene) throw new Error('当前没有进行中的互动场景。')
      if (state.remainingDirectorBudget < 1) throw new Error('本场景的回复预算已用完。玩家消息已保存，请结束场景或进入下一场景。')
      generationAbortController = new AbortController()
      const signal = generationAbortController.signal
      const playerMessage=state.messages.find(m=>m.eventSequence===input.replyToSequence && m.role==='player' && m.supersededBySequence==null)
      if(!playerMessage || playerMessage.eventSequence <= state.activeScene.startedAtSequence)throw new Error('玩家消息不存在或不属于当前场景。')
      const active = state.activeScene.activeParticipantKeys.filter(key=>playerMessage.audienceKeys==null || playerMessage.audienceKeys.includes(key))
      if(!active.length)throw new Error('当前场景没有能够听见此消息的角色。')
      let responders: string[]
      const intents = new Map<string, string>()
      if (input.preferredParticipantKey) {
        responders = [input.preferredParticipantKey]
      } else if (active.length === 1) {
        responders = [...active]
      } else {
        let decision = await readInteractionDirectorPlanV1(scope, sessionId, state.activeScene.sceneId, input.replyToSequence)
        if (!decision) {
          const generated = await generateInteractionRuntimeCandidateV1({
          scope,
          productRuntimeSessionId: sessionId,
          participantKey: active[0],
          skillId: 'prose.interaction-scene-director',
          replyToSequence: input.replyToSequence,
          objective: `根据玩家消息 #${input.replyToSequence} 选择有必要回应的角色和顺序。`,
          aiConfig: input.aiConfig,
          signal,
          onRunCreated: id => { set({ generatingRunId: id }) },
        })
        await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
          if(generated.candidate.kind !== 'scene-director-candidate') throw new Error('导演候选类型错误')
          decision = generated.candidate
        }
        const director = {candidate: decision}
        responders = director.candidate.kind === 'scene-director-candidate'
          ? director.candidate.responders.map(item => item.participantKey) : []
        if (director.candidate.kind === 'scene-director-candidate') {
          for (const responder of director.candidate.responders) intents.set(responder.participantKey, responder.intent)
          if (director.candidate.shouldEnd) {
            const base = await version()
            await endInteractionScene({sessionId: base.id, commandId: commandId('interaction.director.end', base.id), baseSequence: base.sequence, baseStateHash: base.stateHash, sceneId: state.activeScene.sceneId, reason: director.candidate.endReason!})
            return
          }
          if (!responders.length) return
        }
      }
      const completed = new Set(state.messages.filter(m=>m.role==='character' && m.replyToSequence===input.replyToSequence && m.supersededBySequence==null).map(m=>m.speakerKey))
      responders = [...new Set(responders)].filter(key => active.includes(key) && !completed.has(key))
        .slice(0, state.remainingDirectorBudget)
      if (!responders.length) return
      for (const participantKey of responders) {
        const generated = await generateInteractionRuntimeCandidateV1({
          scope,
          productRuntimeSessionId: sessionId,
          participantKey,
          skillId: 'character.interaction-reply',
          objective: `回应意图：${intents.get(participantKey) ?? "直接回应玩家"}。回应玩家消息 #${input.replyToSequence}，budgetCost 设为 1，只披露角色实际知道的信息。`,
          replyToSequence: input.replyToSequence,
          replyBudgetCost: 1,
          aiConfig: input.aiConfig,
          signal,
          onRunCreated: id => { set({ generatingRunId: id }) },
        })
        await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
      }
      set({ generatingRunId: null })
      generationAbortController = null
      await refresh()
    }),

    advanceNarrative: async input => withBusy(() => performNarrative(input)),
    resumeNarrativeTurn: async input => withBusy(async () => {
      const scope = get().scope, sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先选择角色聊天存档。')
      const controller = new AbortController(); generationAbortController = controller
      try {
        await resumeChatNarrativeTurnV1({...input, scope, sessionId, expectedSequence: get().runtimeState.lastSequence,
          signal: controller.signal, onRunCreated: id => set({generatingRunId: id})})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),
    createSituation: async input => withBusy(async () => {
      const scope = get().scope, sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先选择角色聊天存档。')
      const controller = new AbortController(); generationAbortController = controller
      try {
        await createChatNarrativeSituationV1({...input, scope, sessionId, settleSituation: true, expectedSequence: get().runtimeState.lastSequence,
          signal: controller.signal, onRunCreated: id => set({generatingRunId: id})})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),
    reviseNarrativeAction: async (runId, aiConfig) => withBusy(async () => {
      const scope = get().scope, sessionId = get().selectedSessionId
      if (!scope || sessionId == null || get().actionRevisionRunId !== runId) throw new Error('当前没有该可修订回复。')
      const source = await readChatActionRevisionSourceV1({scope, sessionId})
      if (!source || source.runId !== runId) throw new Error('局面或未通过回复已经变化，请刷新后继续。')
      const controller = new AbortController(); generationAbortController = controller
      try {
        const generated = await generateInteractionRuntimeCandidateV1({scope, productRuntimeSessionId: sessionId,
          skillId: CHAT_ACTION_REVISION_SKILL, participantKey: source.actorKey, narrativeTriggerSequence: source.triggerSequence,
          objective: '玩家明确请求修订上一条未生效回复的后果登记。保留原表达和玩家选择，重新审查后才可生效；最多一次，不继续下一次行动。',
          aiConfig, signal: controller.signal, onRunCreated: id => set({generatingRunId: id})})
        if (!controller.signal.aborted) await adoptInteractionRuntimeCandidateV1({scope, runId: generated.snapshot.run.id})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),

    resumeNarrativeReview: async (runId, aiConfig) => withBusy(async () => {
      const scope = get().scope
      if (!scope || !get().pendingNarrativeReviewRunIds.includes(runId)) throw new Error('当前没有该待审查候选。')
      const controller = new AbortController(); generationAbortController = controller
      set({generatingRunId: runId})
      try {
        await (get().pendingMemoryReviewRunIds.includes(runId) ? resumeChatMemoryReviewV1 : resumeChatNarrativeReviewV1)({scope, runId, aiConfig, signal: controller.signal})
        if (!controller.signal.aborted && !get().narrativeOptionRunIds.includes(runId)) await adoptInteractionRuntimeCandidateV1({scope, runId})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),

    resumeNarrativeAction: async (runId, aiConfig) => withBusy(async () => {
      const scope = get().scope
      if (!scope || !get().pendingNarrativeActionRunIds.includes(runId)) throw new Error('当前没有该可继续的角色行动。')
      const controller = new AbortController(); generationAbortController = controller
      set({generatingRunId: runId})
      try {
        await resumeChatNarrativeActionV1({scope, runId, aiConfig, signal: controller.signal})
        if (!controller.signal.aborted) await adoptInteractionRuntimeCandidateV1({scope, runId})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),

    selectNarrativeOption: async (runId, optionKey) => withBusy(async () => {
      const scope = get().scope
      if (!scope || !get().narrativeOptions.some(row => row.runId === runId && !row.unavailableReason)) throw new Error('当前没有该可选行动。')
      await adoptInteractionRuntimeCandidateV1({scope, runId, optionKey})
    }),

    applyMessageRetrieval: async plan => withBusy(async () => {
      const scope = get().scope
      if (!scope || get().selectedSessionId !== plan.sessionId) throw new Error('消息上下文目标已经切换。')
      await applyChatMessageRetrievalPlanV1(scope, plan)
    }),

    forkMessageEdit: async (plan, text) => withBusy(async () => {
      const scope = get().scope
      if (!scope || get().selectedSessionId !== plan.sessionId) throw new Error('改写目标已经切换。')
      const child = await forkChatMessageEditV1({scope, plan, text})
      await reload(child.id!)
    }),

    forkHistoricalOption: async (plan, optionKey) => withBusy(async () => {
      const scope = get().scope
      if (!scope || get().selectedSessionId !== plan.edit.sessionId) throw new Error('历史候选的目标会话已经切换。')
      const child = await forkChatHistoricalOptionV1({scope, plan, optionKey})
      await reload(child.id!)
    }),

    applyMessageEdit: async (text, aiConfig) => withBusy(async () => {
      const scope = get().scope, sessionId = get().selectedSessionId
      if (!scope || sessionId == null) throw new Error('请先选择改写分支。')
      const controller = new AbortController(); generationAbortController = controller
      try {
        await applyChatMessageEditV1({scope, sessionId, expectedSequence: get().runtimeState.lastSequence, text, aiConfig,
          signal: controller.signal, onRunCreated: id => set({generatingRunId: id})})
      } catch (reason) {if (!controller.signal.aborted) throw reason}
    }),

    cancelMessageEdit: async () => withBusy(async () => {
      const base = await version()
      await updateChatMessageEditDraft({sessionId: base.id, commandId: commandId('chat.edit.cancel', base.id), baseSequence: base.sequence, baseStateHash: base.stateHash, text: '', cancel: true})
      for (const runId of get().pendingNarrativeRunIds) await cancelInteractionRuntimeRunV1({scope: get().scope!, runId})
    }),

    cancelPendingRun: async runId => withBusy(async () => {
      const scope = get().scope
      if (!scope || ![...get().pendingNarrativeRunIds, ...get().pendingNarrativeReviewRunIds, ...get().pendingNarrativeActionRunIds, ...get().narrativeOptionRunIds].includes(runId)) throw new Error('当前没有该未完成行动。')
      await cancelInteractionRuntimeRunV1({scope, runId})
    }),

    retryReply: async input => withBusy(async () => {
      if (get().runtimeState.interaction?.chatNarrative) throw new Error('角色行动包含已经发生的后果；请从行动前的检查点建立分支，不可只替换台词。')
      const scope = get().scope
      const sessionId = get().selectedSessionId
      const reply = get().runtimeState.interaction?.messages.find(item => item.eventSequence === input.replySequence)
      if (!scope || sessionId == null || !reply || reply.role !== 'character' || reply.replyToSequence == null
        || reply.supersededBySequence != null) throw new Error('要重试的角色回复已失效。')
      generationAbortController = new AbortController()
      const generated = await generateInteractionRuntimeCandidateV1({
        scope,
        productRuntimeSessionId: sessionId,
        participantKey: reply.speakerKey,
        skillId: 'character.interaction-reply',
        objective: `重新回应玩家消息 #${reply.replyToSequence}，budgetCost 设为 0，不重复提交玩家消息。`,
        replyToSequence: reply.replyToSequence,
        supersedesSequence: reply.eventSequence,
        replyBudgetCost: 0,
        aiConfig: input.aiConfig,
        signal: generationAbortController.signal,
        onRunCreated: id => { set({ generatingRunId: id }) },
      })
      await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
      set({ generatingRunId: null })
      generationAbortController = null
      await refresh()
    }),

    cancelGeneration: async () => {
      const scope = get().scope
      const runId = get().generatingRunId
      generationAbortController?.abort()
      generationAbortController = null
      if (!scope || runId == null) return
      await cancelInteractionRuntimeRunV1({ scope, runId })
      set({ generatingRunId: null })
    },

    resumeRun: async runId => withBusy(async () => {
      const scope = get().scope
      if (!scope) throw new Error('工作区未加载。')
      await adoptInteractionRuntimeCandidateV1({ scope, runId })
      await refresh()
    }),

    manageMemory: async (plan, action) => withBusy(async () => {
      const scope = get().scope
      if (!scope || get().selectedSessionId !== plan.sessionId) throw new Error('已切换聊天，原记忆操作未提交。')
      await applyChatMemoryManagementPlanV1(scope, plan, action)
    }, false),

    finishScene: async (reason, aiConfig) => withBusy(async () => {
      const state = get().runtimeState.interaction
      if (!state?.activeScene) throw new Error('当前没有进行中的场景。')
      const scope = get().scope
      const sessionId = get().selectedSessionId
      generationAbortController = new AbortController()
      const signal = generationAbortController.signal
      let curatorFailure = ''
      if (scope && sessionId != null && aiConfig && state.messages.length) {
        for (const participantKey of state.activeScene.activeParticipantKeys) {
          try {
            const generated = await generateInteractionRuntimeCandidateV1({
              scope,
              productRuntimeSessionId: sessionId,
              participantKey,
              skillId: 'character.interaction-memory-curator',
              signal,
              objective: `在场景 ${state.activeScene.sceneId} 结束前，仅依据该角色可见的真实消息提出一条可追溯摘要或关键记忆候选。`,
              aiConfig,
              onRunCreated: id => { set({ generatingRunId: id }) },
            })
            await adoptInteractionRuntimeCandidateV1({ scope, runId: generated.snapshot.run.id })
          } catch (cause) {
            if (signal.aborted) throw cause
            curatorFailure = cause instanceof Error ? cause.message : String(cause)
            break
          }
        }
      }
      if (signal.aborted) throw new Error('已停止整理，场景未结束。')
      if (curatorFailure) throw new Error(`记忆整理未完成，场景保留以供恢复：${curatorFailure}`)
      const base = await version()
      await endInteractionScene({
        sessionId: base.id,
        commandId: commandId('interaction.scene.end', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        sceneId: state.activeScene.sceneId,
        reason: reason?.trim() || '玩家结束场景',
      })
      set({ generatingRunId: null })
      await refresh()
    }),

    chooseNarrative: async choiceKey => withBusy(async () => {
      const base = await version()
      await commitNarrativeChoice({
        sessionId: base.id,
        commandId: commandId('interaction.narrative-choice', base.id),
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
        choiceKey,
      })
      await refresh()
    }),

    saveCheckpoint: async name => withBusy(async () => {
      const id = get().selectedSessionId
      if (id == null) throw new Error('请先选择存档。')
      await createProductRuntimeCheckpoint({ sessionId: id, name })
      await refresh()
    }),

    forkCurrent: async title => withBusy(async () => {
      const id = get().selectedSessionId
      const scope = get().scope
      if (id == null || !scope) throw new Error('请先选择存档。')
      const state = await readProductRuntimeState(id)
      const child = await branchProductRuntimeSession({ parentSessionId: id, throughSequence: state.lastSequence, title: title?.trim() || '互动分支' })
      await reload(child.id!)
      return child.id!
    }),

    forkCheckpoint: async (checkpointId, title) => withBusy(async () => {
      const checkpoint = await db.productRuntimeCheckpoints.get(checkpointId)
      if (!checkpoint) throw new Error('检查点不存在。')
      const child = await branchProductRuntimeSession({
        parentSessionId: checkpoint.sessionId,
        throughSequence: checkpoint.throughSequence,
        title: title?.trim() || `${checkpoint.name} · 分支`,
      })
      await reload(child.id!)
      return child.id!
    }),

    remove: async sessionId => withBusy(async () => {
      await deleteProductRuntimeSession(sessionId)
      await reload(get().selectedSessionId === sessionId ? null : undefined)
    }),
  }
})
