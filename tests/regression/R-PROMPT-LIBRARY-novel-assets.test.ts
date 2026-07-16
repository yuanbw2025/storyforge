import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { NOVEL_PROMPT_LIBRARY_SEEDS } from '../../src/lib/ai/prompt-library-seeds'
import {
  assembleLibraryPromptVariables,
  getLibraryScopeNeeds,
  libraryTemplateMatchesProject,
} from '../../src/lib/ai/prompt-library'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { GENRE_OPTIONS, type Project } from '../../src/lib/types'
import type { PromptTemplate } from '../../src/lib/types/prompt'

const asTemplate = (assetId: string): PromptTemplate => {
  const seed = NOVEL_PROMPT_LIBRARY_SEEDS.find(item => item.library?.assetId === assetId)
  if (!seed) throw new Error(`missing seed ${assetId}`)
  return { ...seed, createdAt: 1, updatedAt: 1 }
}

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 991,
  name: '测试小说',
  genre: 'kehuan',
  genres: ['kehuan'],
  status: 'drafting',
  description: '一个用于验证 Prompt 资产映射的项目。',
  targetWordCount: 300_000,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe('小说创作 Prompt 资产库', () => {
  it('完整收录 118 个唯一资产，并保持 P00-P17 与类型专项数量', () => {
    expect(NOVEL_PROMPT_LIBRARY_SEEDS).toHaveLength(118)
    const ids = NOVEL_PROMPT_LIBRARY_SEEDS.map(item => item.library?.assetId)
    expect(new Set(ids).size).toBe(118)
    expect(ids.filter(id => id?.startsWith('G-'))).toHaveLength(43)
    expect(ids.filter(id => id && !id.startsWith('G-'))).toHaveLength(75)
    expect(NOVEL_PROMPT_LIBRARY_SEEDS.every(item => item.moduleKey === 'library.run')).toBe(true)
    expect(NOVEL_PROMPT_LIBRARY_SEEDS.every(item => item.isActive === false)).toBe(true)
  })

  it('每个模板变量都有声明式输入绑定，且所有 sourceKeys 已注册', () => {
    for (const seed of NOVEL_PROMPT_LIBRARY_SEEDS) {
      const meta = seed.library!
      const bound = new Set(meta.inputs.map(input => input.variable))
      const expected = new Set(seed.variables.filter(variable => variable !== 'userHint'))
      expect(bound, meta.assetId).toEqual(expected)
      expect(meta.inputs.every(input => input.manual || input.projectField || input.sourceKeys?.length)).toBe(true)
      for (const input of meta.inputs) {
        for (const key of input.sourceKeys ?? []) {
          expect(CONTEXT_SOURCE_BY_KEY.has(key), `${meta.assetId}:${input.variable}:${key}`).toBe(true)
        }
      }
    }
  })

  it('可采纳输出只指向 FIELD_REGISTRY 与 AdoptionSchema 已登记目标', () => {
    const adoptable = NOVEL_PROMPT_LIBRARY_SEEDS.filter(seed => seed.library?.output.mode === 'adopt')
    expect(adoptable.map(seed => seed.library!.assetId)).toEqual(['P11-A', 'P11-B', 'P11-C'])
    for (const seed of adoptable) {
      const output = seed.library!.output
      expect(output.target).toBeTruthy()
      expect(output.field).toBeTruthy()
      expect(ADOPTION_BY_TARGET.has(output.target!), seed.library!.assetId).toBe(true)
      expect(
        FIELD_BY_TARGET.get(output.target!)?.some(field => field.field === output.field),
        seed.library!.assetId,
      ).toBe(true)
    }
  })

  it('题材与篇幅专项只在匹配项目中标记为适用', () => {
    const sciFi = asTemplate('G-SCIFI-A')
    const history = asTemplate('G-HISTORY-A')
    const longForm = asTemplate('P09L-A')
    const shortStory = asTemplate('P09S-A')
    const general = asTemplate('P05-A')

    expect(libraryTemplateMatchesProject(sciFi, project())).toBe(true)
    expect(libraryTemplateMatchesProject(history, project())).toBe(false)
    expect(libraryTemplateMatchesProject(longForm, project())).toBe(true)
    expect(libraryTemplateMatchesProject(shortStory, project())).toBe(false)
    expect(libraryTemplateMatchesProject(shortStory, project({ targetWordCount: 30_000 }))).toBe(true)
    expect(libraryTemplateMatchesProject(general, project())).toBe(true)
  })

  it('所有题材适用值均来自 StoryForge 项目题材枚举', () => {
    const knownGenres = new Set(GENRE_OPTIONS.map(option => option.value))
    for (const seed of NOVEL_PROMPT_LIBRARY_SEEDS) {
      for (const genre of seed.library?.applicability?.genres ?? []) {
        expect(knownGenres.has(genre as never), `${seed.library!.assetId}:${genre}`).toBe(true)
      }
    }
  })

  it('缺少必需章节和章纲范围时在 AI 调用前返回阻断信息', async () => {
    const template = asTemplate('P11-B')
    expect(getLibraryScopeNeeds(template)).toMatchObject({ outline: true, chapter: true })

    const result = await assembleLibraryPromptVariables({
      template,
      project: project(),
      worldGroupId: null,
      outlineNodeId: null,
      chapterId: null,
      manualValues: {
        scenes: '场景一：会议室对峙。',
        continuity: '主角上一章刚拿到证据。',
        words: '2500',
      },
    })

    expect(result.missingScopes).toEqual(expect.arrayContaining(['outline', 'chapter']))
  })

  it('多世界项目未选择世界时不会静默使用空世界上下文', async () => {
    const template = asTemplate('P05-A')
    const result = await assembleLibraryPromptVariables({
      template,
      project: project({ enableMultiWorld: true }),
      worldGroupId: null,
      manualValues: {},
    })
    expect(result.missingScopes).toContain('world')
  })

  it('公开资产正文不包含本地路径和外部来源网址', () => {
    for (const seed of NOVEL_PROMPT_LIBRARY_SEEDS) {
      const publicText = [seed.name, seed.description, seed.systemPrompt, seed.userPromptTemplate].join('\n')
      expect(publicText, seed.library!.assetId).not.toMatch(/\/Users\/|https?:\/\/|kdocs\.cn|\.codex-tmp/)
    }
  })
})

describe('小说创作 Prompt 最终请求', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.storyCores.add({
      projectId: 991,
      theme: 'UNIQUE_STORY_CORE_MARKER',
      centralConflict: '冲突',
      plotPattern: '成长',
      storyLines: '主线',
      createdAt: 1,
      updatedAt: 1,
    })
  })

  afterEach(() => db.close())

  it('同一自动来源即使绑定多个变量，正文也只注入一次', async () => {
    const source = asTemplate('P11-A')
    const template: PromptTemplate = {
      ...source,
      library: {
        ...source.library!,
        output: { format: 'markdown', mode: 'preview', suggestedDestination: '测试' },
        inputs: [
          { variable: 'brief', label: '创作简报', sourceKeys: ['storyCore'] },
          { variable: 'core', label: '故事核心', sourceKeys: ['storyCore'] },
        ],
      },
      userPromptTemplate: '{{brief}}\n{{core}}',
      variables: ['brief', 'core'],
    }
    const result = await assembleLibraryPromptVariables({
      template,
      project: project(),
      worldGroupId: null,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })
    const finalText = result.messages.map(message => message.content).join('\n')
    expect(finalText.match(/UNIQUE_STORY_CORE_MARKER/g)).toHaveLength(1)
    expect(String(result.variables.brief)).not.toContain('UNIQUE_STORY_CORE_MARKER')
    expect(String(result.variables.brief)).toContain('创作简报')
    expect(finalText.match(/<storyforge_project_context>/g)).toHaveLength(1)
  })

  it('最终预算包含固定模板和手动输入，超限时在请求前阻断', async () => {
    const source = asTemplate('P00-A')
    const template: PromptTemplate = {
      ...source,
      systemPrompt: '系统规则'.repeat(300),
      userPromptTemplate: '{{raw_intent}}',
      variables: ['raw_intent'],
      library: {
        ...source.library!,
        inputs: [{ variable: 'raw_intent', label: '作者原始想法', manual: true, required: true }],
      },
    }
    await expect(assembleLibraryPromptVariables({
      template,
      project: project(),
      worldGroupId: null,
      manualValues: { raw_intent: '手动资料'.repeat(300) },
      provider: 'custom',
      model: 'tiny-model',
      contextWindow: 1_000,
      maxOutputTokens: 100,
    })).rejects.toThrow('固定指令与手动输入')
  })
})
