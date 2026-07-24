/**
 * R-INV1 · characterId 导出重映射。
 * 守卫：导出 → 导入往返后 itemLedger 的 characterId 正确 remap 到新项目角色 ID；
 * characterId=null 保持 null；往返后按角色过滤仍能查到物品。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { aggregateInventory } from '../../src/lib/types/item-ledger'

const now = Date.now()

async function seedExportProject() {
  const projectId = await db.projects.add({
    name: 'INV1-EXPORT', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const worldGroupId = await db.worldGroups.add({
    projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const charA = await db.characters.add({
    projectId, name: '林风', role: 'protagonist', roleWeight: 'main',
    moralAxis: 'good', orderAxis: 'lawful', shortDescription: '',
    homeWorldGroupId: worldGroupId, createdAt: now, updatedAt: now,
  } as any) as number
  const vol = await db.outlineNodes.add({
    projectId, parentId: null, type: 'volume', title: '卷一', summary: '',
    order: 0, worldGroupId, createdAt: now, updatedAt: now,
  } as any) as number
  const chapNode = await db.outlineNodes.add({
    projectId, parentId: vol, type: 'chapter', title: '第1章', summary: '',
    order: 0, worldGroupId, createdAt: now, updatedAt: now,
  } as any) as number
  const chapter = await db.chapters.add({
    projectId, outlineNodeId: chapNode, title: '第1章', content: '<p>test</p>',
    wordCount: 0, status: 'draft', order: 0, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  // 归属林风的物品
  await db.itemLedger.add({
    projectId, itemName: '青铜铃', heldByName: '林风', characterId: charA,
    action: 'gain', quantity: 1, chapterId: chapter, chapterTitle: '第1章',
    createdAt: now, updatedAt: now,
  } as any)
  // 未归属物品
  await db.itemLedger.add({
    projectId, itemName: '祖传玉佩', heldByName: '未知(历史数据)', characterId: null,
    action: 'gain', quantity: 1, chapterId: null, createdAt: now, updatedAt: now,
  } as any)
  // 需要状态卡也有一条，否则 import 时 stateCards 为空会导致一些表跳过
  await db.stateCards.add({
    projectId, category: 'character', entityName: '林风',
    fields: JSON.stringify([{ key: '境界', value: '炼气' }]),
    createdAt: now, updatedAt: now,
  } as any)
  return { projectId, charA }
}

describe('INV-1 · characterId 导出往返', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('导出 → 导入后 characterId 正确重映射', async () => {
    const { projectId, charA } = await seedExportProject()
    const data = await deriveExportProjectJSON(projectId)

    // 导入到新项目
    const newId = await deriveImportProjectJSON(data)

    // 查导入后的 itemLedger
    const entries = await db.itemLedger.where('projectId').equals(newId).toArray()
    expect(entries.length).toBeGreaterThanOrEqual(2)

    // 青铜铃应该被 remap 到新项目的林风
    const bell = entries.find(e => e.itemName === '青铜铃')
    expect(bell).toBeDefined()
    expect(bell!.heldByName).toBe('林风')
    expect(bell!.characterId).not.toBeNull()
    expect(bell!.characterId).not.toBe(charA) // 新 DB 的新 ID

    // 验证 characterId 指向的角色确实是"林风"
    const newChar = await db.characters.get(bell!.characterId!)
    expect(newChar?.name).toBe('林风')

    // 祖传玉佩的 characterId 保持 null
    const jade = entries.find(e => e.itemName === '祖传玉佩')
    expect(jade).toBeDefined()
    expect(jade!.characterId).toBeNull()
    expect(jade!.heldByName).toBe('未知(历史数据)')
  })

  it('往返后按角色过滤仍能查到物品', async () => {
    const { projectId } = await seedExportProject()
    const data = await deriveExportProjectJSON(projectId)
    const newId = await deriveImportProjectJSON(data)

    const newChars = await db.characters.where('projectId').equals(newId).toArray()
    const newLin = newChars.find(c => c.name === '林风')
    expect(newLin).toBeDefined()

    const entries = await db.itemLedger.where('projectId').equals(newId).toArray()
    const items = aggregateInventory(entries, newLin!.id)
    expect(items.map(i => i.itemName)).toContain('青铜铃')
  })
})
