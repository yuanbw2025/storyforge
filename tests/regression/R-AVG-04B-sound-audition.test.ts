import { describe, expect, it } from 'vitest'
import { createAvgSoundAuditionCaptureV1, type AvgSoundOutputSampleV1 } from '../../src/lib/avg/sound-audition'

const start = (loop = true) => createAvgSoundAuditionCaptureV1({ generation: 'audition.original.1', durationMs: 1000, decodedDurationMs: 1000, startTimeSeconds: 3, loop })
const sample = (time: number, extra: Partial<AvgSoundOutputSampleV1> = {}): AvgSoundOutputSampleV1 => ({ generation: 'audition.original.1',
  outputTimeSeconds: time, renderTimeSeconds: time + .1, contextState: 'running', bufferDurationMs: 1000, loop: true, playbackRate: 1, detune: 0, volume: 1, muted: false, ...extra })

describe('native Sound audition uses one original source and actual output clock', () => {
  it('requires both full continuous loops and a source terminal event after rendering the scheduled end', () => {
    const c = start()
    expect(c.observe('sample', sample(2.9))).toBeNull()
    expect(c.observe('sample', sample(3.5))).toMatchObject({ playedMs: 500, completedCycles: 0, continuousLoops: 0 })
    expect(c.observe('sample', sample(4.1))).toMatchObject({ playedMs: 1099, completedCycles: 1, continuousLoops: 1, outcome: 'interrupted' })
    expect(c.observe('sample', sample(5.1))).toMatchObject({ completedCycles: 2, outcome: 'interrupted' })
    expect(c.observe('source-ended', sample(5.1))).toMatchObject({ playedMs: 2000, completedCycles: 2, continuousLoops: 1, outcome: 'ended' })
    expect(c.isTerminal()).toBe(true)
  })
  it('waits for device output even after the rendering graph ended, without inventing coverage from the callback', () => {
    const c = start()
    expect(c.observe('source-ended', sample(4.8, { renderTimeSeconds: 5.01 }))).toMatchObject({ playedMs: 1799, outcome: 'interrupted', completedCycles: 1 })
    expect(c.isTerminal()).toBe(false)
    expect(c.observe('sample', sample(5.01))).toMatchObject({ playedMs: 2000, outcome: 'ended', continuousLoops: 1 })
  })
  it('does not convert early source stopping, paused context, or explicit interruption into complete loops', () => {
    for (const kind of ['early', 'suspended', 'interrupt'] as const) {
      const c = start(); c.observe('sample', sample(3.3))
      const r = kind === 'early' ? c.observe('source-ended', sample(3.5)) : kind === 'suspended'
        ? c.observe('sample', sample(3.5, { contextState: 'suspended' })) : c.observe('interrupt', sample(4.2))
      expect(r?.outcome).toBe('interrupted'); expect(c.isTerminal()).toBe(true)
      expect(c.observe('source-ended', sample(9))).toEqual(r)
    }
  })
  it.each([{ muted: true }, { volume: 0 }, { playbackRate: 2 }])('latches an inaudible or altered run despite restoring its controls: %j', change => {
    const c = start(); c.observe('sample', sample(3.2)); c.observe('sample', sample(3.6, change))
    const r = c.observe('source-ended', sample(5.2))
    expect(r?.outcome).toBe('interrupted'); expect(c.isTerminal()).toBe(true)
  })
  it('rejects a changed source, duration, loop mode, invalid clock or detune instead of granting observation', () => {
    for (const extra of [{ generation: 'audition.foreign.1' }, { bufferDurationMs: 2000 }, { loop: false }, { outputTimeSeconds: Number.NaN }, { detune: 100 }]) {
      const c = start()
      expect(() => c.observe('sample', sample(3.4, extra))).toThrow(/来源|时钟|属性/)
      expect(c.isTerminal()).toBe(true)
    }
  })
  it('cannot combine a backwards clock or two independent one-cycle plays into continuous-loop proof', () => {
    const c = start(); c.observe('sample', sample(4.3)); c.observe('sample', sample(3.5))
    expect(c.observe('source-ended', sample(5.1))).toMatchObject({ outcome: 'interrupted', seeked: true })
    for (let i = 0; i < 2; i++) {
      const single = start(false)
      expect(single.observe('source-ended', sample(4.1, { loop: false }))).toMatchObject({ outcome: 'ended', completedCycles: 1, continuousLoops: 0 })
    }
  })
})
