import { planAvgAudioDspLayoutV2 } from './audio-dsp-kernel-v2'
import { assertAvgAudioProcessingPlanTargetsV1, assertAvgAudioProcessingPlanTargets } from './audio-production-contract'
import { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1 } from './sound-scope-contract'

/** A saved requirement is eligible only when every allowed original source
 * is WAV. No semantic choice has selected a library member at this point. */
export function avgSoundProcessingDraftTargetsV1(input: AvgSoundPlanningScopeV1) {
  const scope = parseAvgSoundPlanningScopeV1(input)
  return scope.templates.map(t => {
    const source = t.source
    const wave = source.kind === 'generate-music' || source.allowedSourceKeys.every(key =>
      scope.librarySources.find(s => s.sourceKey === key)?.memberPath.toLowerCase().endsWith('.wav'))
    return { domain: 'sound' as const, requirementKey: t.requirementKey, kind: t.channel,
      mimeType: wave ? 'audio/wav' as const : 'audio/ogg' as const }
  })
}

/** Author-owned local requirements only. This does not manufacture a Brief,
 * source proof, start, producer, audition, licence or adoption authority. */
export function assertAvgSoundProcessingDraftV1(value: unknown, input: AvgSoundPlanningScopeV1) {
  const scope = parseAvgSoundPlanningScopeV1(input)
  const plan = assertAvgAudioProcessingPlanTargetsV1(value, avgSoundProcessingDraftTargetsV1(scope))
  for (const entry of plan.entries) {
    const source = scope.templates.find(t => t.requirementKey === entry.requirementKey)!.source
    if (source.kind === 'generate-music' && entry.recipe.maximumDurationMs < source.durationSeconds * 1000) {
      throw new Error('[avg-sound-process] 音量调整的时长上限短于已保存音乐要求，请重新核对')
    }
  }
  return plan
}

/** Explicit successor dispatch; the original V1 checker remains strict. */
export function assertAvgSoundProcessingDraft(value: unknown, input: AvgSoundPlanningScopeV1) {
  const scope = parseAvgSoundPlanningScopeV1(input)
  const plan = assertAvgAudioProcessingPlanTargets(value, avgSoundProcessingDraftTargetsV1(scope))
  for (const entry of plan.entries) {
    const source = scope.templates.find(t => t.requirementKey === entry.requirementKey)!.source
    if (source.kind === 'generate-music' && entry.recipe.maximumDurationMs < source.durationSeconds * 1000) {
      throw new Error('[avg-sound-process] 音量调整的时长上限短于已保存音乐要求，请重新核对')
    }
    if (source.kind === 'generate-music' && entry.recipe.version === 2) {
      // The frozen local music protocol declares 48kHz stereo. Reject a
      // known impossible numeric/output job before a model/media request.
      const layout = planAvgAudioDspLayoutV2({ channelCount: 2, sampleCount: source.durationSeconds * 48_000,
        sourceSampleRateHz: 48_000, recipe: entry.recipe })
      if (44 + layout.outputSampleCount * 4 > 8 * 1024 * 1024) throw new Error('[avg-sound-process] 输出声音超过现有8MiB界，请先调整时长或采样要求')
    }
  }
  return plan
}
