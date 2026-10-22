/** Test environment only: fake-indexeddb 6.2.5 retains finished scheduler entries indefinitely. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const packagePath = resolve(dirname(createRequire(import.meta.url).resolve('fake-indexeddb')), '../../package.json')
const metadata: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw new Error('Unknown fake-indexeddb version metadata')
const version = metadata.version

type PendingTransaction = { _state: 'active' | 'inactive' | 'committing' | 'finished' }
type Backend = { transactions: PendingTransaction[]; processTransactions: () => void }
interface Lifecycle { stats: { removedFinished: number; maximumRetained: number }; dispose(): void }
const installed = new WeakMap<IDBFactory, Lifecycle>()

function backend(value: unknown): Backend {
  if (!value || typeof value !== 'object'
    || !('transactions' in value) || !Array.isArray(value.transactions)
    || !('processTransactions' in value) || typeof value.processTransactions !== 'function') throw new Error('Unsupported fake-indexeddb scheduler shape')
  return value as Backend
}

function install(factory: IDBFactory): Lifecycle {
  const candidate = factory as IDBFactory & { _databases?: unknown }
  if (!(candidate._databases instanceof Map)) throw new Error('Unsupported fake-indexeddb factory shape')
  const databases = candidate._databases
  const originalOpen = factory.open, ownOpen = Object.getOwnPropertyDescriptor(factory, 'open')
  const originals = new Map<Backend, { descriptor: PropertyDescriptor; wrapper: () => void }>()
  let disposed = false
  const stats = { removedFinished: 0, maximumRetained: 0 }
  const decorate = (name: string) => {
    const database = backend(databases.get(name))
    if (originals.has(database)) return
    const original = Object.getOwnPropertyDescriptor(database, 'processTransactions')
    if (!original || !('value' in original) || typeof original.value !== 'function') throw new Error('Unsupported fake-indexeddb bound scheduler')
    const wrapper = function () {
      if (disposed) return Reflect.apply(original.value, database, [])
      const transactions = database.transactions
      stats.maximumRetained = Math.max(stats.maximumRetained, transactions.length)
      let retained = 0
      for (const transaction of transactions) {
        if (!transaction || !['active', 'inactive', 'committing', 'finished'].includes(transaction._state)) throw new Error('Unsupported fake-indexeddb transaction state')
        if (transaction._state === 'finished') stats.removedFinished += 1
        else transactions[retained++] = transaction
      }
      // Preserve the actual array, every unfinished entry, and their relative order.
      transactions.length = retained
      Reflect.apply(original.value, database, [])
    }
    originals.set(database, { descriptor: original, wrapper })
    Object.defineProperty(database, 'processTransactions', { ...original, value: wrapper })
  }
  const wrappedOpen = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
    const request = Reflect.apply(originalOpen, this, args)
    // Borrowed calls retain their original receiver and behavior.
    if (this === factory && !disposed) {
      const ready = () => { if (!disposed) decorate(request.result.name) }
      request.addEventListener('upgradeneeded', ready)
      request.addEventListener('success', ready)
    }
    return request
  }
  Object.defineProperty(factory, 'open', { configurable: true, writable: true, value: wrappedOpen })
  return { stats, dispose() {
    if (disposed) return
    disposed = true
    if (factory.open === wrappedOpen) {
      if (ownOpen) Object.defineProperty(factory, 'open', ownOpen)
      else Reflect.deleteProperty(factory, 'open')
    }
    for (const [database, saved] of originals) if (database.processTransactions === saved.wrapper) Object.defineProperty(database, 'processTransactions', saved.descriptor)
    installed.delete(factory)
  } }
}

export function installFakeIdbTransactionLifecycleV1(factory: IDBFactory, installedVersion = version) {
  if (installedVersion !== '6.2.5') throw new Error('Review the fake-indexeddb transaction lifecycle workaround before changing version')
  const previous = installed.get(factory)
  if (previous) return previous
  const lifecycle = install(factory)
  installed.set(factory, lifecycle)
  return lifecycle
}
