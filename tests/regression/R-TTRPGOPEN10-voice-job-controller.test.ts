import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTtrpgOpenVoiceJobControllerV1 } from '../../src/lib/ttrpg/open-voice-job-controller'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'

const identity = () => ({ jobKey: 'ttrpg.voice.7.' + 'a'.repeat(64), inputArtifactHash: 'a'.repeat(64) })
const observed = () => ({ ...identity(), profileHash: 'b'.repeat(64), status: 'cancelled-confirmed', canStart: false,
  cancellationRequested: true, cancellationConfirmed: true, hasResultFile: false, automaticRetryAllowed: false })
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
describe('R-TTRPGOPEN10 original job stop transport', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  it('accepts observed closure for an exact partial control identity through one explicit cancel endpoint only', async () => {
    const fetcher = vi.fn(async () => response(observed())); vi.stubGlobal('fetch', fetcher)
    expect(await createTtrpgOpenVoiceJobControllerV1().stop(identity())).toEqual(observed())
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/storyforge/local-tts/v1/jobs/' + identity().jobKey + '/cancel')
    expect(init.method).toBe('POST'); expect(JSON.parse(init.body as string)).toEqual({ decision: 'request-stop-original-local-voice-job' })
  })
  it('captures the original stop identity before a response can yield back to caller mutation', async () => {
    const input = identity(); let complete!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const result = createTtrpgOpenVoiceJobControllerV1().stop(input)
    input.jobKey = 'ttrpg.voice.8.' + 'c'.repeat(64); input.inputArtifactHash = 'c'.repeat(64)
    complete(response(observed())); expect(await result).toEqual(observed())
  })
  it.each([{ inputArtifactHash: 'c'.repeat(64) }, { jobKey: 'ttrpg.voice.8.' + 'a'.repeat(64) },
    { status: 'unknown', cancellationConfirmed: true }, { profileHash: 'invalid' }, { execution: 'extra authority' }])('rejects a replaced identity or false closure: %j', async patch => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...observed(), ...patch })))
    await expect(createTtrpgOpenVoiceJobControllerV1().stop(identity())).rejects.toThrow()
  })
  it('requires a supplied historical profile to match and never treats missing-job cancellation as real closure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(observed())))
    await expect(createTtrpgOpenVoiceJobControllerV1().stop({ ...identity(), profileHash: 'c'.repeat(64) })).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => response({ jobKey: identity().jobKey, status: 'stop-requested-without-job', canStart: false,
      futureStartBlocked: true, cancellationConfirmed: true })))
    await expect(createTtrpgOpenVoiceJobControllerV1().stop(identity())).rejects.toThrow()
  })
  it('bounds unanswered stops by the original deadline and does not retry a lost request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const result = expect(createTtrpgOpenVoiceJobControllerV1().stop(identity())).rejects.toThrow(/传输期限/)
    await vi.advanceTimersByTimeAsync(profile.statusRequestTimeoutMs); await result
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retrieves unparsed original raw bytes through one explicit recovery endpoint and captures identity before yielding', async () => {
    const input = { ...identity(), profileHash: 'b'.repeat(64) }, content = '\uFEFF raw\n原始字节 '
    let complete!: (r: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { complete = resolve })); vi.stubGlobal('fetch', fetcher)
    const result = createTtrpgOpenVoiceJobControllerV1().recoverRaw(input)
    input.jobKey = 'ttrpg.voice.8.' + 'c'.repeat(64); input.inputArtifactHash = 'c'.repeat(64)
    complete(new Response(content, { headers: { 'Content-Type': 'application/json' } }))
    expect(await result).toBe(content); expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/storyforge/local-tts/v1/jobs/' + identity().jobKey + '/recover-raw')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'recover-original-complete-raw-without-resending', inputArtifactHash: identity().inputArtifactHash })
  })
  it('requires a full raw-reading identity, bounds the envelope, and never retries a lost fetch', async () => {
    const input = { ...identity(), profileHash: 'b'.repeat(64) }
    const fetcher = vi.fn(async () => { throw new Error('unknown-raw-http') }); vi.stubGlobal('fetch', fetcher)
    await expect(createTtrpgOpenVoiceJobControllerV1().recoverRaw({ ...input, profileHash: '' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(createTtrpgOpenVoiceJobControllerV1().recoverRaw(input)).rejects.toThrow('unknown-raw-http')
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oversized', { headers: { 'Content-Type': 'application/json',
      'Content-Length': String(Math.ceil(profile.maxAudioBytes / 3) * 4 + 1048577) } })))
    await expect(createTtrpgOpenVoiceJobControllerV1().recoverRaw(input)).rejects.toThrow(/超过/)
  })
})
