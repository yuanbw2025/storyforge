import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import type { ProjectExportData } from '../../src/lib/export/json-export'
import '../helpers/native-upgrade-fixture'

const key = 'storyforge-native-upgrade-fixture'
const fixture = (globalThis as unknown as { __nativeUpgrade: {
  seed(): Promise<{ backup: ProjectExportData }>
  verify(restore?: boolean, backup?: ProjectExportData, requireRestored?: boolean): Promise<unknown>
} }).__nativeUpgrade

describe('signed upgrade fixture persistence assertions', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.removeItem(key)
    const files = new Map<string, string>()
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!files.has(name) && !options?.create) throw new Error('Missing synthetic probe')
        return {
          createWritable: async () => ({ write: async (text: string) => { files.set(name, text) }, close: async () => {} }),
          getFile: async () => ({ text: async () => files.get(name) }),
        }
      },
    }) } })
  })

  afterEach(() => {
    localStorage.removeItem(key)
    db.close()
    vi.unstubAllGlobals()
  })

  it('reads the old baseline, restores the native backup and verifies the restored work again', async () => {
    const seeded = await fixture.seed()
    await expect(fixture.verify()).resolves.toBeDefined()
    await expect(fixture.verify(true, seeded.backup)).resolves.toBeDefined()
    await expect(fixture.verify(false, undefined, true)).resolves.toBeDefined()
  })

  it('cannot silently skip restored-work verification when its local metadata is lost', async () => {
    const seeded = await fixture.seed()
    const originalPreferences = localStorage.getItem(key)!
    await fixture.verify(true, seeded.backup)
    localStorage.setItem(key, originalPreferences)
    await expect(fixture.verify(false, undefined, true)).rejects.toThrow('Restored work ID missing after restart')
  })

  it('compares a v15 baseline through the registered converter without changing the original backup', async () => {
    const seeded = await fixture.seed()
    const legacy = { ...structuredClone(seeded.backup), version: 15 } as Record<string, unknown>
    for (const spec of PROJECT_TABLES) if ((spec.introducedBackupVersion ?? 1) > 15) delete legacy[spec.name]
    const stored = JSON.parse(localStorage.getItem(key)!)
    stored.backup = legacy
    localStorage.setItem(key, JSON.stringify(stored))
    const original = localStorage.getItem(key)
    await expect(fixture.verify()).resolves.toBeDefined()
    expect(localStorage.getItem(key)).toBe(original)
    await expect(fixture.verify(true, legacy as unknown as ProjectExportData)).resolves.toBeDefined()
    await expect(fixture.verify(false, undefined, true)).resolves.toBeDefined()
  })

  it('still rejects changed manuscript and missing legacy core tables before restoration', async () => {
    const seeded = await fixture.seed()
    const legacy = { ...structuredClone(seeded.backup), version: 15 } as Record<string, unknown>
    for (const spec of PROJECT_TABLES) if ((spec.introducedBackupVersion ?? 1) > 15) delete legacy[spec.name]
    const stored = JSON.parse(localStorage.getItem(key)!)
    stored.backup = legacy
    const chapters = legacy.chapters as { content: string }[]
    chapters[0].content += '不应通过的旧备份改写'
    localStorage.setItem(key, JSON.stringify(stored))
    await expect(fixture.verify()).rejects.toThrow('Upgrade changed exported work data')
    delete legacy.chapters
    stored.backup = legacy
    localStorage.setItem(key, JSON.stringify(stored))
    const before = await db.projects.count()
    await expect(fixture.verify(true, legacy as unknown as ProjectExportData)).rejects.toThrow()
    expect(await db.projects.count()).toBe(before)
  })
})
