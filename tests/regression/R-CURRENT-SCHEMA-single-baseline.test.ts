import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  StoryForgeDB,
  STORYFORGE_DATABASE_NAME,
  STORYFORGE_SCHEMA_VERSION,
  STORYFORGE_STORES,
  STORYFORGE_STORES_V1,
  STORYFORGE_STORES_V2,
} from '../../src/lib/db/schema'
import {
  assertCurrentSchemaDefinition,
  openCurrentSchema,
  REQUIRED_TABLES,
} from '../../src/lib/db/ensure-schema'

describe('CURRENT-SCHEMA · v1/v2 to v3 additive migration', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  afterEach(() => db.close())

  it('数据库使用独立当前命名空间和 v3 schema', () => {
    expect(STORYFORGE_DATABASE_NAME).toBe('storyforge-core')
    expect(STORYFORGE_SCHEMA_VERSION).toBe(3)
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

  it('从 v1 原位升级时保留作者数据并新增短篇与共享改编分析表', async () => {
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
      expect(upgraded.verno).toBe(3)
      expect(await upgraded.projects.get(projectId)).toMatchObject({ name: '迁移保留样例' })
      expect(await upgraded.shortNovelProductions.count()).toBe(0)
      expect(await upgraded.creationReleases.count()).toBe(0)
      expect(await upgraded.adaptationSourceFacts.count()).toBe(0)
      expect(await upgraded.adaptationCausalEdges.count()).toBe(0)
      expect(await upgraded.adaptationDecisions.count()).toBe(0)
      expect(upgraded.tables.map(table => table.name).sort()).toEqual(Object.keys(STORYFORGE_STORES).sort())
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })

  it('从 v2 原位升级时保留短篇发布并只新增共享改编分析表', async () => {
    const databaseName = `storyforge-schema-v2-migration-${Date.now()}-${Math.random()}`
    const oldDb = new Dexie(databaseName)
    oldDb.version(2).stores(STORYFORGE_STORES_V2)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({
      workspaceUid: 'WS-02HZZZZZZZZZZZZZZZZZZZZZZZ',
      workspacePurpose: 'independent-work',
      name: 'v2 短篇保留样例',
      createdAt: 2,
      updatedAt: 2,
    })
    await oldDb.table('creationReleases').add({
      projectId,
      worldId: 1,
      workId: 1,
      productKind: 'short-novel',
      version: 1,
      label: '保留发布',
      parentReleaseId: null,
      sourceRevision: 1,
      manifestJson: '{}',
      contentHash: 'a'.repeat(64),
      createdAt: 2,
    })
    oldDb.close()

    const upgraded = new StoryForgeDB(databaseName)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(3)
      expect(await upgraded.projects.get(projectId)).toMatchObject({ name: 'v2 短篇保留样例' })
      expect(await upgraded.creationReleases.count()).toBe(1)
      expect(await upgraded.adaptationSourceFacts.count()).toBe(0)
      expect(await upgraded.adaptationCausalEdges.count()).toBe(0)
      expect(await upgraded.adaptationDecisions.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })
})
