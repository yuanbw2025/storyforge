/**
 * R-FACTION3: 删世界组级联清理 factions（失败回滚 + 无孤儿引用）
 *
 * 对应 lifecycle.ts cascadeDeleteGroup 中 worldScoped 表删除路径 + Step A simple cascade refs。
 * factions 是 worldScoped 表，删世界组时应删除该组下的所有 factions 行；
 * 同时通过 Step A 级联删引用这些 factions 的 factionRelations。
 *
 * 本测试锁死两条不变量：
 *   ① 无孤儿引用：删世界组 wgA 后，无 factions.worldGroupId 残留为 wgA；
 *                  无 factionRelations 引用曾属于 wgA 的 factions
 *   ② 失败回滚：事务中途抛错时，factions 与 factionRelations 都不残留半删状态
 *
 * 跑法：npm test -- R-FACTION3
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'

const now = 1_700_000_000_000

async function seedGroupCascadeFixture() {
  const projectId = await db.projects.add({
    name: 'R-FACTION3', genre: 'fantasy', description: '', targetWordCount: 0,
    enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number

  const wgA = await db.worldGroups.add({
    projectId, name: '主世界群', type: 'primary', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number

  const wgB = await db.worldGroups.add({
    projectId, name: '镜世界群', type: 'parallel', order: 1,
    createdAt: now, updatedAt: now,
  } as any) as number

  // wgA 下两个势力
  const factionA1 = await db.factions.add({
    projectId, worldGroupId: wgA, name: '青云宗', type: 'sect',
    ideology: '正道', leader: '林惊羽', memberCharacterIds: [], baseLocation: '青云山',
    power: '三千', resources: '灵矿', secret: '', status: 'peak',
    color: '#3b82f6', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  const factionA2 = await db.factions.add({
    projectId, worldGroupId: wgA, name: '血煞门', type: 'sect',
    ideology: '杀伐', leader: '苏长歌', memberCharacterIds: [], baseLocation: '血煞谷',
    power: '邪修', resources: '血晶', secret: '', status: 'rising',
    color: '#ef4444', sortOrder: 1, createdAt: now, updatedAt: now,
  } as any) as number

  // wgB 下一个势力（应保留）
  const factionB1 = await db.factions.add({
    projectId, worldGroupId: wgB, name: '镜宗', type: 'sect',
    ideology: '镜道', leader: '镜主', memberCharacterIds: [], baseLocation: '镜城',
    power: '镜修', resources: '镜矿', secret: '', status: 'peak',
    color: '#a855f7', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  // factionRelations：A1↔A2（wgA 内，应被级联删）、A1↔B1（跨组，A1 删后应被级联删）
  await db.factionRelations.add({
    projectId, fromFactionId: factionA1, toFactionId: factionA2,
    relationType: 'hostile', label: '世仇', description: '',
    isBidirectional: true, intensity: 80, createdAt: now, updatedAt: now,
  } as any)
  await db.factionRelations.add({
    projectId, fromFactionId: factionA1, toFactionId: factionB1,
    relationType: 'covert', label: '暗通', description: '',
    isBidirectional: false, intensity: 40, createdAt: now, updatedAt: now,
  } as any)

  return { projectId, wgA, wgB, factionA1, factionA2, factionB1 }
}

describe('R-FACTION3: 删世界组级联清理 factions', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { vi.restoreAllMocks(); db.close() })

  it('无孤儿引用：删副世界组 wgB 后，wgB 下 factions 全删，wgA 不受影响', async () => {
    // 注：deleteGroup 不允许删主世界，所以测删副世界 wgB
    const { projectId, wgA, wgB, factionA1, factionA2, factionB1 } = await seedGroupCascadeFixture()
    const { useWorldGroupStore } = await import('../../src/stores/world-group')
    await useWorldGroupStore.getState().loadAll(projectId)

    // 准备阶段：groups store 需要 set 当前项目
    await useWorldGroupStore.getState().loadAll(projectId)

    await useWorldGroupStore.getState().deleteGroup(wgB)

    // wgB 已删，wgA 保留
    expect(await db.worldGroups.get(wgB), 'wgB 应被删除').toBeUndefined()
    expect(await db.worldGroups.get(wgA), 'wgA 应保留').toBeDefined()

    // 无孤儿引用：factions.worldGroupId 无残留为 wgB
    const orphanFactions = (await db.factions.where('projectId').equals(projectId).toArray())
      .filter(f => f.worldGroupId === wgB)
    expect(orphanFactions, '删组后无 factions.worldGroupId 残留为 wgB').toEqual([])

    // wgB 下 factionB1 已删
    expect(await db.factions.get(factionB1), 'wgB 下 factionB1 应被级联删').toBeUndefined()
    // wgA 下 factions 保留
    expect(await db.factions.get(factionA1), 'wgA 下 factionA1 应保留').toBeDefined()
    expect(await db.factions.get(factionA2), 'wgA 下 factionA2 应保留').toBeDefined()

    // 无孤儿引用：删 wgB 后，没有 factionRelations 引用 factionB1
    const fromOrphan = await db.factionRelations.where('fromFactionId').equals(factionB1).count()
    const toOrphan = await db.factionRelations.where('toFactionId').equals(factionB1).count()
    expect(fromOrphan, '删组后无 factionRelations.fromFactionId 指向 factionB1').toBe(0)
    expect(toOrphan, '删组后无 factionRelations.toFactionId 指向 factionB1').toBe(0)

    // wgA 内的关系保留（A1↔A2）
    const remaining = await db.factionRelations.where('projectId').equals(projectId).toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].fromFactionId).toBe(factionA1)
    expect(remaining[0].toFactionId).toBe(factionA2)
  })

  it('失败回滚：删世界组事务中途抛错时，factions 与 factionRelations 不残留半删状态', async () => {
    const { projectId, wgB, factionB1 } = await seedGroupCascadeFixture()
    const { useWorldGroupStore } = await import('../../src/stores/world-group')
    await useWorldGroupStore.getState().loadAll(projectId)

    const beforeFactions = await db.factions.where('projectId').equals(projectId).count()
    const beforeRels = await db.factionRelations.where('projectId').equals(projectId).count()
    expect(beforeFactions).toBe(3)
    expect(beforeRels).toBe(2)

    // 在 Step B（删除 worldScoped 行）之后、删 worldGroup 本身之前注入失败
    const spy = vi.spyOn(db.worldGroups, 'delete')
    spy.mockImplementationOnce(async () => { throw new Error('INJECTED_FAILURE') })

    await expect(
      useWorldGroupStore.getState().deleteGroup(wgB),
    ).rejects.toThrow('INJECTED_FAILURE')

    // 回滚断言：worldGroup 仍在
    expect(await db.worldGroups.get(wgB), '事务回滚后 wgB 应仍在').toBeDefined()
    // 回滚断言：wgB 下的 faction 仍在（未被半删）
    expect(await db.factions.get(factionB1), '回滚后 wgB 下 faction 应仍在').toBeDefined()
    // 回滚断言：factions 行数不变
    expect(
      await db.factions.where('projectId').equals(projectId).count(),
      '回滚后 factions 行数应与删前一致',
    ).toBe(3)
    // 回滚断言：factionRelations 行数不变（无半删）
    expect(
      await db.factionRelations.where('projectId').equals(projectId).count(),
      '回滚后 factionRelations 行数应与删前一致',
    ).toBe(2)

    spy.mockRestore()
  })
})
