import { assertMotionDramaTargetSpecV1 } from '../adaptation/contracts'
import type { MotionDramaPromptPackMaturityV1, MotionDramaProviderTargetV1, MotionDramaTargetSpecV1 } from '../types'

const PROVIDERS = new Set<MotionDramaProviderTargetV1>(['seedance', 'runway', 'ltx', 'generic'])
const HASH = /^[a-f0-9]{64}$/i
const HANDOFF_STRATEGIES = new Set(['independent-start', 'independent-cut', 'match-cut', 'tail-frame-chain'])

export interface MotionDramaPromptPackReferenceV1 {
  alias: string
  kind: 'subject' | 'frame'
  stableKey: string
  role: string
  subjectKey: string | null
  contentHash: string | null
  mimeType: string | null
}

export interface MotionDramaPromptPackShotV1 {
  shotKey: string
  durationSeconds: number
  imagePrompt: string
  negativeImagePrompt: string
  firstFramePrompt: string
  keyFramePrompt: string
  lastFramePrompt: string
  videoPrompt: string
  negativeVideoPrompt: string
  providerPrompt: string
  referenceAliases: string[]
  dialogue: string
  narration: string
  sound: string[]
}

/** Legacy manifest retained so immutable releases and portable backups remain readable. */
export interface MotionDramaPromptPackManifestV1 {
  schema: 'storyforge.motion-drama-prompt-pack'
  version: 1
  provider: MotionDramaProviderTargetV1
  episodeNumber: number
  maturity: MotionDramaPromptPackMaturityV1
  target: MotionDramaTargetSpecV1
  providerNotes: string[]
  references: MotionDramaPromptPackReferenceV1[]
  shots: MotionDramaPromptPackShotV1[]
  createdAt: number
}

export interface MotionDramaProviderInputV2 {
  slot: string
  uploadOrder: number
  referenceAlias: string
  mediaType: 'image' | 'audio'
  purpose: string
  ready: boolean
}

export interface MotionDramaContinuityHandoffV2 {
  strategy: 'independent-start' | 'independent-cut' | 'match-cut' | 'tail-frame-chain'
  previousShotKey: string | null
  nextShotKey: string | null
  transition: string
  previousEndState: string
  currentStartState: string
  lockedSubjectKeys: string[]
  positionAndGazeLock: string
  motionHandoff: string
  lightingAndPaletteLock: string
  allowedChanges: string[]
  operatorInstruction: string
}

export interface MotionDramaPromptPackManifestV2 {
  schema: 'storyforge.motion-drama-prompt-pack'
  version: 2
  provider: MotionDramaProviderTargetV1
  episodeNumber: number
  maturity: MotionDramaPromptPackMaturityV1
  directUseReady: boolean
  target: MotionDramaTargetSpecV1
  providerProfile: {
    id: string
    label: string
    verifiedAt: string
    limits: { maxDurationSeconds: number | null; maxImages: number | null; maxVideos: number | null; maxAudios: number | null }
    supportsTailContinuation: boolean
    sourceUrl: string | null
  }
  executionPlan: {
    generationUnit: 'one-shot-per-generation'
    assemblyOrder: string[]
    defaultCandidateCount: number
    heroShotCandidateCount: number
    selectBeforeNextShot: true
    operatorChecklist: string[]
  }
  providerNotes: string[]
  references: MotionDramaPromptPackReferenceV1[]
  shots: Array<MotionDramaPromptPackShotV1 & {
    directUseReady: boolean
    providerInputs: MotionDramaProviderInputV2[]
    continuity: MotionDramaContinuityHandoffV2
    generation: {
      mode: 'multimodal-reference' | 'image-to-video' | 'text-to-video'
      durationSeconds: number
      aspectRatio: MotionDramaTargetSpecV1['aspectRatio']
      candidateCount: number
      selectionChecks: string[]
    }
    retryPrompts: { identityDrift: string; motionFailure: string; continuityFailure: string }
  }>
  createdAt: number
}

export type MotionDramaPromptPackManifest = MotionDramaPromptPackManifestV1 | MotionDramaPromptPackManifestV2

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[motion-drama-pack] ${label} 必须是对象`)
  return value as Record<string, any>
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function validTextArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonEmpty) && new Set(value).size === value.length
}

function validateBase(manifest: Record<string, any>, version: 1 | 2): { aliases: Set<string>; shotKeys: Set<string> } {
  if (manifest.schema !== 'storyforge.motion-drama-prompt-pack' || manifest.version !== version || !PROVIDERS.has(manifest.provider)) throw new Error('[motion-drama-pack] manifest 身份无效')
  if (!Number.isInteger(manifest.episodeNumber) || manifest.episodeNumber < 1 || !['prompt-only', 'reference-ready'].includes(manifest.maturity)) throw new Error('[motion-drama-pack] 集数或成熟度无效')
  assertMotionDramaTargetSpecV1(manifest.target)
  if (!validTextArray(manifest.providerNotes)) throw new Error('[motion-drama-pack] providerNotes 无效')
  if (!Array.isArray(manifest.references) || !Array.isArray(manifest.shots) || !manifest.shots.length) throw new Error('[motion-drama-pack] references/shots 无效')

  const aliases = new Set<string>(); const stableKeys = new Set<string>()
  for (const item of manifest.references) {
    const ref = object(item, 'reference')
    if (!nonEmpty(ref.alias) || !['subject', 'frame'].includes(ref.kind) || !nonEmpty(ref.stableKey) || !nonEmpty(ref.role)
      || ref.subjectKey !== null && !nonEmpty(ref.subjectKey) || ref.contentHash !== null && !HASH.test(String(ref.contentHash))
      || ref.mimeType !== null && !nonEmpty(ref.mimeType) || (ref.contentHash === null) !== (ref.mimeType === null)
      || aliases.has(ref.alias) || stableKeys.has(ref.stableKey)) throw new Error('[motion-drama-pack] reference 身份、hash 或 MIME 无效')
    if (ref.mimeType && (ref.kind === 'frame' || !['voice', 'sound'].includes(ref.role) ? !ref.mimeType.startsWith('image/') : !ref.mimeType.startsWith('audio/'))) throw new Error('[motion-drama-pack] reference 媒资类型与角色不匹配')
    aliases.add(ref.alias); stableKeys.add(ref.stableKey)
  }

  const shotKeys = new Set<string>()
  for (const item of manifest.shots) {
    const shot = object(item, 'shot')
    if (!nonEmpty(shot.shotKey) || shotKeys.has(shot.shotKey) || !Number.isInteger(shot.durationSeconds) || shot.durationSeconds < 1 || shot.durationSeconds > 600) throw new Error('[motion-drama-pack] shot 身份或时长无效')
    for (const field of ['imagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt', 'videoPrompt', 'providerPrompt'] as const) if (!nonEmpty(shot[field])) throw new Error(`[motion-drama-pack] shot.${field} 不能为空`)
    for (const field of ['negativeImagePrompt', 'negativeVideoPrompt', 'dialogue', 'narration'] as const) if (typeof shot[field] !== 'string') throw new Error(`[motion-drama-pack] shot.${field} 必须是字符串`)
    if (!validTextArray(shot.referenceAliases) || shot.referenceAliases.some((alias: string) => !aliases.has(alias))) throw new Error('[motion-drama-pack] shot referenceAliases 未闭合')
    if (!validTextArray(shot.sound)) throw new Error('[motion-drama-pack] shot.sound 无效')
    shotKeys.add(shot.shotKey)
  }
  if (!Number.isInteger(manifest.createdAt) || manifest.createdAt < 1) throw new Error('[motion-drama-pack] createdAt 无效')
  return { aliases, shotKeys }
}

/** Pure, closed-reference validation for immutable v1 manifests. */
export function assertMotionDramaPromptPackManifestV1(value: unknown): asserts value is MotionDramaPromptPackManifestV1 {
  validateBase(object(value, 'manifest'), 1)
}

/** Pure, closed-reference validation for executable provider packs. */
export function assertMotionDramaPromptPackManifestV2(value: unknown): asserts value is MotionDramaPromptPackManifestV2 {
  const manifest = object(value, 'manifest')
  const { aliases, shotKeys } = validateBase(manifest, 2)
  if (typeof manifest.directUseReady !== 'boolean') throw new Error('[motion-drama-pack] directUseReady 无效')
  const profile = object(manifest.providerProfile, 'providerProfile'); const limits = object(profile.limits, 'providerProfile.limits')
  if (![profile.id, profile.label, profile.verifiedAt].every(nonEmpty) || profile.sourceUrl !== null && !nonEmpty(profile.sourceUrl) || typeof profile.supportsTailContinuation !== 'boolean') throw new Error('[motion-drama-pack] providerProfile 无效')
  for (const field of ['maxDurationSeconds', 'maxImages', 'maxVideos', 'maxAudios'] as const) if (limits[field] !== null && (!Number.isInteger(limits[field]) || limits[field] < 0)) throw new Error('[motion-drama-pack] providerProfile.limits 无效')
  const plan = object(manifest.executionPlan, 'executionPlan')
  if (plan.generationUnit !== 'one-shot-per-generation' || plan.selectBeforeNextShot !== true || !Number.isInteger(plan.defaultCandidateCount) || plan.defaultCandidateCount < 1 || !Number.isInteger(plan.heroShotCandidateCount) || plan.heroShotCandidateCount < plan.defaultCandidateCount || !validTextArray(plan.operatorChecklist, false)
    || !Array.isArray(plan.assemblyOrder) || plan.assemblyOrder.length !== shotKeys.size || new Set(plan.assemblyOrder).size !== plan.assemblyOrder.length || plan.assemblyOrder.some((key: unknown) => !nonEmpty(key) || !shotKeys.has(key))) throw new Error('[motion-drama-pack] executionPlan 无效')

  for (const item of manifest.shots) {
    const shot = object(item, 'shot-v2')
    if (typeof shot.directUseReady !== 'boolean' || !Array.isArray(shot.providerInputs)) throw new Error('[motion-drama-pack] shot 执行状态无效')
    const slots = new Set<string>(); const orders = new Set<number>()
    for (const itemInput of shot.providerInputs) {
      const input = object(itemInput, 'providerInput')
      if (!nonEmpty(input.slot) || !Number.isInteger(input.uploadOrder) || input.uploadOrder < 1 || !nonEmpty(input.referenceAlias) || !aliases.has(input.referenceAlias) || !['image', 'audio'].includes(input.mediaType) || !nonEmpty(input.purpose) || typeof input.ready !== 'boolean' || slots.has(input.slot) || orders.has(input.uploadOrder)) throw new Error('[motion-drama-pack] providerInput 无效')
      slots.add(input.slot); orders.add(input.uploadOrder)
    }
    const continuity = object(shot.continuity, 'continuity')
    if (!HANDOFF_STRATEGIES.has(continuity.strategy) || continuity.previousShotKey !== null && (!nonEmpty(continuity.previousShotKey) || !shotKeys.has(continuity.previousShotKey)) || continuity.nextShotKey !== null && (!nonEmpty(continuity.nextShotKey) || !shotKeys.has(continuity.nextShotKey))
      || ![continuity.transition, continuity.previousEndState, continuity.currentStartState, continuity.positionAndGazeLock, continuity.motionHandoff, continuity.lightingAndPaletteLock, continuity.operatorInstruction].every((item: unknown) => typeof item === 'string')
      || !validTextArray(continuity.lockedSubjectKeys) || !validTextArray(continuity.allowedChanges)) throw new Error('[motion-drama-pack] continuity 无效')
    const generation = object(shot.generation, 'generation')
    if (!['multimodal-reference', 'image-to-video', 'text-to-video'].includes(generation.mode) || generation.durationSeconds !== shot.durationSeconds || !['9:16', '16:9', '1:1'].includes(generation.aspectRatio) || !Number.isInteger(generation.candidateCount) || generation.candidateCount < 1 || !validTextArray(generation.selectionChecks, false)) throw new Error('[motion-drama-pack] generation 无效')
    const retry = object(shot.retryPrompts, 'retryPrompts')
    if (![retry.identityDrift, retry.motionFailure, retry.continuityFailure].every(nonEmpty)) throw new Error('[motion-drama-pack] retryPrompts 无效')
    const imageCount = shot.providerInputs.filter((input: MotionDramaProviderInputV2) => input.mediaType === 'image').length
    const audioCount = shot.providerInputs.filter((input: MotionDramaProviderInputV2) => input.mediaType === 'audio').length
    if (limits.maxDurationSeconds !== null && shot.durationSeconds > limits.maxDurationSeconds || limits.maxImages !== null && imageCount > limits.maxImages || limits.maxAudios !== null && audioCount > limits.maxAudios) throw new Error('[motion-drama-pack] shot 超出 providerProfile 能力')
    if (shot.directUseReady && (!shot.providerInputs.length || shot.providerInputs.some((input: MotionDramaProviderInputV2) => !input.ready))) throw new Error('[motion-drama-pack] shot directUseReady 与物料状态矛盾')
  }
  if (manifest.directUseReady !== manifest.shots.every((shot: any) => shot.directUseReady)) throw new Error('[motion-drama-pack] manifest directUseReady 与镜头状态矛盾')
}

export function assertMotionDramaPromptPackManifest(value: unknown): asserts value is MotionDramaPromptPackManifest {
  const version = object(value, 'manifest').version
  if (version === 1) assertMotionDramaPromptPackManifestV1(value)
  else if (version === 2) assertMotionDramaPromptPackManifestV2(value)
  else throw new Error('[motion-drama-pack] 不支持的 manifest 版本')
}
