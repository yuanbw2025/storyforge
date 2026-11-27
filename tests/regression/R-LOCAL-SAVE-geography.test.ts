import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useGeographyStore as store } from '../../src/stores/project-singletons'
import { readGeographyFormV1 } from '../../src/lib/authoring/geography-local-save-evidence'
import type { GeographyFormRecordV1, GeographyFormSaveV1 } from '../../src/lib/authoring/geography-local-save-evidence'
import type { WorkspaceScope } from '../../src/lib/types'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as scopeModule from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
const raw = '  # 地理原文\r\n\r\n🌋 山川与尾空白。  '
const locations = JSON.stringify([{ id: 'port', name: '港口', description: raw, significance: ' 原文  ', type: 'city', parentId: null, order: 0 }])
beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open()
  store.setState({ geography: null, loading: false, loadError: null, loadedScope: null, activeWorldGroupId: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() { const { scope } = await seedCurrentWorkspace('地理保存'); await store.getState().loadAll(scope); return scope }
async function proof(scope: WorkspaceScope, groupId: number | null = null): Promise<GeographyFormSaveV1> {
  return { kind: 'geography-form-save-v1', expected: await readGeographyFormV1(scope, groupId) }
}
const row = () => db.geographies.toArray().then(rows => rows[0] as GeographyFormRecordV1)
it('commits overview and nested location raw text atomically through the original World writer and rereads the exact reopened source', async () => {
  const scope = await fixture()
  const saved = await store.getState().save({ projectId: scope.projectId, overview: raw, locations }, scope, await proof(scope))
  expect(saved).toMatchObject({ overview: raw, locations, worldId: scope.worldId })
  const uid = (saved as GeographyFormRecordV1).ragDocumentId; expect(isPortableResourceUidV1(uid, 'geography')).toBe(true)
  db.close(); await db.open()
  expect(await row()).toMatchObject({ id: saved.id, ragDocumentId: uid, overview: raw, locations, worldId: scope.worldId })
  expect(Object.hasOwn(await row(), 'workId')).toBe(false)
})
it('keeps both original fields after quota, zero-row and corrupt-poststate failures; an explicit retry uses the same basis', async () => {
  const scope = await fixture(); await store.getState().save({ projectId: scope.projectId, overview: 'old', locations: '[]' }, scope)
  const expected = await proof(scope), patch = { projectId: scope.projectId, overview: raw, locations }
  const failed = vi.spyOn(db.geographies, 'update').mockRejectedValue(new DOMException('geography quota', 'QuotaExceededError'))
  await expect(store.getState().save(patch, scope, expected)).rejects.toThrow('geography quota'); failed.mockRestore()
  const zero = vi.spyOn(db.geographies, 'update').mockResolvedValue(0)
  await expect(store.getState().save(patch, scope, expected)).rejects.toThrow('已不存在'); zero.mockRestore()
  const corrupt = () => ({ locations: '[]' }); db.geographies.hook('updating', corrupt)
  try { await expect(store.getState().save(patch, scope, expected)).rejects.toThrow('精确保存') }
  finally { db.geographies.hook('updating').unsubscribe(corrupt) }
  expect(await row()).toMatchObject({ overview: 'old', locations: '[]' })
  await store.getState().save(patch, scope, expected)
  expect(await row()).toMatchObject({ overview: raw, locations }); expect(await db.geographies.count()).toBe(1)
})
it('preserves untouched map data and independent field edits, but rejects stale same-field or deleted-row saves', async () => {
  const scope = await fixture(); await store.getState().save({ projectId: scope.projectId, overview: 'old', locations: '[]', worldMapData: 'map stays' }, scope)
  const expected = await proof(scope)
  await db.geographies.update(expected.expected!.id!, { locations })
  await store.getState().save({ projectId: scope.projectId, overview: raw }, scope, expected)
  expect(await row()).toMatchObject({ overview: raw, locations, worldMapData: 'map stays' })
  await expect(store.getState().save({ projectId: scope.projectId, overview: 'stale' }, scope, expected)).rejects.toThrow('已被修改')
  const next = await proof(scope); await db.geographies.delete(next.expected!.id!)
  await expect(store.getState().save({ projectId: scope.projectId, overview: raw }, scope, next)).rejects.toThrow('已被修改')
  expect(await db.geographies.count()).toBe(0)
})
it('rejects wrong owners, identity patches, malformed nested records, ambiguous partitions and outer transactions', async () => {
  const scope = await fixture(), expected = await proof(scope)
  await expect(store.getState().save({ projectId: scope.projectId, overview: raw, worldMapData: 'forged' }, scope, expected)).rejects.toThrow('凭据无效')
  await expect(store.getState().save({ projectId: scope.projectId, locations: '{bad' }, scope, expected)).rejects.toThrow('格式异常')
  await expect(store.getState().save({ projectId: scope.projectId, locations: '[{"id":"x","name":"a"},{"id":"x","name":"b"}]' }, scope, expected)).rejects.toThrow('格式异常')
  await expect(db.transaction('rw', db.geographies, () => store.getState().save({ projectId: scope.projectId, overview: raw }, scope, expected))).rejects.toThrow('独立提交')
  await expect(store.getState().save({ projectId: scope.projectId, overview: raw }, { ...scope, worldId: scope.worldId + 100 }, expected)).rejects.toThrow()
  const base = stampNewRecord(scope, 'geographies', { projectId: scope.projectId, overview: '', locations: '[]', createdAt: 1, updatedAt: 1 }, { owner: 'world' })
  await db.geographies.add(base); await db.geographies.add(stampNewRecord(scope, 'geographies', { ...base, id: undefined }, { owner: 'world' }))
  await expect(readGeographyFormV1(scope, null)).rejects.toThrow('不唯一')
  await expect(store.getState().save({ projectId: scope.projectId, overview: raw }, scope, expected)).rejects.toThrow('不唯一')
})
it('freezes caller scope, patch and preimage before queued admission and never republishes into a later World', async () => {
  const scope = await fixture(), other = (await seedCurrentWorkspace('另一世界')).scope, expected = await proof(scope)
  let release!: () => void, ready!: () => void
  const entered = new Promise<void>(resolve => { ready = resolve })
  const barrier = coordinatePendingEditV1({ key: `project-singleton:geographies:${scope.projectId}:${scope.worldId}:default`, persist: () => new Promise<void>(resolve => { release = resolve; ready() }) })
  await entered
  const mutable = { ...scope }, patch = { projectId: scope.projectId, overview: raw, locations }
  const pending = store.getState().save(patch, mutable, expected)
  patch.overview = 'later'; Object.assign(mutable, other)
  await store.getState().loadAll(other); release(); await barrier
  expect(await pending).toMatchObject({ overview: raw, locations })
  expect(store.getState().loadedScope).toEqual(other); expect(store.getState().geography).toBeNull()
  expect(await row()).toMatchObject({ projectId: scope.projectId, worldId: scope.worldId, overview: raw })
})
it('a confirmed native commit fences a previously captured same-World singleton read', async () => {
  const scope = await fixture(); await store.getState().save({ projectId: scope.projectId, overview: 'old' }, scope)
  const expected = await proof(scope), original = scopeModule.readOwnedRows
  let release!: () => void, ready!: () => void, held = false
  const entered = new Promise<void>(resolve => { ready = resolve })
  vi.spyOn(scopeModule, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof original>) => {
    const rows = await original<T>(...args)
    if (args[1] === 'geographies' && !held) { held = true; await new Promise<void>(resolve => { release = resolve; ready() }) }
    return rows
  })
  const late = store.getState().loadAll(scope); await entered
  await store.getState().save({ projectId: scope.projectId, overview: raw }, scope, expected)
  release(); await late; expect(store.getState().geography?.overview).toBe(raw)
})
