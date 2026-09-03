/**
 * Phase 1.2a · FIELD_REGISTRY + AdoptionSchema + adopt()
 *
 * 本测试只验证纯新增写回层,不迁移现有调用方。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { FIELD_REGISTRY, FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_EXTENSIONS, ADOPTION_SCHEMAS, ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { adopt, clearAdoptedCollection } from '../../src/lib/registry/adopt'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'

async function createProject(): Promise<number> {
  return (await seedCurrentWorkspace('Adopt Test')).scope.projectId
}

async function createWorldGroup(projectId: number, name: string): Promise<number> {
  const scope = await resolveWorkspaceScope(projectId)
  return db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId,
    name,
    type: 'custom',
    description: '',
    icon: '',
    order: 0,
    entryCondition: '',
    exitCondition: '',
    powerRestriction: '',
    takeawayRules: '',
    plannedChapterCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as never, { owner: 'world' })) as Promise<number>
}

describe('Phase 1.2a · 统一写回层', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('FIELD_REGISTRY / ADOPTION_SCHEMAS 只指向已登记表', () => {
    expect(FIELD_REGISTRY.length).toBeGreaterThan(70)
    for (const field of FIELD_REGISTRY) {
      expect(REGISTRY_BY_NAME.has(field.target), `FIELD_REGISTRY target 缺表:${field.target}`).toBe(true)
    }
    for (const schema of ADOPTION_SCHEMAS) {
      expect(REGISTRY_BY_NAME.has(schema.target), `ADOPTION_SCHEMA target 缺表:${schema.target}`).toBe(true)
      expect(FIELD_BY_TARGET.has(schema.target), `ADOPTION_SCHEMA target 缺字段:${schema.target}`).toBe(true)
      expect(ADOPTION_BY_TARGET.get(schema.target)).toBe(schema)
    }
    const extensionIds = ADOPTION_EXTENSIONS.map(extension => extension.id)
    expect(new Set(extensionIds).size).toBe(extensionIds.length)
    expect(extensionIds).toEqual(expect.arrayContaining([
      'workspace-root-lifecycle',
      'world-root-lifecycle',
      'work-root-lifecycle',
      'product-production-roots',
      'product-production-briefs',
      'product-production-commands',
      'product-production-builds',
      'product-production-artifacts',
      'product-production-release-adoption',
      'ttrpg-rule-pack-library',
    ]))
    expect(extensionIds.some(id => id.startsWith('world-game-'))).toBe(false)
    expect(extensionIds.some(id => id.startsWith('character-interaction-production-'))).toBe(false)
    expect(extensionIds.some(id => id.startsWith('ttrpg-product-') || id.startsWith('ttrpg-campaign-'))).toBe(false)
    for (const extension of ADOPTION_EXTENSIONS) {
      expect(REGISTRY_BY_NAME.has(extension.target), `ADOPTION_EXTENSION target 缺表:${extension.target}`).toBe(true)
      expect(extension.entrypoints.length).toBeGreaterThan(0)
      expect(extension.policyRegistry).not.toBe('')
      expect(extension.reason).not.toBe('')
      expect(extension.reviewAfter).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('单例写回:worldviews.summary 自动映射到 worldOrigin', async () => {
    const projectId = await createProject()
    const result = await adopt({
      projectId,
      worldGroupId: 101,
      target: 'worldviews',
      mode: 'replace',
      data: {
        summary: '天地由九重炉火锻成',
        powerHierarchy: '凡人 / 修士 / 天君',
        ignoredField: 'x',
      },
    })

    expect(result.aliasMapped).toContainEqual({ from: 'summary', to: 'worldOrigin' })
    expect(result.unknown).toContain('ignoredField')
    expect(result.written.length).toBe(1)

    const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].worldOrigin).toBe('天地由九重炉火锻成')
    expect(rows[0].powerHierarchy).toBe('凡人 / 修士 / 天君')
    expect(rows[0].worldGroupId).toBe(101)
  })

  it('单例写回:worldviews 原生对象字段保持对象，不序列化成字符串', async () => {
    const projectId = await createProject()
    const divineDesign = {
      hasDivinity: true,
      divineRank: '主神 / 次神',
      divineNames: '星母',
      divineRules: '朔日禁火',
    }
    await adopt({
      projectId,
      target: 'worldviews',
      mode: 'replace',
      data: { divineDesign },
    })

    const row = await db.worldviews.where('projectId').equals(projectId).first()
    expect(row?.divineDesign).toEqual(divineDesign)
    expect(typeof row?.divineDesign).toBe('object')
  })

  it('单例写回:storyCores.mainPlot 支持 append 合并长文本', async () => {
    const projectId = await createProject()
    await adopt({
      projectId,
      target: 'storyCores',
      mode: 'replace',
      data: { mainPlot: '主角寻找失落星门', theme: '自由意志' },
    })
    await adopt({
      projectId,
      target: 'storyCores',
      mode: 'append',
      data: { mainPlot: '星门背后是旧时代谎言' },
    })

    const row = await db.storyCores.where('projectId').equals(projectId).first()
    expect(row?.mainPlot).toBe('主角寻找失落星门\n\n星门背后是旧时代谎言')
    expect(row?.theme).toBe('自由意志')
  })

  it('集合写回:characters 按三轴派生 role,同名角色自动合并', async () => {
    const projectId = await createProject()
    const worldGroupId = await createWorldGroup(projectId, '炉火界')
    const result = await adopt({
      projectId,
      worldGroupId,
      target: 'characters',
      mode: 'add-many',
      data: [
        { name: '燕飞', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', summary: '背负旧王血脉' },
        { name: '燕飞', roleWeight: 'main', moralAxis: 'evil', orderAxis: 'neutral', summary: '重复角色' },
      ],
    })

    expect(result.written.length).toBe(2)
    expect(result.skipped).toHaveLength(0)
    expect(result.aliasMapped).toContainEqual({ from: 'summary', to: 'shortDescription' })

    const rows = await db.characters.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('燕飞')
    expect(rows[0].role).toBe('antagonist')
    expect(rows[0].shortDescription).toBe('重复角色')
    expect(rows[0].homeWorldGroupId).toBe(worldGroupId)
  })

  it('集合写回:characters 同名不同世界不误合并', async () => {
    const projectId = await createProject()
    const firstWorldGroupId = await createWorldGroup(projectId, '主世界组')
    const secondWorldGroupId = await createWorldGroup(projectId, '副世界组')
    await adopt({
      projectId,
      worldGroupId: firstWorldGroupId,
      target: 'characters',
      mode: 'add',
      data: { name: '燕飞', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', summary: '主世界角色' },
    })
    await adopt({
      projectId,
      worldGroupId: secondWorldGroupId,
      target: 'characters',
      mode: 'add',
      data: { name: '燕飞', roleWeight: 'main', moralAxis: 'evil', orderAxis: 'neutral', summary: '副世界角色' },
    })

    const rows = await db.characters.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.homeWorldGroupId).sort()).toEqual([firstWorldGroupId, secondWorldGroupId].sort())
    expect(rows.find(r => r.homeWorldGroupId === firstWorldGroupId)?.role).toBe('protagonist')
    expect(rows.find(r => r.homeWorldGroupId === secondWorldGroupId)?.role).toBe('antagonist')
  })

  it('集合写回:codexEntries 校验 categoryId,无效 FK 不落库', async () => {
    const projectId = await createProject()
    const scope = await resolveWorkspaceScope(projectId)
    const worldGroupId = await createWorldGroup(projectId, '词条世界')
    const now = Date.now()
    const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', {
      projectId,
      domain: 'natural',
      parentId: null,
      name: '矿物',
      fieldSchema: '[]',
      order: 0,
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'world' })) as number

    const bad = await adopt({
      projectId,
      target: 'codexEntries',
      mode: 'add',
      data: { categoryId: 9999, name: '不存在分类下的玄铁' },
    })
    expect(bad.fkErrors).toContainEqual({ field: 'categoryId', refValue: 9999 })
    expect(await db.codexEntries.count()).toBe(0)

    const good = await adopt({
      projectId,
      worldGroupId,
      target: 'codexEntries',
      mode: 'add',
      data: { categoryId, name: '九曜玄铁', fields: { rank: '神品' }, refs: {} },
    })
    expect(good.written.length).toBe(1)
    const row = await db.codexEntries.where('projectId').equals(projectId).first()
    expect(row?.categoryId).toBe(categoryId)
    expect(row?.worldGroupId).toBe(worldGroupId)
    expect(row?.fields).toBe(JSON.stringify({ rank: '神品' }))
  })

  it('集合写回:detailedOutlines 数组成员校验过滤不存在的角色 ID', async () => {
    const projectId = await createProject()
    const scope = await resolveWorkspaceScope(projectId)
    const now = Date.now()
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId,
      parentId: null,
      type: 'chapter',
      title: '第一章',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'work' })) as number
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId,
      name: '沈璃',
      role: 'supporting',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: '',
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'world' })) as number

    const result = await adopt({
      projectId,
      target: 'detailedOutlines',
      mode: 'add',
      data: {
        outlineNodeId,
        scenes: [],
        appearingCharacterIds: [characterId, 9999],
      },
    })

    expect(result.fkErrors).toContainEqual({ field: 'appearingCharacterIds[]', refValue: 9999 })
    const row = await db.detailedOutlines.where('projectId').equals(projectId).first()
    expect(row?.appearingCharacterIds).toEqual([characterId])
  })

  it('参考分析写回按 referenceId 继承项目归属，并支持注册式整批替换', async () => {
    const projectId = await createProject()
    const otherProjectId = await createProject()
    const scope = await resolveWorkspaceScope(projectId)
    const now = Date.now()
    const referenceId = await db.references.add(stampNewRecord(scope, 'references', {
      projectId,
      title: '本项目参考',
      author: '',
      type: 'story',
      note: '',
      url: '',
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'work' })) as number
    const analysisRunId = await db.referenceAnalysisRuns.add(stampNewRecord(scope, 'referenceAnalysisRuns', {
      projectId,
      referenceId,
      version: 1,
      status: 'analyzing',
      depth: 'quick',
      sourceFilename: 'reference.txt',
      fileHash: 'reference-hash',
      totalChars: 100,
      sourceKind: 'own-work',
      usageScope: 'creative-reference',
      rightsNote: '',
      rightsConfirmed: true,
      rightsDeclaredAt: now,
      expectedChunks: 2,
      completedChunks: 0,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    } as never, { owner: 'work' })) as number

    const rejected = await adopt({
      projectId: otherProjectId,
      target: 'referenceChunkAnalysis',
      mode: 'add',
      data: { referenceId, analysisRunId, chunkIndex: 0, narrativeStyle: '不应跨项目写入' },
    })
    expect(rejected.fkErrors).toContainEqual({ field: 'referenceId', refValue: referenceId })
    expect(await db.referenceChunkAnalysis.count()).toBe(0)

    await adopt({
      projectId,
      target: 'referenceChunkAnalysis',
      mode: 'add',
      data: [
        { referenceId, analysisRunId, chunkIndex: 0, narrativeStyle: '第一块' },
        { referenceId, analysisRunId, chunkIndex: 1, narrativeStyle: '第二块' },
      ],
    })
    expect(await db.referenceChunkAnalysis.where('referenceId').equals(referenceId).count()).toBe(2)

    const deleted = await clearAdoptedCollection({
      projectId,
      target: 'referenceChunkAnalysis',
      scope: { analysisRunId },
    })
    expect(deleted).toBe(2)
    expect(await db.referenceChunkAnalysis.where('referenceId').equals(referenceId).count()).toBe(0)
  })
})
