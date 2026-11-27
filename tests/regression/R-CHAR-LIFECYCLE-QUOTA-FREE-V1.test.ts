import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareCharacterLifecycleCopilotV1 } from '../../src/lib/agent/character-lifecycle-copilot'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { requireFixedBudgetValueV1 } from '../../src/lib/agent/finite-budget'
import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const now = 1_920_000_000_000

const candidate = (characterId: number) => ({
  version: 1,
  characterId,
  fromStatus: 'active',
  targetStatus: 'inactive',
  reason: '青禾在封闭潮门后昏迷，暂时无法继续承担守门职责。',
  ending: '',
  activeChapterRange: '第1章以前',
})

async function seed() {
  const { project, scope } = await seedCurrentWorkspace('角色状态配额')
  const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId: project.id!, homeWorldGroupId: null, isCrossWorld: false, name: '青禾',
    roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', shortDescription: '潮门守人',
    appearance: '', personality: '', background: '幼年目睹旧港沉没。', motivation: '阻止潮灾重演。',
    abilities: '能听懂潮声。', relationships: '', arc: '', goals: '', narrativeStatus: 'active',
    createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: project.id!, worldGroupId: null, parentId: null, type: 'chapter', title: '潮门断响',
    summary: '青禾为封闭潮门而受伤。', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: project.id!, outlineNodeId, title: '潮门断响',
    content: '<p>青禾封住潮门后昏迷，无法继续守门。</p>',
    wordCount: 21, status: 'final', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  return { project, scope, characterId, chapterId }
}

describe('B20a 第四片 · 角色状态演化派发不再带固定 4k 配额', () => {
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

  it('wire 派发不带 maxTokens；Skill 登记的 4k 仍只作团队预算预留预测', async () => {
    const { project, scope, characterId, chapterId } = await seed()
    const seenMeta: { configOverrides?: { maxTokens?: number; temperature?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number; temperature?: number } })
      return JSON.stringify(candidate(characterId))
    })
    const prepared = await prepareCharacterLifecycleCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      request: { characterId, targetStatus: 'inactive', evidenceChapterId: chapterId, evidenceStoryArcId: null },
      authorRequest: '让青禾依据第一章事件暂离。',
    })
    await prepared.node.run(prepared.prepared.messages)
    expect(seenMeta).toHaveLength(1)
    // 旧实现在这条派发上注入固定 maxTokens: 4_000。新实现按连接已核实
    // 容量执行，无应用配额；温度约束保持不变。
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBeUndefined()
    expect(seenMeta[0]!.configOverrides?.temperature).toBe(0.3)
    // 预算预留仍取 Skill 登记值（会计口径），orchestrator 由此预留，
    // 不因派发去配额而失去真实预算门。
    expect(requireFixedBudgetValueV1(getAgentSkillV1('character.lifecycle').maxOutputTokens)).toBe(4_000)
  })
})
