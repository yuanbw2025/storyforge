import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 } from './audio-gain-kernel'

export const AVG_AUDIO_PCM_GAIN_PROCESSOR_V1 = 'storyforge.avg.pcm16-gain.v1' as const
export const AVG_AUDIO_PCM_KINDS_V1 = ['voice', 'bgm', 'sfx', 'ambience'] as const
export type AvgAudioPcmKindV1 = typeof AVG_AUDIO_PCM_KINDS_V1[number]

/** A local processing proposal, never consent, producer proof or adoption.
 * The first processor preserves the exact PCM frame/rate/channel timeline.
 * Dynamics, resampling, trimming and loop editing need distinct recipes. */
export interface AvgAudioProcessingRecipeV1 {
  schema: 'storyforge.avg.audio-processing-recipe'
  version: 1
  gainMilliDb: number
  maximumDurationMs: number
  sampleRatePolicy: 'preserve'
  channelPolicy: 'preserve'
  timelinePolicy: 'preserve'
  overflowPolicy: 'reject'
  declaration: string
}

export interface AvgAudioProcessingWaveObservationV1 {
  contentHash: string
  pcmHash: string
  mimeType: 'audio/wav'
  kind: AvgAudioPcmKindV1
  byteSize: number
  channelCount: number
  sampleRateHz: number
  sampleCount: number
  durationMs: number
  dataOffset: number
  dataByteSize: number
  samplePeakInteger: number
  fullScaleSampleCount: number
}

export interface AvgAudioProcessingReceiptV1 {
  schema: 'storyforge.avg.audio-processing-receipt'
  version: 1
  processor: typeof AVG_AUDIO_PCM_GAIN_PROCESSOR_V1
  recipeHash: string
  source: AvgAudioProcessingWaveObservationV1
  output: AvgAudioProcessingWaveObservationV1
  quantization: 'pcm16-round-away-from-zero.v1'
  receiptHash: string
}

export function parseAvgAudioProcessingRecipeV1(value: unknown): AvgAudioProcessingRecipeV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'gainMilliDb', 'maximumDurationMs',
    'sampleRatePolicy', 'channelPolicy', 'timelinePolicy', 'overflowPolicy', 'declaration'], 'audio processing recipe')
  if (r.schema !== 'storyforge.avg.audio-processing-recipe' || r.version !== 1) throw new Error('[avg-audio-process] 加工配方版本无效')
  return { schema: r.schema, version: 1,
    gainMilliDb: avgNumber(r.gainMilliDb, 'audio gain milli-dB', AVG_AUDIO_GAIN_MIN_MILLI_DB_V1, AVG_AUDIO_GAIN_MAX_MILLI_DB_V1),
    maximumDurationMs: avgNumber(r.maximumDurationMs, 'audio maximum duration', 1000, 120_000),
    sampleRatePolicy: avgEnum(r.sampleRatePolicy, ['preserve'] as const, 'audio sample rate policy'),
    channelPolicy: avgEnum(r.channelPolicy, ['preserve'] as const, 'audio channel policy'),
    timelinePolicy: avgEnum(r.timelinePolicy, ['preserve'] as const, 'audio timeline policy'),
    overflowPolicy: avgEnum(r.overflowPolicy, ['reject'] as const, 'audio overflow policy'),
    declaration: avgText(r.declaration, 'audio processing declaration', 2000) }
}

export function parseAvgAudioProcessingWaveObservationV1(value: unknown): AvgAudioProcessingWaveObservationV1 {
  const r = avgRecord(value, ['contentHash', 'pcmHash', 'mimeType', 'kind', 'byteSize', 'channelCount', 'sampleRateHz',
    'sampleCount', 'durationMs', 'dataOffset', 'dataByteSize', 'samplePeakInteger', 'fullScaleSampleCount'], 'audio wave observation')
  const channelCount = avgNumber(r.channelCount, 'audio channels', 1, 2)
  const sampleRateHz = avgNumber(r.sampleRateHz, 'audio sample rate', 8000, 48_000)
  const sampleCount = avgNumber(r.sampleCount, 'audio frame count', 2, 48_000 * 120)
  const byteSize = avgNumber(r.byteSize, 'audio bytes', 44, 32 * 1024 * 1024)
  const dataOffset = avgNumber(r.dataOffset, 'audio PCM offset', 44, byteSize)
  const dataByteSize = avgNumber(r.dataByteSize, 'audio PCM size', 4, byteSize)
  const durationMs = avgNumber(r.durationMs, 'audio duration', 1, 120_000)
  const samplePeakInteger = avgNumber(r.samplePeakInteger, 'audio sample peak', 0, 32768)
  const fullScaleSampleCount = avgNumber(r.fullScaleSampleCount, 'audio full-scale samples', 0, sampleCount * channelCount)
  if (dataByteSize !== sampleCount * channelCount * 2 || dataOffset + dataByteSize > byteSize
    || durationMs !== Math.max(1, Math.round(sampleCount * 1000 / sampleRateHz))
    || sampleCount * 1000 > 120_000 * sampleRateHz
    || fullScaleSampleCount > 0 && samplePeakInteger < 32767
    || fullScaleSampleCount === 0 && samplePeakInteger >= 32767) {
    throw new Error('[avg-audio-process] PCM 帧数、时长、边界或峰值统计不闭合')
  }
  return { contentHash: avgHash(r.contentHash, 'audio content'), pcmHash: avgHash(r.pcmHash, 'audio PCM'),
    mimeType: avgEnum(r.mimeType, ['audio/wav'] as const, 'audio MIME'),
    kind: avgEnum(r.kind, AVG_AUDIO_PCM_KINDS_V1, 'audio kind'), byteSize, channelCount, sampleRateHz, sampleCount,
    durationMs, dataOffset, dataByteSize, samplePeakInteger, fullScaleSampleCount }
}

export function parseAvgAudioProcessingReceiptV1(value: unknown): AvgAudioProcessingReceiptV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'processor', 'recipeHash', 'source', 'output',
    'quantization', 'receiptHash'], 'audio processing receipt')
  if (r.schema !== 'storyforge.avg.audio-processing-receipt' || r.version !== 1 || r.processor !== AVG_AUDIO_PCM_GAIN_PROCESSOR_V1) {
    throw new Error('[avg-audio-process] 加工回执版本或处理器无效')
  }
  const source = parseAvgAudioProcessingWaveObservationV1(r.source), output = parseAvgAudioProcessingWaveObservationV1(r.output)
  for (const key of ['kind', 'byteSize', 'channelCount', 'sampleRateHz', 'sampleCount', 'durationMs', 'dataOffset', 'dataByteSize'] as const) {
    if (source[key] !== output[key]) throw new Error('[avg-audio-process] 增益配方不得改变格式、声道或台词时间轴')
  }
  return { schema: r.schema, version: 1, processor: AVG_AUDIO_PCM_GAIN_PROCESSOR_V1,
    recipeHash: avgHash(r.recipeHash, 'audio recipe'), source, output,
    quantization: avgEnum(r.quantization, ['pcm16-round-away-from-zero.v1'] as const, 'audio quantization'),
    receiptHash: avgHash(r.receiptHash, 'audio receipt') }
}

/** Hash/shape verification only. Actual owned bytes, original producer and
 * frozen task, author review/choice and adoption remain independent gates. */
export async function assertAvgAudioProcessingReceiptV1(recipeInput: AvgAudioProcessingRecipeV1, value: unknown) {
  const recipe = parseAvgAudioProcessingRecipeV1(recipeInput), receipt = parseAvgAudioProcessingReceiptV1(value)
  const { receiptHash, ...body } = receipt
  const expectedPeak = Math.trunc(receipt.source.samplePeakInteger * 10 ** (recipe.gainMilliDb / 20_000) + 0.5)
  if (receiptHash !== await hashProductProductionValueV2(body) || receipt.recipeHash !== await hashProductProductionValueV2(recipe)
    || receipt.source.sampleCount * 1000 > recipe.maximumDurationMs * receipt.source.sampleRateHz
    || receipt.output.samplePeakInteger !== expectedPeak
    || recipe.gainMilliDb === 0 && canonicalProductProductionJsonV2(receipt.source) !== canonicalProductProductionJsonV2(receipt.output)) {
    throw new Error('[avg-audio-process] 回执、准确配方、时长、峰值或零增益原件不一致')
  }
  return receipt
}
