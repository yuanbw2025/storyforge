import type { TextOpenWorldActionProjectionContextV1 } from './text-open-world-action'
import type { TextOpenWorldConditionEvaluationContextV1 } from './text-open-world-condition'
import type { TextOpenWorldEffectStateV1 } from './text-open-world-effect'
import type { TextOpenWorldRandomEvidenceV1, TextOpenWorldRulesetStampV1 } from './text-open-world-event'
import type { TextOpenWorldRuntimePackageV1 } from './text-open-world-runtime'

export type TextOpenWorldDerivedPlayerStatKeyV1 =
  | 'maximumHealth' | 'attack' | 'defense' | 'criticalChance' | 'initiative' | 'maximumSkillResource'

export interface TextOpenWorldDerivedPlayerStatBreakdownV1 {
  semanticKey: TextOpenWorldDerivedPlayerStatKeyV1
  formulaKey: string
  components: Array<{
    sourceKind: 'base' | 'level' | 'attribute' | 'equipment'
    sourceKey: string
    value: number
  }>
  rawValue: number
  minimum: number
  maximum: number
  value: number
}

/** Read-only values recalculated from frozen Release formulas and Session inputs. */
export interface TextOpenWorldDerivedPlayerStatsV1 {
  maximumHealth: number
  attack: number
  defense: number
  criticalChance: number
  initiative: number
  maximumSkillResource: number
  breakdown: Record<TextOpenWorldDerivedPlayerStatKeyV1, TextOpenWorldDerivedPlayerStatBreakdownV1>
}

export interface TextOpenWorldDirectorProjectionV1 {
  drawCount: number
  generatedQuestInstanceCount: number
  revealedQuestInstanceKeys: string[]
  activeQuestInstanceKeys: string[]
  recentFingerprints: Array<{ fingerprint: string; worldMinute: number }>
  lastDrawWorldMinuteByRegionKey: Record<string, number>
  highIntensityStreak: number
}

export interface TextOpenWorldActionRuntimeProjectionV1 {
  completedOnceActionKeys: string[]
  cooldownUntilWorldMinuteByActionKey: Record<string, number>
}

export interface TextOpenWorldSessionProtocolProjectionV1 {
  pendingCommandId: string | null
  pendingCommandSequence: number | null
  pendingActionKey: string | null
  pendingActorKey: string | null
  randomEvidence: Array<{ eventSequence: number; evidence: TextOpenWorldRandomEvidenceV1 }>
  lastCompletedCommandId: string | null
  lastOutcomeFingerprint: string | null
}

export interface TextOpenWorldSessionProjectionV1 {
  schema: 'storyforge.text-open-world.session-projection'
  version: 1
  runtimePackage: TextOpenWorldRuntimePackageV1
  ruleset: TextOpenWorldRulesetStampV1
  state: TextOpenWorldEffectStateV1
  actions: TextOpenWorldActionRuntimeProjectionV1
  director: TextOpenWorldDirectorProjectionV1
  protocol: TextOpenWorldSessionProtocolProjectionV1
  lastEventSequence: number
}

export interface TextOpenWorldDerivedContextsV1 {
  condition: TextOpenWorldConditionEvaluationContextV1
  action: TextOpenWorldActionProjectionContextV1
  playerStats: TextOpenWorldDerivedPlayerStatsV1
}

export type TextOpenWorldRuntimeHeadDiagnosticCodeV1 =
  | 'valid' | 'not-vnext' | 'cache-missing' | 'cache-sequence-mismatch' | 'cache-hash-invalid'
  | 'cache-state-invalid' | 'cache-hash-mismatch' | 'cache-replay-mismatch'
  | 'event-protocol-invalid'

export interface TextOpenWorldRuntimeHeadInspectionV1 {
  sessionId: number
  latestSequence: number
  code: TextOpenWorldRuntimeHeadDiagnosticCodeV1
  detail: string
  canonicalStateHash: string | null
  cachedStateHash: string | null
  repairable: boolean
}

export type TextOpenWorldCheckpointDiagnosticCodeV1 =
  | 'valid' | 'not-vnext' | 'checkpoint-missing' | 'session-missing' | 'scope-mismatch'
  | 'checkpoint-hash-invalid' | 'checkpoint-state-invalid' | 'checkpoint-hash-mismatch'
  | 'checkpoint-sequence-mismatch' | 'event-protocol-invalid' | 'replay-mismatch'

export interface TextOpenWorldCheckpointInspectionV1 {
  checkpointId: number
  sessionId: number | null
  throughSequence: number | null
  code: TextOpenWorldCheckpointDiagnosticCodeV1
  detail: string
  valid: boolean
}
