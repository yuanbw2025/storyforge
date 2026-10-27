import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTtrpgOpenVoiceJobReaderV1 } from '../../src/lib/ttrpg/open-voice-job-reader'

const identity = () => ({ jobKey: 'ttrpg.voice.7.' + 'a'.repeat(64), inputArtifactHash: 'a'.repeat(64), profileHash: 'b'.repeat(64) })
const found = () => ({ ...identity(), status: 'unknown', canStart: false, cancellationConfirmed: false,
  cancellationRequested: false, hasResultFile: false, workerExecutionKind: 'pinned-offline-worker', automaticRetryAllowed: false })
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
describe('R-TTRPGOPEN10 original job metadata protocol', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads the original historical identity through exactly one fixed GET, without profile negotiation or a write endpoint', async () => {
    const fetcher = vi.fn(async () => response(found())); vi.stubGlobal('fetch', fetcher)
    expect(await createTtrpgOpenVoiceJobReaderV1().read(identity())).toEqual(found())
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/storyforge/local-tts/v1/jobs/' + identity().jobKey)
    expect(init.method).toBeUndefined(); expect(init.body).toBeUndefined(); expect(init.cache).toBe('no-store')
  })
  it('freezes identity before an asynchronous response so caller mutation cannot authorize a replacement job', async () => {
    const input = identity(); let complete!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const result = createTtrpgOpenVoiceJobReaderV1().read(input)
    input.profileHash = 'c'.repeat(64); input.jobKey = 'ttrpg.voice.8.' + 'a'.repeat(64)
    complete(response(found())); expect(await result).toEqual(found())
  })
  it.each(['not-found','stop-requested-without-job'])('keeps %s separate from confirmed process closure', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ jobKey: identity().jobKey, status, canStart: false,
      cancellationConfirmed: false, futureStartBlocked: status === 'stop-requested-without-job' })))
    expect(await createTtrpgOpenVoiceJobReaderV1().read(identity())).toMatchObject({ status, cancellationConfirmed: false })
  })
  it.each([
    { profileHash: 'c'.repeat(64) }, { inputArtifactHash: 'c'.repeat(64) }, { canStart: true },
    { cancellationConfirmed: true }, { status: 'generated', cancellationConfirmed: true },
    { status: 'cancelled-confirmed', cancellationConfirmed: false }, { automaticRetryAllowed: true },
    { output: 'unrequested raw text' }, { hasResultFile: 'yes' },
  ])('rejects changed identity, contradictory completion or expanded metadata: %j', async patch => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...found(), ...patch })))
    await expect(createTtrpgOpenVoiceJobReaderV1().read(identity())).rejects.toThrow()
  })
  it('retains observed cancellation only for an actual confirmed terminal and does not reinterpret a late result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...found(), status: 'cancelled-confirmed', cancellationConfirmed: true, cancellationRequested: true })))
    expect(await createTtrpgOpenVoiceJobReaderV1().read(identity())).toMatchObject({ status: 'cancelled-confirmed', cancellationConfirmed: true })
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...found(), status: 'generated', hasResultFile: true, cancellationRequested: true })))
    expect(await createTtrpgOpenVoiceJobReaderV1().read(identity())).toMatchObject({ status: 'generated', cancellationConfirmed: false, hasResultFile: true })
  })
  it('rejects an invalid key or a pre-aborted signal without fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const reader = createTtrpgOpenVoiceJobReaderV1(), controller = new AbortController(); controller.abort()
    await expect(reader.read({ ...identity(), jobKey: 'https://external.invalid' })).rejects.toThrow()
    await expect(reader.read(identity(), controller.signal)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
