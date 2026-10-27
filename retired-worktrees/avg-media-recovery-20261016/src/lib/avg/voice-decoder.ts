import { sha256MediaData } from '../product-production/media-blob-store'
import { verifyProductMediaRuntimeUrlsV1 } from '../product-production/media-runtime-verifier'
import { avgHash, avgKey, avgNumber } from './protocol-validation'
import { AVG_VOICE_DECODER_V1, inspectAvgVoiceWaveV1, type AvgVoiceByteMeasurementV1 } from './voice-wave'
export { AVG_VOICE_DECODER_V1, type AvgVoiceByteMeasurementV1 } from './voice-wave'

const cancelled = () => new DOMException('AVG voice inspection aborted', 'AbortError')

/** No provider, persistence, playback, semantic transcription or author pass.
 * Hash the copied bytes, preflight bounded PCM, then reuse the actual browser
 * decoder/analyzer used by imports and release probes. Late decode results
 * cannot turn a cancelled operation into a candidate.
 */
export async function inspectAvgVoiceBytesV1(input: {
  data: ArrayBuffer; assetKey: string; contentHash: string; maximumDurationMs: number; signal?: AbortSignal
}): Promise<{ data: ArrayBuffer; measurement: AvgVoiceByteMeasurementV1 }> {
  if (input.signal?.aborted) throw cancelled()
  const assetKey = avgKey(input.assetKey, 'voice.assetKey'), expectedHash = avgHash(input.contentHash, 'voice.contentHash')
  // Bound the original allocation before taking the private immutable copy.
  if (input.data.byteLength < 44 || input.data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-voice] WAV 字节为空、截断或超过 32 MiB')
  const data = input.data.slice(0), wave = inspectAvgVoiceWaveV1(data, input.maximumDurationMs)
  const contentHash = await sha256MediaData(data)
  if (contentHash !== expectedHash) throw new Error('[avg-voice] 配音真实字节 hash 不一致')
  if (input.signal?.aborted) throw cancelled()
  const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))
  let onAbort: (() => void) | undefined
  try {
    const decoding = verifyProductMediaRuntimeUrlsV1({
      assets: [{ assetKey, contentHash, mimeType: 'audio/wav', width: null, height: null, durationMs: null }],
      urls: { [assetKey]: url }, timeoutMs: 15_000,
      environment: { browserName: 'browser', browserVersion: navigator.userAgent, platform: navigator.platform,
        viewport: { width: window.innerWidth, height: window.innerHeight } },
    })
    const result = input.signal ? await Promise.race([decoding, new Promise<never>((_, reject) => {
      onAbort = () => reject(cancelled())
      input.signal!.addEventListener('abort', onAbort, { once: true })
      if (input.signal!.aborted) onAbort()
    })]) : await decoding
    if (input.signal?.aborted) throw cancelled()
    const p = result.assets[0]
    if (result.assets.length !== 1 || !p || p.assetKey !== assetKey || p.contentHash !== contentHash
      || p.mimeType !== 'audio/wav' || p.mediaClass !== 'audio' || p.status !== 'decoded' || p.failureCode !== null
      || p.decodedChannelCount !== wave.channelCount || p.decodedDurationMs === null
      || p.decodedDurationMs < 1 || p.decodedDurationMs > input.maximumDurationMs
      || Math.abs(p.decodedDurationMs - wave.durationMs) > 1) {
      throw new Error('[avg-voice] 配音实际解码、时长或声道与准确 PCM 字节不一致')
    }
    const sampleRateHz = avgNumber(p.decodedSampleRateHz, 'voice decoded sample rate', 8000, 384_000)
    const integratedLufs = avgNumber(p.integratedLufs, 'voice measured LUFS', -300, 100, false)
    const truePeakDbtp = avgNumber(p.truePeakDbtp, 'voice measured true peak', -300, 100, false)
    // A silent PCM buffer can decode successfully; that still is not a voice
    // candidate. No intelligibility or delivery inference follows this gate.
    if (truePeakDbtp <= -100) throw new Error('[avg-voice] 配音没有可测声音，不能作为有效语音候选')
    return { data, measurement: { decoder: AVG_VOICE_DECODER_V1, contentHash, mimeType: 'audio/wav' as const,
      byteSize: data.byteLength, durationMs: p.decodedDurationMs, channelCount: wave.channelCount,
      sourceSampleRateHz: wave.sampleRateHz, decodedSampleRateHz: sampleRateHz, sampleCount: wave.sampleCount,
      integratedLufs, truePeakDbtp } }
  } finally {
    if (onAbort) input.signal?.removeEventListener('abort', onAbort)
    URL.revokeObjectURL(url)
  }
}
