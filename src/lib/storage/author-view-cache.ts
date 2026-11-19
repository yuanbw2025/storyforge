import { IS_SHOWCASE, SHOWCASE_DATABASE } from '../showcase/policy'

/** Disposable browser author-view cache, like the separate folder-handle store.
 * This is infrastructure, not a PROJECT_TABLES domain/semantic/media table.
 * Portable assets must be exported explicitly by their authoring feature. */
const name = IS_SHOWCASE ? `${SHOWCASE_DATABASE}-author-view-cache-v1` : 'storyforge-author-view-cache-v1'
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('entries')
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(Error('本机查看缓存被其他页面占用')) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('entries', mode)
      let value: T
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? Error('本机查看缓存事务已中止'))
      try { run(tx.objectStore('entries'), next => { value = next }) }
      catch (cause) { tx.abort(); reject(cause) }
    })
  } finally { db.close() }
}
export const authorViewCache = {
  get(key: string): Promise<unknown> {
    return transaction('readonly', (store, result) => { const r = store.get(key); r.onsuccess = () => result(r.result) })
  },
  put(key: string, value: unknown): Promise<void> {
    return transaction('readwrite', store => { store.put(value, key) })
  },
  remove(key: string): Promise<void> {
    return transaction('readwrite', store => { store.delete(key) })
  },
  removePrefix(prefix: string): Promise<void> {
    return transaction('readwrite', store => {
      const r = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
      r.onsuccess = () => { const cursor = r.result; if (cursor) { cursor.delete(); cursor.continue() } }
    })
  },
}
