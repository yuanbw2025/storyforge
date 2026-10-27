import { describe, expect, it } from 'vitest'
import { createAvgNativeAuditionCaptureV1, type AvgNativeAuditionSampleV1 } from '../../src/lib/avg/voice-audition'

const sample = (currentTimeMs: number, patch: Partial<AvgNativeAuditionSampleV1> = {}): AvgNativeAuditionSampleV1 => ({
  currentTimeMs, durationMs: 1000, muted: false, volume: 1, playbackRate: 1, seeking: false, ended: false, ...patch,
})
const capture = () => createAvgNativeAuditionCaptureV1({ generation: 'audition.fixture.1', durationMs: 1000 })

describe('AVG native audition generation and audible coverage latches', () => {
  it('ignores pre-play metadata initialization without credit, then validates every actual playback sample', () => {
    const c = capture()
    for (const event of ['waiting', 'timeupdate', 'pause', 'volumechange'] as const) {
      expect(c.observe(event, sample(0, { durationMs: NaN }))).toBeNull()
      expect(c.isTerminal()).toBe(false)
    }
    expect(c.observe('playing', sample(0))).toMatchObject({ playedMs: 0, outcome: 'interrupted' })
    expect(c.observe('ended', sample(1000, { ended: true }))).toMatchObject({ playedMs: 1000, outcome: 'ended' })
    const invalid = capture()
    invalid.observe('waiting', sample(0, { durationMs: NaN }))
    expect(() => invalid.observe('playing', sample(0, { durationMs: NaN }))).toThrow(/准确音频/)
    const changed = capture(); changed.observe('playing', sample(0))
    expect(() => changed.observe('waiting', sample(10, { durationMs: NaN }))).toThrow(/准确音频/)
  })

  it('requires actual playing and a complete end position, excluding paused time', () => {
    const c = capture()
    expect(c.observe('timeupdate', sample(0))).toBeNull()
    expect(c.observe('ended', sample(1000, { ended: true }))).toBeNull()
    c.observe('playing', sample(0)); c.observe('timeupdate', sample(250)); c.observe('pause', sample(400))
    expect(c.snapshot()!.playedMs).toBe(400)
    c.observe('timeupdate', sample(400)); c.observe('playing', sample(400))
    c.observe('timeupdate', sample(900)); c.observe('pause', sample(1000))
    expect(c.observe('ended', sample(1000, { ended: true }))).toMatchObject({ outcome: 'ended', playedMs: 1000, seeked: false })
    expect(c.isTerminal()).toBe(true)
  })

  it.each(['mute', 'zero-volume', 'rate', 'seeking', 'backward', 'mid-start'])('cannot clear earlier %s by restoring the final audio properties', variant => {
    const c = capture()
    c.observe('playing', sample(variant === 'mid-start' ? 400 : 0))
    c.observe('timeupdate', sample(500))
    if (variant === 'mute') c.observe('volumechange', sample(500, { muted: true }))
    if (variant === 'zero-volume') c.observe('volumechange', sample(500, { volume: 0 }))
    if (variant === 'rate') c.observe('ratechange', sample(500, { playbackRate: 1.5 }))
    if (variant === 'seeking') c.observe('seeking', sample(750, { seeking: true }))
    if (variant === 'backward') c.observe('timeupdate', sample(200))
    c.observe('volumechange', sample(800)); c.observe('ratechange', sample(800))
    expect(c.observe('ended', sample(1000, { ended: true }))!.outcome).toBe('interrupted')
  })

  it('never approves a callback name without ended or a zero-played one-millisecond clip', () => {
    const c = capture(); c.observe('playing', sample(0))
    expect(c.observe('ended', sample(1000))!.outcome).toBe('interrupted')
    const short = createAvgNativeAuditionCaptureV1({ generation: 'audition.short', durationMs: 1 })
    short.observe('playing', sample(0, { durationMs: 1 }))
    expect(short.observe('ended', sample(0, { durationMs: 1, ended: true }))!.outcome).toBe('interrupted')
  })

  it('seals error/interruption and cannot be upgraded by a late ended event or repeated play', () => {
    for (const event of ['error', 'interrupt'] as const) {
      const c = capture(); c.observe('playing', sample(0)); c.observe('timeupdate', sample(200))
      const stopped = c.observe(event, sample(300))
      expect(stopped).toMatchObject({ playedMs: 300, outcome: event === 'error' ? 'failed' : 'interrupted' })
      expect(c.observe('ended', sample(1000, { ended: true }))).toEqual(stopped)
      expect(c.observe('playing', sample(0))).toEqual(stopped)
    }
  })

  it('rejects a wrong native duration, invalid position or unsupported rate rather than guessing timing', () => {
    for (const patch of [{ durationMs: 2000 }, { durationMs: NaN }, { currentTimeMs: -1 }, { volume: NaN }, { playbackRate: 10 }]) {
      const c = capture()
      expect(() => c.observe('playing', sample(0, patch))).toThrow(/准确音频/)
      expect(c.snapshot()).toBeNull(); expect(c.isTerminal()).toBe(true)
    }
  })

  it('uses independent captures for retakes and a fresh generation instead of sharing a previous pass', () => {
    const first = capture(); first.observe('playing', sample(0)); first.observe('ended', sample(1000, { ended: true }))
    const second = createAvgNativeAuditionCaptureV1({ generation: 'audition.fixture.2', durationMs: 1000 })
    expect(first.snapshot()!.outcome).toBe('ended'); expect(second.snapshot()).toBeNull()
    second.observe('playing', sample(0)); expect(second.snapshot()).toMatchObject({ generation: 'audition.fixture.2', playedMs: 0, outcome: 'interrupted' })
  })
})
