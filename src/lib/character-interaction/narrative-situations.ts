import {parseChatFactDiscoveriesV1, applyChatFactDiscoveriesV1} from './narrative-discovery'
import {parseChatInquiryResultV1, parseChatInquiryReviewV1, chatInquiryReviewPassedV1, applyChatInquiryResultV1} from './narrative-inquiry'
import {parseChatInquiryEvidenceVersionV1} from './inquiry-evidence'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {recordChatFactEvidenceV1, parseChatFactEvidenceVersionV1} from './fact-evidence'
import {canonicalStringify} from '../agent/run/hash'
import type {CharacterInteractionRuntimeState} from '../types'
import {CHAT_SITUATION_REVIEW_CHECKS_V1} from '../types/chat-narrative'
import type {ChatSituationDraftV1, ChatSituationReviewV1} from '../types/chat-narrative'
import {chatTurnActionLimitV1, parseChatNarrativeStateV1} from './narrative-contract'
import {chatSituationConstructionBlockedV1, chatSituationConstructionRequestV1} from './narrative-progression'
import {chatRelationshipEvidenceV1} from './narrative-relationships'
import {assertChatTurnAudienceV1, chatTurnAudienceBoundaryV1, chatTurnAudienceGuidanceV1, chatTurnHasPrivateSceneBoundaryV1} from './narrative-audience'

function fail(message: string): never {throw new Error(`[chat-situation] ${message}`)}
function object(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('情境字段不在允许闭集')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 2000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('情境文本无效或超出预算')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('情境标识无效')
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('情境数组超出上限')
  return value
}
function keys(value: unknown, max = 200): string[] {
  const array = list(value, max); array.forEach(key)
  if (new Set(array).size !== array.length) fail('情境引用重复')
  return array as string[]
}

export function parseChatSituationDraftV1(value: unknown): ChatSituationDraftV1 {
  const hasDiscoveries = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discoveries')
  const hasInquiry = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'inquiryResult')
  const draft = object(value, 'kind,title,location,timeLabel,newFacts,newGoals,newThreads,possibilities' + (hasDiscoveries ? ',discoveries' : '') + (hasInquiry ? ',inquiryResult' : ''))
  if (hasDiscoveries) parseChatFactDiscoveriesV1(draft.discoveries)
  if (hasInquiry) parseChatInquiryResultV1(draft.inquiryResult)
  if (draft.kind !== 'chat-situation') fail('情境候选类型无效')
  text(draft.title, 1000); text(draft.location, 1000); text(draft.timeLabel, 1000)
  for (const value of list(draft.newFacts, 5)) {
    const fact = object(value, 'factKey,kind,text,audienceKeys,evidenceFactKeys,seedExcerpt')
    key(fact.factKey); text(fact.text); text(fact.seedExcerpt)
    if (!['observation', 'object', 'place', 'temporary-character'].includes(String(fact.kind))) fail('情境事实类型无效')
    keys(fact.audienceKeys, 33); keys(fact.evidenceFactKeys)
  }
  for (const value of list(draft.newGoals, 8)) {
    const goal = object(value, 'goalKey,actorKey,desire,concern,boundary,evidenceFactKeys')
    key(goal.goalKey); key(goal.actorKey); text(goal.desire); text(goal.concern); text(goal.boundary); keys(goal.evidenceFactKeys)
  }
  for (const value of list(draft.newThreads, 3)) {
    const thread = object(value, 'threadKey,title,question,audienceKeys,participantKeys,evidenceFactKeys,closureSignals')
    key(thread.threadKey); text(thread.title, 1000); text(thread.question)
    keys(thread.audienceKeys, 33); keys(thread.participantKeys, 32); keys(thread.evidenceFactKeys)
    const signals = list(thread.closureSignals, 8)
    if (!signals.length) fail('新剧情线没有收束信号')
    signals.forEach(signal => text(signal, 1000))
  }
  for (const value of list(draft.possibilities, 32)) {
    const possibility = object(value, 'actorKey,text,evidenceFactKeys')
    key(possibility.actorKey); text(possibility.text); keys(possibility.evidenceFactKeys)
  }
  return structuredClone(value) as ChatSituationDraftV1
}

/** Review findings are evidence, not a claim of infallible semantic validation.
 * All five questions must be answered for this exact proposal before adoption. */
export function parseChatSituationReviewV1(value: unknown, draft: ChatSituationDraftV1): ChatSituationReviewV1 {
  const review = object(value, 'reviewedProposalJson,checks' + (draft.inquiryResult ? ',inquiryReview' : ''))
  if (draft.inquiryResult) parseChatInquiryReviewV1(review.inquiryReview, draft.inquiryResult)
  if (review.reviewedProposalJson !== canonicalStringify(draft)) fail('情境审查绑定了另一份候选')
  const checks = list(review.checks, CHAT_SITUATION_REVIEW_CHECKS_V1.length)
  if (checks.length !== CHAT_SITUATION_REVIEW_CHECKS_V1.length) fail('情境语义审查不完整')
  const seen = new Set<string>()
  for (const item of checks) {
    const check = object(item, 'check,passed,reason')
    if (!CHAT_SITUATION_REVIEW_CHECKS_V1.includes(check.check as typeof CHAT_SITUATION_REVIEW_CHECKS_V1[number]) || seen.has(String(check.check))) fail('情境审查项目无效或重复')
    if (typeof check.passed !== 'boolean') fail('情境审查结果无效')
    text(check.reason); seen.add(String(check.check))
  }
  return structuredClone(value) as ChatSituationReviewV1
}

export function isChatSituationPreparedV1(state: CharacterInteractionRuntimeState, actorKey?: string): boolean {
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!story || !trigger) return false
  if (trigger.kind === 'player-seed') return ['player-request', 'continued-thread'].includes(story.situation.seed.origin)
    && story.situation.seed.sourceEventSequence === trigger.requestedSequence && chatSituationConstructionRequestV1(state, actorKey) === null
  return chatSituationConstructionRequestV1(state, actorKey) === null
}

/** Preserve every established fact, goal and unresolved thread. The constructor
 * may add authorized local background; it cannot execute the player's choices. */
export function applyChatSituationV1(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: unknown; draft: unknown; review: unknown; factEvidenceVersion?: unknown; inquiryEvidenceVersion?: unknown
}): CharacterInteractionRuntimeState {
  const draft = parseChatSituationDraftV1(input.draft), review = parseChatSituationReviewV1(input.review, draft)
  if (review.checks.some(check => !check.passed) || review.inquiryReview && !chatInquiryReviewPassedV1(review.inquiryReview)) fail('情境语义审查未通过，原有局面保留')
  return previewChatSituationV1(stateValue, {...input, draft})
}

/** Deterministic dry-run only. Callers cannot persist this projection in place
 * of the reviewed situation command. */
export function previewChatSituationV1(stateValue: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: unknown; draft: unknown; factEvidenceVersion?: unknown; inquiryEvidenceVersion?: unknown
}): CharacterInteractionRuntimeState {
  const state = structuredClone(stateValue), story = state.chatNarrative, scene = state.activeScene
  parseChatFactEvidenceVersionV1(input.factEvidenceVersion)
  parseChatInquiryEvidenceVersionV1(input.inquiryEvidenceVersion)
  if (!story || !scene || story.situation.sceneKey !== scene.sceneKey) fail('缺少已衔接的当前情境')
  const trigger = story.triggers[story.triggers.length - 1]
  if (chatSituationConstructionBlockedV1(state)) fail('该请求已经构建情境')
  const request = chatSituationConstructionRequestV1(state)
  if (!trigger || trigger.status !== 'ready' || trigger.requestedSequence !== input.triggerSequence || !request) fail('情境构建必须来自尚未执行的明确玩家请求或已审查角色方向')
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 || input.sequence <= story.lastEventSequence) fail('情境提交事件无效')
  if (state.remainingDirectorBudget < 2) fail('情境构建与审查预算不足')
  const draft = parseChatSituationDraftV1(input.draft)
  const boundary = chatTurnAudienceBoundaryV1(state, trigger)
  const conversation = boundary?.audienceParticipantKeys
  if (conversation) {
    assertChatTurnAudienceV1(boundary, state.playerKey, [
      ...draft.newFacts.flatMap(f => f.audienceKeys), ...draft.newGoals.map(g => g.actorKey),
      ...draft.newThreads.flatMap(t => [...t.audienceKeys, ...t.participantKeys]), ...draft.possibilities.map(p => p.actorKey),
      ...(draft.discoveries ?? []).map(d => d.actorKey), ...(draft.inquiryResult?.audienceKeys ?? []),
    ])
    if (chatTurnHasPrivateSceneBoundaryV1(state, boundary) && (draft.title !== story.situation.title
      || draft.location !== story.situation.location || draft.timeLabel !== story.situation.timeLabel)) fail('私聊不能改变所有在场人物共用的场景名称、地点或时间')
  }
  if (request.origin === 'player-followup' && (!draft.newGoals.some(g => g.actorKey === request.actorKey)
    || !draft.newThreads.some(t => t.participantKeys.includes(request.actorKey)))) fail('新事项须给出有依据的自身新目标和可收束问题，不能只生成背景后继续空转')
  if (request.origin === 'player-followup' && (draft.newFacts.some(f => f.audienceKeys.some(k => !request.audienceKeys.includes(k)))
    || draft.newThreads.some(t => t.audienceKeys.some(k => !request.audienceKeys.includes(k)) || t.participantKeys.some(k => k !== request.actorKey)))) fail('新事项不能向原对话之外传播请求或替其他角色承接')
  const observationResult = request.origin === 'continued-thread' && story.pendingSituation?.purpose === 'observation-result'
  if (story.pendingSituation?.purpose === 'inquiry-result' && !draft.inquiryResult) fail('待询问结算只能提供同一实际问题的有限答复')
  if (observationResult && (draft.title !== story.situation.title || draft.newGoals.length || draft.newThreads.length || draft.possibilities.length
    || draft.newFacts.some(f => f.kind !== 'observation'))) fail('已完成观察的结果只能补充有限观察或授权发现，不能建立新目标、剧情线、计划或物件')
  if (draft.newFacts.length > story.permissions.maxNewFactsPerAction) fail('新增情境事实超出授权数量')
  if (!draft.newFacts.length && !draft.newGoals.length && !draft.newThreads.length && !draft.possibilities.length && !draft.discoveries?.length && !draft.inquiryResult) fail('情境候选没有可执行的新方向')
  if (draft.inquiryResult) {
    if (request.origin !== 'continued-thread' || draft.title !== story.situation.title || draft.location !== story.situation.location || draft.timeLabel !== story.situation.timeLabel
      || draft.newFacts.length || draft.newGoals.length || draft.newThreads.length || draft.possibilities.length || draft.discoveries?.length) fail('实际答复只能记录本次说法及授权事实，不能同时预执行新的剧情或改变时地')
    applyChatInquiryResultV1(state, draft.inquiryResult, input.sequence, input.factEvidenceVersion, input.inquiryEvidenceVersion)
  }
  // Discoveries preserve canonical fact identity. New conditions cannot be
  // invented here; author-selected rules and the exact investigation are checked.
  if (draft.discoveries?.length && (request.actorKey == null || draft.location !== story.situation.location || draft.timeLabel !== story.situation.timeLabel)) fail('发现必须绑定角色实际调查且保持原时地')
  applyChatFactDiscoveriesV1(state, draft.discoveries ?? [], input.sequence)
  const viewers = [state.playerKey, ...scene.activeParticipantKeys]
  const initialFacts = new Map(story.situation.facts.map(fact => [fact.factKey, fact]))
  for (const item of draft.newFacts) {
    if (observationResult && !story.situation.facts.some(f => f.origin === 'runtime-consequence' && f.sourceEventSequence === story.pendingSituation!.sourceEventSequence
      && item.evidenceFactKeys.includes(f.factKey) && story.pendingSituation!.evidenceFactKeys.includes(f.factKey))) fail('观察结果必须引用原已完成观察的事实')
    if (!story.permissions.allowedNewFactKinds.includes(item.kind)) fail('新增情境事实类型未经作品授权')
    if (story.situation.facts.some(f => f.factKey === item.factKey || f.text === item.text)) fail('不得重写或重复创建既有事实')
    if (item.audienceKeys.some(viewer => !viewers.includes(viewer))) fail('新增事实引用场外人物')
    if (!request.text.includes(item.seedExcerpt)) fail('新增情境事实缺少真实请求依据')
    if (request.actorKey && (!item.audienceKeys.includes(request.actorKey) || !item.evidenceFactKeys.length)) fail('角色推进只能补充有可知依据的自身局面')
    for (const factKey of item.evidenceFactKeys) {
      const fact = initialFacts.get(factKey)
      if (!fact || item.audienceKeys.some(viewer => !fact.audienceKeys.includes(viewer))) fail('新增事实不能传播不可知的依据')
    }
    story.situation.facts.push({factKey: item.factKey, text: item.text, audienceKeys: item.audienceKeys,
      origin: 'runtime-situation', sourceKnowledgeKey: null, sourceEventSequence: input.sequence})
  }
  recordChatFactEvidenceV1(story, input.factEvidenceVersion, draft.newFacts.map(item => ({factKey: item.factKey,
    kind: item.kind, evidenceFactKeys: item.evidenceFactKeys, actorKey: request.actorKey ?? null,
    goalKey: story.pendingSituation?.goalKey ?? null, source: 'situation'})))
  if (request.actorKey && (draft.location !== story.situation.location || draft.timeLabel !== story.situation.timeLabel)) fail('角色推进不能擅自改变玩家所处时间地点')
  if (draft.location !== story.situation.location && (!story.permissions.allowedNewFactKinds.includes('place')
    || !request.text.includes(draft.location) || !draft.newFacts.some(f => f.kind === 'place' && f.text.includes(draft.location) && viewers.every(v => f.audienceKeys.includes(v))))) fail('地点变化缺少明确请求及授权的公开地点事实')
  if (draft.timeLabel !== story.situation.timeLabel && (!request.text.includes(draft.timeLabel)
    || !draft.newFacts.some(f => f.kind === 'observation' && f.text.includes(draft.timeLabel) && viewers.every(v => f.audienceKeys.includes(v))))) fail('时间变化缺少明确请求及公开观察')
  for (const goal of draft.newGoals) {
    if (request.actorKey && (goal.actorKey !== request.actorKey || !goal.evidenceFactKeys.length)) fail('角色推进不能替其他角色设定目标')
    if (!scene.activeParticipantKeys.includes(goal.actorKey)) fail('不能替玩家或场外角色设定目标')
    if (story.situation.goals.some(g => g.goalKey === goal.goalKey || g.actorKey === goal.actorKey && g.desire === goal.desire)) fail('不得重复或覆写旧目标')
    story.situation.goals.push({...goal, status: 'active', updatedSequence: input.sequence})
  }
  for (const thread of draft.newThreads) {
    if (request.actorKey && (!thread.participantKeys.includes(request.actorKey) || !thread.audienceKeys.includes(request.actorKey) || !thread.evidenceFactKeys.length)) fail('角色推进的新问题须关联自身可知事项')
    if (story.situation.threads.some(t => t.threadKey === thread.threadKey || t.question === thread.question)) fail('不得重复或覆写旧剧情线')
    if (thread.participantKeys.some(actor => !scene.activeParticipantKeys.includes(actor)) || thread.audienceKeys.some(viewer => !viewers.includes(viewer))) fail('新剧情线引用了场外人物')
    story.situation.threads.push({...thread, status: 'open', updatedSequence: input.sequence})
  }
  if (draft.possibilities.some(p => !scene.activeParticipantKeys.includes(p.actorKey))) fail('不能替玩家或场外角色预定行动')
  if (request.actorKey && draft.possibilities.some(p => p.actorKey !== request.actorKey || !p.evidenceFactKeys.length)) fail('角色推进不能替其他角色规划行动')
  if (!observationResult && !draft.inquiryResult) story.situation.possibilities = request.actorKey
    ? [...story.situation.possibilities.filter(p => p.actorKey !== request.actorKey), ...draft.possibilities]
    : conversation ? [...story.situation.possibilities.filter(p => !conversation.includes(p.actorKey)), ...draft.possibilities] : draft.possibilities
  story.situation.title = draft.title
  story.situation.location = draft.location; story.situation.timeLabel = draft.timeLabel
  story.situation.seed = {text: request.text, origin: request.origin, sourceEventSequence: trigger.requestedSequence, sourceThreadKey: request.sourceThreadKey}
  delete story.pendingSituation
  if (trigger.direction?.settleSituationVersion === 1 && trigger.actionSequences.length >= chatTurnActionLimitV1(story.permissions, trigger)) trigger.status = 'complete'
  story.revision++; story.lastEventSequence = input.sequence
  state.chatNarrative = parseChatNarrativeStateV1(story, {participantKeys: state.profiles.map(p => p.participantKey), characterKeys: state.profiles.map(p => p.characterKey), sceneKeys: state.sceneTemplates.map(s => s.sceneKey)})
  scene.title = draft.title; scene.location = draft.location; scene.timeLabel = draft.timeLabel
  state.remainingDirectorBudget -= 2
  return state
}

/** Coordinator-only material from this immutable product instance. Never use
 * this source for a role's expression; the role reader remains independently filtered. */
export function chatSituationCoordinatorViewV1(state: CharacterInteractionRuntimeState) {
  if (!state.chatNarrative || !state.activeScene) fail('当前实例没有叙事情境')
  return structuredClone({
    profiles: state.profiles, knowledge: state.knowledge, persona: state.chatNarrative.persona,
    ...chatTurnAudienceGuidanceV1(state.chatNarrative.triggers[state.chatNarrative.triggers.length - 1]?.direction),
    ...(state.chatNarrative.discoveryHistory ? {discoveryHistory: state.chatNarrative.discoveryHistory} : {}),
    ...(state.chatNarrative.inquiryHistory ? {inquiryHistory: state.chatNarrative.inquiryHistory} : {}),
    relationships: state.relationships,
    relationshipEvidence: state.profiles.flatMap(p => chatRelationshipEvidenceV1(state, p.participantKey)),
    permissions: state.chatNarrative.permissions, situation: state.chatNarrative.situation,
    activeParticipantKeys: state.activeScene.activeParticipantKeys, remainingBudget: state.remainingDirectorBudget,
    trigger: state.chatNarrative.triggers[state.chatNarrative.triggers.length - 1] ?? null,
    ...(state.chatNarrative.pendingSituation ? {pendingSituation: state.chatNarrative.pendingSituation, constructionRequest: chatSituationConstructionRequestV1(state)} : {}),
    ...(state.chatNarrative.pendingEdit ? {pendingEdit: state.chatNarrative.pendingEdit} : {}),
    messages: state.messages.filter(m => m.eventSequence > state.activeScene!.startedAtSequence && m.supersededBySequence == null && isChatMessageRetrievableV1(state, m)),
  })
}
