/**
 * Stage C(收尾)回归 · 旧 itemSystems/factions 表 v29 升级迁移(先迁移后删 · 零丢失)
 *
 * 锁定 DB v29 升级钩子调用的 migrateLegacyTablesToCodex:
 *   · 道具 → 人工器物词条 + 体系总述并入 worldview.itemDesign
 *   · 势力 → 势力词条(含 mapRegion/color)
 * 用一个仍带旧表的临时 Dexie 实例验证迁移逻辑(真实 schema 已删表,故用独立实例)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { migrateLegacyTablesToCodex, importLegacyArraysToCodex } from '../../../src/lib/migrations/legacy-to-codex-upgrade'

class LegacyDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores({
      itemSystems: '++id, projectId',
      factions: '++id, projectId',
      worldviews: '++id, projectId',
      codexCategories: '++id, projectId',
      codexEntries: '++id, projectId, categoryId',
    })
  }
}

class OldV28DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(28).stores({
      itemSystems: '++id, projectId',
      factions: '++id, projectId',
      worldviews: '++id, projectId',
      codexCategories: '++id, projectId',
      codexEntries: '++id, projectId, categoryId',
    })
  }
}

class UpgradedV29DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(28).stores({
      itemSystems: '++id, projectId',
      factions: '++id, projectId',
      worldviews: '++id, projectId',
      codexCategories: '++id, projectId',
      codexEntries: '++id, projectId, categoryId',
    })
    this.version(29).stores({
      itemSystems: null,
      factions: null,
    }).upgrade(async (tx) => {
      await migrateLegacyTablesToCodex(tx)
    })
  }
}

let db: LegacyDB
beforeEach(async () => { db = new LegacyDB('legacy-test-' + Math.random()); await db.open() })
afterEach(async () => { await db.delete(); db.close() })

describe('Stage C 收尾 · 旧表 v29 迁移', () => {
  it('道具→人工器物词条 + 总述→itemDesign;势力→势力词条(含mapRegion/color)', async () => {
    const ts = Date.now()
    await db.table('worldviews').add({ projectId: 1, itemDesign: '', createdAt: ts, updatedAt: ts })
    await db.table('itemSystems').add({
      projectId: 1, overview: '灵器为尊', createdAt: ts, updatedAt: ts,
      items: JSON.stringify([
        { name: '玄铁剑', type: 'weapon', rank: '地阶', description: '极重', abilities: '破甲', origin: '陨铁', owner: '主角', significance: '本命兵器' },
      ]),
    })
    await db.table('factions').add({
      projectId: 1, name: '天剑宗', description: '正道魁首', leader: '玄清子',
      members: '长老十二', goals: '维护正道', resources: '灵脉三处', relationships: '与魔教世仇',
      mapRegion: '东域', color: '#3B82F6', createdAt: ts, updatedAt: ts,
    })

    await migrateLegacyTablesToCodex(db as any)

    const cats = await db.table('codexCategories').toArray()
    const artifact = cats.find((c: any) => c.builtInKey === 'artifact')!
    const faction = cats.find((c: any) => c.builtInKey === 'faction')!
    expect(artifact).toBeTruthy()
    expect(faction).toBeTruthy()

    const entries = await db.table('codexEntries').toArray()
    const sword = entries.find((e: any) => e.name === '玄铁剑')!
    expect(sword.categoryId).toBe(artifact.id)
    expect(JSON.parse(sword.fields).type).toBe('武器')
    expect(JSON.parse(sword.fields).effect).toBe('破甲')
    expect(sword.summary).toBe('本命兵器')

    const sect = entries.find((e: any) => e.name === '天剑宗')!
    expect(sect.categoryId).toBe(faction.id)
    const ff = JSON.parse(sect.fields)
    expect(ff.leader).toBe('玄清子')
    expect(ff.mapRegion).toBe('东域')
    expect(ff.color).toBe('#3B82F6')

    const wv = (await db.table('worldviews').toArray())[0]
    expect(wv.itemDesign).toContain('灵器为尊')
  })

  it('幂等:重复迁移不重复建条目', async () => {
    const ts = Date.now()
    await db.table('worldviews').add({ projectId: 1, itemDesign: '', createdAt: ts, updatedAt: ts })
    await db.table('factions').add({ projectId: 1, name: '天剑宗', description: '', createdAt: ts, updatedAt: ts })
    await migrateLegacyTablesToCodex(db as any)
    await migrateLegacyTablesToCodex(db as any)
    const entries = (await db.table('codexEntries').toArray()).filter((e: any) => e.name === '天剑宗')
    expect(entries.length).toBe(1)
  })

  it('空旧表:无害 no-op', async () => {
    await migrateLegacyTablesToCodex(db as any)
    expect((await db.table('codexEntries').toArray()).length).toBe(0)
  })

  it('旧版备份导入:importLegacyArraysToCodex 把 JSON 数组并入词条', async () => {
    const ts = Date.now()
    await db.table('worldviews').add({ projectId: 7, itemDesign: '', createdAt: ts, updatedAt: ts })
    await importLegacyArraysToCodex(db as any, 7, {
      itemSystems: [{ overview: '器之道', items: JSON.stringify([{ name: '断水', type: 'weapon', abilities: '斩浪' }]) }],
      factions: [{ projectId: 7, name: '沧澜阁', description: '水系势力', mapRegion: '南海', color: '#0EA5E9' } as any],
    })
    const cats = await db.table('codexCategories').toArray()
    const entries = await db.table('codexEntries').toArray()
    const artifact = cats.find((c: any) => c.builtInKey === 'artifact')!
    const faction = cats.find((c: any) => c.builtInKey === 'faction')!
    expect(entries.find((e: any) => e.name === '断水')?.categoryId).toBe(artifact.id)
    const sect = entries.find((e: any) => e.name === '沧澜阁')!
    expect(sect.categoryId).toBe(faction.id)
    expect(JSON.parse(sect.fields).mapRegion).toBe('南海')
    expect((await db.table('worldviews').toArray())[0].itemDesign).toContain('器之道')
  })

  it('真实 Dexie v28→v29 升级:先迁移旧表数据,再删除旧 object store', async () => {
    const name = 'legacy-upgrade-v29-' + Math.random()
    const ts = Date.now()
    const oldDb = new OldV28DB(name)
    await oldDb.open()
    await oldDb.table('worldviews').add({ projectId: 9, itemDesign: '既有器物设定', createdAt: ts, updatedAt: ts })
    await oldDb.table('itemSystems').add({
      projectId: 9,
      overview: '灵器需认主',
      items: JSON.stringify([{ name: '照胆镜', type: 'artifact', description: '照见心魔', abilities: '破幻' }]),
      createdAt: ts,
      updatedAt: ts,
    })
    await oldDb.table('factions').add({
      projectId: 9,
      name: '镜湖盟',
      description: '湖上散修联盟',
      leader: '沈照',
      mapRegion: '镜湖',
      color: '#38BDF8',
      createdAt: ts,
      updatedAt: ts,
    })
    oldDb.close()

    const upgradedDb = new UpgradedV29DB(name)
    await upgradedDb.open()
    const cats = await upgradedDb.table('codexCategories').toArray()
    const entries = await upgradedDb.table('codexEntries').toArray()
    const artifact = cats.find((c: any) => c.builtInKey === 'artifact')!
    const faction = cats.find((c: any) => c.builtInKey === 'faction')!
    expect(entries.find((e: any) => e.name === '照胆镜')?.categoryId).toBe(artifact.id)
    const sect = entries.find((e: any) => e.name === '镜湖盟')!
    expect(sect.categoryId).toBe(faction.id)
    expect(JSON.parse(sect.fields).mapRegion).toBe('镜湖')
    expect((await upgradedDb.table('worldviews').toArray())[0].itemDesign).toContain('灵器需认主')
    upgradedDb.close()

    const stores = await readNativeStoreNames(name)
    expect(stores).not.toContain('itemSystems')
    expect(stores).not.toContain('factions')
    expect(stores).toContain('codexEntries')

    await Dexie.delete(name)
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
