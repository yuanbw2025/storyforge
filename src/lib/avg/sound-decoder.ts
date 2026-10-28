import { verifyProductMediaRuntimeUrlsV1 } from '../product-production/media-runtime-verifier'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { inspectAvgVoiceWaveV1 } from './voice-wave'

// Headless processing and byte inspection only; the existing decoder and
// sound admission do not automatically invoke or accept these candidates.
export { processAvgAudioPcmWaveV1, processAvgAudioPcmWaveWithWorkerV1, assertAvgAudioProcessingWaveBytesV1 } from './audio-processing'

export function parseAvgSoundByteMeasurementV1(value: unknown) {
  const r = avgRecord(value, ['schema', 'version', 'decoder', 'contentHash', 'mimeType', 'byteSize', 'durationMs', 'channelCount',
    'decodedSampleRateHz', 'integratedLufs', 'truePeakDbtp', 'loopSeamDbfs'], 'sound byte measurement')
  if (r.schema !== 'storyforge.avg.sound-byte-measurement' || r.version !== 1 || r.decoder !== 'storyforge.avg.sound-browser.v1'
    || !['audio/wav', 'audio/ogg'].includes(String(r.mimeType))) throw new Error('[avg-sound] 声音解码观察版本无效')
  return { schema: 'storyforge.avg.sound-byte-measurement' as const, version: 1 as const, decoder: 'storyforge.avg.sound-browser.v1' as const,
    contentHash: avgHash(r.contentHash, 'sound content'), mimeType: r.mimeType as 'audio/wav' | 'audio/ogg',
    byteSize: avgNumber(r.byteSize, 'sound bytes', 27, 8 * 1024 * 1024), durationMs: avgNumber(r.durationMs, 'sound duration', 1, 120_000),
    channelCount: avgNumber(r.channelCount, 'sound channels', 1, 2), decodedSampleRateHz: avgNumber(r.decodedSampleRateHz, 'sound decoded rate', 8000, 384000),
    integratedLufs: avgNumber(r.integratedLufs, 'sound LUFS', -300, 100, false), truePeakDbtp: avgNumber(r.truePeakDbtp, 'sound true peak', -300, 100, false),
    loopSeamDbfs: avgNumber(r.loopSeamDbfs, 'sound seam', -300, 100, false) }
}
/** Actual existing browser decoder/analyzer. No playback, normalization,
 * conversion, intelligibility, listening or author approval follows decode. */
export async function inspectAvgSoundBytesV1(input: { data: ArrayBuffer; contentHash: string; assetKey: string;
  mimeType: 'audio/wav' | 'audio/ogg'; signal?: AbortSignal }) {
  const aborted = () => new DOMException('Sound decode aborted', 'AbortError')
  if (input.signal?.aborted) throw aborted()
  const assetKey = avgKey(input.assetKey, 'sound asset'), expectedHash = avgHash(input.contentHash, 'sound content')
  if (input.data.byteLength < 27 || input.data.byteLength > 8 * 1024 * 1024) throw new Error('[avg-sound] 原声音字节无效或越界')
  const data = input.data.slice(0), contentHash = await sha256MediaData(data)
  if (contentHash !== expectedHash) throw new Error('[avg-sound] 原声音字节hash不一致')
  const wave = input.mimeType === 'audio/wav' ? inspectAvgVoiceWaveV1(data, 120_000) : null
  if (!wave && String.fromCharCode(...new Uint8Array(data).subarray(0, 4)) !== 'OggS') throw new Error('[avg-sound] 需要准确原OGG容器')
  const url = URL.createObjectURL(new Blob([data], { type: input.mimeType }))
  let abort: (() => void) | undefined
  try {
    const decoding = verifyProductMediaRuntimeUrlsV1({ assets: [{ assetKey, contentHash, mimeType: input.mimeType, width: null, height: null, durationMs: null }],
      urls: { [assetKey]: url }, timeoutMs: 15_000, environment: { browserName: 'browser', browserVersion: navigator.userAgent,
        platform: navigator.platform, viewport: { width: window.innerWidth, height: window.innerHeight } } })
    const result = input.signal ? await Promise.race([decoding, new Promise<never>((_, reject) => {
      abort = () => reject(aborted()); input.signal!.addEventListener('abort', abort, { once: true }); if (input.signal!.aborted) abort()
    })]) : await decoding
    if (input.signal?.aborted) throw aborted()
    const p = result.assets[0]
    if (result.assets.length !== 1 || !p || p.status !== 'decoded' || p.failureCode !== null || p.contentHash !== contentHash
      || p.assetKey !== assetKey || p.mimeType !== input.mimeType || p.mediaClass !== 'audio'
      || wave && (p.decodedChannelCount !== wave.channelCount || p.decodedDurationMs === null || Math.abs(p.decodedDurationMs - wave.durationMs) > 1)) throw new Error('[avg-sound] 原音频实际解码与容器不一致')
    const measurement = parseAvgSoundByteMeasurementV1({ schema: 'storyforge.avg.sound-byte-measurement', version: 1,
      decoder: 'storyforge.avg.sound-browser.v1', contentHash, mimeType: input.mimeType, byteSize: data.byteLength,
      durationMs: p.decodedDurationMs, channelCount: p.decodedChannelCount, decodedSampleRateHz: p.decodedSampleRateHz,
      integratedLufs: p.integratedLufs, truePeakDbtp: p.truePeakDbtp, loopSeamDbfs: p.loopSeamDbfs })
    if (measurement.truePeakDbtp <= -100) throw new Error('[avg-sound] 没有可测声音，不能生成音频候选')
    return { data, measurement }
  } finally { if (abort) input.signal?.removeEventListener('abort', abort); URL.revokeObjectURL(url) }
}
