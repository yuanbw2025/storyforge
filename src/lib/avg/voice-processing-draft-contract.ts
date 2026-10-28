import { assertAvgAudioProcessingPlanTargetsV1, assertAvgAudioProcessingPlanTargets } from './audio-production-contract'
import type { AvgVoiceRequirementV1 } from './voice-production-contract'

/** Editable local requirements only; no source, start, producer or adoption authority. */
export function assertAvgVoiceProcessingDraftV1(value: unknown, requirements: readonly AvgVoiceRequirementV1[]) {
  const plan = assertAvgAudioProcessingPlanTargetsV1(value, requirements.map(r => ({
    domain: 'voice' as const, requirementKey: r.requirementKey, kind: 'voice' as const, mimeType: 'audio/wav' as const,
  })))
  for (const entry of plan.entries) {
    const requirement = requirements.find(r => r.requirementKey === entry.requirementKey)!
    if (entry.recipe.maximumDurationMs < requirement.maximumDurationMs) {
      throw new Error('[avg-voice-process] 音量调整的时长上限短于该句已保存要求，请重新核对')
    }
  }
  return plan
}

/** Explicit successor dispatch; the original V1 checker remains strict. */
export function assertAvgVoiceProcessingDraft(value: unknown, requirements: readonly AvgVoiceRequirementV1[]) {
  const plan = assertAvgAudioProcessingPlanTargets(value, requirements.map(r => ({
    domain: 'voice' as const, requirementKey: r.requirementKey, kind: 'voice' as const, mimeType: 'audio/wav' as const,
  })))
  for (const entry of plan.entries) {
    const requirement = requirements.find(r => r.requirementKey === entry.requirementKey)!
    if (entry.recipe.maximumDurationMs < requirement.maximumDurationMs) {
      throw new Error('[avg-voice-process] 音量调整的时长上限短于该句已保存要求，请重新核对')
    }
  }
  return plan
}
