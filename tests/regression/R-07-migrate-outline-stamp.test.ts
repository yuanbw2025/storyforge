/**
 * R-07: migrateToMultiWorld 漏给 outlineNodes 盖章
 *
 * 对应 MASTER-BLUEPRINT §4.0.8 / Gemini-3.1 独立发现的 P0-8
 *
 * 反例:
 *   旧 migrateToMultiWorld 给 worldviews/codexEntries 等盖章到主世界,
 *   但漏了 outlineNodes(也带 worldGroupId)→
 *   老用户启用多世界后,所有大纲 worldGroupId=null,
 *   UI 按当前世界(主世界)过滤大纲时匹配不到任何卷 → 大纲整体"消失"。
 *
 * 灾难:用户以为几个月的大纲被吃了(数据其实还在,只是失去世界归属)。
 *
 * 期望(P0-8 修复后):
 *   启用多世界后,所有原本 worldGroupId=null 的 outlineNodes 被盖章到主世界 id;
 *   且事务声明包含 outlineNodes(否则 Dexie 抛事务作用域错)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorldGroupStore } from '../../src/stores/world-group'

describe('R-07: migrateToMultiWorld 给 outlineNodes 盖章', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('启用多世界后,所有大纲节点盖章到主世界(卷/故事块/章节)', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-07', genre: 'fantasy', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

    // 单世界状态:建多个大纲节点(全部 worldGroupId 为空)
    const makeNode = async (type: string, order: number, parentId: number | null) =>
      await db.outlineNodes.add({
        projectId, parentId, type,
        title: `${type}-${order}`, summary: '', order,
        // 注意:故意不设 worldGroupId(模拟单世界历史数据)
        createdAt: now, updatedAt: now,
      } as any) as number

    const volId = await makeNode('volume', 0, null)
    await makeNode('storyBlock', 0, volId)
    await makeNode('chapter', 0, volId)
    await makeNode('chapter', 1, volId)
    const vol2Id = await makeNode('volume', 1, null)
    await makeNode('chapter', 0, vol2Id)

    // 也建一个 worldview(单世界,worldGroupId 为空)
    await db.worldviews.add({
      projectId, worldOrigin: '上古创世', createdAt: now, updatedAt: now,
    } as any)

    // 验证准备:所有大纲节点 worldGroupId 为空
    const before = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    expect(before.length).toBe(6)
    expect(before.every(n => n.worldGroupId == null)).toBe(true)

    // 执行:启用多世界
    await useWorldGroupStore.getState().migrateToMultiWorld(projectId)

    // 拿到主世界 id
    const primary = await db.worldGroups
      .where('projectId').equals(projectId)
      .filter(g => g.type === 'primary').first()
    expect(primary?.id).toBeTypeOf('number')
    const primaryId = primary!.id!

    // ─── 核心断言:所有大纲节点都盖章到主世界 ───
    const after = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    expect(after.length).toBe(6)
    for (const n of after) {
      expect(
        n.worldGroupId,
        `大纲节点 "${n.title}" 应盖章到主世界(否则 UI 过滤会让它消失)`,
      ).toBe(primaryId)
    }

    // 旁证:worldview 也盖章了(确保整个迁移没因为加 outlineNodes 而破坏既有逻辑)
    const wv = await db.worldviews.where('projectId').equals(projectId).first()
    expect(wv?.worldGroupId).toBe(primaryId)
  })

  it('UI 视角:启用多世界后按主世界过滤,大纲卷依然可见(灾难复现验证)', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-07b', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

    // 50 卷大纲(模拟老用户半年积累)
    for (let i = 0; i < 50; i++) {
      await db.outlineNodes.add({
        projectId, parentId: null, type: 'volume',
        title: `第${i + 1}卷`, summary: '', order: i,
        createdAt: now, updatedAt: now,
      } as any)
    }

    await useWorldGroupStore.getState().migrateToMultiWorld(projectId)

    const primary = await db.worldGroups
      .where('projectId').equals(projectId)
      .filter(g => g.type === 'primary').first()
    const primaryId = primary!.id!

    // 模拟 UI 按当前世界(主世界)过滤大纲卷
    const allVolumes = await db.outlineNodes
      .where('projectId').equals(projectId)
      .filter(n => n.type === 'volume')
      .toArray()
    const visibleInPrimary = allVolumes.filter(
      n => (n.worldGroupId ?? null) === primaryId,
    )

    expect(
      visibleInPrimary.length,
      '启用多世界后,主世界视图应能看到全部 50 卷(旧 bug 会显示 0 卷)',
    ).toBe(50)
  })
})
