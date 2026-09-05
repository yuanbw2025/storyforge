import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  StoryForgeDB,
  STORYFORGE_DATABASE_NAME,
  STORYFORGE_SCHEMA_VERSION,
  STORYFORGE_STORES,
  STORYFORGE_STORES_V1,
} from '../../src/lib/db/schema'
import {
  assertCurrentSchemaDefinition,
  openCurrentSchema,
  REQUIRED_TABLES,
} from '../../src/lib/db/ensure-schema'

describe('CURRENT-SCHEMA · v1 to v2 additive migration', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  afterEach(() => db.close())

  it('数据库使用独立当前命名空间和 v2 schema', () => {
    expect(STORYFORGE_DATABASE_NAME).toBe('storyforge-core')
    expect(STORYFORGE_SCHEMA_VERSION).toBe(2)
    expect(db.name).toBe(STORYFORGE_DATABASE_NAME)
    expect(db.verno).toBe(STORYFORGE_SCHEMA_VERSION)
  })

  it('REQUIRED_TABLES、store 定义和 Dexie 表集合精确一致', () => {
    assertCurrentSchemaDefinition()
    const required = [...REQUIRED_TABLES].sort()
    expect(required).toEqual(Object.keys(STORYFORGE_STORES).sort())
    expect(required).toEqual(db.tables.map(table => table.name).sort())
  })

  it('空浏览器存储直接建立当前 schema', async () => {
    const state = await openCurrentSchema()
    expect(state).toEqual({
      version: STORYFORGE_SCHEMA_VERSION,
      tables: [...REQUIRED_TABLES].sort(),
    })
  })

  it('从 v1 原位升级时保留作者数据并只新增短篇表', async () => {
    const databaseName = `storyforge-schema-migration-${Date.now()}-${Math.random()}`
    const oldDb = new Dexie(databaseName)
    oldDb.version(1).stores(STORYFORGE_STORES_V1)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({
      workspaceUid: 'WS-01HZZZZZZZZZZZZZZZZZZZZZZZ',
      workspacePurpose: 'independent-work',
      name: '迁移保留样例',
      createdAt: 1,
      updatedAt: 1,
    })
    oldDb.close()

    const upgraded = new StoryForgeDB(databaseName)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(2)
      expect(await upgraded.projects.get(projectId)).toMatchObject({ name: '迁移保留样例' })
      expect(await upgraded.shortNovelProductions.count()).toBe(0)
      expect(await upgraded.creationReleases.count()).toBe(0)
      expect(upgraded.tables.map(table => table.name).sort()).toEqual(Object.keys(STORYFORGE_STORES).sort())
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })
})
