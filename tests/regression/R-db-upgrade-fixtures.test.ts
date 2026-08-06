import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyTablesToCodex } from '../../src/lib/migrations/legacy-to-codex-upgrade'
import { migrateStateCardsToTemporalFactCandidates } from '../../src/lib/migrations/state-cards-to-temporal-facts'

const opened: Dexie[] = []
const dbNames: string[] = []

function track<T extends Dexie>(db: T): T {
  opened.push(db)
  return db
}

function nextName(prefix: string): string {
  const name = `${prefix}-${Math.random()}`
  dbNames.push(name)
  return name
}

afterEach(async () => {
  for (const db of opened.splice(0)) db.close()
  for (const name of dbNames.splice(0)) await Dexie.delete(name)
})

class OldV30AnalysisDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(30).stores({
      references: '++id, projectId, type, createdAt',
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
      importSessions: '++id, projectId, status, updatedAt, fileHash, targetWorldGroupId',
      importFiles: 'sessionId, fileHash, createdAt',
    })
  }
}

class UpgradedV31AnalysisDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(30).stores({
      references: '++id, projectId, type, createdAt',
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
      importSessions: '++id, projectId, status, updatedAt, fileHash, targetWorldGroupId',
      importFiles: 'sessionId, fileHash, createdAt',
    })
    this.version(31).stores({
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
    }).upgrade(async (tx) => {
      await tx.table('referenceChunkAnalysis').clear()
      await tx.table('references').toCollection().modify((r: { analysisStatus?: string; analysisProgress?: number }) => {
        if (r.analysisStatus && r.analysisStatus !== 'none') {
          r.analysisStatus = 'none'
          r.analysisProgress = 0
        }
      })
    })
  }
}

class OldV31MasterDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(31).stores({
      references: '++id, projectId, type, createdAt',
      masterWorks: '++id, projectId, genre, status, updatedAt',
      masterChunkAnalysis: '++id, workId, chunkIndex',
      masterChapterBeats: '++id, workId, chapterIndex, type',
      masterStyleMetrics: '++id, workId',
      masterInsights: '++id, genre, updatedAt',
    })
  }
}

class UpgradedV32MasterDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(31).stores({
      references: '++id, projectId, type, createdAt',
      masterWorks: '++id, projectId, genre, status, updatedAt',
      masterChunkAnalysis: '++id, workId, chunkIndex',
      masterChapterBeats: '++id, workId, chapterIndex, type',
      masterStyleMetrics: '++id, workId',
      masterInsights: '++id, genre, updatedAt',
    })
    this.version(32).stores({
      masterWorks: null,
      masterChunkAnalysis: null,
      masterChapterBeats: null,
      masterStyleMetrics: null,
      masterInsights: null,
    })
  }
}

// v28 老库:还带旧 factions / itemSystems 表(多世界化已发生,但词条化收尾未做)
class OldV28LegacyDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(28).stores({
      worldviews: '++id, projectId',
      factions: '++id, projectId, name',
      itemSystems: '++id, projectId',
      codexCategories: '++id, projectId, builtInKey, parentId, worldGroupId, order',
      codexEntries: '++id, projectId, categoryId, worldGroupId, order',
    })
  }
}

// v29 升级:跑真实迁移函数把旧表并入词条，再删旧表
class UpgradedV29CodexDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(28).stores({
      worldviews: '++id, projectId',
      factions: '++id, projectId, name',
      itemSystems: '++id, projectId',
      codexCategories: '++id, projectId, builtInKey, parentId, worldGroupId, order',
      codexEntries: '++id, projectId, categoryId, worldGroupId, order',
    })
    this.version(29).stores({
      factions: null,
      itemSystems: null,
    }).upgrade(async (tx) => {
      await migrateLegacyTablesToCodex(tx)
    })
  }
}

// v33 老库:outlineNodes 历史数据可能整体缺 summary 键(老数据/跨版本导入)
class OldV33OutlineDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(33).stores({
      outlineNodes: '++id, projectId, parentId, order, type',
    })
  }
}

// v34 升级:把 outlineNodes.summary 的 undefined/缺失统一兜成 ''(恢复 summary 恒为 string 不变量)
class UpgradedV34OutlineDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(33).stores({
      outlineNodes: '++id, projectId, parentId, order, type',
    })
    this.version(34).stores({}).upgrade(async (tx) => {
      await tx.table('outlineNodes').toCollection().modify((node: any) => {
        if (node.summary == null) node.summary = ''
      })
    })
  }
}

// v34 老库:已有 stateCards，但还没有 NS-4 temporalFacts。
class OldV34StateCardsDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(34).stores({
      stateCards: '++id, projectId, category, entityName, lastChapterId',
      characters: '++id, projectId, name',
      importantLocations: '++id, projectId, name',
      codexEntries: '++id, projectId, name',
      storyArcs: '++id, projectId, name',
      worldGroups: '++id, projectId, name',
    })
  }
}

// v35 升级:新增 temporalFacts，并把旧 stateCards 桥接为 candidate facts。
class UpgradedV35StateCardsDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(34).stores({
      stateCards: '++id, projectId, category, entityName, lastChapterId',
      characters: '++id, projectId, name',
      importantLocations: '++id, projectId, name',
      codexEntries: '++id, projectId, name',
      storyArcs: '++id, projectId, name',
      worldGroups: '++id, projectId, name',
    })
    this.version(35).stores({
      temporalFacts: '++id, projectId, worldGroupId, characterId, locationId, codexEntryId, predicate, status, sourceChapterId',
    }).upgrade(async (tx) => {
      await migrateStateCardsToTemporalFactCandidates(tx)
    })
  }
}

class OldV45ReferenceDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(45).stores({
      references: '++id, projectId, type, createdAt',
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
      inspirationWorkspaces: '++id, projectId, updatedAt',
    })
  }
}

class UpgradedV46ReferenceDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(45).stores({
      references: '++id, projectId, type, createdAt',
      referenceChunkAnalysis: '++id, referenceId, chunkIndex',
      inspirationWorkspaces: '++id, projectId, updatedAt',
    })
    this.version(46).stores({
      referenceAnalysisRuns: '++id, projectId, referenceId, [referenceId+version], status, updatedAt',
      referenceAnalysisSources: 'analysisRunId, fileHash, createdAt',
      referenceChunkAnalysis: '++id, referenceId, analysisRunId, [analysisRunId+chunkIndex], chunkIndex',
    })
  }
}

class OldV47ProcessDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(47).stores({
      agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
      agentEvents: '++id, projectId, conversationId, [conversationId+sequence], kind, createdAt',
      nodeFlows: '++id, projectId, worldGroupId, updatedAt',
      nodeRuns: '++id, projectId, flowId, status, updatedAt',
    })
  }
}

class UpgradedV48SimulationDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(47).stores({
      agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
      agentEvents: '++id, projectId, conversationId, [conversationId+sequence], kind, createdAt',
      nodeFlows: '++id, projectId, worldGroupId, updatedAt',
      nodeRuns: '++id, projectId, flowId, status, updatedAt',
    })
    this.version(48).stores({
      simulationSessions: '++id, projectId, worldGroupId, kind, status, parentSessionId, updatedAt',
      simulationEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], type, createdAt',
      simulationCheckpoints: '++id, projectId, worldGroupId, sessionId, [sessionId+throughSequence], createdAt',
    })
  }
}

class OldV48OwnershipDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(48).stores({
      projects: '++id, name, createdAt, updatedAt',
      worldviews: '++id, projectId',
      chapters: '++id, projectId, outlineNodeId, order, status',
      simulationSessions: '++id, projectId, worldGroupId, kind, status, parentSessionId, updatedAt',
    })
  }
}

class UpgradedV49OwnershipDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(48).stores({
      projects: '++id, name, createdAt, updatedAt',
      worldviews: '++id, projectId',
      chapters: '++id, projectId, outlineNodeId, order, status',
      simulationSessions: '++id, projectId, worldGroupId, kind, status, parentSessionId, updatedAt',
    })
    this.version(49).stores({
      worlds: '++id, projectId, code, [projectId+updatedAt]',
      works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status',
      workCharacterBindings: '++id, projectId, workId, characterId, &[workId+characterId], [projectId+workId]',
      ownershipMigrations: '++id, projectId, &[projectId+contractVersion], status, updatedAt',
    })
  }
}

describe('DB upgrade fixtures · real Dexie version transitions', () => {
  it('v48→v49 只新增 ownership 空表，不搬动或盖章旧内容', async () => {
    const name = nextName('upgrade-v49-ownership')
    const oldDb = track(new OldV48OwnershipDB(name))
    await oldDb.open()
    const projectId = await oldDb.table('projects').add({
      name: '旧分步骤项目',
      worldCode: 'world-old-code',
      worldVersion: 3,
      createdAt: 1,
      updatedAt: 2,
    })
    const worldviewId = await oldDb.table('worldviews').add({
      projectId,
      worldOrigin: '原始世界内容',
      createdAt: 1,
      updatedAt: 2,
    })
    const chapterId = await oldDb.table('chapters').add({
      projectId,
      outlineNodeId: 7,
      title: '原始正文',
      content: '<p>一字不改</p>',
      order: 0,
      status: 'draft',
    })
    oldDb.close()

    const upgraded = track(new UpgradedV49OwnershipDB(name))
    await upgraded.open()
    expect(await upgraded.table('projects').get(projectId)).toEqual({
      id: projectId,
      name: '旧分步骤项目',
      worldCode: 'world-old-code',
      worldVersion: 3,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(await upgraded.table('worldviews').get(worldviewId)).toEqual({
      id: worldviewId,
      projectId,
      worldOrigin: '原始世界内容',
      createdAt: 1,
      updatedAt: 2,
    })
    expect(await upgraded.table('chapters').get(chapterId)).toMatchObject({
      projectId,
      content: '<p>一字不改</p>',
    })
    expect(await upgraded.table('worlds').count()).toBe(0)
    expect(await upgraded.table('works').count()).toBe(0)
    expect(await upgraded.table('workCharacterBindings').count()).toBe(0)
    expect(await upgraded.table('ownershipMigrations').count()).toBe(0)
  })

  it('v47→v48 只新增空运行时表，保留 Agent 与节点创作过程数据', async () => {
    const name = nextName('upgrade-v48-simulation')
    const oldDb = track(new OldV47ProcessDB(name))
    await oldDb.open()
    const conversationId = await oldDb.table('agentConversations').add({
      projectId: 1,
      worldGroupId: null,
      title: '保留会话',
      status: 'archived',
      createdAt: 1,
      updatedAt: 2,
    })
    await oldDb.table('agentEvents').add({
      projectId: 1,
      conversationId,
      sequence: 1,
      kind: 'message',
      content: '保留事件',
      payload: '{}',
      createdAt: 2,
    })
    oldDb.close()

    const upgraded = track(new UpgradedV48SimulationDB(name))
    await upgraded.open()
    expect(await upgraded.table('agentConversations').get(conversationId)).toMatchObject({
      title: '保留会话',
    })
    expect(await upgraded.table('agentEvents').count()).toBe(1)
    expect(await upgraded.table('simulationSessions').count()).toBe(0)
    expect(await upgraded.table('simulationEvents').count()).toBe(0)
    expect(await upgraded.table('simulationCheckpoints').count()).toBe(0)
  })

  it('v45→v46 only adds version/source stores and preserves legacy analysis verbatim', async () => {
    const name = nextName('upgrade-v46-reference')
    const oldDb = track(new OldV45ReferenceDB(name))
    await oldDb.open()
    const refId = await oldDb.table('references').add({
      projectId: 1,
      title: '旧参考',
      type: 'story',
      analysisStatus: 'done',
      analysisSummary: '{"openingTechnique":"旧总结"}',
      createdAt: 1,
      updatedAt: 2,
    })
    const chunkId = await oldDb.table('referenceChunkAnalysis').add({
      referenceId: refId,
      chunkIndex: 0,
      openingTechnique: '旧钩子',
      createdAt: 3,
    })
    oldDb.close()

    const upgraded = track(new UpgradedV46ReferenceDB(name))
    await upgraded.open()
    expect(await upgraded.table('referenceAnalysisRuns').count()).toBe(0)
    expect(await upgraded.table('referenceAnalysisSources').count()).toBe(0)
    expect(await upgraded.table('references').get(refId)).toMatchObject({
      analysisStatus: 'done',
      analysisSummary: '{"openingTechnique":"旧总结"}',
    })
    expect(await upgraded.table('referenceChunkAnalysis').get(chunkId)).toEqual({
      id: chunkId,
      referenceId: refId,
      chunkIndex: 0,
      openingTechnique: '旧钩子',
      createdAt: 3,
    })
  })

  it('v30→v31 clears old reference analysis but preserves import session blobs', async () => {
    const name = nextName('upgrade-v31')
    const oldDb = track(new OldV30AnalysisDB(name))
    await oldDb.open()
    const refId = await oldDb.table('references').add({
      projectId: 1,
      type: 'story',
      title: '旧分析参考',
      analysisStatus: 'done',
      analysisProgress: 100,
      createdAt: Date.now(),
    })
    await oldDb.table('referenceChunkAnalysis').add({ referenceId: refId, chunkIndex: 0, analysis: '{}' })
    const sessionId = await oldDb.table('importSessions').add({
      projectId: 1,
      status: 'paused',
      updatedAt: Date.now(),
      fileHash: 'hash',
      targetWorldGroupId: null,
    })
    await oldDb.table('importFiles').add({
      sessionId,
      fileHash: 'hash',
      blob: new Blob(['raw text']),
      createdAt: Date.now(),
    })
    oldDb.close()

    const upgradedDb = track(new UpgradedV31AnalysisDB(name))
    await upgradedDb.open()

    expect(await upgradedDb.table('referenceChunkAnalysis').count()).toBe(0)
    const ref = await upgradedDb.table('references').get(refId)
    expect(ref.analysisStatus).toBe('none')
    expect(ref.analysisProgress).toBe(0)
    expect(await upgradedDb.table('importSessions').count()).toBe(1)
    expect(await upgradedDb.table('importFiles').count()).toBe(1)
  })

  it('v31→v32 removes obsolete master study stores without touching references', async () => {
    const name = nextName('upgrade-v32')
    const oldDb = track(new OldV31MasterDB(name))
    await oldDb.open()
    await oldDb.table('references').add({ projectId: 1, type: 'story', title: '保留参考', createdAt: Date.now() })
    const workId = await oldDb.table('masterWorks').add({ projectId: 1, genre: 'fantasy', status: 'done', updatedAt: Date.now() })
    await oldDb.table('masterChunkAnalysis').add({ workId, chunkIndex: 0 })
    await oldDb.table('masterChapterBeats').add({ workId, chapterIndex: 1, type: 'hook' })
    await oldDb.table('masterStyleMetrics').add({ workId })
    await oldDb.table('masterInsights').add({ genre: 'fantasy', updatedAt: Date.now() })
    oldDb.close()

    const upgradedDb = track(new UpgradedV32MasterDB(name))
    await upgradedDb.open()
    expect(await upgradedDb.table('references').count()).toBe(1)
    upgradedDb.close()

    const stores = await readNativeStoreNames(name)
    expect(stores).toContain('references')
    expect(stores).not.toContain('masterWorks')
    expect(stores).not.toContain('masterChunkAnalysis')
    expect(stores).not.toContain('masterChapterBeats')
    expect(stores).not.toContain('masterStyleMetrics')
    expect(stores).not.toContain('masterInsights')
  })

  it('v28→v29 真实迁移:factions/itemSystems 并入词条 + 体系总述并入世界观 + 删旧表（零丢失）', async () => {
    const name = nextName('upgrade-v29')
    const oldDb = track(new OldV28LegacyDB(name))
    await oldDb.open()
    await oldDb.table('worldviews').add({ projectId: 1, itemDesign: '原有道具设定' })
    await oldDb.table('factions').add({
      projectId: 1, name: '青云门', description: '正道魁首',
      leader: '云掌门', mapRegion: '东域', color: '#0066ff',
    })
    await oldDb.table('factions').add({ projectId: 1, name: '万魔殿', description: '魔道势力' })
    await oldDb.table('itemSystems').add({
      projectId: 1, overview: '上古法宝体系总述',
      items: JSON.stringify([{ name: '轩辕剑', type: 'weapon', description: '斩妖神剑', abilities: '斩妖除魔' }]),
    })
    oldDb.close()

    const upgradedDb = track(new UpgradedV29CodexDB(name))
    await upgradedDb.open()

    // 内置分类已建
    const cats = await upgradedDb.table('codexCategories').toArray()
    const factionCat = cats.find((c: any) => c.builtInKey === 'faction')
    const artifactCat = cats.find((c: any) => c.builtInKey === 'artifact')
    expect(factionCat, 'faction 分类应被创建').toBeTruthy()
    expect(artifactCat, 'artifact 分类应被创建').toBeTruthy()

    // 势力 → 词条（含地图字段保留）
    const entries = await upgradedDb.table('codexEntries').toArray()
    const factionNames = entries.filter((e: any) => e.categoryId === factionCat.id).map((e: any) => e.name)
    expect(factionNames).toContain('青云门')
    expect(factionNames).toContain('万魔殿')
    const qingyun = entries.find((e: any) => e.name === '青云门')
    expect(JSON.parse(qingyun.fields).mapRegion).toBe('东域')
    expect(JSON.parse(qingyun.fields).color).toBe('#0066ff')

    // 道具 → 人工器物词条
    const artifactNames = entries.filter((e: any) => e.categoryId === artifactCat.id).map((e: any) => e.name)
    expect(artifactNames).toContain('轩辕剑')

    // 体系总述并入 worldview.itemDesign，原有内容不丢
    const wv = (await upgradedDb.table('worldviews').toArray())[0]
    expect(wv.itemDesign).toContain('上古法宝体系总述')
    expect(wv.itemDesign).toContain('原有道具设定')
    upgradedDb.close()

    // 旧表已删，词条表保留
    const stores = await readNativeStoreNames(name)
    expect(stores).not.toContain('factions')
    expect(stores).not.toContain('itemSystems')
    expect(stores).toContain('codexEntries')
  })

  it('v33→v34 治愈 outlineNodes 缺失/undefined 的 summary 为空串，且不覆盖已有值（社区「chrome 导入后必现」根因）', async () => {
    const name = nextName('upgrade-v34')
    const oldDb = track(new OldV33OutlineDB(name))
    await oldDb.open()
    // 老数据/导入数据：节点整体缺 summary 键
    const volId = await oldDb.table('outlineNodes').add({ projectId: 1, parentId: null, type: 'volume', title: '无摘要卷', order: 0 })
    const chapId = await oldDb.table('outlineNodes').add({ projectId: 1, parentId: volId, type: 'chapter', title: '无摘要章', order: 0, summary: undefined })
    // 已有 summary 的节点：迁移绝不能覆盖
    await oldDb.table('outlineNodes').add({ projectId: 1, parentId: volId, type: 'chapter', title: '有摘要章', order: 1, summary: '已有章纲' })
    oldDb.close()

    const upgradedDb = track(new UpgradedV34OutlineDB(name))
    await upgradedDb.open()

    const nodes = await upgradedDb.table('outlineNodes').toArray()
    for (const n of nodes) expect(typeof n.summary).toBe('string') // 不变量恢复:恒为 string
    expect((await upgradedDb.table('outlineNodes').get(volId)).summary).toBe('')
    expect((await upgradedDb.table('outlineNodes').get(chapId)).summary).toBe('')
    expect(nodes.find((n: any) => n.title === '有摘要章').summary).toBe('已有章纲') // 原值不动
  })

  it('v34→v35 把五类旧 stateCards 无损桥接为 TemporalFact 候选，旧卡保留且不自动升 Canon', async () => {
    const name = nextName('upgrade-v35-statecards')
    const oldDb = track(new OldV34StateCardsDB(name))
    await oldDb.open()
    const now = Date.now()
    const charId = await oldDb.table('characters').add({ projectId: 1, name: '林飞' })
    const locId = await oldDb.table('importantLocations').add({ projectId: 1, name: '洛阳' })
    const itemId = await oldDb.table('codexEntries').add({ projectId: 1, name: '青铜铃' })
    const factionId = await oldDb.table('codexEntries').add({ projectId: 1, name: '青云门' })
    const arcId = await oldDb.table('storyArcs').add({ projectId: 1, name: '祭典事件' })
    await oldDb.table('stateCards').bulkAdd([
      { projectId: 1, category: 'character', entityName: '林飞', fields: JSON.stringify([{ key: '位置', value: '洛阳' }, { key: '境界', value: '凡人' }]), lastChapterId: 11, createdAt: now, updatedAt: now },
      { projectId: 1, category: 'location', entityName: '洛阳', fields: JSON.stringify([{ key: '状态', value: '戒严' }]), lastChapterId: 12, createdAt: now, updatedAt: now },
      { projectId: 1, category: 'item', entityName: '青铜铃', fields: JSON.stringify([{ key: '持有者', value: '林飞' }]), lastChapterId: 13, createdAt: now, updatedAt: now },
      { projectId: 1, category: 'faction', entityName: '青云门', fields: JSON.stringify([{ key: '立场', value: '观望' }]), lastChapterId: 14, createdAt: now, updatedAt: now },
      { projectId: 1, category: 'event', entityName: '祭典事件', fields: JSON.stringify([{ key: '结果', value: '中断' }]), lastChapterId: 15, createdAt: now, updatedAt: now },
    ])
    oldDb.close()

    const upgradedDb = track(new UpgradedV35StateCardsDB(name))
    await upgradedDb.open()

    expect(await upgradedDb.table('stateCards').count()).toBe(5) // 旧卡原样保留
    const facts = await upgradedDb.table('temporalFacts').toArray()
    expect(facts).toHaveLength(6) // 角色卡两字段，其余各一字段
    expect(facts.every((f: any) => f.status === 'candidate')).toBe(true)
    expect(facts.every((f: any) => f.sourceType === 'import')).toBe(true)
    expect(facts.find((f: any) => f.predicate === 'location')?.characterId).toBe(charId)
    expect(facts.find((f: any) => f.predicate === 'powerStage')?.characterId).toBe(charId)
    expect(facts.find((f: any) => f.subjectName === '洛阳')?.locationId).toBe(locId)
    expect(facts.find((f: any) => f.subjectName === '青铜铃')?.codexEntryId).toBe(itemId)
    expect(facts.find((f: any) => f.subjectName === '青云门')?.codexEntryId).toBe(factionId)
    expect(facts.find((f: any) => f.subjectName === '祭典事件')?.storyArcId).toBe(arcId)
    expect(facts.filter((f: any) => f.predicate === 'legacyState').map((f: any) => JSON.parse(f.value).value))
      .toEqual(expect.arrayContaining(['戒严', '林飞', '观望', '中断']))

    // 幂等：再次运行不重复生成候选
    const second = await migrateStateCardsToTemporalFactCandidates(upgradedDb as any)
    expect(second.written).toBe(0)
    expect(await upgradedDb.table('temporalFacts').count()).toBe(6)
  })
})

function readNativeStoreNames(name: string): Promise<string[]> {
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
