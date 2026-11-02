import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpOnlineRoomTransportV1 } from '../../src/lib/online/http-transport'
import { AuthoritativeOnlineRoomV1, type OnlineRoomCommandV1 } from '../../src/lib/online/room-authority'
import { OnlineRoomClientV1 } from '../../src/lib/online/room-client'

const waitInput = { roomId: 'sfqa114', memberId: 'gm', authToken: 'fixture', afterSequence: 0, timeoutMs: 1000 }

function hangingBody(signal: AbortSignal, onStart: () => void): Promise<never> {
  onStart()
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('body aborted', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

describe('SFQA114: timeout and cancellation cover response body consumption', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it.each(['timeout', 'caller'] as const)('classifies %s after headers and cleans up after the body fails', async mode => {
    vi.useFakeTimers()
    const caller = new AbortController()
    let bodyStarted = false
    let outcome: unknown = 'pending'
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: '/local-room-fixture', timeoutMs: 100,
      fetch: async (_url, init) => ({ ok: true, status: 200, json: () => hangingBody(init.signal, () => { bodyStarted = true }) }),
    })
    void transport.waitForAdvance({ ...waitInput, signal: caller.signal }).then(value => { outcome = value }, error => { outcome = error })
    await vi.advanceTimersByTimeAsync(0)
    expect(bodyStarted).toBe(true)
    if (mode === 'caller') caller.abort()
    await vi.advanceTimersByTimeAsync(100)
    expect(outcome).toMatchObject({ code: mode === 'caller' ? 'request_aborted' : 'timeout', retryable: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns a complete body and removes timeout and external abort listeners', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const removed = vi.spyOn(caller.signal, 'removeEventListener')
    let requestSignal: AbortSignal | undefined
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: '/local-room-fixture', timeoutMs: 100,
      fetch: async (_url, init) => {
        requestSignal = init.signal
        return { ok: true, status: 200, json: async () => ({ cursor: 0, timedOut: true }) }
      },
    })
    expect(await transport.waitForAdvance({ ...waitInput, signal: caller.signal })).toEqual({ cursor: 0, timedOut: true })
    expect(vi.getTimerCount()).toBe(0)
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
    caller.abort()
    await vi.advanceTimersByTimeAsync(200)
    expect(requestSignal?.aborted).toBe(false)
  })

  it('keeps malformed JSON distinct from HTTP rejection and transport failures', async () => {
    const malformed = new HttpOnlineRoomTransportV1({
      baseUrl: '/local-room-fixture', fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON') } }),
    })
    await expect(malformed.waitForAdvance(waitInput)).rejects.toMatchObject({ code: 'invalid_response', status: 200, retryable: false })
    const rejected = new HttpOnlineRoomTransportV1({
      baseUrl: '/local-room-fixture', fetch: async () => ({ ok: false, status: 403, json: async () => ({ code: 'forbidden', message: 'fixture denied' }) }),
    })
    await expect(rejected.waitForAdvance(waitInput)).rejects.toMatchObject({ code: 'forbidden', status: 403, retryable: false })
  })

  it('preserves an accepted-but-unread command requestId and only applies it once after explicit recovery', async () => {
    vi.useFakeTimers()
    const apply = vi.fn(async () => ({ eventType: 'room.chat.message', publicPayload: {}, resultingStateHash: 'b'.repeat(64) }))
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'sfqa114.recovery', releaseHash: 'a'.repeat(64), gmDisplayName: 'GM',
      adapter: { apply, project: async ({ sequence }) => ({ sequence }) },
    })
    let first = true
    let bodyStarted = false
    const sent: OnlineRoomCommandV1[] = []
    const transport = new HttpOnlineRoomTransportV1({
      baseUrl: '/local-room-fixture', timeoutMs: 100,
      fetch: async (url, init) => {
        if (url.endsWith('/commands')) {
          const command = JSON.parse(init.body) as OnlineRoomCommandV1
          sent.push(command)
          const receipt = await created.room.submit(command)
          if (first) {
            first = false
            return { ok: true, status: 200, json: () => hangingBody(init.signal, () => { bodyStarted = true }) }
          }
          return { ok: true, status: 200, json: async () => receipt }
        }
        const input = JSON.parse(init.body) as Parameters<AuthoritativeOnlineRoomV1['reconnect']>[0]
        const payload = await created.room.reconnect(input)
        return { ok: true, status: 200, json: async () => payload }
      },
    })
    const client = new OnlineRoomClientV1({
      roomId: created.room.roomId, releaseHash: 'a'.repeat(64),
      memberId: created.gm.member.memberId, authToken: created.gm.authToken, actorKey: null,
    }, transport)
    await client.connect()
    const pending = client.enqueue({ requestId: 'keep.original.request', kind: 'chat.message', payload: { text: 'fixture' } })
    await vi.waitFor(() => expect(bodyStarted).toBe(true), { interval: 1, timeout: 50 })
    await vi.advanceTimersByTimeAsync(100)
    const stalled = client.inspect()
    expect(stalled).toMatchObject({ lastErrorCode: 'timeout', pendingRequestIds: ['keep.original.request'] })
    await pending
    expect(apply).toHaveBeenCalledOnce()
    expect(sent).toHaveLength(1)
    const recovered = await client.recover()
    expect(recovered).toMatchObject({ cursor: 1, pendingRequestIds: [], connection: 'online', projection: { sequence: 1 } })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(apply).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
