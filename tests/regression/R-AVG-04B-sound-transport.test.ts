import { afterEach, describe, expect, it, vi } from 'vitest'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'
import { avgSoundWireFixtureV1, avgSoundLibraryFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { createConfiguredAvgSoundTransportV1, resolveAvgLocalMusicCapabilityV1, avgSoundFromBase64V1 } from '../../src/lib/avg/sound-transport'
import { parseAvgLocalMusicCapabilityV1, validateAvgSoundProviderResultV1 } from '../../src/lib/avg/sound-provider-contract'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
async function fixture(library = false, options: Parameters<typeof avgSoundWireFixtureV1>[1] = {}) {
  const s = await avgSoundProductionFixtureV1(library), sound = s.brief.avgSoundPlanning!
  sound.scope.librarySources = [avgSoundLibraryFixtureV1().source]
  const compiled = await compileAvgSoundRequirementsV1(sound.scope, { ...s.plan, entries: library ? s.plan.entries.filter(e => e.librarySourceKey !== null) : s.plan.entries })
  const req = compiled.requirements.find(r => r.dispatch.operation === (library ? 'import-licensed-audio' : 'generate-music'))!
  const wire = await avgSoundWireFixtureV1(req, options)
  if (!library) Object.assign(sound.musicBinding!, wire.route)
  const transport = createConfiguredAvgSoundTransportV1({ declaration: sound, fetcher: wire.fetcher })
  const call = { requirement: req, idempotencyKey: 'sound.protocol.once', signal: new AbortController().signal, onResponse: vi.fn(async (_evidence: string) => {}) }
  return { ...s, sound, compiled, req, ...wire, transport, call }
}
describe('AVG original local sound transport with controlled protocol responses', () => {
  it('preflights metadata without loading a model and sends one exact frozen music request before recording original PCM', async () => {
    const s = await fixture(); expect(s.fetcher).not.toHaveBeenCalled(); expect(Object.isFrozen(s.transport.binding)).toBe(true)
    const resolved = await resolveAvgLocalMusicCapabilityV1(s.fetcher)
    expect(resolved.binding.bindingHash).toBe(s.sound.musicBinding!.bindingHash)
    expect(s.fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    const response = await s.transport.request(s.call)
    expect(response.costUsd).toBe(0); expect(Buffer.from(response.body).equals(Buffer.from(s.body))).toBe(true)
    const posts = s.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0][1]!.body))).toEqual(s.req.dispatch.operation === 'generate-music' ? s.req.dispatch.body : null)
    expect(posts[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
    const original = JSON.parse(s.call.onResponse.mock.calls[0][0]); expect(original).toMatchObject({ bodyComplete: true, automaticRetryAllowed: false, bodyOmitted: null })
    expect(Buffer.from(avgSoundFromBase64V1(original.bodyBase64)).equals(Buffer.from(s.body))).toBe(true)
    expect(original.result).toMatchObject({ hearing: 'unobserved', rightsReview: 'unreviewed', authorAdopted: false })
  })
  it('reads one exact original CC0 member, licence and bytes with zero model calls and no music capability', async () => {
    const s = await fixture(true), response = await s.transport.request(s.call)
    expect(s.transport.binding).toBeNull(); expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.fetcher.mock.calls[0][1]!.method).toBe('GET')
    expect(response.contentType).toBe('audio/ogg'); expect(new Uint8Array(response.body)).toEqual(new Uint8Array(s.library.data))
    expect(JSON.parse(s.call.onResponse.mock.calls[0][0]).result).toEqual(s.library.result)
    await expect(validateAvgSoundProviderResultV1({ requirement: s.req, data: s.body, result: { ...s.library.result, license: 'unknown' }, jobId: null, bridgeHash: null })).rejects.toThrow(/许可|字节/)
  })
  it('rejects changed bridge/model/retry identities before the single POST', async () => {
    const s = await fixture()
    for (const patch of [{ bridgeHash: 'f'.repeat(64) }, { journalId: 'f'.repeat(64) }, { model: 'different' }, { automaticRetries: 1 }]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...s.capability, ...patch }), { headers: { 'content-type': 'application/json' } }))
      await expect(createConfiguredAvgSoundTransportV1({ declaration: s.sound, fetcher }).request(s.call)).rejects.toMatchObject({ disposition: 'not-dispatched' })
      expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]).toBeDefined()
    }
    expect(() => parseAvgLocalMusicCapabilityV1({ ...s.capability, extra: true })).toThrow()
    expect(s.call.onResponse).not.toHaveBeenCalled()
  })
  it('keeps original V1 capability bytes readable but refuses preparing or dispatching a new unjournaled request', async () => {
    const s = await fixture(), { journalId: _journal, ...old } = s.capability, legacy = { ...old, version: 1 }
    expect(parseAvgLocalMusicCapabilityV1(legacy)).not.toHaveProperty('journalId')
    const fetcher = vi.fn(async () => new Response(JSON.stringify(legacy), { headers: { 'content-type': 'application/json' } }))
    await expect(resolveAvgLocalMusicCapabilityV1(fetcher)).rejects.toThrow(/只读/)
    await expect(createConfiguredAvgSoundTransportV1({ declaration: s.sound, fetcher }).request(s.call)).rejects.toMatchObject({ disposition: 'not-dispatched' })
    expect(fetcher).toHaveBeenCalledTimes(2); expect(s.call.onResponse).not.toHaveBeenCalled()
  })
  it('records corrupt complete original music evidence without producing a candidate or retrying', async () => {
    const s = await fixture(false, { wrongHash: true })
    await expect(s.transport.request(s.call)).rejects.toMatchObject({ disposition: 'response-recorded' })
    expect(s.call.onResponse).toHaveBeenCalledOnce(); expect(s.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('preserves unknown dispatch and refuses implicit replay when transport or durable recording fails', async () => {
    const s = await fixture(false, { networkFailure: true })
    await expect(s.transport.request(s.call)).rejects.toMatchObject({ disposition: 'result-unknown' })
    expect(s.call.onResponse).not.toHaveBeenCalled(); expect(s.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    const t = await fixture(); await expect(t.transport.request({ ...t.call, onResponse: async () => { throw new Error('fixture storage full') } })).rejects.toMatchObject({ disposition: 'result-unknown' })
    expect(t.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('does not dispatch cancelled, unsafe or unreviewed member input', async () => {
    const s = await fixture(), c = new AbortController(); c.abort()
    await expect(s.transport.request({ ...s.call, signal: c.signal })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    await expect(s.transport.request({ ...s.call, idempotencyKey: '../bad' })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    const library = await fixture(true), wrong = structuredClone(library.req)
    if (wrong.dispatch.operation === 'import-licensed-audio') wrong.dispatch.source.memberPath = 'Preview.ogg'
    await expect(library.transport.request({ ...library.call, requirement: wrong })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    expect(s.fetcher).not.toHaveBeenCalled(); expect(library.fetcher).not.toHaveBeenCalled()
  })
  it('bounds an identity fetch that ignores cancellation, with no production dispatch', async () => {
    const s = await fixture(), fetcher = vi.fn(() => new Promise<Response>(() => {}))
    const transport = createConfiguredAvgSoundTransportV1({ declaration: s.sound, fetcher })
    vi.useFakeTimers(); const check = expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'not-dispatched' })
    await vi.advanceTimersByTimeAsync(5000); await check; expect(fetcher).toHaveBeenCalledOnce()
  })
  it('persists the actual journal preflight before POST and refuses dispatch if that durable boundary fails', async () => {
    const s = await fixture(), observed: unknown[] = []
    await expect(s.transport.request({ ...s.call, beforeDispatch: async capability => {
      observed.push(capability); throw new Error('engineering snapshot storage unavailable')
    } })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    expect(observed).toEqual([s.capability]); expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.call.onResponse).not.toHaveBeenCalled()
  })
})
