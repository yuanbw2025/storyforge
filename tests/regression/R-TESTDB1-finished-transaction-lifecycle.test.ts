import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { installFakeIdbTransactionLifecycleV1 } from '../helpers/fake-idb-transaction-lifecycle'

const connections: IDBDatabase[] = [], disposers: Array<() => void> = []
afterEach(() => { for (const database of connections.splice(0)) database.close(); for (const dispose of disposers.splice(0)) dispose() })
function factory(prune: boolean) {
  const value = new IDBFactory()
  const lifecycle = prune ? installFakeIdbTransactionLifecycleV1(value) : null
  if (lifecycle) disposers.push(() => lifecycle.dispose())
  return { value, lifecycle }
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function done(transaction: IDBTransaction) {
  return new Promise<string>(resolve => {
    transaction.addEventListener('complete', () => resolve('complete'), { once: true })
    transaction.addEventListener('abort', () => resolve('abort'), { once: true })
  })
}
async function open(value: IDBFactory, name: string) {
  const request = value.open(name, 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore('a', { keyPath: 'id' }).createIndex('unique', 'value', { unique: true })
    request.result.createObjectStore('b', { keyPath: 'id' })
  }
  const database = await result(request); connections.push(database); return database
}
async function all(database: IDBDatabase, store = 'a') {
  const transaction = database.transaction(store, 'readonly'), complete = done(transaction)
  const rows = await result(transaction.objectStore(store).getAll())
  expect(await complete).toBe('complete'); return rows
}

describe('R-TESTDB1 finished-transaction cleanup preserves public IndexedDB semantics', () => {
  for (const prune of [false, true]) {
    it(`serializes overlapping writes and preserves queued read visibility (cleanup=${prune})`, async () => {
      const f = factory(prune), database = await open(f.value, 'ordering'), trace: string[] = []
      const first = database.transaction('a', 'readwrite'), firstDone = done(first)
      first.objectStore('a').put({ id: 1, value: 1 })
      first.oncomplete = () => trace.push('first-complete')
      const second = database.transaction('a', 'readwrite'), secondDone = done(second)
      const read = second.objectStore('a').get(1)
      read.onsuccess = () => { trace.push(`second-read-${read.result.value}`); second.objectStore('a').put({ id: 1, value: 2 }) }
      const third = database.transaction('a', 'readonly'), thirdDone = done(third)
      const final = third.objectStore('a').get(1)
      final.onsuccess = () => trace.push(`third-read-${final.result.value}`)
      expect(await Promise.all([firstDone, secondDone, thirdDone])).toEqual(['complete', 'complete', 'complete'])
      expect(trace).toEqual(['first-complete', 'second-read-1', 'third-read-2'])
      expect(await all(database)).toEqual([{ id: 1, value: 2 }])
    })
    it(`keeps readonly overlap and disjoint store transactions usable (cleanup=${prune})`, async () => {
      const f = factory(prune), database = await open(f.value, 'disjoint')
      const trace: string[] = []
      const write = database.transaction('a', 'readwrite'), writeDone = done(write)
      const store = write.objectStore('a')
      let remaining = 20
      const keepActive = () => { if (remaining-- > 0) store.get(1).onsuccess = keepActive }
      store.put({ id: 1, value: 10 }).onsuccess = keepActive
      write.oncomplete = () => trace.push('a-complete')
      const readers = [0, 1].map(() => { const tx = database.transaction('a', 'readonly'); return { complete: done(tx), value: result(tx.objectStore('a').get(1)) } })
      const independent = database.transaction('b', 'readwrite'), independentDone = done(independent)
      independent.oncomplete = () => trace.push('b-complete')
      independent.objectStore('b').put({ id: 2, value: 20 })
      expect(await Promise.all([writeDone, independentDone, ...readers.map(reader => reader.complete)])).toEqual(['complete', 'complete', 'complete', 'complete'])
      expect(await Promise.all(readers.map(reader => reader.value))).toEqual([{ id: 1, value: 10 }, { id: 1, value: 10 }])
      expect(await all(database, 'b')).toEqual([{ id: 2, value: 20 }])
      expect(trace).toEqual(['b-complete', 'a-complete'])
    })
    it(`retains committing transactions until all pending writes complete (cleanup=${prune})`, async () => {
      const f = factory(prune), database = await open(f.value, 'commit')
      const transaction = database.transaction('a', 'readwrite'), complete = done(transaction)
      transaction.objectStore('a').put({ id: 1, value: 1 })
      transaction.commit()
      expect(() => transaction.objectStore('a').put({ id: 2, value: 2 })).toThrow()
      expect(await complete).toBe('complete')
      expect(await all(database)).toEqual([{ id: 1, value: 1 }])
    })
    it(`keeps explicit abort and uniqueness failure atomic, with error prevention still honored (cleanup=${prune})`, async () => {
      const f = factory(prune), database = await open(f.value, 'rollback')
      const aborted = database.transaction('a', 'readwrite'), abortedDone = done(aborted)
      const put = aborted.objectStore('a').put({ id: 1, value: 1 })
      put.onsuccess = () => aborted.abort()
      expect(await abortedDone).toBe('abort'); expect(await all(database)).toEqual([])
      const failed = database.transaction('a', 'readwrite'), failedDone = done(failed), errors: string[] = []
      failed.objectStore('a').put({ id: 1, value: 1 })
      failed.objectStore('a').put({ id: 2, value: 1 }).onerror = event => errors.push((event.target as IDBRequest).error!.name)
      expect(await failedDone).toBe('abort'); expect(errors).toEqual(['ConstraintError']); expect(await all(database)).toEqual([])
      const continued = database.transaction('a', 'readwrite'), continuedDone = done(continued)
      continued.objectStore('a').put({ id: 1, value: 1 })
      continued.objectStore('a').put({ id: 2, value: 1 }).onerror = event => event.preventDefault()
      continued.objectStore('a').put({ id: 3, value: 3 })
      expect(await continuedDone).toBe('complete'); expect(await all(database)).toEqual([{ id: 1, value: 1 }, { id: 3, value: 3 }])
    })
    it(`preserves blocked version changes and deletion/recreation (cleanup=${prune})`, async () => {
      const f = factory(prune), database = await open(f.value, 'upgrade'), events: string[] = []
      database.onversionchange = () => events.push('versionchange')
      const upgrade = f.value.open('upgrade', 2)
      upgrade.onblocked = () => { events.push('blocked'); database.close() }
      upgrade.onupgradeneeded = () => { events.push('upgrade'); upgrade.result.createObjectStore('c') }
      const next = await result(upgrade); connections.push(next)
      expect(events).toEqual(['versionchange', 'blocked', 'upgrade'])
      expect(next.objectStoreNames.contains('c')).toBe(true)
      next.close(); await result(f.value.deleteDatabase('upgrade'))
      const recreated = await open(f.value, 'upgrade')
      expect(recreated.objectStoreNames.contains('c')).toBe(false)
      expect(await all(recreated)).toEqual([])
    })
  }
  it('bounds completed scheduler retention without removing stored data or invalidating held transactions', async () => {
    const f = factory(true), database = await open(f.value, 'retention')
    let held: IDBTransaction | null = null
    for (let i = 0; i < 200; i++) {
      const transaction = database.transaction('a', 'readwrite'), complete = done(transaction)
      transaction.objectStore('a').put({ id: i, value: i }); expect(await complete).toBe('complete'); held = transaction
    }
    expect(await all(database)).toHaveLength(200)
    expect(f.lifecycle!.stats.removedFinished).toBeGreaterThanOrEqual(200)
    expect(f.lifecycle!.stats.maximumRetained).toBeLessThan(10)
    expect(() => held!.objectStore('a').get(0)).toThrow()
  })
  it('restores the factory method and leaves borrowed calls and unsupported versions unchanged', async () => {
    const a = new IDBFactory(), b = new IDBFactory(), original = a.open
    expect(() => installFakeIdbTransactionLifecycleV1(a, 'unknown')).toThrow(/version/)
    expect(a.open).toBe(original)
    const lifecycle = installFakeIdbTransactionLifecycleV1(a)
    expect(installFakeIdbTransactionLifecycleV1(a)).toBe(lifecycle)
    const request = Reflect.apply(a.open, b, ['borrowed'])
    const database = await result(request); connections.push(database)
    expect(lifecycle.stats.removedFinished).toBe(0)
    lifecycle.dispose(); expect(a.open).toBe(original); expect(Object.hasOwn(a, 'open')).toBe(false)
  })
  it('does not decorate a late open after disposal or remove a later installation', async () => {
    const value = new IDBFactory(), first = installFakeIdbTransactionLifecycleV1(value)
    const pending = open(value, 'late')
    first.dispose()
    const database = await pending
    expect(first.stats.removedFinished).toBe(0)
    const second = installFakeIdbTransactionLifecycleV1(value)
    first.dispose()
    expect(installFakeIdbTransactionLifecycleV1(value)).toBe(second)
    const connection = await open(value, 'late')
    const transaction = connection.transaction('a', 'readwrite'), complete = done(transaction)
    transaction.objectStore('a').put({ id: 1, value: 1 }); expect(await complete).toBe('complete')
    expect(await all(database)).toEqual([{ id: 1, value: 1 }])
    expect(second.stats.removedFinished).toBeGreaterThan(0)
    second.dispose()
  })
  it('fails closed on unknown factory layout and preserves another owner replacement', () => {
    expect(() => installFakeIdbTransactionLifecycleV1({} as IDBFactory)).toThrow(/factory shape/)
    const value = new IDBFactory(), original = value.open, lifecycle = installFakeIdbTransactionLifecycleV1(value)
    const replacement: typeof value.open = function (...args) { return Reflect.apply(original, this, args) }
    Object.defineProperty(value, 'open', { configurable: true, writable: true, value: replacement })
    lifecycle.dispose()
    expect(value.open).toBe(replacement)
  })
})
