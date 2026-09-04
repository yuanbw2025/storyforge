/**
 * Phase 1.3a · CONTEXT_SOURCES + assembleContext()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { checkRegistry } from '../../src/lib/registry/validate'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'

async function createProject(): Promise<WorkspaceScope> {
  return (await seedCurrentWorkspace('Context Test', { enableMultiWorld: true })).scope
}

describe('Phase 1.3a · 统一上下文装配层', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('CONTEXT_SOURCES 登记完整且通过 registry 校验', () => {
    expect(CONTEXT_SOURCES.length).toBeGreaterThanOrEqual(17)
    const keys = CONTEXT_SOURCES.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const source of CONTEXT_SOURCES.filter(s => s.scope === 'world')) {
      expect(source.requiresWorldGroupId, source.key).toBe(true)
    }

    const result = checkRegistry()
    if (!result.ok) console.error(result.errors)
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('assembleContext 按显式 worldGroupId 隔离世界观和角色', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    const worldA = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '炉火界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    const worldB = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '冰海界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId, worldGroupId: worldA, worldOrigin: '炉火界只信奉火焰契约', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId, worldGroupId: worldB, worldOrigin: '冰海界由潮汐神殿统治', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId, homeWorldGroupId: worldA, name: '赤衡', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', shortDescription: '火契继承人', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId, homeWorldGroupId: worldB, name: '澜青', roleWeight: 'main', moralAxis: 'evil', orderAxis: 'neutral', shortDescription: '潮汐祭司', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['worldview', 'characters'],
    })

    expect(assembled.included).toEqual(['worldview', 'characters'])
    expect(assembled.text).toContain('炉火界只信奉火焰契约')
    expect(assembled.text).toContain('赤衡')
    expect(assembled.text).not.toContain('冰海界由潮汐神殿统治')
    expect(assembled.text).not.toContain('澜青')
  })

  it('targetCharacter 精确读取一个角色完整字段并记录原始来源哈希', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    const worldId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    const targetId = await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId,
      homeWorldGroupId: worldId,
      name: '青禾',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'lawful',
      shortDescription: '守门人',
      personality: '谨慎但重诺',
      background: '',
      motivation: '',
      abilities: '',
      appearance: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any) as number
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId,
      homeWorldGroupId: worldId,
      name: '旁人',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: '不应进入目标上下文',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      appearance: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any)

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldId,
      characterId: targetId,
      sourceKeys: ['targetCharacter'],
    })

    expect(assembled.text).toContain('青禾')
    expect(assembled.text).toContain('谨慎但重诺')
    expect(assembled.text).toContain('背景故事：（未填写）')
    expect(assembled.text).not.toContain('旁人')
    expect(assembled.sourceEvidence?.[0]).toMatchObject({
      key: 'targetCharacter',
      status: 'included',
      delivery: 'full',
    })
    expect(assembled.sourceEvidence?.[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(assembled.sourceEvidence?.[0]).toMatchObject({
      originalCharacters: assembled.text.length,
      inputCharacters: assembled.text.length,
    })
  })

  it('worldGroupId 为 null 时只读取明确未分组的世界资源，非 null 仍严格隔离', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    const primaryWorld = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    const otherWorld = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '副世界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId, worldGroupId: null, worldOrigin: '星门坠落后灵气复苏', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', {
      projectId, worldGroupId: null, name: '星门修炼法', description: '观星入境', levels: '[]', rules: '不可越阶吸收星核', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId, worldGroupId: primaryWorld, worldOrigin: '星门坠落后灵气复苏', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', {
      projectId, worldGroupId: primaryWorld, name: '星门修炼法', description: '观星入境', levels: '[]', rules: '不可越阶吸收星核', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)

    const defaultCtx = await assembleContext({
      projectId,
      worldGroupId: null,
      sourceKeys: ['worldview', 'powerSystem'],
    })

    expect(defaultCtx.included).toEqual(['worldview', 'powerSystem'])
    expect(defaultCtx.text).toContain('星门坠落后灵气复苏')
    expect(defaultCtx.text).toContain('星门修炼法')

    const isolatedCtx = await assembleContext({
      projectId,
      worldGroupId: otherWorld,
      sourceKeys: ['worldview', 'powerSystem'],
    })

    expect(isolatedCtx.text).not.toContain('星门坠落后灵气复苏')
    expect(isolatedCtx.text).not.toContain('星门修炼法')
  })

  it('worldRules 按 worldGroupId 隔离 profile 与历史辅助数据', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    const worldA = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    const worldB = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number

    await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', {
      projectId,
      worldGroupId: worldA,
      entries: {
        'era.period': {
          historicalAnchors: '镜城沿用宋代市舶司制度',
          fictionalAdaptations: '镜城增设镜税',
          priority: 'balanced',
        },
      },
      customNodes: [],
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', {
      projectId,
      worldGroupId: worldB,
      entries: {
        'era.period': {
          historicalAnchors: '雾都沿用维多利亚街区制度',
          fictionalAdaptations: '雾都由雾钟议会统治',
          priority: 'fictional',
        },
      },
      customNodes: [],
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.historicalTimelineEvents.add(stampNewRecord(scope, 'historicalTimelineEvents', {
      projectId, worldGroupId: worldA, era: 'custom', year: 1, date: '镜元年',
      title: '镜城开埠', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.historicalTimelineEvents.add(stampNewRecord(scope, 'historicalTimelineEvents', {
      projectId, worldGroupId: worldB, era: 'custom', year: 1, date: '雾元年',
      title: '雾钟敲响', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.historicalKeywords.add(stampNewRecord(scope, 'historicalKeywords', {
      projectId, worldGroupId: worldA, keyword: '镜税', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)
    await db.historicalKeywords.add(stampNewRecord(scope, 'historicalKeywords', {
      projectId, worldGroupId: worldB, keyword: '雾钟', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any)

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['worldRules'],
    })

    expect(assembled.included).toEqual(['worldRules'])
    expect(assembled.text).toContain('镜城沿用宋代市舶司制度')
    expect(assembled.text).toContain('镜城开埠')
    expect(assembled.text).toContain('镜税')
    expect(assembled.text).not.toContain('雾都沿用维多利亚街区制度')
    expect(assembled.text).not.toContain('雾钟敲响')
    expect(assembled.text).not.toContain('雾钟')
  })

  it('historical source 按 worldGroupId 精确读取当前世界，不混入未分组世界数据', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    const worldA = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number
    const worldB = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    }, { owner: 'world' }) as any) as number

    await db.historicalTimelineEvents.bulkAdd([
      { projectId, worldGroupId: worldA, era: 'custom', year: 1, date: '镜元年', title: '镜城开埠', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: worldB, era: 'custom', year: 2, date: '雾元年', title: '雾钟敲响', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: null, era: 'custom', year: 0, date: '未分组纪元', title: '未分组世界史', description: '', isHistorical: true, createdAt: now, updatedAt: now },
    ].map(row => stampNewRecord(scope, 'historicalTimelineEvents', row, { owner: 'world' })) as any[])
    await db.historicalKeywords.bulkAdd([
      { projectId, worldGroupId: worldA, keyword: '镜税', category: 'politics', era: 'custom', description: '', createdAt: now, updatedAt: now },
      { projectId, worldGroupId: worldB, keyword: '雾钟', category: 'politics', era: 'custom', description: '', createdAt: now, updatedAt: now },
      { projectId, worldGroupId: null, keyword: '通用礼法', category: 'culture', era: 'custom', description: '', createdAt: now, updatedAt: now },
    ].map(row => stampNewRecord(scope, 'historicalKeywords', row, { owner: 'world' })) as any[])

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['historical'],
    })

    expect(assembled.included).toEqual(['historical'])
    expect(assembled.text).toContain('镜城开埠')
    expect(assembled.text).toContain('镜税')
    expect(assembled.text).not.toContain('未分组世界史')
    expect(assembled.text).not.toContain('通用礼法')
    expect(assembled.text).not.toContain('雾钟敲响')
    expect(assembled.text).not.toContain('雾钟')
  })

  it('assembleContext 真裁剪:预算不足时 L3 从最终文本移除', async () => {
    const now = Date.now()
    const scope = await createProject()
    const { projectId } = scope
    // L3 源「引用手法」:参考作品 + 一条超长维度分析
    const refId = await db.references.add(stampNewRecord(scope, 'references', {
      projectId, title: '长篇参考作品', author: '某大师', type: 'reference',
      analysisStatus: 'done', analysisProgress: 100,
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as any) as number
    const analysisRunId = await db.referenceAnalysisRuns.add(stampNewRecord(scope, 'referenceAnalysisRuns', {
      projectId,
      referenceId: refId,
      version: 1,
      status: 'active',
      depth: 'quick',
      sourceFilename: 'reference.txt',
      fileHash: 'reference-hash',
      totalChars: 1_000,
      sourceKind: 'own-work',
      usageScope: 'creative-reference',
      rightsNote: '',
      rightsConfirmed: true,
      rightsDeclaredAt: now,
      expectedChunks: 1,
      completedChunks: 1,
      progress: 100,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as any) as number
    await db.referenceChunkAnalysis.add(stampNewRecord(scope, 'referenceChunkAnalysis', {
      referenceId: refId, analysisRunId, chunkIndex: 0,
      narrativeStyle: '这是一段非常长的叙事手法分析。'.repeat(200),
      createdAt: now,
    }, { owner: 'work' }) as any)

    const assembled = await assembleContext({
      projectId,
      sourceKeys: ['previousChapterEnding', 'references'],
      previousChapterEnding: '主角在城门前发现旧王印记。',
      citedReferenceIds: [refId],
      inputBudgetTokens: 60,
    })

    expect(assembled.overBudgetBeforeTrim).toBe(true)
    expect(assembled.included).toEqual(['previousChapterEnding'])
    expect(assembled.trimmed).toContain('references')
    expect(assembled.text).toContain('旧王印记')
    expect(assembled.text).not.toContain('非常长的叙事手法分析')
  })
})
