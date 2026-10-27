import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { db, StoryForgeDB, STORYFORGE_STORES, STORYFORGE_STORES_V11, STORYFORGE_SCHEMA_VERSION } from '../../src/lib/db/schema'
import { openCurrentSchema } from '../../src/lib/db/ensure-schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CURRENT_BACKUP_VERSION, inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'

afterEach(() => db.close())

describe('TTRPG/NW integration · preserve independent owners through version collisions', () => {
  it.each(['v11', 'ttrpg-v12', 'world-v12'] as const)('%s upgrades without rewriting any existing records', async profile => {
    const name = `ttrpg-nw-migration-${profile}-${crypto.randomUUID()}`
    const oldStores = { ...STORYFORGE_STORES_V11,
      ...(profile === 'ttrpg-v12' ? { ttrpgNarrativeMemories: STORYFORGE_STORES.ttrpgNarrativeMemories } : {}),
      ...(profile === 'world-v12' ? { worldNarrativeIndexCaches: STORYFORGE_STORES.worldNarrativeIndexCaches } : {}) }
    const old = new Dexie(name), next = new StoryForgeDB(name)
    try {
      old.version(profile === 'v11' ? 11 : 12).stores(oldStores)
      await old.open()
      const rows: Record<string, Record<string, unknown>> = {
        works: { id: 1, projectId: 1, worldId: 1, title: '保持作者原稿', kind: 'ttrpg', original: '{"bytes":true}' },
        worldReleases: { id: 1, projectId: 1, worldId: 1, contentHash: 'frozen', contentJson: '{"world":true}' },
        extensionRecords: { id: 1, projectId: 1, profileId: 1, generation: 1, key: 'original', payload: { text: '不执行插件' } },
      }
      if (profile === 'ttrpg-v12') rows.ttrpgNarrativeMemories = { id: 1, projectId: 1, sessionId: 1, revisionKey: 'original', summary: '原团局记忆' }
      if (profile === 'world-v12') rows.worldNarrativeIndexCaches = { id: 1, projectId: 1, worldId: 1, releaseId: 1, indexJson: '{"original":true}', lastAccessedAt: 1 }
      for (const [table, row] of Object.entries(rows)) await old.table(table).add(structuredClone(row))
      old.close()
      await next.open()
      expect(next.verno).toBe(13)
      for (const [table, row] of Object.entries(rows)) expect(await next.table(table).get(1)).toEqual(row)
      expect(await next.ttrpgNarrativeMemories.count()).toBe(profile === 'ttrpg-v12' ? 1 : 0)
      expect(await next.worldNarrativeIndexCaches.count()).toBe(profile === 'world-v12' ? 1 : 0)
    } finally { old.close(); next.close(); await Dexie.delete(name) }
  })

  it('refuses a future native database version without rewriting its records', async () => {
    db.close(); await db.delete()
    const future = new Dexie(db.name)
    try {
      future.version(STORYFORGE_SCHEMA_VERSION + 1).stores(STORYFORGE_STORES)
      await future.open()
      const row = { id: 1, title: '未来版本保持原样' }
      await future.table('works').add(row)
      future.close()
      await expect(openCurrentSchema()).rejects.toThrow('只支持当前 schema v13')
      await future.open()
      expect(await future.table('works').get(1)).toEqual(row)
    } finally { db.close(); future.close(); await Dexie.delete(db.name) }
  })

  it.each(['world-v16', 'ttrpg-v16'] as const)('%s restores through the explicit converter and retains its input', async profile => {
    await db.delete(); await db.open()
    const created = await createWorkspace({ name: '旧格式保留', genres: [], status: 'drafting', description: '', targetWordCount: 0 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const backup = await exportProjectJSON(created.scope.projectId)
    const legacy = { ...structuredClone(backup), version: 16 } as Record<string, unknown> & { version: number }
    if (profile === 'world-v16') delete legacy.ttrpgNarrativeMemories
    const original = JSON.stringify(legacy)
    expect(inspectProjectBackup(legacy).valid).toBe(true)
    const normalized = normalizeProjectBackup(legacy)
    expect(normalized.version).toBe(CURRENT_BACKUP_VERSION)
    expect(normalized.ttrpgNarrativeMemories).toEqual([])
    expect(JSON.stringify(legacy)).toBe(original)
    const restored = await importProjectJSON(legacy as never)
    expect((await db.works.where('projectId').equals(restored).toArray()).map(row => row.title)).toEqual(
      (await db.works.where('projectId').equals(created.scope.projectId).toArray()).map(row => row.title))
  })

  it('rejects missing current/core tables and malformed legacy memory instead of silently repairing them', async () => {
    await db.delete(); await db.open()
    const created = await createWorkspace({ name: '严格备份', genres: [], status: 'drafting', description: '', targetWordCount: 0 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const backup = await exportProjectJSON(created.scope.projectId)
    const missing = { ...structuredClone(backup) } as Record<string, unknown>
    delete missing.ttrpgNarrativeMemories
    expect(inspectProjectBackup(missing).valid).toBe(false)
    const oldMissingCore = { ...missing, version: 16 }
    delete oldMissingCore.chapters
    expect(inspectProjectBackup(oldMissingCore).valid).toBe(false)
    const malformed = { ...missing, version: 16, ttrpgNarrativeMemories: {} }
    expect(inspectProjectBackup(malformed).valid).toBe(false)
    const before = await db.projects.count()
    await expect(importProjectJSON(malformed as never)).rejects.toThrow('备份预检失败')
    expect(await db.projects.count()).toBe(before)
  })
})
