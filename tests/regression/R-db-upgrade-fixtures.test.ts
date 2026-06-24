import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyTablesToCodex } from '../../src/lib/migrations/legacy-to-codex-upgrade'

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

describe('DB upgrade fixtures · real Dexie version transitions', () => {
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
