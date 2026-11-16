import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'
import { adopt, adoptionTransactionTablesV1 } from '../../src/lib/registry/adopt'
import type { AdoptInput } from '../../src/lib/registry/types'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function fixture() {
  const { scope } = await seedCurrentWorkspace('caller-owned adoption transaction isolated')
  const worldview: AdoptInput = { projectId: scope.projectId, scope, target: 'worldviews',
    mode: 'replace', data: { worldOrigin: '旧港来自潮汐。' } }
  const outline: AdoptInput = { projectId: scope.projectId, scope, target: 'outlineNodes',
    mode: 'add', data: { type: 'volume', title: '雾港第一卷', parentId: null, order: 0 } }
  const tables = scopeTransactionTables(...adoptionTransactionTablesV1('worldviews', undefined, { callerOwned: true }),
    ...adoptionTransactionTablesV1('outlineNodes', undefined, { callerOwned: true }))
  return { scope, worldview, outline, tables }
}

it('keeps two actual opt-in registered writes in the caller transaction when the subsequent write fails', async () => {
  const f = await fixture()
  const failure = () => { throw new Error('synthetic second-table fault') }
  db.outlineNodes.hook('creating', failure)
  try {
    await expect(db.transaction('rw', f.tables, () => {
      const transaction = Dexie.currentTransaction!
      return Dexie.Promise.resolve(adopt(f.worldview, { transaction })).then(async first => {
        expect(first.written).toHaveLength(1)
        expect(await db.worldviews.count()).toBe(1)
        return adopt(f.outline, { transaction })
      })
    })).rejects.toThrow(/second-table fault/)
  } finally {
    db.outlineNodes.hook('creating').unsubscribe(failure)
  }
  db.close(); await db.open()
  expect(await db.worldviews.count()).toBe(0)
  expect(await db.outlineNodes.count()).toBe(0)
})

it('fails closed for a missing registered table before writing and preserves default adoption', async () => {
  const f = await fixture()
  await expect(db.transaction('rw', scopeTransactionTables(db.temporalFacts), () =>
    adopt(f.worldview, { transaction: Dexie.currentTransaction! }))).rejects.toThrow(/完整注册表闭包/)
  expect(await db.worldviews.count()).toBe(0)
  await expect(db.transaction('rw', adoptionTransactionTablesV1('worldviews'), () =>
    adopt(f.worldview, { transaction: Dexie.currentTransaction! }))).rejects.toThrow(/完整注册表闭包/)
  expect(await db.worldviews.count()).toBe(0)
  const result = await adopt(f.worldview)
  expect(result.written).toHaveLength(1)
  expect(await db.worldviews.toArray()).toMatchObject([{ worldId: f.scope.worldId, worldOrigin: '旧港来自潮汐。' }])
})

it('keeps dependent setting facts in the same opt-in transaction when an existing world field changes', async () => {
  const f = await fixture()
  const written = await adopt(f.worldview)
  const id = written.written[0].id
  const factId = await db.temporalFacts.add({
    projectId: f.scope.projectId, workId: f.scope.workId,
    subjectName: '雾港', predicate: 'creationOrigin', factKind: 'state', value: '旧港来自潮汐。',
    sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId: id, sourceField: 'worldOrigin',
    sourceFingerprint: fingerprintSettingSource('旧港来自潮汐。'),
    status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1,
  })
  const newWorldview = { ...f.worldview, data: { worldOrigin: '雾港是作者重建的。' } }
  const save = () => db.transaction('rw', f.tables, () => adopt(newWorldview, { transaction: Dexie.currentTransaction! }))
  const fault = () => { throw new Error('synthetic dependent fact write fault') }
  db.temporalFacts.hook('updating', fault)
  try {
    await expect(save()).rejects.toThrow(/dependent fact write fault/)
  } finally {
    db.temporalFacts.hook('updating').unsubscribe(fault)
  }
  expect((await db.worldviews.get(id))?.worldOrigin).toBe('旧港来自潮汐。')
  expect((await db.temporalFacts.get(factId))?.status).toBe('confirmed')
  await save()
  expect((await db.worldviews.get(id))?.worldOrigin).toBe('雾港是作者重建的。')
  expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
})
