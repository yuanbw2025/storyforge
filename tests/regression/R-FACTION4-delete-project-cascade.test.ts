/**
 * R-FACTION4: 删项目级联清理 factions + factionRelations（无孤儿引用）
 *
 * 对应 lifecycle.ts cascadeDeleteProject 派生路径：
 *   project-scoped 表（含 factions / factionRelations，owner: 'project'）
 *   全部按 projectId 清空。
 *
 * 本测试锁死：删项目后，factions 与 factionRelations 表中无该项目残留；
 *             其它项目的势力数据完全不受影响。
 *
 * 跑法：npm test -- R-FACTION4
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'

const now = 1_700_000_000_000

async function seedProjectCascadeFixture() {
  // 项目 A（将被删）+ 项目 B（应保留）
  const projectA = await db.projects.add({
    name: '项目A', genre: 'fantasy', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number

  const projectB = await db.projects.add({
    name: '项目B', genre: 'fantasy', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number

  // 项目 A：2 个势力 + 1 个关系
  const aFaction1 = await db.factions.add({
    projectId: projectA, worldGroupId: null, name: '青云宗', type: 'sect',
    ideology: '正道', leader: '林惊羽', memberCharacterIds: [], baseLocation: '青云山',
    power: '三千', resources: '灵矿', secret: '', status: 'peak',
    color: '#3b82f6', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  const aFaction2 = await db.factions.add({
    projectId: projectA, worldGroupId: null, name: '血煞门', type: 'sect',
    ideology: '杀伐', leader: '苏长歌', memberCharacterIds: [], baseLocation: '血煞谷',
    power: '邪修', resources: '血晶', secret: '', status: 'rising',
    color: '#ef4444', sortOrder: 1, createdAt: now, updatedAt: now,
  } as any) as number

  await db.factionRelations.add({
    projectId: projectA, fromFactionId: aFaction1, toFactionId: aFaction2,
    relationType: 'hostile', label: '世仇', description: '',
    isBidirectional: true, intensity: 90, createdAt: now, updatedAt: now,
  } as any)

  // 项目 B：1 个势力 + 0 个关系（应完全保留）
  const bFaction1 = await db.factions.add({
    projectId: projectB, worldGroupId: null, name: '镜宗', type: 'sect',
    ideology: '镜道', leader: '镜主', memberCharacterIds: [], baseLocation: '镜城',
    power: '镜修', resources: '镜矿', secret: '', status: 'peak',
    color: '#a855f7', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  return { projectA, projectB, aFaction1, aFaction2, bFaction1 }
}

describe('R-FACTION4: 删项目级联清理 factions + factionRelations', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('无孤儿引用：删项目 A 后，factions 与 factionRelations 中无项目 A 残留，项目 B 完整保留', async () => {
    const { projectA, projectB, aFaction1, aFaction2, bFaction1 } = await seedProjectCascadeFixture()
    const { useProjectStore } = await import('../../src/stores/project')

    // 删前自检：数据齐
    expect(await db.factions.where('projectId').equals(projectA).count()).toBe(2)
    expect(await db.factionRelations.where('projectId').equals(projectA).count()).toBe(1)
    expect(await db.factions.where('projectId').equals(projectB).count()).toBe(1)

    // requireBackupBefore 会拦截删项目 → 直接调 cascadeDeleteProject 绕过 UI 提示
    const { cascadeDeleteProject } = await import('../../src/lib/registry/lifecycle')
    await cascadeDeleteProject(projectA)

    // 项目 A 已删
    expect(await db.projects.get(projectA), '项目 A 应被删除').toBeUndefined()
    expect(await db.projects.get(projectB), '项目 B 应保留').toBeDefined()

    // 无孤儿引用：factions 表中无 projectId === projectA 的残留
    expect(
      await db.factions.where('projectId').equals(projectA).count(),
      '删项目 A 后 factions 表无项目 A 残留',
    ).toBe(0)
    // 无孤儿引用：factionRelations 表中无 projectId === projectA 的残留
    expect(
      await db.factionRelations.where('projectId').equals(projectA).count(),
      '删项目 A 后 factionRelations 表无项目 A 残留',
    ).toBe(0)

    // 项目 B 完整保留
    expect(await db.factions.get(bFaction1), '项目 B 的势力应保留').toBeDefined()
    expect(await db.factions.where('projectId').equals(projectB).count()).toBe(1)

    // 项目 A 的势力 id 不应在任何 factionRelations 中残留（跨项目孤儿检查）
    const allRels = await db.factionRelations.toArray()
    const orphanRels = allRels.filter(r => r.fromFactionId === aFaction1 || r.fromFactionId === aFaction2
      || r.toFactionId === aFaction1 || r.toFactionId === aFaction2)
    expect(orphanRels, '删项目后无任何 factionRelations 引用项目 A 的势力 id').toEqual([])
  })
})
