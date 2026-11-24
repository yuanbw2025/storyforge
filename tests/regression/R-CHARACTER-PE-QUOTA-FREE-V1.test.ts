import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareCharacterCopilot } from '../../src/lib/agent/character-copilot'
import { chat } from '../../src/lib/ai/client'
import { freezePromptExecutionOptionsV1 } from '../../src/lib/agent/prompt-execution'
import { db } from '../../src/lib/db/schema'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const priorConfig = useAIConfigStore.getState(), priorPrompts = usePromptStore.getState()

describe('B20a · 角色 promptExecution 路径不再伪造 6k 派发上限', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete()
    await db.open()
    resetModelCapacityForTestsV1()
    usePromptStore.setState({
      templates: CORE_PROMPT_SEEDS.filter(seed => seed.moduleKey === 'character.generate')
        .map((seed, index) => ({ ...seed, id: 900 + index, createdAt: 1, updatedAt: 1, isActive: true })),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState(priorConfig, true)
    usePromptStore.setState(priorPrompts, true)
    db.close()
  })

  it('模板未设输出上限时：派发不带 maxTokens，证据如实为 null；显式上限仍生效', async () => {
    const { project, scope } = await seedCurrentWorkspace('角色配额')
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return JSON.stringify({ name: '沈灯', roleWeight: 'secondary', moralAxis: 'good', orderAxis: 'lawful' })
    })
    const template = usePromptStore.getState().getActive('character.generate')
    const promptExecution = await freezePromptExecutionOptionsV1({
      request: { version: 1, moduleKey: 'character.generate' }, template,
    })
    const prepared = await prepareCharacterCopilot({
      projectId: project.id!, scope, worldGroupId: null,
      authorRequest: '设计一名守灯钟匠',
      promptExecution,
    })
    expect(prepared.input.generationOverrides?.maxTokens).toBeUndefined()
    expect(prepared.promptExecutionEvidence?.effectiveMaxTokens ?? null).toBeNull()
    // 冻结帧渲染与记录仍完整（不因去掉默认额度而丢失模板/上下文证据）。
    expect(prepared.prepared.messages.length).toBeGreaterThan(0)

    seenMeta.length = 0
    const explicit = await prepareCharacterCopilot({
      projectId: project.id!, scope, worldGroupId: null,
      authorRequest: '设计一名守灯钟匠',
      promptExecution,
      generationOverrides: { maxTokens: 5_000 },
    })
    expect(explicit.input.generationOverrides?.maxTokens).toBe(5_000)
  })
})
