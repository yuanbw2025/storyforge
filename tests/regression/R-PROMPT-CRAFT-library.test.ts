import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CRAFT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-craft'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { assembleBoundPrompt } from '../../src/lib/ai/prompt-variable-bindings'
import { buildDeAIPrompt } from '../../src/lib/ai/adapters/chapter-adapter'
import { usePromptStore } from '../../src/stores/prompt'
import type { PromptTemplate } from '../../src/lib/types/prompt'

const asTemplate = (id: string): PromptTemplate => ({
  ...CRAFT_PROMPT_SEEDS.find(seed => seed.assetId === `CRAFT-${id}`)!, createdAt: 1, updatedAt: 1,
})

describe('原创小说写作工坊：可选内容、材料合同与正文兼容', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })
  afterEach(async () => { vi.restoreAllMocks(); db.close() })

  it('全库稳定身份唯一，内容默认不改变作者的选择', () => {
    expect(CRAFT_PROMPT_SEEDS).toHaveLength(28)
    const all = [...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS, ...CRAFT_PROMPT_SEEDS]
    const oldNames = new Set([...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS].map(seed => seed.name))
    expect(new Set(CRAFT_PROMPT_SEEDS.map(seed => seed.name)).size).toBe(28)
    expect(CRAFT_PROMPT_SEEDS.some(seed => oldNames.has(seed.name))).toBe(false)
    const ids = all.flatMap(seed => seed.assetId ? [seed.assetId] : [])
    expect(new Set(ids).size).toBe(ids.length)
    expect(CRAFT_PROMPT_SEEDS.every(seed => !seed.isActive && seed.scope === 'system')).toBe(true)
  })

  it('新库安装与旧库升级均完整、幂等，并保留激活模板和用户副本', async () => {
    await usePromptStore.getState().init()
    expect(await db.promptTemplates.count()).toBe(SYSTEM_PROMPT_SEEDS.length + NOVEL_CONTENT_PROMPT_SEEDS.length + CRAFT_PROMPT_SEEDS.length)
    const builtIn = usePromptStore.getState().getActive('chapter.de-ai')
    const customId = await usePromptStore.getState().cloneTemplate(builtIn.id!, '我的保真规则')
    const custom = usePromptStore.getState().templates.find(item => item.id === customId)!
    await usePromptStore.getState().saveTemplate({ ...custom, systemPrompt: '保留我的独特规则' })
    await usePromptStore.getState().setActive(customId)
    // 模拟升级前没有工坊的用户库。
    await db.promptTemplates.bulkDelete(usePromptStore.getState().templates
      .filter(item => item.assetId?.startsWith('CRAFT-')).map(item => item.id!))
    for (let index = 0; index < 2; index++) {
      usePromptStore.setState({ loaded: false })
      await usePromptStore.getState().init()
      expect(await db.promptTemplates.count()).toBe(SYSTEM_PROMPT_SEEDS.length + NOVEL_CONTENT_PROMPT_SEEDS.length + CRAFT_PROMPT_SEEDS.length + 1)
      expect(usePromptStore.getState().getActive('chapter.de-ai').id).toBe(customId)
      expect((await db.promptTemplates.get(customId))?.systemPrompt).toBe('保留我的独特规则')
      expect((await db.promptTemplates.get(builtIn.id!))?.isActive).toBe(false)
    }
  })

  it('一个材料槽即可装配，缺原文阻断修稿，空白构思不强迫补完设定', async () => {
    for (const seed of CRAFT_PROMPT_SEEDS) {
      const template = { ...seed, createdAt: 1, updatedAt: 1 }
      const referenced = [...new Set([...`${seed.systemPrompt}\n${seed.userPromptTemplate}`
        .matchAll(/{{#?(?:if )?([A-Za-z0-9_.-]+)}}/g)].map(match => match[1]))]
      expect(new Set(referenced), seed.name).toEqual(new Set(seed.variables))
      const ready = await assembleBoundPrompt({ template, manualValues: { text: '沈宁没有签字；船票是三张。' } })
      expect(ready.missingScopes, seed.name).toEqual([])
      expect(ready.missingVariables, seed.name).toEqual([])
      const rendered = ready.messages.map(message => message.content).join('\n')
      expect(rendered).not.toContain('{{')
      expect(rendered.match(/沈宁没有签字；船票是三张。/g)).toHaveLength(1)
      const missing = await assembleBoundPrompt({ template })
      expect(missing.missingVariables.length, seed.name).toBe(seed.assetId === 'CRAFT-IDEA' ? 0 : 1)
    }
    const start = await assembleBoundPrompt({ template: asTemplate('IDEA'), userHint: '只写温暖日常' })
    expect(start.missingVariables).toEqual([])
    expect(start.messages.at(-1)?.content).toContain('只写温暖日常')
  })

  it('工作流显式上游材料满足必填项，不依赖未读取的作品字段', async () => {
    const bound = await assembleBoundPrompt({
      template: asTemplate('DRAFT'), workflowValues: { text: '在渡口拒绝签字，到船离岸即停。' },
      userHint: '第一人称，不能出现追兵。',
    })
    expect(bound.missingVariables).toEqual([])
    expect(bound.missingScopes).toEqual([])
    expect(bound.messages.at(-1)?.content).toContain('在渡口拒绝签字，到船离岸即停。')
    expect(bound.messages.at(-1)?.content).toContain('第一人称，不能出现追兵。')
    const unrelated = await assembleBoundPrompt({ template: asTemplate('DRAFT'), workflowValues: { unrelated: '不是本节点材料' } })
    expect(unrelated.missingVariables).toHaveLength(1)
  })

  it('四个去 AI 味模板能从真实正文 adapter 运行，不丢原文或留下未填占位符', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editors = CRAFT_PROMPT_SEEDS.filter(seed => seed.moduleKey === 'chapter.de-ai')
    expect(editors).toHaveLength(4)
    for (const seed of editors) {
      usePromptStore.setState({ templates: [{ ...seed, id: 1, isActive: true, createdAt: 1, updatedAt: 1 }] })
      const messages = buildDeAIPrompt('她没有交出三枚旧币。门还关着。')
      expect(messages.at(-1)?.content).toContain('她没有交出三枚旧币。门还关着。')
      expect(messages.map(message => message.content).join('\n')).not.toContain('{{')
    }
    expect(warn).not.toHaveBeenCalled()
  })
})
