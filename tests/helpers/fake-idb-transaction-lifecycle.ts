/** Test environment only: fake-indexeddb 6.2.6 owns finished-transaction cleanup.
 * Its FDBTransaction._markFinished queues removal itself. Never install the
 * retired 6.2.5 pruning wrapper over it: both removals would race. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const packagePath = resolve(dirname(createRequire(import.meta.url).resolve('fake-indexeddb')), '../../package.json')
const metadata: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw new Error('Unknown fake-indexeddb version metadata')
const version = metadata.version
interface Lifecycle { mode: 'native-6.2.6'; dispose(): void }
const installed = new WeakMap<IDBFactory, Lifecycle>()

export function installFakeIdbTransactionLifecycleV1(factory: IDBFactory, installedVersion = version): Lifecycle {
  if (installedVersion !== version || installedVersion !== '6.2.6') throw new Error('Review the fake-indexeddb transaction lifecycle workaround before changing version')
  if (!factory || typeof factory.open !== 'function'
    || !('_databases' in factory) || !(factory._databases instanceof Map)) throw new Error('Unsupported fake-indexeddb factory shape')
  const previous = installed.get(factory)
  if (previous) return previous
  const lifecycle: Lifecycle = { mode: 'native-6.2.6', dispose() {
    if (installed.get(factory) === lifecycle) installed.delete(factory)
  } }
  installed.set(factory, lifecycle)
  return lifecycle
}
