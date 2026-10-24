import {supportsChatActionWireV1} from './action-wire'

/** Only these fields quote the actor's current expression. Player, destination,
 * source-fact and historical quotations must retain their separate authority. */
export const CHAT_OWN_EVIDENCE_ARRAYS_V1 = ['newFacts', 'disclosures', 'threadUpdates', 'goalUpdates', 'commitmentEffects', 'relationshipUpdates'] as const
export const CHAT_OWN_EVIDENCE_OBJECTS_V1 = ['situationRequest', 'followupGoal', 'threadFollowupGoal', 'pauseGoal', 'sceneTransition'] as const

export function supportsChatOwnEvidenceBindingV1(version: string | undefined): boolean {
  return supportsChatActionWireV1(version) || ['chat-narrative-action-v40', 'chat-narrative-options-v30', 'chat-action-revision-v19'].includes(version ?? '')
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Compile an explicit null into the complete, unchanged current expression.
 * This is a versioned transport instruction, never a repair of an invalid
 * quote. Domain parsing still enforces each field's size and shape; preview
 * and independent review still decide whether the claimed consequence holds.
 * The harness retains the raw response before invoking this compiler. */
export function bindChatOwnEvidenceV1(value: unknown, version: string | undefined): unknown {
  if (!supportsChatOwnEvidenceBindingV1(version) || !object(value) || typeof value.text !== 'string') return value
  const result = structuredClone(value), expression = value.text
  const bind = (item: unknown) => {
    if (object(item) && Object.prototype.hasOwnProperty.call(item, 'evidenceExcerpt') && item.evidenceExcerpt === null) item.evidenceExcerpt = expression
  }
  for (const key of CHAT_OWN_EVIDENCE_ARRAYS_V1) {
    const items = result[key]
    if (Array.isArray(items)) items.forEach(bind)
  }
  for (const key of CHAT_OWN_EVIDENCE_OBJECTS_V1) bind(result[key])
  return result
}
