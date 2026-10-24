import {chatCanFollowThreadV1} from './narrative-thread-followup'
import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeTriggerStateV1, ChatNarrativeTriggerV1, ChatTurnDirectionV1} from '../types/chat-narrative'
import {createContextTextScorerV1} from '../context-gateway/lexical-query'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {chatHasPendingPlayerFollowupV1, chatSituationConstructionRequestV1} from './narrative-progression'

export type ChatSchedulingModeV1 = 'manual' | 'natural' | 'round-robin'

export function chatHasUnfinishedGoalV1(state: CharacterInteractionRuntimeState, actorKey: string): boolean {
  return state.chatNarrative?.situation.goals.some(g => g.actorKey === actorKey && ['active', 'paused'].includes(g.status)) ?? false
}

/** A fresh player message permits a reply, never an autonomous new story arc. */
export function chatCanRespondAfterClosureV1(state: CharacterInteractionRuntimeState, actorKey: string,
  trigger: Pick<ChatNarrativeTriggerStateV1, 'kind' | 'actionSequences'>): boolean {
  return trigger.kind === 'player-response' && trigger.actionSequences.length === 0 && !chatHasUnfinishedGoalV1(state, actorKey)
}

/** An explicit new turn can revisit a paused goal. Further automatic actions
 * in that same turn need an active goal or an already authorized follow-up;
 * an unrelated old pause is not a reason to fill the remaining action quota. */
export function chatCanActInTurnV1(state: CharacterInteractionRuntimeState, actorKey: string,
  trigger: Pick<ChatNarrativeTriggerStateV1, 'kind' | 'actionSequences'>): boolean {
  const hasGoal = trigger.actionSequences.length === 0 ? chatHasUnfinishedGoalV1(state, actorKey)
    : state.chatNarrative?.situation.goals.some(goal => goal.actorKey === actorKey && goal.status === 'active')
  return !!hasGoal || chatHasPendingPlayerFollowupV1(state, actorKey)
    || chatCanRespondAfterClosureV1(state, actorKey, trigger) || chatCanFollowThreadV1(state, actorKey, trigger)
}

/** Eligibility is authority, not a model suggestion. A private player message
 * freezes a private pool; selecting a mode never grants anybody new knowledge. */
export function chatSchedulingPoolV1(state: CharacterInteractionRuntimeState, kind: ChatNarrativeTriggerV1, sourceSequence?: number) {
  const source = kind === 'player-response' ? state.messages.find(m => m.eventSequence === sourceSequence && m.role === 'player' && m.supersededBySequence == null) : null
  if (kind === 'player-response' && (!source || !isChatMessageRetrievableV1(state, source))) return []
  return (state.activeScene?.activeParticipantKeys ?? []).filter(key => !source?.audienceKeys || source.audienceKeys.includes(key))
}

function choose(state: CharacterInteractionRuntimeState, pool: string[], mode: Exclude<ChatSchedulingModeV1, 'manual'>, anchor?: string, order = pool): string | null {
  const story = state.chatNarrative!
  if (!pool.length) return null
  const pending = story.pendingSituation?.actorKey
  if (pending && pool.includes(pending) && chatSituationConstructionRequestV1(state, pending)) return pending
  if (anchor && pool.includes(anchor)) return anchor
  const messages = state.messages.filter(m => m.supersededBySequence == null && m.eventSequence > state.activeScene!.startedAtSequence)
  const lastActor = messages.filter(m => m.role === 'character' && order.includes(m.speakerKey)).slice(-1)[0]?.speakerKey
  const start = lastActor ? (order.indexOf(lastActor) + 1) % order.length : 0
  const rotation = [...order.slice(start), ...order.slice(0, start)].filter(key => pool.includes(key))
  if (mode === 'round-robin') return rotation[0]
  const ranked = rotation.map((actorKey, index) => {
    const visible = messages.filter(m => isChatMessageRetrievableV1(state, m) && (m.speakerKey === actorKey || m.audienceKeys == null || m.audienceKeys.includes(actorKey)))
    const latest = visible[visible.length - 1]
    const scoreText = createContextTextScorerV1(latest?.text ?? '')
    const profile = state.profiles.find(p => p.participantKey === actorKey)!
    const goals = story.situation.goals.filter(g => g.actorKey === actorKey && g.status === 'active')
    const threads = story.situation.threads.filter(t => t.participantKeys.includes(actorKey) && t.audienceKeys.includes(actorKey) && ['open', 'blocked'].includes(t.status))
    const mentioned = latest && latest.speakerKey !== actorKey && latest.text.includes(profile.name)
    const relevance = Math.max(0, ...goals.map(g => scoreText(`${g.desire}\n${g.concern}\n${g.boundary}`)), ...threads.map(t => scoreText(`${t.title}\n${t.question}`)))
    return {actorKey, index, score: (mentioned ? 4 : 0) + relevance * 2 - (lastActor === actorKey ? 1 : 0)}
  })
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index)[0].actorKey
}

export function createChatScheduledDirectionV1(state: CharacterInteractionRuntimeState, input: {
  mode: Exclude<ChatSchedulingModeV1, 'manual'>; kind: ChatNarrativeTriggerV1; sourceSequence: number; actionLimit: number; audienceParticipantKeys?: string[]
}): ChatTurnDirectionV1 {
  const participantKeys = chatSchedulingPoolV1(state, input.kind, input.sourceSequence).filter(key => !input.audienceParticipantKeys || input.audienceParticipantKeys.includes(key))
  const eligible = ['player-seed', 'player-response'].includes(input.kind) ? participantKeys : participantKeys.filter(key => chatCanFollowThreadV1(state, key, {kind: input.kind, actionSequences: []}) || chatHasPendingPlayerFollowupV1(state, key) || state.chatNarrative!.situation.goals.some(g => g.actorKey === key && g.status === 'active'))
  const actorKey = choose(state, eligible, input.mode, undefined, participantKeys)
  if (!actorKey) throw new Error('当前没有能听到这轮对话且仍有可推进目标的角色；可指定角色或提出新情境。')
  return {actorKey, actionLimit: input.actionLimit, scheduling: {mode: input.mode, participantKeys}}
}

/** Recomputed from the exact pre-action state at generation and adoption.
 * A new player message can receive one reply from a concluded/paused role.
 * Autonomous subsequent steps skip those roles; waiting and limits stop them. */
export function nextChatScheduledActorV1(state: CharacterInteractionRuntimeState, trigger: ChatNarrativeTriggerStateV1): string | null {
  const direction = trigger.direction
  if (!direction?.scheduling) return direction?.actorKey ?? null
  const allowed = new Set(chatSchedulingPoolV1(state, trigger.kind, trigger.sourceEventSequence))
  const pool = direction.scheduling.participantKeys.filter(key => allowed.has(key)
    && (trigger.kind === 'player-response' && trigger.actionSequences.length === 0
      || chatCanFollowThreadV1(state, key, trigger) || chatHasPendingPlayerFollowupV1(state, key) || state.chatNarrative!.situation.goals.some(g => g.actorKey === key && g.status === 'active')))
  return choose(state, pool, direction.scheduling.mode, trigger.actionSequences.length ? undefined : direction.actorKey, direction.scheduling.participantKeys)
}

export function assertChatTurnActorV1(state: CharacterInteractionRuntimeState, trigger: ChatNarrativeTriggerStateV1, actorKey: string): void {
  if (trigger.direction && nextChatScheduledActorV1(state, trigger) !== actorKey) throw new Error('行动角色与本轮明确选择或调度结果不一致。')
}
