/**
 * 导入健壮性 · 孤儿角色关系跳过(社区反馈)
 *
 * 反馈:导入备份报错 `[importProjectJSON] 无效外键映射:characterRelations.toCharacterId=-1`。
 * 根因:某条角色关系的端点角色已不存在(导出记为 -1),导入时 requireMappedId 抛错 → 整个导入失败。
 * 修复:角色关系是次要数据,孤儿关系(端点缺失)跳过即可,不连累整体导入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { importProjectJSON } from '../../src/lib/export/json-export'

function backupWithOrphanRelation() {
  const now = Date.now()
  return {
    version: 3, exportedAt: now,
    project: { name: '含孤儿关系的备份', genre: '', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now },
    worldviews: [], storyCores: [], powerSystems: [],
    characters: [
      { name: '甲', role: 'protagonist', createdAt: now, updatedAt: now },
      { name: '乙', role: 'minor', createdAt: now, updatedAt: now },
    ],
    outlineNodes: [], chapters: [], foreshadows: [], geographies: [], histories: [], creativeRules: [],
    characterRelations: [
      // 正常关系:甲(0) → 乙(1)
      { _fromCharacterIndex: 0, _toCharacterIndex: 1, relation: '师徒', createdAt: now, updatedAt: now },
      // 孤儿关系:乙(1) → 已删除角色(-1)
      { _fromCharacterIndex: 1, _toCharacterIndex: -1, relation: '宿敌', createdAt: now, updatedAt: now },
    ],
  }
}

describe('导入健壮性 · 孤儿角色关系跳过', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('含 -1 孤儿关系的备份能成功导入(跳过孤儿,不整体失败)', async () => {
    const pid = await importProjectJSON(backupWithOrphanRelation() as any)
    expect(pid).toBeGreaterThan(0)   // 导入成功,不再抛"无效外键映射:...=-1"

    const chars = await db.characters.where('projectId').equals(pid).toArray()
    expect(chars.length).toBe(2)     // 角色都导入了

    const rels = await db.characterRelations.where('projectId').equals(pid).toArray()
    expect(rels.length).toBe(1)      // 只有合法关系被导入,孤儿被跳过
    expect(rels[0].relation).toBe('师徒')
    // 合法关系的端点都重映射到了真实角色 id
    const ids = new Set(chars.map(c => c.id))
    expect(ids.has(rels[0].fromCharacterId)).toBe(true)
    expect(ids.has(rels[0].toCharacterId)).toBe(true)
  })
})
