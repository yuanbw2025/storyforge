import type { TextOpenWorldActionProjectionContextV1 } from './text-open-world-action'
import type { TextOpenWorldConditionEvaluationContextV1 } from './text-open-world-condition'
import type { TextOpenWorldEffectStateV1 } from './text-open-world-effect'
import type { TextOpenWorldRandomEvidenceV1, TextOpenWorldRulesetStampV1 } from './text-open-world-event'
import type { TextOpenWorldCombatTransitionIntentV1 } from './text-open-world-effect'
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

export interface TextOpenWorldProgressionStatusV1 {
  level: number
  maximumLevel: number
  experience: number
  currentLevelThreshold: number
  nextLevelThreshold: number | null
  experienceIntoLevel: number
  experienceForNextLevel: number | null
  progressRatio: number
  atMaximumLevel: boolean
}

/** Compatibility mirror of the Effect-state Director ledger. */
export type TextOpenWorldDirectorProjectionV1 = TextOpenWorldEffectStateV1['director']

export interface TextOpenWorldActionRuntimeProjectionV1 {
  completedOnceActionKeys: string[]
  cooldownUntilWorldMinuteByActionKey: Record<string, number>
}

export interface TextOpenWorldSessionProtocolProjectionV1 {
  pendingCommandId: string | null
  pendingCommandSequence: number | null
  pendingActionKey: string | null
  pendingActorKey: string | null
  pendingTargetKey: string | null
  pendingCombatTransitionIntent: TextOpenWorldCombatTransitionIntentV1 | null
  pendingActionQuantity: number | null
  pendingActionItemKey: string | null
  pendingDirectorTrigger: import('./text-open-world-modules').TextOpenWorldDirectorTriggerV1 | null
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
  progression: TextOpenWorldProgressionStatusV1
}

export type TextOpenWorldQuestHistoryKindV1 =
  | 'accepted' | 'activated' | 'suspended' | 'resumed' | 'stage-advanced'
  | 'completed' | 'failed' | 'abandoned' | 'expired' | 'withdrawn' | 'reoffered'
  | 'objective-completed' | 'reward-claimed' | 'tracked' | 'untracked'

export interface TextOpenWorldQuestHistoryEntryV1 {
  sequence: number
  commandId: string
  instanceKey: string
  definitionKey: string
  kind: TextOpenWorldQuestHistoryKindV1
  worldMinute: number | null
  stageKey: string | null
  objectiveKey: string | null
  trackingSlot: 'primary' | 'pinned' | null
  summary: string
}

export interface TextOpenWorldQuestDeadlineProjectionV1 {
  deadlineWorldMinute: number | null
  remainingMinutes: number | null
  expired: boolean
  label: string | null
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
  | 'checkpoint-purpose-invalid'

export interface TextOpenWorldCheckpointInspectionV1 {
  checkpointId: number
  sessionId: number | null
  throughSequence: number | null
  code: TextOpenWorldCheckpointDiagnosticCodeV1
  detail: string
  valid: boolean
}
