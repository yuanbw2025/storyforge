import type { TextOpenWorldActionProjectionContextV1 } from './text-open-world-action'
import type { TextOpenWorldConditionEvaluationContextV1 } from './text-open-world-condition'
import type { TextOpenWorldEffectStateV1 } from './text-open-world-effect'
import type { TextOpenWorldRandomEvidenceV1, TextOpenWorldRulesetStampV1 } from './text-open-world-event'
import type { TextOpenWorldRuntimePackageV1 } from './text-open-world-runtime'

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
}
