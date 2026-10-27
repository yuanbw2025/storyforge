import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createTtrpgAudioTransitionPlaybackV1, type TtrpgLocalAudioHandleV1 } from '../../src/lib/ttrpg/open-audio-transition-playback'
import { startTtrpgAudioFadeInV1 } from '../../src/lib/ttrpg/open-audio-playback'

/** Native transport is simulated here; actual decode/play is separately browser-tested. */
describe('R-TTRPGOPEN10 bounded native-node transition presentation', () => {
  let now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number, hidden: boolean
  const nodes: TtrpgLocalAudioHandleV1[] = [], controllers: ReturnType<typeof createTtrpgAudioTransitionPlaybackV1>[] = []
  beforeEach(() => {
    now = 0; hidden = false; frames = new Map(); nextFrame = 0; vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame })
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  })
  afterEach(() => {
    controllers.splice(0).forEach(controller => controller.cancel()); nodes.splice(0).forEach(node => node())
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  })
  function node(key: string, playing = true) {
    const element = document.createElement('audio'); element.src = `blob:${key}`
    let transferred = false; let cancelFade: () => void = () => undefined
    Object.defineProperty(element, 'paused', { get: () => !playing }); Object.defineProperty(element, 'ended', { get: () => false })
    const pause = vi.spyOn(element, 'pause').mockImplementation(() => { playing = false; element.dispatchEvent(new Event('pause')) })
    const dispose = vi.fn(() => { cancelFade(); pause(); element.removeAttribute('src') })
    const handle: TtrpgLocalAudioHandleV1 = Object.assign(dispose, {
      clipKey: key, element, isPlaying: () => playing && !!element.getAttribute('src'),
      take: vi.fn(() => { if (!playing || transferred || element.muted || element.volume <= 0) return null; transferred = true; return { element, dispose } }),
      cancelFollow: vi.fn(() => { cancelFade(); pause() }),
      follow: vi.fn(async (ms: number, volume: number) => { playing = true; element.volume = volume; cancelFade = startTtrpgAudioFadeInV1(element, ms) }),
    }); nodes.push(handle); return handle
  }
  function setup(fadeMs = 1000, follow = true, action: 'play' | 'stop' = 'play', toClipKey: string | null = 'new', volume = 1) {
    const controller = createTtrpgAudioTransitionPlaybackV1(); controllers.push(controller)
    const old = node('old'), release = vi.fn(), fallback = vi.fn()
    old.element.volume = volume
    const accepted = controller.begin({ channel: 'music', action, fromClipKey: 'old', toClipKey, fadeMs }, old,
      { follow, deadline: now + 3000, release, fallback })
    return { controller, old, release, fallback, accepted }
  }
  const tick = (ms: number) => { now += ms; vi.advanceTimersByTime(ms); for (const [key, fn] of [...frames]) { frames.delete(key); fn(now) } }
  it('requires an actual playing node and explicit follow for replacements, and never follows voice or a different clip', () => {
    const s = setup(1000, false); expect(s.accepted).toBe(false); expect(s.old.take).not.toHaveBeenCalled()
    const idle = node('idle', false), release = vi.fn(), fallback = vi.fn()
    for (const channel of ['music', 'voice'] as const) expect(s.controller.begin({ channel, action: 'play', fromClipKey: 'idle', toClipKey: 'new', fadeMs: 1000 }, idle, { follow: true, deadline: 3000, release, fallback })).toBe(false)
    expect(s.controller.begin({ channel: 'music', action: 'play', fromClipKey: 'other', toClipKey: 'new', fadeMs: 1000 }, s.old, { follow: true, deadline: 3000, release, fallback })).toBe(false)
    const incoming = node('new', false); s.controller.attach('new', incoming); expect(incoming.follow).not.toHaveBeenCalled()
  })
  it('crossfades both real volume properties once, then pauses/releases only the old node without replaying the new clip', async () => {
    const s = setup(), incoming = node('new', false); expect(s.accepted).toBe(true)
    s.controller.attach('new', incoming); s.controller.attach('new', incoming); await Promise.resolve()
    expect(incoming.follow).toHaveBeenCalledTimes(1); expect(incoming.element.volume).toBe(0)
    tick(500); expect(s.old.element.volume).toBeCloseTo(.5); expect(incoming.element.volume).toBeCloseTo(.5)
    tick(500); expect(s.old.element.paused).toBe(true); expect(s.old.element.getAttribute('src')).toBeNull()
    expect(s.release).toHaveBeenCalledTimes(1); expect(incoming.isPlaying()).toBe(true); expect(incoming.element.volume).toBe(1)
    s.controller.attach('new', incoming); expect(incoming.follow).toHaveBeenCalledTimes(1)
  })
  it('fades a formal stop without follow or any incoming play and respects a native volume takeover', () => {
    const s = setup(1000, false, 'stop', null); expect(s.accepted).toBe(true)
    tick(400); expect(s.old.element.volume).toBeCloseTo(.6)
    s.old.element.volume = .2; s.old.element.dispatchEvent(new Event('volumechange'))
    expect(s.old.element.paused).toBe(true); expect(s.release).toHaveBeenCalledTimes(1)
    tick(4000); expect(s.release).toHaveBeenCalledTimes(1); expect(s.fallback).not.toHaveBeenCalled()
  })
  it.each([1, .4])('keeps a stop monotone and bounded at volume %s when the first frame predates the fade start', volume => {
    now = 100
    const s = setup(1000, false, 'stop', null, volume)
    expect(s.accepted).toBe(true)
    const first = [...frames]; frames.clear()
    // A native rAF timestamp belongs to the frame start, not this callback's
    // later performance.now(). Cloud Chromium reported a 1.00257 volume here.
    expect(() => first.forEach(([, fn]) => fn(92))).not.toThrow()
    expect(s.old.element.volume).toBe(volume); expect(s.old.element.paused).toBe(false)
    expect(s.release).not.toHaveBeenCalled()
    tick(500); expect(s.old.element.volume).toBeCloseTo(volume / 2)
    tick(500); expect(s.old.element.paused).toBe(true); expect(s.release).toHaveBeenCalledTimes(1)
    expect(s.fallback).not.toHaveBeenCalled()
  })
  it('does not follow a revealed underlying clip when the listener only authorized a stop fade', () => {
    const s = setup(1000, false, 'stop'), incoming = node('new', false)
    s.controller.attach('new', incoming); expect(incoming.follow).not.toHaveBeenCalled()
    tick(1000); expect(s.old.element.paused).toBe(true); expect(s.release).toHaveBeenCalledTimes(1)
  })
  it('bounds an absent or blocked incoming node and cannot revive a late attachment or response', async () => {
    const s = setup(3000), incoming = node('new', false)
    tick(3000); expect(s.old.element.paused).toBe(true); expect(s.fallback).toHaveBeenCalledTimes(1)
    s.controller.attach('new', incoming); expect(incoming.follow).not.toHaveBeenCalled()
    const blocked = setup(); vi.mocked(incoming.follow).mockRejectedValueOnce(new Error('NotAllowedError'))
    blocked.controller.attach('new', incoming); await Promise.resolve(); await Promise.resolve()
    expect(blocked.old.element.paused).toBe(true); expect(blocked.release).toHaveBeenCalledTimes(1)
    expect(incoming.element.getAttribute('src')).toBe('blob:new'); expect(incoming.element.paused).toBe(true)
    expect(blocked.fallback).toHaveBeenCalledTimes(1)
  })
  it('cancels a pending play on silence/backgrounding and ignores its late fulfillment', async () => {
    const s = setup(3000), incoming = node('new', false)
    let resolve!: () => void; vi.mocked(incoming.follow).mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    s.controller.attach('new', incoming)
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(s.old.element.paused).toBe(true); expect(incoming.cancelFollow).toHaveBeenCalledTimes(1)
    resolve(); await Promise.resolve(); expect(incoming.isPlaying()).toBe(false); expect(s.release).toHaveBeenCalledTimes(1)
  })
  it('uses zero-fade evidence for an immediate cut, never extending the old file while the new play loads', async () => {
    const s = setup(0), incoming = node('new', false); expect(s.accepted).toBe(true)
    expect(s.old.element.paused).toBe(true); expect(s.release).toHaveBeenCalledTimes(1)
    s.controller.attach('new', incoming); await Promise.resolve()
    expect(incoming.follow).toHaveBeenCalledWith(0, 1); expect(incoming.isPlaying()).toBe(true)
    s.controller.cancel(); expect(s.release).toHaveBeenCalledTimes(1); expect(incoming.isPlaying()).toBe(true)
  })
  it('a new transition disposes its prior tail, and cancellation leaves a completed incoming play alone', async () => {
    const s = setup(3000), incoming = node('new', false)
    s.controller.attach('new', incoming); await Promise.resolve(); tick(300)
    expect(s.controller.begin({ channel: 'music', action: 'stop', fromClipKey: 'new', toClipKey: null, fadeMs: 1000 }, incoming,
      { follow: false, deadline: now + 3000, release: vi.fn(), fallback: vi.fn() })).toBe(true)
    expect(s.old.element.paused).toBe(true); expect(s.release).toHaveBeenCalledTimes(1)
    s.controller.cancel(); expect(incoming.element.paused).toBe(true)
  })
})
