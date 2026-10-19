import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceAuditionPlayer from '../../src/components/avg/VoiceAuditionPlayer'
import * as decoder from '../../src/lib/avg/voice-decoder'
import type { AvgNativeAuditionObservationV1 } from '../../src/lib/avg/voice-audition'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Root[] = []
const data = new ArrayBuffer(48_044)
// The actual browser decoder is mocked only for these React event/lifetime
// tests. Real byte/hash/PCM tests and isolated native playback remain separate.
const decoded = () => ({ data, measurement: { decoder: 'storyforge.avg.pcm16-browser.v1' as const,
  contentHash: 'a'.repeat(64), mimeType: 'audio/wav' as const, byteSize: data.byteLength,
  durationMs: 1000, channelCount: 1, sourceSampleRateHz: 24_000, decodedSampleRateHz: 48_000,
  sampleCount: 24_000, integratedLufs: -18, truePeakDbtp: -12 } })

beforeEach(() => {
  vi.spyOn(decoder, 'inspectAvgVoiceBytesV1').mockImplementation(async () => decoded())
  let urls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:avg-audition-fixture-${++urls}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
  })
})
afterEach(async () => { for (const root of mounted.splice(0)) await act(async () => root.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })

function setSample(audio: HTMLAudioElement, position: number, patch: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries({ currentTime: position / 1000, duration: 1, muted: false, volume: 1,
    playbackRate: 1, seeking: false, ended: false, paused: false, ...patch })) {
    Object.defineProperty(audio, key, { value, configurable: true })
  }
}
async function event(audio: HTMLAudioElement, name: string, position: number, patch: Record<string, unknown> = {}) {
  await act(async () => { setSample(audio, position, patch); audio.dispatchEvent(new Event(name)) })
}
async function setup() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push(root)
  type Observation = { audioHash: string; requestIdentityHash: string; audition: AvgNativeAuditionObservationV1 } | null
  let latest: Observation = null
  const onObservation = vi.fn((value: Observation) => { latest = value })
  const props = { sourceKey: 'work.1.build.1.epoch.0.raw.1', data, assetKey: 'voice.desk', contentHash: 'a'.repeat(64), requestIdentityHash: 'b'.repeat(64),
    durationMs: 1000, maximumDurationMs: 30_000, text: '封口仍在。', onObservation }
  await act(async () => root.render(<VoiceAuditionPlayer {...props} />))
  const fresh = async () => { await act(async () => host.querySelector('button')!.click()); return host.querySelector('audio')! }
  return { host, root, props, fresh, onObservation, latest: () => latest }
}

describe('AVG private native audition control lifecycle', () => {
  it('does not autoplay or infer a pass from decoding, and creates a fresh actual audio element only on author action', async () => {
    const s = await setup()
    expect(s.host.querySelector('audio')).toBeNull(); expect(s.latest()).toBeNull()
    expect(s.host.textContent).toContain('封口仍在。')
    const audio = await s.fresh()
    expect(audio.autoplay).toBe(false); expect(audio.controls).toBe(true); expect(s.latest()).toBeNull()
    await event(audio, 'ended', 1000, { ended: true })
    expect(s.latest()).toBeNull()
    await event(audio, 'playing', 0); await event(audio, 'timeupdate', 400)
    expect(s.latest()!.audition).toMatchObject({ playedMs: 400, outcome: 'interrupted' })
    await event(audio, 'pause', 1000, { paused: true }); await event(audio, 'ended', 1000, { ended: true, paused: true })
    expect(s.latest()).toMatchObject({ audioHash: s.props.contentHash, requestIdentityHash: s.props.requestIdentityHash,
      audition: { playedMs: 1000, outcome: 'ended', muted: false, seeked: false, playbackRate: 1 } })
    expect(s.host.textContent).toContain('仍须作者逐项判断')
  })

  it.each(['mute', 'rate', 'seek'])('latches a native %s event even after the final properties return to normal', async variant => {
    const s = await setup(), audio = await s.fresh()
    await event(audio, 'playing', 0); await event(audio, 'timeupdate', 400)
    if (variant === 'mute') await event(audio, 'volumechange', 400, { muted: true })
    if (variant === 'rate') await event(audio, 'ratechange', 400, { playbackRate: 2 })
    if (variant === 'seek') await event(audio, 'seeking', 800, { seeking: true })
    await event(audio, 'timeupdate', 900); await event(audio, 'ended', 1000, { ended: true })
    expect(s.latest()!.audition.outcome).toBe('interrupted')
    const old = audio, previous = s.latest()!.audition.generation, fresh = await s.fresh()
    expect(fresh).not.toBe(old); expect(s.latest()).toBeNull()
    await event(old, 'ended', 1000, { ended: true })
    expect(s.latest()).toBeNull()
    await event(fresh, 'playing', 0); await event(fresh, 'ended', 1000, { ended: true })
    expect(s.latest()!.audition.outcome).toBe('ended'); expect(s.latest()!.audition.generation).not.toBe(previous)
  })

  it('interrupts background playback and cannot reuse the sealed generation by pressing native play again', async () => {
    const s = await setup(), audio = await s.fresh()
    await event(audio, 'playing', 0); await event(audio, 'timeupdate', 300)
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    expect(audio.paused).toBe(true); expect(s.latest()!.audition.outcome).toBe('interrupted')
    await event(audio, 'ended', 1000, { ended: true })
    expect(s.latest()!.audition.outcome).toBe('interrupted')
    await event(audio, 'playing', 0)
    expect(s.latest()).toBeNull(); expect(audio.paused).toBe(true)
    expect(s.host.textContent).toContain('上一轮审听已结束或中断')
  })

  it.each(['request', 'owner'])('cancels changed %s playback, clears its observation and revokes only its own object URL', async variant => {
    const s = await setup(), old = await s.fresh()
    await event(old, 'playing', 0); await event(old, 'timeupdate', 400)
    const changed = variant === 'request' ? { requestIdentityHash: 'c'.repeat(64) } : { sourceKey: 'work.2.build.1.epoch.0.raw.1' }
    await act(async () => s.root.render(<VoiceAuditionPlayer {...s.props} {...changed} />))
    expect(old.paused).toBe(true); expect(s.latest()).toBeNull(); expect(s.host.querySelector('audio')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avg-audition-fixture-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:avg-audition-fixture-2')
    await event(old, 'ended', 1000, { ended: true }); expect(s.latest()).toBeNull()
    const fresh = await s.fresh(); await event(fresh, 'playing', 0); await event(fresh, 'ended', 1000, { ended: true })
    expect(s.latest()!.requestIdentityHash).toBe(variant === 'request' ? 'c'.repeat(64) : s.props.requestIdentityHash)
  })

  it('holds a disabled control and interrupts active audio instead of allowing hidden playback observations', async () => {
    const s = await setup(), audio = await s.fresh()
    await event(audio, 'playing', 0); await event(audio, 'timeupdate', 300)
    await act(async () => s.root.render(<VoiceAuditionPlayer {...s.props} disabled />))
    expect(audio.paused).toBe(true); expect(audio.controls).toBe(false); expect(s.host.querySelector('button')!.disabled).toBe(true)
    await event(audio, 'playing', 300)
    expect(s.latest()).toBeNull(); expect(audio.paused).toBe(true)
    await event(audio, 'playing', 300)
    expect(s.latest()).toBeNull(); expect(audio.paused).toBe(true)
  })

  it('shows decoding/native duration failures without producing a selectable audition', async () => {
    vi.mocked(decoder.inspectAvgVoiceBytesV1).mockRejectedValueOnce(new Error('bad bytes'))
    const broken = await setup()
    expect(broken.host.querySelector('button')!.disabled).toBe(true); expect(broken.latest()).toBeNull()
    expect(broken.host.querySelector('[role="alert"]')!.textContent).toContain('实际解码检查失败')
    const s = await setup(), audio = await s.fresh()
    await event(audio, 'playing', 0, { duration: 2 })
    expect(s.latest()).toBeNull(); expect(audio.paused).toBe(true)
    expect(s.host.querySelector('[role="alert"]')!.textContent).toContain('播放观察与准确音频不一致')
  })

  it('discards late decoder results after unmount and does not leak a URL or publish a late callback', async () => {
    let complete!: (value: ReturnType<typeof decoded>) => void
    vi.mocked(decoder.inspectAvgVoiceBytesV1).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const s = await setup()
    await act(async () => s.root.unmount()); mounted.splice(mounted.indexOf(s.root), 1)
    const calls = s.onObservation.mock.calls.length
    await act(async () => { complete(decoded()); await Promise.resolve() })
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(s.onObservation).toHaveBeenCalledTimes(calls)
    expect(vi.mocked(decoder.inspectAvgVoiceBytesV1).mock.calls[0]![0].signal!.aborted).toBe(true)
  })
})
