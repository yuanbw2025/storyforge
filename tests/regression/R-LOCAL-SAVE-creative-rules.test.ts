import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCreativeRulesStore } from '../../src/stores/project-singletons'
import * as scopeModule from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1, coordinatePendingEditV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { readCreativeRuleSaveWitnessesV1 } from '../../src/lib/authoring/creative-rules-local-save-evidence'
import { LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1, type LocalSaveCreativeRuleFieldV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
const store = useCreativeRulesStore, raw = '  # 作者规则\r\n\r\n🌊 原文、段落与尾空白。  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture() { const c = await seedCurrentWorkspace('规则保存'); await store.getState().loadAll(c.scope); return c.scope }
async function intent(scope: Parameters<typeof readCreativeRuleSaveWitnessesV1>[0], field: LocalSaveCreativeRuleFieldV1 = 'writingStyle'): Promise<LocalSaveIntentV1> {
  return { kind: 'natural-field-local-save-v1', session: 'rules-author', generation: 1, expected: (await readCreativeRuleSaveWitnessesV1(scope))[field]! }
}
async function row() { return (await db.creativeRules.toArray())[0] }

it('confirms three exact raw fields through the original singleton writer and retains Work identity and sibling settings on reopen', async () => {
  const scope = await fixture()
  for (const field of LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1) {
    const ack = await store.getState().save({ projectId: scope.projectId, [field]: raw }, scope, await intent(scope, field))
    expect(ack.witness).toMatchObject({ source: 'committed-write', present: true, value: raw,
      identity: { ...scope, table: 'creativeRules', field, worldGroupId: null } })
  }
  const before = await row(); db.close(); await db.open()
  expect(await db.creativeRules.count()).toBe(1)
  expect(await row()).toMatchObject({ id: before.id, ragDocumentId: before.ragDocumentId, workId: scope.workId,
    narrativePOV: 'third-limited', prohibitions: '[]', consistencyRules: '[]' })
  for (const field of LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1) expect((await row())[field]).toBe(raw)
  expect(Object.prototype.hasOwnProperty.call(await row(), 'worldId')).toBe(false)
})

it('rolls back actual write and corrupt poststate faults, retains the draft basis and retries without duplicate records', async () => {
  const scope = await fixture(), expected = await intent(scope)
  await expect(store.getState().save({ projectId: scope.projectId, writingStyle: '' }, scope, expected)).rejects.toThrow('尚未填写')
  const fault = () => { throw new DOMException('rules quota failure', 'QuotaExceededError') }; db.creativeRules.hook('creating', fault)
  try { await expect(store.getState().save({ projectId: scope.projectId, writingStyle: raw }, scope, expected)).rejects.toThrow('rules quota failure') }
  finally { db.creativeRules.hook('creating').unsubscribe(fault) }
  expect(await db.creativeRules.count()).toBe(0)
  await store.getState().save({ projectId: scope.projectId, writingStyle: raw }, scope, expected)
  const next = await intent(scope), corrupt = () => ({ writingStyle: 'wrong poststate' }); db.creativeRules.hook('updating', corrupt)
  try { await expect(store.getState().save({ projectId: scope.projectId, writingStyle: 'new' }, scope, next)).rejects.toThrow('精确保存') }
  finally { db.creativeRules.hook('updating').unsubscribe(corrupt) }
  expect((await row()).writingStyle).toBe(raw)
  await store.getState().save({ projectId: scope.projectId, writingStyle: 'new' }, scope, next)
  expect((await row()).writingStyle).toBe('new'); expect(await db.creativeRules.count()).toBe(1)
})

it('accepts unrelated changes and rejects same-field staleness and fabricated hashes', async () => {
  const scope = await fixture(); await store.getState().save({ projectId: scope.projectId, writingStyle: 'old' }, scope)
  const expected = await intent(scope)
  await store.getState().save({ projectId: scope.projectId, atmosphere: 'another field' }, scope)
  await store.getState().save({ projectId: scope.projectId, writingStyle: raw }, scope, expected)
  expect((await row()).atmosphere).toBe('another field')
  await expect(store.getState().save({ projectId: scope.projectId, writingStyle: 'stale' }, scope, expected)).rejects.toThrow('已被修改')
  const forged = await intent(scope); forged.expected.valueHash = 'fake'
  await expect(store.getState().save({ projectId: scope.projectId, writingStyle: 'forged' }, scope, forged)).rejects.toThrow('预像')
})

it('rejects an outer transaction and mismatched fields or owner proof before a confirmed write', async () => {
  const scope = await fixture(), expected = await intent(scope)
  await expect(db.transaction('rw', db.creativeRules, () => store.getState().save({ projectId: scope.projectId, writingStyle: raw }, scope, expected))).rejects.toThrow('独立提交')
  await expect(store.getState().save({ projectId: scope.projectId, atmosphere: raw }, scope, expected)).rejects.toThrow('凭据无效')
  await expect(store.getState().save({ projectId: scope.projectId, writingStyle: raw }, { ...scope, workId: scope.workId + 1 }, expected)).rejects.toThrow('凭据无效')
  expect(await db.creativeRules.count()).toBe(0)
})

it('keeps a queued original Work save out of a newly selected Work', async () => {
  const scope = await fixture(), expected = await intent(scope), other = await seedCurrentWorkspace('另一作品')
  let release!: () => void
  const barrier = coordinatePendingEditV1({ key: `project-singleton:creativeRules:${scope.projectId}:${scope.workId}:default`, persist: () => new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve(); await Promise.resolve()
  const mutable = { ...scope }, pending = store.getState().save({ projectId: scope.projectId, writingStyle: raw }, mutable, expected)
  await store.getState().loadAll(other.scope); Object.assign(mutable, other.scope)
  release(); await barrier; expect((await pending).witness.identity.workId).toBe(scope.workId)
  expect(store.getState().loadedScope).toEqual(other.scope); expect(store.getState().creativeRules).toBeNull()
  expect(await row()).toMatchObject({ workId: scope.workId, writingStyle: raw })
})

it('does not let a delayed old native read replace a committed rule', async () => {
  const scope = await fixture(); await store.getState().save({ projectId: scope.projectId, writingStyle: 'old' }, scope)
  const expected = await intent(scope), original = scopeModule.readOwnedRows
  let release!: () => void, ready!: () => void, held = false
  const snapshotReady = new Promise<void>(resolve => { ready = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
    const rows = await original<T>(...args)
    if (args[1] === 'creativeRules' && !held) { held = true; await new Promise<void>(resolve => { release = resolve; ready() }) }
    return rows
  })
  const older = store.getState().loadAll(scope); await snapshotReady
  await store.getState().save({ projectId: scope.projectId, writingStyle: raw }, scope, expected)
  release(); await older; expect(store.getState().creativeRules?.writingStyle).toBe(raw)
})

it('confirms all structured system-fiction author text as the original native object, preserving sibling fields and reopened identity', async () => {
  const { createSystemFictionElementsV1, SYSTEM_FICTION_ELEMENT_FIELDS } = await import('../../src/lib/prose/system-fiction-contract')
  const scope = await fixture()
  await store.getState().save({ projectId: scope.projectId, writingStyle: '原文风' }, scope)
  const before = await row(), elements = createSystemFictionElementsV1(); elements.enabled = true
  for (const { key } of SYSTEM_FICTION_ELEMENT_FIELDS) elements[key] = raw + key
  const ack = await store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, scope, await intent(scope, 'systemFictionElements'))
  expect(ack.witness).toMatchObject({ value: JSON.stringify(elements), resourceUid: before.ragDocumentId, identity: { ...scope, field: 'systemFictionElements' } })
  db.close(); await db.open()
  expect(await row()).toMatchObject({ systemFictionElements: elements, writingStyle: '原文风', ragDocumentId: before.ragDocumentId })
  expect(typeof (await row()).systemFictionElements).toBe('object')
})
it('rolls back failed and corrupt structured writes, then explicitly retries the original preimage', async () => {
  const { createSystemFictionElementsV1 } = await import('../../src/lib/prose/system-fiction-contract')
  const scope = await fixture(), elements = { ...createSystemFictionElementsV1(), systemMechanism: raw }, expected = await intent(scope, 'systemFictionElements')
  const save = (proof = expected) => store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, scope, proof)
  const fail = () => { throw new Error('structured quota') }; db.creativeRules.hook('creating', fail)
  try { await expect(save()).rejects.toThrow('structured quota') } finally { db.creativeRules.hook('creating').unsubscribe(fail) }
  expect(await db.creativeRules.count()).toBe(0); await save()
  const latest = await intent(scope, 'systemFictionElements'), before = await row()
  elements.limitsCosts = raw
  const zero = vi.spyOn(db.creativeRules, 'update').mockResolvedValueOnce(0)
  await expect(save(latest)).rejects.toThrow('已不存在'); zero.mockRestore()
  const corrupt = () => ({ systemFictionElements: { ...elements, limitsCosts: 'wrong' } }); db.creativeRules.hook('updating', corrupt)
  try { await expect(save(latest)).rejects.toThrow('精确保存') } finally { db.creativeRules.hook('updating').unsubscribe(corrupt) }
  expect(await row()).toEqual(before); await save(latest); expect((await row()).systemFictionElements).toEqual(elements)
})
it('refuses stale structured preimages, fabricated hashes and malformed schema without laundering original data', async () => {
  const { createSystemFictionElementsV1 } = await import('../../src/lib/prose/system-fiction-contract')
  const scope = await fixture(), elements = { ...createSystemFictionElementsV1(), rewardGrowth: raw }, expected = await intent(scope, 'systemFictionElements')
  await store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, scope, expected)
  await expect(store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, scope, expected)).rejects.toThrow('已被修改')
  const forged = await intent(scope, 'systemFictionElements'); forged.expected.valueHash = 'fake'
  await expect(store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, scope, forged)).rejects.toThrow('预像')
  const current = await intent(scope, 'systemFictionElements'), before = await row()
  await expect(store.getState().save({ projectId: scope.projectId, systemFictionElements: { ...elements, version: 2 } as never }, scope, current)).rejects.toThrow('版本不受支持')
  await expect(store.getState().save({ projectId: scope.projectId, systemFictionElements: { ...elements, hidden: 'preserve' } as never }, scope, current)).rejects.toThrow('未登记')
  expect(await row()).toEqual(before)
})
it('freezes the structured author object before queueing and retains the original Work destination', async () => {
  const { createSystemFictionElementsV1 } = await import('../../src/lib/prose/system-fiction-contract')
  const scope = await fixture(), expected = await intent(scope, 'systemFictionElements'), elements = { ...createSystemFictionElementsV1(), protagonistIntent: raw }
  let release!: () => void, ready!: () => void
  const reached = new Promise<void>(resolve => { ready = resolve })
  const held = coordinatePendingEditV1({ key: `project-singleton:creativeRules:${scope.projectId}:${scope.workId}:default`, persist: () => new Promise<void>(resolve => { release = resolve; ready() }) })
  await reached
  const mutable = { ...scope }, pending = store.getState().save({ projectId: scope.projectId, systemFictionElements: elements }, mutable, expected)
  elements.protagonistIntent = 'late mutation'; mutable.workId += 999; expected.expected.valueHash = 'late hash'
  release(); await held
  expect((await pending).witness.identity.workId).toBe(scope.workId)
  expect((await row()).systemFictionElements?.protagonistIntent).toBe(raw)
})
