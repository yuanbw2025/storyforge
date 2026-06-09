/**
 * R-1: deleteGroup 事务作用域完整性
 *
 * 对应 MASTER-BLUEPRINT §4.0.1 / GPT-5.5 审查 + 内部审计 P0-1
 *
 * 反例:
 *   旧代码 deleteGroup 的 db.transaction 表清单只声明 9 张,
 *   但事务体内访问了 historicalTimelineEvents/historicalKeywords/
 *   codexEntries/codexCategories 这些未声明的表 → Dexie 抛错。
 *
 * 期望(P0-1 修复后):
 *   ① deleteGroup 不抛错
 *   ② 该 worldGroupId 在所有 worldScoped 表中无残留
 *
 * 跑法:
 *   npm test -- R-01
 *
 * 注意:这是给 5.5 / 接手者参考的"反例测试样板"。其他反例测试(R-2 ~ R-17)
 *      请参考此文件结构,按同样模式编写。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'

describe('R-01: deleteGroup 事务作用域完整性', () => {
  beforeEach(async () => {
    // 每个测试用例前清空数据库,保证隔离
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    // 释放
    db.close()
  })

  it('准备:能正常建项目 + 多世界(基础设施检查)', async () => {
    const now = Date.now()

    const projectId = await db.projects.add({
      name: 'R-01 测试项目',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    } as any)

    expect(projectId).toBeTypeOf('number')
    expect(projectId).toBeGreaterThan(0)

    const primaryId = await db.worldGroups.add({
      projectId: projectId as number,
      name: '主世界',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any)

    const sideId = await db.worldGroups.add({
      projectId: projectId as number,
      name: '斗破',
      type: 'parallel',
      order: 1,
      createdAt: now,
      updatedAt: now,
    } as any)

    expect(primaryId).toBeTypeOf('number')
    expect(sideId).toBeTypeOf('number')
    expect(sideId).not.toBe(primaryId)
  })

  /**
   * 核心反例测试:
   *
   * P0-1 修复前 → 此测试因 Dexie 事务作用域错误而抛 NotFoundError
   * P0-1 修复后 → 此测试通过(无残留)
   *
   * 实施者(5.5)在修 P0-1 时跑这个测试自检:
   *   - 修复前:`npm test -- R-01` 应该看到 fail
   *   - 修复后:`npm test -- R-01` 应该全绿
   */
  it('删除非主世界后,所有 worldScoped/homeWorldScoped 表中无该 wgId 残留', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'test', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number

    const primaryWg = await db.worldGroups.add({
      projectId, name: '主世界', type: 'primary', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number

    const sideWg = await db.worldGroups.add({
      projectId, name: '斗破', type: 'parallel', order: 1,
      createdAt: now, updatedAt: now,
    } as any) as number

    // 在副世界下塞数据(覆盖所有 worldScoped 表)
    await db.worldviews.add({ projectId, worldGroupId: sideWg, createdAt: now, updatedAt: now } as any)
    await db.powerSystems.add({ projectId, worldGroupId: sideWg, name: '修真', description: '', levels: '[]', rules: '', createdAt: now, updatedAt: now } as any)
    await db.geographies.add({ projectId, worldGroupId: sideWg, overview: '', locations: '[]', createdAt: now, updatedAt: now } as any)
    await db.histories.add({ projectId, worldGroupId: sideWg, overview: '', eraSystem: '', events: '[]', createdAt: now, updatedAt: now } as any)
    await db.worldNodes.add({ projectId, worldGroupId: sideWg, parentId: null, name: '位面', description: '', sortOrder: 0, createdAt: now, updatedAt: now } as any)
    await db.historicalTimelineEvents.add({ projectId, worldGroupId: sideWg, date: '元朝', title: '建立', description: '', type: 'event', isHistorical: true, createdAt: now, updatedAt: now } as any)
    await db.historicalKeywords.add({ projectId, worldGroupId: sideWg, term: '武林', category: 'general', description: '', createdAt: now, updatedAt: now } as any)
    const outlineId = await db.outlineNodes.add({ projectId, worldGroupId: sideWg, parentId: null, type: 'volume', title: '副世界卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
    const categoryId = await db.codexCategories.add({ projectId, worldGroupId: sideWg, domain: 'natural', parentId: null, name: '灵材', fieldSchema: '[]', order: 0, createdAt: now, updatedAt: now } as any) as number
    await db.codexEntries.add({ projectId, worldGroupId: sideWg, categoryId, name: '玄铁', summary: '', description: '', fields: '{}', refs: '{}', order: 0, createdAt: now, updatedAt: now } as any)
    await db.characters.add({ projectId, homeWorldGroupId: sideWg, name: '萧炎', role: 'protagonist', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: now, updatedAt: now } as any)
    await db.worldGroupLinks.add({ projectId, fromGroupId: sideWg, toGroupId: primaryWg, type: 'portal', createdAt: now } as any)

    // 动态 import store(避免顶层 import 时 store 初始化干扰其它测试)
    const { useWorldGroupStore } = await import('../../src/stores/world-group')
    await useWorldGroupStore.getState().loadAll(projectId)

    // P0-1 修复后:这一行应不抛错
    await expect(useWorldGroupStore.getState().deleteGroup(sideWg)).resolves.not.toThrow()

    // 断言:该 wgId 在所有 worldScoped/homeWorldScoped 表中无残留
    const countWorldGroupId = async <T extends { worldGroupId?: number | null }>(
      table: { where: (key: string) => { equals: (value: number) => { toArray: () => Promise<T[]> } } },
    ) => (await table.where('projectId').equals(projectId).toArray())
      .filter(row => row.worldGroupId === sideWg).length

    const checks: Record<string, number> = {
      worldviews: await countWorldGroupId(db.worldviews),
      powerSystems: await countWorldGroupId(db.powerSystems),
      geographies: await countWorldGroupId(db.geographies),
      histories: await countWorldGroupId(db.histories),
      worldNodes: await countWorldGroupId(db.worldNodes),
      historicalTimelineEvents: await countWorldGroupId(db.historicalTimelineEvents),
      historicalKeywords: await countWorldGroupId(db.historicalKeywords),
      outlineNodes: await countWorldGroupId(db.outlineNodes),
      codexCategories: await countWorldGroupId(db.codexCategories),
      codexEntries: await countWorldGroupId(db.codexEntries),
      characters: (await db.characters.where('projectId').equals(projectId).toArray())
        .filter(row => row.homeWorldGroupId === sideWg).length,
      worldGroupLinksFrom: await db.worldGroupLinks.where('fromGroupId').equals(sideWg).count(),
      worldGroupLinksTo: await db.worldGroupLinks.where('toGroupId').equals(sideWg).count(),
    }

    for (const [table, count] of Object.entries(checks)) {
      expect(count, `${table} 中应无 worldGroupId=${sideWg} 的残留`).toBe(0)
    }

    expect(await db.outlineNodes.get(outlineId)).toMatchObject({ worldGroupId: null })
  })
})
