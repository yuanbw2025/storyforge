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
  STORYFORGE_STORES_V3,
  STORYFORGE_STORES_V4,
  STORYFORGE_STORES_V5,
  STORYFORGE_STORES_V6,
  STORYFORGE_STORES_V7,
  STORYFORGE_STORES_V8,
  STORYFORGE_STORES_V9,
  STORYFORGE_STORES_V10,
} from '../../src/lib/db/schema'
import {
  assertCurrentSchemaDefinition,
  openCurrentSchema,
  REQUIRED_TABLES,
} from '../../src/lib/db/ensure-schema'

describe('CURRENT-SCHEMA · v1-v10 to v11 additive migration', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  afterEach(() => db.close())

  it('数据库使用独立当前命名空间和 v11 schema', () => {
    expect(STORYFORGE_DATABASE_NAME).toBe('storyforge-core')
    expect(STORYFORGE_SCHEMA_VERSION).toBe(11)
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
      expect(upgraded.verno).toBe(STORYFORGE_SCHEMA_VERSION)
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
      expect(upgraded.verno).toBe(STORYFORGE_SCHEMA_VERSION)
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

  it('从 v3 原位升级时保留共享改编分析并只新增剧本专业生产表', async () => {
    const databaseName = `storyforge-schema-v3-migration-${Date.now()}-${Math.random()}`
    const oldDb = new Dexie(databaseName)
    oldDb.version(3).stores(STORYFORGE_STORES_V3)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({
      workspaceUid: 'WS-03HZZZZZZZZZZZZZZZZZZZZZZZ',
      workspacePurpose: 'independent-work',
      name: 'v3 改编分析保留样例',
      createdAt: 3,
      updatedAt: 3,
    })
    await oldDb.table('adaptationSourceFacts').add({
      projectId,
      worldId: 1,
      workId: 1,
      adaptationProjectId: 1,
      manifestVersion: 1,
      stableKey: 'fact_keep',
      kind: 'event',
      statement: '保留的来源事实',
      sourceUnitKeys: ['asu_12345678'],
      authorStatus: 'confirmed',
      createdAt: 3,
      updatedAt: 3,
    })
    oldDb.close()

    const upgraded = new StoryForgeDB(databaseName)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(STORYFORGE_SCHEMA_VERSION)
      expect(await upgraded.projects.get(projectId)).toMatchObject({ name: 'v3 改编分析保留样例' })
      expect(await upgraded.adaptationSourceFacts.count()).toBe(1)
      expect(await upgraded.screenplayBeats.count()).toBe(0)
      expect(await upgraded.screenplaySceneCards.count()).toBe(0)
      expect(await upgraded.screenplayReviewIssues.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })

  it('从 v4 原位升级时保留剧本生产数据并新增漫画专业生产与 Release 资产表', async () => {
    const databaseName = `storyforge-schema-v4-migration-${Date.now()}-${Math.random()}`
    const oldDb = new Dexie(databaseName)
    oldDb.version(4).stores(STORYFORGE_STORES_V4)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({ workspaceUid: 'WS-04HZZZZZZZZZZZZZZZZZZZZZZZ', workspacePurpose: 'independent-work', name: 'v4 剧本保留样例', createdAt: 4, updatedAt: 4 })
    await oldDb.table('screenplayBeats').add({ projectId, workId: 1, adaptationProjectId: 1, manifestVersion: 1, stableKey: 'beat_keep', episodeNumber: 1, sectionKey: 'act1', order: 0, updatedAt: 4 })
    oldDb.close()
    const upgraded = new StoryForgeDB(databaseName)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(STORYFORGE_SCHEMA_VERSION)
      expect(await upgraded.screenplayBeats.count()).toBe(1)
      expect(await upgraded.comicScriptBeats.count()).toBe(0)
      expect(await upgraded.comicPagePlans.count()).toBe(0)
      expect(await upgraded.comicReviewIssues.count()).toBe(0)
      expect(await upgraded.creationReleaseAssets.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })

  it('从 v5 原位升级时保留漫画数据并新增漫剧前期生产表', async () => {
    const databaseName = `storyforge-schema-v5-migration-${Date.now()}-${Math.random()}`
    const oldDb = new Dexie(databaseName)
    oldDb.version(5).stores(STORYFORGE_STORES_V5)
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({ workspaceUid: 'WS-05HZZZZZZZZZZZZZZZZZZZZZZZ', workspacePurpose: 'independent-work', name: 'v5 漫画保留样例', createdAt: 5, updatedAt: 5 })
    await oldDb.table('comicScriptBeats').add({ projectId, workId: 1, adaptationProjectId: 1, manifestVersion: 1, stableKey: 'comic_keep', chapterNumber: 1, sectionKey: 'chapter-1', order: 0, updatedAt: 5 })
    oldDb.close()
    const upgraded = new StoryForgeDB(databaseName)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(STORYFORGE_SCHEMA_VERSION)
      expect(await upgraded.comicScriptBeats.count()).toBe(1)
      expect(await upgraded.motionDramaProductions.count()).toBe(0)
      expect(await upgraded.motionDramaPromptPacks.count()).toBe(0)
      expect(await upgraded.motionDramaShotReferences.count()).toBe(0)
    } finally {
      upgraded.close()
      await upgraded.delete()
    }
  })
  it('从 v6 升级增加 AVG 与角色聊天产品表，已有作品保持原值',async()=>{
    const name=`storyforge-avg-migration-${Date.now()}`;const old=new Dexie(name)
    old.version(6).stores(STORYFORGE_STORES_V6);await old.open()
    const id=await old.table('works').add({projectId:1,worldId:1,title:'作者原稿',kind:'novel',createdAt:1,updatedAt:1})
    const original=await old.table('works').get(id);old.close()
    const current=new StoryForgeDB(name)
    try{await current.open();expect(await current.works.get(id)).toEqual(original);expect(await current.avgAuthoringDrafts.count()).toBe(0);expect(await current.avgDraftMedia.count()).toBe(0);expect(Object.keys(STORYFORGE_STORES).filter(k=>!(k in STORYFORGE_STORES_V6)).sort()).toEqual(['aiTownAuthoringDrafts','avgAuthoringDrafts','avgDraftMedia','chatAuthoringDrafts','ttrpgAuthoringDrafts','extensionPackages','extensionProfiles','extensionRecords','extensionContracts','extensionOperations'].sort())}finally{current.close();await current.delete()}
  })

})

it('v7 upgrades preserve author data and Brief revisions while allowing repeated content hashes', async () => {
  const name = 'storyforge-test-ttrpg-v8'; const old = new Dexie(name);
  old.version(7).stores(STORYFORGE_STORES_V7); await old.open();
  const original = { projectId: 12, worldId: 34, title: '保留手稿', kind: 'longform' };
  const id = await old.table('works').add(original);
  const brief = { projectId: 12, workId: id, productionId: 99, revision: 1, briefHash: 'same-content', briefJson: '{"keep":true}', authorizedAt: 123 };
  const briefId = await old.table('productProductionBriefs').add(brief); old.close();
  const current = new StoryForgeDB(name);
  try {
    await current.open();
    expect(await current.works.get(id as number)).toMatchObject(original);
    expect(await current.ttrpgAuthoringDrafts.count()).toBe(0);
    expect(Object.keys(STORYFORGE_STORES).filter(k => !(k in STORYFORGE_STORES_V7))).toEqual(['ttrpgAuthoringDrafts','aiTownAuthoringDrafts','chatAuthoringDrafts','extensionPackages','extensionProfiles','extensionRecords','extensionContracts','extensionOperations']);
    expect(await current.productProductionBriefs.get(briefId as number)).toEqual({ ...brief, id: briefId });
    await current.table('productProductionBriefs').add({ ...brief, id: undefined, revision: 2, authorizedAt: null });
    await expect(current.table('productProductionBriefs').add({ ...brief, id: undefined, revision: 2, briefHash: 'other' })).rejects.toThrow();
    expect(await current.productProductionBriefs.count()).toBe(2);
  } finally { current.close(); await current.delete(); }
});

it('v8 → v9 only adds town author drafts and preserves existing work/runtime data',async()=>{
 const name='town-v8-migration';const old=new Dexie(name);old.version(8).stores(STORYFORGE_STORES_V8);await old.open();
 const work={projectId:1,worldId:1,kind:'ttrpg',title:'已有作品',novelProfile:null};const id=await old.table('works').add(work);
 const session={projectId:1,worldId:1,workId:id,kind:'ai-town',title:'旧存档',stateJson:'{"keep":true}'};const sid=await old.table('productRuntimeSessions').add(session);old.close();
 const current=new StoryForgeDB(name);try{await current.open();expect(await current.works.get(id as number)).toEqual({...work,id});expect(await current.productRuntimeSessions.get(sid as number)).toEqual({...session,id:sid});expect(await current.aiTownAuthoringDrafts.count()).toBe(0);expect(Object.keys(STORYFORGE_STORES).filter(k=>!(k in STORYFORGE_STORES_V8))).toEqual(['aiTownAuthoringDrafts','chatAuthoringDrafts','extensionPackages','extensionProfiles','extensionRecords','extensionContracts','extensionOperations']);}finally{current.close();await current.delete();}
});
it('v7 upgrade preserves AVG drafts and adds an empty character chat store',async()=>{const name=`chat-migration-${crypto.randomUUID()}`;const old=new Dexie(name);old.version(7).stores(STORYFORGE_STORES_V7);await old.open();await old.table('avgAuthoringDrafts').add({projectId:1,worldId:1,workId:1,settingsJson:'preserve-original-bytes'});old.close();const next=new StoryForgeDB(name);try{await next.open();expect((await next.avgAuthoringDrafts.toArray())[0].settingsJson).toBe('preserve-original-bytes');expect(await next.chatAuthoringDrafts.count()).toBe(0)}finally{next.close();await next.delete()}})

it.each(['chat-v8','town-v9'] as const)('integrates %s without losing branch-owned drafts or runtime records',async(branch)=>{
 const name=`integration-${branch}-${crypto.randomUUID()}`;const old=new Dexie(name);
 const stores=branch==='chat-v8'?{...STORYFORGE_STORES_V7,chatAuthoringDrafts:STORYFORGE_STORES.chatAuthoringDrafts}:STORYFORGE_STORES_V9;
 old.version(branch==='chat-v8'?8:9).stores(stores);await old.open();
 const table=branch==='chat-v8'?'chatAuthoringDrafts':'aiTownAuthoringDrafts';
 const draft={projectId:1,worldId:1,workId:1,settingsJson:'{"author":"保留原字节"}',revision:7};
 const id=await old.table(table).add(draft);
 const session={projectId:1,workId:1,worldId:1,stateJson:'{"messages":["原存档"]}'};const sid=await old.table('productRuntimeSessions').add(session);old.close();
 const current=new StoryForgeDB(name);try{await current.open();expect(await current.table(table).get(id)).toEqual({...draft,id});expect(await current.productRuntimeSessions.get(sid as number)).toEqual({...session,id:sid});expect(current.tables.map(t=>t.name).sort()).toEqual(Object.keys(STORYFORGE_STORES).sort());
 const brief={projectId:1,workId:1,productionId:7,briefHash:'repeatable-content',briefJson:'{}',authorizedAt:null};
 await current.table('productProductionBriefs').add({...brief,revision:1});await current.table('productProductionBriefs').add({...brief,revision:2});
 await expect(current.table('productProductionBriefs').add({...brief,revision:2,briefHash:'different'})).rejects.toThrow();
 }finally{current.close();await current.delete()}
})


it('v10 upgrades add only plugin tables, preserving manuscript and release bytes', async () => {
  const name = `storyforge-plugin-v11-migration-${Date.now()}`
  const old = new Dexie(name)
  old.version(10).stores(STORYFORGE_STORES_V10)
  await old.open()
  const work = {id:1,projectId:1,title:'保留原稿',kind:'novel',revision:8}
  const chapter = {id:1,projectId:1,workId:1,title:'开篇',content:'正文逐字保留'}
  const release = {id:1,projectId:1,workId:1,version:3,contentHash:'a'.repeat(64),manifestJson:'{"unchanged":true}'}
  await old.table('works').put(work); await old.table('chapters').put(chapter); await old.table('creationReleases').put(release)
  old.close()
  const current = new StoryForgeDB(name)
  try {
    await current.open()
    expect(await current.works.get(1)).toEqual(work)
    expect(await current.chapters.get(1)).toEqual(chapter)
    expect(await current.creationReleases.get(1)).toEqual(release)
    const added = Object.keys(STORYFORGE_STORES).filter(key=>!(key in STORYFORGE_STORES_V10)).sort()
    expect(added).toEqual(['extensionContracts','extensionOperations','extensionPackages','extensionProfiles','extensionRecords'])
    for (const table of added) expect(await current.table(table).count()).toBe(0)
  } finally { current.close(); await current.delete() }
})
