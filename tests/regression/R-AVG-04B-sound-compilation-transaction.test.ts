import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'

afterEach(() => { vi.restoreAllMocks(); db.close() })
it('keeps atomic adoption alive while the pure multi-requirement compiler hashes outside its DB transaction', async () => {
  await db.open()
  const s = await avgSoundPlanningFixtureV1(), expected = canonicalProductProductionJsonV2(s.compiled)
  const digest = crypto.subtle.digest.bind(crypto.subtle), transactionObservations: boolean[] = []
  vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
    transactionObservations.push(Dexie.currentTransaction !== null)
    return digest(...args)
  })
  const count = await db.productBuilds.count()
  await db.transaction('rw', db.productBuilds, async () => {
    const transaction = Dexie.currentTransaction
    expect(transaction).not.toBeNull()
    const compiled = await compileAvgSoundRequirementsV1(s.scope, s.plan)
    expect(canonicalProductProductionJsonV2(compiled)).toBe(expected)
    expect(Dexie.currentTransaction).toBe(transaction)
    expect(await db.productBuilds.count()).toBe(count)
  })
  expect(transactionObservations.length).toBeGreaterThan(0)
  expect(transactionObservations.every(inTransaction => !inTransaction)).toBe(true)
}, 10_000)
