import type {InteractionRuntimeMessage} from '../types'

export function interactionMessageVisibleTo(message: InteractionRuntimeMessage, participantKey: string): boolean {
  return message.speakerKey === participantKey || message.audienceKeys == null || message.audienceKeys.includes(participantKey)
}
