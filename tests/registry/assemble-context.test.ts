/**
 * Phase 1.3a · CONTEXT_SOURCES + assembleContext()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { checkRegistry } from '../../src/lib/registry/validate'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'Context Test',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
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
    const projectId = await createProject()
    const worldA = await db.worldGroups.add({
      projectId, name: '炉火界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '冰海界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await db.worldviews.add({
      projectId, worldGroupId: worldA, worldOrigin: '炉火界只信奉火焰契约', createdAt: now, updatedAt: now,
    } as any)
    await db.worldviews.add({
      projectId, worldGroupId: worldB, worldOrigin: '冰海界由潮汐神殿统治', createdAt: now, updatedAt: now,
    } as any)
    await db.characters.add({
      projectId, homeWorldGroupId: worldA, name: '赤衡', role: 'protagonist', shortDescription: '火契继承人', createdAt: now, updatedAt: now,
    } as any)
    await db.characters.add({
      projectId, homeWorldGroupId: worldB, name: '澜青', role: 'antagonist', shortDescription: '潮汐祭司', createdAt: now, updatedAt: now,
    } as any)

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

  it('worldRules 按 worldGroupId 隔离 profile 与历史辅助数据', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const worldA = await db.worldGroups.add({
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number

    await db.worldRulesProfiles.add({
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
    } as any)
    await db.worldRulesProfiles.add({
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
    } as any)
    await db.historicalTimelineEvents.add({
      projectId, worldGroupId: worldA, era: 'custom', year: 1, date: '镜元年',
      title: '镜城开埠', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    } as any)
    await db.historicalTimelineEvents.add({
      projectId, worldGroupId: worldB, era: 'custom', year: 1, date: '雾元年',
      title: '雾钟敲响', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    } as any)
    await db.historicalKeywords.add({
      projectId, worldGroupId: worldA, keyword: '镜税', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    } as any)
    await db.historicalKeywords.add({
      projectId, worldGroupId: worldB, keyword: '雾钟', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    } as any)

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

  it('assembleContext 真裁剪:预算不足时 L3 从最终文本移除', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const insightId = await db.masterInsights.add({
      title: '长篇大师洞察',
      genre: '玄幻',
      description: '这是一段非常长的大师洞察。'.repeat(200),
      bulletPoints: ['节奏控制'.repeat(100), '人物反转'.repeat(100)],
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const assembled = await assembleContext({
      projectId,
      sourceKeys: ['previousChapterEnding', 'masterInsights'],
      previousChapterEnding: '主角在城门前发现旧王印记。',
      masterInsightIds: [insightId],
      inputBudgetTokens: 60,
    })

    expect(assembled.overBudgetBeforeTrim).toBe(true)
    expect(assembled.included).toEqual(['previousChapterEnding'])
    expect(assembled.trimmed).toContain('masterInsights')
    expect(assembled.text).toContain('旧王印记')
    expect(assembled.text).not.toContain('长篇大师洞察')
  })
})
