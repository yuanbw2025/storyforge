/**
 * R-INV1 · 持有归属解析。
 * 守卫 aggregateInventory：按 characterId 过滤、不过滤全量返回、不存在的 ID 返回空。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { aggregateInventory } from '../../src/lib/types/item-ledger'
import type { ItemLedgerEntry } from '../../src/lib/types'

const now = Date.now()

async function seedProject() {
  const projectId = await db.projects.add({
    name: 'INV1-OWNER', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const charA = await db.characters.add({
    projectId, name: '林风', role: 'protagonist', roleWeight: 'main',
    moralAxis: 'good', orderAxis: 'lawful', shortDescription: '',
    homeWorldGroupId: null, createdAt: now, updatedAt: now,
  } as any) as number
  const charB = await db.characters.add({
    projectId, name: '张铁', role: 'supporting', roleWeight: 'secondary',
    moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '',
    homeWorldGroupId: null, createdAt: now, updatedAt: now,
  } as any) as number
  const entries: ItemLedgerEntry[] = [
    { projectId, itemName: '剑', heldByName: '林风', characterId: charA, action: 'gain', quantity: 1, createdAt: now },
    { projectId, itemName: '丹药', heldByName: '林风', characterId: charA, action: 'gain', quantity: 3, createdAt: now + 1 },
    { projectId, itemName: '令牌', heldByName: '张铁', characterId: charB, action: 'gain', quantity: 1, createdAt: now + 2 },
  ]
  await db.itemLedger.bulkAdd(entries as any)
  return { projectId, charA, charB, entries }
}

describe('INV-1 · aggregateInventory 按角色过滤', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('按主角过滤只返回主角的物品', async () => {
    const { charA, entries } = await seedProject()
    const items = aggregateInventory(entries, charA)
    const names = items.map(i => i.itemName)
    expect(names).toEqual(expect.arrayContaining(['剑', '丹药']))
    expect(names).toHaveLength(2)
  })

  it('按配角过滤只返回配角的物品', async () => {
    const { charB, entries } = await seedProject()
    const items = aggregateInventory(entries, charB)
    expect(items).toHaveLength(1)
    expect(items[0].itemName).toBe('令牌')
  })

  it('不传 characterId 返回全部', async () => {
    const { entries } = await seedProject()
    const items = aggregateInventory(entries)
    const names = items.map(i => i.itemName).sort()
    expect(names).toEqual(expect.arrayContaining(['剑', '令牌', '丹药']))
    expect(names).toHaveLength(3)
  })

  it('不存在的 characterId 返回空', async () => {
    const { entries } = await seedProject()
    const items = aggregateInventory(entries, 9999)
    expect(items).toHaveLength(0)
  })

  it('characterId=null 等同于不传(返回全部)', async () => {
    const { entries } = await seedProject()
    const items = aggregateInventory(entries, null)
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  it('未归属条目(characterId=null)可被无过滤的 aggregateInventory 返回', async () => {
    const { projectId, entries } = await seedProject()
    const unowned: ItemLedgerEntry = {
      projectId, itemName: '祖传玉佩', heldByName: '未知(历史数据)',
      characterId: null, action: 'gain', quantity: 1, createdAt: Date.now(),
    } as any
    await db.itemLedger.add(unowned as any)
    const all = aggregateInventory([...entries, unowned])
    expect(all.map(i => i.itemName)).toContain('祖传玉佩')
  })
})
