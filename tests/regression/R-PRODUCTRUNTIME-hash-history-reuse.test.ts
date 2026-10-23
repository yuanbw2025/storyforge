import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRuntimeEvent } from '../../src/lib/types'
import { replayProductRuntimeEventsVerifiedAsyncV1 as replay } from '../../src/lib/product/runtime-core'
import * as adapters from '../../src/lib/product/runtime-product-adapters'

let scenario = 0
function initial() { return { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), clock: ++scenario * 100 } }
function events(count: number, sessionId = 31): ProductRuntimeEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, projectId: 2, worldGroupId: null, sessionId,
    sequence: index + 1, type: 'time.advanced', actorKey: null, targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null,
    payloadJson: '{"amount":1}', createdAt: 1000 + index,
  }))
}
afterEach(() => vi.restoreAllMocks())

describe('bounded asynchronous SHA256 verified history reuse', () => {
  it('reuses large histories across sessions without retaining full payload bytes', async () => {
    const states = Array.from({ length: 3 }, initial)
    const histories = states.map((_, index) => events(5, index + 10).map(event => ({
      ...event, payloadJson: JSON.stringify({ amount: 1, unused: String(index).repeat(1_400_000) }),
    })))
    const spy = vi.spyOn(adapters, 'applyProductOwnedRuntimeEventV1')
    for (let index = 0; index < states.length; index++) await replay(states[index], histories[index])
    expect(spy).toHaveBeenCalledTimes(15)
    spy.mockClear()
    for (let index = 0; index < states.length; index++) {
      expect((await replay(states[index], histories[index])).clock).toBe(states[index].clock + 5)
    }
    expect(spy).not.toHaveBeenCalled()
  })
  it('appends only the suffix and detaches returned state', async () => {
    const state = initial(); const history = events(3)
    const first = await replay(state, history, 2)
    first.clock = 9999
    const spy = vi.spyOn(adapters, 'applyProductOwnedRuntimeEventV1')
    expect((await replay(state, history)).clock).toBe(state.clock + 3)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('snapshots input before asynchronous hashing can race caller mutation', async () => {
    const state = initial(); const history = events(2)
    const result = replay(state, history)
    const originalClock = state.clock
    state.clock = 5000
    history[0].payloadJson = '{"amount":50}'
    expect((await result).clock).toBe(originalClock + 2)
    expect((await replay(state, history)).clock).toBe(5051)
  })
  it('rejects modified, missing, duplicate and malformed historical events after a hit', async () => {
    const state = initial(); const history = events(3)
    await replay(state, history)
    const changed = structuredClone(history); changed[0].payloadJson = '{"amount":8}'
    expect((await replay(state, changed)).clock).toBe(state.clock + 10)
    await expect(replay(state, history.slice(1))).rejects.toThrow('序号不连续')
    await expect(replay(state, [history[0], history[0], history[2]])).rejects.toThrow('序号不连续')
    changed[1].type = 'invalid' as ProductRuntimeEvent['type']
    await expect(replay(state, changed)).rejects.toThrow('未知演化事件类型')
    expect((await replay(state, history)).clock).toBe(state.clock + 3)
  })
  it('includes session identity and never seeds a prefix from a failed suffix', async () => {
    const state = initial(); const history = events(2)
    await replay(state, history, 1)
    const bad = structuredClone(history); bad[1].payloadJson = '{}'
    await expect(replay(state, bad)).rejects.toThrow('时间推进量')
    const spy = vi.spyOn(adapters, 'applyProductOwnedRuntimeEventV1')
    expect((await replay(state, events(2, 99))).clock).toBe(state.clock + 2)
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('falls back safely for non-lossless snapshots', async () => {
    const state = initial(); const history = events(2)
    Object.defineProperty(history[0], 'createdAt', { enumerable: true, get: () => 1000 })
    await replay(state, history)
    const spy = vi.spyOn(adapters, 'applyProductOwnedRuntimeEventV1')
    expect((await replay(state, history)).clock).toBe(state.clock + 2)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
