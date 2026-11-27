import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { adopt } from '../../src/lib/registry/adopt'
import * as scopeModule from '../../src/lib/workspace/scope'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { LOCAL_SAVE_STORY_CORE_FIELDS_V1, type LocalSaveStoryCoreFieldV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { STORY_CORE_GENERATABLE_FIELD_SPECS } from '../../src/lib/registry/field-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
const store = useWorldviewStore
const raw = '  # 原始故事\r\n\r\n🌊 标点、中文与尾空白。  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture() { const created = await seedCurrentWorkspace('故事保存'); await store.getState().loadAll(created.scope); return created.scope }
function intent(field: LocalSaveStoryCoreFieldV1 = 'logline'): LocalSaveIntentV1 {
  return { kind: 'natural-field-local-save-v1', session: 'story-author', generation: 1, expected: structuredClone(store.getState().storyCoreSaveWitnesses[field]!) }
}
async function row() { return (await db.storyCores.toArray())[0] }

it('confirms all seven registered fields after their original adoption transaction and preserves exact source/identity on reopen', async () => {
  const scope = await fixture()
  expect(LOCAL_SAVE_STORY_CORE_FIELDS_V1).toEqual(STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => spec.field))
  expect(await db.storyCores.count()).toBe(0)
  for (const field of LOCAL_SAVE_STORY_CORE_FIELDS_V1) {
    const ack = await store.getState().saveStoryCore({ projectId: scope.projectId, [field]: raw }, scope, intent(field))
    expect(ack.witness).toMatchObject({ source: 'committed-write', present: true, value: raw,
      identity: { ...scope, table: 'storyCores', field, worldGroupId: null } })
    expect((await row())[field]).toBe(raw)
  }
  const id = (await row()).id, uid = (await row()).ragDocumentId
  db.close(); await db.open(); expect(await db.storyCores.count()).toBe(1)
  expect(await row()).toMatchObject({ id, ragDocumentId: uid, workId: scope.workId })
  expect(Object.prototype.hasOwnProperty.call(await row(), 'worldId')).toBe(false)
  for (const field of LOCAL_SAVE_STORY_CORE_FIELDS_V1) expect((await row())[field]).toBe(raw)
})

it('rejects empty absence, atomically rolls back quota/poststate faults, and retries the same original intent', async () => {
  const scope = await fixture(), expected = intent()
  const save = (text: string) => store.getState().saveStoryCore({ projectId: scope.projectId, logline: text }, scope, expected)
  await expect(save('')).rejects.toThrow('尚未填写'); expect(await db.storyCores.count()).toBe(0)
  const fault = () => { throw new DOMException('quota failure', 'QuotaExceededError') }
  db.storyCores.hook('updating', fault)
  try { await expect(save(raw)).rejects.toThrow('quota failure') }
  finally { db.storyCores.hook('updating').unsubscribe(fault) }
  expect(await db.storyCores.count()).toBe(0)
  const corrupt = () => ({ logline: 'wrong committed text' }); db.storyCores.hook('updating', corrupt)
  try { await expect(save(raw)).rejects.toThrow('精确保存') }
  finally { db.storyCores.hook('updating').unsubscribe(corrupt) }
  expect(await db.storyCores.count()).toBe(0)
  expect((await save(raw)).witness.value).toBe(raw)
  expect(await db.storyCores.count()).toBe(1)
})

it('accepts unrelated field changes but rejects stale same-field, forged hash and recreated identities', async () => {
  const scope = await fixture(); await store.getState().saveStoryCore({ projectId: scope.projectId, logline: 'old' }, scope)
  const expected = intent(), id = (await row()).id!
  await adopt({ projectId: scope.projectId, scope, target: 'storyCores', mode: 'replace', recordId: id,
    preserveAuthorText: true, data: { theme: '另一字段' } })
  await store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope, expected)
  expect((await row()).theme).toBe('另一字段')
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, logline: 'stale' }, scope, expected)).rejects.toThrow('已被修改')
  const forged = intent(); forged.expected.valueHash = 'fake'
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, logline: 'forged' }, scope, forged)).rejects.toThrow('预像')
  const recreated = intent(); await db.storyCores.delete(id)
  await store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope)
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, logline: 'old identity' }, scope, recreated)).rejects.toThrow('已被修改')
})

it('rejects an uncommitted outer transaction and mismatched field/table/owner proof without writing', async () => {
  const scope = await fixture(), expected = intent()
  await expect(db.transaction('rw', db.storyCores, () => store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope, expected))).rejects.toThrow('独立提交')
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, theme: raw }, scope, expected)).rejects.toThrow('凭据无效')
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, { ...scope, workId: scope.workId + 1 }, expected)).rejects.toThrow('凭据无效')
  const worldview = { ...expected, expected: store.getState().localSaveWitnesses.worldStructure! }
  await expect(store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope, worldview)).rejects.toThrow('凭据无效')
  expect(await db.storyCores.count()).toBe(0)
})

it('captures original scope before queueing and cannot publish its late acknowledgement into another Work', async () => {
  const scope = await fixture(), expected = intent(), other = await seedCurrentWorkspace('另一个作品')
  let release!: () => void
  const barrier = coordinatePendingEditV1({ key: `story-core:${scope.projectId}`, persist: () => new Promise<void>(resolve => { release = resolve }) })
  await Promise.resolve(); await Promise.resolve()
  const mutable = { ...scope }, pending = store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, mutable, expected)
  await store.getState().loadAll(other.scope); Object.assign(mutable, other.scope)
  release(); await barrier; expect((await pending).witness.identity.workId).toBe(scope.workId)
  expect(store.getState().loadedScope).toEqual(other.scope); expect(store.getState().storyCore).toBeNull()
  expect(await row()).toMatchObject({ workId: scope.workId, logline: raw })
})

it('retains a newly committed field and its witness when an older native DB read completes late', async () => {
  const scope = await fixture(); await store.getState().saveStoryCore({ projectId: scope.projectId, logline: 'old' }, scope)
  const expected = intent(), original = scopeModule.readOwnedRows
  let release!: () => void, ready!: () => void, held = false
  const snapshotReady = new Promise<void>(resolve => { ready = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
    const rows = await original<T>(...args)
    if (args[1] === 'storyCores' && !held) {
      held = true; await new Promise<void>(resolve => { release = resolve; ready() })
    }
    return rows
  })
  const older = store.getState().loadAll(scope); await snapshotReady
  await store.getState().saveStoryCore({ projectId: scope.projectId, logline: raw }, scope, expected)
  release(); await older
  expect(store.getState().storyCore?.logline).toBe(raw)
  expect(store.getState().storyCoreSaveWitnesses.logline).toMatchObject({ source: 'committed-write', value: raw })
})
