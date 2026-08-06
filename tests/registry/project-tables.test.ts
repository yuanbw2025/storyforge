/**
 * Phase 1.1a 注册表单元测试
 *
 * 验证:
 *   ① 注册表完整性(全部表双向覆盖 + ref target 存在)
 *   ② 派生选择器正确
 *   ③ cascadeDeleteProject / cascadeDeleteGroup / stampPrimaryWorld 与现有手写逻辑等价
 *
 * 注意:Phase 1.1a 这些派生 API 是【纯新增】,现有 stores 还没切换。
 *       本测试直接调派生 API,确认它们正确,为 1.1b 切换做保证。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { checkRegistry } from '../../src/lib/registry/validate'
import { parseEntryRefs } from '../../src/lib/types/codex'
import {
  projectScopedTables, worldScopedTables, exportableTables,
  transactionTablesFor, transactionTablesForReferences,
  cascadeDeleteProject, cascadeDeleteGroup, stampPrimaryWorld,
} from '../../src/lib/registry/lifecycle'

describe('Phase 1.1a · PROJECT_TABLES 注册表', () => {
  describe('完整性校验', () => {
    it('注册表与 Dexie 双向覆盖,无遗漏无多余', () => {
      const result = checkRegistry()
      if (!result.ok) console.error(result.errors)
      expect(result.ok, result.errors.join('; ')).toBe(true)
    })

    it('登记了全部 62 张表', () => {
      expect(PROJECT_TABLES.length).toBe(62)   // v49 WORLD-2C C1 新增四张 ownership 表
    })

    it('每张表名唯一', () => {
      const names = PROJECT_TABLES.map(s => s.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('所有非 global 表都有逻辑 owner，C3 核心表已切换到显式字段 locator', () => {
      const governed = PROJECT_TABLES.filter(spec => spec.owner !== 'global')
      expect(governed.every(spec => spec.domainOwner != null)).toBe(true)
      expect(PROJECT_TABLES.find(spec => spec.name === 'worlds')?.domainOwner?.locator.kind).toBe('workspace')
      expect(PROJECT_TABLES.find(spec => spec.name === 'works')?.domainOwner?.locator).toMatchObject({
        kind: 'field', owner: 'world', field: 'worldId',
      })
      expect(PROJECT_TABLES.find(spec => spec.name === 'storyCores')?.domainOwner).toMatchObject({
        allowed: ['world', 'work'], legacyDefault: 'work', locator: { kind: 'exclusive-fields' },
      })
      expect(PROJECT_TABLES.find(spec => spec.name === 'chapters')?.domainOwner).toMatchObject({
        allowed: ['work'], legacyDefault: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' },
      })
    })
  })

  describe('派生选择器', () => {
    it('worldScopedTables 包含已知多世界表', () => {
      const names = worldScopedTables().map(s => s.name)
      for (const t of [
        'worldviews', 'powerSystems', 'geographies', 'histories', 'worldNodes',
        'historicalTimelineEvents', 'historicalKeywords', 'outlineNodes',
        'codexEntries', 'worldRulesProfiles', 'cultivationSystems',
        'knowledgeLedger',
      ]) {
        expect(names, `worldScoped 应含 ${t}`).toContain(t)
      }
      expect(names, '词条分类 schema 应为项目级共享').not.toContain('codexCategories')
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
      for (const t of ['promptTemplates', 'promptWorkflows']) {
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

    it('transactionTablesFor(importProject) 从 projectScopedTables 派生', () => {
      const importNames = transactionTablesFor('importProject').map(t => t.name).sort()
      const projectScopedNames = projectScopedTables().map(s => s.table.name).sort()
      expect(importNames).toEqual(projectScopedNames)
      expect(importNames).toContain('projects')
      expect(importNames).toContain('codexEntries')
      expect(importNames).not.toContain('promptTemplates')
    })

    it('领域生命周期事务从根表 refs 派生全部直接引用方', () => {
      expect(transactionTablesForReferences('cultivationSystems').map(table => table.name))
        .toEqual([
          'cultivationSystems',
          'characters',
          'codexEntries',
          'temporalFacts',
          'cultivationProgress',
        ])
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
      const referenceId = await db.references.add({
        projectId, title: 'R', author: '', type: 'story', note: '', url: '',
        createdAt: now, updatedAt: now,
      } as any) as number
      const runId = await db.referenceAnalysisRuns.add({
        projectId, referenceId, version: 1, status: 'active', depth: 'quick',
        sourceFilename: 'r.txt', fileHash: 'rh', totalChars: 1,
        sourceKind: 'unknown', usageScope: 'analysis-only', rightsNote: '',
        rightsConfirmed: false, rightsDeclaredAt: now, expectedChunks: 1,
        completedChunks: 1, progress: 100, createdAt: now, updatedAt: now,
      } as any) as number
      await db.referenceAnalysisSources.put({
        analysisRunId: runId, filename: 'r.txt', fileHash: 'rh',
        chunks: [{ index: 0, startChar: 0, endChar: 1, charCount: 1, text: 'r' }],
        createdAt: now,
      })

      await cascadeDeleteProject(projectId)

      expect(await db.projects.get(projectId)).toBeUndefined()
      expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.characters.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.importSessions.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.importLogs.where('sessionId').equals(sessionId).count()).toBe(0)
      expect(await db.importFiles.count(), 'importFiles 应全清(间接归属 blob)').toBe(0)
      expect(await db.referenceAnalysisRuns.where('projectId').equals(projectId).count()).toBe(0)
      expect(await db.referenceAnalysisSources.get(runId), '参考分析断点原文应级联清理').toBeUndefined()
    })

    it('cascadeDeleteGroup 删世界数据 + 所有词条分类保留 + 大纲 setNull', async () => {
      const now = Date.now()
      const projectId = await db.projects.add({
        name: 'P', genre: '', description: '', targetWordCount: 0,
        enableMultiWorld: true, createdAt: now, updatedAt: now,
      } as any) as number
      const wgId = await db.worldGroups.add({
        projectId, name: '斗破', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
      } as any) as number

      await db.worldviews.add({ projectId, worldGroupId: wgId, worldOrigin: 'x', createdAt: now, updatedAt: now } as any)
      // 内置词条分类(builtInKey 非空,worldGroupId=null)应保留
      const categoryId = await db.codexCategories.add({ projectId, worldGroupId: null, builtInKey: 'mineral', domain: 'natural', name: '矿物', createdAt: now, updatedAt: now } as any) as number
      // 自定义分类也是项目级共享 schema，即使旧备份带 worldGroupId 也不能随世界删除
      await db.codexCategories.add({ projectId, worldGroupId: wgId, domain: 'natural', name: '旧自定义分类', createdAt: now, updatedAt: now } as any)
      const doomedEntryId = await db.codexEntries.add({
        projectId, worldGroupId: wgId, categoryId, name: '玄铁', fields: '{}', refs: '{}',
        createdAt: now, updatedAt: now,
      } as any) as number
      const survivorId = await db.codexEntries.add({
        projectId, worldGroupId: 999, categoryId, name: '异界器物', fields: '{}',
        refs: JSON.stringify({ material: [doomedEntryId] }), createdAt: now, updatedAt: now,
      } as any) as number
      const systemId = await db.cultivationSystems.add({
        projectId, worldGroupId: wgId, name: '斗破修炼', description: '', stages: '[]',
        createdAt: now, updatedAt: now,
      } as any) as number
      const characterId = await db.characters.add({
        projectId, name: '旅者', role: 'protagonist',
        cultivationSystemId: systemId, cultivationStageId: 'root',
        createdAt: now, updatedAt: now,
      } as any) as number
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
      expect(await db.codexCategories.count(), '内置和自定义分类都保留').toBe(2)
      expect(parseEntryRefs((await db.codexEntries.get(survivorId))?.refs).material, '跨世界悬空引用清理').toEqual([])
      expect(await db.cultivationSystems.get(systemId), '修炼体系随世界删除').toBeUndefined()
      expect((await db.characters.get(characterId))?.cultivationSystemId ?? null, '角色修炼关联置空').toBeNull()
      expect((await db.characters.get(characterId))?.cultivationStageId ?? null, '角色境界关联置空').toBeNull()
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
      const cultivationId = await db.cultivationSystems.add({
        projectId, worldGroupId: null, name: '单世界修炼', description: '', stages: '[]',
        createdAt: now, updatedAt: now,
      } as any) as number

      await stampPrimaryWorld(projectId, primaryId)

      const wv = await db.worldviews.where('projectId').equals(projectId).first()
      expect(wv?.worldGroupId, 'worldview 盖章').toBe(primaryId)
      const node = await db.outlineNodes.where('projectId').equals(projectId).first()
      expect(node?.worldGroupId, '大纲盖章').toBe(primaryId)
      const cat = await db.codexCategories.where('projectId').equals(projectId).first()
      expect(cat?.worldGroupId ?? null, '内置分类保持 null 全局').toBeNull()
      expect((await db.cultivationSystems.get(cultivationId))?.worldGroupId, '修炼体系盖章').toBe(primaryId)
    })
  })
})
