import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import * as scopes from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useCreativeRulesStore, useGeographyStore, useHistoryStore } from '../../src/stores/project-singletons'
import { coordinatePendingEditV1, flushPendingEditsV1, pendingEditDiagnosticsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
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
  it('keeps a failed world edit pending until that same world succeeds', async () => {
    const { a, b } = await fixture()
    const store = useGeographyStore.getState()
    await store.save({ projectId: a.projectId, overview: 'A 原稿' }, a)
    await store.save({ projectId: b.projectId, overview: 'B 原稿' }, b)
    vi.spyOn(db.geographies, 'update').mockRejectedValueOnce(new Error('A 保存失败'))
    await expect(store.save({ projectId: a.projectId, overview: 'A 修改' }, a)).rejects.toThrow('A 保存失败')
    await store.save({ projectId: b.projectId, overview: 'B 修改' }, b)
    await expect(flushPendingEditsV1()).rejects.toThrow('A 保存失败')
    expect(await originalRead(a, 'geographies', { owner: 'world' })).toMatchObject([{ overview: 'A 原稿' }])
    expect(await originalRead(b, 'geographies', { owner: 'world' })).toMatchObject([{ overview: 'B 修改' }])
    await store.save({ projectId: a.projectId, overview: 'A 修改' }, a)
    await expect(flushPendingEditsV1()).resolves.toHaveProperty('version', 1)
  })

  it('sibling works in the same world cannot acknowledge each other’s creative rules failures', async () => {
    const { a } = await fixture()
    const sibling = await addCurrentWorkFixtureV1({ projectId: a.projectId, worldId: a.worldId,
      create: { title: '同世界作品', kind: 'novel', novelProfile: 'long' } })
    const b = { ...a, workId: sibling.id! }
    const store = useCreativeRulesStore.getState()
    await store.save({ projectId: a.projectId, specialRequirements: 'A' }, a)
    vi.spyOn(db.creativeRules, 'update').mockRejectedValueOnce(new Error('作品 A 保存失败'))
    await expect(store.save({ projectId: a.projectId, specialRequirements: 'A2' }, a)).rejects.toThrow('作品 A 保存失败')
    await store.save({ projectId: b.projectId, specialRequirements: 'B' }, b)
    await expect(flushPendingEditsV1()).rejects.toThrow('作品 A 保存失败')
    await store.save({ projectId: a.projectId, specialRequirements: 'A2' }, a)
    await expect(flushPendingEditsV1()).resolves.toHaveProperty('version', 1)
  })

  it('registers an unresolved project immediately and preserves order with an explicit write to its owner', async () => {
    const { a } = await fixture()
    const gate = deferred()
    vi.spyOn(scopes, 'resolveScopeLike').mockImplementationOnce(async () => { await gate.promise; return a })
    const store = useGeographyStore.getState()
    const first = store.save({ projectId: a.projectId, overview: '第一次' }, a.projectId)
    expect(pendingEditDiagnosticsV1().writeCount).toBeGreaterThan(0)
    const edited = { projectId: a.projectId, overview: '第二次' }
    const second = store.save(edited, a)
    edited.overview = '稍后输入'
    let flushed = false
    const barrier = flushPendingEditsV1().then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    gate.resolve()
    await Promise.all([first, second, barrier])
    expect(await originalRead(a, 'geographies', { owner: 'world' })).toMatchObject([{ overview: '第二次' }])
  })

  it('late A reads cannot replace B or release B loading; latest empty read is explicit null', async () => {
    const { a, b } = await fixture()
    await useGeographyStore.getState().save({ projectId: a.projectId, overview: 'A数据' }, a)
    const aReady = deferred(), aGate = deferred(), bReady = deferred(), bGate = deferred()
    vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof originalRead>) => {
      const [scope, table] = args
      const rows = await originalRead<T>(...args)
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
    const held = coordinatePendingEditV1({ key: `project-singleton:geographies:${a.projectId}:${a.worldId}:default`, persist: () => gate.promise })
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
    vi.spyOn(scopes, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof originalRead>) => {
      const [, table] = args
      const rows = await originalRead<T>(...args)
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
