/**
 * R-17: ensureSchema 生产环境不自动删库
 *
 * 对应 MASTER-BLUEPRINT §4.0.3。
 *
 * 反例:
 *   旧实现发现缺表后无条件 Dexie.delete('storyforge')。
 *
 * 期望:
 *   生产路径缺表时只返回 blocked,不调用 Dexie.delete,旧 IndexedDB 保留。
 */
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { ensureSchema, REQUIRED_TABLES_V26 } from '../../src/lib/db/ensure-schema'

const DB_NAME = 'storyforge'

describe('R-17: ensureSchema 生产环境不自动删库', () => {
  beforeEach(async () => {
    await deleteNativeDb(DB_NAME)
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
    await deleteNativeDb(DB_NAME)
  })

  it('REQUIRED_TABLES_V26 与 schema.ts 当前 Dexie 表双向一致', () => {
    const schemaTables = db.tables.map(table => table.name).sort()
    const requiredTables = [...REQUIRED_TABLES_V26].sort()

    expect(requiredTables).toHaveLength(43)   // v29 删除 itemSystems/factions 后:45→43
    expect(requiredTables).toEqual(schemaTables)
  })

  it('生产路径缺表时不调用 Dexie.delete,并保留旧库', async () => {
    await createLegacyDbWithOnlyProjects()
    const deleteSpy = vi.spyOn(Dexie, 'delete')

    const result = await ensureSchema(REQUIRED_TABLES_V26, {
      allowReset: false,
      notifyUser: false,
    })

    expect(result.reset).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.missing.length).toBeGreaterThan(0)
    expect(deleteSpy).not.toHaveBeenCalled()

    const stores = await readStoreNames(DB_NAME)
    expect(stores).toContain('projects')
  })
})

function createLegacyDbWithOnlyProjects(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('legacy DB create blocked'))
  })
}

function readStoreNames(name: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => {
      const database = req.result
      const stores = [...database.objectStoreNames]
      database.close()
      resolve(stores)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('DB read blocked'))
  })
}

function deleteNativeDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('DB delete blocked'))
  })
}
