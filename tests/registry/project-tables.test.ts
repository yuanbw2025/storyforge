/**
 * Phase 1.1a 注册表单元测试
 *
 * 验证:
 *   ① 注册表完整性(45 表双向覆盖 + ref target 存在)
 *   ② 派生选择器正确
 *   ③ cascadeDeleteProject / cascadeDeleteGroup / stampPrimaryWorld 与现有手写逻辑等价
 *
 * 注意:Phase 1.1a 这些派生 API 是【纯新增】,现有 stores 还没切换。
 *       本测试直接调派生 API,确认它们正确,为 1.1b 切换做保证。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { checkRegistry } from '../../src/lib/registry/validate'
import {
  projectScopedTables, worldScopedTables, exportableTables,
  transactionTablesFor, cascadeDeleteProject, cascadeDeleteGroup, stampPrimaryWorld,
} from '../../src/lib/registry/lifecycle'

describe('Phase 1.1a · PROJECT_TABLES 注册表', () => {
  describe('完整性校验', () => {
    it('注册表与 Dexie 双向覆盖,无遗漏无多余', () => {
      const result = checkRegistry()
      if (!result.ok) console.error(result.errors)
      expect(result.ok, result.errors.join('; ')).toBe(true)
    })

    it('登记了全部 44 张表', () => {
      expect(PROJECT_TABLES.length).toBe(44)   // v29 删 itemSystems/factions:45→43;FB-5 加 userStyleProfiles:43→44
    })

    it('每张表名唯一', () => {
      const names = PROJECT_TABLES.map(s => s.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('派生选择器', () => {
    it('worldScopedTables 包含已知多世界表', () => {
      const names = worldScopedTables().map(s => s.name)
      for (const t of [
        'worldviews', 'powerSystems', 'geographies', 'histories', 'worldNodes',
        'historicalTimelineEvents', 'historicalKeywords', 'outlineNodes',
        'codexCategories', 'codexEntries', 'worldRulesProfiles',
      ]) {
        expect(names, `worldScoped 应含 ${t}`).toContain(t)
      }
    })

    it('exportableTables 不含 global/transient/统计表', () => {
      const names = exportableTables().map(s => s.name)
      for (const t of ['promptTemplates', 'promptWorkflows', 'snapshots', 'aiUsageLog',
                       'importSessions', 'importJobs', 'importLogs', 'importFiles']) {
        expect(names, `exportable 不应含 ${t}`).not.toContain(t)
      }
    })

    it('projectScopedTables 不含 global 表', () => {
      const names = projectScopedTables().map(s => s.name)
      for (const t of ['promptTemplates', 'promptWorkflows', 'masterInsights']) {
        expect(names).not.toContain(t)
      }
    })

    it('transactionTablesFor(deleteGroup) 含 worldScoped + characters + outlineNodes + worldGroups', () => {
      const tables = transactionTablesFor('deleteGroup')
      const tableNames = tables.map(t => t.name)
      expect(tableNames).toContain('characters')
      expect(tableNames).toContain('outlineNodes')
      expect(tableNames).toContain('worldGroups')
      expect(tableNames).toContain('codexEntries')
      expect(tableNames).toContain('worldRulesProfiles')
    })
  })

  describe('派生生命周期 API 行为', () => {
    beforeEach(async () => { await db.delete(); await db.open() })
    afterEach(async () => { db.close() })

    it('cascadeDeleteProject 清空所有项目级数据(含间接归属 blob)', async () => {
      const now = Date.now()
      const projectId = await db.projects.add({
        name: 'P', genre: '', description: '', targetWordCount: 0,
        enableMultiWorld: false, createdAt: now, updatedAt: now,
      } as any) as number

      await db.worldviews.add({ projectId, worldOrigin: 'x', createdAt: now, updatedAt: now } as any)
      await db.characters.add({ projectId, name: 'A', role: 'protagonist', createdAt: now, updatedAt: now } as any)
      const sessionId = await db.importSessions.add({
        projectId, type: 'character', status: 'done', filename: 'f', fileSize: 1,
        fileHash: 'h', totalChunks: 1, completedChunks: 1, parsedSummary: {} as any,
        createdAt: now, updatedAt: now,
      } as any) as number
      await db.importLogs.add({ sessionId, level: 'info', message: 'm', timestamp: now } as any)
      await db.importFiles.put({ sessionId, filename: 'f', blob: new Blob(['x']), fileHash: 'h', createdAt: now } as any)
      const workId = await db.masterWorks.add({
        projectId, name: 'W', author: 'a', genre: 'g', filename: 'w', fileSize: 1,
        fileHash: 'm', analysisDepth: 'standard', analysisStatus: 'done',
        analysisProgress: 100, totalChunks: 1, createdAt: now, updatedAt: now,
      } as any) as number
      await db.importFiles.put({ sessionId: 100000 + workId, filename: 'w', blob: new Blob(['novel']), fileHash: 'm', createdAt: now } as any)

      await cascadeDeleteProject(projectId)

      expect(await db.projects.get(projectId)).toBeUndefined()
      expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.characters.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.importSessions.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.importLogs.where('sessionId').equals(sessionId).count()).toBe(0)
      expect(await db.importFiles.count(), 'importFiles 应全清(普通+master blob)').toBe(0)
      expect(await db.masterWorks.where('projectId').equals(projectId).count()).toBe(0)
    })

    it('cascadeDeleteGroup 删世界数据 + 内置词条分类保留 + 大纲 setNull', async () => {
      const now = Date.now()
      const projectId = await db.projects.add({
        name: 'P', genre: '', description: '', targetWordCount: 0,
        enableMultiWorld: true, createdAt: now, updatedAt: now,
      } as any) as number
      const wgId = await db.worldGroups.add({
        projectId, name: '斗破', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
      } as any) as number

      await db.worldviews.add({ projectId, worldGroupId: wgId, worldOrigin: 'x', createdAt: now, updatedAt: now } as any)
      await db.codexEntries.add({ projectId, worldGroupId: wgId, categoryId: 0, name: '玄铁', fields: '{}', refs: '{}', createdAt: now, updatedAt: now } as any)
      // 内置词条分类(builtInKey 非空,worldGroupId=null)应保留
      await db.codexCategories.add({ projectId, worldGroupId: null, builtInKey: 'mineral', domain: 'natural', name: '矿物', createdAt: now, updatedAt: now } as any)
      // 大纲卷挂该世界 → 应被 setNull 不删
      const nodeId = await db.outlineNodes.add({ projectId, worldGroupId: wgId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number

      await cascadeDeleteGroup(projectId, wgId)

      // worldGroupId 非索引字段,用 projectId 查 + 内存过滤
      const wvLeft = (await db.worldviews.where('projectId').equals(projectId).toArray())
        .filter((w: any) => w.worldGroupId === wgId)
      expect(wvLeft.length, '世界观删').toBe(0)
      const ceLeft = (await db.codexEntries.where('projectId').equals(projectId).toArray())
        .filter((e: any) => e.worldGroupId === wgId)
      expect(ceLeft.length, '词条删').toBe(0)
      expect(await db.codexCategories.count(), '内置分类保留').toBe(1)
      const node = await db.outlineNodes.get(nodeId)
      expect(node?.worldGroupId ?? null, '大纲卷 setNull 不删').toBeNull()
      expect(await db.worldGroups.get(wgId), '世界组本身删').toBeUndefined()
    })

    it('stampPrimaryWorld 盖章所有 null,但内置词条分类不盖', async () => {
      const now = Date.now()
      const projectId = await db.projects.add({
        name: 'P', genre: '', description: '', targetWordCount: 0,
        enableMultiWorld: false, createdAt: now, updatedAt: now,
      } as any) as number
      const primaryId = await db.worldGroups.add({
        projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
      } as any) as number

      await db.worldviews.add({ projectId, worldOrigin: 'x', createdAt: now, updatedAt: now } as any)
      await db.outlineNodes.add({ projectId, parentId: null, type: 'volume', title: 'V', summary: '', order: 0, createdAt: now, updatedAt: now } as any)
      await db.codexCategories.add({ projectId, worldGroupId: null, builtInKey: 'mineral', domain: 'natural', name: '矿物', createdAt: now, updatedAt: now } as any)

      await stampPrimaryWorld(projectId, primaryId)

      const wv = await db.worldviews.where('projectId').equals(projectId).first()
      expect(wv?.worldGroupId, 'worldview 盖章').toBe(primaryId)
      const node = await db.outlineNodes.where('projectId').equals(projectId).first()
      expect(node?.worldGroupId, '大纲盖章').toBe(primaryId)
      const cat = await db.codexCategories.where('projectId').equals(projectId).first()
      expect(cat?.worldGroupId ?? null, '内置分类保持 null 全局').toBeNull()
    })
  })
})
