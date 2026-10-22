import Dexie from 'dexie'
import { StoryForgeDB, STORYFORGE_STORES_V11 } from '../../src/lib/db/schema'

/** Isolated real-IDB failure/retry fixture. Never opens the author's database. */
export async function ttrpgMemorySchemaFailureFixtureV1() {
  const name = `ttrpg-memory-native-migration-${crypto.randomUUID()}`
  const old = new Dexie(name); old.version(11).stores(STORYFORGE_STORES_V11)
  const current = new StoryForgeDB(name)
  try {
    await old.open()
    const original = { projectId: 1, worldId: 1, title: '迁移失败也保留的原稿', kind: 'ttrpg' }
    const id = await old.table('works').add(original)
    old.close()
    const create = IDBDatabase.prototype.createObjectStore
    let failed = false
    IDBDatabase.prototype.createObjectStore = function (store, options) {
      if (store === 'ttrpgNarrativeMemories') throw new DOMException('Fixture memory store quota failure', 'QuotaExceededError')
      return create.call(this, store, options)
    }
    try { await current.open() } catch { failed = true } finally { IDBDatabase.prototype.createObjectStore = create; current.close() }
    if (!failed) throw new Error('Expected actual store creation failure')
    await old.open()
    const beforeRetry = await old.table('works').get(id)
    if (old.verno !== 11 || old.tables.some(table => table.name === 'ttrpgNarrativeMemories')) throw new Error('Upgrade did not roll back')
    old.close()
    await current.open()
    return { failed, beforeRetry, afterRetry: await current.works.get(id as number),
      version: current.verno, memoryCount: await current.ttrpgNarrativeMemories.count(), original: { ...original, id } }
  } finally { old.close(); current.close(); await Dexie.delete(name) }
}
