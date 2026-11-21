import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { adopt, worldHistoryAdoptionTransactionTablesV1 } from '../../src/lib/registry/adopt'
import { useCreativeRulesStore, useGeographyStore, useHistoryStore } from '../../src/stores/project-singletons'
import * as scopes from '../../src/lib/workspace/scope'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { resolveWorldAuthoringOwnershipV1 } from '../../src/lib/workspace/ownership'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import {
  coordinatePendingEditV1, flushPendingEditsV1, pendingEditDiagnosticsV1,
  resetPendingEditCoordinatorForTestsV1,
} from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import type { HistoryAuthorOriginV1, HistoryAuthorPartitionV1, WorkspaceScope, WorldOwnerScope } from '../../src/lib/types'

const startedLoads = new Set<Promise<unknown>>()
const startedRaceBodies = new Set<Promise<unknown>>()
let closingReads = false
const testReadLifecycle = {
  beginCase() {
    if (startedLoads.size || startedRaceBodies.size) throw new Error('上个测试的读取尚未收尾')
    closingReads = false
  },
  trackLoad<T>(promise: Promise<T>): Promise<T> { startedLoads.add(promise); return promise },
  trackBody(body: () => Promise<void>) {
    return () => { const promise = body(); startedRaceBodies.add(promise); return promise }
  },
  independentUIRead<T>(start: () => Promise<T>): Promise<T> { return Dexie.ignoreTransaction(start) },
  onGateCreated(resolve: () => void) { if (closingReads) resolve() },
  enterCleanup() { closingReads = true },
  async drainStartedWork() {
    const awaited = new Set<Promise<unknown>>()
    for (;;) {
      const batch = [...startedLoads, ...startedRaceBodies].filter(promise => !awaited.has(promise))
      if (!batch.length) break
      batch.forEach(promise => awaited.add(promise))
      await Promise.allSettled(batch)
    }
    startedLoads.clear(); startedRaceBodies.clear()
  },
  endCase() { closingReads = false },
}
const trackedLegacyLoad = (...args: Parameters<ReturnType<typeof store>['loadAll']>) => {
  const state = store()
  return testReadLifecycle.trackLoad(state.loadAll(...args))
}
const trackedNamedLoad = (...args: Parameters<ReturnType<typeof store>['loadForHistoryAuthorV1']>) => {
  const state = store()
  return testReadLifecycle.trackLoad(state.loadForHistoryAuthorV1(...args))
}
const partition = (worldGroupId: number | null = null): HistoryAuthorPartitionV1 => ({ kind: 'partition', worldGroupId })
const worldOrigin = (scope: WorldOwnerScope): HistoryAuthorOriginV1 =>
  ({ version: 1, kind: 'world', scope: { projectId: scope.projectId, worldId: scope.worldId } })
const workOrigin = (scope: WorkspaceScope): HistoryAuthorOriginV1 => ({ version: 1, kind: 'work', scope: { ...scope } })
const store = () => useHistoryStore.getState()
const readOwned = scopes.readOwnedRows
const readInTransaction = scopes.readOwnedRowsInTransactionV1
function spyOwnedReads(afterRead: <T>(scope: WorldOwnerScope, table: string, read: () => Promise<T[]>) => Promise<T[]>) {
  const legacy = vi.spyOn(scopes, 'readOwnedRows').mockImplementation(<T>(...args: Parameters<typeof readOwned>) =>
    afterRead<T>(args[0], args[1], () => readOwned<T>(...args)))
  const bound = vi.spyOn(scopes, 'readOwnedRowsInTransactionV1').mockImplementation(<T>(...args: Parameters<typeof readInTransaction>) =>
    afterRead<T>(args[1], args[2], () => readInTransaction<T>(...args)))
  return { mockRestore() { legacy.mockRestore(); bound.mockRestore() } }
}
function failNextHistoryUpdate(message: string) {
  const prototype = Object.getPrototypeOf(db.histories) as typeof db.histories
  const original = prototype.update
  let armed = true
  vi.spyOn(prototype, 'update').mockImplementation(function (this: typeof db.histories, ...args: Parameters<typeof original>) {
    if (this.name === 'histories' && armed) { armed = false; return Dexie.Promise.reject(new Error(message)) }
    return original.apply(this, args)
  })
}

/** Native request identities only, for assertions inside an actual caller scope. */
function captureHistoryRequestIdentities() {
  const requests: Array<{ table: string; transaction: IDBTransaction | null }> = []
  let collecting = false
  const record = <T>(table: string, request: IDBRequest<T>): IDBRequest<T> => {
    if (collecting) {
      const source = request.source
      const sourceTransaction = source instanceof IDBIndex ? source.objectStore.transaction
        : source instanceof IDBObjectStore ? source.transaction : null
      requests.push({ table, transaction: request.transaction ?? sourceTransaction })
    }
    return request
  }
  const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add
  const getAll = IDBObjectStore.prototype.getAll, indexGetAll = IDBIndex.prototype.getAll
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof get>) {
    return record(this.name, get.apply(this, args))
  })
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    return record(this.name, put.apply(this, args))
  })
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
    return record(this.name, add.apply(this, args))
  })
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    return record(this.name, getAll.apply(this, args))
  })
  vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function (this: IDBIndex, ...args: Parameters<typeof indexGetAll>) {
    return record(this.objectStore.name, indexGetAll.apply(this, args))
  })
  return {
    start() { requests.length = 0; collecting = true },
    stop() { collecting = false },
    snapshot(native: IDBTransaction) {
      return { sameNative: requests.length > 0 && requests.every(request => request.transaction === native),
        tables: [...new Set(requests.map(request => request.table))].sort() }
    },
  }
}
function nativeTerminalReceipt() {
  let resolve!: (outcome: 'complete' | 'abort') => void
  const promise = new Promise<'complete' | 'abort'>(done => { resolve = done })
  return { promise, watch(native: IDBTransaction) {
    native.addEventListener('complete', () => resolve('complete'), { once: true, passive: true })
    native.addEventListener('abort', () => resolve('abort'), { once: true, passive: true })
  } }
}

const releases: Array<() => void> = []
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  testReadLifecycle.onGateCreated(resolve)
  releases.push(resolve)
  return { promise, resolve }
}
const wait = (promise: Promise<void>) => Dexie.currentTransaction ? Dexie.waitFor(promise) : promise
async function fixture(zeroWork = false) {
  const created = await seedCurrentWorkspace('历史作者', { purpose: 'world-engine' })
  if (zeroWork) {
    await db.projects.update(created.scope.projectId, { activeWorkId: null })
    await db.works.delete(created.scope.workId)
  }
  return { ...created, origin: worldOrigin(created.scope) }
}
async function group(scope: WorldOwnerScope, name = '分区') {
  return db.worldGroups.add(scopes.stampNewRecord(scope, 'worldGroups', {
    projectId: scope.projectId, name, description: '', type: 'parallel' as const,
    order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
}
async function save(origin: HistoryAuthorOriginV1, patch: { overview?: string; eraSystem?: string }, worldGroupId: number | null = null) {
  await store().saveForHistoryAuthorV1({ origin, selection: partition(worldGroupId), patch: patch as any })
}
const load = (origin: HistoryAuthorOriginV1, worldGroupId: number | null = null) =>
  trackedNamedLoad({ origin, selection: partition(worldGroupId) })
const adoptWorld = (scope: WorldOwnerScope, data: { overview?: string; eraSystem?: string }, worldGroupId: number | null = null) =>
  adopt({ target: 'histories', ownerScope: { projectId: scope.projectId, worldId: scope.worldId },
    selection: partition(worldGroupId), mode: 'replace', data: data as any })
const targetKey = (scope: WorldOwnerScope, worldGroupId: number | null = null) =>
  `project-singleton:histories:${scope.projectId}:${scope.worldId}:${worldGroupId ?? 'default'}`
async function rows(scope: WorldOwnerScope) { return readOwned<any>(scope, 'histories', { owner: 'world' }) }

beforeEach(async () => {
  testReadLifecycle.beginCase()
  resetPendingEditCoordinatorForTestsV1()
  await db.delete(); await db.open()
  useHistoryStore.setState({ history: null, loading: false, loadError: null, loadedScope: null, activeWorldGroupId: null,
    loadedHistoryAuthorOrigin: null, loadedHistoryAuthorSelection: null })
  useCreativeRulesStore.setState({ creativeRules: null, loadedScope: null, loading: false, activeWorldGroupId: null, loadError: null })
  useGeographyStore.setState({ geography: null, loadedScope: null, loading: false, activeWorldGroupId: null, loadError: null })
})
afterEach(async () => {
  testReadLifecycle.enterCleanup()
  releases.splice(0).forEach(release => release())
  await testReadLifecycle.drainStartedWork()
  releases.splice(0).forEach(release => release())
  await flushPendingEditsV1().catch(() => undefined)
  vi.restoreAllMocks()
  resetPendingEditCoordinatorForTestsV1()
  db.close()
  testReadLifecycle.endCase()
})

describe('SFQA061 M1 · additive history author singleton', () => {
  it('legacy numeric history load/save keeps full Work resolution and partial payload', async () => {
    const f = await fixture()
    await store().save({ projectId: f.scope.projectId, overview: '旧数字入口' })
    await trackedLegacyLoad(f.scope.projectId)
    expect(store().loadedScope).toEqual(f.scope)
    expect(store().history?.overview).toBe('旧数字入口')
    await store().save({ projectId: f.scope.projectId, eraSystem: '旧纪年' })
    expect((await rows(f.scope))[0]).toMatchObject({ overview: '旧数字入口', eraSystem: '旧纪年', worldId: f.scope.worldId })
  })

  it('legacy explicit Work history and unrelated singleton APIs stay compatible', async () => {
    const f = await fixture()
    await store().save({ projectId: f.scope.projectId, overview: '旧完整scope' }, f.scope)
    await trackedLegacyLoad(f.scope)
    expect(store().loadedScope).toEqual(f.scope)
    await useCreativeRulesStore.getState().save({ projectId: f.scope.projectId, specialRequirements: '规则' }, f.scope)
    await useGeographyStore.getState().save({ projectId: f.scope.projectId, overview: '地理' }, f.scope)
    expect((await db.creativeRules.toArray())[0]).toMatchObject({ workId: f.scope.workId })
    expect((await db.geographies.toArray())[0]).toMatchObject({ worldId: f.scope.worldId })
    expect('saveForHistoryAuthorV1' in useCreativeRulesStore.getState()).toBe(false)
  })

  it('legacy APIs reject a bare World scope instead of upgrading it', async () => {
    const f = await fixture(true)
    const bare = { projectId: f.scope.projectId, worldId: f.scope.worldId }
    await expect(trackedLegacyLoad(bare as any)).rejects.toThrow()
    await expect(store().save({ projectId: f.scope.projectId, overview: '不可写' }, bare as any)).rejects.toThrow()
    expect(await rows(f.scope)).toEqual([])
  })

  it('a World author loads and saves without existing Work or Work lookup', async () => {
    const f = await fixture(true)
    const getWork = vi.spyOn(db.works, 'get'), queryWork = vi.spyOn(db.works, 'where'), addWork = vi.spyOn(db.works, 'add')
    const listWork = vi.spyOn(db.works, 'toArray'), bulkWork = vi.spyOn(db.works, 'bulkGet')
    await load(f.origin)
    await save(f.origin, { overview: '  作者原文\n' })
    const [row] = await rows(f.scope)
    expect(row).toMatchObject({ overview: '  作者原文\n', eraSystem: '', events: '[]', worldGroupId: null, worldId: f.scope.worldId })
    expect(isPortableResourceUidV1(row.ragDocumentId, 'history')).toBe(true)
    expect(row.workId).toBeUndefined()
    expect(store().loadedScope).toBeNull()
    expect(getWork).not.toHaveBeenCalled(); expect(queryWork).not.toHaveBeenCalled(); expect(addWork).not.toHaveBeenCalled()
    expect(listWork).not.toHaveBeenCalled(); expect(bulkWork).not.toHaveBeenCalled()
    expect(await db.works.count()).toBe(0)
  })

  it('a real independent Work author validates its scope before writing World history', async () => {
    const f = await seedCurrentWorkspace('独立长篇')
    const origin = workOrigin(f.scope)
    await load(origin)
    const traffic = captureHistoryRequestIdentities()
    let callerProof: { active: boolean; sameNative: boolean; tables: string[] } | undefined
    await db.transaction('rw', [...worldHistoryAdoptionTransactionTablesV1(), db.works], async () => {
      const caller = Dexie.currentTransaction!, native = caller.idbtrans
      traffic.start()
      try {
        await save(origin, { overview: '独立作品历史', eraSystem: '第一纪' })
        const activeAfterSave = caller.active && Dexie.currentTransaction?.idbtrans === native
        const [row] = await rows(f.scope)
        await db.histories.update(row.id, { eraSystem: '调用方最后纪年' })
        callerProof = { active: activeAfterSave, ...traffic.snapshot(native) }
      } finally { traffic.stop() }
    })
    await flushPendingEditsV1()
    expect(store().loadedScope).toEqual(f.scope)
    expect(store().loadedHistoryAuthorOrigin).toEqual(origin)
    expect({ row: (await rows(f.scope))[0], callerProof }).toMatchObject({
      row: { worldId: f.scope.worldId, overview: '独立作品历史', eraSystem: '调用方最后纪年', events: '[]' },
      callerProof: { active: true, sameNative: true, tables: ['histories', 'projects', 'works', 'worlds'] },
    })
  })

  it('World origin rejects own Work keys including null and undefined and other owner pollution', async () => {
    const f = await fixture()
    for (const pollution of [{ workId: f.scope.workId }, { workId: null }, { workId: undefined }, { productRuntimeSessionId: 1 }, { nodeRunId: 1 }]) {
      const origin = { version: 1, kind: 'world', scope: { projectId: f.scope.projectId, worldId: f.scope.worldId, ...pollution } } as any
      await expect(load(origin)).rejects.toThrow()
      await expect(save(origin, { overview: '不可写' })).rejects.toThrow()
    }
    expect(await db.histories.count()).toBe(0)
  })

  it('a forged Work origin cannot bypass missing or foreign Work validation', async () => {
    const a = await fixture(), b = await fixture()
    for (const workId of [b.scope.workId, 999999]) {
      const origin = workOrigin({ ...a.scope, workId })
      await expect(load(origin)).rejects.toThrow()
      await expect(save(origin, { overview: '不可写' })).rejects.toThrow()
    }
    await db.works.update(a.scope.workId, { code: '损坏Work身份' })
    await expect(save(workOrigin(a.scope), { overview: '坏Work身份' })).rejects.toThrow()
    expect(await db.histories.count()).toBe(0)
  })

  it('new World product admission rejects internal Worlds while generic World helpers stay valid', async () => {
    const f = await seedCurrentWorkspace('独立内部世界')
    await expect(scopes.resolveWorldOwnerScopeLike({ projectId: f.scope.projectId, worldId: f.scope.worldId })).resolves.toMatchObject({ worldId: f.scope.worldId })
    await expect(resolveWorldAuthoringOwnershipV1({ projectId: f.scope.projectId, worldId: f.scope.worldId })).rejects.toThrow()
    await expect(save(worldOrigin(f.scope), { overview: '不可降级' })).rejects.toThrow()
    await save(workOrigin(f.scope), { overview: '真实Work可写' })
    await db.works.delete(f.scope.workId)
    await expect(save(workOrigin(f.scope), { overview: '已删Work' })).rejects.toThrow()
    expect((await rows(f.scope))[0].overview).toBe('真实Work可写')
  })

  it('foreign deleted and malformed Project or World identities cannot create history', async () => {
    const a = await fixture(), b = await fixture(), c = await fixture()
    await expect(save(worldOrigin({ projectId: a.scope.projectId, worldId: b.scope.worldId }), { overview: '跨项目' })).rejects.toThrow()
    await db.projects.update(a.scope.projectId, { workspaceUid: '坏身份' })
    await expect(save(a.origin, { overview: '坏身份' })).rejects.toThrow()
    await db.worlds.delete(b.scope.worldId)
    await expect(save(b.origin, { overview: '已删除' })).rejects.toThrow()
    await db.worlds.update(c.scope.worldId, { code: '损坏World身份' })
    await expect(save(c.origin, { overview: '坏World身份' })).rejects.toThrow()
    expect(await db.histories.count()).toBe(0)
  })

  it('default partition never falls back to an existing other group', async () => {
    const f = await fixture(true), id = await group(f.scope)
    await save(f.origin, { overview: '其它组' }, id)
    await load(f.origin)
    expect(store().history).toBeNull()
    await save(f.origin, { overview: '默认组' })
    expect(await rows(f.scope)).toHaveLength(2)
    expect((await rows(f.scope)).find(row => row.worldGroupId === id)?.overview).toBe('其它组')
    expect(store().history).toMatchObject({ overview: '默认组', worldGroupId: null })
  })

  it('a numeric partition is updated only inside its real World', async () => {
    const f = await fixture(), a = await group(f.scope, 'A'), b = await group(f.scope, 'B')
    await save(f.origin, { overview: 'A' }, a); await save(f.origin, { overview: 'B' }, b)
    const before = (await rows(f.scope)).find(row => row.worldGroupId === b)
    await load(workOrigin(f.scope), a); await save(workOrigin(f.scope), { overview: 'A2' }, a)
    expect(store().history).toMatchObject({ overview: 'A2', worldGroupId: a })
    expect((await rows(f.scope)).find(row => row.worldGroupId === b)).toEqual(before)
  })

  it('foreign missing and malformed groups are rejected for both origins', async () => {
    const f = await fixture(), other = await fixture(), foreign = await group(other.scope)
    for (const origin of [f.origin, workOrigin(f.scope)]) {
      for (const id of [foreign, 999999, 0, -1, NaN]) {
        await expect(save(origin, { overview: '不可写' }, id)).rejects.toThrow()
      }
      await expect(store().saveForHistoryAuthorV1({ origin, patch: { overview: '缺选择' } } as any)).rejects.toThrow()
    }
    expect(await db.histories.count()).toBe(0)
  })

  it('duplicate singletons are rejected by load save and World adoption without cleanup', async () => {
    const f = await fixture(true)
    await save(f.origin, { overview: '原文' })
    const [first] = await rows(f.scope)
    const { id: _id, ...duplicate } = first
    await db.histories.add({ ...duplicate, overview: '第二原文' })
    const before = await rows(f.scope)
    await expect(load(f.origin)).rejects.toThrow('多条')
    await expect(save(f.origin, { overview: '覆盖' })).rejects.toThrow('多条')
    await expect(adoptWorld(f.scope, { eraSystem: '覆盖' })).rejects.toThrow('多条')
    expect(await rows(f.scope)).toEqual(before)
  })

  it('concurrent first fields create one complete native singleton across Work and World authors', async () => {
    const f = await fixture()
    await Promise.all([save(f.origin, { overview: '总述' }), save(workOrigin(f.scope), { eraSystem: '纪年' })])
    const all = await rows(f.scope)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ overview: '总述', eraSystem: '纪年', events: '[]', worldGroupId: null })
    // Same tick, same target and same field: the later call wins in either API
    // order, including a named real-Work author and a named World author.
    for (const origin of [f.origin, workOrigin(f.scope)]) {
      for (const legacyFirst of [true, false]) {
        const legacy = () => store().save({ projectId: f.scope.projectId, overview: legacyFirst ? '先旧API' : '后旧API' }, f.scope)
        const named = () => save(origin, { overview: legacyFirst ? '后新API' : '先新API' })
        const first = legacyFirst ? legacy() : named()
        const second = legacyFirst ? named() : legacy()
        await Promise.all([first, second])
        expect((await rows(f.scope))[0]).toMatchObject({ overview: legacyFirst ? '后新API' : '后旧API', eraSystem: '纪年' })
        expect(await rows(f.scope)).toHaveLength(1)
      }
    }
    const second = await fixture(true)
    // The independent adopter does not share the store's queue: the native RW
    // boundary must still serialize the absence check and first insertion.
    await Promise.all([save(second.origin, { overview: '原生并发总述' }), adoptWorld(second.scope, { eraSystem: '原生并发纪年' })])
    expect(await rows(second.scope)).toHaveLength(1)
    expect((await rows(second.scope))[0]).toMatchObject({ overview: '原生并发总述', eraSystem: '原生并发纪年', events: '[]' })
  })

  it('named text patches reject empty objects but selected empty strings really clear fields', async () => {
    const f = await fixture()
    await save(f.origin, { overview: '总述', eraSystem: '纪年' })
    const [before] = await rows(f.scope)
    for (const patch of [{}, { overview: null }, { overview: 12 }, { overview: '不得部分写', events: '[]' }, { worldId: f.scope.worldId }, { 'overview.text': '点路径' }, []]) {
      await expect(save(f.origin, patch as any)).rejects.toThrow()
    }
    expect((await rows(f.scope))[0]).toEqual(before)
    await save(f.origin, { overview: '' })
    expect((await rows(f.scope))[0]).toMatchObject({ overview: '', eraSystem: '纪年', events: before.events, ragDocumentId: before.ragDocumentId })
    await save(workOrigin(f.scope), { eraSystem: '' })
    expect((await rows(f.scope))[0]).toMatchObject({ overview: '', eraSystem: '' })
  })

  it('late legacy read cannot replace a newer named view or release its loading', testReadLifecycle.trackBody(async () => {
    const a = await fixture(), b = await fixture(), aReady = gate(), aWait = gate(), bReady = gate(), bWait = gate()
    spyOwnedReads(<T>(scope: WorldOwnerScope, table: string, read: () => Promise<T[]>) => Dexie.Promise.resolve(read()).then(value => {
      if (table !== 'histories') return value
      const [ready, held] = scope.worldId === a.scope.worldId ? [aReady, aWait] : [bReady, bWait]
      ready.resolve()
      return Dexie.Promise.resolve(wait(held.promise)).then(() => value)
    }))
    const old = testReadLifecycle.independentUIRead(() => trackedLegacyLoad(a.scope)); await aReady.promise
    const current = testReadLifecycle.independentUIRead(() => load(b.origin)); await bReady.promise
    aWait.resolve(); await old
    expect(store().loading).toBe(true); expect(store().history).toBeNull()
    bWait.resolve(); await current
    expect(store().loadedHistoryAuthorOrigin).toEqual(b.origin)
  }))

  it('late named read cannot replace a newer legacy Work view or release its loading', testReadLifecycle.trackBody(async () => {
    const a = await fixture(), b = await fixture(), aReady = gate(), aWait = gate(), bReady = gate(), bWait = gate()
    spyOwnedReads(<T>(scope: WorldOwnerScope, table: string, read: () => Promise<T[]>) => Dexie.Promise.resolve(read()).then(value => {
      if (table !== 'histories') return value
      const [ready, held] = scope.worldId === a.scope.worldId ? [aReady, aWait] : [bReady, bWait]
      ready.resolve()
      return Dexie.Promise.resolve(wait(held.promise)).then(() => value)
    }))
    const old = testReadLifecycle.independentUIRead(() => load(a.origin)); await aReady.promise
    const current = testReadLifecycle.independentUIRead(() => trackedLegacyLoad(b.scope)); await bReady.promise
    aWait.resolve(); await old
    expect(store().loading).toBe(true)
    bWait.resolve(); await current
    expect(store().loadedScope).toEqual(b.scope); expect(store().loadedHistoryAuthorOrigin).toBeNull()
  }))

  it('late failures in either API cannot clear the newer view loading or error', testReadLifecycle.trackBody(async () => {
    for (const firstNamed of [true, false]) {
      const a = await fixture(), b = await fixture(), aReady = gate(), aWait = gate(), bReady = gate(), bWait = gate()
      const spy = spyOwnedReads(<T>(scope: WorldOwnerScope, table: string, read: () => Promise<T[]>) => {
        if (table !== 'histories') return read()
        if (scope.worldId === a.scope.worldId) {
          aReady.resolve()
          return Dexie.Promise.resolve(wait(aWait.promise)).then(() => { throw new Error('晚到A错误') })
        }
        bReady.resolve()
        return Dexie.Promise.resolve(wait(bWait.promise)).then(read)
      })
      const old = testReadLifecycle.independentUIRead(() => firstNamed ? load(a.origin) : trackedLegacyLoad(a.scope)).catch(error => error)
      await aReady.promise
      const current = testReadLifecycle.independentUIRead(() => firstNamed ? trackedLegacyLoad(b.scope) : load(b.origin))
      await bReady.promise; aWait.resolve(); await old
      expect(store().loading).toBe(true); expect(store().loadError).toBeNull()
      bWait.resolve(); await current; spy.mockRestore()
    }
  }))

  it('delayed named save freezes text owner and group but cannot publish over a new view', async () => {
    const a = await fixture(), b = await fixture(), held = gate()
    await load(a.origin)
    const blocker = coordinatePendingEditV1({ key: targetKey(a.scope), persist: () => held.promise })
    const origin = worldOrigin(a.scope), patch = { overview: '调用时原稿' }
    const pending = save(origin, patch)
    origin.scope.worldId = b.scope.worldId; patch.overview = '稍后修改'
    await load(b.origin)
    held.resolve(); await blocker; await pending
    expect((await rows(a.scope))[0].overview).toBe('调用时原稿')
    expect(store().loadedHistoryAuthorOrigin).toEqual(b.origin); expect(store().history).toBeNull()
  })

  it('numeric legacy resolution remains frozen while a named World view is selected', async () => {
    const a = await fixture(), b = await fixture(), held = gate(), ready = gate()
    const resolve = scopes.resolveScopeLike
    const resolutionSpy = vi.spyOn(scopes, 'resolveScopeLike').mockImplementationOnce(async input => { const found = await resolve(input); ready.resolve(); return found })
    const blocker = coordinatePendingEditV1({ key: targetKey(a.scope), persist: () => held.promise })
    const pending = store().save({ projectId: a.scope.projectId, overview: '旧调用时归属' })
    await ready.promise
    const originalWorld = (await db.worlds.get(a.scope.worldId))!
    const nextWorldId = await db.worlds.add({ ...originalWorld, id: undefined, code: generateWorldCode(), name: '稍后活动World' })
    const nextWork = await addCurrentWorkFixtureV1({ projectId: a.scope.projectId, worldId: nextWorldId,
      create: { title: '稍后活动Work', kind: 'novel', novelProfile: 'long' } })
    await db.projects.update(a.scope.projectId, { activeWorldId: nextWorldId, activeWorkId: nextWork.id! })
    await load(b.origin)
    held.resolve(); await blocker; await pending
    expect((await rows(a.scope))[0].overview).toBe('旧调用时归属')
    expect(await rows(b.scope)).toEqual([]); expect(store().loadedHistoryAuthorOrigin).toEqual(b.origin)
    resolutionSpy.mockRestore()
    // Delay a *genuine captured* numeric resolution, then move active pointers.
    // Both invocation orders must keep the frozen World and the later text.
    for (const legacyFirst of [true, false]) {
      await db.projects.update(a.scope.projectId, { activeWorldId: a.scope.worldId, activeWorkId: a.scope.workId })
      const captured = gate(), continueResolution = gate()
      const spy = vi.spyOn(scopes, 'resolveScopeLike').mockImplementationOnce(async input => {
        const frozen = await resolve(input)
        captured.resolve(); await continueResolution.promise
        return frozen
      })
      const legacy = () => store().save({ projectId: a.scope.projectId, overview: legacyFirst ? '延迟先旧' : '延迟后旧' }, a.scope.projectId)
      const named = () => save(a.origin, { overview: legacyFirst ? '明确后新' : '明确先新' })
      const first = legacyFirst ? legacy() : named()
      const second = legacyFirst ? named() : legacy()
      await captured.promise
      await db.projects.update(a.scope.projectId, { activeWorldId: nextWorldId, activeWorkId: nextWork.id! })
      continueResolution.resolve()
      await Promise.all([first, second])
      spy.mockRestore()
      expect((await rows(a.scope))[0].overview).toBe(legacyFirst ? '明确后新' : '延迟后旧')
      expect(await rows({ projectId: a.scope.projectId, worldId: nextWorldId })).toEqual([])
      expect(store().loadedHistoryAuthorOrigin).toEqual(b.origin)
    }
  })

  it('a failed named field stays pending after another field or legacy save succeeds', async () => {
    const f = await fixture()
    await save(f.origin, { overview: '原总述', eraSystem: '原纪年' })
    failNextHistoryUpdate('总述保存失败')
    await expect(save(f.origin, { overview: '待保存总述' })).rejects.toThrow('总述保存失败')
    await save(f.origin, { eraSystem: '新纪年' })
    await store().save({ projectId: f.scope.projectId, eraSystem: '旧API成功' }, f.scope)
    await expect(flushPendingEditsV1()).rejects.toThrow('总述保存失败')
    expect((await rows(f.scope))[0].overview).toBe('原总述')
    await save(f.origin, { overview: '待保存总述' })
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    const noWork = await fixture(true)
    await expect(store().save({ projectId: noWork.scope.projectId, overview: '旧Work入口失败' }, noWork.scope.projectId)).rejects.toThrow()
    await save(noWork.origin, { overview: '真实World入口成功' })
    // Sharing registration order must not let a successful named admission
    // acknowledge the legacy lookup's unresolved Work authorization failure.
    await expect(flushPendingEditsV1()).rejects.toThrow()
    expect((await rows(noWork.scope))[0].overview).toBe('真实World入口成功')
  })

  it('another World cannot acknowledge a frozen World pending failure', async () => {
    const a = await fixture(), b = await fixture()
    await save(a.origin, { overview: 'A' })
    failNextHistoryUpdate('A保存失败')
    await expect(save(a.origin, { overview: 'A2' })).rejects.toThrow()
    await save(b.origin, { overview: 'B' })
    await expect(flushPendingEditsV1()).rejects.toThrow('A保存失败')
    await save(a.origin, { overview: 'A2' })
    await expect(flushPendingEditsV1()).resolves.toHaveProperty('version', 1)
  })

  it('all validates origin and is readonly for both author kinds without an editable default', async () => {
    const f = await fixture()
    await save(f.origin, { overview: '默认原文' })
    for (const origin of [f.origin, workOrigin(f.scope)]) {
      await trackedNamedLoad({ origin, selection: { kind: 'all' } })
      expect(store().history).toBeNull(); expect(store().loadedHistoryAuthorSelection).toEqual({ kind: 'all' })
      await expect(store().saveForHistoryAuthorV1({ origin, selection: { kind: 'all' }, patch: { overview: '一览覆写' } } as any)).rejects.toThrow('只读')
    }
    expect((await rows(f.scope))[0].overview).toBe('默认原文')
    expect(pendingEditDiagnosticsV1().writeCount).toBe(0)
  })

  it('partition null is writable and malformed all is never downgraded to it', async () => {
    const f = await fixture(true)
    await save(f.origin, { overview: '明确默认' }); await load(f.origin)
    expect(store().history?.overview).toBe('明确默认')
    await expect(trackedNamedLoad({ origin: f.origin, selection: { kind: 'all', worldGroupId: null } } as any)).rejects.toThrow()
    await expect(store().saveForHistoryAuthorV1({ origin: f.origin, selection: { kind: 'partition' }, patch: { overview: '缺分区' } } as any)).rejects.toThrow()
    expect((await rows(f.scope))[0].overview).toBe('明确默认')
  })

  it('World singleton adoption creates complete defaults with registered identity', async () => {
    for (const data of [{ overview: '总述' }, { eraSystem: '纪年' }, { overview: '联合总述', eraSystem: '联合纪年' }]) {
      const f = await fixture(true), workRead = vi.spyOn(db.works, 'get')
      expect((await adoptWorld(f.scope, data)).written).toHaveLength(1)
      const [row] = await rows(f.scope)
      expect(row).toMatchObject({ overview: data.overview ?? '', eraSystem: data.eraSystem ?? '', events: '[]', worldGroupId: null })
      expect(isPortableResourceUidV1(row.ragDocumentId, 'history')).toBe(true)
      expect(workRead).not.toHaveBeenCalled(); workRead.mockRestore()
    }
  })

  it('World adoption clears selected text without backfilling or overwriting other fields', async () => {
    const f = await fixture(true)
    await save(f.origin, { overview: '原总述', eraSystem: '保留纪年' })
    const [before] = await rows(f.scope)
    await adoptWorld(f.scope, { overview: '' })
    expect((await rows(f.scope))[0]).toMatchObject({ overview: '', eraSystem: before.eraSystem, events: before.events, ragDocumentId: before.ragDocumentId })
    await db.histories.update(before.id, { eraSystem: undefined })
    await adoptWorld(f.scope, { overview: '仅选总述' })
    expect((await rows(f.scope))[0].eraSystem).toBeUndefined()
    await expect(adoptWorld(f.scope, {})).rejects.toThrow()
  })

  it('old Work adoption still validates Work and retains its empty-string semantics', async () => {
    const f = await fixture()
    await store().save({ projectId: f.scope.projectId, overview: '旧采纳原文' }, f.scope)
    await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'histories', mode: 'replace', data: { overview: '' } })
    expect((await rows(f.scope))[0].overview).toBe('旧采纳原文')
    await db.works.delete(f.scope.workId)
    await expect(adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'histories', mode: 'replace', data: { overview: '坏Work' } })).rejects.toThrow()
    expect((await rows(f.scope))[0].overview).toBe('旧采纳原文')
  })

  it('World adoption rejects collection recordId events and mixed owner inputs', async () => {
    const f = await fixture(true)
    const input = { target: 'histories', ownerScope: { projectId: f.scope.projectId, worldId: f.scope.worldId }, selection: partition(), mode: 'replace', data: { overview: '原文' } }
    for (const extra of [{ recordId: 1 }, { mode: 'append' }, { mode: 'add' }, { mode: 'add-many' }, { mode: 'merge-diffs' }, { data: { overview: '不得部分写', events: '[]' } }, { scope: f.scope }, { selection: { kind: 'all' } }]) {
      await expect(adopt({ ...input, ...extra } as any)).rejects.toThrow()
    }
    expect(await db.histories.count()).toBe(0)
  })

  it('World adoption rolls back with its real caller-owned native transaction', async () => {
    const f = await fixture(true)
    await expect(db.transaction('rw', worldHistoryAdoptionTransactionTablesV1(), async () => {
      const result = await adopt({ target: 'histories', ownerScope: { projectId: f.scope.projectId, worldId: f.scope.worldId },
        selection: partition(), mode: 'replace', data: { overview: '应回滚' } }, { transaction: Dexie.currentTransaction! })
      expect(result.written).toHaveLength(1)
      throw new Error('父事务失败')
    })).rejects.toThrow('父事务失败')
    expect(await rows(f.scope)).toEqual([])
  })

  it('caller-owned World adoption rejects readonly foreign and incomplete transactions', async () => {
    const f = await fixture(true)
    const input = { target: 'histories' as const, ownerScope: { projectId: f.scope.projectId, worldId: f.scope.worldId }, selection: partition(), mode: 'replace' as const, data: { overview: '不可写' } }
    const requireBothReject = () => Dexie.Promise.allSettled([
      adopt(input, { transaction: Dexie.currentTransaction! }), save(f.origin, { overview: '不可写' }),
    ]).then(results => {
      if (results.every(result => result.status === 'rejected')) throw new Error('两条入口均拒绝无效调用方')
    })
    await expect(db.transaction('r', worldHistoryAdoptionTransactionTablesV1(), requireBothReject)).rejects.toThrow('两条入口均拒绝')
    await expect(db.transaction('rw', [db.projects, db.worlds, db.histories], requireBothReject)).rejects.toThrow('两条入口均拒绝')
    const other = new Dexie('sf061-foreign-transaction')
    other.version(1).stores({ values: '++id' }); await other.open()
    try { await expect(other.transaction('rw', other.table('values'), requireBothReject)).rejects.toThrow('两条入口均拒绝') }
    finally { await other.delete() }
    expect(await rows(f.scope)).toEqual([])
    expect((await adoptWorld(f.scope, { overview: '完整自有事务' })).written).toHaveLength(1)
  })

  it('a named save never publishes before native outer commit and rollback remains pending', testReadLifecycle.trackBody(async () => {
    const f = await fixture(true), groupId = await group(f.scope)
    await save(f.origin, { overview: '已提交原文' }, groupId); await load(f.origin, groupId)
    const before = store().history, terminal = nativeTerminalReceipt(), traffic = captureHistoryRequestIdentities()
    await expect(db.transaction('rw', worldHistoryAdoptionTransactionTablesV1(), async () => {
      const caller = Dexie.currentTransaction!, native = caller.idbtrans
      terminal.watch(native); traffic.start()
      try {
        await save(f.origin, { overview: '父事务未提交' }, groupId)
        expect({ history: store().history, active: caller.active && Dexie.currentTransaction?.idbtrans === native,
          ...traffic.snapshot(native) }).toEqual({ history: before, active: true, sameNative: true,
          tables: ['histories', 'projects', 'worldGroups', 'worlds'] })
        throw new Error('原生回滚')
      } finally { traffic.stop() }
    })).rejects.toThrow('原生回滚')
    const nativeOutcome = await terminal.promise
    // The target queue may outlive a caller; it must reject rather than open a
    // detached writer after that original native transaction has completed.
    const held = gate()
    const blocker = coordinatePendingEditV1({ key: targetKey(f.scope, groupId), persist: () => held.promise })
    let expiredWrite!: Promise<void>
    await db.transaction('rw', worldHistoryAdoptionTransactionTablesV1(), async () => {
      expiredWrite = store().saveForHistoryAuthorV1({ origin: f.origin, selection: partition(groupId), patch: { overview: '过期原事务不得写' } as any })
      void expiredWrite.catch(() => undefined)
    })
    held.resolve(); await blocker
    const rejectedExpired = await expiredWrite.then(() => false, error => String(error).includes('原事务'))
    expect(store().history).toEqual(before)
    expect({ overview: (await rows(f.scope))[0].overview, nativeOutcome, rejectedExpired })
      .toEqual({ overview: '已提交原文', nativeOutcome: 'abort', rejectedExpired: true })
    await expect(flushPendingEditsV1()).rejects.toThrow()
    await save(f.origin, { overview: '明确重试' }, groupId)
    await expect(flushPendingEditsV1()).resolves.toHaveProperty('version', 1)
  }))

  it('outer commit reads final rows and cannot revive an old view after a newer request', testReadLifecycle.trackBody(async () => {
    const a = await fixture(true), b = await fixture(true)
    await save(a.origin, { overview: 'A原文' }); await load(a.origin)
    const traffic = captureHistoryRequestIdentities()
    let activeAfterSave = false, sameNative = false
    await db.transaction('rw', worldHistoryAdoptionTransactionTablesV1(), async () => {
      const caller = Dexie.currentTransaction!, native = caller.idbtrans
      traffic.start()
      try {
        await save(a.origin, { overview: 'A提交' })
        activeAfterSave = caller.active && Dexie.currentTransaction?.idbtrans === native
        const [row] = await rows(a.scope)
        await db.histories.update(row.id, { eraSystem: '父事务最后修改' })
        sameNative = traffic.snapshot(native).sameNative
      } finally { traffic.stop() }
    })
    await flushPendingEditsV1()
    expect({ history: store().history, activeAfterSave, sameNative }).toMatchObject({
      history: { overview: 'A提交', eraSystem: '父事务最后修改' }, activeAfterSave: true, sameNative: true,
    })
    await db.transaction('rw', worldHistoryAdoptionTransactionTablesV1(), async () => {
      await save(a.origin, { overview: 'A晚提交' })
      // B claims the view synchronously and publishes only after this native root commits.
      const current = load(b.origin)
      void current.catch(() => undefined)
    })
    await flushPendingEditsV1()
    await vi.waitFor(() => expect(store().loadedHistoryAuthorOrigin).toEqual(b.origin))
    expect(store().history).toBeNull(); expect((await rows(a.scope))[0].overview).toBe('A晚提交')
  }))
})
