import { afterEach, describe, expect, it, vi } from 'vitest'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { hashAvgSpeechProtocolV1, compileAvgVoiceSpeechRequestV1 } from '../../src/lib/avg/voice-request-contract'
import { AVG_VOICE_NETWORK_TIMEOUT_MS_V1, AVG_VOICE_TASK_TIMEOUT_MS_V1 } from '../../src/lib/avg/voice-request-contract'
import { avgVoiceRouteBindingHashV1 } from '../../src/lib/avg/voice-assembly-contract'
import { AvgVoiceTransportErrorV1, configuredAvgVoiceEndpointHashV1, createConfiguredAvgVoiceTransportV1 } from '../../src/lib/avg/voice-transport'

// Original short PCM tone, not speech, actual account access or author review.
function pcm() {
  const bytes = new Uint8Array(444), view = new DataView(bytes.buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index)
  }
  view.setUint32(4, 436, true); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 400, true)
  for (let index = 0; index < 200; index++) view.setInt16(44 + index * 2, Math.round(8000 * Math.sin(index / 10)), true)
  return bytes
}

async function fixture() {
  const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(), capability = capabilities[0]!
  const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1', apiKey: 'private-fixture-value-never-returned' }
  const p = assembly.voice.protocol
  p.provider = 'agnes'; p.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: p.model })
  capability.capabilityHash = await hashAvgSpeechProtocolV1(p)
  for (const preset of assembly.voice.batch.presets) Object.assign(preset, { provider: 'agnes', endpointRouteHash: p.endpointRouteHash, capabilityHash: capability.capabilityHash })
  assembly.voice.binding.endpointRouteHash = p.endpointRouteHash
  assembly.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: capability.requirementKey,
    adapterId: p.adapterId, capabilityHash: capability.capabilityHash, endpointRouteHash: p.endpointRouteHash })
  const request = await compileAvgVoiceSpeechRequestV1(assembly.voice.batch, 'keeper.line', p)
  return { assembly, capability, config, request, call: { requirementKey: 'keeper.line', requestIdentityHash: request.identityHash,
    idempotencyKey: 'avg.voice.fixture.run.1', signal: new AbortController().signal, onResponse: vi.fn(async (_evidence: string) => {}) } }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('AVG BASE-02 private single-dispatch configured speech transport', () => {
  it('sends the exact Unicode-preserving body once and stores the real bounded bytes before accepting the container', async () => {
    const s = await fixture(), requirement = s.assembly.voice.batch.requirements[0]!
    requirement.text = 'e\u0301，封口仍在。'; requirement.textHash = await hashAvgVoiceTextV1(requirement.text)
    const request = await compileAvgVoiceSpeechRequestV1(s.assembly.voice.batch, requirement.requirementKey, s.assembly.voice.protocol)
    const bytes = pcm(), fetcher = vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': 'fixture.1' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    const result = await transport.request({ ...s.call, requestIdentityHash: request.identityHash })
    expect(fetcher).toHaveBeenCalledOnce(); expect(s.call.onResponse).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]).toEqual(['https://speech.fixture.invalid/v1/audio/speech', expect.objectContaining({
      method: 'POST', body: request.requestBodyJson, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${s.config.apiKey}`, 'Content-Type': 'application/json', 'x-storyforge-idempotency-key': s.call.idempotencyKey },
    })])
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body)).input).toBe(requirement.text)
    const evidence = JSON.parse(s.call.onResponse.mock.calls[0]![0])
    expect(evidence).toMatchObject({ bodyComplete: true, bodyOmitted: null, hashScope: 'full-body', observedBytes: bytes.length, costUsd: null, usage: null })
    expect(Array.from(Uint8Array.from(atob(evidence.bodyBase64), c => c.charCodeAt(0)))).toEqual(Array.from(bytes))
    expect(new Uint8Array(result.body)).toEqual(bytes); expect(result.costUsd).toBeNull()
    expect(JSON.stringify(transport.binding) + JSON.stringify(evidence)).not.toContain(s.config.apiKey)
  })

  it('refuses a changed route, unknown/finitely capped cost, other provider or missing credential before dispatch', async () => {
    for (const patch of [
      { config: { ...(await fixture()).config, baseUrl: 'https://changed.fixture.invalid/v1' } },
      { config: { ...(await fixture()).config, provider: 'openai' as const } },
      { config: { ...(await fixture()).config, apiKey: '' } },
      { capability: { ...(await fixture()).capability, maximumRequestCost: 1 } },
      { capability: { ...(await fixture()).capability, maximumTotalCost: 1 } },
    ]) {
      const s = await fixture(), fetcher = vi.fn()
      await expect(createConfiguredAvgVoiceTransportV1({ ...s, ...patch, fetcher })).rejects.toThrow()
      expect(fetcher).not.toHaveBeenCalled()
    }
    for (const baseUrl of ['http://remote.fixture.invalid/v1', 'https://user:password@fixture.invalid/v1',
      'https://fixture.invalid/v1?key=value', 'https://fixture.invalid/v1#fragment', '/relative/v1']) {
      await expect(configuredAvgVoiceEndpointHashV1({ baseUrl, model: 'explicit-model' })).rejects.toThrow()
    }
    for (const baseUrl of ['http://127.0.0.1:5196/v1', 'http://localhost:5196/v1', 'http://[::1]:5196/v1']) {
      await expect(configuredAvgVoiceEndpointHashV1({ baseUrl, model: 'explicit-model' })).resolves.toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('rejects a stale request identity, unsafe idempotency key or cancelled input without fetching', async () => {
    const s = await fixture(), fetcher = vi.fn(), transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    const stopped = new AbortController(); stopped.abort()
    for (const patch of [{ requestIdentityHash: 'a'.repeat(64) }, { idempotencyKey: 'unsafe\r\nvalue' }, { signal: stopped.signal }]) {
      await expect(transport.request({ ...s.call, ...patch })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(s.call.onResponse).not.toHaveBeenCalled()
  })

  it.each([401, 402, 429, 500])('records one explicit HTTP %i response and never retries or changes route', async status => {
    const s = await fixture(), fetcher = vi.fn(async () => new Response('{"error":"fixture failure"}', { status, headers: { 'Content-Type': 'application/json' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    await expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'response-recorded', response: { status, costUsd: null } })
    expect(fetcher).toHaveBeenCalledOnce(); expect(s.call.onResponse).toHaveBeenCalledOnce()
  })

  it('keeps unknown results reserved after a network failure, stale receipt or failed evidence persistence', async () => {
    const s = await fixture()
    for (const variant of ['network', 'stale', 'storage']) {
      const fetcher = vi.fn(async () => { if (variant === 'network') throw new Error(s.config.apiKey); return new Response(pcm(), { headers: { 'Content-Type': 'audio/wav' } }) })
      const onResponse = vi.fn(async () => { if (variant === 'storage') throw new Error('storage'); return 'discarded-stale' as const })
      const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
      const error = await transport.request({ ...s.call, onResponse }).catch(e => e)
      expect(error).toBeInstanceOf(AvgVoiceTransportErrorV1); expect(error.disposition).toBe('result-unknown')
      expect(error.message).not.toContain(s.config.apiKey); expect(fetcher).toHaveBeenCalledOnce()
    }
  })

  it('records complete corrupt container data before rejecting it, without decoding or listening claims', async () => {
    const s = await fixture(), fetcher = vi.fn(async () => new Response('not a wave', { headers: { 'Content-Type': 'audio/wav' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    await expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'response-recorded' })
    expect(JSON.parse(s.call.onResponse.mock.calls[0]![0]).bodyBase64).toBe(btoa('not a wave'))
  })

  it('omits unsafe raw bodies and usage instead of hiding credentials in base64 evidence', async () => {
    for (const variant of ['body', 'usage']) {
      const s = await fixture(), fetcher = vi.fn(async () => new Response(variant === 'body' ? JSON.stringify({ apiKey: s.config.apiKey }) : pcm(),
        { status: variant === 'body' ? 400 : 200, headers: { 'Content-Type': 'audio/wav',
          ...(variant === 'usage' ? { 'x-storyforge-usage': JSON.stringify({ apiKey: 'short-secret' }) } : {}) } }))
      const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
      await expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'response-recorded' })
      const text = s.call.onResponse.mock.calls[0]![0], evidence = JSON.parse(text)
      expect(text).not.toContain(s.config.apiKey); expect(text).not.toContain('short-secret')
      if (variant === 'body') { expect(evidence.bodyBase64).toBeNull(); expect(evidence.bodyOmitted).toBe('policy') }
      else { expect(evidence.usage).toBeNull(); expect(evidence.omissions).toContain('usage-policy') }
    }
  })

  it('retains finite returned actual cost and distinguishes it from absent cost', async () => {
    const s = await fixture(), fetcher = vi.fn(async () => new Response(pcm(), { headers: { 'Content-Type': 'audio/x-wav',
      'x-storyforge-cost-usd': '0.0042', 'x-storyforge-usage': '{"input_characters":5}' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher }), result = await transport.request(s.call)
    expect(result.costUsd).toBe(0.0042); expect(result.usage).toEqual({ input_characters: 5 })
  })

  it('bounds a fetch that ignores AbortSignal and never silently dispatches again', async () => {
    const s = await fixture(), fetcher = vi.fn(() => new Promise<Response>(() => {}))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    vi.useFakeTimers()
    const operation = transport.request(s.call), check = expect(operation).rejects.toMatchObject({ disposition: 'result-unknown' })
    expect(AVG_VOICE_TASK_TIMEOUT_MS_V1 - AVG_VOICE_NETWORK_TIMEOUT_MS_V1).toBeGreaterThanOrEqual(30_000)
    await vi.advanceTimersByTimeAsync(AVG_VOICE_NETWORK_TIMEOUT_MS_V1); await check
    expect(fetcher).toHaveBeenCalledOnce(); expect(s.call.onResponse).not.toHaveBeenCalled()
  })

  it('preserves an interrupted body as explicit prefix evidence without claiming a complete audio result', async () => {
    const s = await fixture()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })
    stream.enqueue(pcm().subarray(0, 44))
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'audio/wav' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher }), controller = new AbortController()
    const operation = transport.request({ ...s.call, signal: controller.signal })
    const check = expect(operation).rejects.toMatchObject({ disposition: 'result-unknown' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort(); await check
    const evidence = JSON.parse(s.call.onResponse.mock.calls[0]![0])
    expect(evidence).toMatchObject({ bodyComplete: false, bodyBase64: null, hashScope: 'retained-prefix', bodyOmitted: 'body-interrupted' })
  })

  it('stops at the binary response limit and cannot call an oversized body a received audio candidate', async () => {
    const s = await fixture(), cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)) }, cancel: cancelled })
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'audio/wav' } }))
    const transport = await createConfiguredAvgVoiceTransportV1({ ...s, fetcher })
    await expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'result-unknown' })
    expect(cancelled).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce()
    const evidence = JSON.parse(s.call.onResponse.mock.calls[0]![0])
    expect(evidence).toMatchObject({ bodyComplete: false, bodyBase64: null, observedBytes: 32 * 1024 * 1024 + 1,
      hashScope: 'retained-prefix', bodyOmitted: 'body-limit' })
  })
})
