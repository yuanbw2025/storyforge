import {CHAT_HISTORY_CAPACITY_V1} from './history-capacity'
import {requireChatPromiseRequestV1} from './narrative-promise-request'
import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatActorGoalV1, ChatCommitmentEffectV1, ChatGoalCommitmentV1, ChatNarrativeActionV1} from '../types/chat-narrative'
import {interactionMessageVisibleTo} from './message-visibility'

export const CHAT_GOAL_COMMITMENT_LIMIT_V1 = CHAT_HISTORY_CAPACITY_V1.commitmentsPerGoal
function fail(message: string): never {throw new Error(`[chat-commitment] ${message}`)}
function object(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('承诺字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum = 1000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('承诺文本无效')
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || value === 0) fail('承诺需要真实运行事件')
}

export function parseChatCommitmentEffectsV1(value: unknown): ChatCommitmentEffectV1[] {
  if (!Array.isArray(value) || value.length > 4) fail('单次承诺变化数量无效')
  for (const item of value) {
    const kind = item?.kind
    const effect = object(item, kind === 'promise' ? 'kind,terms,evidenceExcerpt' : 'kind,commitmentKey,evidenceExcerpt')
    if (!['promise', 'fulfill', 'withdraw'].includes(String(kind))) fail('承诺变化类型无效')
    text(effect.evidenceExcerpt)
    if (kind === 'promise') {text(effect.terms); if (!String(effect.evidenceExcerpt).includes(String(effect.terms))) fail('承诺条款必须来自表达摘录')}
    else text(effect.commitmentKey, 240)
  }
  if (value.filter(item => item.kind === 'promise').length > 1) fail('一次表达只能新增一个自身承诺')
  return structuredClone(value) as ChatCommitmentEffectV1[]
}

export function validateChatGoalCommitmentsV1(value: unknown, input: {actorKey: string; viewers: string[]; goalStatus: string; updatedSequence: number; initial: boolean}): void {
  if (value === undefined) return
  if (input.initial) fail('初始背景不能伪造运行承诺')
  if (!Array.isArray(value) || !value.length || value.length > CHAT_GOAL_COMMITMENT_LIMIT_V1) fail('目标承诺历史数量无效')
  const ids = new Set<string>()
  let open = 0
  let previous: {declared: number; resolved: number | null} | null = null
  for (const valueItem of value) {
    const hasRequest = valueItem != null && typeof valueItem === 'object' && Object.prototype.hasOwnProperty.call(valueItem, 'requested')
    const item = object(valueItem, 'commitmentKey,terms,audienceKeys,declared,resolution' + (hasRequest ? ',requested' : ''))
    text(item.commitmentKey, 240); text(item.terms)
    const declared = object(item.declared, 'messageId,sequence,excerpt')
    text(declared.messageId, 200); text(declared.excerpt); sequence(declared.sequence)
    if (item.commitmentKey !== `${declared.messageId}:promise` || ids.has(item.commitmentKey)) fail('承诺身份与原表达不一致或重复')
    ids.add(item.commitmentKey)
    if (!declared.excerpt.includes(item.terms) || declared.sequence > input.updatedSequence) fail('承诺条款或事件来源不一致')
    if (hasRequest) {
      const requested = object(item.requested, 'messageId,sequence,excerpt')
      text(requested.messageId, 200); text(requested.excerpt, 1200); sequence(requested.sequence)
      if (requested.sequence >= declared.sequence || requested.messageId === declared.messageId) fail('约定请求必须早于角色声明')
    }
    if (previous && (declared.sequence <= previous.declared || previous.resolved === null || declared.sequence < previous.resolved)) fail('承诺历史必须按先处置、后改约的真实事件排列')
    if (!Array.isArray(item.audienceKeys) || new Set(item.audienceKeys).size !== item.audienceKeys.length
      || !item.audienceKeys.includes(input.actorKey) || !item.audienceKeys.includes('player')
      || item.audienceKeys.some(v => typeof v !== 'string' || !input.viewers.includes(v))) fail('承诺知情范围无效')
    if (item.resolution === null) open++
    else {
      const resolved = object(item.resolution, 'kind,messageId,sequence,excerpt')
      if (!['fulfilled', 'withdrawn'].includes(String(resolved.kind))) fail('承诺处置类型无效')
      text(resolved.messageId, 200); text(resolved.excerpt); sequence(resolved.sequence)
      if (resolved.sequence <= declared.sequence || resolved.sequence > input.updatedSequence || resolved.messageId === declared.messageId) fail('承诺处置必须晚于原表达且已经发生')
    }
    previous = {declared: declared.sequence, resolved: item.resolution === null ? null : Number((item.resolution as Record<string, unknown>).sequence)}
  }
  if (open > 1) fail('同一目标仍有未处理承诺，不能另起一个覆盖')
  if (open && ['fulfilled', 'abandoned'].includes(input.goalStatus)) fail('目标结束前必须明确处理尚未履行的承诺')
}

/** Stored declarations and resolutions bind to actual role messages, including
 * inherited negative sequences. Accepted memory text is never evidence here. */
export function assertChatCommitmentSourcesV1(state: CharacterInteractionRuntimeState): void {
  const seen = new Set<string>()
  for (const goal of state.chatNarrative?.situation.goals ?? []) for (const item of goal.commitments ?? []) {
    if (seen.has(item.commitmentKey)) fail('不同目标不能共用同一个承诺身份')
    seen.add(item.commitmentKey)
    if (item.requested) {
      const request = state.messages.find(m => m.messageId === item.requested!.messageId && m.eventSequence === item.requested!.sequence)
      if (!request || request.role !== 'player' || request.speakerKey !== state.playerKey || request.supersededBySequence != null
        || !request.text.includes(item.requested.excerpt) || item.audienceKeys.some(v => !interactionMessageVisibleTo(request, v))) fail('约定缺少真实可见的玩家请求依据')
    }
    for (const evidence of [item.declared, ...(item.resolution ? [item.resolution] : [])]) {
      const message = state.messages.find(m => m.messageId === evidence.messageId && m.eventSequence === evidence.sequence)
      if (!message || message.role !== 'character' || message.speakerKey !== goal.actorKey || message.supersededBySequence != null
        || !message.text.includes(evidence.excerpt) || item.audienceKeys.some(v => !interactionMessageVisibleTo(message, v))) fail('承诺缺少同一角色实际可见的消息依据')
      if (evidence === item.declared && [...(message.audienceKeys ?? ['player', ...state.profiles.map(p => p.participantKey)])].sort().join('\0') !== [...item.audienceKeys].sort().join('\0')) fail('承诺声明不能改变原消息知情范围')
    }
  }
}

/** Goal status has already been previewed. Assign only after all effects pass;
 * the action appends the source message and reviews before durable commit. */
export function applyChatCommitmentEffectsV1(state: CharacterInteractionRuntimeState, input: {
  actorKey: string; messageId: string; sequence: number; action: ChatNarrativeActionV1; effects: unknown
}): void {
  const effects = parseChatCommitmentEffectsV1(input.effects), story = state.chatNarrative
  if (!story) fail('承诺属于主动叙事实例')
  const trigger = story.triggers.slice(-1)[0]
  if (input.action.promiseRequest != null && !trigger) fail('对话约定缺少当前触发')
  const requested = input.action.promiseRequest != null ? requireChatPromiseRequestV1(state, input.actorKey, trigger!, input.action) : null
  const goals = structuredClone(story.situation.goals)
  if (effects.length) {
    if (!state.activeScene?.activeParticipantKeys.includes(input.actorKey) || !input.action.audienceKeys.includes(input.actorKey)
      || !input.action.audienceKeys.includes(state.playerKey) || input.action.audienceKeys.some(k => k !== state.playerKey && !state.activeScene!.activeParticipantKeys.includes(k))) fail('承诺表达需要在场角色与实际听众')
    sequence(input.sequence); text(input.messageId, 200)
    if (input.sequence <= 0 || input.sequence <= story.lastEventSequence
      || state.messages.some(m => m.messageId === input.messageId || m.eventSequence >= input.sequence)) fail('承诺表达事件已经使用或过期')
    if (['attempt', 'pause'].includes(input.action.kind)) fail('条件意向、尝试或暂停不能登记为已经作出的承诺变化')
  }
  const changed = new Set<string>()
  // Resolve explicitly first, then permit a replacement declaration in the same
  // expression. Both remain auditable; neither implies the player's agreement.
  for (const effect of [...effects.filter(e => e.kind !== 'promise'), ...effects.filter(e => e.kind === 'promise')]) {
    if (!input.action.text.includes(effect.evidenceExcerpt)) fail('承诺变化不在本次实际表达中')
    if (effect.kind === 'promise') {
      const goal = goals.find(g => g.goalKey === input.action.goalKey && g.actorKey === input.actorKey)
      if (!goal || !['active', 'paused'].includes(goal.status)) fail('新增承诺必须服务于自己的未完成目标')
      if (goal.commitments?.some(c => c.resolution === null)) fail('原承诺未处理，不能覆盖条款')
      if ((goal.commitments?.length ?? 0) >= CHAT_GOAL_COMMITMENT_LIMIT_V1) fail('承诺历史已达容量，停止而不删除原记录')
      goal.commitments = [...(goal.commitments ?? []), {commitmentKey: `${input.messageId}:promise`, terms: effect.terms, audienceKeys: [...input.action.audienceKeys],
        declared: {messageId: input.messageId, sequence: input.sequence, excerpt: effect.evidenceExcerpt},
        ...(requested ? {requested: {messageId: requested.messageId, sequence: requested.eventSequence, excerpt: input.action.promiseRequest!.playerExcerpt}} : {}), resolution: null}]
      goal.updatedSequence = input.sequence
    } else {
      const goal = goals.find(g => g.commitments?.some(c => c.commitmentKey === effect.commitmentKey))
      const item = goal?.commitments?.find(c => c.commitmentKey === effect.commitmentKey)
      if (!goal || !item || goal.actorKey !== input.actorKey || item.resolution !== null || changed.has(effect.commitmentKey)
        || goal.goalKey !== input.action.goalKey && !input.action.goalUpdates?.some(g => g.goalKey === goal.goalKey)) fail('承诺不属于本次角色目标、已处理或重复')
      if (item.audienceKeys.some(v => !input.action.audienceKeys.includes(v))) fail('承诺处置不能越过原知情范围')
      if (effect.kind === 'fulfill' && (input.action.kind !== 'complete' || input.action.waitingForPlayer)) fail('只有实际完成且不等待玩家的行动可以登记履行')
      if (input.sequence <= item.declared.sequence) fail('承诺处置必须晚于声明')
      item.resolution = {kind: effect.kind === 'fulfill' ? 'fulfilled' : 'withdrawn', messageId: input.messageId, sequence: input.sequence, excerpt: effect.evidenceExcerpt}
      goal.updatedSequence = input.sequence; changed.add(effect.commitmentKey)
    }
  }
  for (const goal of goals) validateChatGoalCommitmentsV1(goal.commitments, {actorKey: goal.actorKey,
    viewers: [state.playerKey, ...state.profiles.map(p => p.participantKey)], goalStatus: goal.status, updatedSequence: goal.updatedSequence, initial: false})
  story.situation.goals = goals
}

/** Public promise history does not reveal the associated private goal. */
export function chatVisibleCommitmentsV1(state: CharacterInteractionRuntimeState, viewerKey: string) {
  assertChatCommitmentSourcesV1(state)
  return (state.chatNarrative?.situation.goals ?? []).flatMap(goal => (goal.commitments ?? [])
    .filter(item => item.audienceKeys.includes(viewerKey)).map(item => ({actorKey: goal.actorKey, ...structuredClone(item)})))
}

export function chatCommitmentSequencesV1(goals: ChatActorGoalV1[]) {
  return goals.flatMap(g => (g.commitments ?? []).flatMap(c => [c.declared.sequence, ...(c.requested ? [c.requested.sequence] : []), ...(c.resolution ? [c.resolution.sequence] : [])]))
}
export function rebaseChatCommitmentsV1(goals: ChatActorGoalV1[], rebase: (sequence: number) => number): void {
  for (const goal of goals) for (const item of goal.commitments ?? []) {
    item.declared.sequence = rebase(item.declared.sequence)
    if (item.requested) item.requested.sequence = rebase(item.requested.sequence)
    if (item.resolution) item.resolution.sequence = rebase(item.resolution.sequence)
  }
}

export type {ChatGoalCommitmentV1}

export function validateChatCommitmentChecksV1(value: unknown, action: ChatNarrativeActionV1): void {
  const effects = action.commitmentEffects ?? [], checks = value ?? []
  if (!Array.isArray(checks) || checks.length !== effects.length) fail('承诺逐条审查不完整')
  const seen = new Set<number>()
  for (const entry of checks) {
    const item = object(entry, 'effectIndex,passed,reason')
    if (typeof item.effectIndex !== 'number' || !Number.isSafeInteger(item.effectIndex)
      || item.effectIndex < 0 || item.effectIndex >= effects.length || seen.has(item.effectIndex)
      || typeof item.passed !== 'boolean') fail('承诺审查索引或结论无效')
    text(item.reason, 2000); seen.add(item.effectIndex)
  }
}

/** Version gate also applies when a retained review is resumed or adopted. */
export function assertChatCommitmentReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  if (actions.some(a => a.commitmentEffects !== undefined)
    && !['chat-narrative-action-review-v19', 'chat-narrative-options-review-v13', 'chat-narrative-action-review-v20', 'chat-narrative-options-review-v14', 'chat-narrative-action-review-v21', 'chat-narrative-options-review-v15', 'chat-narrative-action-review-v22', 'chat-narrative-options-review-v16', 'chat-narrative-action-review-v23', 'chat-narrative-options-review-v17', 'chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')) fail('旧审查合同不支持承诺变化；保留原候选，不自动更换合同或重发')
}
