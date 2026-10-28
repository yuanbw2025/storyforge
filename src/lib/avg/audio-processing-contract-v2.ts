import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgAudioProcessingWaveObservationV1, type AvgAudioProcessingWaveObservationV1 } from './audio-processing-contract'

export const AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2 = 'storyforge.avg.pcm16-dynamics-resample.v2' as const
export interface AvgAudioProcessingRecipeV2 {
  schema: 'storyforge.avg.audio-processing-recipe'; version: 2
  gainMilliDb: number; maximumDurationMs: number
  sampleRatePolicy: 'preserve' | 'explicit'; targetSampleRateHz: number | null
  channelPolicy: 'preserve'; timelinePolicy: 'preserve'; overflowPolicy: 'reject'
  resampler: 'blackman-sinc64.v1'; processingOrder: 'resample-gain-linked-limit.v1'
  dynamics: null | { processor: 'linked-lookahead-peak-limit.v1'; ceilingMilliDbfs: number; lookaheadMs: number; releaseMs: number }
  declaration: string
}
export interface AvgAudioDynamicsObservationV2 { limitedFrameCount: number; maximumReductionMilliDb: number }
export interface AvgAudioProcessingReceiptV2 {
  schema: 'storyforge.avg.audio-processing-receipt'; version: 2
  processor: typeof AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2; recipeHash: string
  source: AvgAudioProcessingWaveObservationV1; output: AvgAudioProcessingWaveObservationV1
  quantization: 'pcm16-round-away-from-zero.v1'; dynamicsObservation: AvgAudioDynamicsObservationV2; receiptHash: string
}

export function parseAvgAudioProcessingRecipeV2(value: unknown): AvgAudioProcessingRecipeV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'gainMilliDb', 'maximumDurationMs', 'sampleRatePolicy',
    'targetSampleRateHz', 'channelPolicy', 'timelinePolicy', 'overflowPolicy', 'resampler', 'processingOrder', 'dynamics', 'declaration'], 'audio recipe V2')
  if (r.schema !== 'storyforge.avg.audio-processing-recipe' || r.version !== 2) throw new Error('[avg-audio-process] 加工配方V2版本无效')
  const sampleRatePolicy = avgEnum(r.sampleRatePolicy, ['preserve', 'explicit'] as const, 'audio rate policy')
  if (sampleRatePolicy === 'preserve' && r.targetSampleRateHz !== null) throw new Error('[avg-audio-process] 保持采样率不能夹带目标采样率')
  const targetSampleRateHz = sampleRatePolicy === 'preserve' ? null : avgNumber(r.targetSampleRateHz, 'audio target rate', 8000, 48000)
  let dynamics: AvgAudioProcessingRecipeV2['dynamics'] = null
  if (r.dynamics !== null) {
    const d = avgRecord(r.dynamics, ['processor', 'ceilingMilliDbfs', 'lookaheadMs', 'releaseMs'], 'linked peak limiter')
    dynamics = { processor: avgEnum(d.processor, ['linked-lookahead-peak-limit.v1'] as const, 'limiter processor'),
      ceilingMilliDbfs: avgNumber(d.ceilingMilliDbfs, 'sample peak ceiling', -24000, -1000),
      lookaheadMs: avgNumber(d.lookaheadMs, 'limiter lookahead', 1, 10), releaseMs: avgNumber(d.releaseMs, 'limiter release', 10, 1000) }
  }
  return { schema: r.schema, version: 2, gainMilliDb: avgNumber(r.gainMilliDb, 'audio gain', -60000, 24000),
    maximumDurationMs: avgNumber(r.maximumDurationMs, 'audio maximum duration', 1000, 120000), sampleRatePolicy, targetSampleRateHz,
    channelPolicy: avgEnum(r.channelPolicy, ['preserve'] as const, 'audio channels'),
    timelinePolicy: avgEnum(r.timelinePolicy, ['preserve'] as const, 'audio timeline'),
    overflowPolicy: avgEnum(r.overflowPolicy, ['reject'] as const, 'audio overflow'),
    resampler: avgEnum(r.resampler, ['blackman-sinc64.v1'] as const, 'audio resampler'),
    processingOrder: avgEnum(r.processingOrder, ['resample-gain-linked-limit.v1'] as const, 'audio processing order'),
    dynamics, declaration: avgText(r.declaration, 'audio processing declaration', 2000) }
}
export function parseAvgAudioDynamicsObservationV2(value: unknown, sampleCount: number): AvgAudioDynamicsObservationV2 {
  const r = avgRecord(value, ['limitedFrameCount', 'maximumReductionMilliDb'], 'audio dynamics observation')
  const limitedFrameCount = avgNumber(r.limitedFrameCount, 'limited frame count', 0, sampleCount)
  const maximumReductionMilliDb = avgNumber(r.maximumReductionMilliDb, 'maximum gain reduction', 0, 120000)
  if (!limitedFrameCount && maximumReductionMilliDb !== 0) throw new Error('[avg-audio-process] 动态观察的帧数与衰减不一致')
  return { limitedFrameCount, maximumReductionMilliDb }
}
export function parseAvgAudioProcessingReceiptV2(value: unknown): AvgAudioProcessingReceiptV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'processor', 'recipeHash', 'source', 'output',
    'quantization', 'dynamicsObservation', 'receiptHash'], 'audio receipt V2')
  if (r.schema !== 'storyforge.avg.audio-processing-receipt' || r.version !== 2 || r.processor !== AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2) {
    throw new Error('[avg-audio-process] 加工回执V2版本或处理器无效')
  }
  const source = parseAvgAudioProcessingWaveObservationV1(r.source), output = parseAvgAudioProcessingWaveObservationV1(r.output)
  if (source.kind !== output.kind || source.channelCount !== output.channelCount || Math.abs(source.durationMs - output.durationMs) > 1
    || output.dataOffset !== 44 || output.byteSize !== 44 + output.dataByteSize) throw new Error('[avg-audio-process] 加工V2必须保留声道和时间轴并输出准确PCM16 WAV')
  return { schema: r.schema, version: 2, processor: AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2,
    recipeHash: avgHash(r.recipeHash, 'audio recipe hash'), source, output,
    quantization: avgEnum(r.quantization, ['pcm16-round-away-from-zero.v1'] as const, 'audio quantization'),
    dynamicsObservation: parseAvgAudioDynamicsObservationV2(r.dynamicsObservation, output.sampleCount), receiptHash: avgHash(r.receiptHash, 'audio receipt hash') }
}
/** Hash/shape only. Real source/output samples and both producers are proved separately. */
export async function assertAvgAudioProcessingReceiptV2(recipeInput: AvgAudioProcessingRecipeV2, value: unknown) {
  const recipe = parseAvgAudioProcessingRecipeV2(recipeInput), receipt = parseAvgAudioProcessingReceiptV2(value)
  const { receiptHash, ...body } = receipt, rate = recipe.targetSampleRateHz ?? receipt.source.sampleRateHz
  if (receiptHash !== await hashProductProductionValueV2(body) || receipt.recipeHash !== await hashProductProductionValueV2(recipe)
    || receipt.output.sampleRateHz !== rate || receipt.output.sampleCount !== Math.round(receipt.source.sampleCount * rate / receipt.source.sampleRateHz)
    || receipt.source.sampleCount * 1000 > recipe.maximumDurationMs * receipt.source.sampleRateHz
    || receipt.output.sampleCount * 1000 > recipe.maximumDurationMs * rate
    || !recipe.dynamics && (receipt.dynamicsObservation.limitedFrameCount !== 0 || receipt.dynamicsObservation.maximumReductionMilliDb !== 0)
    || recipe.dynamics && receipt.output.samplePeakInteger > Math.floor(32768 * 10 ** (recipe.dynamics.ceilingMilliDbfs / 20000))) {
    throw new Error('[avg-audio-process] V2回执、冻结配方、真实帧数、时长或采样峰值不一致')
  }
  return receipt
}
