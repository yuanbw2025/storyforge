import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { inspectAvgVoiceWaveV1 } from './voice-wave'
import { avgEnum, avgHash, avgRecord } from './protocol-validation'
import { executeAvgAudioGainPcmV1 } from './audio-gain-kernel'
import { runAvgAudioGainWorkerV1, AVG_AUDIO_WORKER_TIMEOUT_MS_V1 } from './audio-gain-worker-client'
import { AVG_AUDIO_PCM_GAIN_PROCESSOR_V1, AVG_AUDIO_PCM_KINDS_V1, assertAvgAudioProcessingReceiptV1,
  parseAvgAudioProcessingRecipeV1, parseAvgAudioProcessingWaveObservationV1,
  type AvgAudioPcmKindV1, type AvgAudioProcessingReceiptV1, type AvgAudioProcessingRecipeV1 } from './audio-processing-contract'

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Audio processing aborted', 'AbortError')
}

/** Pure byte inspection, without decoding/playback/producer or Work authority. */
export async function inspectAvgAudioProcessingWaveBytesV1(data: ArrayBuffer, kind: AvgAudioPcmKindV1, maximumDurationMs: number) {
  if (!(data instanceof ArrayBuffer) || data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-audio-process] 音频观察字节类型或上限无效')
  const snapshot = data.slice(0), wave = inspectAvgVoiceWaveV1(snapshot, maximumDurationMs)
  const pcm = snapshot.slice(wave.dataOffset, wave.dataOffset + wave.dataByteSize)
  const samples = new DataView(pcm)
  let samplePeakInteger = 0, fullScaleSampleCount = 0
  for (let index = 0; index < pcm.byteLength; index += 2) {
    const sample = samples.getInt16(index, true)
    samplePeakInteger = Math.max(samplePeakInteger, Math.abs(sample))
    if (sample === 32767 || sample === -32768) fullScaleSampleCount++
  }
  return parseAvgAudioProcessingWaveObservationV1({ contentHash: await sha256MediaData(snapshot), pcmHash: await sha256MediaData(pcm),
    mimeType: 'audio/wav', kind, byteSize: snapshot.byteLength, channelCount: wave.channelCount, sampleRateHz: wave.sampleRateHz,
    sampleCount: wave.sampleCount, durationMs: wave.durationMs, dataOffset: wave.dataOffset, dataByteSize: wave.dataByteSize,
    samplePeakInteger, fullScaleSampleCount })
}

export interface AvgAudioPcmWaveProcessingInputV1 { data: ArrayBuffer; source: {
  contentHash: string; mimeType: 'audio/wav'; kind: AvgAudioPcmKindV1
}; recipe: AvgAudioProcessingRecipeV1; signal?: AbortSignal }

/** Direct finite arithmetic for offline evaluation only; no durable write or
 * author authority. Formal execution must use the separate Worker boundary. */
export async function processAvgAudioPcmWaveV1(input: AvgAudioPcmWaveProcessingInputV1) {
  return processWave(input, async request => executeAvgAudioGainPcmV1(request))
}

/** One deadline covers preparation, Worker, verification and final receipt.
 * A late hash/result after abort cannot start work or deliver a candidate. */
export async function processAvgAudioPcmWaveWithWorkerV1(input: AvgAudioPcmWaveProcessingInputV1) {
  const signal = input.signal
  aborted(signal)
  if (typeof Worker !== 'function') throw new Error('[avg-audio-process] 当前浏览器不支持可中止的音频 Worker')
  const controller = new AbortController()
  return new Promise<Awaited<ReturnType<typeof processWave>>>((resolve, reject) => {
    let settled = false
    const finish = (error: unknown, result?: Awaited<ReturnType<typeof processWave>>) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (error) { controller.abort(); reject(error) } else resolve(result!)
    }
    const onAbort = () => finish(new DOMException('Audio processing aborted', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('[avg-audio-process] 音频加工总时限已到，原件保留')), AVG_AUDIO_WORKER_TIMEOUT_MS_V1)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void processWave({ ...input, signal: controller.signal }, async request => (await runAvgAudioGainWorkerV1(request)).pcm)
      .then(result => finish(null, result), error => finish(error))
  })
}

async function processWave(input: AvgAudioPcmWaveProcessingInputV1, execute: (input: { pcm: ArrayBuffer; channelCount: number;
  sampleCount: number; gainMilliDb: number; recipeHash: string; signal?: AbortSignal }) => Promise<ArrayBuffer>) {
  const signal = input.signal
  aborted(signal)
  const recipe = parseAvgAudioProcessingRecipeV1(input.recipe)
  const s = avgRecord(input.source, ['contentHash', 'mimeType', 'kind'], 'audio source')
  const expected = avgHash(s.contentHash, 'audio original content'), kind = avgEnum(s.kind, AVG_AUDIO_PCM_KINDS_V1, 'audio original kind')
  avgEnum(s.mimeType, ['audio/wav'] as const, 'audio original MIME')
  if (!(input.data instanceof ArrayBuffer) || input.data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-audio-process] 原音频字节类型或上限无效')
  // Capture the exact input before the first await; never modify caller bytes.
  const original = input.data.slice(0), source = await inspectAvgAudioProcessingWaveBytesV1(original, kind, recipe.maximumDurationMs)
  if (source.contentHash !== expected) throw new Error('[avg-audio-process] 原音频字节 hash 不符')
  aborted(signal)
  const recipeHash = await hashProductProductionValueV2(recipe)
  aborted(signal)
  const pcm = await execute({ pcm: original.slice(source.dataOffset, source.dataOffset + source.dataByteSize), channelCount: source.channelCount,
    sampleCount: source.sampleCount, gainMilliDb: recipe.gainMilliDb, recipeHash, signal })
  if (!(pcm instanceof ArrayBuffer) || pcm.byteLength !== source.dataByteSize) throw new Error('[avg-audio-process] 处理器改变了实际 PCM 帧数')
  const output = original.slice(0); new Uint8Array(output, source.dataOffset, source.dataByteSize).set(new Uint8Array(pcm))
  aborted(signal)
  const observation = await inspectAvgAudioProcessingWaveBytesV1(output, kind, recipe.maximumDurationMs)
  const body: Omit<AvgAudioProcessingReceiptV1, 'receiptHash'> = { schema: 'storyforge.avg.audio-processing-receipt', version: 1,
    processor: AVG_AUDIO_PCM_GAIN_PROCESSOR_V1, recipeHash,
    source, output: observation, quantization: 'pcm16-round-away-from-zero.v1' }
  const receipt = await assertAvgAudioProcessingReceiptV1(recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
  aborted(signal)
  return { data: output, receipt }
}

/** Physical bytes only, after the caller proves a real task/producer. This
 * does not rerun gain or manufacture processing/author authority. */
export async function assertAvgAudioProcessingWaveBytesV1(input: { source: ArrayBuffer; output: ArrayBuffer;
  recipe: AvgAudioProcessingRecipeV1; receipt: AvgAudioProcessingReceiptV1 }) {
  const source = input.source.slice(0), output = input.output.slice(0)
  const recipe = parseAvgAudioProcessingRecipeV1(input.recipe), receipt = await assertAvgAudioProcessingReceiptV1(recipe, input.receipt)
  const before = await inspectAvgAudioProcessingWaveBytesV1(source, receipt.source.kind, recipe.maximumDurationMs)
  const after = await inspectAvgAudioProcessingWaveBytesV1(output, receipt.output.kind, recipe.maximumDurationMs)
  if (canonicalProductProductionJsonV2(before) !== canonicalProductProductionJsonV2(receipt.source)
    || canonicalProductProductionJsonV2(after) !== canonicalProductProductionJsonV2(receipt.output)) throw new Error('[avg-audio-process] 实际原件或加工字节与回执不符')
  const raw = new Uint8Array(source), derived = new Uint8Array(output), end = before.dataOffset + before.dataByteSize
  for (let index = 0; index < raw.length; index++) {
    if ((index < before.dataOffset || index >= end) && raw[index] !== derived[index]) throw new Error('[avg-audio-process] 加工改变了原容器或非 PCM 元数据')
  }
  return { source: before, output: after, receipt }
}
