import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareStoryArcCopilot,
  runStoryArcCreativeReliabilityV1,
} from '../../src/lib/agent/story-arc-copilot'
import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { AIConfig, Project, WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const config: AIConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'story-arc-quota-test',
  temperature: 0.55,
  maxTokens: 0,
  contextWindow: 128_000,
}

const arcJson = JSON.stringify({ storyArcs: [{
  name: '潮汐钟主线', type: 'main',
  description: '守灯人决定是否敲响潮汐钟。',
  stages: [{ title: '起', description: '退潮见城', keyEvents: ['看见浮空城'] }],
}] })

async function seedWorkspace(): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const { project, scope } = await seedCurrentWorkspace('故事线配额')
  await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId: project.id!,
    worldOrigin: '盐海每十年退潮一次。',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never)
  await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId: project.id!,
    theme: '记忆与责任',
    centralConflict: '守灯人必须决定是否敲响潮汐钟。',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never)
  return { project, scope }
}

describe('B20a · 故事线编排派发不再带固定 10k 输出配额', () => {
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

  it('无作者上限时派发不带 maxTokens 覆盖，按连接能力自动取值', async () => {
    const { project, scope } = await seedWorkspace()
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return arcJson
    })
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      kind: 'main',
      mutation: { operation: 'create' },
      authorRequest: '编排主线故事线',
      config,
    })
    await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })
    // 旧实现在这条故事线派发上注入固定 maxTokens: 10_000；无作者上限时
    // 长故事线候选被应用配额截断。新实现按连接配置执行（作者显式上限或
    // 容量自动）；团队预算预留仍是会计预测。初始与可能的定向修复派发
    // 走同一 runRaw，均不得带固定配额。
    expect(seenMeta.length).toBeGreaterThanOrEqual(1)
    for (const meta of seenMeta) {
      expect(meta.configOverrides?.maxTokens).toBeUndefined()
    }
  })

  it('作者显式上限仍进入派发；预算预留保持 10k 会计参考', async () => {
    const { project, scope } = await seedWorkspace()
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return arcJson
    })
    const budget = new AgentTeamBudgetTracker('balanced')
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      kind: 'main',
      mutation: { operation: 'create' },
      authorRequest: '编排主线故事线',
      config,
      generationOverrides: { maxTokens: 15_000 },
    })
    await runStoryArcCreativeReliabilityV1({
      prepared,
      budget,
      qualityMode: 'balanced',
    })
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBe(15_000)
    // 预留按显式上限预测；无显式上限时 runStoryArcCreativeReliabilityV1
    // 的 10k 参考仅作为会计数字，不再是派发配额。
    expect(budget.snapshot().usedTokens).toBeGreaterThan(0)
  })
})
