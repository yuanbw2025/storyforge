/**
 * R-INV1 · v38 迁移测试。
 * 守卫：存量的 owner-less itemLedger 条目按规则迁移到角色归属。
 * 对标 R-db-upgrade-fixtures.test.ts 的 real-Dexie-transition 模式。
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateItemLedgerToCharacterOwnership } from '../../src/lib/migrations/item-ledger-character-ownership'

const opened: Dexie[] = []
const dbNames: string[] = []

function track<T extends Dexie>(db: T): T { opened.push(db); return db }
function nextName(prefix: string): string { const name = `${prefix}-${Math.random()}`; dbNames.push(name); return name }

afterEach(async () => {
  for (const db of opened.splice(0)) db.close()
  for (const name of dbNames.splice(0)) await Dexie.delete(name)
})

// v37: itemLedger without heldByName/characterId
class OldV37DB extends Dexie {
  projects!: Dexie.Table<any, number>
  itemLedger!: Dexie.Table<any, number>
  characters!: Dexie.Table<any, number>
  constructor(name: string) {
    super(name)
    this.version(37).stores({
      projects: '++id, name',
      itemLedger: '++id, projectId, itemName, chapterId',
      characters: '++id, projectId, name, role',
    })
  }
}

// v38: upgrade hook adds heldByName/characterId
class UpgradedV38DB extends Dexie {
  projects!: Dexie.Table<any, number>
  itemLedger!: Dexie.Table<any, number>
  characters!: Dexie.Table<any, number>
  constructor(name: string) {
    super(name)
    this.version(37).stores({
      projects: '++id, name',
      itemLedger: '++id, projectId, itemName, chapterId',
      characters: '++id, projectId, name, role',
    })
    this.version(38).stores({
      itemLedger: '++id, projectId, itemName, heldByName, characterId, chapterId',
    }).upgrade(async (tx) => {
      await migrateItemLedgerToCharacterOwnership(tx)
    })
  }
}

const now = Date.now()

describe('INV-1 · v38 迁移', () => {
  it('单主角 → 存量条目归给该主角', async () => {
    const old = track(new OldV37DB(nextName('inv1-m1')))
    await old.open()
    const pid = await old.projects.add({ name: 'test' })
    const charId = await old.characters.add({ projectId: pid, name: '林风', role: 'protagonist', createdAt: now, updatedAt: now } as any)
    const entryId = await old.itemLedger.add({ projectId: pid, itemName: '青铜铃', action: 'gain', quantity: 1, chapterId: null, createdAt: now } as any)
    old.close()

    const upgraded = track(new UpgradedV38DB(old.name))
    await upgraded.open()
    const entry = await upgraded.itemLedger.get(entryId)
    expect(entry.heldByName).toBe('林风')
    expect(entry.characterId).toBe(charId)
  })

  it('多主角 → heldByName=未知(历史数据), characterId=null', async () => {
    const old = track(new OldV37DB(nextName('inv1-m2')))
    await old.open()
    const pid = await old.projects.add({ name: 'test' })
    await old.characters.add({ projectId: pid, name: '林风', role: 'protagonist', createdAt: now, updatedAt: now } as any)
    await old.characters.add({ projectId: pid, name: '苏长歌', role: 'protagonist', createdAt: now, updatedAt: now } as any)
    const entryId = await old.itemLedger.add({ projectId: pid, itemName: '令牌', action: 'gain', quantity: 1, createdAt: now } as any)
    old.close()

    const upgraded = track(new UpgradedV38DB(old.name))
    await upgraded.open()
    const entry = await upgraded.itemLedger.get(entryId)
    expect(entry.heldByName).toBe('未知(历史数据)')
    expect(entry.characterId).toBeNull()
  })

  it('无主角（仅配角）→ heldByName=未知(历史数据), characterId=null', async () => {
    const old = track(new OldV37DB(nextName('inv1-m3')))
    await old.open()
    const pid = await old.projects.add({ name: 'test' })
    await old.characters.add({ projectId: pid, name: '李老', role: 'supporting', createdAt: now, updatedAt: now } as any)
    const entryId = await old.itemLedger.add({ projectId: pid, itemName: '丹药', action: 'gain', quantity: 3, createdAt: now } as any)
    old.close()

    const upgraded = track(new UpgradedV38DB(old.name))
    await upgraded.open()
    const entry = await upgraded.itemLedger.get(entryId)
    expect(entry.heldByName).toBe('未知(历史数据)')
    expect(entry.characterId).toBeNull()
  })

  it('已有 heldByName 的条目 → 不被迁移覆盖', async () => {
    const old = track(new OldV37DB(nextName('inv1-m4')))
    await old.open()
    const pid = await old.projects.add({ name: 'test' })
    await old.characters.add({ projectId: pid, name: '林风', role: 'protagonist', createdAt: now, updatedAt: now } as any)
    const entryId = await old.itemLedger.add({ projectId: pid, itemName: '剑', action: 'gain', quantity: 1, chapterId: null, createdAt: now, heldByName: '张铁', characterId: null } as any)
    old.close()

    const upgraded = track(new UpgradedV38DB(old.name))
    await upgraded.open()
    const entry = await upgraded.itemLedger.get(entryId)
    expect(entry.heldByName).toBe('张铁')
    expect(entry.characterId).toBeNull()
  })
})
