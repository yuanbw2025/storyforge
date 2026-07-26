/**
 * R-FACTION1: 删势力级联清理 factionRelations（失败回滚 + 无孤儿引用）
 *
 * 对应 PROJECT_TABLES 中 factions.refs 声明：
 *   { kind: 'simple', field: 'id', target: 'factionRelations[fromFactionId]', onDelete: 'cascade' }
 *   { kind: 'simple', field: 'id', target: 'factionRelations[toFactionId]',   onDelete: 'cascade' }
 *
 * Dexie 无原生外键，store 层需显式执行级联。本测试锁死两条不变量：
 *   ① 无孤儿引用：删势力后，无任何 factionRelations.fromFactionId / toFactionId 指向已删势力
 *   ② 失败回滚：事务中途抛错时，势力与 factionRelations 都不残留半删状态
 *
 * 跑法：npm test -- R-FACTION1
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'

const now = 1_700_000_000_000

async function seedFactionCascadeFixture() {
  const projectId = await db.projects.add({
    name: 'R-FACTION1', genre: 'fantasy', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number

  const factionA = await db.factions.add({
    projectId, worldGroupId: null, name: '青云宗', type: 'sect',
    ideology: '正道', leader: '林惊羽', memberCharacterIds: [], baseLocation: '青云山',
    power: '三千门徒', resources: '灵矿', secret: '宗主身世', status: 'peak',
    color: '#3b82f6', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  const factionB = await db.factions.add({
    projectId, worldGroupId: null, name: '血煞门', type: 'sect',
    ideology: '杀伐', leader: '苏长歌', memberCharacterIds: [], baseLocation: '血煞谷',
    power: '邪修数百', resources: '血晶', secret: '勾结魔教', status: 'rising',
    color: '#ef4444', sortOrder: 1, createdAt: now, updatedAt: now,
  } as any) as number

  const factionC = await db.factions.add({
    projectId, worldGroupId: null, name: '万宝楼', type: 'merchant',
    ideology: '利己', leader: '掌柜', memberCharacterIds: [], baseLocation: '皇城',
    power: '富可敌国', resources: '金银', secret: '暗通皇族', status: 'peak',
    color: '#f59e0b', sortOrder: 2, createdAt: now, updatedAt: now,
  } as any) as number

  // 关系矩阵：覆盖 from/to 两个方向 + 双向 + 与第三方的独立关系
  await db.factionRelations.add({
    projectId, fromFactionId: factionA, toFactionId: factionB,
    relationType: 'hostile', label: '百年世仇', description: '正邪不两立',
    isBidirectional: true, intensity: 90, createdAt: now, updatedAt: now,
  } as any)
  await db.factionRelations.add({
    projectId, fromFactionId: factionB, toFactionId: factionA,
    relationType: 'rival', label: '反击', description: '血煞回击',
    isBidirectional: false, intensity: 70, createdAt: now, updatedAt: now,
  } as any)
  // A 与 C 的关系（应保留：不引用 A 被删后仍引用 B、C）
  await db.factionRelations.add({
    projectId, fromFactionId: factionA, toFactionId: factionC,
    relationType: 'trade', label: '通商', description: '青云万宝通商',
    isBidirectional: true, intensity: 50, createdAt: now, updatedAt: now,
  } as any)
  // B 与 C 的独立关系（应完全保留）
  await db.factionRelations.add({
    projectId, fromFactionId: factionB, toFactionId: factionC,
    relationType: 'neutral', label: '互不侵犯', description: '',
    isBidirectional: true, intensity: 30, createdAt: now, updatedAt: now,
  } as any)

  return { projectId, factionA, factionB, factionC }
}

describe('R-FACTION1: 删势力级联清理 factionRelations', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { vi.restoreAllMocks(); db.close() })

  it('无孤儿引用：删势力 A 后，所有引用 A 的 factionRelations（from/to 双向）均被删除', async () => {
    const { projectId, factionA, factionB, factionC } = await seedFactionCascadeFixture()
    const { useFactionStore } = await import('../../src/stores/faction')
    await useFactionStore.getState().loadAll(projectId)

    await useFactionStore.getState().deleteFaction(factionA)

    // 势力 A 已删，B/C 保留
    expect(await db.factions.get(factionA), '势力 A 应被删除').toBeUndefined()
    expect(await db.factions.get(factionB), '势力 B 应保留').toBeDefined()
    expect(await db.factions.get(factionC), '势力 C 应保留').toBeDefined()

    // 无孤儿引用：没有任何 factionRelations 指向 A
    const fromOrphans = await db.factionRelations.where('fromFactionId').equals(factionA).count()
    const toOrphans = await db.factionRelations.where('toFactionId').equals(factionA).count()
    expect(fromOrphans, 'fromFactionId 指向 A 的孤儿关系应为 0').toBe(0)
    expect(toOrphans, 'toFactionId 指向 A 的孤儿关系应为 0').toBe(0)

    // B↔C 独立关系保留
    const remaining = await db.factionRelations.where('projectId').equals(projectId).toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].fromFactionId).toBe(factionB)
    expect(remaining[0].toFactionId).toBe(factionC)

    // store 状态同步：内存中也无孤儿
    const state = useFactionStore.getState()
    expect(state.factions.find(f => f.id === factionA)).toBeUndefined()
    expect(state.factionRelations.every(r => r.fromFactionId !== factionA && r.toFactionId !== factionA)).toBe(true)
  })

  it('失败回滚：事务中途抛错时，势力与所有 factionRelations 都不残留半删状态', async () => {
    const { projectId, factionA } = await seedFactionCascadeFixture()
    const { useFactionStore } = await import('../../src/stores/faction')
    await useFactionStore.getState().loadAll(projectId)

    const beforeRels = await db.factionRelations.where('projectId').equals(projectId).count()
    expect(beforeRels).toBe(4)

    // 在 factionRelations 清删之后、factions.delete 之前注入失败：
    // 模拟 factions 表删除抛错 → 整个事务应回滚，factionRelations 不应被半删
    const spy = vi.spyOn(db.factions, 'delete')
    spy.mockImplementationOnce(async () => { throw new Error('INJECTED_FAILURE') })

    await expect(
      useFactionStore.getState().deleteFaction(factionA),
    ).rejects.toThrow('INJECTED_FAILURE')

    // 回滚断言：势力 A 仍在
    expect(await db.factions.get(factionA), '事务回滚后势力 A 应仍在').toBeDefined()
    // 回滚断言：所有 factionRelations 都未被删除（无半删状态）
    expect(
      await db.factionRelations.where('projectId').equals(projectId).count(),
      '回滚后 factionRelations 行数应与删前一致',
    ).toBe(4)
    // 回滚断言：引用 A 的关系仍在（from + to 双向）
    // 种子：A→B(from=A)、B→A(to=A)、A→C(from=A)、B→C(独立)
    // 故 fromFactionId==A 应有 2 条（A→B、A→C），toFactionId==A 应有 1 条（B→A）
    expect(await db.factionRelations.where('fromFactionId').equals(factionA).count()).toBe(2)
    expect(await db.factionRelations.where('toFactionId').equals(factionA).count()).toBe(1)

    spy.mockRestore()
  })
})
