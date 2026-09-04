import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMasterAgentPlan,
  type PinnedMasterAgentTaskV1,
} from '../../src/lib/agent/orchestrator'
import {
  parseMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('R-HARNESS34 · 灵感反推主入口契约', () => {
  const originalConfig = useAIConfigStore.getState().config

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({
      config: {
        ...originalConfig,
        provider: 'custom',
        apiKey: '',
        model: 'harness34-test',
        baseUrl: 'https://harness34.invalid/v1',
        maxTokens: 8_000,
        contextWindow: 64_000,
      },
      presets: [],
      taskRoutes: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ config: originalConfig, presets: [], taskRoutes: {} })
    db.close()
  })

  it('定向灵感入口跳过重复规划，并把作者选择的碎片冻结进计划', async () => {
    const pinnedTask: PinnedMasterAgentTaskV1 = {
      agentId: 'inspiration',
      skillId: 'inspiration.reverse',
      instruction: '基于作者选择的灵感碎片生成结构化灵感反推候选。',
      inspirationFragmentIds: ['idea-visible', 'idea-secondary', 'idea-visible'],
    }
    const plan = await createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: pinnedTask.instruction,
      pinnedTask,
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]).toMatchObject({
      agentId: 'inspiration',
      skillId: 'inspiration.reverse',
      inspirationFragmentIds: ['idea-visible', 'idea-secondary'],
    })
    expect(parseMasterAgentPlanV1(plan).tasks[0].inspirationFragmentIds)
      .toEqual(['idea-visible', 'idea-secondary'])
  })

  it('禁止把固定灵感碎片字段挂到其它领域任务', async () => {
    await expect(createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: '创建一个角色',
      pinnedTask: {
        agentId: 'character',
        skillId: 'character.create',
        instruction: '创建一个角色',
        inspirationFragmentIds: ['should-fail'],
      },
    })).rejects.toThrow('只有灵感领域任务')
  })

  it('定向 durable 执行只读取冻结的碎片，确认前不写入灵感版本', async () => {
    const now = Date.now()
    const createdWorkspaceV1 = await seedCurrentWorkspace('灵感入口项目')
    const scope: WorkspaceScope = createdWorkspaceV1.scope
    const { projectId, worldId, workId } = scope
    const worldGroupId = await db.worldGroups.add({
      projectId,
      worldId,
      name: '主世界',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.inspirationWorkspaces.add({
      projectId,
      worldId,
      workId,
      fragments: JSON.stringify([
        {
          id: 'selected',
          text: '旧城每次下雨都会忘记一个人',
          label: '已选',
          sourceKind: 'author',
          createdAt: now,
        },
        {
          id: 'hidden',
          text: '不应进入本轮上下文的秘密',
          label: '未选',
          sourceKind: 'author',
          createdAt: now + 1,
        },
      ]),
      versions: '[]',
      createdAt: now,
      updatedAt: now,
    } as any)
    const conversation = await getOrCreateAgentConversation({
      purpose: 'test:r-harness34-inspiration-entry:1',
      projectId,
      worldGroupId,
      scope,
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ content?: string }>
      }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      expect(prompt).toContain('旧城每次下雨都会忘记一个人')
      expect(prompt).not.toContain('不应进入本轮上下文的秘密')
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              worldview: {
                worldOrigin: '由遗忘诞生的旧城',
                powerHierarchy: '记忆税决定城市权力',
                continentLayout: '旧城坐落在终年雨幕的盆地',
                climateByRegion: '中心城区常年降雨',
                races: '居民皆为普通人类',
                factionLayout: '守塔人与档案官分掌钟塔和名册',
              },
              history: { overview: '失忆雨自旧钟塔建成后开始。' },
              storyCore: {
                logline: '守塔人追查失踪者',
                theme: '记忆与身份',
                centralConflict: '守塔人必须在停止雨与保存城市之间选择',
                plotPattern: '调查—揭露—抉择',
                mainPlot: '追查失忆雨并找到被抹去的人',
              },
              characters: [],
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '按选中碎片反推',
        tasks: [{
          id: 'inspiration-targeted',
          agentId: 'inspiration',
          skillId: 'inspiration.reverse',
          instruction: '反推选中的灵感碎片',
          dependsOn: [],
          inspirationFragmentIds: ['selected'],
        }],
        workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] },
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.candidates[0].payload.selectedFragmentIds).toEqual(['selected'])
    const workspace = (await db.inspirationWorkspaces.toArray())[0]
    expect(JSON.parse(workspace.versions)).toEqual([])
  })
})
