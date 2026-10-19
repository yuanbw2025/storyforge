import { avgNumber } from './protocol-validation'

export const AVG_VOICE_DECODER_V1 = 'storyforge.avg.pcm16-browser.v1' as const

/** Serializable technical observation. Parsing it is not a decoder call. */
export interface AvgVoiceByteMeasurementV1 {
  decoder: typeof AVG_VOICE_DECODER_V1
  contentHash: string
  mimeType: 'audio/wav'
  byteSize: number
  durationMs: number
  channelCount: number
  sourceSampleRateHz: number
  decodedSampleRateHz: number
  sampleCount: number
  integratedLufs: number
  truePeakDbtp: number
}

export interface AvgVoiceWaveV1 {
  codec: 'pcm-s16le'
  channelCount: number
  sampleRateHz: number
  sampleCount: number
  durationMs: number
  dataOffset: number
  dataByteSize: number
}

/** First generated-voice delivery profile: bounded, uncompressed PCM16 WAV.
 * This is a container/resource preflight, not browser decode or audition.
 * RIFF sizes exclude the eight-byte chunk header; odd chunks have one pad byte.
 * https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff-
 * https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex
 */
export function inspectAvgVoiceWaveV1(data: ArrayBuffer, maximumDurationMs: number): AvgVoiceWaveV1 {
  avgNumber(maximumDurationMs, 'voice.maximumDurationMs', 1000, 120_000)
  if (data.byteLength < 44 || data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-voice] WAV 字节为空、截断或超过 32 MiB')
  const bytes = new Uint8Array(data), view = new DataView(data)
  const fourcc = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (fourcc(0) !== 'RIFF' || fourcc(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) {
    throw new Error('[avg-voice] WAV 容器或完整字节长度不一致')
  }
  let format: { channelCount: number; sampleRateHz: number; blockAlign: number } | null = null
  let audio: { offset: number; size: number } | null = null
  let offset = 12, chunks = 0
  while (offset < bytes.length) {
    if (++chunks > 128 || offset + 8 > bytes.length) throw new Error('[avg-voice] WAV 分块数量或边界无效')
    const id = fourcc(offset), size = view.getUint32(offset + 4, true), start = offset + 8
    const end = start + size, next = end + size % 2
    if (next > bytes.length) throw new Error('[avg-voice] WAV 分块数据或填充被截断')
    if (id === 'fmt ') {
      if (format || audio || ![16, 18].includes(size)) throw new Error('[avg-voice] WAV 格式分块重复、顺序或长度无效')
      const tag = view.getUint16(start, true), channelCount = view.getUint16(start + 2, true)
      const sampleRateHz = view.getUint32(start + 4, true), bytesPerSecond = view.getUint32(start + 8, true)
      const blockAlign = view.getUint16(start + 12, true), bits = view.getUint16(start + 14, true)
      if (tag !== 1 || bits !== 16 || ![1, 2].includes(channelCount) || sampleRateHz < 8000 || sampleRateHz > 48_000
        || blockAlign !== channelCount * 2 || bytesPerSecond !== sampleRateHz * blockAlign
        || size === 18 && view.getUint16(start + 16, true) !== 0) {
        throw new Error('[avg-voice] 当前生成配音只接收 8～48 kHz、单/双声道 PCM16 WAV，不隐式转码')
      }
      format = { channelCount, sampleRateHz, blockAlign }
    } else if (id === 'data') {
      if (!format || audio || !size || size % format.blockAlign !== 0) throw new Error('[avg-voice] WAV 样本缺失、重复或没有完整帧')
      audio = { offset: start, size }
    }
    offset = next
  }
  if (!format || !audio) throw new Error('[avg-voice] WAV 缺少准确格式或音频样本')
  const sampleCount = audio.size / format.blockAlign
  // Compare the exact frame duration before rounding; a ceiling cannot be
  // exceeded by one frame just because its milliseconds round down.
  if (sampleCount < 2 || sampleCount * 1000 > maximumDurationMs * format.sampleRateHz) {
    throw new Error('[avg-voice] WAV 真实帧数为空或超过冻结的单句时长上限')
  }
  return { codec: 'pcm-s16le', channelCount: format.channelCount, sampleRateHz: format.sampleRateHz,
    sampleCount, durationMs: Math.max(1, Math.round(sampleCount / format.sampleRateHz * 1000)),
    dataOffset: audio.offset, dataByteSize: audio.size }
}
