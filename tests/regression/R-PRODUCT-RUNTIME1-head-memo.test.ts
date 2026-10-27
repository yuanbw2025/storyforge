import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductRuntimeHeadParsingV1 } from '../../src/lib/product/runtime-head-parsing'
import { db } from '../../src/lib/db/schema'
import { appendProductRuntimeEvent, hashStateJson, readProductRuntimeState, readVerifiedProductRuntimeHeadV1 } from '../../src/lib/product/runtime-core'
import { deleteProductRuntimeSession } from '../../src/lib/product/runtime-api'
import { createCurrentTtrpgRuntimeTestBedV1 } from '../helpers/current-product-runtime'

function memo(limits?: { maxEntries: number; maxCodeUnits: number }) {
  const parse = vi.fn((json: string) => JSON.parse(json) as { value: { n: number } })
  return { parse, read: createProductRuntimeHeadParsingV1(parse, structuredClone, limits) }
}
describe('PRODUCT-RUNTIME-1 exact parsed head reuse', () => {
  it('reuses synchronous pure parsing but every caller receives a private nested state', () => {
    const m = memo(), json = '{"value":{"n":1}}', first = m.read(json)
    first.value.n = 900
    expect(m.read(json).value.n).toBe(1)
    expect(m.parse).toHaveBeenCalledTimes(1)
  })
  it('requires exact serialized bytes rather than an identity or caller-supplied hash', () => {
    const m = memo(); m.read('{"value":{"n":1}}'); m.read('{"value":{"n":2}}')
    m.read(' {"value":{"n":1}} ')
    expect(m.parse).toHaveBeenCalledTimes(3)
  })
  it('evicts old work at both entry and retained-text bounds', () => {
    for (const limits of [{ maxEntries: 1, maxCodeUnits: 100 }, { maxEntries: 8, maxCodeUnits: 17 }]) {
      const m = memo(limits), a = '{"value":{"n":1}}', b = '{"value":{"n":2}}'
      m.read(a); m.read(b); m.read(a)
      expect(m.parse).toHaveBeenCalledTimes(3)
    }
  })
  it('keeps the recently read entry when capacity evicts older parsing work', () => {
    const m = memo({ maxEntries: 2, maxCodeUnits: 100 })
    const a = '{"value":{"n":1}}', b = '{"value":{"n":2}}', c = '{"value":{"n":3}}'
    m.read(a); m.read(b); m.read(a); m.read(c); m.read(a)
    expect(m.parse).toHaveBeenCalledTimes(3)
    m.read(b)
    expect(m.parse).toHaveBeenCalledTimes(4)
  })
  it('does not retain oversized input, failed parsing or a failed defensive copy', () => {
    const m = memo({ maxEntries: 2, maxCodeUnits: 4 }), json = '{"value":{"n":1}}'
    m.read(json); m.read(json); expect(m.parse).toHaveBeenCalledTimes(2)
    const normal = memo(); expect(() => normal.read('bad-json')).toThrow(); expect(() => normal.read('bad-json')).toThrow()
    expect(normal.parse).toHaveBeenCalledTimes(2)
    const parse = vi.fn(JSON.parse), clone = vi.fn().mockImplementationOnce(() => { throw new Error('clone failed') }).mockImplementation(structuredClone)
    const read = createProductRuntimeHeadParsingV1(parse, clone)
    expect(() => read('{"n":1}')).toThrow('clone failed'); expect(read('{"n":1}')).toEqual({ n: 1 }); expect(parse).toHaveBeenCalledTimes(2)
  })
  it('refuses invalid resource bounds without changing any parser policy', () => {
    expect(() => memo({ maxEntries: 0, maxCodeUnits: 10 })).toThrow()
    expect(() => memo({ maxEntries: 1, maxCodeUnits: -1 })).toThrow()
  })
})

describe('PRODUCT-RUNTIME-1 real persisted head and transaction boundaries', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  const seed = () => createCurrentTtrpgRuntimeTestBedV1({ title: 'Exact parsed head ' + crypto.randomUUID(), seed: 'memo-current-bed' })
  it('retains the latest event query, state isolation and new-head invalidation', async () => {
    const { session } = await seed(), row = (await db.productRuntimeSessions.get(session.id!))!
    const before = await readVerifiedProductRuntimeHeadV1(row); before.state.clock = 999
    expect((await readVerifiedProductRuntimeHeadV1(row)).state.clock).toBe(0)
    await appendProductRuntimeEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 2 } })
    // Even the old row must detect the newer event tail and replay canonically.
    const actual = await readVerifiedProductRuntimeHeadV1(row)
    expect(actual.fromCache).toBe(false); expect(actual.sequence).toBe(1); expect(actual.state.clock).toBe(2)
    expect((await readProductRuntimeState(session.id!)).clock).toBe(2)
  })
  it('does not make a warm derived head authoritative over a changed body or hash', async () => {
    const { session } = await seed(), row = (await db.productRuntimeSessions.get(session.id!))!, canonical = await readVerifiedProductRuntimeHeadV1(row)
    const badHash = { ...row, runtimeHeadStateHash: '0'.repeat(64) }
    const recovered = await readVerifiedProductRuntimeHeadV1(badHash)
    expect(recovered.fromCache).toBe(false); expect(recovered.state).toEqual(canonical.state)
    const changed = { ...row, runtimeHeadStateJson: JSON.stringify({ ...canonical.state, clock: 999 }) }
    const body = await readVerifiedProductRuntimeHeadV1(changed)
    expect(body.fromCache).toBe(false); expect(body.state).toEqual(canonical.state)
    const invalid = await readVerifiedProductRuntimeHeadV1({ ...row, runtimeHeadStateJson: JSON.stringify({ ...canonical.state, clock: -1 }) })
    expect(invalid.fromCache).toBe(false); expect(invalid.state).toEqual(canonical.state)
    expect(await db.productRuntimeSessions.get(session.id!)).toEqual(row)
  })
  it('does not keep a deleted instance readable through a warm parsed snapshot', async () => {
    const { session } = await seed(); await readProductRuntimeState(session.id!)
    await deleteProductRuntimeSession(session.id!)
    await expect(readProductRuntimeState(session.id!)).rejects.toThrow()
  })
  it('keeps concurrent verification and hashing before each caller atomic database work', async () => {
    const { session } = await seed(), row = (await db.productRuntimeSessions.get(session.id!))!
    const raw = row.runtimeHeadStateJson! + '\n \t', hash = await hashStateJson(raw)
    await db.productRuntimeSessions.update(session.id!, { runtimeHeadStateJson: raw, runtimeHeadStateHash: hash })
    const fresh = (await db.productRuntimeSessions.get(session.id!))!, digest = crypto.subtle.digest.bind(crypto.subtle)
    const observed = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => { await new Promise(resolve => setTimeout(resolve, 25)); return digest(algorithm, data) })
    // Match runtime-core's existing prepare-before-atomic-transaction contract.
    const results = await Promise.all([readVerifiedProductRuntimeHeadV1(fresh), readVerifiedProductRuntimeHeadV1(fresh)])
    expect(observed.mock.calls.length).toBeGreaterThanOrEqual(2)
    await Promise.all(results.map(result => db.transaction('r', db.productRuntimeSessions, async () => {
      const current = await db.productRuntimeSessions.get(session.id!)
      expect(current!.runtimeHeadStateHash).toBe(hash); expect(result.stateHash).toBe(hash)
    })))
  })
})
