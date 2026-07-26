/**
 * R-FACTION5: 导入孤儿 factionRelations 跳过且无残留（失败回滚 + 无孤儿引用）
 *
 * 对应 PROJECT_TABLES 中 factionRelations.exportRemap 声明：
 *   { field: 'fromFactionId', remapVia: 'factions', exportAs: '_fromFactionExportId', onUnmapped: 'drop' }
 *   { field: 'toFactionId',   remapVia: 'factions', exportAs: '_toFactionExportId',   onUnmapped: 'drop' }
 *
 * onUnmapped: 'drop' 表示当导出 id 映射不到任何 faction 时，跳过该行（不连累整体导入）。
 * 镜像 R-import-orphan-relation.test.ts 的角色关系孤儿策略，应用于势力关系。
 *
 * 本测试锁死两条不变量：
 *   ① 失败回滚（容错）：含孤儿 factionRelations 的备份能成功导入（跳过孤儿，不整体失败）
 *   ② 无孤儿引用：导入完成后，无任何 factionRelations 引用不存在的 faction id
 *
 * 跑法：npm test -- R-FACTION5
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { importProjectJSON } from '../../src/lib/export/json-export'

const now = 1_700_000_000_000

function backupWithOrphanFactionRelations() {
  return {
    version: 3,
    exportedAt: now,
    project: {
      name: '含孤儿势力关系的备份',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    },
    worldviews: [],
    storyCores: [],
    powerSystems: [],
    characters: [],
    // 两个真实 faction：_exportId 0 与 1
    factions: [
      {
        _exportId: 0,
        worldGroupId: null, _worldGroupExportId: null,
        name: '青云宗', type: 'sect', ideology: '正道', leader: '林惊羽',
        memberCharacterIds: [], _memberCharacterIndexes: [],
        baseLocation: '青云山', power: '三千', resources: '灵矿', secret: '',
        status: 'peak', color: '#3b82f6', sortOrder: 0,
        createdAt: now, updatedAt: now,
      },
      {
        _exportId: 1,
        worldGroupId: null, _worldGroupExportId: null,
        name: '血煞门', type: 'sect', ideology: '杀伐', leader: '苏长歌',
        memberCharacterIds: [], _memberCharacterIndexes: [],
        baseLocation: '血煞谷', power: '邪修', resources: '血晶', secret: '',
        status: 'rising', color: '#ef4444', sortOrder: 1,
        createdAt: now, updatedAt: now,
      },
    ],
    factionRelations: [
      // 合法关系：青云宗(0) → 血煞门(1)，应被导入
      {
        _fromFactionExportId: 0,
        _toFactionExportId: 1,
        relationType: 'hostile', label: '世仇', description: '正邪不两立',
        isBidirectional: true, intensity: 90,
        createdAt: now, updatedAt: now,
      },
      // 孤儿关系：青云宗(0) → 不存在的 faction(999)，应被跳过
      {
        _fromFactionExportId: 0,
        _toFactionExportId: 999,
        relationType: 'alliance', label: '暗通', description: '',
        isBidirectional: false, intensity: 30,
        createdAt: now, updatedAt: now,
      },
      // 孤儿关系：不存在的 faction(998) → 血煞门(1)，应被跳过
      {
        _fromFactionExportId: 998,
        _toFactionExportId: 1,
        relationType: 'vassal', label: '附庸', description: '',
        isBidirectional: false, intensity: 50,
        createdAt: now, updatedAt: now,
      },
      // 孤儿关系：两端都不存在(997 ↔ 996)，应被跳过
      {
        _fromFactionExportId: 997,
        _toFactionExportId: 996,
        relationType: 'neutral', label: '不相往来', description: '',
        isBidirectional: true, intensity: 10,
        createdAt: now, updatedAt: now,
      },
    ],
    outlineNodes: [],
    chapters: [],
    foreshadows: [],
    geographies: [],
    histories: [],
    creativeRules: [],
    characterRelations: [],
  }
}

describe('R-FACTION5: 导入孤儿 factionRelations 跳过且无残留', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('失败回滚（容错）：含孤儿 factionRelations 的备份能成功导入（跳过孤儿，不整体失败）', async () => {
    const pid = await importProjectJSON(backupWithOrphanFactionRelations() as any)
    expect(pid, '导入应成功，返回新项目 id').toBeGreaterThan(0)

    // 两个 faction 都导入了
    const factions = await db.factions.where('projectId').equals(pid).toArray()
    expect(factions).toHaveLength(2)
    expect(factions.map(f => f.name).sort()).toEqual(['血煞门', '青云宗'])
  })

  it('无孤儿引用：导入完成后，无任何 factionRelations 引用不存在的 faction id', async () => {
    const pid = await importProjectJSON(backupWithOrphanFactionRelations() as any)

    const rels = await db.factionRelations.where('projectId').equals(pid).toArray()
    // 4 条中 3 条是孤儿（含端点 998/999/997/996），只有 1 条合法（0→1）应被导入
    expect(rels, '只有合法关系被导入，3 条孤儿被跳过').toHaveLength(1)

    const valid = rels[0]
    const factionIds = new Set(factions2Ids(await db.factions.where('projectId').equals(pid).toArray()))
    expect(factionIds.has(valid.fromFactionId), 'fromFactionId 必须指向真实存在的 faction').toBe(true)
    expect(factionIds.has(valid.toFactionId), 'toFactionId 必须指向真实存在的 faction').toBe(true)

    // 全表扫描：无任何 factionRelations 引用不存在的 faction id
    const allRels = await db.factionRelations.where('projectId').equals(pid).toArray()
    for (const r of allRels) {
      expect(factionIds.has(r.fromFactionId), `fromFactionId=${r.fromFactionId} 必须存在对应 faction`).toBe(true)
      expect(factionIds.has(r.toFactionId), `toFactionId=${r.toFactionId} 必须存在对应 faction`).toBe(true)
    }
  })
})

function factions2Ids(factions: { id?: number }[]): number[] {
  return factions.map(f => f.id).filter((id): id is number => typeof id === 'number')
}
