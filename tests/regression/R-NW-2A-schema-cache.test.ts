import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import * as schema from '../../src/lib/db/schema'

const historical = Object.entries(schema)
  .filter(([name]) => /^STORYFORGE_STORES_V(?:[1-9]|10|11)$/.test(name))
  .map(([name, stores]) => ({ version: Number(name.split('_V')[1]), stores: stores as Record<string, string> }))
  .sort((a, b) => a.version - b.version)

describe('NW-2A · 只加表的索引缓存迁移', () => {
  it.each(historical)('v$version 原记录不改写，升级当前版本后只新增可丢弃缓存', async ({ version, stores }) => {
    const name = `storyforge-nw2a-schema-test-${version}`
    const old = new Dexie(name), upgraded = new schema.StoryForgeDB(name)
    try {
      old.version(version).stores(stores)
      await old.open()
      const original = { id: 77, name: '不得改写的旧记录', description: '原始字段与未知旧字段都应逐字保留', createdAt: 123 }
      await old.table('projects').put(original)
      old.close()
      await upgraded.open()
      expect(upgraded.verno).toBe(schema.STORYFORGE_SCHEMA_VERSION)
      expect(await upgraded.projects.get(77)).toEqual(original)
      expect(await upgraded.worldNarrativeIndexCaches.count()).toBe(0)
      for (const table of Object.keys(stores)) expect(upgraded.tables.some(t => t.name === table)).toBe(true)
    } finally { old.close(); upgraded.close(); await Dexie.delete(name) }
  })
})
