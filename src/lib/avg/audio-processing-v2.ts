import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgRecord } from './protocol-validation'
import { AVG_AUDIO_PCM_KINDS_V1, type AvgAudioPcmKindV1 } from './audio-processing-contract'
import { inspectAvgAudioProcessingWaveBytesV1 } from './audio-processing'
import { parseAvgAudioProcessingRecipeV2, parseAvgAudioProcessingReceiptV2, assertAvgAudioProcessingReceiptV2,
  AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2, type AvgAudioProcessingRecipeV2, type AvgAudioProcessingReceiptV2 } from './audio-processing-contract-v2'
import { executeAvgAudioDspPcmV2, planAvgAudioDspLayoutV2 } from './audio-dsp-kernel-v2'
import { runAvgAudioDspWorkersV2, verifyAvgAudioDspWithWorkerV2, withAvgAudioDspDeadlineV2, assertAvgAudioDspActiveV2 } from './audio-dsp-worker-client-v2'

export interface AvgAudioPcmWaveProcessingInputV2 { data: ArrayBuffer; source: {
  contentHash: string; mimeType: 'audio/wav'; kind: AvgAudioPcmKindV1
}; recipe: AvgAudioProcessingRecipeV2; signal?: AbortSignal }

export function encodeAvgAudioCanonicalWaveV2(pcm: ArrayBuffer, channelCount: number, sampleRateHz: number) {
  if (!(pcm instanceof ArrayBuffer) || ![1, 2].includes(channelCount) || pcm.byteLength % (channelCount * 2)
    || pcm.byteLength < channelCount * 4 || pcm.byteLength + 44 > 32 * 1024 * 1024
    || !Number.isInteger(sampleRateHz) || sampleRateHz < 8000 || sampleRateHz > 48000) throw new Error('[avg-audio-process] V2 WAV输出布局无效')
  const bytes = new Uint8Array(44 + pcm.byteLength), view = new DataView(bytes.buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index)
  }
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRateHz, true)
  view.setUint32(28, sampleRateHz * channelCount * 2, true); view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true); view.setUint32(40, pcm.byteLength, true)
  bytes.set(new Uint8Array(pcm), 44)
  return bytes.buffer
}

async function process(input: AvgAudioPcmWaveProcessingInputV2, worker: boolean) {
  const recipe = parseAvgAudioProcessingRecipeV2(input.recipe), sourceInput = avgRecord(input.source, ['contentHash', 'mimeType', 'kind'], 'V2 source')
  const expected = avgHash(sourceInput.contentHash, 'audio source hash'), kind = avgEnum(sourceInput.kind, AVG_AUDIO_PCM_KINDS_V1, 'audio source kind')
  avgEnum(sourceInput.mimeType, ['audio/wav'] as const, 'audio source MIME')
  const maximumBytes = (kind === 'voice' ? 32 : 8) * 1024 * 1024
  if (!(input.data instanceof ArrayBuffer) || input.data.byteLength > maximumBytes) throw new Error('[avg-audio-process] V2原音频超出准确配音或声音物理字节上限')
  const original = input.data.slice(0), signal = input.signal
  const execute = async (active?: AbortSignal) => {
    assertAvgAudioDspActiveV2(active)
    const source = await inspectAvgAudioProcessingWaveBytesV1(original, kind, recipe.maximumDurationMs)
    if (source.contentHash !== expected) throw new Error('[avg-audio-process] V2真实原件hash不一致')
    assertAvgAudioDspActiveV2(active)
    const request = { pcm: original.slice(source.dataOffset, source.dataOffset + source.dataByteSize),
      channelCount: source.channelCount, sampleCount: source.sampleCount, sourceSampleRateHz: source.sampleRateHz, recipe }
    const outputFrames = Math.round(source.sampleCount * (recipe.targetSampleRateHz ?? source.sampleRateHz) / source.sampleRateHz)
    if (44 + outputFrames * source.channelCount * 2 > maximumBytes) throw new Error('[avg-audio-process] V2衍生WAV超出准确配音或声音物理字节上限，不能启动Worker')
    planAvgAudioDspLayoutV2(request)
    const computed = worker ? await runAvgAudioDspWorkersV2({ ...request, signal: active }) : executeAvgAudioDspPcmV2(request)
    assertAvgAudioDspActiveV2(active)
    const data = encodeAvgAudioCanonicalWaveV2(computed.pcm, computed.channelCount, computed.sampleRateHz)
    const output = await inspectAvgAudioProcessingWaveBytesV1(data, kind, recipe.maximumDurationMs)
    assertAvgAudioDspActiveV2(active)
    const body: Omit<AvgAudioProcessingReceiptV2, 'receiptHash'> = { schema: 'storyforge.avg.audio-processing-receipt', version: 2,
      processor: AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe), source, output,
      quantization: 'pcm16-round-away-from-zero.v1', dynamicsObservation: computed.dynamicsObservation }
    const receipt = await assertAvgAudioProcessingReceiptV2(recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
    assertAvgAudioDspActiveV2(active)
    return { data, receipt }
  }
  return worker ? withAvgAudioDspDeadlineV2(signal, execute) : execute(signal)
}
/** Explicit finite offline numeric evaluation only; not the formal producer. */
export function processAvgAudioPcmWaveV2(input: AvgAudioPcmWaveProcessingInputV2) { return process(input, false) }
/** Full preparation/compute/independent verification share one 20 s boundary. */
export function processAvgAudioPcmWaveWithWorkerV2(input: AvgAudioPcmWaveProcessingInputV2) { return process(input, true) }

/** Physical source/output inspection and full independent Worker recomputation.
 * Host checks hashes, layout and the canonical header, never reruns the DSP. */
export async function assertAvgAudioProcessingWaveBytesV2(input: { source: ArrayBuffer; output: ArrayBuffer;
  recipe: AvgAudioProcessingRecipeV2; receipt: AvgAudioProcessingReceiptV2; signal?: AbortSignal }) {
  const recipe = parseAvgAudioProcessingRecipeV2(input.recipe), captured = parseAvgAudioProcessingReceiptV2(input.receipt)
  const maximumBytes = (captured.source.kind === 'voice' ? 32 : 8) * 1024 * 1024
  if (!(input.source instanceof ArrayBuffer) || !(input.output instanceof ArrayBuffer)
    || input.source.byteLength > maximumBytes || input.output.byteLength > maximumBytes) throw new Error('[avg-audio-process] V2实际字节超出准确配音或声音物理上限')
  const source = input.source.slice(0), output = input.output.slice(0)
  return withAvgAudioDspDeadlineV2(input.signal, async signal => {
    const receipt = await assertAvgAudioProcessingReceiptV2(recipe, captured)
    assertAvgAudioDspActiveV2(signal)
    const [before, after] = await Promise.all([inspectAvgAudioProcessingWaveBytesV1(source, receipt.source.kind, recipe.maximumDurationMs),
      inspectAvgAudioProcessingWaveBytesV1(output, receipt.output.kind, recipe.maximumDurationMs)])
    const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
    if (!same(before, receipt.source) || !same(after, receipt.output)) throw new Error('[avg-audio-process] V2实际原件或输出与回执不符')
    const pcm = output.slice(after.dataOffset, after.dataOffset + after.dataByteSize)
    const header = new Uint8Array(encodeAvgAudioCanonicalWaveV2(pcm, after.channelCount, after.sampleRateHz), 0, 44)
    const actualHeader = new Uint8Array(output, 0, 44)
    if (header.some((value, index) => value !== actualHeader[index])) throw new Error('[avg-audio-process] V2输出不是准确规范WAV')
    assertAvgAudioDspActiveV2(signal)
    await verifyAvgAudioDspWithWorkerV2({ pcm: source.slice(before.dataOffset, before.dataOffset + before.dataByteSize),
      channelCount: before.channelCount, sampleCount: before.sampleCount, sourceSampleRateHz: before.sampleRateHz, recipe, signal,
      output: { pcm, channelCount: after.channelCount, sampleCount: after.sampleCount, sampleRateHz: after.sampleRateHz,
        dynamicsObservation: receipt.dynamicsObservation } })
    assertAvgAudioDspActiveV2(signal)
    return { source: before, output: after, receipt }
  })
}
