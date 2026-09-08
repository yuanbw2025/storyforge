import { assertMotionDramaTargetSpecV1 } from '../adaptation/contracts'
import type { MotionDramaPromptPackMaturityV1, MotionDramaProviderTargetV1, MotionDramaTargetSpecV1 } from '../types'

const PROVIDERS = new Set<MotionDramaProviderTargetV1>(['seedance', 'runway', 'ltx', 'generic'])
const HASH = /^[a-f0-9]{64}$/i

export interface MotionDramaPromptPackManifestV1 {
  schema: 'storyforge.motion-drama-prompt-pack'
  version: 1
  provider: MotionDramaProviderTargetV1
  episodeNumber: number
  maturity: MotionDramaPromptPackMaturityV1
  target: MotionDramaTargetSpecV1
  providerNotes: string[]
  references: Array<{ alias: string; kind: 'subject' | 'frame'; stableKey: string; role: string; subjectKey: string | null; contentHash: string | null; mimeType: string | null }>
  shots: Array<{
    shotKey: string; durationSeconds: number; imagePrompt: string; negativeImagePrompt: string
    firstFramePrompt: string; keyFramePrompt: string; lastFramePrompt: string
    videoPrompt: string; negativeVideoPrompt: string; providerPrompt: string
    referenceAliases: string[]; dialogue: string; narration: string; sound: string[]
  }>
  createdAt: number
}

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[motion-drama-pack] ${label} 必须是对象`)
  return value as Record<string, any>
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

/** Pure, closed-reference validation shared by runtime, release and portable import. */
export function assertMotionDramaPromptPackManifestV1(value: unknown): asserts value is MotionDramaPromptPackManifestV1 {
  const manifest = object(value, 'manifest')
  if (manifest.schema !== 'storyforge.motion-drama-prompt-pack' || manifest.version !== 1 || !PROVIDERS.has(manifest.provider)) throw new Error('[motion-drama-pack] manifest 身份无效')
  if (!Number.isInteger(manifest.episodeNumber) || manifest.episodeNumber < 1 || !['prompt-only', 'reference-ready'].includes(manifest.maturity)) throw new Error('[motion-drama-pack] 集数或成熟度无效')
  assertMotionDramaTargetSpecV1(manifest.target)
  if (!Array.isArray(manifest.providerNotes) || manifest.providerNotes.some((item: unknown) => !nonEmpty(item))) throw new Error('[motion-drama-pack] providerNotes 无效')
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
    if (!Array.isArray(shot.referenceAliases) || new Set(shot.referenceAliases).size !== shot.referenceAliases.length || shot.referenceAliases.some((alias: unknown) => !nonEmpty(alias) || !aliases.has(alias))) throw new Error('[motion-drama-pack] shot referenceAliases 未闭合')
    if (!Array.isArray(shot.sound) || shot.sound.some((cue: unknown) => !nonEmpty(cue))) throw new Error('[motion-drama-pack] shot.sound 无效')
    shotKeys.add(shot.shotKey)
  }
  if (!Number.isInteger(manifest.createdAt) || manifest.createdAt < 1) throw new Error('[motion-drama-pack] createdAt 无效')
}
