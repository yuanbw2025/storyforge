import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCharacterCopilotNode } from '../../src/lib/agent/character-copilot'
import { createCharacterDrivenCopilotNodeV1 } from '../../src/lib/agent/character-driven-copilot'
import { createCharacterRevisionCopilotNodeV1 } from '../../src/lib/agent/character-revision-copilot'
import { createCharacterSupplementCopilotNodeV1 } from '../../src/lib/agent/character-supplement-copilot'
import { createCreativeRulesCopilotNodeV1 } from '../../src/lib/agent/creative-rules-copilot'
import { createStorylineProgressCopilotNodeV1 } from '../../src/lib/agent/storyline-progress-copilot'
import { chat } from '../../src/lib/ai/client'
import type { AIConfig } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const config: AIConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'b20a-quota-test',
  temperature: 0.4,
  maxTokens: 0,
  contextWindow: 128_000,
}

const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []

function recordMeta(meta: unknown) {
  seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
}

describe('B20a 第二片 · 角色/规则/进度/灵感派发不再带固定输出配额', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    seenMeta.length = 0
    await db.delete()
    await db.open()
    resetModelCapacityForTestsV1()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ presets: [], taskRoutes: {} })
    db.close()
  })

  it('character-copilot 无作者上限时派发不带 6k 固定配额；显式上限仍进入派发', async () => {
    const { CHARACTER_DIMENSIONS } = await import('../../src/lib/character/character-dimensions')
    const candidate = {
      name: '沈灯',
      roleWeight: 'secondary',
      moralAxis: 'good',
      orderAxis: 'lawful',
      relationships: '曾受主角搭救。',
      ...Object.fromEntries(CHARACTER_DIMENSIONS.map((dimension: { key: string }) => [dimension.key, ''])),
      shortDescription: '守护旧港灯塔的年轻钟匠。',
      personality: '克制谨慎。',
      background: '钟匠世家。',
      motivation: '修复潮汐钟。',
    }
    const payload = JSON.stringify(candidate)
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      recordMeta(meta)
      return payload
    })
    const baseInput = {
      projectId: 73120,
      scope: undefined,
      worldGroupId: null,
      authorRequest: '设计一个守灯人主角',
      config,
      snapshot: { serialized: 'x', visibleNames: [] },
      worldContext: '',
      characterContext: '',
      genres: [],
    } as never
    const node = createCharacterCopilotNode(baseInput)
    await node.run([{ role: 'user', content: '生成' }])
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBeUndefined()
    seenMeta.length = 0
    const nodeExplicit = createCharacterCopilotNode({ ...baseInput, generationOverrides: { maxTokens: 9_000 } } as never)
    await nodeExplicit.run([{ role: 'user', content: '生成' }])
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBe(9_000)
  })

  it('character-driven/revision/supplement 派发不带 12k/12k/8k 固定配额', async () => {
    const payload = JSON.stringify({ summary: '', proposals: [], assumptions: [] })
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      recordMeta(meta)
      return payload
    })
    const driven = createCharacterDrivenCopilotNodeV1({
      projectId: 73120, scope: undefined, worldGroupId: null,
      authorRequest: '编排卷章', planId: 1, config,
      snapshot: { serialized: 'x', volumes: [] },
    } as never)
    await driven.run([{ role: 'user', content: '编排' }]).catch(() => {})
    const revision = createCharacterRevisionCopilotNodeV1({
      projectId: 73120, scope: undefined, worldGroupId: null,
      authorRequest: '中途重规划', config,
      snapshot: { serialized: 'x', revision: 1, request: {} },
    } as never)
    await revision.run([{ role: 'user', content: '重规划' }]).catch(() => {})
    const supplement = createCharacterSupplementCopilotNodeV1({
      projectId: 73120, scope: undefined, worldGroupId: null,
      authorRequest: '补全角色', config,
      snapshot: { serialized: 'x', request: { characterId: 1, dimensions: [], useEvidence: false } },
    } as never)
    await supplement.run([{ role: 'user', content: '补全' }]).catch(() => {})
    for (const meta of seenMeta) {
      expect(meta.configOverrides?.maxTokens).toBeUndefined()
    }
    expect(seenMeta.length).toBe(3)
  })

  it('creative-rules/storyline-progress/inspiration 派发不带 4k/8k/6k 固定配额', async () => {
    const payload = JSON.stringify({ summary: '', assumptions: [] })
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      recordMeta(meta)
      return payload
    })
    const rules = createCreativeRulesCopilotNodeV1({
      projectId: 73120, scope: undefined,
      authorRequest: '补全创作规则', config, targetField: 'magicRules',
      snapshot: { serialized: 'x' }, routingCategory: 'world-origin.creative-rules',
    } as never)
    await rules.run([{ role: 'user', content: '补全' }]).catch(() => {})
    const progress = createStorylineProgressCopilotNodeV1({
      projectId: 73120, scope: undefined, worldGroupId: null,
      chapterId: 1, config,
      snapshot: { serialized: 'x', chapterContentHash: 'hash', chapterWordCount: 10 },
    } as never)
    await progress.run([{ role: 'user', content: '映射' }]).catch(() => {})
    const inspirationNode = await import('../../src/lib/agent/inspiration-copilot').then(mod => mod.createInspirationCopilotNode({
      projectId: 73120, scope: undefined, worldGroupId: null,
      authorRequest: '反推灵感', config,
      snapshot: { updatedAt: 1 }, mode: 'single',
    } as never))
    await inspirationNode.run([{ role: 'user', content: '反推' }]).catch(() => {})
    for (const meta of seenMeta) {
      expect(meta.configOverrides?.maxTokens).toBeUndefined()
    }
    expect(seenMeta.length).toBe(3)
  })
})
