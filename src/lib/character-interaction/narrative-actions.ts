import {validateChatSceneTransitionV1, requireChatSceneTransitionV1, applyChatSceneTransitionV1, validateChatSceneTransitionCheckV1} from './narrative-scene-transition'
import {assertChatTurnCompletionV1, parseChatTurnCompletionV1, validateChatTurnCompletionCheckV1} from './turn-completion'
import {requireChatPromiseRequestV1} from './narrative-promise-request'
import {recordChatResolutionEvidenceV1} from './resolution-evidence'
import {recordChatFactEvidenceV1} from './fact-evidence'
import {assertChatInquiryRespondentReferenceV1, assertChatInquirySettlementActionV1} from './inquiry-settlement'
import {chatHasPendingTurnSettlementV1} from './narrative-progression'
import {assertChatTurnAudienceV1, chatTurnAudienceBoundaryV1, chatTurnHasPrivateSceneBoundaryV1} from './narrative-audience'
import {chatConversationEvidenceV1} from './narrative-conversation-evidence'
import {applyChatPlayerGoalResumeV1, requireChatExistingGoalPauseV1, validateChatPlayerRequestEvidenceV1} from './narrative-player-pause'
import {applyChatThreadFollowupGoalV1, chatCanFollowThreadV1} from './narrative-thread-followup'
import {applyChatMemoryReconciliationsV1, parseChatMemoryReconciliationChecksV1} from './memory-reconciliation'
import {chatReviewedActionAllowanceV1} from './action-choice-budget'
import {assertChatResponseRetrievableV1, isChatMessageRetrievableV1} from './narrative-retrieval'
import {assertChatTurnActorV1, chatCanRespondAfterClosureV1} from './narrative-scheduling'
import {canonicalStringify} from '../agent/run/hash'
import type { CharacterInteractionRuntimeState } from '../types'
import { CHAT_NARRATIVE_TRIGGERS_V1, CHAT_THREAD_STATUSES_V1, CHAT_ACTION_REVIEW_CHECKS_V1 } from '../types/chat-narrative'
import type { ChatNarrativeActionV1, ChatNarrativeActionReviewV1, ChatNarrativeStateV1, ChatNarrativeTriggerV1 } from '../types/chat-narrative'
import { chatTurnActionLimitV1, parseChatNarrativeStateV1, parseChatTurnDirectionV1 } from './narrative-contract'
import { isChatSituationPreparedV1 } from './narrative-situations'
import {applyChatRelationshipEffectsV1} from './narrative-relationships'
import {applyChatActorReflectionV1} from './narrative-reflection'
import {applyChatOwnFollowupGoalV1} from './narrative-followup-goal'
import {applyChatCommitmentEffectsV1, parseChatCommitmentEffectsV1, validateChatCommitmentChecksV1} from './narrative-commitments'

function fail(message: string): never { throw new Error(`[chat-action] ${message}`) }
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('行动字段不在允许闭集')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 4000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('行动文本无效')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('行动引用不是稳定标识')
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('行动数组超出上限')
  return value
}
function keys(value: unknown, max = 200): string[] {
  const result = list(value, max)
  result.forEach(key)
  if (new Set(result).size !== result.length) fail('行动引用重复')
  return result as string[]
}
function choice(value: unknown, allowed: readonly string[]) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail('行动枚举值无效')
}

/** Structural parse also runs on restored candidates; state-dependent checks run again at commit. */
export function parseChatNarrativeActionV1(value: unknown): ChatNarrativeActionV1 {
  const optional = ['relationshipUpdates', 'nextPossibilities', 'beliefUpdates', 'goalUpdates', 'situationRequest', 'followupGoal', 'threadFollowupGoal', 'resumeGoal', 'pauseGoal', 'promiseRequest', 'sceneTransition', 'commitmentEffects', 'turnCompletion'].filter(name => value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, name))
  const row = object(value, ['kind,text,goalKey,evidenceFactKeys,audienceKeys,waitingForPlayer,newFacts,disclosures,threadUpdates,goalStatus', ...optional].join(','))
  choice(row.kind, ['speak', 'attempt', 'complete', 'pause'])
  text(row.text, 8000); if (row.goalKey !== null) key(row.goalKey); keys(row.evidenceFactKeys); keys(row.audienceKeys, 33)
  if (typeof row.waitingForPlayer !== 'boolean') fail('等待玩家标记无效')
  for (const value of list(row.newFacts, 5)) {
    const fact = object(value, 'factKey,kind,text,evidenceFactKeys,evidenceExcerpt')
    key(fact.factKey); choice(fact.kind, ['observation', 'object', 'place', 'temporary-character'])
    text(fact.text, 7900); keys(fact.evidenceFactKeys); text(fact.evidenceExcerpt, 8000)
  }
  for (const value of list(row.disclosures, 12)) {
    const equivalent = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'wording')
    const disclosure = object(value, 'factKey,toParticipantKeys,evidenceExcerpt' + (equivalent ? ',wording' : ''))
    key(disclosure.factKey); keys(disclosure.toParticipantKeys, 33); text(disclosure.evidenceExcerpt, 8000)
    if (equivalent) choice(disclosure.wording, ['equivalent'])
  }
  for (const value of list(row.threadUpdates, 8)) {
    const thread = object(value, 'threadKey,status,evidenceExcerpt')
    key(thread.threadKey); choice(thread.status, CHAT_THREAD_STATUSES_V1); text(thread.evidenceExcerpt, 8000)
  }
  if (row.goalStatus !== null) choice(row.goalStatus, ['active', 'paused', 'fulfilled', 'abandoned'])
  if (optional.includes('commitmentEffects')) parseChatCommitmentEffectsV1(row.commitmentEffects)
  if (optional.includes('goalUpdates')) for (const value of list(row.goalUpdates, 4)) {
    const goal = object(value, 'goalKey,status,evidenceFactKeys,evidenceExcerpt')
    key(goal.goalKey); choice(goal.status, ['active', 'paused', 'fulfilled', 'abandoned'])
    keys(goal.evidenceFactKeys, 20); text(goal.evidenceExcerpt, 2000)
  }
  if (optional.includes('relationshipUpdates')) for (const value of list(row.relationshipUpdates, 2)) {
    const effect = object(value, 'dimensionKey,delta,sourceEventSequence,playerExcerpt,evidenceExcerpt')
    key(effect.dimensionKey); text(effect.playerExcerpt, 2000); text(effect.evidenceExcerpt, 2000)
    if (typeof effect.delta !== 'number' || !Number.isFinite(effect.delta) || effect.delta === 0 || Math.abs(effect.delta) > 2
      || !Number.isSafeInteger(effect.sourceEventSequence) || effect.sourceEventSequence === 0) fail('关系幅度或证据序号无效')
  }
  if (optional.includes('nextPossibilities') && row.nextPossibilities !== null) for (const value of list(row.nextPossibilities, 3)) {
    const plan = object(value, 'text,evidenceFactKeys')
    text(plan.text, 1200); keys(plan.evidenceFactKeys, 20)
  }
  if (optional.includes('beliefUpdates')) for (const value of list(row.beliefUpdates, 8)) {
    const belief = object(value, 'beliefKey,text,evidenceFactKeys')
    key(belief.beliefKey); if (belief.text !== null) text(belief.text, 1200)
    keys(belief.evidenceFactKeys, 20)
  }
  if (optional.includes('situationRequest') && row.situationRequest !== null) {
    const hasPurpose = typeof row.situationRequest === 'object' && Object.prototype.hasOwnProperty.call(row.situationRequest, 'purpose')
    const followup = hasPurpose && (row.situationRequest as {purpose: unknown}).purpose === 'player-followup'
    const inquiry = hasPurpose && (row.situationRequest as {purpose: unknown}).purpose === 'inquiry-result'
    const request = object(row.situationRequest, 'threadKey,direction,evidenceFactKeys,evidenceExcerpt' + (hasPurpose ? ',purpose' : '') + (followup ? ',playerEventSequence,playerExcerpt' : '') + (inquiry ? ',respondentFactKey,respondentExcerpt,respondentName' : ''))
    if (inquiry) assertChatInquiryRespondentReferenceV1(request)
    if (hasPurpose) choice(request.purpose, ['observation-result', 'player-followup', 'inquiry-result'])
    if (followup) {
      if (request.threadKey !== null || !Number.isSafeInteger(request.playerEventSequence) || request.playerEventSequence === 0) fail('新事项来源无效')
      text(request.playerExcerpt, 1200)
    } else key(request.threadKey)
    text(request.direction, 1200); keys(request.evidenceFactKeys, 20); text(request.evidenceExcerpt, 1200)
  }
  if (optional.includes('followupGoal') && row.followupGoal !== null) {
    const proposal = object(row.followupGoal, 'playerEventSequence,playerExcerpt,evidenceExcerpt,goal,thread')
    if (!Number.isSafeInteger(proposal.playerEventSequence) || proposal.playerEventSequence === 0) fail('新目标来源无效')
    text(proposal.playerExcerpt, 1200); text(proposal.evidenceExcerpt, 2000)
    const goal = object(proposal.goal, 'goalKey,desire,concern,boundary,evidenceFactKeys')
    key(goal.goalKey); text(goal.desire, 1200); text(goal.concern, 1200); text(goal.boundary, 1200); keys(goal.evidenceFactKeys, 20)
    const thread = object(proposal.thread, 'threadKey,title,question,evidenceFactKeys,closureSignals')
    key(thread.threadKey); text(thread.title, 1000); text(thread.question, 1200); keys(thread.evidenceFactKeys, 20)
    const signals = list(thread.closureSignals, 8)
    if (!signals.length) fail('新问题缺少收束条件')
    signals.forEach(value => text(value, 1000))
  }
  if (optional.includes('threadFollowupGoal') && row.threadFollowupGoal !== null) {
    const pause = Object.prototype.hasOwnProperty.call(row.threadFollowupGoal, 'pauseRequest')
    const proposal = object(row.threadFollowupGoal, 'threadKey,evidenceExcerpt,goal' + (pause ? ',pauseRequest' : ''))
    if (pause) validateChatPlayerRequestEvidenceV1(proposal.pauseRequest)
    key(proposal.threadKey); text(proposal.evidenceExcerpt, 2000)
    const goal = object(proposal.goal, 'goalKey,desire,concern,boundary,evidenceFactKeys')
    key(goal.goalKey); text(goal.desire, 1200); text(goal.concern, 1200); text(goal.boundary, 1200); keys(goal.evidenceFactKeys, 20)
  }
  if (optional.includes('turnCompletion') && row.turnCompletion !== null) parseChatTurnCompletionV1(row.turnCompletion)
  if (optional.includes('sceneTransition') && row.sceneTransition !== null) validateChatSceneTransitionV1(row.sceneTransition)
  if (optional.includes('promiseRequest') && row.promiseRequest !== null) validateChatPlayerRequestEvidenceV1(row.promiseRequest)
  if (optional.includes('resumeGoal') && row.resumeGoal !== null) validateChatPlayerRequestEvidenceV1(row.resumeGoal)
  if (optional.includes('pauseGoal') && row.pauseGoal !== null) {
    const p = object(row.pauseGoal, 'threadKey,playerEventSequence,playerExcerpt,evidenceExcerpt')
    key(p.threadKey); text(p.evidenceExcerpt, 2000)
    validateChatPlayerRequestEvidenceV1({playerEventSequence: p.playerEventSequence, playerExcerpt: p.playerExcerpt})
  }
  return structuredClone(value) as ChatNarrativeActionV1
}

function narrative(state: CharacterInteractionRuntimeState): ChatNarrativeStateV1 {
  if (!state.chatNarrative || !state.activeScene || state.activeScene.sceneKey !== state.chatNarrative.situation.sceneKey) fail('当前场景没有已衔接的叙事情境')
  return state.chatNarrative
}
function advance(state: ChatNarrativeStateV1, sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence <= state.lastEventSequence) fail('行动事件序号无效')
  state.revision += 1
  state.lastEventSequence = sequence
}

/** Player input or scene end cancels the unexecuted portion, without undoing committed facts. */
export function interruptChatNarrativeTriggerV1(state: CharacterInteractionRuntimeState, sequence: number, preserveCompletedObservation = false): void {
  const story = state.chatNarrative
  const trigger = story?.triggers.slice(-1)[0]
  if (story && (story.pendingEdit || story.pendingSituation || trigger && ['ready', 'waiting-player'].includes(trigger.status))) {
    if (!preserveCompletedObservation || story.pendingSituation?.purpose !== 'observation-result') delete story.pendingSituation
    delete story.pendingEdit
    if (trigger && ['ready', 'waiting-player'].includes(trigger.status)) trigger.status = 'cancelled'
    advance(story, sequence)
  }
}

export function requestChatNarrativeTriggerV1(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; kind: unknown; sourceEventSequence: unknown; seed: unknown; direction?: unknown
}): CharacterInteractionRuntimeState {
  const state = structuredClone(stateValue)
  const story = narrative(state)
  if (story.pendingEdit) fail('请先完成或取消待处理改写')
  choice(input.kind, CHAT_NARRATIVE_TRIGGERS_V1)
  const kind = input.kind as ChatNarrativeTriggerV1
  const direction = input.direction === undefined ? undefined : parseChatTurnDirectionV1(input.direction, state.activeScene!.activeParticipantKeys, story.permissions.maxActionsPerTrigger)
  if (!story.permissions.triggers.includes(kind)) fail('该主动触发未经作品授权')
  if (!Number.isSafeInteger(input.sourceEventSequence) || Number(input.sourceEventSequence) >= input.sequence) fail('触发来源事件无效')
  const source = Number(input.sourceEventSequence)
  let eligibleAudience = state.activeScene!.activeParticipantKeys
  if (kind === 'scene-start' && source !== state.activeScene!.startedAtSequence) fail('开场触发必须指向当前真实开场')
  if (kind === 'scene-start' && state.messages.some(m => m.eventSequence > source)) fail('已有互动后不能重新生成开场')
  if (kind === 'player-response') {
    const message = state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0]
    if (!message || message.eventSequence !== source || source < state.activeScene!.startedAtSequence) fail('回应触发必须指向当前场景最新玩家消息')
    if (!isChatMessageRetrievableV1(state, message)) fail('这条玩家消息已排除上下文，请先恢复或发送新消息')
    eligibleAudience = eligibleAudience.filter(key => message.audienceKeys == null || message.audienceKeys.includes(key))
    if (direction && message.audienceKeys != null && !message.audienceKeys.includes(direction.actorKey)) fail('指定角色听不到这条玩家消息')
    if (direction?.scheduling && message.audienceKeys != null && direction.scheduling.participantKeys.some(key => !message.audienceKeys!.includes(key))) fail('调度范围包含听不到玩家消息的角色')
    if (direction?.audienceParticipantKeys && message.audienceKeys != null && direction.audienceParticipantKeys.some(key => !message.audienceKeys!.includes(key))) fail('本轮对话范围不能扩大原玩家消息的听众')
    if (direction?.conversationMode === 'present' && (message.playerConversation === 'private'
      || message.playerConversation !== 'present' && message.audienceKeys != null && state.profiles.some(p => !message.audienceKeys!.includes(p.participantKey)))) fail('私聊消息不能作为公开情境请求处理')
  }
  if (direction?.conversationMode === 'present' && eligibleAudience.some(key => !direction.audienceParticipantKeys!.includes(key))) fail('公开对话必须包含当前可听见该对话的全部在场角色')
  if (['continue', 'return', 'player-seed'].includes(kind) && source !== input.sequence - 1) fail('玩家操作必须基于当前事件头')
  if (['scene-start', 'player-response'].includes(kind) && story.triggers.some(t => t.kind === kind && t.sourceEventSequence === source)) fail('该开场或玩家消息已经触发过演绎')
  if (story.triggers.length >= 5000) fail('当前会话触发记录已达上限，请保存并停止演绎')
  if (kind === 'player-seed') {text(input.seed); delete story.pendingSituation}
  else if (input.seed !== null) fail('只有明确的情境请求可以携带种子')
  if (state.remainingDirectorBudget < 1) fail('当前场景行动预算不足')
  const previous = story.triggers.slice(-1)[0]
  if (previous && ['ready', 'waiting-player'].includes(previous.status)) previous.status = 'cancelled'
  story.triggers.push({kind, requestedSequence: input.sequence, sourceEventSequence: source, seed: input.seed as string | null, status: 'ready', actionSequences: [], ...(direction ? {direction} : {})})
  advance(story, input.sequence)
  return state
}

/** One event applies the expression and all consequences, or none of them. */
function applyActionBase(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: unknown; actorKey: unknown; messageId: unknown; action: unknown; factEvidenceVersion?: unknown; resolutionEvidenceVersion?: unknown
}): CharacterInteractionRuntimeState {
  const state = structuredClone(stateValue)
  const story = narrative(state)
  key(input.actorKey); text(input.messageId, 200)
  const actorKey = input.actorKey
  if (!state.activeScene!.activeParticipantKeys.includes(actorKey)) fail('行动角色不在当前场景')
  const trigger = story.triggers.slice(-1)[0]
  if (!trigger || trigger.requestedSequence !== input.triggerSequence || trigger.status !== 'ready') fail('行动触发已取消、已完成或正在等待玩家')
  assertChatTurnActorV1(state, trigger, actorKey)
  assertChatResponseRetrievableV1(state)
  // A seed must first pass the separate situation-construction candidate path.
  if (!isChatSituationPreparedV1(state, actorKey)) fail('玩家情境请求尚未完成情境构建')
  if (trigger.kind === 'player-response') {
    const message = state.messages.find(m => m.eventSequence === trigger.sourceEventSequence)
    if (!message || message.audienceKeys != null && !message.audienceKeys.includes(actorKey)) fail('角色看不到触发的玩家消息')
  }
  if (trigger.actionSequences.length >= chatTurnActionLimitV1(story.permissions, trigger) || state.remainingDirectorBudget < 1) fail('行动预算不足')
  const action = parseChatNarrativeActionV1(input.action)
  assertChatTurnCompletionV1(state, actorKey, action)
  if (story.pendingEdit) {
    if (action.threadFollowupGoal != null) fail('待处理改写不能建立既有事项接续目标')
    const edit = story.pendingEdit
    const matchesText = edit.mode === 'continue' ? action.text.startsWith(edit.text) && !!action.text.slice(edit.text.length).trim() : edit.text === action.text
    if (edit.role !== 'character' || edit.actorKey !== actorKey || !matchesText
      || [...(edit.audienceKeys ?? [])].sort().join('\u0000') !== [...action.audienceKeys].sort().join('\u0000')) fail('行动必须逐字采用所选角色的待处理改写；续写只能在完整原文之后增加内容')
  }
  delete story.pendingEdit
  if (action.text.length > story.permissions.maxActionCharacters) fail('行动表达超出授权长度')
  const audiences = [state.playerKey, ...state.activeScene!.activeParticipantKeys]
  const conversation = chatTurnAudienceBoundaryV1(state, trigger)
  assertChatTurnAudienceV1(conversation, state.playerKey, action.audienceKeys)
  if (action.sceneTransition && chatTurnHasPrivateSceneBoundaryV1(state, conversation)) fail('私聊不能改变整个场景；请在公开对话中提出转场')
  if (!action.audienceKeys.includes(actorKey) || !action.audienceKeys.includes(state.playerKey)
    || action.audienceKeys.some(k => !audiences.includes(k))) fail('行动听众缺少玩家、行动者或引用场外人物')
  applyChatPlayerGoalResumeV1(state, {action, actorKey, trigger})
  applyChatThreadFollowupGoalV1(state, {action, actorKey, sequence: input.sequence, messageId: input.messageId, trigger})
  applyChatOwnFollowupGoalV1(state, {action, actorKey, sequence: input.sequence, trigger})
  const goal = story.situation.goals.find(g => g.goalKey === action.goalKey && g.actorKey === actorKey)
  if (action.goalKey === null) {
    if (!chatCanRespondAfterClosureV1(state, actorKey, trigger) && !chatCanFollowThreadV1(state, actorKey, trigger)) fail('无目标回应只允许在自身目标收束后承接新的玩家消息或已授权的事项接续机会')
    if (action.goalStatus !== null || action.goalUpdates?.length || action.threadUpdates.length
      || action.situationRequest != null && action.situationRequest.purpose !== 'player-followup' || action.nextPossibilities?.length) fail('收束后的普通回应不能重开目标、剧情线或创建新打算')
  } else if (!goal || !['active', 'paused'].includes(goal.status)) fail('行动缺少角色自身未完成目标')
  const fact = (id: string) => {
    const known = story.situation.facts.find(f => f.factKey === id)
    if (!known || !known.audienceKeys.includes(actorKey)) fail('行动引用角色不可知事实')
    return known
  }
  const evidence = (ids: string[]) => {
    if (!ids.length) fail('行动缺少当前事实依据')
    ids.forEach(fact)
  }
  const excerpt = (value: string) => {
    if (!action.text.includes(value)) fail('后果证据未出现在实际表达中')
  }
  const sceneTransition = requireChatSceneTransitionV1(state, actorKey, trigger, action)
  const pauseGoal = requireChatExistingGoalPauseV1(state, actorKey, trigger, action)
  const promiseRequest = requireChatPromiseRequestV1(state, actorKey, trigger, action)
  if (pauseGoal) action.evidenceFactKeys.forEach(fact)
  else if (!promiseRequest && (action.evidenceFactKeys.length || !chatConversationEvidenceV1(state, actorKey, trigger, action))) evidence(action.evidenceFactKeys)
  if (action.kind === 'attempt' && !action.waitingForPlayer) fail('行动尝试必须交还玩家决定')
  if ((action.kind !== 'complete' || action.waitingForPlayer) && (action.newFacts.length || action.goalStatus === 'fulfilled'
    || action.threadUpdates.some(t => t.status === 'resolved' || t.status === 'transformed'))) fail('意图或等待选择不能写成已完成后果')
  if (action.newFacts.length > story.permissions.maxNewFactsPerAction) fail('新增事实超出授权预算')
  if (state.messages.some(m => m.messageId === input.messageId)) fail('行动消息标识已存在')
  for (const item of action.newFacts) {
    if (!story.permissions.allowedNewFactKinds.includes(item.kind)) fail('该私域事实类型未经授权')
    if (story.situation.facts.some(f => f.factKey === item.factKey || f.text === item.text)) fail('禁止覆写或重复创建既有事实')
    evidence(item.evidenceFactKeys); excerpt(item.evidenceExcerpt)
    if (!item.evidenceExcerpt.includes(item.text)) fail('新增事实必须有实际表达的逐字证据')
    story.situation.facts.push({factKey: item.factKey, text: item.text, audienceKeys: [...action.audienceKeys], origin: 'runtime-consequence', sourceKnowledgeKey: null, sourceEventSequence: input.sequence})
  }
  recordChatFactEvidenceV1(story, input.factEvidenceVersion, action.newFacts.map(item => ({factKey: item.factKey,
    kind: item.kind, evidenceFactKeys: item.evidenceFactKeys, actorKey, goalKey: action.goalKey, source: 'action'})))
  const disclosed = new Set<string>()
  for (const item of action.disclosures) {
    const known = fact(item.factKey)
    if (disclosed.has(item.factKey) || !item.toParticipantKeys.length
      || item.toParticipantKeys.some(k => !action.audienceKeys.includes(k) || known.audienceKeys.includes(k))) fail('披露对象不在场、已经知情或重复')
    disclosed.add(item.factKey); excerpt(item.evidenceExcerpt)
    if (item.wording !== 'equivalent' && !item.evidenceExcerpt.includes(known.text)) fail('事实披露缺少逐字证据')
    known.audienceKeys.push(...item.toParticipantKeys)
  }
  const changedThreads = new Set<string>()
  for (const item of action.threadUpdates) {
    const thread = story.situation.threads.find(t => t.threadKey === item.threadKey && t.audienceKeys.includes(actorKey) && t.participantKeys.includes(actorKey))
    if (!thread || changedThreads.has(item.threadKey) || ['resolved', 'abandoned', 'transformed'].includes(thread.status)) fail('剧情线不可修改或已经收束')
    if (item.status === thread.status || item.status === 'transformed') fail('剧情线无状态变化或缺少转化后的新线索')
    if (thread.audienceKeys.some(k => !action.audienceKeys.includes(k))) fail('剧情线变化不能越过表达知情范围')
    changedThreads.add(item.threadKey); excerpt(item.evidenceExcerpt)
    thread.status = item.status; thread.updatedSequence = input.sequence
  }
  if (action.goalStatus !== null) {
    if (!goal) fail('行动没有可更新的目标')
    if (action.goalStatus === goal.status) fail('角色目标没有状态变化')
    goal.status = action.goalStatus; goal.updatedSequence = input.sequence
  }
  const changedGoals = new Set([action.goalKey])
  for (const effect of action.goalUpdates ?? []) {
    const target = story.situation.goals.find(g => g.goalKey === effect.goalKey && g.actorKey === actorKey)
    if (!target || changedGoals.has(effect.goalKey) || !['active', 'paused'].includes(target.status)) fail('附带目标不属于当前角色、重复或已经结束')
    if (target.status === effect.status) fail('附带目标没有状态变化')
    if (effect.status === 'fulfilled' && (action.kind !== 'complete' || action.waitingForPlayer)) fail('等待或未完成行动不能完成附带目标')
    evidence(effect.evidenceFactKeys); excerpt(effect.evidenceExcerpt)
    target.status = effect.status; target.updatedSequence = input.sequence
    changedGoals.add(effect.goalKey)
  }
  if (pauseGoal) {
    const {goal: held, source, pause} = pauseGoal
    held.playerPause = {threadKey: pause.threadKey, requested: {messageId: source.messageId, sequence: source.eventSequence, excerpt: pause.playerExcerpt},
      acknowledged: {messageId: input.messageId, sequence: input.sequence, excerpt: pause.evidenceExcerpt}}
    held.updatedSequence = input.sequence
  }
  applyChatCommitmentEffectsV1(state, {actorKey, messageId: input.messageId, sequence: input.sequence, action, effects: action.commitmentEffects ?? []})
  if (story.pendingSituation && (story.pendingSituation.actorKey === actorKey
    || story.pendingSituation.purpose !== 'player-followup' && (!story.situation.goals.some(g => g.goalKey === story.pendingSituation!.goalKey && g.status === 'active')
    || !story.situation.threads.some(t => t.threadKey === story.pendingSituation!.threadKey && ['open', 'blocked'].includes(t.status))))) delete story.pendingSituation
  if (action.situationRequest != null) {
    const request = action.situationRequest
    if (story.permissions.allowActorSituationExpansion !== true || action.waitingForPlayer || action.kind === 'pause') fail('当前行动或作品权限不允许角色扩展情境')
    evidence(request.evidenceFactKeys); excerpt(request.evidenceExcerpt)
    assertChatInquirySettlementActionV1(state, action, actorKey, input.sequence)
    if (request.purpose === 'player-followup') {
      const source = state.messages.find(m => m.role === 'player' && m.eventSequence === request.playerEventSequence)
      if (story.permissions.allowPlayerFollowupSituations !== true || action.goalKey !== null || !chatCanRespondAfterClosureV1(state, actorKey, trigger)
        || trigger.sourceEventSequence !== request.playerEventSequence || !source || !isChatMessageRetrievableV1(state, source)
        || source.audienceKeys != null && !source.audienceKeys.includes(actorKey) || !source.text.includes(request.playerExcerpt)) fail('新事项须引用本轮角色可见的真实玩家请求及作品授权')
    } else {
      if (!goal || goal.status !== 'active') fail('当前行动或作品权限不允许角色扩展情境')
      if (request.purpose === 'observation-result' && (action.kind !== 'complete'
        || !action.newFacts.some(f => f.kind === 'observation' && request.evidenceFactKeys.includes(f.factKey) && request.evidenceExcerpt.includes(f.text)))) fail('观察结果请求必须绑定本次实际完成并登记的观察事实')
      const thread = story.situation.threads.find(t => t.threadKey === request.threadKey)
      if (!thread || !thread.participantKeys.includes(actorKey) || !thread.audienceKeys.includes(actorKey)
        || !['open', 'blocked'].includes(thread.status)) fail('推进方向缺少角色自己的未完成剧情线')
    }
    if (story.pendingSituation) fail('已有其他角色的待推进事项，不能覆盖')
    story.pendingSituation = {...request, actorKey, goalKey: goal?.goalKey ?? null, sourceEventSequence: input.sequence}
  }
  if (sceneTransition) applyChatSceneTransitionV1(state, {actorKey, messageId: input.messageId, sequence: input.sequence, transition: sceneTransition})
  trigger.actionSequences.push(input.sequence)
  trigger.status = action.waitingForPlayer ? 'waiting-player'
    : action.turnCompletion != null || action.goalKey === null && action.situationRequest?.purpose !== 'player-followup' || action.kind === 'pause' || trigger.actionSequences.length >= chatTurnActionLimitV1(story.permissions, trigger) ? 'complete' : 'ready'
  if (trigger.status === 'complete' && trigger.direction?.settleSituationVersion === 1 && action.situationRequest) {
    trigger.status = 'ready'
    if (!chatHasPendingTurnSettlementV1(state)) trigger.status = 'complete'
  }
  advance(story, input.sequence)
  state.chatNarrative = parseChatNarrativeStateV1(story, {
    participantKeys: state.profiles.map(p => p.participantKey), characterKeys: state.profiles.map(p => p.characterKey), sceneKeys: state.sceneTemplates.map(s => s.sceneKey),
  })
  state.remainingDirectorBudget -= 1
  state.messages.push({messageId: input.messageId, eventSequence: input.sequence, role: 'character', speakerKey: actorKey,
    audienceKeys: action.audienceKeys, text: action.text, replyToSequence: trigger.kind === 'player-response' ? trigger.sourceEventSequence : null, supersededBySequence: null})
  recordChatResolutionEvidenceV1(state, {version: input.resolutionEvidenceVersion, action, actorKey, messageId: input.messageId})
  return state
}

/** Preserve the historical unreviewed event format without granting it new writes. */
export function applyChatNarrativeActionV1(state: CharacterInteractionRuntimeState, input: Parameters<typeof applyActionBase>[1]) {
  if (input.action && typeof input.action === 'object' && 'turnCompletion' in input.action) fail('本轮结束必须通过独立审查，旧行动事件不可采用')
  if (input.factEvidenceVersion !== undefined || input.resolutionEvidenceVersion !== undefined) fail('旧行动事件不能写入事实来源索引或收束依据')
  if (state.chatNarrative?.pendingEdit) fail('历史改写必须通过行动及后果审查')
  const action = parseChatNarrativeActionV1(input.action)
  if (!action.evidenceFactKeys.length) fail('无事实引用的对话回应必须通过独立审查，旧行动事件不可采用')
  if (action.commitmentEffects !== undefined) fail('承诺变化必须通过独立审查，旧行动事件不可采用')
  if (action.disclosures.some(d => d.wording !== undefined)) fail('自然转述必须经过逐条等义审查，旧行动事件不可采用')
  if (action.goalKey === null) fail('收束后的回应必须通过行动及后果审查')
  if (action.sceneTransition !== undefined || action.relationshipUpdates !== undefined || action.nextPossibilities !== undefined || action.beliefUpdates !== undefined || action.goalUpdates !== undefined || action.situationRequest !== undefined || action.followupGoal !== undefined || action.threadFollowupGoal !== undefined || action.resumeGoal !== undefined || action.pauseGoal !== undefined || action.promiseRequest !== undefined) fail('旧行动事件不能写入关系、打算或附带目标后果')
  return applyActionBase(state, input)
}

export function previewChatNarrativeActionV1(state: CharacterInteractionRuntimeState, input: Parameters<typeof applyActionBase>[1]) {
  const result = applyActionBase(state, input)
  applyChatRelationshipEffectsV1(result, {sequence: input.sequence, actorKey: input.actorKey as string, action: parseChatNarrativeActionV1(input.action)})
  applyChatActorReflectionV1(result, {sequence: input.sequence, actorKey: input.actorKey as string, action: parseChatNarrativeActionV1(input.action)})
  return result
}


export function parseChatNarrativeActionReviewV1(value: unknown, action: ChatNarrativeActionV1): ChatNarrativeActionReviewV1 {
  const hasTurnCompletionCheck = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'turnCompletionCheck')
  const hasDisclosureChecks = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'disclosureChecks')
  const hasCommitmentChecks = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'commitmentChecks')
  const hasSceneTransitionCheck = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'sceneTransitionCheck')
  const hasMemoryChecks = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'memoryChecks')
  const row = object(value, 'reviewedActionJson,checks' + (hasTurnCompletionCheck ? ',turnCompletionCheck' : '') + (hasSceneTransitionCheck ? ',sceneTransitionCheck' : '') + (hasMemoryChecks ? ',memoryChecks' : '') + (hasDisclosureChecks ? ',disclosureChecks' : '') + (hasCommitmentChecks ? ',commitmentChecks' : ''))
  if (row.reviewedActionJson !== canonicalStringify(action)) fail('行动审查绑定了另一份候选')
  const checks = list(row.checks, CHAT_ACTION_REVIEW_CHECKS_V1.length), seen = new Set<string>()
  if (checks.length !== CHAT_ACTION_REVIEW_CHECKS_V1.length) fail('行动语义审查不完整')
  for (const value of checks) {
    const item = object(value, 'check,passed,reason')
    choice(item.check, CHAT_ACTION_REVIEW_CHECKS_V1)
    if (seen.has(String(item.check)) || typeof item.passed !== 'boolean') fail('行动审查项目重复或无效')
    text(item.reason, 2000); seen.add(String(item.check))
  }
  const equivalent = action.disclosures.filter(d => d.wording === 'equivalent')
  const disclosures = hasDisclosureChecks ? list(row.disclosureChecks, 12) : [], disclosed = new Set<string>()
  if (disclosures.length !== equivalent.length) fail('自然转述逐条等义审查不完整')
  for (const value of disclosures) {
    const item = object(value, 'factKey,passed,reason')
    key(item.factKey); text(item.reason, 2000)
    if (!equivalent.some(d => d.factKey === item.factKey) || disclosed.has(item.factKey) || typeof item.passed !== 'boolean') fail('自然转述审查事实无效或重复')
    disclosed.add(item.factKey)
  }
  if (hasCommitmentChecks && row.commitmentChecks == null) fail('承诺逐条审查无效')
  validateChatCommitmentChecksV1(row.commitmentChecks, action)
  if (hasMemoryChecks) parseChatMemoryReconciliationChecksV1(row.memoryChecks)
  validateChatSceneTransitionCheckV1(row.sceneTransitionCheck, action)
  validateChatTurnCompletionCheckV1(row.turnCompletionCheck, action)
  return structuredClone(value) as ChatNarrativeActionReviewV1
}

export function chatNarrativeActionReviewPassedV1(review: ChatNarrativeActionReviewV1): boolean {
  return (review.turnCompletionCheck?.passed ?? true) && (review.sceneTransitionCheck?.passed ?? true) && review.checks.every(check => check.passed) && (review.disclosureChecks ?? []).every(check => check.passed)
    && (review.commitmentChecks ?? []).every(check => check.passed)
    && (review.memoryChecks ?? []).every(check => check.passed)
}

/** New writes require reviewed expression and consequences. The original
 * reducer remains available only for exact replay of historical events. */
export function applyReviewedChatNarrativeActionV1(state: CharacterInteractionRuntimeState, input: Parameters<typeof applyChatNarrativeActionV1>[1] & {review: unknown; actionChoiceVersion?: unknown}) {
  const allowance = chatReviewedActionAllowanceV1(input.actionChoiceVersion)
  if (state.remainingDirectorBudget < allowance) fail(allowance === 3 ? '角色行动选择、表达与审查预算不足' : '角色行动与审查预算不足')
  const result = previewChatNarrativeActionV1(state, input)
  const review = parseChatNarrativeActionReviewV1(input.review, parseChatNarrativeActionV1(input.action))
  if (!chatNarrativeActionReviewPassedV1(review)) fail('行动语义审查未通过，表达与后果均未提交')
  applyChatMemoryReconciliationsV1(state, result, {actorKey: input.actorKey as string, messageId: input.messageId as string, sequence: input.sequence, review})
  result.remainingDirectorBudget -= allowance - 1
  return result
}
