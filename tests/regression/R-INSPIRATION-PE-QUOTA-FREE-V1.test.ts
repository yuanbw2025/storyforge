import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareInspirationCopilot } from '../../src/lib/agent/inspiration-copilot'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { requireFixedBudgetValueV1 } from '../../src/lib/agent/finite-budget'
import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const inspirationJson = JSON.stringify({
  summary: '潮汐钟与守灯人的记忆', authorMaterial: [], proposals: [], openQuestions: [],
})

async function seed() {
  const created = await seedCurrentWorkspace('灵感准备配额')
  const now = Date.now()
  await db.inspirationWorkspaces.add({
    projectId: created.project.id!,
    fragments: JSON.stringify([{
      id: 'idea-selected', text: '旧城每次下雨都会忘记一个人', label: '城市规则',
      sourceKind: 'author', createdAt: now,
    }]),
    versions: '[]', createdAt: now, updatedAt: now,
  } as never)
  await finalizeCurrentFixtureV1(created.project.id!)
  return created
}

describe('B20a 第六片 · 灵感准备 promptExecution 路径不再伪造 6k 派发上限', () => {
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

  it('模板未设输出上限时，派发不带 maxTokens 且不伪造 effectiveMaxTokens', async () => {
    const { project, scope } = await seed()
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return inspirationJson
    })
    const prepared = await prepareInspirationCopilot({
      projectId: project.id!, scope, worldGroupId: null,
      authorRequest: '整理当前灵感碎片为准备候选', mode: 'organize',
      selectedFragmentIds: ['idea-selected'],
    })
    // 解析合同不在本片范围：只要派发已完成即可断言 wire 与冻结覆盖。
    await prepared.node.run(prepared.prepared.messages).catch(() => {})
    expect(seenMeta.length).toBeGreaterThanOrEqual(1)
    // 旧实现在模板无输出上限时伪造 maxTokens: 6000 写入 generationOverrides，
    // 再经派发 configOverrides 成为应用配额。现在无显式覆盖即不注入。
    for (const meta of seenMeta) {
      expect(meta.configOverrides?.maxTokens).toBeUndefined()
    }
    expect(prepared.promptExecutionEvidence?.effectiveMaxTokens ?? null).toBeNull()
    // Skill 登记治理上限仍为 8_000，仅用于钳制作者自己的模板覆盖。
    expect(requireFixedBudgetValueV1(getAgentSkillV1('inspiration.prepare').maxOutputTokens)).toBe(8_000)
  })
})
