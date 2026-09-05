export type TextOpenWorldCommandSourceV1 = 'system-action' | 'fixed-choice' | 'mapped-intent'

export interface TextOpenWorldCommandEnvelopeV1 {
  schema: 'storyforge.text-open-world.command'
  version: 1
  commandId: string
  sessionId: number
  actorKey: string
  actionKey: string
  payload: Record<string, unknown>
  baseSequence: number
  baseStateHash: string
  source: TextOpenWorldCommandSourceV1
  requestedAt: number
}

export interface TextOpenWorldCommandEventPayloadV1 {
  schema: 'storyforge.text-open-world.command-event'
  version: 1
  envelope: TextOpenWorldCommandEnvelopeV1
  requestFingerprint: string
  resultingSequence: number
  resultingStateHash: string
}

export interface TextOpenWorldCommandReceiptV1 {
  schema: 'storyforge.text-open-world.command-receipt'
  version: 1
  status: 'committed'
  /** Command acceptance is not a gameplay outcome and must never be narrated as success. */
  outcomeCommitted: false
  mayNarrateSuccess: false
  commandId: string
  requestFingerprint: string
  eventId: number
  eventSequence: number
  resultingSequence: number
  resultingStateHash: string
  committedAt: number
  replayed: boolean
}

export type TextOpenWorldCommandLookupV1 =
  | { status: 'not-found'; sessionId: number; commandId: string }
  | { status: 'committed'; envelope: TextOpenWorldCommandEnvelopeV1; receipt: TextOpenWorldCommandReceiptV1 }
