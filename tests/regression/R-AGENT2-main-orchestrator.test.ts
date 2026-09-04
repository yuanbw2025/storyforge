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

  it('同轮新建章纲和正文会分阶段，只先返回可确认的大纲任务', async () => {
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
    expect(plan.tasks.map(task => task.agentId)).toEqual(['outline'])
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
