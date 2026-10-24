import type {ChatNarrativePermissionsV1, ChatNarrativeStateV1} from '../types/chat-narrative'

/** A UI default for the next explicit trigger, never an authorization to run.
 * Saved turn directions take precedence; undirected historical turns retain
 * the previous one-step UI default. The frozen work always caps the choice. */
export function chatNextActionLimitV1(
  permissions: ChatNarrativePermissionsV1 | undefined,
  triggers: ChatNarrativeStateV1['triggers'] = [],
): number {
  if (!permissions) return 1
  const previous = triggers[triggers.length - 1]
  const preferred = previous ? previous.direction?.actionLimit ?? 1 : permissions.mode === 'story' ? 2 : 1
  return Math.min(permissions.maxActionsPerTrigger, Math.max(1, preferred))
}
