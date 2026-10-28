import type { AvgReadingPlanV1 } from '../../src/lib/avg/reading-contract'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { avgSystemFixture } from './avg-system-fixture'
import { seedAvgNativePreview } from './avg-native-fixture'

export function avgReadingFixture(overrides: Partial<AvgReadingPlanV1> = {}): AvgReadingPlanV1 {
  return { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause', maximumVoiceWaitMs: 10_000, autoDelayMs: 200,
    voices: [{ lineKey: 'line.desk', assetKey: 'voice.calibration', text: '封口仍在。', textRevision: 1, speakerKey: 'keeper', locale: 'zh-CN' }], ...overrides }
}
/** Original PCM calibration tone, not speech/TTS/artistic voice evidence. Actual
 * RIFF bytes exercise decoding, time, ended, pause and interruption transport. */
export async function avgReadingAudioFixture(durationMs = 1800, broken = false) {
  const sampleRate = 16000, samples = Math.round(sampleRate*durationMs/1000), data = new ArrayBuffer(44+samples*2), view = new DataView(data)
  const ascii = (offset: number, text: string) => [...text].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)))
  ascii(0,'RIFF'); view.setUint32(4,36+samples*2,true); ascii(8,'WAVE'); ascii(12,'fmt '); view.setUint32(16,16,true)
  view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); ascii(36,'data'); view.setUint32(40,samples*2,true)
  for (let i=0;i<samples;i++) view.setInt16(44+i*2,Math.round(600*Math.sin(2*Math.PI*220*i/sampleRate)*Math.min(1,i/800,(samples-i)/800)),true)
  const bytes = broken ? new Uint8Array([1,2,3,4,5,6,7,8]).buffer : data
  const contentHash = await sha256MediaData(bytes)
  const asset: FrozenRuntimeMediaAssetV2 = { assetKey: 'voice.calibration', version: 1, kind: 'voice', name: '阅读协调测试音（非人声）', mimeType: 'audio/wav', byteSize: bytes.byteLength,
    width: null, height: null, durationMs, contentHash, blobContentHash: contentHash, source: 'original PCM engineering fixture, not speech', license: 'CC0-1.0', altText: '', characterTag: 'keeper', sceneTag: 'desk' }
  return { asset, data: bytes }
}
export async function seedAvgReadingPreview(overrides: Partial<AvgReadingPlanV1> = {}, durationMs = 1800, broken = false, sfx = false) {
  const audio = await avgReadingAudioFixture(durationMs, broken)
  return seedAvgNativePreview(avgSystemFixture(), [audio, ...(sfx ? [{ ...audio, asset: { ...audio.asset, kind: 'sfx' as const, assetKey: 'sfx.calibration' } }] : [])], avgReadingFixture(overrides), sfx ? [
    { cueKey: 'before.sfx', beatKey: 'line.desk', type: 'play-audio', assetKey: 'sfx.calibration', phase: 'before', durationMs: 0, order: 1, easing: 'linear' },
    { cueKey: 'after.sfx', beatKey: 'line.desk', type: 'play-audio', assetKey: 'sfx.calibration', phase: 'after', durationMs: 0, order: 2, easing: 'linear' },
    { cueKey: 'after.wait', beatKey: 'line.desk', type: 'wait', phase: 'after', durationMs: 1000, order: 3, easing: 'linear' },
  ] : [])
}
