import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { usePromptStore } from '../../src/stores/prompt'

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
    }
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
