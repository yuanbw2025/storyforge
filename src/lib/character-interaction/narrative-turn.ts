import {chatCanFollowThreadV1} from './narrative-thread-followup'
import {chatNewTurnAllowanceV1, chatPreparedTurnAllowanceV1, chatSituationAndActionAllowanceV1} from './narrative-budget'
import {resolveChatTurnAudienceV1} from './narrative-audience'
import {chatTurnActionLimitV1} from './narrative-contract'
import {chatCanActInTurnV1, chatCanRespondAfterClosureV1, chatHasUnfinishedGoalV1, createChatScheduledDirectionV1, nextChatScheduledActorV1, type ChatSchedulingModeV1} from './narrative-scheduling'
import { assertInstanceBinding } from '../product/runtime-instances'
import {db} from '../db/schema'
import {readInstanceAgentRunV1} from '../agent/run/event-store'
import type { AIConfig, CharacterInteractionRuntimeState, WorkspaceScope } from '../types'
import type { ChatNarrativeTriggerV1 } from '../types/chat-narrative'
import { adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1 } from './harness'
import {chatHasPendingPlayerFollowupV1, chatHasPendingTurnSettlementV1, chatSituationConstructionBlockedV1, chatSituationConstructionRequestV1} from './narrative-progression'
import {isImportedCompletedInteractionRunV1, readResumableInteractionRunsV1} from './runtime-run-recovery'
import { readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger } from './runtime-api'

export type ChatPlayerTriggerV1 = Exclude<ChatNarrativeTriggerV1, 'player-seed'>

/** Never infer acceptance of a suggestion from continuing or returning to chat. */
const objectives: Record<ChatPlayerTriggerV1, string> = {
  'scene-start': '开始当前情境。依角色自己的动机采取一次有意义的表达或行动，给玩家留下回应空间。',
  'player-response': '承接最新玩家消息，尤其是拒绝、改换办法或休息的要求。依当前情境和自身动机行动，不替玩家接受建议。',
  continue: '玩家明确请角色继续演绎，但没有因此接受任何建议。承接当前局面，必要时等待玩家，也可以留白或收束。',
  return: '玩家返回会话并明确继续。承接最后已发生的局面，不推定离线时间、玩家行为或关系惩罚。',
}

/** Read-only recovery view. It never grants a new trigger or resets its limits. */
export interface ChatNarrativeTurnResumeV1 {
  triggerSequence: number
  actorKey: string | null
  remainingActions: number
  blockedReason: string | null
  schedulingMode?: Exclude<ChatSchedulingModeV1, 'manual'>
  pendingSituation?: true
}

export async function readChatNarrativeTurnResumeV1(scope: WorkspaceScope, sessionId: number, state: CharacterInteractionRuntimeState): Promise<ChatNarrativeTurnResumeV1 | null> {
  await assertInstanceBinding(sessionId, scope)
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!state.activeScene || !story || story.pendingEdit || trigger?.status !== 'ready') return null
  const lastAction = trigger.actionSequences.slice(-1)[0]
  const settlement = chatHasPendingTurnSettlementV1(state)
  const constructingSeed = chatSituationConstructionRequestV1(state)?.origin === 'player-request'
  const actorKey = settlement ? story.pendingSituation!.actorKey : trigger.direction?.scheduling && !constructingSeed ? nextChatScheduledActorV1(state, trigger)
    : trigger.direction?.actorKey ?? (lastAction == null ? null : state.messages.find(m => m.eventSequence === lastAction && m.role === 'character')?.speakerKey ?? null)
  const remainingActions = Math.max(0, chatTurnActionLimitV1(story.permissions, trigger) - trigger.actionSequences.length)
  const onlyPausedAfterAction = !trigger.direction?.scheduling && !settlement && !constructingSeed
    && lastAction != null && !!actorKey && chatHasUnfinishedGoalV1(state, actorKey)
    && !chatCanActInTurnV1(state, actorKey, trigger)
  const view = {triggerSequence: trigger.requestedSequence, actorKey, remainingActions, blockedReason: null as string | null,
    ...(settlement ? {pendingSituation: true as const} : {}),
    ...(trigger.direction?.scheduling ? {schedulingMode: trigger.direction.scheduling.mode} : {})}
  if (!onlyPausedAfterAction && (!remainingActions && !settlement || state.remainingDirectorBudget < chatPreparedTurnAllowanceV1(state, actorKey))) return {...view, blockedReason: '本轮剩余额度不足，不能继续生成。'}
  if (trigger.direction?.scheduling && !actorKey) return {...view, blockedReason: '本轮已没有可继续行动的角色，无需补齐。'}
  if (!trigger.direction?.scheduling && lastAction != null && !actorKey) return {...view, blockedReason: '本轮原角色消息不完整，不能推定由谁继续。'}
  if (!settlement && !constructingSeed && actorKey && !chatHasUnfinishedGoalV1(state, actorKey) && !chatHasPendingPlayerFollowupV1(state, actorKey) && !chatCanRespondAfterClosureV1(state, actorKey, trigger) && !chatCanFollowThreadV1(state, actorKey, trigger)) return {...view, blockedReason: '本轮角色的目标已经结束，无需补齐行动。'}
  if (story.pendingSituation && (trigger.direction?.scheduling || story.pendingSituation.actorKey === actorKey)
    && chatSituationConstructionBlockedV1(state)) return {...view, blockedReason: '本轮已经发展过一次局面。新的角色方向需在下一轮明确继续。'}
  const [rows, events] = await Promise.all([
    db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray(),
    db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray(),
  ])
  for (const row of rows) {
    const contract = JSON.parse(row.contractJson)
    if (contract.scope?.runtime?.baseSequence < trigger.requestedSequence
      || !contract.executionBindings?.some((binding: {skillId?: string}) => ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-situation-construction', 'character.chat-action-revision'].includes(binding.skillId ?? ''))) continue
    const snapshot = await readInstanceAgentRunV1(scope, row.id!)
    if (isImportedCompletedInteractionRunV1(snapshot, events)) continue
    const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted')
    if (snapshot.projection.state === 'completed' && adopted?.type === 'runtime.candidate.adopted' && adopted.payload.commandIds.length
      && adopted.payload.commandIds.every(id => events.some(event => event.commandId === id && event.sequence > adopted.payload.baseSequence && event.sequence <= adopted.payload.resultingSequence))) continue
    const unknown = snapshot.events.some(event => event.type === 'model.requested'
      && !snapshot.events.some(response => response.type === 'evidence.artifact.recorded' && response.payload.artifactKind === 'raw-response' && response.payload.stepId === event.payload.stepId))
    return {...view, blockedReason: unknown
      ? `本轮调用结果未知（运行 #${row.id}），补齐不会重发。请先处理原运行；需要新尝试时明确开始下一轮，原调用可能已经计费。`
      : `本轮有尚未采用、失败或取消的运行 #${row.id}。请先恢复已有候选；需要新尝试时明确开始下一轮。`}
  }
  // Inspect durable runs first: an earlier extra call may still be failed,
  // unknown or awaiting adoption. No-active-goal inference must not hide it.
  return onlyPausedAfterAction ? null : view
}

/** Continue only the unspent part of the existing authorized turn. Failed or
 * unknown attempts require a new explicit trigger, never a hidden resend. */
export async function resumeChatNarrativeTurnV1(input: {
  scope: WorkspaceScope; sessionId: number; expectedSequence: number; participantKey?: string
  aiConfig: AIConfig; situationAiConfig?: AIConfig; signal?: AbortSignal; onRunCreated?: (id: number) => void
}): Promise<void> {
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('角色行动已取消。')
  const state = await readProductRuntimeState(input.sessionId)
  if (state.lastSequence !== input.expectedSequence || !state.interaction) throw new Error('当前情境已变化，请刷新后继续。')
  const view = await readChatNarrativeTurnResumeV1(input.scope, input.sessionId, state.interaction)
  if (!view) throw new Error('当前没有可以补齐的未完成轮次。')
  if (view.blockedReason) throw new Error(view.blockedReason)
  if (!view.schedulingMode && view.actorKey && input.participantKey && input.participantKey !== view.actorKey) throw new Error('补齐本轮须沿用原行动角色；换角色请开始下一轮。')
  const trigger = state.interaction.chatNarrative!.triggers.slice(-1)[0]!
  const actor = view.schedulingMode || chatSituationConstructionRequestV1(state.interaction)?.origin === 'player-request'
    ? view.actorKey ?? input.participantKey ?? null : actorFor(state.interaction, trigger.kind === 'player-seed' ? 'continue' : trigger.kind, view.actorKey ?? input.participantKey)
  if (!actor) throw new Error('角色当前目标已经结束，无需补齐行动。')
  if (state.interaction.remainingDirectorBudget < chatPreparedTurnAllowanceV1(state.interaction, actor)) throw new Error('本轮剩余额度不足，不能继续生成。')
  if ((await readProductRuntimeStateVersion(input.sessionId)).sequence !== input.expectedSequence) throw new Error('当前情境已变化，请刷新后继续。')
  const request = chatSituationConstructionRequestV1(state.interaction, actor)
  if (request?.origin === 'player-request') {
    if (state.interaction.remainingDirectorBudget < chatSituationAndActionAllowanceV1()) throw new Error('当前预算不足以构建、审查并演绎新情境。')
    const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
      skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: trigger.requestedSequence,
      objective: '补齐本轮尚未发起的情境构建，承接原玩家请求与旧局面，保留玩家选择。',
      aiConfig: input.situationAiConfig ?? input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
    if (input.signal?.aborted) return
    await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  }
  await performPreparedTurn({...input, actor, triggerSequence: trigger.requestedSequence,
    objective: trigger.kind === 'player-seed' ? '承接本轮已经构建的情境，仅按自己的知识和动机演绎，不重建背景或替玩家决定。' : objectives[trigger.kind]})
}

/** Active run IDs only; an interrupted call with unknown outcome is not a retry instruction. */
export async function readPendingChatNarrativeRunsV1(scope: WorkspaceScope, sessionId: number, state: CharacterInteractionRuntimeState): Promise<number[]> {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0]
  if (!trigger || trigger.status === 'cancelled') return []
  const rows = await readResumableInteractionRunsV1(scope, sessionId)
  const pending: number[] = []
  for (const row of rows) {
    if (['completed', 'failed', 'cancelled'].includes(row.status)) continue
    const contract = JSON.parse(row.contractJson)
    if (contract.scope?.runtime?.baseSequence < trigger.requestedSequence
      || !contract.executionBindings?.some((b: {skillId?: string}) => ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-situation-construction', 'character.chat-action-revision'].includes(b.skillId ?? ''))) continue
    pending.push(row.id!)
  }
  return pending
}

function actorFor(state: CharacterInteractionRuntimeState, kind: ChatPlayerTriggerV1, preferred?: string, audience?: string[]): string | null {
  const message = kind === 'player-response' ? state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0] : null
  const active = state.activeScene!.activeParticipantKeys.filter(key => (!message?.audienceKeys || message.audienceKeys.includes(key))
    && (!audience || audience.includes(key))
    && (kind === 'player-response' || chatCanFollowThreadV1(state, key, {kind, actionSequences: []}) || chatHasPendingPlayerFollowupV1(state, key) || chatHasUnfinishedGoalV1(state, key)))
  if (preferred) {
    if (!active.includes(preferred)) throw new Error('选定角色不在场、听不到此消息或当前目标已结束。')
    return preferred
  }
  if (active.length > 1) throw new Error('请选择本轮行动的角色。多人自动调度尚未开启。')
  return active[0] ?? null
}

/** Normal player path: explicit trigger → registered Harness candidate → atomic
 * action/consequences. It never runs on mount and never inserts a player message. */
export async function advanceChatNarrativeTurnV1(input: {
  scope: WorkspaceScope
  sessionId: number
  kind: ChatPlayerTriggerV1
  expectedSequence: number
  replyToSequence?: number
  participantKey?: string
  actionLimit?: number
  settleSituation?: true
  audienceKeys?: string[] | null
  schedulingMode?: ChatSchedulingModeV1
  aiConfig: AIConfig
  /** Compare one next action after any explicitly authorized shared background. */
  compare?: boolean
  signal?: AbortSignal
  onRunCreated?: (id: number) => void
}): Promise<void> {
  const selectedAudience = input.audienceKeys == null ? input.audienceKeys : [...input.audienceKeys]
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('角色行动已取消。')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const state = (await readProductRuntimeState(input.sessionId)).interaction
  if (version.sequence !== input.expectedSequence || !state?.activeScene || !state.chatNarrative) throw new Error('当前情境已变化，请刷新后继续。')
  if (state.remainingDirectorBudget < 2) throw new Error('当前预算不足以生成并审查角色行动。')
  const source = input.kind === 'scene-start' ? state.activeScene.startedAtSequence
    : input.kind === 'player-response' ? input.replyToSequence : version.sequence
  if (source == null) throw new Error('缺少玩家消息。')
  const previous = state.chatNarrative.triggers.find(t => t.kind === input.kind && t.sourceEventSequence === source)
  if (['scene-start', 'player-response'].includes(input.kind) && previous) {
    if (previous.status === 'complete' || previous.status === 'waiting-player') return
    throw new Error('这次开场或回应已发起。请恢复候选，或明确选择继续，不会重复发送同一请求。')
  }
  const pending = await readPendingChatNarrativeRunsV1(input.scope, input.sessionId, state)
  if (pending.length) throw new Error(`上次行动尚未结束（运行 #${pending.join('、#')}），请先恢复候选或取消该运行。`)
  // Autonomous continuation needs unfinished goals; fresh player input can still receive a reply.
  const conversation = resolveChatTurnAudienceV1(state, input.kind, source, selectedAudience)
  const audienceParticipantKeys = conversation?.audienceParticipantKeys
  const direction = input.schedulingMode && input.schedulingMode !== 'manual'
    ? createChatScheduledDirectionV1(state, {mode: input.schedulingMode, kind: input.kind, sourceSequence: source, actionLimit: input.actionLimit ?? 1, audienceParticipantKeys}) : undefined
  const actor = direction?.actorKey ?? actorFor(state, input.kind, input.participantKey, audienceParticipantKeys)
  if (!actor) throw new Error('角色当前目标已经结束，可以结束场景或稍后设置新情境。')
  let requestedDirection = input.settleSituation && !input.compare && state.chatNarrative.permissions.allowActorSituationExpansion
    ? {...(direction ?? {actorKey: actor, actionLimit: input.actionLimit ?? state.chatNarrative.permissions.maxActionsPerTrigger}), settleSituationVersion: 1 as const}
    : direction ?? (input.actionLimit === undefined ? undefined : {actorKey: actor, actionLimit: input.actionLimit})
  if (conversation) requestedDirection = {...(requestedDirection ?? {actorKey: actor, actionLimit: input.actionLimit ?? state.chatNarrative.permissions.maxActionsPerTrigger}), ...conversation}
  const allowance = chatNewTurnAllowanceV1(state, {sequence: version.sequence + 1, kind: input.kind, sourceEventSequence: source,
    seed: null, ...(requestedDirection ? {direction: requestedDirection} : {})}, actor, input.compare)
  if (state.remainingDirectorBudget < allowance) throw new Error('当前预算不足以完成本次角色行动及所需的局面发展。')
  const requested = await requestChatNarrativeTrigger({sessionId: input.sessionId,
    commandId: `chat.turn:${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: input.kind, sourceEventSequence: source, ...(requestedDirection ? {direction: requestedDirection} : {})})
  await performPreparedTurn({...input, actor, triggerSequence: requested.sequence, objective: objectives[input.kind]})
}

async function performPreparedTurn(input: {
  scope: WorkspaceScope; sessionId: number; actor: string; triggerSequence: number; objective: string; aiConfig: AIConfig
  signal?: AbortSignal; onRunCreated?: (id: number) => void
  compare?: boolean
}): Promise<void> {
  const initial = (await readProductRuntimeState(input.sessionId)).interaction!
  const originalTrigger = initial.chatNarrative!.triggers.slice(-1)[0]!
  const remaining = chatTurnActionLimitV1(initial.chatNarrative!.permissions, originalTrigger) - originalTrigger.actionSequences.length
  for (let i = 0; i < remaining; i++) {
    if (input.signal?.aborted) return
    let current = (await readProductRuntimeState(input.sessionId)).interaction!
    const trigger = current.chatNarrative!.triggers.slice(-1)[0]!
    if (trigger.requestedSequence !== input.triggerSequence || trigger.status !== 'ready' || current.remainingDirectorBudget < 2) return
    let actor = trigger.direction?.scheduling ? nextChatScheduledActorV1(current, trigger) : input.actor
    if (!actor || !chatCanActInTurnV1(current, actor, trigger)) return
    const story = current.chatNarrative!
    if (story.pendingSituation && (trigger.direction?.scheduling || story.pendingSituation.actorKey === actor)
      && chatSituationConstructionBlockedV1(current)) return
    const request = chatSituationConstructionRequestV1(current, actor)
    if (request?.actorKey === actor) {
      if (current.remainingDirectorBudget < chatSituationAndActionAllowanceV1(input.compare)) throw new Error('当前预算不足以发展角色方向并继续演绎。')
      const situation = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
        skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: input.triggerSequence,
        objective: '依已经审查的角色方向补足当前局面中的开放条件，承接自己的未完成事项或玩家明确提出的新事项，保留已完成结果、其他角色的打算与玩家选择。',
        aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
      if (input.signal?.aborted) return
      await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: situation.snapshot.run.id})
      current = (await readProductRuntimeState(input.sessionId)).interaction!
      if (input.signal?.aborted || current.chatNarrative!.triggers.slice(-1)[0]?.requestedSequence !== input.triggerSequence
        || current.chatNarrative!.triggers.slice(-1)[0]?.status !== 'ready') return
      if (trigger.direction?.scheduling) actor = nextChatScheduledActorV1(current, current.chatNarrative!.triggers.slice(-1)[0]!)
      if (!actor) return
    }
    if (current.remainingDirectorBudget < chatPreparedTurnAllowanceV1(current, actor, input.compare)) return
    const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
      skillId: input.compare ? 'character.chat-narrative-options' : 'character.chat-narrative-action', participantKey: actor, narrativeTriggerSequence: input.triggerSequence,
      objective: input.objective, aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
    if (input.signal?.aborted) return
    // Comparison ends at the reviewed checkpoint. Even a multi-action trigger
    // cannot select an alternative or execute a sequel without player input.
    if (input.compare) return
    await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  }
  if (input.signal?.aborted || input.compare) return
  const current = (await readProductRuntimeState(input.sessionId)).interaction!
  if (current.chatNarrative!.triggers.slice(-1)[0]?.requestedSequence !== input.triggerSequence
    || !chatHasPendingTurnSettlementV1(current)) return
  if (current.remainingDirectorBudget < 2) throw new Error('角色这一步已保存；本轮情境尚未补齐，剩余预算不足。')
  const settlement = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
    skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: input.triggerSequence,
    objective: '补齐本轮最后一步已审查方向所需的背景或已完成观察的结果。保留拒绝与暂停，不把打算写成已经执行，不替玩家作决定，不继续角色行动。',
    aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
  if (input.signal?.aborted) return
  await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: settlement.snapshot.run.id})
}

/** An explicit backstage request is neither player dialogue nor an event that
 * has happened. Construct and review first, then let one selected role act. */
export async function createChatNarrativeSituationV1(input: {
  scope: WorkspaceScope; sessionId: number; expectedSequence: number; seed: string; participantKey?: string; actionLimit?: number; schedulingMode?: ChatSchedulingModeV1; settleSituation?: true; audienceKeys?: string[] | null
  aiConfig: AIConfig; actionAiConfig?: AIConfig; signal?: AbortSignal; onRunCreated?: (id: number) => void
}): Promise<void> {
  const selectedAudience = input.audienceKeys == null ? input.audienceKeys : [...input.audienceKeys]
  await assertInstanceBinding(input.sessionId, input.scope)
  if (input.signal?.aborted) throw new Error('情境构建已取消。')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const state = (await readProductRuntimeState(input.sessionId)).interaction
  if (version.sequence !== input.expectedSequence || !state?.activeScene || !state.chatNarrative) throw new Error('当前情境已变化，请刷新后继续。')
  const conversation = resolveChatTurnAudienceV1(state, 'player-seed', version.sequence, selectedAudience)
  const audienceParticipantKeys = conversation?.audienceParticipantKeys
  const active = state.activeScene.activeParticipantKeys.filter(key => !audienceParticipantKeys || audienceParticipantKeys.includes(key))
  const direction = input.schedulingMode && input.schedulingMode !== 'manual'
    ? createChatScheduledDirectionV1(state, {mode: input.schedulingMode, kind: 'player-seed', sourceSequence: version.sequence, actionLimit: input.actionLimit ?? 1, audienceParticipantKeys}) : undefined
  const actor = direction?.actorKey ?? (input.participantKey || (active.length === 1 ? active[0] : null))
  if (!actor || !active.includes(actor)) throw new Error('请选择新情境中行动的在场角色。')
  if (state.remainingDirectorBudget < chatSituationAndActionAllowanceV1()) throw new Error('当前预算不足以构建、审查并演绎新情境。')
  if ((await readPendingChatNarrativeRunsV1(input.scope, input.sessionId, state)).length) throw new Error('请先恢复或取消尚未完成的行动。')
  let requestedDirection = input.settleSituation && state.chatNarrative.permissions.allowActorSituationExpansion
    ? {...(direction ?? {actorKey: actor, actionLimit: input.actionLimit ?? state.chatNarrative.permissions.maxActionsPerTrigger}), settleSituationVersion: 1 as const}
    : direction ?? (input.actionLimit === undefined ? undefined : {actorKey: actor, actionLimit: input.actionLimit})
  if (conversation) requestedDirection = {...(requestedDirection ?? {actorKey: actor, actionLimit: input.actionLimit ?? state.chatNarrative.permissions.maxActionsPerTrigger}), ...conversation}
  const trigger = await requestChatNarrativeTrigger({sessionId: input.sessionId, commandId: `chat.seed:${crypto.randomUUID()}`,
    baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'player-seed', sourceEventSequence: version.sequence, seed: input.seed, ...(requestedDirection ? {direction: requestedDirection} : {})})
  const generated = await generateInteractionRuntimeCandidateV1({scope: input.scope, productRuntimeSessionId: input.sessionId,
    skillId: 'character.chat-situation-construction', participantKey: 'player', narrativeTriggerSequence: trigger.sequence,
    objective: '将玩家最新情境请求内化为当前背景与开放方向，承接旧问题，保留玩家选择。',
    aiConfig: input.aiConfig, signal: input.signal, onRunCreated: input.onRunCreated})
  if (input.signal?.aborted) return
  await adoptInteractionRuntimeCandidateV1({scope: input.scope, runId: generated.snapshot.run.id})
  await performPreparedTurn({...input, aiConfig: input.actionAiConfig ?? input.aiConfig, actor, triggerSequence: trigger.sequence,
    objective: '情境已经审查并更新。只根据你可知的新旧事实和自身动机采取一次合理行动，不替玩家作决定，不把未来打算当成已发生。'})
}
