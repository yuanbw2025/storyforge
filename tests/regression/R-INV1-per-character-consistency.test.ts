/**
 * R-INV1 · 按角色一致性隔离。
 * 守卫：角色 A 持有的物品，角色 B 首次获得不误报；
 * 角色 A 重复获得才命中 finding。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { checkHeldItemAcquisition, projectHeldItems } from '../../src/lib/consistency/held-items'
import type { Chapter, ItemLedgerEntry, OutlineNode } from '../../src/lib/types'

const now = Date.now()

async function seedTwoCharacters() {
  const projectId = await db.projects.add({
    name: 'INV1-CONSISTENCY', genre: '', description: '', targetWordCount: 0,
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
  const volume = await db.outlineNodes.add({
    projectId, parentId: null, type: 'volume', title: '卷一', summary: '',
    order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: volume, type: 'chapter', title: `第${i + 1}章`,
      summary: '', order: i, createdAt: now, updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId, outlineNodeId: nodeId, title: `第${i + 1}章`,
      content: '', wordCount: 0, status: 'draft', order: i, notes: '',
      createdAt: now, updatedAt: now,
    } as any) as number
    chapterIds.push(chapterId)
  }
  // 角色 A 持有青铜铃（第1章获得）
  await db.itemLedger.add({
    projectId, itemName: '青铜铃', heldByName: '林风', characterId: charA,
    action: 'gain', quantity: 1, chapterId: chapterIds[0], chapterTitle: '第1章',
    createdAt: now,
  } as any)
  return { projectId, charA, charB, chapterIds }
}

describe('INV-1 · checkHeldItemAcquisition 按角色隔离', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('角色 A 重复获得 A 已持有物品 → 命中 finding', () => {
    const heldA = [{
      itemName: '青铜铃', quantity: 1,
      evidence: [{ id: 1, projectId: 1, itemName: '青铜铃', heldByName: '林风', action: 'gain', quantity: 1, chapterId: 1, chapterTitle: '第1章', createdAt: now } as ItemLedgerEntry],
    }]
    const findings = checkHeldItemAcquisition(
      '林风再次获得青铜铃，铃声清脆。',
      heldA,
      ['青铜铃'],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('物品持有连续性')
  })

  it('角色 B 首次获得青铜铃（A 持有但 B 未持有）→ 不误报', () => {
    // B 没有持有物——heldB 是空的
    const heldB: any[] = []
    const findings = checkHeldItemAcquisition(
      '张铁第一次获得青铜铃，仔细端详。',
      heldB,
      ['青铜铃'],
    )
    expect(findings).toHaveLength(0)
  })

  it('projectHeldItems 按 characterId 正确投影', async () => {
    const { projectId, charA, charB, chapterIds } = await seedTwoCharacters()
    const [outlineNodes, chapters] = await Promise.all([
      db.outlineNodes.where('projectId').equals(projectId).toArray() as Promise<OutlineNode[]>,
      db.chapters.where('projectId').equals(projectId).toArray() as Promise<Chapter[]>,
    ])
    const entries = await db.itemLedger.where('projectId').equals(projectId).toArray()

    // 角色 A 的持有投影应包含青铜铃
    const projA = projectHeldItems({ entries, outlineNodes, chapters, chapterId: chapterIds[1], characterId: charA })
    expect(projA.map(p => p.itemName)).toContain('青铜铃')

    // 角色 B 的持有投影应为空
    const projB = projectHeldItems({ entries, outlineNodes, chapters, chapterId: chapterIds[1], characterId: charB })
    expect(projB).toHaveLength(0)

    // 不传 characterId 返回全部
    const projAll = projectHeldItems({ entries, outlineNodes, chapters, chapterId: chapterIds[1] })
    expect(projAll.map(p => p.itemName)).toContain('青铜铃')
  })
})
