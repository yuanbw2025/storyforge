import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeTriggerStateV1, ChatNarrativeTriggerV1, ChatTurnDirectionV1} from '../types/chat-narrative'

type ConversationBoundary = Pick<ChatTurnDirectionV1, 'audienceParticipantKeys' | 'conversationMode'>

/** Freeze the selected conversation and the actual triggering message's listeners.
 * A later UI selection cannot widen a private message that is already committed. */
export function resolveChatTurnAudienceV1(state: CharacterInteractionRuntimeState, kind: ChatNarrativeTriggerV1,
  sourceSequence: number, selected?: string[] | null): Pick<ChatTurnDirectionV1, 'audienceParticipantKeys' | 'conversationMode'> {
  const active = state.activeScene?.activeParticipantKeys ?? []
  if (selected != null && (!selected.length || new Set(selected).size !== selected.length || selected.some(key => !active.includes(key)))) {
    throw new Error('对话收件人已离场或无效；请等待其回归，或明确更换收件人。')
  }
  const message = kind === 'player-response' ? state.messages.find(m => m.eventSequence === sourceSequence && m.role === 'player' && m.supersededBySequence == null) : null
  const listeners = message?.audienceKeys?.filter(key => key !== state.playerKey)
  const audience = (selected ?? active).filter(key => listeners == null || listeners.includes(key))
  if (!audience.length) throw new Error('当前对话没有能听见该消息的在场角色。')
  const privateMessage = message?.playerConversation === 'private' || listeners != null && message?.playerConversation !== 'present'
    && state.profiles.some(profile => !listeners.includes(profile.participantKey))
  return {audienceParticipantKeys: [...audience], conversationMode: selected != null || privateMessage ? 'private' : 'present'}
}

/** Low-level callers cannot omit a new message's send-time privacy by omitting
 * UI direction fields. Historical messages without a mode retain their rules. */
export function chatTurnAudienceBoundaryV1(state: CharacterInteractionRuntimeState, trigger: ChatNarrativeTriggerStateV1): ConversationBoundary | undefined {
  const direction = trigger.direction
  const message = trigger.kind === 'player-response' ? state.messages.find(m => m.role === 'player' && m.eventSequence === trigger.sourceEventSequence) : null
  if (!message?.playerConversation) return direction
  const listeners = message.audienceKeys!.filter(key => key !== state.playerKey)
  return {
    audienceParticipantKeys: direction?.audienceParticipantKeys?.filter(key => listeners.includes(key)) ?? listeners,
    conversationMode: message.playerConversation === 'private' ? 'private' : direction?.conversationMode ?? (direction?.audienceParticipantKeys ? 'private' : 'present'),
  }
}

export function assertChatTurnAudienceV1(direction: ConversationBoundary | undefined, playerKey: string, recipients: readonly string[]): void {
  const audience = direction?.audienceParticipantKeys
  if (audience && recipients.some(key => key !== playerKey && !audience.includes(key))) throw new Error('候选超出本轮私聊或对话的听众范围。')
}

export function chatTurnAudienceGuidanceV1(direction: ConversationBoundary | undefined) {
  return direction?.audienceParticipantKeys ? {conversationBoundary: {
    participantKeys: direction.audienceParticipantKeys,
    ...(direction.conversationMode ? {mode: direction.conversationMode} : {}),
    instruction: '本轮表达与新事实的听众仅限玩家及这里列出的角色；调度、新目标、打算和剧情线不得扩至其他角色。私聊须保留共用场景标题、时地，不得转场。已有共同事项不能在未通知其他参与者时私下修改。',
  }} : {}
}

/** Model projection only. A scene person's presence comes from visible facts,
 * never from the roster of independently scheduled principal participants.
 * Historical and private turns retain their original conservative boundary. */
export function chatTurnAudienceGuidanceV2(direction: ConversationBoundary | undefined) {
  const original = chatTurnAudienceGuidanceV1(direction)
  if (!original.conversationBoundary || direction?.conversationMode !== 'present') return original
  return {conversationBoundary: {...original.conversationBoundary,
    instruction: 'participantKeys 是本轮可调度主角色的范围；表达、新事实和答复的 audienceKeys 只登记玩家及这里列出的主角色，不为场景人物编造 participantKey。调度、新目标、打算和剧情线不能扩至名单外的主角色。场景人物以角色可见事实为在场和接触依据，不需要加入主角色名单才能交谈；已有依据明确可交谈时，可以实际向其发问，不需重复请求“纳入交谈范围”。人物未被证实在场或可接触时仍须先补足真实条件；能提问不代表对方知情、愿意或已经回答。只有冻结 permissions.allowInquiryResults=true 且符合原情境权限时，实际问题才能请求后续 inquiryResult；角色不能预写答复、发现或玩家行动。不得把私有信息说给无权得知的场景人物，也不得绕过明确拒绝或玩家暂停。已有共同事项不能在未通知其他参与者时私下修改。',
  }}
}

/** Public conversation remains public even if another role is currently absent.
 * Historical narrowed turns without an explicit mode keep conservative metadata rules. */
export function chatTurnHasPrivateSceneBoundaryV1(state: CharacterInteractionRuntimeState, direction: ConversationBoundary | undefined): boolean {
  return direction?.conversationMode === 'private' || direction?.audienceParticipantKeys !== undefined && direction.conversationMode !== 'present'
    && state.profiles.some(profile => !direction.audienceParticipantKeys!.includes(profile.participantKey))
}
