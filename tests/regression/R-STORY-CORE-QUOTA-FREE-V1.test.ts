import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatStoryCoreGenerationRequestV1,
  prepareStoryCoreCopilot,
  type StoryCoreCopilotCandidate,
} from '../../src/lib/agent/story-core-copilot'
import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const candidate = (value = '守灯人为救父亲的记忆追查无主盐晶。'): StoryCoreCopilotCandidate =>
  ({ field: 'logline', value })

async function seedWorkspace() {
  const now = Date.now()
  const { project, scope } = await seedCurrentWorkspace('故事核心配额')
  await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId: project.id!,
    worldOrigin: '镜海退潮时，城民被典当的记忆会凝成盐晶。',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never)
  await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId: project.id!,
    logline: '守灯人追查一枚不属于任何人的记忆盐晶。',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never)
  return { project, scope }
}

describe('B20a 第三片 · 故事核心派发不再把容量导出值当显式配额', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete()
    await db.open()
    resetModelCapacityForTestsV1()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ presets: [], taskRoutes: {} })
    db.close()
  })

  it('无作者上限时派发不带 maxTokens 覆盖；上下文装配预算仍按容量证据执行', async () => {
    const { project, scope } = await seedWorkspace()
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return JSON.stringify(candidate())
    })
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatStoryCoreGenerationRequestV1({ field: 'logline', mode: 'expand', hint: '强化代价' }),
    })
    await runGenerationNode(prepared.node, prepared.prepared)
    expect(seenMeta.length).toBeGreaterThanOrEqual(1)
    // 旧实现把 modelInputBudgetV1(...).outputBudget（容量导出值，非作者
    // 上限）作为显式 maxTokens 注入每次派发；长字段候选被该派生值截断。
    // 新实现无作者上限时不注入，由连接已核实容量决定；上下文输入预算
    // （capacityBudget.inputBudget）保持容量证据口径不变。
    for (const meta of seenMeta) {
      expect(meta.configOverrides?.maxTokens).toBeUndefined()
    }
    expect(prepared.contextSources.length).toBeGreaterThan(0)
    // 会计预测保留：无作者上限时 = 容量导出 outputBudget（与旧 Run 预留数
    // 值一致），保证真实预算门与旧 Run 恢复核算不变。
    expect(prepared.outputForecastTokens).toBeGreaterThan(0)
  })

  it('作者显式上限仍进入派发', async () => {
    const { project, scope } = await seedWorkspace()
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return JSON.stringify(candidate())
    })
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatStoryCoreGenerationRequestV1({ field: 'logline', mode: 'expand', hint: '强化代价' }),
      generationOverrides: { maxTokens: 7_000 },
    })
    await runGenerationNode(prepared.node, prepared.prepared)
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBe(7_000)
    // 作者显式上限优先于容量导出值，会计与派发一致。
    expect(prepared.outputForecastTokens).toBe(7_000)
  })
})
