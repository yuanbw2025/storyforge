import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Settings from '../../src/components/ttrpg/TtrpgNarrationListeningSettings'
import Player from '../../src/components/ttrpg/TtrpgOpenAudioPlayer'
import { readTtrpgNarrationRateV1, saveTtrpgNarrationRateV1, readTtrpgNarratorVoiceV1, saveTtrpgNarratorVoiceV1 } from '../../src/lib/ttrpg/narration-listening-preferences'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(() => {
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks() })

it('pre-game fixed preview defaults slower, preserves pitch and remembers a real selectable rate without playing on save/remount', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  await act(async () => root.render(createElement(Settings)))
  let audio = host.querySelector('audio')!
  expect(audio.playbackRate).toBe(0.9); expect(audio.preservesPitch).toBe(true); expect(audio.autoplay).toBe(false); expect(audio.preload).toBe('none')
  const select = host.querySelector('select[aria-label="旁白语速"]')! as HTMLSelectElement
  await act(async () => { select.value = '0.8'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(readTtrpgNarrationRateV1()).toBe(0.8); expect(audio.playbackRate).toBe(0.8)
  await act(async () => root.render(createElement(Settings, { key: 'new-visit' })))
  audio = host.querySelector('audio')!
  expect(audio.playbackRate).toBe(0.8); expect(audio.paused).toBe(true); expect(play).not.toHaveBeenCalled()
})
it('switches between actual distinct native voice files, stops the old sample and preserves both choices on remount', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  await act(async () => root.render(createElement(Settings)))
  const male = host.querySelector('audio')!, source = male.src, pause = vi.spyOn(male, 'pause')
  const select = host.querySelector('select[aria-label="旁白试听声线"]')! as HTMLSelectElement
  await act(async () => { select.value = 'qwen.serena'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  const female = host.querySelector('audio')!, stopped = pause.mock.calls.length
  expect(pause).toHaveBeenCalled(); expect(female).not.toBe(male); expect(female.src).not.toBe(source)
  expect(readTtrpgNarratorVoiceV1()).toBe('qwen.serena'); expect(female.playbackRate).toBe(0.9)
  await act(async () => saveTtrpgNarrationRateV1(0.8))
  expect(readTtrpgNarratorVoiceV1()).toBe('qwen.serena'); expect(female.playbackRate).toBe(0.8)
  expect(pause.mock.calls.length).toBe(stopped); expect(play).not.toHaveBeenCalled()
  await act(async () => root.render(createElement(Settings, { key: 'returned' })))
  expect(host.querySelector('audio')!.src).toBe(female.src)
  expect(host.querySelector('audio')!.playbackRate).toBe(0.8)
  expect((host.querySelector('select[aria-label="旁白试听声线"]') as HTMLSelectElement).value).toBe('qwen.serena')
})
it('keeps the previous rate-only preference and rejects unknown voices without silently replacing a stored choice', () => {
  localStorage.setItem('storyforge:ttrpg:narration-listening:v1', '{"version":1,"rate":0.8}')
  expect(readTtrpgNarrationRateV1()).toBe(0.8); expect(readTtrpgNarratorVoiceV1()).toBe('qwen.uncle_fu')
  saveTtrpgNarratorVoiceV1('qwen.serena'); expect(readTtrpgNarrationRateV1()).toBe(0.8)
  const saved = localStorage.getItem('storyforge:ttrpg:narration-listening:v1')
  expect(() => saveTtrpgNarratorVoiceV1('cloned.person' as any)).toThrow('支持的旁白声线')
  expect(localStorage.getItem('storyforge:ttrpg:narration-listening:v1')).toBe(saved)
})
it('stops the newly selected sample on page hide, including a choice received from another tab', async () => {
  await act(async () => root.render(createElement(Settings)))
  const previous = host.querySelector('audio')!, oldPause = vi.spyOn(previous, 'pause')
  await act(async () => {
    localStorage.setItem('storyforge:ttrpg:narration-listening:v1', '{"version":1,"rate":0.85,"voice":"qwen.serena"}')
    window.dispatchEvent(new StorageEvent('storage', { key: 'storyforge:ttrpg:narration-listening:v1' }))
  })
  expect(oldPause).toHaveBeenCalled()
  const selected = host.querySelector('audio')!, pause = vi.spyOn(selected, 'pause')
  expect(selected).not.toBe(previous); expect(selected.playbackRate).toBe(0.85)
  window.dispatchEvent(new Event('pagehide')); expect(pause).toHaveBeenCalled()
  pause.mockClear()
  await act(async () => root.render(createElement(Settings, { paused: true })))
  expect(pause).toHaveBeenCalled(); expect(selected.hasAttribute('src')).toBe(false)
})
it('an active voice responds to the preference while music keeps its own speed and original source/caption stays intact', async () => {
  const common = { clipKey: 'voice.example', channel: 'voice', durationMs: 1000, fallbackText: '原旁白文字', voiceMarks: [], fade: 0,
    generatedTimeline: null } as any
  const register = vi.fn(), remember = vi.fn()
  await act(async () => root.render(createElement('div', null,
    createElement(Player, { track: common, url: 'blob:voice', failed: false, resumeSeconds: 0, register, remember, onFailure: vi.fn() }),
    createElement(Player, { track: { ...common, clipKey: 'music.example', channel: 'music' }, url: 'blob:music', failed: false, resumeSeconds: 0, register, remember, onFailure: vi.fn() }))))
  const [voice, music] = host.querySelectorAll('audio'), originalSource = voice.src
  await act(async () => { saveTtrpgNarrationRateV1(0.75) })
  expect(voice.playbackRate).toBe(0.75); expect(voice.preservesPitch).toBe(true); expect(music.playbackRate).toBe(1)
  expect(voice.src).toBe(originalSource); expect(host.textContent).toContain('原旁白文字'); expect(voice.currentTime).toBe(0)
})
it('invalid stored values fall back safely and a safety pause or unmount stops the public sample', async () => {
  for (const raw of ['broken json', '{"version":1,"rate":99}', '{"version":2,"rate":0.8}', '{"version":1,"rate":"0.8"}']) {
    localStorage.setItem('storyforge:ttrpg:narration-listening:v1', raw); expect(readTtrpgNarrationRateV1()).toBe(0.9)
  }
  expect(() => saveTtrpgNarrationRateV1(Number.NaN)).toThrow('支持的旁白语速')
  await act(async () => root.render(createElement(Settings)))
  const audio = host.querySelector('audio')!, pause = vi.spyOn(audio, 'pause')
  await act(async () => root.render(createElement(Settings, { paused: true })))
  expect(pause).toHaveBeenCalled(); expect(audio.hasAttribute('src')).toBe(false)
})
