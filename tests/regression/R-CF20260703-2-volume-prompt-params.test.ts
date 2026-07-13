import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { buildVolumeOutlinePrompt } from '../../src/lib/ai/adapters/outline-adapter'
import { usePromptStore } from '../../src/stores/prompt'
import type { PromptTemplate } from '../../src/lib/types'

const ADAPTER_VOLUME_VARIABLES = new Set([
  'projectName',
  'genres',
  'targetWordCount',
  'estimatedVolumes',
  'worldContext',
  'storyCore',
  'characterContext',
  'worldRulesContext',
  'existingVolumesContext',
  'existingVolumeCount',
  'userHint',
])

describe('CF-20260703-2 · 题材包卷级大纲参数与变量契约', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })

  afterEach(() => {
    db.close()
  })

  it('所有系统 outline.volume 模板都声明 pace 与 volumeCount 参数，避免调参面板消失', () => {
    const volumeSeeds = SYSTEM_PROMPT_SEEDS.filter(seed => seed.scope === 'system' && seed.moduleKey === 'outline.volume')
    expect(volumeSeeds.length).toBeGreaterThan(1)

    for (const seed of volumeSeeds) {
      const keys = (seed.parameters ?? []).map(param => param.key)
      expect(keys, `${seed.name} 缺少 pace 参数`).toContain('pace')
      expect(keys, `${seed.name} 缺少 volumeCount 参数`).toContain('volumeCount')
    }
  })

  it('所有系统 outline.volume 模板变量都来自 buildVolumeOutlinePrompt 实际传入字段', () => {
    const volumeSeeds = SYSTEM_PROMPT_SEEDS.filter(seed => seed.scope === 'system' && seed.moduleKey === 'outline.volume')

    for (const seed of volumeSeeds) {
      const unknown = seed.variables.filter(variable => !ADAPTER_VOLUME_VARIABLES.has(variable))
      expect(unknown, `${seed.name} 引用了 adapter 不传的变量`).toEqual([])
    }
  })

  it('激活题材包卷纲模板后，volumeCount 与 pace 都进入最终 prompt', () => {
    const seed = SYSTEM_PROMPT_SEEDS.find(item => item.name === '玄幻包-卷级大纲')
    expect(seed).toBeTruthy()
    usePromptStore.setState({
      loaded: true,
      templates: [{ ...(seed as PromptTemplate), id: 1, createdAt: 1, updatedAt: 1, isActive: true }],
    })

    const messages = buildVolumeOutlinePrompt(
      '题材包测试',
      '玄幻',
      '【世界观】九州修行',
      '【故事核心】主角寻找失落天书',
      1_000_000,
      '',
      { parameterValues: { volumeCount: 30, pace: '快' } },
      '【角色】林澈',
      '【真实与幻想】无',
    )
    const full = messages.map(message => message.content).join('\n\n')

    expect(full).toContain('建议卷数：约 30 卷')
    expect(full).toContain('最终总卷数为 30 卷')
    expect(full).toContain('整体节奏为「快」')
    expect(full).toContain('【角色】林澈')
    expect(full).not.toContain('{{storySeed}}')
    expect(full).not.toContain('{{protagonist}}')
    expect(full).not.toContain('{{totalChapters}}')
  })
})
