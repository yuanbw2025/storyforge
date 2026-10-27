import { sha256Text } from '../ai/chapter-memory/text-normalization'
import {
  avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique,
} from './protocol-validation'

/** Inert production input. A preset declaration is neither account capability
 * evidence nor author start/adoption authority. Services must verify both. */
export interface AvgVoicePresetV1 {
  presetKey: string
  revision: number
  adapterId: 'storyforge.avg.compatible-speech.v1'
  provider: string
  model: string
  voiceId: string
  locale: 'zh-CN'
  endpointRouteHash: string
  capabilityHash: string
  rights: { basis: 'provider-preset'; declaration: string; reference: string }
}

export interface AvgVoicePerformanceV1 {
  revision: number
  intent: string
  /** Advisory notes do not prove pronunciation or performance was achieved. */
  pronunciations: Array<{ phrase: string; reading: string }>
  /** Only the verified provider capability may authorize these wire options. */
  instructions: string | null
  speed: number | null
}

export interface AvgVoiceRequirementV1 {
  requirementKey: string
  assetKey: string
  sceneKey: string
  lineKey: string
  speakerKey: string | null
  locale: 'zh-CN'
  text: string
  textRevision: number
  textHash: string
  script: { artifactKey: string; version: number; contentHash: string }
  presetKey: string
  presetRevision: number
  performance: AvgVoicePerformanceV1
  /** An output acceptance ceiling, never an estimated or inferred duration. */
  maximumDurationMs: number
}

/** Single-line clips only. A later aligned-segment contract must not infer
 * word/line timing from text length or silently split this exact text. */
export interface AvgVoiceProductionBatchV1 {
  schema: 'storyforge.avg.voice-production-batch'
  version: 1
  sourceInputHash: string
  outputFormat: 'wav'
  presets: AvgVoicePresetV1[]
  requirements: AvgVoiceRequirementV1[]
}

function parsePreset(value: unknown): AvgVoicePresetV1 {
  const row = avgRecord(value, [
    'presetKey', 'revision', 'adapterId', 'provider', 'model', 'voiceId', 'locale',
    'endpointRouteHash', 'capabilityHash', 'rights',
  ], 'voice preset')
  const rights = avgRecord(row.rights, ['basis', 'declaration', 'reference'], 'voice rights')
  return {
    presetKey: avgKey(row.presetKey, 'presetKey'),
    revision: avgNumber(row.revision, 'preset.revision', 1, 1_000_000),
    adapterId: avgEnum(row.adapterId, ['storyforge.avg.compatible-speech.v1'] as const, 'voice adapter'),
    provider: avgKey(row.provider, 'voice.provider'),
    model: avgText(row.model, 'voice.model', 200),
    voiceId: avgText(row.voiceId, 'voice.voiceId', 200),
    locale: avgEnum(row.locale, ['zh-CN'] as const, 'voice.locale'),
    endpointRouteHash: avgHash(row.endpointRouteHash, 'voice.endpointRouteHash'),
    capabilityHash: avgHash(row.capabilityHash, 'voice.capabilityHash'),
    rights: {
      basis: avgEnum(rights.basis, ['provider-preset'] as const, 'voice.rights.basis'),
      declaration: avgText(rights.declaration, 'voice.rights.declaration', 4000),
      reference: avgText(rights.reference, 'voice.rights.reference', 2000),
    },
  }
}

function parseRequirement(value: unknown): AvgVoiceRequirementV1 {
  const row = avgRecord(value, [
    'requirementKey', 'assetKey', 'sceneKey', 'lineKey', 'speakerKey', 'locale', 'text',
    'textRevision', 'textHash', 'script', 'presetKey', 'presetRevision', 'performance', 'maximumDurationMs',
  ], 'voice requirement')
  const sceneKey = avgKey(row.sceneKey, 'voice.sceneKey')
  const script = avgRecord(row.script, ['artifactKey', 'version', 'contentHash'], 'voice script')
  const performance = avgRecord(row.performance, [
    'revision', 'intent', 'pronunciations', 'instructions', 'speed',
  ], 'voice performance')
  const text = avgText(row.text, 'voice.text', 10_000)
  const pronunciations = avgUnique(avgList(performance.pronunciations, 'voice.pronunciations', value => {
    const item = avgRecord(value, ['phrase', 'reading'], 'voice pronunciation')
    const phrase = avgText(item.phrase, 'pronunciation.phrase', 200)
    if (!text.includes(phrase)) throw new Error('[avg-voice] 读音词条没有出现在准确台词中')
    return { phrase, reading: avgText(item.reading, 'pronunciation.reading', 500) }
  }, 32), item => item.phrase, 'voice pronunciations')
  if (script.artifactKey !== `avg.content.scene-script.${sceneKey}`) {
    throw new Error('[avg-voice] 台词来源不是准确场景脚本')
  }
  const textRevision = avgNumber(row.textRevision, 'voice.textRevision', 1, 1_000_000)
  const scriptVersion = avgNumber(script.version, 'voice.script.version', 1, 1_000_000)
  if (textRevision !== scriptVersion) throw new Error('[avg-voice] 台词修订与规范脚本修订不一致')
  return {
    requirementKey: avgKey(row.requirementKey, 'voice.requirementKey'),
    assetKey: avgKey(row.assetKey, 'voice.assetKey'), sceneKey,
    lineKey: avgKey(row.lineKey, 'voice.lineKey'),
    speakerKey: row.speakerKey === null ? null : avgKey(row.speakerKey, 'voice.speakerKey'),
    locale: avgEnum(row.locale, ['zh-CN'] as const, 'voice.locale'),
    text, textRevision, textHash: avgHash(row.textHash, 'voice.textHash'),
    script: { artifactKey: script.artifactKey, version: scriptVersion, contentHash: avgHash(script.contentHash, 'voice.script.hash') },
    presetKey: avgKey(row.presetKey, 'voice.presetKey'),
    presetRevision: avgNumber(row.presetRevision, 'voice.presetRevision', 1, 1_000_000),
    performance: {
      revision: avgNumber(performance.revision, 'voice.performance.revision', 1, 1_000_000),
      intent: avgText(performance.intent, 'voice.performance.intent', 2000), pronunciations,
      instructions: performance.instructions === null ? null : avgText(performance.instructions, 'voice.instructions', 4000),
      speed: performance.speed === null ? null : avgNumber(performance.speed, 'voice.speed', 0.5, 2, false),
    },
    maximumDurationMs: avgNumber(row.maximumDurationMs, 'voice.maximumDurationMs', 1000, 120_000),
  }
}

export function parseAvgVoiceProductionBatchV1(value: unknown): AvgVoiceProductionBatchV1 {
  const row = avgRecord(avgProtocolBody(value), [
    'schema', 'version', 'sourceInputHash', 'outputFormat', 'presets', 'requirements',
  ], 'voice production batch')
  if (row.schema !== 'storyforge.avg.voice-production-batch' || row.version !== 1) {
    throw new Error('[avg-voice] 未登记的配音生产批次')
  }
  const presets = avgUnique(avgList(row.presets, 'voice.presets', parsePreset, 8), item => item.presetKey, 'voice presets')
  const requirements = avgUnique(avgList(row.requirements, 'voice.requirements', parseRequirement, 8), item => item.requirementKey, 'voice requirements')
  if (!presets.length || !requirements.length) throw new Error('[avg-voice] 配音批次不能为空；无配音时省略整个批次')
  avgUnique(requirements, item => item.assetKey, 'voice asset keys')
  avgUnique(requirements, item => item.lineKey, 'voice line consumers')
  const usedPresets = new Set<string>()
  for (const requirement of requirements) {
    const preset = presets.find(item => item.presetKey === requirement.presetKey)
    if (!preset || preset.revision !== requirement.presetRevision || preset.locale !== requirement.locale) {
      throw new Error('[avg-voice] 台词音色、版本或语言与冻结预设不一致')
    }
    usedPresets.add(preset.presetKey)
  }
  if (presets.some(item => !usedPresets.has(item.presetKey))) throw new Error('[avg-voice] 未使用音色不能扩大本批授权范围')
  return {
    schema: row.schema, version: 1,
    sourceInputHash: avgHash(row.sourceInputHash, 'voice.sourceInputHash'),
    outputFormat: avgEnum(row.outputFormat, ['wav'] as const, 'voice.outputFormat'), presets, requirements,
  }
}

/** Hash the exact canonical text; never use assistant Markdown cleanup,
 * clipping, whitespace normalization or inferred timing for production. */
export function hashAvgVoiceTextV1(text: string): Promise<string> {
  const exact = avgText(text, 'voice.text', 10_000)
  if (Array.from(exact).some(point => point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff)) {
    throw new Error('[avg-voice] 准确台词包含未配对 Unicode 代理项，不能替换字符后继续生产')
  }
  return sha256Text(exact)
}

export async function assertAvgVoiceProductionTextHashesV1(value: unknown): Promise<AvgVoiceProductionBatchV1> {
  const batch = parseAvgVoiceProductionBatchV1(value)
  for (const requirement of batch.requirements) {
    if (requirement.textHash !== await hashAvgVoiceTextV1(requirement.text)) {
      throw new Error('[avg-voice] 准确台词 hash 不一致；不得用旧音频覆盖新文本')
    }
  }
  return batch
}
