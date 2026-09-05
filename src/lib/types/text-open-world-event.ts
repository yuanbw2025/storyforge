import type { TextOpenWorldEffectPlanV1, TextOpenWorldEffectReceiptV1 } from './text-open-world-effect'

export type TextOpenWorldCommandOutcomeV1 = 'success' | 'failure' | 'degraded'

export interface TextOpenWorldDegradationV1 {
  code: string
  message: string
  unavailableCapability: string
  fallback: string
}

export interface TextOpenWorldOutcomeReasonV1 {
  code: string
  message: string
}

export interface TextOpenWorldRulesetStampV1 {
  key: string
  version: number
}

export interface TextOpenWorldRandomRequestV1 {
  drawKey: string
  minimumInclusive: number
  maximumInclusive: number
}

export interface TextOpenWorldRandomEvidenceV1 extends TextOpenWorldRandomRequestV1 {
  algorithm: 'sha256-range-v1'
  seedHash: string
  inputHash: string
  drawIndex: number
  value: number
}

export interface TextOpenWorldRandomResolvedEventPayloadV1 {
  schema: 'storyforge.text-open-world.random-resolved-event'
  version: 1
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  evidence: TextOpenWorldRandomEvidenceV1
}

export interface TextOpenWorldEffectsAppliedEventPayloadV1 {
  schema: 'storyforge.text-open-world.effects-applied-event'
  version: 1
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  randomEventSequences: number[]
  outcome: TextOpenWorldCommandOutcomeV1
  reason: TextOpenWorldOutcomeReasonV1 | null
  degradation: TextOpenWorldDegradationV1 | null
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
  outcomeFingerprint: string
}

export interface TextOpenWorldEventBatchProjectionV1 {
  commandId: string
  commandSequence: number
  randomEventSequences: number[]
  effectsEventSequence: number | null
  ruleset: TextOpenWorldRulesetStampV1 | null
  outcomeFingerprint: string | null
}

export interface TextOpenWorldEventProtocolProjectionV1 {
  schema: 'storyforge.text-open-world.event-protocol-projection'
  version: 1
  sessionId: number | null
  lastSequence: number
  batches: TextOpenWorldEventBatchProjectionV1[]
  pendingCommandId: string | null
}

export interface TextOpenWorldOutcomeBatchReceiptV1 {
  schema: 'storyforge.text-open-world.outcome-batch-receipt'
  version: 1
  status: 'committed'
  commandId: string
  commandSequence: number
  randomEventIds: number[]
  randomEventSequences: number[]
  effectsEventId: number
  effectsEventSequence: number
  resultingSequence: number
  outcomeFingerprint: string
  outcome: TextOpenWorldCommandOutcomeV1
  reason: TextOpenWorldOutcomeReasonV1 | null
  degradation: TextOpenWorldDegradationV1 | null
  replayed: boolean
}
