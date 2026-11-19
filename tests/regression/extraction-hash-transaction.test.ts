import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashExtractionValueV1 } from '../../src/lib/agent/run/extraction-adoption'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

// Deliberately finish a later WebCrypto operation before the first. Concurrent
// Transaction.waitFor calls can otherwise stop their keep-alive too early.
describe('extraction hashes retain their transaction until every digest settles', () => {
  let database: Dexie
  beforeEach(async () => {
    database = new Dexie('extraction-hash-transaction-regression')
    database.version(1).stores({ rows: 'id' })
    await database.open()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await database.delete()
  })

  it.each([false, true])('supports unequal digest durations and subsequent writes (nested=%s)', async nested => {
    const values = [{ chapter: 1, text: '潮汐令' }, { chapter: 2, text: '旧港' }, []]
    const expected = await Promise.all(values.map(hashCanonicalValue))
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let calls = 0
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const index = calls++
      const result = await digest(algorithm, data)
      if (index === 0) await new Promise(resolve => setTimeout(resolve, 30))
      return result
    })
    await database.transaction('rw', database.table('rows'), async () => {
      const transaction = Dexie.currentTransaction
      const hashes = await Promise.all(values.map((value, index) => nested && index === 1
        ? database.transaction('rw', database.table('rows'), () => hashExtractionValueV1(value))
        : hashExtractionValueV1(value)))
      expect(hashes).toEqual(expected)
      expect(Dexie.currentTransaction).toBe(transaction)
      await database.table('rows').put({ id: 1, hashes })
    })
    expect(await database.table('rows').get(1)).toEqual({ id: 1, hashes: expected })
  })

  it('propagates a rejected digest and rolls back earlier writes', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('digest unavailable'))
    await expect(database.transaction('rw', database.table('rows'), async () => {
      await database.table('rows').put({ id: 1, value: 'must roll back' })
      await Promise.all([hashExtractionValueV1('first'), hashExtractionValueV1('second')])
    })).rejects.toThrow('digest unavailable')
    expect(await database.table('rows').count()).toBe(0)
    expect(await hashExtractionValueV1('after rollback')).toBe(await hashCanonicalValue('after rollback'))
  })
})
