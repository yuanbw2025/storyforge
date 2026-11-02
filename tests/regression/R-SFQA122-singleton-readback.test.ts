import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import * as scopes from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useCreativeRulesStore, useGeographyStore, useHistoryStore } from '../../src/stores/project-singletons'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { WorkspaceScope } from '../../src/lib/types'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture() {
  const a = await seedCurrentWorkspace('单例作用域')
  const world = await addCurrentWorldFixtureV1({ projectId: a.scope.projectId, name: '另一World' })
  const work = await addCurrentWorkFixtureV1({ projectId: a.scope.projectId, worldId: world.id!, create: { title: '另一Work', kind: 'novel', novelProfile: 'long' } })
  const b: WorkspaceScope = { projectId: a.scope.projectId, worldId: world.id!, workId: work.id! }
  return { a: a.scope, b }
}
const originalRead = scopes.readOwnedRows
beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1()
  await db.delete(); await db.open()
  useGeographyStore.setState({ geography: null, loading: false, loadError: null, loadedScope: null, activeWorldGroupId: null })
})
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })

describe('SFQA-122 · singleton read/write ownership', () => {
  it('late A reads cannot replace B or release B loading; latest empty read is explicit null', async () => {
    const { a, b } = await fixture()
    await useGeographyStore.getState().save({ projectId: a.projectId, overview: 'A数据' }, a)
    const aReady = deferred(), aGate = deferred(), bReady = deferred(), bGate = deferred()
    vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(scope: WorkspaceScope, table: string, options?: scopes.ScopeReadOptions) => {
      const rows = await originalRead<T>(scope, table, options)
      if (table === 'geographies') {
        const [ready, gate] = scope.worldId === a.worldId ? [aReady, aGate] : [bReady, bGate]
        ready.resolve(); await gate.promise
      }
      return rows
    })
    const loadA = useGeographyStore.getState().loadAll(a)
    await aReady.promise
    const loadB = useGeographyStore.getState().loadAll(b)
    await bReady.promise
    aGate.resolve(); await loadA
    expect(useGeographyStore.getState().loading).toBe(true)
    expect(useGeographyStore.getState().geography).toBeNull()
    bGate.resolve(); await loadB
    expect(useGeographyStore.getState()).toMatchObject({ loading: false, loadedScope: b, geography: null, loadError: null })
  })

  it('late writes persist to their frozen owner but cannot publish over another loaded World', async () => {
    const { a, b } = await fixture()
    await useGeographyStore.getState().save({ projectId: a.projectId, overview: 'A原值' }, a)
    await useGeographyStore.getState().save({ projectId: b.projectId, overview: 'B原值' }, b)
    await useGeographyStore.getState().loadAll(a)
    const gate = deferred(), ready = deferred()
    const update = db.geographies.update.bind(db.geographies)
    vi.spyOn(db.geographies, 'update').mockImplementationOnce((...args: Parameters<typeof update>) => {
      ready.resolve()
      return Dexie.Promise.resolve(gate.promise).then(() => update(...args))
    })
    const saveA = useGeographyStore.getState().save({ projectId: a.projectId, overview: 'A晚保存' }, a)
    await ready.promise
    await useGeographyStore.getState().loadAll(b)
    const beforeB = useGeographyStore.getState().geography
    gate.resolve(); await saveA
    expect(useGeographyStore.getState().geography).toEqual(beforeB)
    expect((await originalRead<{ overview: string }>(a, 'geographies', { owner: 'world' }))[0].overview).toBe('A晚保存')
    expect((await originalRead<{ overview: string }>(b, 'geographies', { owner: 'world' }))[0].overview).toBe('B原值')
  })

  it('queued numeric-scope saves resolve the active owner before queue execution', async () => {
    const { a, b } = await fixture()
    await useGeographyStore.getState().loadAll(a)
    const gate = deferred()
    const held = coordinatePendingEditV1({ key: `project-singleton:geographies:${a.projectId}:default`, persist: () => gate.promise })
    const save = useGeographyStore.getState().save({ projectId: a.projectId, overview: '调用时归属A' })
    // Let the already-started scope read finish while persistence remains held.
    await vi.waitFor(async () => expect((await db.projects.get(a.projectId))?.activeWorldId).toBe(a.worldId))
    await db.projects.update(a.projectId, { activeWorldId: b.worldId, activeWorkId: b.workId })
    gate.resolve(); await held; await save
    expect((await originalRead<{ overview: string }>(a, 'geographies', { owner: 'world' }))[0].overview).toBe('调用时归属A')
    expect(await originalRead(b, 'geographies', { owner: 'world' })).toHaveLength(0)
  })

  it('read failures release loading, retain an explicit error and recover without treating failure as an empty read', async () => {
    const { a } = await fixture()
    vi.spyOn(scopes, 'readOwnedRows').mockRejectedValueOnce(new Error('读取故障'))
    await expect(useGeographyStore.getState().loadAll(a)).rejects.toThrow('读取故障')
    expect(useGeographyStore.getState()).toMatchObject({ loading: false, loadError: '读取故障', loadedScope: null })
    await useGeographyStore.getState().loadAll(a)
    expect(useGeographyStore.getState()).toMatchObject({ loading: false, loadError: null, loadedScope: a, geography: null })
  })

  it('a same-owner history refresh preserves its current editor baseline while the new read is pending', async () => {
    const { a } = await fixture()
    await useHistoryStore.getState().save({ projectId: a.projectId, overview: '原历史' }, a)
    await useHistoryStore.getState().loadAll(a)
    const before = useHistoryStore.getState().history
    const ready = deferred(), gate = deferred()
    vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(scope: WorkspaceScope, table: string, options?: scopes.ScopeReadOptions) => {
      const rows = await originalRead<T>(scope, table, options)
      if (table === 'histories') { ready.resolve(); await gate.promise }
      return rows
    })
    const refreshing = useHistoryStore.getState().loadAll(a)
    await ready.promise
    expect(useHistoryStore.getState().loading).toBe(true)
    expect(useHistoryStore.getState().history).toEqual(before)
    gate.resolve(); await refreshing
    expect(useHistoryStore.getState().history).toEqual(before)
  })

  it('history remains world-owned, creativeRules remains work-owned, and foreign ids/groups are rejected', async () => {
    const { a, b } = await fixture()
    await useHistoryStore.getState().save({ projectId: a.projectId, overview: 'A历史' }, a)
    await useHistoryStore.getState().loadAll(b)
    await useHistoryStore.getState().save({ projectId: a.projectId, eraSystem: 'A纪年' }, a)
    expect(useHistoryStore.getState().history).toBeNull()
    expect((await originalRead(a, 'histories', { owner: 'world' }))[0]).toMatchObject({ overview: 'A历史', eraSystem: 'A纪年', worldId: a.worldId })
    await useCreativeRulesStore.getState().save({ projectId: a.projectId, specialRequirements: 'A规则' }, a)
    await useCreativeRulesStore.getState().loadAll(b)
    expect(useCreativeRulesStore.getState().creativeRules).toBeNull()
    const history = (await db.histories.toArray())[0]
    await expect(useHistoryStore.getState().save({ projectId: b.projectId, id: history.id, overview: '越界' }, b)).rejects.toThrow('不属于指定作用域')
    const group = await db.worldGroups.add(scopes.stampNewRecord(b, 'worldGroups', { projectId: b.projectId, name: 'B组', description: '', type: 'parallel', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    await expect(useGeographyStore.getState().save({ projectId: a.projectId, worldGroupId: group, overview: '跨组' }, a)).rejects.toThrow('世界组不属于指定作用域')
    expect(await db.geographies.count()).toBe(0)
    expect(await db.histories.get(history.id!)).toEqual(history)
  })
})
