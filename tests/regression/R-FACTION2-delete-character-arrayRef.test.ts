/**
 * R-FACTION2: 删角色清理 factions.memberCharacterIds ArrayRef（无孤儿引用）
 *
 * 对应 PROJECT_TABLES 中 factions.refs 声明：
 *   { kind: 'array', field: 'memberCharacterIds', itemTarget: 'characters', onDelete: 'removeItem' }
 *
 * 删角色时由 character store 调 applyCharacterReferenceRemap →
 *   remapRegisteredCharacterArrays 扫描所有 ArrayRef（含 factions.memberCharacterIds），
 *   从数组中移除该角色 id（无替换目标）。
 *
 * 本测试锁死：删角色后，无任何 faction.memberCharacterIds 仍引用已删角色 id。
 *
 * 跑法：npm test -- R-FACTION2
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'

const now = 1_700_000_000_000

async function seedCharacterArrayRefFixture() {
  const projectId = await db.projects.add({
    name: 'R-FACTION2', genre: 'fantasy', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number

  const char1 = await db.characters.add({
    projectId, homeWorldGroupId: null, name: '林惊羽', role: 'protagonist',
    shortDescription: '', appearance: '', personality: '坚毅', background: '',
    motivation: '', abilities: '', relationships: '[]', arc: '',
    createdAt: now, updatedAt: now,
  } as any) as number

  const char2 = await db.characters.add({
    projectId, homeWorldGroupId: null, name: '苏长歌', role: 'supporting',
    shortDescription: '', appearance: '', personality: '阴鸷', background: '',
    motivation: '', abilities: '', relationships: '[]', arc: '',
    createdAt: now, updatedAt: now,
  } as any) as number

  const char3 = await db.characters.add({
    projectId, homeWorldGroupId: null, name: '路人甲', role: 'minor',
    shortDescription: '', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '[]', arc: '',
    createdAt: now, updatedAt: now,
  } as any) as number

  // 势力 A：成员 [char1, char2]（删 char1 后应剩 [char2]）
  const factionA = await db.factions.add({
    projectId, worldGroupId: null, name: '青云宗', type: 'sect',
    ideology: '正道', leader: '林惊羽', memberCharacterIds: [char1, char2],
    baseLocation: '青云山', power: '三千门徒', resources: '灵矿', secret: '',
    status: 'peak', color: '#3b82f6', sortOrder: 0, createdAt: now, updatedAt: now,
  } as any) as number

  // 势力 B：成员 [char1]（删 char1 后应剩 []，不应变成 null）
  const factionB = await db.factions.add({
    projectId, worldGroupId: null, name: '剑宗', type: 'sect',
    ideology: '剑道', leader: '掌门', memberCharacterIds: [char1],
    baseLocation: '剑山', power: '剑修百人', resources: '剑矿', secret: '',
    status: 'peak', color: '#22c55e', sortOrder: 1, createdAt: now, updatedAt: now,
  } as any) as number

  // 势力 C：成员 [char3]（不受影响）
  const factionC = await db.factions.add({
    projectId, worldGroupId: null, name: '万宝楼', type: 'merchant',
    ideology: '利己', leader: '掌柜', memberCharacterIds: [char3],
    baseLocation: '皇城', power: '富甲', resources: '金银', secret: '',
    status: 'peak', color: '#f59e0b', sortOrder: 2, createdAt: now, updatedAt: now,
  } as any) as number

  return { projectId, char1, char2, char3, factionA, factionB, factionC }
}

describe('R-FACTION2: 删角色清理 factions.memberCharacterIds', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('无孤儿引用：删角色后，所有 faction.memberCharacterIds 中该 id 被移除', async () => {
    const { projectId, char1, char2, char3, factionA, factionB, factionC } = await seedCharacterArrayRefFixture()
    const { useCharacterStore } = await import('../../src/stores/character')
    await useCharacterStore.getState().loadAll(projectId)

    await useCharacterStore.getState().deleteCharacter(char1)

    // 角色已删
    expect(await db.characters.get(char1), '角色 char1 应被删除').toBeUndefined()
    expect(await db.characters.get(char2), '角色 char2 应保留').toBeDefined()

    // 势力 A：[char1, char2] → [char2]，无孤儿引用
    const aAfter = await db.factions.get(factionA)!
    expect(aAfter!.memberCharacterIds).toEqual([char2])
    expect(aAfter!.memberCharacterIds.includes(char1), '势力 A 不应再引用 char1').toBe(false)

    // 势力 B：[char1] → []（空数组，不应是 null/undefined）
    const bAfter = await db.factions.get(factionB)!
    expect(bAfter!.memberCharacterIds).toEqual([])
    expect(bAfter!.memberCharacterIds.includes(char1), '势力 B 不应再引用 char1').toBe(false)

    // 势力 C：[char3] 不受影响
    const cAfter = await db.factions.get(factionC)!
    expect(cAfter!.memberCharacterIds).toEqual([char3])

    // 全局扫描：无任何 faction.memberCharacterIds 引用已删的 char1
    const allFactions = await db.factions.where('projectId').equals(projectId).toArray()
    const orphans = allFactions.filter(f => Array.isArray(f.memberCharacterIds) && f.memberCharacterIds.includes(char1))
    expect(orphans, '删角色后全局无 faction.memberCharacterIds 孤儿引用').toEqual([])
  })
})
