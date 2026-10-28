import type { AvgAuthorVoiceEvidenceV1 } from './voice-review-contract'
import { avgKey, avgNumber } from './protocol-validation'

export interface AvgNativeAuditionSampleV1 {
  currentTimeMs: number
  durationMs: number
  muted: boolean
  volume: number
  playbackRate: number
  seeking: boolean
  ended: boolean
}
export type AvgNativeAuditionEventV1 = 'playing' | 'timeupdate' | 'pause' | 'waiting' | 'ended' | 'error'
  | 'seeking' | 'seeked' | 'volumechange' | 'ratechange' | 'interrupt'
export type AvgNativeAuditionObservationV1 = NonNullable<AvgAuthorVoiceEvidenceV1['audition']>

/** One exact clip/playback generation. This records native observations and
 * conservative latches; it cannot identify a listener or approve voice art.
 * The UI supplies currentTarget properties, never elapsed wall time or words.
 */
export function createAvgNativeAuditionCaptureV1(input: { generation: string; durationMs: number }) {
  const generation = avgKey(input.generation, 'audition generation')
  if (!generation.startsWith('audition.')) throw new Error('[avg-voice] 审听 generation 无效')
  const durationMs = avgNumber(input.durationMs, 'audition duration', 1, 120_000)
  let started = false, playing = false, terminal = false, position = 0, playedMs = 0
  let muted = false, volume = 1, playbackRate = 1, seeked = false
  let outcome: AvgNativeAuditionObservationV1['outcome'] = 'interrupted'
  const snapshot = (): AvgNativeAuditionObservationV1 | null => started ? {
    generation, outcome, durationMs, playedMs: Math.min(durationMs, Math.round(playedMs)), muted, volume, playbackRate, seeked,
  } : null
  return {
    snapshot,
    isTerminal: () => terminal,
    observe(event: AvgNativeAuditionEventV1, sample: AvgNativeAuditionSampleV1) {
      if (terminal) return snapshot()
      // A native element can emit waiting/timeupdate before metadata exists.
      // Nothing has played yet; these initialization events grant no coverage.
      // The first actual playing (or error) and every later sample still have
      // to prove this exact clip's duration and playback properties.
      if (!started && event !== 'playing' && event !== 'error') return null
      const valid = Number.isFinite(sample.currentTimeMs) && sample.currentTimeMs >= 0 && sample.currentTimeMs <= durationMs + 1
        && Number.isFinite(sample.durationMs) && Math.abs(sample.durationMs - durationMs) <= 1
        && Number.isFinite(sample.volume) && sample.volume >= 0 && sample.volume <= 1
        && Number.isFinite(sample.playbackRate) && sample.playbackRate >= 0.25 && sample.playbackRate <= 4
      if (!valid) {
        // A different duration/invalid media observation is not this clip.
        // Callers show a technical failure and cannot submit an audition.
        terminal = true; playing = false
        throw new Error('[avg-voice] 原生审听的时长、位置或播放属性与准确音频不一致')
      }
      if (!started) {
        started = true
        if (sample.currentTimeMs > 1) seeked = true
        position = sample.currentTimeMs
      }
      const alteredPosition = sample.seeking || event === 'seeking' || event === 'seeked' || sample.currentTimeMs < position - 1
      seeked ||= alteredPosition
      muted ||= sample.muted
      volume = Math.min(volume, sample.volume)
      if (sample.playbackRate !== 1) playbackRate = sample.playbackRate
      if (playing && !alteredPosition && !sample.muted && sample.volume > 0 && sample.playbackRate === 1) {
        playedMs = Math.min(durationMs, playedMs + Math.max(0, sample.currentTimeMs - position))
      }
      position = sample.currentTimeMs
      if (event === 'playing') playing = true
      if (event === 'waiting' || event === 'pause') playing = false
      if (event === 'ended') {
        // A callback name alone, or ended after starting from the middle, is
        // insufficient. Earlier mute/rate/seek history remains latched.
        outcome = sample.ended && sample.currentTimeMs >= durationMs - 1 && playedMs > 0
          && playedMs >= durationMs - 1 && !muted && volume > 0 && playbackRate === 1 && !seeked ? 'ended' : 'interrupted'
        terminal = true; playing = false
      } else if (event === 'error' || event === 'interrupt') {
        outcome = event === 'error' ? 'failed' : 'interrupted'
        terminal = true; playing = false
      }
      return snapshot()
    },
  }
}
