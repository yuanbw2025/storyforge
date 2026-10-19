import { avgKey, avgNumber } from './protocol-validation'
import type { AvgAuthorSoundEvidenceV1 } from './sound-review-contract'

export type AvgSoundAuditionObservationV1 = NonNullable<AvgAuthorSoundEvidenceV1['audition']>
export interface AvgSoundOutputSampleV1 {
  generation: string; outputTimeSeconds: number; renderTimeSeconds: number; contextState: string
  bufferDurationMs: number; loop: boolean; playbackRate: number; detune: number; volume: number; muted: boolean
}

/** One continuously scheduled native source, observed using output-device
 * contextTime (not Date/performance/timer elapsed time). Polling merely samples
 * that native clock. A source ended callback alone cannot grant coverage.
 * Author assessment and source/producer validation remain separate. */
export function createAvgSoundAuditionCaptureV1(input: {
  generation: string; durationMs: number; decodedDurationMs: number; startTimeSeconds: number; loop: boolean
}) {
  const generation = avgKey(input.generation, 'sound audition generation')
  if (!generation.startsWith('audition.')) throw new Error('[avg-sound] 无效审听代际')
  const durationMs = avgNumber(input.durationMs, 'sound audition duration', 1, 120_000)
  const decoded = avgNumber(input.decodedDurationMs, 'native sound duration', 1, 120_001, false)
  const start = avgNumber(input.startTimeSeconds, 'native sound start', 0, Number.MAX_SAFE_INTEGER, false)
  if (Math.abs(decoded - durationMs) > 1) throw new Error('[avg-sound] 实际播放时长与原声音不一致')
  const cycles = input.loop ? 2 : 1, end = start + decoded * cycles / 1000
  let terminal = false, ended = false, playedMs = 0, completedCycles = 0, continuousLoops = 0
  let lastClock = 0, muted = false, volume = 1, playbackRate = 1, seeked = false
  let outcome: AvgSoundAuditionObservationV1['outcome'] = 'interrupted'
  const snapshot = (): AvgSoundAuditionObservationV1 | null => playedMs > 0 ? {
    generation, outcome, durationMs, playedMs, completedCycles, continuousLoops, muted, volume, playbackRate, seeked,
  } : null
  return {
    snapshot, isTerminal: () => terminal,
    observe(event: 'sample' | 'source-ended' | 'interrupt' | 'error', sample: AvgSoundOutputSampleV1) {
      if (terminal) return snapshot()
      if (sample.generation !== generation || !Number.isFinite(sample.outputTimeSeconds) || sample.outputTimeSeconds < 0
        || !Number.isFinite(sample.renderTimeSeconds) || sample.renderTimeSeconds < 0
        || !Number.isFinite(sample.bufferDurationMs) || Math.abs(sample.bufferDurationMs - decoded) > .001
        || sample.loop !== input.loop || !Number.isFinite(sample.volume) || sample.volume < 0 || sample.volume > 1
        || !Number.isFinite(sample.playbackRate) || sample.playbackRate < .25 || sample.playbackRate > 4 || sample.detune !== 0) {
        terminal = true; throw new Error('[avg-sound] 播放来源、输出时钟或属性与本轮原音频不一致')
      }
      muted ||= sample.muted; volume = Math.min(volume, sample.volume)
      if (sample.playbackRate !== 1) playbackRate = sample.playbackRate
      seeked ||= sample.outputTimeSeconds < lastClock
      lastClock = sample.outputTimeSeconds
      const valid = sample.contextState === 'running' && !muted && volume > 0 && playbackRate === 1 && !seeked
      if (valid) {
        const elapsed = Math.max(0, Math.min(sample.outputTimeSeconds, end) - start) * 1000
        playedMs = Math.min(durationMs * cycles, Math.floor(elapsed))
        completedCycles = Math.min(cycles, Math.floor(elapsed / decoded))
        continuousLoops = input.loop && elapsed > decoded ? Math.min(cycles - 1, completedCycles) : 0
      }
      ended ||= event === 'source-ended'
      if (event === 'error' || event === 'interrupt' || sample.contextState !== 'running'
        || event === 'source-ended' && sample.renderTimeSeconds < end - .001) {
        outcome = event === 'error' ? 'failed' : 'interrupted'; terminal = true
      } else if (ended && sample.outputTimeSeconds >= end) {
        // Normalize only the already verified <=1ms duration rounding, after
        // the same original source ended AND the output clock reached its end.
        if (valid) { playedMs = durationMs * cycles; completedCycles = cycles; continuousLoops = cycles - 1 }
        outcome = valid ? 'ended' : 'interrupted'; terminal = true
      }
      return snapshot()
    },
  }
}
