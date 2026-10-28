import { parseAvgAudioProcessingRecipeV1, type AvgAudioProcessingRecipeV1, type AvgAudioPcmKindV1 } from './audio-processing-contract'
import { avgEnum, avgKey, avgList, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { parseAvgAudioProcessingRecipe, type AvgAudioProcessingRecipe } from './audio-processing-versioned-contract'

export type AvgAudioProcessingDomainV1 = 'voice' | 'sound'
export interface AvgAudioProductionProcessingPlanV1 {
  schema: 'storyforge.avg.audio-production-processing-plan'
  version: 1
  entries: Array<{ domain: AvgAudioProcessingDomainV1; requirementKey: string; recipe: AvgAudioProcessingRecipeV1 }>
}

/** Explicit successor plans may retain unchanged V1 entries beside V2 entries.
 * An all-V1 plan must retain its original version and canonical bytes. */
export interface AvgAudioProductionProcessingPlanV2 {
  schema: 'storyforge.avg.audio-production-processing-plan'
  version: 2
  entries: Array<{ domain: AvgAudioProcessingDomainV1; requirementKey: string; recipe: AvgAudioProcessingRecipe }>
}
export type AvgAudioProductionProcessingPlan = AvgAudioProductionProcessingPlanV1 | AvgAudioProductionProcessingPlanV2

/** A proposal for an explicitly frozen production requirement, never an
 * accepted producer, licence, audition or authorization to change an old Build.
 * The original semantic sound-plan V1 codec deliberately remains unchanged. */
export function parseAvgAudioProductionProcessingPlanV1(value: unknown): AvgAudioProductionProcessingPlanV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'entries'], 'audio production processing plan')
  if (r.schema !== 'storyforge.avg.audio-production-processing-plan' || r.version !== 1) {
    throw new Error('[avg-audio-process] 正式音频加工方案版本无效')
  }
  const entries = avgUnique(avgList(r.entries, 'audio processing entries', value => {
    const e = avgRecord(value, ['domain', 'requirementKey', 'recipe'], 'audio processing entry')
    const domain = avgEnum(e.domain, ['voice', 'sound'] as const, 'audio processing domain')
    const requirementKey = avgKey(e.requirementKey, 'audio processing requirement')
    avgProcessedAudioArtifactKeyV1(domain, requirementKey)
    avgAudioProcessingTaskKeyV1(domain, requirementKey)
    avgAudioProcessingGateIdV1(domain, requirementKey)
    return { domain, requirementKey, recipe: parseAvgAudioProcessingRecipeV1(e.recipe) }
  }, 100), e => `${e.domain}:${e.requirementKey}`, 'audio processing entries')
  if (!entries.length) throw new Error('[avg-audio-process] 空加工方案须省略，不能隐式选择全部声音')
  return { schema: r.schema, version: 1, entries }
}

export function avgProcessedAudioArtifactKeyV1(domain: AvgAudioProcessingDomainV1, requirementKey: string) {
  avgEnum(domain, ['voice', 'sound'] as const, 'audio processing domain')
  return avgKey(`avg.${domain}.processed.${avgKey(requirementKey, 'audio requirement')}`, 'processed audio artifact')
}
export function avgAudioProcessingTaskKeyV1(domain: AvgAudioProcessingDomainV1, requirementKey: string) {
  avgEnum(domain, ['voice', 'sound'] as const, 'audio processing domain')
  return avgKey(`avg.${domain}.process.${avgKey(requirementKey, 'audio requirement')}`, 'audio processing task')
}
export function avgAudioProcessingGateIdV1(domain: AvgAudioProcessingDomainV1, requirementKey: string) {
  avgEnum(domain, ['voice', 'sound'] as const, 'audio processing domain')
  return avgKey(`avg.audio.processed.${domain}.${avgKey(requirementKey, 'audio requirement')}`, 'audio processing gate')
}

/** Deterministic target checking against the caller's already verified frozen
 * requirement catalogue. Does not trust author-supplied source/provenance tags.
 * OGG remains valid on the original sound path; the preserve-PCM recipe cannot
 * silently convert it or remove it from that catalogue. */
export function assertAvgAudioProcessingPlanTargetsV1(value: unknown, targets: ReadonlyArray<{
  domain: AvgAudioProcessingDomainV1; requirementKey: string; kind: AvgAudioPcmKindV1; mimeType: 'audio/wav' | 'audio/ogg'
}>) {
  const plan = parseAvgAudioProductionProcessingPlanV1(value)
  for (const e of plan.entries) {
    const matches = targets.filter(t => t.domain === e.domain && t.requirementKey === e.requirementKey)
    if (matches.length !== 1 || (matches[0].kind === 'voice') !== (e.domain === 'voice')) {
      throw new Error('[avg-audio-process] 加工需求缺失、重复或不属于准确配音/声音域')
    }
    if (matches[0].mimeType !== 'audio/wav') throw new Error('[avg-audio-process] PCM保持配方不能隐式转码OGG；请保留原音频或使用明确的后继转码合同')
  }
  return plan
}

/** Strict successor parsing stays separate from the original gain-only codec.
 * The recipe dispatcher is codec-only: it never imports a Worker or runtime. */
export function parseAvgAudioProductionProcessingPlanV2(value: unknown): AvgAudioProductionProcessingPlanV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'entries'], 'audio production processing plan V2')
  if (r.schema !== 'storyforge.avg.audio-production-processing-plan' || r.version !== 2) {
    throw new Error('[avg-audio-process] 后继音频加工方案版本无效')
  }
  const entries = avgUnique(avgList(r.entries, 'audio processing entries', value => {
    const e = avgRecord(value, ['domain', 'requirementKey', 'recipe'], 'audio processing entry')
    const domain = avgEnum(e.domain, ['voice', 'sound'] as const, 'audio processing domain')
    const requirementKey = avgKey(e.requirementKey, 'audio processing requirement')
    avgProcessedAudioArtifactKeyV1(domain, requirementKey)
    avgAudioProcessingTaskKeyV1(domain, requirementKey)
    avgAudioProcessingGateIdV1(domain, requirementKey)
    return { domain, requirementKey, recipe: parseAvgAudioProcessingRecipe(e.recipe) }
  }, 100), e => `${e.domain}:${e.requirementKey}`, 'audio processing entries')
  if (!entries.length || !entries.some(e => e.recipe.version === 2)) {
    throw new Error('[avg-audio-process] 后继加工方案须明确包含V2配方；空方案省略，全V1方案保留原版本')
  }
  return { schema: r.schema, version: 2, entries }
}

export function parseAvgAudioProductionProcessingPlan(value: unknown): AvgAudioProductionProcessingPlan {
  return (avgProtocolBody(value) as { version?: unknown } | null)?.version === 2
    ? parseAvgAudioProductionProcessingPlanV2(value) : parseAvgAudioProductionProcessingPlanV1(value)
}

/** A V2 resampler still consumes an exact original PCM WAV. It cannot grant
 * implicit OGG conversion or loosen the original frozen target catalogue. */
export function assertAvgAudioProcessingPlanTargets(value: unknown,
  targets: Parameters<typeof assertAvgAudioProcessingPlanTargetsV1>[1]): AvgAudioProductionProcessingPlan {
  if ((avgProtocolBody(value) as { version?: unknown } | null)?.version !== 2) {
    return assertAvgAudioProcessingPlanTargetsV1(value, targets)
  }
  const plan = parseAvgAudioProductionProcessingPlanV2(value)
  for (const e of plan.entries) {
    const matches = targets.filter(t => t.domain === e.domain && t.requirementKey === e.requirementKey)
    if (matches.length !== 1 || (matches[0].kind === 'voice') !== (e.domain === 'voice')) {
      throw new Error('[avg-audio-process] 加工需求缺失、重复或不属于准确配音/声音域')
    }
    if (matches[0].mimeType !== 'audio/wav') throw new Error('[avg-audio-process] PCM后继配方不能隐式转码OGG；请保留原音频或使用明确的后继转码合同')
  }
  return plan
}
