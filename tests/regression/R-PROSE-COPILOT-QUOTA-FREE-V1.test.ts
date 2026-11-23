import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareProseCopilot,
  proseOutputForecastTokensV1,
  runProseCreativeReliabilityV1,
} from '../../src/lib/agent/prose-copilot'
import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const draft = '守灯人推开木门，决定沿海堤寻找铜铃，并在风里读出旧誓言的下半句。'.repeat(8)

async function seedChapter() {
  const created = await seedCurrentWorkspace('副驾配额')
  const scope = created.scope
  const now = Date.now()
  const volumeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    parentId: null, type: 'volume', title: '第一卷', summary: '守灯人寻找潮汐钟。',
    order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  const _chapterId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    parentId: volumeId, type: 'chapter', title: '第一章：海床之光',
    summary: '退潮后守灯人第一次看见浮空城影子。', order: 0, worldGroupId: null,
    createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  return { project: created.project }
}

describe('B03 副驾 · 正文调用不再带固定 16k 输出配额', () => {
  beforeEach(async () => {
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
    const { project } = await seedChapter()
    const seenMeta: unknown[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta)
      return draft
    })
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    })
    expect(prepared.input.generationOverrides?.maxTokens).toBeUndefined()
    await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })
    expect(chat).toHaveBeenCalledOnce()
    const overrides = (seenMeta[0] as { configOverrides?: { maxTokens?: number } }).configOverrides
    expect(overrides?.maxTokens).toBeUndefined()
  })

  it('作者显式上限与显式字数意图仍进入派发和预算预留', async () => {
    const { project } = await seedChapter()
    const seenMeta: unknown[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta)
      return draft
    })
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文，本章请写约3000字',
      generationOverrides: { maxTokens: 9_000 },
    })
    expect(prepared.input.generationOverrides?.maxTokens).toBe(9_000)
    await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })
    const overrides = (seenMeta[0] as { configOverrides?: { maxTokens?: number } }).configOverrides
    expect(overrides?.maxTokens).toBe(9_000)
  })

  it('输出预算预留按作者意图推导，不再固定 16k', () => {
    // 显式作者上限优先。
    expect(proseOutputForecastTokensV1({ generationOverrides: { maxTokens: 12_000 }, authorRequest: '写一章', parameterValues: null })).toBe(12_000)
    // 显式字数范围：3000～5000 字 → 上限 5000 字 ≈ 7,500 tokens。
    expect(proseOutputForecastTokensV1({ authorRequest: '写第一章，字数3000～5000字', parameterValues: null })).toBe(7_500)
    // 参数目标：约 4000 字 → 4800 字（20% 容差）≈ 7,200 tokens。
    expect(proseOutputForecastTokensV1({ authorRequest: '写第一章正文', parameterValues: { wordCount: 4_000 } })).toBe(7_200)
    // 无任何意图：自动单章参考 ≈ 6,000 tokens，低于旧 16k 预留。
    expect(proseOutputForecastTokensV1({ authorRequest: '写第一章正文', parameterValues: null })).toBe(6_000)
  })
})
