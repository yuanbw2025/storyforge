import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgOpenAudioPlayer, { type TtrpgLocalAudioStopV1 } from '../../src/components/ttrpg/TtrpgOpenAudioPlayer'
import { rememberTtrpgAudioPositionV1, startTtrpgAudioFadeInV1, ttrpgVoiceCaptionMarksV1, ttrpgVoiceCaptionNavigationV1 } from '../../src/lib/ttrpg/open-audio-playback'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN10 local captions, bounded positions and explicit fade', () => {
  let host: HTMLDivElement, root: Root, frames: Map<number, FrameRequestCallback>, frameId: number
  beforeEach(() => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); frames = new Map(); frameId = 0
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  function tick(ms: number) { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback(ms)) }
  const track = () => ({ channel: 'voice' as const, slotKey: 'caption.slot', audience: 'party' as const, fallbackText: '第一段。第二段。',
    sourceRef: { sessionKey: 'session.caption', sequence: 1 }, clipKey: 'caption.slot:hash', fade: 0, durationMs: 4000,
    voiceMarks: [{ textOffset: 0, textLength: 4, startMs: 0, durationMs: 1000 }, { textOffset: 4, textLength: 4, startMs: 2000, durationMs: 1000 }] })
  it('preserves complete Unicode prose, rejects split surrogate marks, and navigates gaps without inventing timing', () => {
    const valid = [{ textOffset: 0, textLength: 1, startMs: 0, durationMs: 100 }, { textOffset: 1, textLength: 2, startMs: 200, durationMs: 100 }, { textOffset: 3, textLength: 1, startMs: 300, durationMs: 100 }]
    expect(ttrpgVoiceCaptionMarksV1('甲😀乙', valid)).toEqual(valid)
    expect(ttrpgVoiceCaptionNavigationV1(valid, 0.15)).toEqual({ active: -1, previous: 0, next: 1 })
    expect(ttrpgVoiceCaptionNavigationV1(valid, 0.25)).toEqual({ active: 1, previous: 0, next: 2 })
    expect(ttrpgVoiceCaptionNavigationV1(valid, 0.4)).toEqual({ active: -1, previous: 2, next: -1 })
    expect(ttrpgVoiceCaptionMarksV1('甲😀乙', [{ textOffset: 0, textLength: 2, startMs: 0, durationMs: 100 }, { textOffset: 2, textLength: 2, startMs: 100, durationMs: 100 }])).toEqual([])
    expect(ttrpgVoiceCaptionMarksV1('原文', [{ textOffset: 0, textLength: 1, startMs: 0, durationMs: 1 }])).toEqual([])
  })
  it('seeks exact original marks while paused, samples real media time and preserves the full caption during silence', async () => {
    const stops = new Map<string, TtrpgLocalAudioStopV1>(), remember = vi.fn()
    const register = (key: string, stop: TtrpgLocalAudioStopV1 | null) => { if (stop) stops.set(key, stop); else stops.delete(key) }
    let props: Parameters<typeof TtrpgOpenAudioPlayer>[0] = { track: track(), url: 'blob:caption', failed: false, resumeSeconds: 0, register, remember, onFailure: vi.fn() }
    const render = () => root.render(createElement(StrictMode, null, createElement(TtrpgOpenAudioPlayer, props)))
    await act(async () => render())
    const node = host.querySelector('audio')!; Object.defineProperty(node, 'duration', { configurable: true, value: 4 })
    await act(async () => { node.currentTime = 0.5; node.dispatchEvent(new Event('loadedmetadata')) })
    expect(host.querySelector('mark')?.textContent).toBe('第一段。'); expect(host.querySelector('[aria-label="配音字幕"]')?.textContent).toBe(props.track.fallbackText)
    await act(async () => { node.currentTime = 1.5; node.dispatchEvent(new Event('timeupdate')) })
    expect(host.querySelector('mark')).toBeNull()
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '下一段字幕')!.click())
    expect(node.currentTime).toBe(2); expect(host.querySelector('mark')?.textContent).toBe('第二段。'); expect(node.play).not.toHaveBeenCalled()
    await act(async () => { node.currentTime = 2.25; stops.get(props.track.clipKey)!(); props = { ...props, url: undefined }; render() })
    expect(remember).toHaveBeenCalledWith(props.track.clipKey, 2.25); expect(host.querySelector('audio')).toBeNull(); expect(host.querySelector('mark')).toBeNull()
    expect(host.textContent).toContain(props.track.fallbackText); expect(frames.size).toBe(0)
    await act(async () => { props = { ...props, url: 'blob:caption-again', resumeSeconds: 2.25 }; render() })
    const resumed = host.querySelector('audio')!; Object.defineProperty(resumed, 'duration', { configurable: true, value: 4 })
    await act(async () => resumed.dispatchEvent(new Event('loadedmetadata')))
    expect(resumed.currentTime).toBe(2.25); expect(resumed.play).not.toHaveBeenCalled(); expect(resumed.paused).toBe(true)
  })
  it('cancels the voice frame loop and stops the actual element when decoding fails or its URL is removed', async () => {
    const stops = new Map<string, TtrpgLocalAudioStopV1>()
    const register = (key: string, stop: TtrpgLocalAudioStopV1 | null) => { if (stop) stops.set(key, stop); else stops.delete(key) }
    let props: Parameters<typeof TtrpgOpenAudioPlayer>[0] = { track: track(), url: 'blob:frames', failed: false, resumeSeconds: 0, register, remember: vi.fn(), onFailure: () => { props = { ...props, failed: true }; render() } }
    const render = () => root.render(createElement(TtrpgOpenAudioPlayer, props))
    await act(async () => render())
    const node = host.querySelector('audio')!; Object.defineProperty(node, 'paused', { configurable: true, value: false })
    await act(async () => { node.currentTime = 0.2; node.dispatchEvent(new Event('play')) }); expect(frames.size).toBe(1)
    await act(async () => { node.currentTime = 2.4; tick(200) }); expect(host.querySelector('mark')?.textContent).toBe('第二段。')
    await act(async () => node.dispatchEvent(new Event('pause'))); expect(frames.size).toBe(1)
    await act(async () => node.dispatchEvent(new Event('error')))
    expect(frames.size).toBe(0); expect(stops.size).toBe(0); expect(node.pause).toHaveBeenCalled(); expect(node.getAttribute('src')).toBeNull()
    expect(host.querySelector('audio')).toBeNull(); expect(host.textContent).toContain(props.track.fallbackText)
  })
  it('fades only after actual play and respects a native user volume change without later restoring over it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const node = document.createElement('audio'); Object.defineProperty(node, 'paused', { configurable: true, value: false }); node.volume = 0.8
    const stop = startTtrpgAudioFadeInV1(node, 1000); expect(node.volume).toBe(0)
    tick(500); expect(node.volume).toBeCloseTo(0.4)
    node.volume = 0.2; node.dispatchEvent(new Event('volumechange')); expect(frames.size).toBe(0)
    tick(1000); stop(); expect(node.volume).toBe(0.2)
    const next = startTtrpgAudioFadeInV1(node, 1000); tick(250); expect(node.volume).toBeCloseTo(0.05)
    next(); expect(node.volume).toBe(0.2); expect(frames.size).toBe(0)
    const pausedChange = startTtrpgAudioFadeInV1(node, 1000)
    node.volume = 0.3; Object.defineProperty(node, 'paused', { configurable: true, value: true }); tick(500); pausedChange()
    expect(node.volume).toBe(0.3); expect(frames.size).toBe(0)
    Object.defineProperty(node, 'paused', { configurable: true, value: true }); startTtrpgAudioFadeInV1(node, 1000)
    expect(node.volume).toBe(0.3); expect(frames.size).toBe(0)
  })
  it('bounds ephemeral bookmarks and ignores invalid positions without storing files or creating playback', () => {
    const marks = new Map<string, number>()
    for (let n = 0; n < 12; n++) rememberTtrpgAudioPositionV1(marks, `clip.${n}`, n)
    expect([...marks.keys()]).toEqual(['clip.4', 'clip.5', 'clip.6', 'clip.7', 'clip.8', 'clip.9', 'clip.10', 'clip.11'])
    rememberTtrpgAudioPositionV1(marks, 'clip.4', 42); rememberTtrpgAudioPositionV1(marks, 'bad', NaN)
    expect(marks.size).toBe(8); expect(marks.get('clip.4')).toBe(42); expect(marks.has('bad')).toBe(false)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })
})
