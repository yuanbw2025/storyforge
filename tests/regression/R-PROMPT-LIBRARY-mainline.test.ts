import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { usePromptStore } from '../../src/stores/prompt'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { assembleBoundPrompt, promptTemplateMatchesProject } from '../../src/lib/ai/prompt-variable-bindings'
import type { Project, PromptTemplate } from '../../src/lib/types'

describe('小说创作 Prompt 内容回归主模板体系', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })

  afterEach(() => db.close())

  it('完整纳入 118 条系统模板，且默认不抢占激活模板', () => {
    expect(NOVEL_CONTENT_PROMPT_SEEDS).toHaveLength(118)
    expect(new Set(NOVEL_CONTENT_PROMPT_SEEDS.map(seed => seed.name)).size).toBe(118)
    expect(NOVEL_CONTENT_PROMPT_SEEDS.every(seed => seed.scope === 'system')).toBe(true)
    expect(NOVEL_CONTENT_PROMPT_SEEDS.every(seed => seed.isActive === false)).toBe(true)
  })

  it('主线不携带实验版独立运行器标识', () => {
    const allSeeds = [...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS]
    expect(allSeeds.some(seed => seed.moduleKey === ('library.run' as never))).toBe(false)
    expect(allSeeds.some(seed => 'library' in seed)).toBe(false)
  })

  it('每条模板声明的变量与实际占位符一致', () => {
    for (const seed of NOVEL_CONTENT_PROMPT_SEEDS) {
      const source = `${seed.systemPrompt}\n${seed.userPromptTemplate}`
      const referenced = new Set(
        [...source.matchAll(/{{#?(?:if )?([A-Za-z0-9_.-]+)}}/g)].map(match => match[1]),
      )
      expect(referenced, seed.name).toEqual(new Set(seed.variables))
      expect(seed.variables, `${seed.name} 必须复用工作流现有的作者输入槽位`).toContain('userHint')
      const bindings = seed.variableBindings ?? []
      expect(new Set(bindings.map(binding => binding.variable)), seed.name)
        .toEqual(new Set(seed.variables.filter(variable => variable !== 'userHint')))
      for (const binding of bindings) {
        expect(
          Boolean(binding.manual || binding.projectField || binding.sourceKeys?.length),
          `${seed.assetId}:${binding.variable} 没有输入来源`,
        ).toBe(true)
        for (const sourceKey of binding.sourceKeys ?? []) {
          expect(CONTEXT_SOURCE_BY_KEY.has(sourceKey), `${seed.assetId}:${binding.variable}:${sourceKey}`).toBe(true)
        }
      }
    }
  })

  it('正文类模板按语义读取章纲、正文、连续性、人物和规则字段', () => {
    const p11b = NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === 'P11-B')!
    const sources = (variable: string) => p11b.variableBindings
      ?.find(binding => binding.variable === variable)?.sourceKeys ?? []
    expect(sources('task')).toEqual(expect.arrayContaining(['chapterOutline', 'detailedOutline']))
    expect(sources('continuity')).toEqual(expect.arrayContaining(['chapterContinuityHandoff', 'currentFacts', 'heldItems']))
    expect(sources('voices')).toEqual(expect.arrayContaining(['characters', 'characterRelations']))
    expect(sources('rules')).toEqual(expect.arrayContaining(['worldview', 'worldRules', 'creativeRules']))

    const p12e = NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === 'P12-E')!
    expect(p12e.variableBindings?.find(binding => binding.variable === 'text')?.sourceKeys).toContain('chapterContent')
    expect(p12e.variableBindings?.find(binding => binding.variable === 'plan')?.sourceKeys)
      .toEqual(expect.arrayContaining(['chapterOutline', 'detailedOutline']))
  })

  it('统一装配时项目事实只注入一次，必填手动字段会在调用前阻断', async () => {
    const source = NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === 'P00-A')!
    const template: PromptTemplate = { ...source, createdAt: 1, updatedAt: 1 }
    const project: Project = {
      id: 501, name: '绑定测试', genre: 'kehuan', genres: ['kehuan'], status: 'ongoing',
      description: '测试描述', targetWordCount: 300_000, createdAt: 1, updatedAt: 1,
    }
    const missing = await assembleBoundPrompt({ template, project })
    expect(missing.missingVariables).toContain('作者原始想法')

    const ready = await assembleBoundPrompt({
      template, project, manualValues: { raw_intent: '太空站上的身份危机' },
    })
    const finalText = ready.messages.map(message => message.content).join('\n')
    expect(finalText.match(/太空站上的身份危机/g)).toHaveLength(1)
    expect(ready.variables.length_mode).toBe('long')
    expect(ready.variables.serialization_mode).toBe('serial')
  })

  it('题材、篇幅和连载限定不会被当作所有项目通用模板', () => {
    const project = (overrides: Partial<Project> = {}): Project => ({
      id: 502, name: '适用性测试', genre: 'kehuan', genres: ['kehuan'], status: 'drafting',
      description: '', targetWordCount: 300_000, createdAt: 1, updatedAt: 1, ...overrides,
    })
    const asTemplate = (assetId: string): PromptTemplate => ({
      ...NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === assetId)!, createdAt: 1, updatedAt: 1,
    })
    expect(promptTemplateMatchesProject(asTemplate('G-SCIFI-A'), project())).toBe(true)
    expect(promptTemplateMatchesProject(asTemplate('G-HISTORY-A'), project())).toBe(false)
    expect(promptTemplateMatchesProject(asTemplate('P09L-A'), project())).toBe(true)
    expect(promptTemplateMatchesProject(asTemplate('P09S-A'), project())).toBe(false)
    expect(promptTemplateMatchesProject(asTemplate('P09S-A'), project({ targetWordCount: 30_000 }))).toBe(true)
  })

  it('复用原 Prompt store 增量写入，并保留已有模板的激活选择', async () => {
    const now = 1
    await db.promptTemplates.add({
      ...NOVEL_CONTENT_PROMPT_SEEDS[0],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await usePromptStore.getState().init()

    const templates = await db.promptTemplates.toArray()
    const migrated = templates.find(template => template.name === NOVEL_CONTENT_PROMPT_SEEDS[0].name)
    expect(templates).toHaveLength(204)
    expect(migrated?.moduleKey).toBe('story.brief')
    expect(migrated?.isActive).toBe(true)
  })
})
