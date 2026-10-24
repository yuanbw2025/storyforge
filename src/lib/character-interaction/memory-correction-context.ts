import type {CharacterInteractionRuntimeState} from '../types'
import {pendingChatMemoryCorrectionsV1} from './memory-reconciliation'

/** A new reader supplies exact shared evidence alongside each pending player
 * correction. No superseded summary, private memory or reviewer receipt enters
 * this packet. Delivery alone never acknowledges a correction. */
export function chatMemoryCorrectionContextV1(state: CharacterInteractionRuntimeState, actorKey: string) {
  return pendingChatMemoryCorrectionsV1(state, actorKey).map(memory => ({
    memoryId: memory.memoryId, sourceSequence: memory.proposalSequence, actorKey,
    content: memory.content, evidenceExcerpt: memory.evidenceExcerpt,
    sources: memory.sourceEventSequences.map(sequence => {
      // pendingChatMemoryCorrectionsV1 has verified the complete shared source.
      const message = state.messages.find(m => m.eventSequence === sequence)!
      return {messageId: message.messageId, eventSequence: sequence, speakerKey: message.speakerKey, text: message.text}
    }),
  }))
}

export type ChatMemoryCorrectionContextV1 = ReturnType<typeof chatMemoryCorrectionContextV1>
