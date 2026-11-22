import { seedModelAllocationFixtureV1 } from '../helpers/model-capacity-fixture'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import {
  adoptMasterCandidate,
  createMasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import { db } from '../../src/lib/db/schema'
import type { AIConfigPreset, Project } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'

const project: Project = {
  id: 73001,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000073001',
  workspacePurpose: 'independent-work',
  name: '主 Agent 测试',
  enableMultiWorld: false,
  activeWorldId: 73001,
  activeWorkId: 73001,
  createdAt: 1,
  updatedAt: 1,
}

describe('AGENT-2 · 主 Agent 编排与持久会话', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await putCurrentWorkspaceFixtureV1(project)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ presets: [], taskRoutes: {} })
    db.close()
  })

  it('主 Agent 把一个用户目标拆成有依赖的幕后领域任务', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界，并设计一个守灯人主角',
    }, {
      complete: async () => JSON.stringify({
        summary: '先设定世界，再创建角色。',
        tasks: [
          {
            id: 'world',
            agentId: 'world-origin',
            instruction: '建立潮汐世界',
            dependsOn: [],
          },
          {
            id: 'hero',
            agentId: 'character',
            instruction: '设计守灯人主角',
            dependsOn: ['world', 'missing', 'hero'],
          },
          {
            id: 'ignored',
            agentId: 'unknown-domain',
            instruction: '不应进入计划',
            dependsOn: [],
          },
        ],
      }),
    })
    expect(plan.summary).toBe('先设定世界，再创建角色。')
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[1]).toMatchObject({
      id: 'hero',
      agentId: 'character',
      dependsOn: ['world'],
    })
  })

  it('模型规划保留超过五个任务、六条依赖及完整长要求，同时保留授权过滤', async () => {
    const tail = '末尾硬约束：守灯人永远不能拥有魔法。'
    const request = `建立潮汐世界，并设计一个守灯人主角。${'参考材料。'.repeat(1_700)}${tail}`
    const instruction = `补充世界起源。${'具体约束。'.repeat(1_700)}${tail}`
    const summary = `${'说明各项任务的实际依赖。'.repeat(80)}计划尾部也必须保留。`
    const upstreamIds = Array.from({ length: 6 }, (_, index) => `world-${index + 1}`)
    const complete = vi.fn(async () => JSON.stringify({
      summary,
      tasks: [
        ...upstreamIds.map(id => ({ id, agentId: 'world-origin', instruction, dependsOn: [] })),
        { id: 'hero', agentId: 'character', instruction: `设计守灯人主角。${instruction}`, dependsOn: [...upstreamIds, 'missing', 'hero'] },
        { id: 'unrequested', agentId: 'outline', instruction: '规划卷纲', dependsOn: [] },
        { id: 'unknown', agentId: 'unknown-domain', instruction: '越权任务', dependsOn: [] },
        { id: 'world-1', agentId: 'world-origin', instruction: '重复 ID 不得覆盖原任务', dependsOn: [] },
      ],
    }))
    const result = await createMasterAgentPlan({ projectId: project.id!, worldGroupId: null, request }, { complete })

    expect(complete).toHaveBeenCalledOnce()
    expect(result.tasks.map(task => task.id)).toEqual([...upstreamIds, 'hero'])
    expect(result.summary).toBe('已按你的要求只保留本轮明确要做的任务，请确认下方计划。')
    expect(result.tasks[0].instruction).toBe(instruction)
    expect(result.tasks[6].dependsOn).toEqual(upstreamIds)
    expect(result.tasks.every(task => task.requestContext?.originalRequest === request)).toBe(true)
    expect(result.tasks[0].requestContext?.plannerInstruction).toBe(instruction)
    expect(result.tasks[6].instruction).toBe(`设计守灯人主角。${instruction}`)
    expect(result.workflow?.workflowId).toBe('staged-author-confirmed')
  })

  it('完全授权的计划保留长摘要及尾部，不应用旧500字符裁剪', async () => {
    const summary = `${'说明各项任务的实际依赖。'.repeat(80)}计划尾部也必须保留。`
    expect(summary.length).toBeGreaterThan(500)
    const complete = vi.fn(async () => JSON.stringify({
      summary,
      tasks: [
        { id: 'world-1', agentId: 'world-origin', instruction: '补充世界起源。', dependsOn: [] },
        { id: 'hero', agentId: 'character', instruction: '设计守灯人主角。', dependsOn: ['world-1'] },
      ],
    }))
    const result = await createMasterAgentPlan({
      projectId: project.id!, worldGroupId: null, request: '建立潮汐世界，并设计一个守灯人主角。',
    }, { complete })
    expect(complete).toHaveBeenCalledOnce()
    expect(result.tasks.map(task => task.id)).toEqual(['world-1', 'hero'])
    expect(result.summary).toBe(summary)
  })

  it('固定的非故事核心任务保留长指令，错误领域与 Skill 绑定仍在执行前拒绝', async () => {
    const instruction = `设计守灯人主角。${'人物细节。'.repeat(1_700)}末尾要求：不得改名。`
    const complete = vi.fn(async () => JSON.stringify({ tasks: [] }))
    const result = await createMasterAgentPlan({
      projectId: project.id!, worldGroupId: null, request: '设计一个守灯人主角',
      pinnedTask: { agentId: 'character', skillId: 'character.create', instruction },
    }, { complete })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].instruction).toBe(instruction)
    await expect(createMasterAgentPlan({
      projectId: project.id!, worldGroupId: null, request: '设计一个守灯人主角',
      pinnedTask: { agentId: 'character', skillId: 'outline.volumes', instruction },
    }, { complete })).rejects.toThrow()
    expect(complete).not.toHaveBeenCalled()
  })

  it('主 Agent 编排使用独立模型预设并记录实际路由', async () => {
    const globalConfig = {
      ...useAIConfigStore.getState().config,
      provider: 'deepseek' as const,
      apiKey: 'global-key',
      model: 'global-model',
      baseUrl: 'https://global.example/v1',
    }
    const plannerPreset: AIConfigPreset = {
      id: 'planner-role',
      name: '主 Agent 规划',
      config: {
        ...globalConfig,
        provider: 'ollama',
        apiKey: '',
        model: 'planner-local',
        baseUrl: 'http://localhost:11434/v1',
        contextWindow: 131_072,
      },
    }
    useAIConfigStore.setState({
      config: globalConfig,
      presets: [plannerPreset],
      taskRoutes: { 'agent-orchestrator': plannerPreset.id },
    })
    resetModelCapacityForTestsV1()
    await seedModelAllocationFixtureV1(plannerPreset.config, 131_072)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      expect(JSON.parse(String(init?.body)).model).toBe('planner-local')
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: '先建立世界，再规划角色。',
              tasks: [
                { id: 'world', agentId: 'world-origin', instruction: '建立潮汐世界', dependsOn: [] },
                { id: 'hero', agentId: 'character', instruction: '设计守灯人', dependsOn: ['world'] },
              ],
            }),
          },
        }],
        usage: { prompt_tokens: 19, completion_tokens: 11, total_tokens: 30 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界并设计一个守灯人角色',
    })

    expect(plan.tasks.map(task => task.agentId)).toEqual(['world-origin', 'character'])
    expect(plan.workflow?.workflowId).toBe('multi-domain-sequential')
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.waitFor(async () => {
      expect(await db.aiUsageLog.toCollection().last()).toMatchObject({
        category: 'agent.orchestrator',
        provider: 'ollama',
        model: 'planner-local',
        taskKind: 'agent-orchestrator',
      })
    })
  })

  it('规划模型失败时仍按用户目标做确定性领域路由', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '补充世界起源并设计主角',
    }, {
      complete: async () => { throw new Error('planner unavailable') },
    })
    expect(plan.tasks.map(task => task.agentId)).toEqual(['world-origin', 'character'])
    expect(plan.tasks[1].dependsOn).toEqual(['world-1'])
  })

  it('确定性降级会把大纲放在本轮世界与角色候选之后', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界，设计守灯人主角，再规划全书卷纲',
    }, {
      complete: async () => { throw new Error('planner unavailable') },
    })
    expect(plan.tasks.map(task => task.agentId)).toEqual(['world-origin', 'character', 'outline'])
    expect(plan.tasks[2].dependsOn).toEqual(['world-1', 'character-1'])
  })

  it('显式有限并行会清除规划器虚构的灵感上游依赖并保留固定工作流', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '同时建立潮汐世界并反推已保存灵感',
    }, {
      complete: async () => JSON.stringify({
        summary: '并行处理两个独立候选。',
        tasks: [
          { id: 'world', agentId: 'world-origin', instruction: '建立潮汐世界', dependsOn: [] },
          { id: 'idea', agentId: 'inspiration', instruction: '反推已保存灵感', dependsOn: ['world'] },
        ],
      }),
    })
    expect(plan.workflow?.workflowId).toBe('multi-domain-fan-out')
    expect(plan.tasks.map(task => [task.id, task.dependsOn])).toEqual([
      ['world', []],
      ['idea', []],
    ])
  })

  it('明确单领域请求直接形成一个冻结 Skill 的任务，不调用规划模型', async () => {
    const complete = vi.fn(async () => JSON.stringify({ tasks: [] }))
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '规划两卷卷纲',
    }, {
      complete,
    })
    expect(plan.tasks).toEqual([
      {
        id: 'outline-1',
        agentId: 'outline',
        skillId: 'outline.volumes',
        instruction: '规划两卷卷纲',
        dependsOn: [],
      },
    ])
    expect(plan.workflow).toEqual({
      version: 1,
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it('只允许用户明确授权的领域，设定元素和角色名不扩大为额外写入任务', async () => {
    const complete = vi.fn(async () => JSON.stringify({ tasks: [] }))
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '基于已有世界观，用浮空城和守灯人规划两卷卷纲，每卷要有角色变化',
    }, {
      complete,
    })
    expect(plan.tasks).toEqual([
      {
        id: 'outline-1',
        agentId: 'outline',
        skillId: 'outline.volumes',
        instruction: '基于已有世界观，用浮空城和守灯人规划两卷卷纲，每卷要有角色变化',
        dependsOn: [],
      },
    ])
    expect(complete).not.toHaveBeenCalled()
  })

  it('正文请求不会把已有章纲、世界观或角色约束扩大成额外写入任务', async () => {
    const complete = vi.fn(async () => JSON.stringify({ tasks: [] }))
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '根据已有章纲和世界观，续写第一章正文，保持主角性格',
    }, {
      complete,
    })
    expect(plan.tasks).toEqual([
      {
        id: 'prose-1',
        agentId: 'prose',
        skillId: 'prose.continue',
        instruction: '根据已有章纲和世界观，续写第一章正文，保持主角性格',
        dependsOn: [],
      },
    ])
    expect(complete).not.toHaveBeenCalled()
  })

  it('同轮新建章纲和正文保留全部任务，并冻结作者确认屏障', async () => {
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '先规划第一卷章纲，再写第一章正文',
    }, {
      complete: async () => JSON.stringify({
        summary: '一次完成。',
        tasks: [
          { id: 'outline', agentId: 'outline', instruction: '规划第一卷章纲', dependsOn: [] },
          { id: 'prose', agentId: 'prose', instruction: '写第一章正文', dependsOn: ['outline'] },
        ],
      }),
    })
    expect(plan.summary).toContain('先生成并确认章节大纲')
    expect(plan.tasks.map(task => task.agentId)).toEqual(['outline', 'prose'])
    expect(plan.workflow?.workflowId).toBe('staged-author-confirmed')
    expect(plan.tasks[1].dependsOn).toContain('outline')
  })

  it('没有 durable Harness 绑定的候选不能重新进入正式编辑', async () => {
    const conversation = await getOrCreateAgentConversation({
      purpose: 'test:r-agent2-main-orchestrator:1',
      projectId: project.id!,
      worldGroupId: null,
    })
    const first = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'message',
      role: 'user',
      content: '建立潮汐世界',
    })
    const candidate = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '初稿',
      payload: { label: '世界来源' },
    })
    await expect(updateAgentEventCandidate(candidate.id!, project.id!, '作者修订稿'))
      .rejects.toThrow('缺少当前 durable Harness 绑定')
    const restored = await readAgentEvents(conversation.id!)
    expect(restored.map(event => event.sequence)).toEqual([1, 2])
    expect(restored[0].id).toBe(first.id)
    expect(restored[1].content).toBe('初稿')
    expect((await db.agentConversations.get(conversation.id!))?.title).toBe('建立潮汐世界')
  })

  it('下游候选不能在依赖的上游候选确认前写入', async () => {
    const conversation = await getOrCreateAgentConversation({
      purpose: 'test:r-agent2-main-orchestrator:2',
      projectId: project.id!,
      worldGroupId: null,
    })
    await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '世界候选',
      payload: {
        version: 1,
        taskId: 'world-1',
        agentId: 'world-origin',
        label: '世界来源',
        contextSources: [],
        baseSnapshot: {},
      },
    })
    const downstream = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: JSON.stringify([{ title: '第一卷', summary: '摘要' }]),
      payload: {
        version: 1,
        taskId: 'outline-1',
        agentId: 'outline',
        label: '卷级大纲',
        contextSources: [],
        baseSnapshot: { serialized: '[]', existingTitles: [], startingOrder: 0 },
        outlineMode: 'volumes',
        outlineParentId: null,
        dependsOnTaskIds: ['world-1'],
      },
    })

    await expect(adoptMasterCandidate({
      projectId: project.id!,
      worldGroupId: null,
      event: downstream,
      payload: JSON.parse(downstream.payload),
      draft: downstream.content,
    })).rejects.toThrow('缺少当前 Run 冻结的依赖绑定')
    expect(await db.outlineNodes.count()).toBe(0)
  })
})
