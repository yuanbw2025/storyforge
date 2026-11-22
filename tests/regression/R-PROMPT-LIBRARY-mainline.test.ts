import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CRAFT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-craft'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { usePromptStore } from '../../src/stores/prompt'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { assembleBoundPrompt, promptTemplateMatchesWork } from '../../src/lib/ai/prompt-variable-bindings'
import type { PromptTemplate, Work } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('小说创作 Prompt 内容回归主模板体系', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })

  afterEach(() => { vi.restoreAllMocks(); db.close() })

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
          Boolean(binding.manual || binding.workField || binding.sourceKeys?.length),
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
    expect(sources('rules')).toEqual(expect.arrayContaining(['canonAssertions', 'worldview', 'worldRules', 'creativeRules']))

    const p12e = NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === 'P12-E')!
    expect(p12e.variableBindings?.find(binding => binding.variable === 'text')?.sourceKeys).toContain('chapterContent')
    expect(p12e.variableBindings?.find(binding => binding.variable === 'plan')?.sourceKeys)
      .toEqual(expect.arrayContaining(['chapterOutline', 'detailedOutline']))
  })

  it('统一装配时项目事实只注入一次，必填手动字段会在调用前阻断', async () => {
    const source = NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === 'P00-A')!
    const template: PromptTemplate = { ...source, createdAt: 1, updatedAt: 1 }
    const created = await seedCurrentWorkspace('绑定测试')
    const work: Work = {
      ...created.work,
      genres: ['kehuan'], status: 'ongoing',
      description: '测试描述', targetWordCount: 300_000,
    }
    const missing = await assembleBoundPrompt({ template, project: created.project, work })
    expect(missing.missingVariables).toContain('作者原始想法')

    const ready = await assembleBoundPrompt({
      template, project: created.project, work, manualValues: { raw_intent: '太空站上的身份危机' },
    })
    const finalText = ready.messages.map(message => message.content).join('\n')
    expect(finalText.match(/太空站上的身份危机/g)).toHaveLength(1)
    expect(ready.variables.length_mode).toBe('long')
    expect(ready.variables.serialization_mode).toBe('serial')
  })

  it('题材、篇幅和连载限定不会被当作所有项目通用模板', () => {
    const work = (overrides: Partial<Work> = {}): Work => ({
      id: 502, projectId: 1, worldId: 1,
      code: 'WORK-00000000-0000-4000-8000-000000000502',
      kind: 'novel', novelProfile: 'long', title: '适用性测试',
      genres: ['kehuan'], status: 'drafting', description: '',
      targetWordCount: 300_000, currentWordCount: 0,
      includeCultivationProgressInAI: false,
      activeCharacterDrivenPlanId: null, activeNarrativeModuleId: null,
      postAdoptionPolicy: 'suggest',
      postAdoptionTaskTypes: ['organization', 'memory', 'retrieval', 'consistency'],
      postAdoptionBudget: {
        maxModelCalls: 2, maxInputTokens: 48_000, maxOutputTokens: 16_000,
        maxCostUsd: 0.25, allowUnknownCost: false,
      },
      createdAt: 1, updatedAt: 1, ...overrides,
    })
    const asTemplate = (assetId: string): PromptTemplate => ({
      ...NOVEL_CONTENT_PROMPT_SEEDS.find(seed => seed.assetId === assetId)!, createdAt: 1, updatedAt: 1,
    })
    expect(promptTemplateMatchesWork(asTemplate('G-SCIFI-A'), work())).toBe(true)
    expect(promptTemplateMatchesWork(asTemplate('G-HISTORY-A'), work())).toBe(false)
    expect(promptTemplateMatchesWork(asTemplate('P09L-A'), work())).toBe(true)
    expect(promptTemplateMatchesWork(asTemplate('P09S-A'), work())).toBe(false)
    expect(promptTemplateMatchesWork(asTemplate('P09S-A'), work({ targetWordCount: 30_000 }))).toBe(false)
    expect(promptTemplateMatchesWork(asTemplate('P09S-A'), work({ novelProfile: 'short', targetWordCount: 30_000 }))).toBe(true)
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
    expect(templates).toHaveLength(SYSTEM_PROMPT_SEEDS.length + NOVEL_CONTENT_PROMPT_SEEDS.length + CRAFT_PROMPT_SEEDS.length)
    expect(migrated?.moduleKey).toBe('story.brief')
    expect(migrated?.isActive).toBe(true)
  })
  it('archives every overwritten codex system field as inactive history while preserving active IDs and user templates, idempotently', async () => {
    await usePromptStore.getState().init()
    const seed = (await db.promptTemplates.toArray()).find(row => row.moduleKey === 'codex.extract' && row.scope === 'system')!
    await db.promptTemplates.update(seed.id!, { systemPrompt: '作者旧规则：1-5条引文', description: '作者说明', isActive: false,
      parameters: [{ key: '旧参数', label: '旧参数', type: 'number', default: 0.25 }], examples: { good: [{ id: 'old-example', text: '旧输入与输出', source: 'user-marked', createdAt: 1 }] } })
    const old = (await db.promptTemplates.get(seed.id!))!
    const { id: _id, ...copy } = old
    const userId = await db.promptTemplates.add({ ...copy, name: '我的拆分', scope: 'user', isActive: true })
    const user = await db.promptTemplates.get(userId)
    usePromptStore.setState({ loaded: false })
    await usePromptStore.getState().init()
    const rows = await db.promptTemplates.toArray(), history = rows.filter(row => row.name === old.name + '（升级前历史）')
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({ ...copy, id: history[0].id, scope: 'user', name: old.name + '（升级前历史）', isActive: false })
    expect((await db.promptTemplates.get(seed.id!))?.isActive).toBe(false)
    expect(await db.promptTemplates.get(userId)).toEqual(user)
    expect(usePromptStore.getState().getActive('codex.extract').id).toBe(userId)
    usePromptStore.setState({ loaded: false }); await usePromptStore.getState().init()
    expect((await db.promptTemplates.toArray()).filter(row => row.name === old.name + '（升级前历史）')).toHaveLength(1)
    const builtIn = SYSTEM_PROMPT_SEEDS.find(row => row.moduleKey === 'codex.extract')!
    expect(builtIn.systemPrompt).not.toMatch(/2-5|1-5/)
  })

  it('rolls back codex refresh if history cannot commit, and refuses to overwrite a concurrently edited latest row', async () => {
    await usePromptStore.getState().init()
    const seed = (await db.promptTemplates.toArray()).find(row => row.moduleKey === 'codex.extract' && row.scope === 'system')!
    await db.promptTemplates.update(seed.id!, { systemPrompt: '旧稿，不能丢' })
    const old = await db.promptTemplates.get(seed.id!)
    const fail = vi.spyOn(db.promptTemplates, 'add').mockRejectedValueOnce(new Error('history write failed'))
    usePromptStore.setState({ loaded: false })
    await expect(usePromptStore.getState().init()).rejects.toThrow('history write failed')
    expect(await db.promptTemplates.get(seed.id!)).toEqual(old)
    fail.mockRestore()
    const original = db.promptTemplates.toArray.bind(db.promptTemplates)
    vi.spyOn(db.promptTemplates, 'toArray').mockImplementationOnce(() => original().then(stale =>
      db.promptTemplates.update(seed.id!, { systemPrompt: '并发作者最新稿' }).then(() => stale)))
    await expect(usePromptStore.getState().init()).rejects.toThrow('其他编辑修改')
    expect((await db.promptTemplates.get(seed.id!))?.systemPrompt).toBe('并发作者最新稿')
    expect((await original()).filter(row => row.name === seed.name + '（升级前历史）')).toHaveLength(0)
  })

})
