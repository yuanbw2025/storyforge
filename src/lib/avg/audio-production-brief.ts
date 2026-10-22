import type { ProductProductionBriefV3, ProductProductionBudgetV3 } from '../types'
import type { AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { parseAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { parseAvgSoundPlanningBriefV1, type AvgSoundPlanningBriefV1 } from './sound-production-brief'
import { assertAvgAudioProcessingPlanTargetsV1, avgAudioProcessingGateIdV1,
  type AvgAudioProductionProcessingPlanV1, type AvgAudioProcessingDomainV1 } from './audio-production-contract'

export const AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1 = 90_000
export const AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1 = 36 * 1024 * 1024
export const avgAudioProcessingInputTokensV1 = (domain: AvgAudioProcessingDomainV1) => domain === 'voice' ? 20_000 : 24_000

/** Explicitly closed until actual producer, sealed admission, independent
 * derived review/choice and Stage/portable consumption are all wired. Neither
 * a parsed Brief nor an environment switch can manufacture that capability. */
export function avgAudioProcessingExecutionReadyV1(): boolean { return false }

export function avgAudioProcessingForVoiceV3(value: unknown, assembly: AvgAssemblyBriefV3) {
  return assertAvgAudioProcessingPlanTargetsV1(value, avgAudioProcessingVoiceTargetsV3(assembly))
}
export function avgAudioProcessingVoiceTargetsV3(assembly: AvgAssemblyBriefV3) {
  return assembly.voice.batch.requirements.map(r => ({
    domain: 'voice' as const, requirementKey: r.requirementKey, kind: 'voice' as const, mimeType: 'audio/wav' as const,
  }))
}
export function avgAudioProcessingSoundTargetsV1(sound: AvgSoundPlanningBriefV1) {
  return sound.scope.templates.map(t => {
    const source = t.source
    const wave = source.kind === 'generate-music' || source.allowedSourceKeys.every(key =>
      sound.scope.librarySources.find(s => s.sourceKey === key)?.memberPath.toLowerCase().endsWith('.wav'))
    return { domain: 'sound' as const, requirementKey: t.requirementKey, kind: t.channel,
      mimeType: wave ? 'audio/wav' as const : 'audio/ogg' as const }
  })
}
export function avgAudioProcessingForSoundV1(value: unknown, input: AvgSoundPlanningBriefV1) {
  const sound = parseAvgSoundPlanningBriefV1(input)
  const plan = assertAvgAudioProcessingPlanTargetsV1(value, avgAudioProcessingSoundTargetsV1(sound))
  for (const e of plan.entries) {
    const source = sound.scope.templates.find(t => t.requirementKey === e.requirementKey)!.source
    if (source.kind === 'generate-music' && e.recipe.maximumDurationMs < source.durationSeconds * 1000) {
      throw new Error('[avg-audio-process] 加工时长上限短于准确已冻结音乐，不能先收费再发现已知不兼容')
    }
  }
  return plan
}

/** The declaration is a product-specific sibling in governed Brief JSON.
 * Existing voice/raw and semantic sound V1 codecs do not gain new fields. */
export function assertAvgAudioProcessingBriefV1(brief: ProductProductionBriefV3) {
  if (!brief.avgAudioProcessing) return
  if (brief.intent.productType !== 'avg' || brief.avgVisualPlanning || brief.avgRevision
    || (!!brief.avgSoundPlanning === (brief.avgAssembly?.version === 3))) {
    throw new Error('[avg-audio-process] 加工声明只属于准确AVG配音或声音Brief，不能借给其他产品或旧组装')
  }
  if (brief.avgSoundPlanning) avgAudioProcessingForSoundV1(brief.avgAudioProcessing, brief.avgSoundPlanning)
  else avgAudioProcessingForVoiceV3(brief.avgAudioProcessing, parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly)
}

export function addAvgAudioProcessingBudgetV1(base: ProductProductionBudgetV3, plan: AvgAudioProductionProcessingPlanV1,
  domain: AvgAudioProcessingDomainV1): ProductProductionBudgetV3 {
  return { ...base, maximumInputTokens: base.maximumInputTokens + plan.entries.length * avgAudioProcessingInputTokensV1(domain),
    maximumDurationMs: base.maximumDurationMs + plan.entries.length * AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1,
    maximumStorageBytes: base.maximumStorageBytes + plan.entries.length * AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1 }
}
export function avgAudioProcessingGateIdsV1(plan: AvgAudioProductionProcessingPlanV1) {
  return plan.entries.map(e => avgAudioProcessingGateIdV1(e.domain, e.requirementKey))
}
