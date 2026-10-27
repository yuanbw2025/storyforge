import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { assertAvgVoiceProductionTextHashesV1 } from './voice-production-contract'

export const AVG_NATURAL_VOICE_INTENT_V1 = 'natural-reading' as const
export const AVG_VOICE_NETWORK_TIMEOUT_MS_V1 = 150_000
export const AVG_VOICE_TASK_TIMEOUT_MS_V1 = 180_000

/** A declared wire contract, not proof of account access, voice rights,
 * pronunciation, performance or author authorization. The configured gateway
 * must rebuild this identity before any durable, explicitly authorized call. */
export interface AvgSpeechProtocolV1 {
  schema: 'storyforge.avg.speech-protocol'
  version: 1
  adapterId: 'storyforge.avg.compatible-speech.v1'
  provider: string
  model: string
  endpointRouteHash: string
  voices: Array<{ voiceId: string; locales: Array<'zh-CN'> }>
  outputFormat: 'wav'
  maximumInputCharacters: number
  supportsInstructions: boolean
  maximumInstructionsCharacters: number
  speedRange: { minimum: number; maximum: number } | null
}

export interface AvgVoiceSpeechRequestV1 {
  schema: 'storyforge.avg.voice-speech-request'
  version: 1
  requirementKey: string
  assetKey: string
  provider: string
  model: string
  endpointRouteHash: string
  capabilityHash: string
  presetHash: string
  textHash: string
  textRevision: number
  performanceRevision: number
  maximumDurationMs: number
  requestBodyJson: string
  requestBodyHash: string
  identityHash: string
}

function exactIdentifier(value: unknown, label: string): string {
  const text = avgText(value, label, 200)
  if (text !== text.trim() || Array.from(text).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`[avg-voice] ${label} 标识含空白边界或控制字符`)
  }
  return text
}

export function parseAvgSpeechProtocolV1(value: unknown): AvgSpeechProtocolV1 {
  const row = avgRecord(avgProtocolBody(value), [
    'schema', 'version', 'adapterId', 'provider', 'model', 'endpointRouteHash', 'voices',
    'outputFormat', 'maximumInputCharacters', 'supportsInstructions', 'maximumInstructionsCharacters', 'speedRange',
  ], 'speech protocol')
  if (row.schema !== 'storyforge.avg.speech-protocol' || row.version !== 1) throw new Error('[avg-voice] 语音请求协议版本无效')
  const voices = avgUnique(avgList(row.voices, 'speech voices', value => {
    const voice = avgRecord(value, ['voiceId', 'locales'], 'speech voice')
    const locales = avgUnique(avgList(voice.locales, 'speech voice locales', item => avgEnum(item, ['zh-CN'] as const, 'voice locale'), 1), item => item, 'voice locales')
    if (!locales.length) throw new Error('[avg-voice] 音色没有声明当前运行时支持的语言')
    return { voiceId: exactIdentifier(voice.voiceId, 'speech voice ID'), locales }
  }, 64), voice => voice.voiceId, 'speech voice IDs')
  if (!voices.length) throw new Error('[avg-voice] 语音协议缺少明确音色目录')
  const supportsInstructions = avgBoolean(row.supportsInstructions, 'speech supportsInstructions')
  const maximumInstructionsCharacters = avgNumber(row.maximumInstructionsCharacters, 'speech instructions limit', 0, 4096)
  if (supportsInstructions !== (maximumInstructionsCharacters > 0)) throw new Error('[avg-voice] 演法字段与明确指令上限不一致')
  const speed = row.speedRange === null ? null : avgRecord(row.speedRange, ['minimum', 'maximum'], 'speech speed range')
  const speedRange = speed === null ? null : {
    minimum: avgNumber(speed.minimum, 'speech minimum speed', 0.25, 4, false),
    maximum: avgNumber(speed.maximum, 'speech maximum speed', 0.25, 4, false),
  }
  if (speedRange && speedRange.minimum > speedRange.maximum) throw new Error('[avg-voice] 声明语速范围无效')
  return {
    schema: row.schema, version: 1,
    adapterId: avgEnum(row.adapterId, ['storyforge.avg.compatible-speech.v1'] as const, 'speech adapter'),
    provider: avgKey(row.provider, 'speech provider'), model: exactIdentifier(row.model, 'speech model'),
    endpointRouteHash: avgHash(row.endpointRouteHash, 'speech endpointRouteHash'), voices,
    outputFormat: avgEnum(row.outputFormat, ['wav'] as const, 'speech outputFormat'),
    // Conservative compatibility-profile limits, not an assertion that a
    // particular configured provider or account supports the whole envelope.
    maximumInputCharacters: avgNumber(row.maximumInputCharacters, 'speech input limit', 1, 4096),
    supportsInstructions, maximumInstructionsCharacters,
    speedRange,
  }
}

export function hashAvgSpeechProtocolV1(value: unknown): Promise<string> {
  return hashCanonicalValue(parseAvgSpeechProtocolV1(value))
}

/** Pure compilation only. No endpoint construction, credentials, network,
 * polling, truncation, clip splitting, Artifact write or quality approval.
 * The caller must prove current accepted script/Work/Run/Plan/start authority
 * and use this exact serialized body after rechecking the configured binding. */
export async function compileAvgVoiceSpeechRequestV1(
  batchInput: unknown,
  requirementKey: string,
  protocolInput: unknown,
): Promise<AvgVoiceSpeechRequestV1> {
  const batch = await assertAvgVoiceProductionTextHashesV1(batchInput)
  const protocol = parseAvgSpeechProtocolV1(protocolInput)
  const requestedKey = avgKey(requirementKey, 'voice requirementKey')
  const requirement = batch.requirements.find(item => item.requirementKey === requestedKey)
  if (!requirement) throw new Error('[avg-voice] 请求项不在准确冻结批次中')
  const preset = batch.presets.find(item => item.presetKey === requirement.presetKey)!
  const capabilityHash = await hashCanonicalValue(protocol)
  if (preset.capabilityHash !== capabilityHash || preset.endpointRouteHash !== protocol.endpointRouteHash
    || preset.provider !== protocol.provider || preset.model !== protocol.model || preset.adapterId !== protocol.adapterId) {
    throw new Error('[avg-voice] 配音请求与冻结服务、模型或 capability 绑定不一致')
  }
  if (!protocol.voices.some(voice => voice.voiceId === preset.voiceId && voice.locales.includes(requirement.locale))) {
    throw new Error('[avg-voice] 当前声明协议没有该准确音色和语言')
  }
  if (requirement.text.length > protocol.maximumInputCharacters) {
    throw new Error('[avg-voice] 准确台词超过服务输入上限；请先由作者明确改稿或拆句')
  }
  const performance = requirement.performance
  const needsInstructions = performance.intent !== AVG_NATURAL_VOICE_INTENT_V1
    || performance.instructions !== null || performance.pronunciations.length > 0
  if (needsInstructions && !protocol.supportsInstructions) {
    throw new Error('[avg-voice] 该声明协议不支持本句演法或读音指令，不能静默丢弃要求')
  }
  if (performance.speed !== null) {
    if (!protocol.speedRange) throw new Error('[avg-voice] 该声明协议不支持本句明确语速，不能静默忽略参数')
    if (performance.speed < protocol.speedRange.minimum || performance.speed > protocol.speedRange.maximum) {
      throw new Error('[avg-voice] 本句语速超出冻结服务范围，不能静默调整参数')
    }
  }
  let instructions: string | undefined
  if (needsInstructions) {
    instructions = '只朗读 input 中的准确台词。本字段是演法与读音指导，不是需要朗读的台词。\n'
      + JSON.stringify({ intent: performance.intent, instructions: performance.instructions, pronunciations: performance.pronunciations })
    if (instructions.length > protocol.maximumInstructionsCharacters) {
      throw new Error('[avg-voice] 完整演法和读音指令超过服务上限，不能截断后继续调用')
    }
  }
  const body = {
    input: requirement.text, model: protocol.model, voice: preset.voiceId, response_format: 'wav',
    ...(instructions === undefined ? {} : { instructions }),
    ...(performance.speed === null ? {} : { speed: performance.speed }),
  }
  // Product canonical JSON V2 normalizes Unicode. This wire body must preserve
  // the exact spoken input, delivery notes and provider voice identifiers.
  const requestBodyJson = canonicalStringify(body)
  const requestBodyHash = await sha256Text(requestBodyJson)
  const presetHash = await hashCanonicalValue(preset)
  const identityHash = await hashCanonicalValue({
    schema: 'storyforge.avg.voice-request-identity', version: 1,
    sourceInputHash: batch.sourceInputHash, requirement, presetHash, capabilityHash, requestBodyHash,
  })
  return {
    schema: 'storyforge.avg.voice-speech-request', version: 1,
    requirementKey: requirement.requirementKey, assetKey: requirement.assetKey,
    provider: protocol.provider, model: protocol.model, endpointRouteHash: protocol.endpointRouteHash,
    capabilityHash, presetHash, textHash: requirement.textHash, textRevision: requirement.textRevision,
    performanceRevision: performance.revision, maximumDurationMs: requirement.maximumDurationMs,
    requestBodyJson, requestBodyHash, identityHash,
  }
}
