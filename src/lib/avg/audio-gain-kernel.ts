/** Pure PCM arithmetic shared by direct evaluation and the dedicated Worker.
 * No container, DB, transport, author or producer authority is present. */
export const AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 = -60_000
export const AVG_AUDIO_GAIN_MAX_MILLI_DB_V1 = 24_000
export const AVG_AUDIO_GAIN_MAX_FRAMES_V1 = 48_000 * 120

export function assertAvgAudioGainPcmLayoutV1(pcm: ArrayBuffer, channelCount: number, sampleCount: number, gainMilliDb: number) {
  if (!(pcm instanceof ArrayBuffer) || ![1, 2].includes(channelCount) || !Number.isSafeInteger(sampleCount)
    || sampleCount < 2 || sampleCount > AVG_AUDIO_GAIN_MAX_FRAMES_V1 || pcm.byteLength !== channelCount * sampleCount * 2
    || !Number.isSafeInteger(gainMilliDb) || gainMilliDb < AVG_AUDIO_GAIN_MIN_MILLI_DB_V1 || gainMilliDb > AVG_AUDIO_GAIN_MAX_MILLI_DB_V1) {
    throw new Error('[avg-audio-process] PCM 声道、帧数、字节或增益上限无效')
  }
}
export function quantizeAvgAudioGainSampleV1(sample: number, gain: number) {
  const value = sample * gain, quantized = Math.trunc(value + (value < 0 ? -0.5 : 0.5))
  if (quantized < -32768 || quantized > 32767) throw new Error('[avg-audio-process] 加工将导致 PCM 溢出，请降低增益或采用独立动态处理配方')
  return quantized
}
export function executeAvgAudioGainPcmV1(input: { pcm: ArrayBuffer; channelCount: number; sampleCount: number; gainMilliDb: number }) {
  const { pcm, channelCount, sampleCount, gainMilliDb } = input
  assertAvgAudioGainPcmLayoutV1(pcm, channelCount, sampleCount, gainMilliDb)
  const output = pcm.slice(0), view = new DataView(output), gain = 10 ** (gainMilliDb / 20_000)
  for (let offset = 0; offset < output.byteLength; offset += 2) view.setInt16(offset, quantizeAvgAudioGainSampleV1(view.getInt16(offset, true), gain), true)
  return output
}
