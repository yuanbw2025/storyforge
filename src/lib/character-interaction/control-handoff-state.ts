import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatControlHandoffRecordV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import {interactionMessageVisibleTo} from './message-visibility'

function fail(): never {throw new Error('[chat-control-handoff] 交还控制状态或来源不完整')}

/** Validate the persisted control marker without allowing a naked empty
 * waiting trigger to acquire the semantics of the new reviewed result. */
export function parseChatControlHandoffRecordV1(value: unknown, trigger: Pick<ChatNarrativeTriggerStateV1,
  'kind' | 'status' | 'requestedSequence' | 'sourceEventSequence' | 'actionSequences' | 'direction'>, participantKeys: readonly string[]): ChatControlHandoffRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const row = value as Record<string, unknown>
  const keys = ['version', 'sequence', 'actorKey', 'sourceMessageId', 'sourceSequence']
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))
    || ![1, 2, 3, 4].includes(Number(row.version)) || typeof row.version !== 'number' || !Number.isSafeInteger(row.sequence) || row.sequence === 0
    || !Number.isSafeInteger(row.sourceSequence) || row.sourceSequence === 0
    || typeof row.actorKey !== 'string' || !participantKeys.includes(row.actorKey)
    || typeof row.sourceMessageId !== 'string' || !row.sourceMessageId.trim() || row.sourceMessageId.length > 200
    || (row.version === 1 ? trigger.kind !== 'continue' || !['waiting-player', 'cancelled'].includes(trigger.status)
      : row.version === 4 ? trigger.kind !== 'player-response' || !['waiting-player', 'cancelled'].includes(trigger.status)
        || trigger.actionSequences.length !== 0 || Number(row.sourceSequence) >= trigger.sourceEventSequence
        || trigger.sourceEventSequence >= trigger.requestedSequence
      : row.version === 3 ? trigger.status !== 'complete' || !['continue', 'return'].includes(trigger.kind)
        || trigger.actionSequences.length !== 0 || Number(row.sourceSequence) >= trigger.requestedSequence
      : trigger.status !== 'complete' || !trigger.actionSequences.length
        || trigger.actionSequences.slice(-1)[0] !== row.sourceSequence || Number(row.sourceSequence) <= trigger.requestedSequence)
    || trigger.direction?.scheduling
    || trigger.direction && trigger.direction.actorKey !== row.actorKey
    || Number(row.sequence) <= trigger.requestedSequence || Number(row.sourceSequence) >= Number(row.sequence)
    || trigger.actionSequences.some(sequence => sequence >= Number(row.sequence))) fail()
  return structuredClone(value) as ChatControlHandoffRecordV1
}

/** Historical source visibility persists even if the author later excludes
 * or supersedes that dialogue. Such changes do not revoke past control events. */
export function assertChatControlHandoffSourcesV1(state: CharacterInteractionRuntimeState): void {
  for (const trigger of state.chatNarrative?.triggers ?? []) {
    const record = trigger.controlHandoff
    if (!record) continue
    const sources = state.messages.filter(message => message.messageId === record.sourceMessageId && message.eventSequence === record.sourceSequence)
    if (sources.length !== 1 || sources[0].role !== 'character' || sources[0].speakerKey !== record.actorKey
      || !interactionMessageVisibleTo(sources[0], state.playerKey)) fail()
    if (record.version === 4) {
      const responses = state.messages.filter(message => message.eventSequence === trigger.sourceEventSequence)
      if (responses.length !== 1 || responses[0].role !== 'player' || responses[0].speakerKey !== state.playerKey
        || !interactionMessageVisibleTo(responses[0], record.actorKey) || !interactionMessageVisibleTo(responses[0], state.playerKey)) fail()
    }
  }
}
