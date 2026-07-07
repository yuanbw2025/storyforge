/**
 * R-CONSISTENCY1 · 物品/状态账本硬校验。
 * 守卫：物品持有投影按规范章序计算；重复获得已持有物命中确定性 finding；
 * heldItems 作为 CONTEXT_SOURCE 经 assembleContext 注入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { checkHeldItemAcquisition, projectHeldItems } from '../../src/lib/consistency/held-items'
import type { Chapter, ItemLedgerEntry, OutlineNode } from '../../src/lib/types'

const now = Date.now()

async function seedProject() {
  const projectId = await db.projects.add({
    name: 'CONSISTENCY1',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldA = await db.worldGroups.add({ projectId, name: '甲界', type: 'primary', order: 0, createdAt: now, updatedAt: now } as any) as number
  const worldB = await db.worldGroups.add({ projectId, name: '乙界', type: 'parallel', order: 1, createdAt: now, updatedAt: now } as any) as number
  const volume = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'volume',
    title: '卷一',
    summary: '',
    order: 0,
    worldGroupId: worldA,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterIds: number[] = []
  const nodeIds: number[] = []
  for (let i = 0; i < 4; i++) {
    const nodeId = await db.outlineNodes.add({
      projectId,
      parentId: volume,
      type: 'chapter',
      title: `第${i + 1}章`,
      summary: '',
      order: i,
      worldGroupId: i === 3 ? worldB : undefined,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId,
      outlineNodeId: nodeId,
      title: `第${i + 1}章`,
      content: '',
      wordCount: 0,
      status: 'draft',
      order: 99 - i,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    nodeIds.push(nodeId)
    chapterIds.push(chapterId)
  }
  return { projectId, worldA, worldB, chapterIds, nodeIds }
}

describe('CONSISTENCY-1 · heldItems 投影与确定性校验', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('按规范章序计算 gain-consume：未来章不计入，当前章首次获得不误算，按世界隔离', async () => {
    const { projectId, worldA, worldB, chapterIds } = await seedProject()
    const entries: ItemLedgerEntry[] = [
      { projectId, itemName: '青铜铃', action: 'gain', quantity: 2, chapterId: chapterIds[0], chapterTitle: '第1章', createdAt: now },
      { projectId, itemName: '青铜铃', action: 'consume', quantity: 1, chapterId: chapterIds[1], chapterTitle: '第2章', createdAt: now + 1 },
      { projectId, itemName: '赤羽令', action: 'gain', quantity: 1, chapterId: chapterIds[2], chapterTitle: '第3章', createdAt: now + 2 },
      { projectId, itemName: '异界钥匙', action: 'gain', quantity: 1, chapterId: chapterIds[3], chapterTitle: '第4章', createdAt: now + 3 },
    ] as any
    await db.itemLedger.bulkAdd(entries)
    const [outlineNodes, chapters] = await Promise.all([
      db.outlineNodes.where('projectId').equals(projectId).toArray() as Promise<OutlineNode[]>,
      db.chapters.where('projectId').equals(projectId).toArray() as Promise<Chapter[]>,
    ])

    const beforeChapter3 = projectHeldItems({
      entries,
      outlineNodes,
      chapters,
      chapterId: chapterIds[2],
      worldGroupId: worldA,
    })
    expect(beforeChapter3.map(item => [item.itemName, item.quantity])).toEqual([['青铜铃', 1]])

    const atWorldB = projectHeldItems({
      entries,
      outlineNodes,
      chapters,
      chapterId: chapterIds[3],
      worldGroupId: worldB,
    })
    expect(atWorldB.map(item => item.itemName)).not.toContain('青铜铃')
    expect(atWorldB.map(item => item.itemName)).not.toContain('异界钥匙')
  })

  it('重复获得已持有物命中 risk finding，真正首次获得不误报，quote 逐字回查', async () => {
    const held = [{
      itemName: '青铜铃',
      quantity: 1,
      evidence: [{ id: 7, projectId: 1, itemName: '青铜铃', action: 'gain', quantity: 1, chapterId: 1, chapterTitle: '第1章', createdAt: now } as ItemLedgerEntry],
    }]

    const findings = checkHeldItemAcquisition('他在密室里再次获得青铜铃，铃声惊醒了守卫。随后他捡到赤羽令。', held, ['青铜铃', '赤羽令'])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: '物品持有连续性',
      severity: 'risk',
    })
    expect(findings[0].quote).toBe('他在密室里再次获得青铜铃，铃声惊醒了守卫。')
    expect('他在密室里再次获得青铜铃，铃声惊醒了守卫。随后他捡到赤羽令。').toContain(findings[0].quote)
    expect(findings[0].reason).toContain('青铜铃')

    const firstGain = checkHeldItemAcquisition('他在密室里捡到赤羽令。', held, ['赤羽令'])
    expect(firstGain).toHaveLength(0)
  })

  it('heldItems 源经 assembleContext 注入正文生成上下文', async () => {
    const { projectId, worldA, chapterIds } = await seedProject()
    await db.itemLedger.add({
      projectId,
      itemName: '青铜铃',
      action: 'gain',
      quantity: 1,
      chapterId: chapterIds[0],
      chapterTitle: '第1章',
      createdAt: now,
    } as any)

    const ctx = await assembleContext({
      projectId,
      chapterId: chapterIds[1],
      worldGroupId: worldA,
      sourceKeys: ['heldItems'],
    })

    expect(ctx.included).toEqual(['heldItems'])
    expect(ctx.text).toContain('【当前已持有物品(勿再写首次获得)】')
    expect(ctx.text).toContain('青铜铃 ×1')
  })
})
