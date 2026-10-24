import type {CharacterInteractionRuntimeState} from '../types'
import type {InteractionContextWindow} from './runtime'
import type {ChatPlayerDecisionHandoffV1} from './control-handoff-contract'
import {interactionMessageVisibleTo} from './message-visibility'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

export const CHAT_PLAYER_ACKNOWLEDGEMENT_PRODUCER_V1 = 'chat-narrative-action-v72'
export function supportsChatPlayerAcknowledgementV1(version: string | undefined): boolean {
  return version === CHAT_PLAYER_ACKNOWLEDGEMENT_PRODUCER_V1
}

/** The existing trigger binds the exact new player message. No generated
 * classification becomes a player decision, permission, pause or story fact. */
export interface ChatPlayerAcknowledgementHandoffV1 extends Omit<ChatPlayerDecisionHandoffV1, 'version'> {
  version: 4
}

function fail(): never {throw new Error('[chat-player-acknowledgement] 缺少本轮尚未承接、共同可见的真实玩家回应')}

/** Structural eligibility only; acknowledgement, ambiguity, unanswered
 * questions and remaining autonomous directions require independent review. */
export function assertChatPlayerAcknowledgementContextV1(context: Pick<InteractionContextWindow, 'chatNarrative' | 'messages'>): void {
  const trigger = context.chatNarrative?.trigger
  const messages = context.messages.filter(message => message.supersededBySequence == null)
  const matches = messages.filter(message => message.eventSequence === trigger?.sourceEventSequence)
  if (!trigger || trigger.kind !== 'player-response' || trigger.actionSequences.length || trigger.direction?.scheduling
    || matches.length !== 1 || matches[0].role !== 'player' || messages[messages.length - 1] !== matches[0]
    || matches[0].eventSequence >= trigger.requestedSequence) fail()
}

export function assertChatPlayerAcknowledgementStateV1(state: CharacterInteractionRuntimeState, actorKey: string,
  handoff: ChatPlayerAcknowledgementHandoffV1): void {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0]
  const visible = state.messages.filter(message => message.supersededBySequence == null && interactionMessageVisibleTo(message, actorKey))
  const matches = visible.filter(message => message.eventSequence === trigger?.sourceEventSequence)
  if (!trigger || trigger.kind !== 'player-response' || trigger.actionSequences.length || matches.length !== 1
    || matches[0].role !== 'player' || matches[0].speakerKey !== state.playerKey || visible[visible.length - 1] !== matches[0]
    || !interactionMessageVisibleTo(matches[0], state.playerKey) || !isChatMessageRetrievableV1(state, matches[0])
    || handoff.source.sequence >= matches[0].eventSequence || matches[0].eventSequence >= trigger.requestedSequence) fail()
}

export const CHAT_PLAYER_ACKNOWLEDGEMENT_RULES_V1 = [
  'version:4 只承接本次 player-response 中表示仍在听、而没有新增待答内容的回应。输出仍为 outcome:"handoff"、action:null，handoff 结构与 version:1 相同，但 version 必须为4；source 引用此前实际提出具体玩家决定的自己的原话，decision/dependentStep 保留其真实范围。最新玩家回应由本轮 sourceEventSequence 绑定，不能自己选择较早的玩家消息。',
  '必须先读最新玩家消息和此前问题的完整来回。它若已经答复、拒绝、取消、要求暂停、提供新信息、提出问题或要求行动，就不能用 version:4 吞掉这些内容。不能只凭字数、某个语气词或相似措辞认定是倾听；有歧义时不得推定同意，也不得无视可能仍须回应的内容。',
  '只有具体决定仍未作出、这一步确实依赖玩家，而且没有可推进的自主方向或必要说明时，才可把控制留给玩家。不要再次询问想聊哪点、要不要继续或反复表示不着急。这个控制结果没有新气泡，不改变目标、事项、承诺或角色关系，不算剧情推进；任何可用的独立行动仍应推进。',
] as const
