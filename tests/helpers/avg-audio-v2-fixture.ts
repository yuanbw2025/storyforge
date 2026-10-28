import type { AvgAudioProcessingRecipeV2 } from '../../src/lib/avg/audio-processing-contract-v2'
import { encodeAvgAudioCanonicalWaveV2 } from '../../src/lib/avg/audio-processing-v2'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'

export const audioRecipeV2 = (patch: Partial<AvgAudioProcessingRecipeV2> = {}): AvgAudioProcessingRecipeV2 => ({
  schema: 'storyforge.avg.audio-processing-recipe', version: 2, gainMilliDb: 0, maximumDurationMs: 1000,
  sampleRatePolicy: 'explicit', targetSampleRateHz: 48000, channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
  resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1', dynamics: null,
  declaration: 'ENGINEERING exact finite PCM candidate; no quality, producer or listening acceptance.', ...patch,
})
export function audioPcmV2(rate = 24000, frames = 2400, channels = 1, frequency = 997, amplitude = 8000) {
  const pcm = new ArrayBuffer(frames * channels * 2), view = new DataView(pcm)
  for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < channels; ch++) {
    view.setInt16((frame * channels + ch) * 2, Math.round(amplitude / (ch + 1) * Math.sin(2 * Math.PI * frequency * frame / rate)), true)
  }
  return pcm
}
export async function audioWaveV2(pcm = audioPcmV2(), rate = 24000, channels = 1) {
  const data = encodeAvgAudioCanonicalWaveV2(pcm, channels, rate)
  return { data, source: { contentHash: await sha256MediaData(data), mimeType: 'audio/wav' as const, kind: 'voice' as const } }
}
