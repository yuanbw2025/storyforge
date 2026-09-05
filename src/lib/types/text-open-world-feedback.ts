import type { TextOpenWorldActionUnavailableCodeV1, TextOpenWorldActionAvailabilityV1 } from './text-open-world-action'
import type { TextOpenWorldEffectChangeV1 } from './text-open-world-effect'
import type { TextOpenWorldDegradationV1, TextOpenWorldRandomEvidenceV1 } from './text-open-world-event'

export type TextOpenWorldFeedbackStatusV1 =
  | 'rejected' | 'confirmation-required' | 'pending'
  | 'succeeded' | 'failed' | 'degraded'

export interface TextOpenWorldFeedbackReceiptV1 {
  schema: 'storyforge.text-open-world.feedback-receipt'
  version: 1
  phase: 'preflight' | 'pending' | 'terminal'
  status: TextOpenWorldFeedbackStatusV1
  sessionId: number
  commandId: string | null
  actionKey: string
  targetKey: string | null
  baseSequence: number
  outcomeCommitted: boolean
  commandSequence: number | null
  resultingSequence: number | null
  resultingStateHash: string | null
  outcomeFingerprint: string | null
  gameplayStateChanged: boolean
  changes: TextOpenWorldEffectChangeV1[]
  randomEvidence: TextOpenWorldRandomEvidenceV1[]
  reason: {
    code: TextOpenWorldActionUnavailableCodeV1 | 'confirmation-required' | string
    message: string
  } | null
  degradation: TextOpenWorldDegradationV1 | null
  presentation: {
    headline: string
    details: string[]
    mayNarrateSuccess: boolean
  }
  evidenceEventIds: number[]
  evidenceEventSequences: number[]
  receiptHash: string
}

export interface CreateTextOpenWorldPreflightFeedbackInputV1 {
  sessionId: number
  targetKey: string | null
  baseSequence: number
  availability: TextOpenWorldActionAvailabilityV1
  confirmed: boolean
}
