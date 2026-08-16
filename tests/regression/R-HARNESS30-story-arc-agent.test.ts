import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStoryArcCopilotNode,
  parseStoryArcCandidateDraft,
  parseStoryArcModelResponseLegacyV1,
  parseStoryArcModelResponseV2,
  prepareStoryArcCopilot,
  revalidateStoryArcCreativeDraftV1,
  runStoryArcCreativeReliabilityV1,
  type StoryArcCopilotCandidate,
} from '../../src/lib/agent/story-arc-copilot'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type {
  ExecutedMasterCandidate,
  MasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import {
  assertMasterCreativeArtifactAdoptableV1,
  executeMasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import {
  getAgentSkillV1,
} from '../../src/lib/agent/skill-registry'
import {
  classifyMasterWorkflowV1,
  selectAgentSkillIdV1,
} from '../../src/lib/agent/workflow-catalog'
import {
  commitMasterAgentCandidateAdoptionV1,
} from '../../src/lib/agent/run/master-adoption'
import {
  readAgentRunV1,
} from '../../src/lib/agent/run/event-store'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import {
  verifyMasterAgentRunV1,
} from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import type { AIConfig, Project, WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

const STORY_ARC_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid/v1',
  model: 'story-arc-json-test',
  temperature: 0.55,
  maxTokens: 10_000,
  contextWindow: 128_000,
}

const ORIGINAL_AI_STATE = {
  config: structuredClone(useAIConfigStore.getState().config),
  presets: structuredClone(useAIConfigStore.getState().presets),
  taskRoutes: structuredClone(useAIConfigStore.getState().taskRoutes),
  creativeReliabilityEnabled: useAIConfigStore.getState().creativeReliabilityEnabled,
  creativeQualityMode: useAIConfigStore.getState().creativeQualityMode,
}

const directWorkflow = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

async function createWorkspace(): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '潮汐纪元',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: 'harness-30-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness-30-world',
    name: '潮汐世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮汐纪元',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  await db.worldviews.add({
    projectId,
    worldId,
    worldOrigin: '盐海每十年退潮一次，海床会升起一座浮空城。',
    createdAt: now,
    updatedAt: now,
  } as never)
  await db.storyCores.add({
    projectId,
    workId,
    theme: '记忆与责任',
    centralConflict: '守灯人必须决定是否敲响会抹除全城记忆的潮汐钟。',
    createdAt: now,
    updatedAt: now,
  } as never)
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('测试项目创建失败')
  return { project, scope: { projectId, worldId, workId } }
}

function mainArc(name = '潮汐钟主线'): StoryArcCopilotCandidate {
  return {
    name,
    type: 'main',
    description: '守灯人追查潮汐钟真相，并在记忆与城市存续之间作出选择。',
    stages: [
      {
        title: '退潮启程',
        description: '浮空城出现，守灯人从失踪前辈留下的灯油中发现钟声线索。',
        keyEvents: ['浮空城升起', '前辈遗物暴露密令'],
      },
      {
        title: '钟塔裂痕',
        description: '各方争夺潮汐钟，主角发现敲钟会改写全城共同记忆。',
        keyEvents: ['势力争夺钟塔', '主角确认钟声代价'],
        turningPoint: '主角发现前辈正是上一次敲钟者。',
      },
      {
        title: '涨潮抉择',
        description: '海潮吞没旧港，主角公开真相并寻找不牺牲记忆的第三条道路。',
        keyEvents: ['旧港撤离', '主角改变潮汐钟用途'],
      },
    ],
  }
}

function plan(): MasterAgentPlan {
  return {
    summary: '依据现有设定规划一条主线故事线。',
    tasks: [{
      id: 'story-arcs-1',
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction: '依据现有设定生成一条主线故事线',
      dependsOn: [],
    }],
    workflow: directWorkflow,
  }
}

describe.sequential('R-HARNESS30 · 故事线 Agent Skill 与受治理采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({
      config: STORY_ARC_CONFIG,
      presets: [],
      taskRoutes: {},
      creativeReliabilityEnabled: true,
      creativeQualityMode: 'balanced',
    })
    useAIConfigStore.getState().setCreativeReliabilityEnabled(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.getState().setCreativeReliabilityEnabled(
      ORIGINAL_AI_STATE.creativeReliabilityEnabled,
    )
    useAIConfigStore.setState(ORIGINAL_AI_STATE)
    db.close()
  })

  it('故事线请求稳定路由到 outline.story-arcs，并从三注册表派生权限', () => {
    expect(classifyMasterWorkflowV1('根据现有设定生成一条主线故事线')).toMatchObject({
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(selectAgentSkillIdV1('outline', '生成一条支线故事线')).toBe('outline.story-arcs')
    expect(getAgentSkillV1('outline.story-arcs')).toMatchObject({
      agentId: 'outline',
      executionMode: 'story-arcs',
      promptVersion: 'story-arc-copilot-v4',
      writeTargets: [{
        table: 'storyArcs',
        fields: ['name', 'type', 'stages', 'description'],
      }],
    })
  })

  it('真实主 Agent 执行分支只调用一次模型并停在待确认故事线候选', async () => {
    const { project, scope } = await createWorkspace()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
      expect(prompt).toContain('依据现有设定生成一条主线故事线')
      expect(prompt).toContain('盐海每十年退潮一次')
      expect(prompt).toContain('绝不能放在故事线顶层')
      expect(prompt).toContain('本轮叙事任务（运行时合同，不是新增 Canon）')
      expect(prompt).toContain('退出变化')
      expect(prompt).toContain('不要用世界观介绍代替故事推进')
      expect(body.response_format).toEqual({ type: 'json_object' })
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ storyArcs: [mainArc()] }) } }],
        usage: { prompt_tokens: 31, completion_tokens: 47, total_tokens: 78 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await executeMasterAgentPlan({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload).toMatchObject({
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      storyArcKind: 'main',
      workspaceScope: scope,
      narrativeBrief: {
        creativeGoal: '依据现有设定生成一条主线故事线',
        obstacle: '守灯人必须决定是否敲响会抹除全城记忆的潮汐钟。',
      },
      creativeArtifact: {
        status: 'ready',
        qualityMode: 'balanced',
        callEvidence: [{
          callIndex: 1,
          purpose: 'generate',
          usageSource: 'provider',
          inputTokens: 31,
          outputTokens: 47,
          totalTokens: 78,
        }],
        repair: null,
      },
    })
    expect(candidates[0].runtimeNode.kind).toBe('outline.story-arcs')
    expect(parseStoryArcCandidateDraft(candidates[0].draft)).toEqual([mainArc()])
    expect(await db.storyArcs.count()).toBe(0)
  })

  it('本机回滚开关恢复单次严格旧路径，不附加 NarrativeBrief 或 CREL 证据', async () => {
    const { project, scope } = await createWorkspace()
    useAIConfigStore.getState().setCreativeReliabilityEnabled(false)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
      expect(prompt).not.toContain('本轮叙事任务（运行时合同，不是新增 Canon）')
      expect(prompt).not.toContain('assumptions 字符串数组')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ storyArcs: [mainArc()] }) } }],
        usage: { prompt_tokens: 21, completion_tokens: 32, total_tokens: 53 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await executeMasterAgentPlan({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].payload.creativeArtifact).toBeUndefined()
    expect(candidates[0].payload.narrativeBrief).toBeUndefined()
    expect(parseStoryArcCandidateDraft(candidates[0].draft)).toEqual([mainArc()])
    expect(() => parseStoryArcModelResponseLegacyV1(
      `\`\`\`json\n${JSON.stringify({ storyArcs: [mainArc()] })}\n\`\`\``,
    )).toThrow('严格 JSON 对象')
  })

  it('上游临时假设通过独立元数据进入后续任务且不改变依赖草稿哈希', async () => {
    const { project, scope } = await createWorkspace()
    let callIndex = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
      callIndex += 1
      if (callIndex === 2) {
        expect(prompt).toContain('上游临时假设（作者采纳前不是正式设定）')
        expect(prompt).toContain('潮汐钟可以只抹除一段指定记忆')
      }
      const arc = callIndex === 1
        ? mainArc()
        : { ...mainArc('失忆者支线'), type: 'sub' as const }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          storyArcs: [arc],
          ...(callIndex === 1
            ? { assumptions: ['潮汐钟可以只抹除一段指定记忆'] }
            : {}),
        }) } }],
        usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const candidates = await executeMasterAgentPlan({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      plan: {
        summary: '先规划主线，再规划依赖主线假设的支线。',
        tasks: [{
          id: 'main-arc',
          agentId: 'outline',
          skillId: 'outline.story-arcs',
          instruction: '生成一条主线故事线',
          dependsOn: [],
        }, {
          id: 'sub-arc',
          agentId: 'outline',
          skillId: 'outline.story-arcs',
          instruction: '生成一条支线故事线',
          dependsOn: ['main-arc'],
        }],
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(candidates[1].payload.creativeArtifact?.assumptions).toEqual([
      expect.objectContaining({
        text: '潮汐钟可以只抹除一段指定记忆',
        status: 'provisional',
      }),
    ])
    expect(candidates[1].payload.dependencyBindings).toEqual([{
      taskId: 'main-arc',
      outputHash: await hashCanonicalValue(candidates[0].draft),
    }])
  })

  it('生成候选后保持零写入，作者确认眼前候选后才写入 storyArcs', async () => {
    const { project, scope } = await createWorkspace()
    const runAI = vi.fn(async () => JSON.stringify({ storyArcs: [mainArc()] }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '依据现有设定生成一条主线故事线',
    }, { runAI })
    const generated = await runGenerationNode(
      prepared.node,
      prepared.prepared,
    )

    expect(generated.gate?.status).toBe('pass')
    expect(prepared.contextSources).toEqual(expect.arrayContaining(['worldview', 'storyCore']))
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(await db.storyArcs.count()).toBe(0)

    const edited = [{
      ...generated.output[0],
      description: '作者确认后的主线描述。',
    }]
    const adopted = await adoptGenerationNodeOutput(prepared.node, edited)

    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()
    expect(await db.storyArcs.count()).toBe(1)
    expect(await db.storyArcs.toCollection().first()).toMatchObject({
      workId: scope.workId,
      name: '潮汐钟主线',
      type: 'main',
      description: '作者确认后的主线描述。',
    })
  })

  it('未知字段、非法类型、阶段不足、重复名称和错误阶段范围均在写入前拒绝', () => {
    expect(() => parseStoryArcCandidateDraft(JSON.stringify([{
      ...mainArc(),
      projectId: 999,
    }]))).toThrow('不允许的字段')
    expect(() => parseStoryArcCandidateDraft(JSON.stringify([{
      ...mainArc(),
      type: 'side',
    }]))).toThrow('type')
    expect(() => parseStoryArcCandidateDraft(JSON.stringify([{
      ...mainArc(),
      stages: mainArc().stages.slice(0, 2),
    }]))).toThrow('3-7')
    expect(() => parseStoryArcCandidateDraft(JSON.stringify([
      mainArc(),
      mainArc(),
    ]))).toThrow('重复名称')
    expect(() => parseStoryArcCandidateDraft(JSON.stringify([{
      ...mainArc(),
      stages: mainArc().stages.map((stage, index) => index === 0
        ? { ...stage, startVolume: 3, endVolume: 1 }
        : stage),
    }]))).toThrow('卷范围')
  })

  it('模型响应必须使用无额外字段的 storyArcs 对象信封，编辑草稿仍保持数组合同', () => {
    expect(parseStoryArcModelResponseV2(JSON.stringify({ storyArcs: [mainArc()] }))).toEqual([mainArc()])
    expect(parseStoryArcModelResponseV2(JSON.stringify({
      storyArcs: [mainArc()],
      assumptions: ['潮汐钟可被改造成只抹除一段指定记忆'],
    }))).toEqual([mainArc()])
    expect(parseStoryArcCandidateDraft(JSON.stringify([mainArc()]))).toEqual([mainArc()])
    expect(() => parseStoryArcModelResponseV2(JSON.stringify([mainArc()])))
      .toThrow('单个 JSON 对象')
    expect(() => parseStoryArcModelResponseV2(JSON.stringify({ storyArcs: [mainArc()], projectId: 7 })))
      .toThrow('不允许的字段')
    expect(() => parseStoryArcModelResponseV2(JSON.stringify({
      storyArcs: [mainArc()],
      assumptions: [7],
    }))).toThrow('非空短字符串')
    expect(parseStoryArcModelResponseV2(
      `\`\`\`json\n${JSON.stringify({ storyArcs: [mainArc()] })}\n\`\`\``,
    )).toEqual([mainArc()])
    expect(parseStoryArcModelResponseV2(JSON.stringify({
      storyArcs: [{
        ...mainArc(),
        stages: mainArc().stages.map((stage, index) => index === 0
          ? { ...stage, turningPoint: '   ' }
          : stage),
      }],
    }))).toEqual([mainArc()])
    expect(() => parseStoryArcModelResponseV2(JSON.stringify({
      storyArcs: [{
        ...mainArc(),
        stages: mainArc().stages.map((stage, index) => index === 0
          ? { ...stage, turningPoint: null }
          : stage),
      }],
    }))).toThrow('turningPoint 必须是非空字符串')
  })

  it('CREL 对布尔 turningPoint 做零 token 归一化，并保留至多五个具体关键事件', async () => {
    const { project, scope } = await createWorkspace()
    const loose = {
      ...mainArc(),
      stages: mainArc().stages.map((stage, index) => index === 0
        ? {
            ...stage,
            keyEvents: ['发现异常', '核对证据', '遭遇阻力', '改变方案', '承担后果'],
            turningPoint: true,
          }
        : stage),
    }
    const runAI = vi.fn(async () => JSON.stringify({ storyArcs: [loose] }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.artifact.status).toBe('usable-with-warnings')
    expect(result.artifact.repair).toBeNull()
    expect(result.artifact.issues.map(issue => issue.code))
      .toContain('story-arc-turning-point-normalized')
    expect(result.output[0].stages[0]).toMatchObject({
      keyEvents: ['发现异常', '核对证据', '遭遇阻力', '改变方案', '承担后果'],
      turningPoint: '承担后果',
    })
  })

  it('平衡模式仅用第二次调用定向修复结构错误，并记录真实调用边界', async () => {
    const { project, scope } = await createWorkspace()
    const invalid = {
      ...mainArc(),
      stages: mainArc().stages.map((stage, index) => index === 0
        ? { ...stage, turningPoint: null }
        : stage),
    }
    const runAI = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ storyArcs: [invalid] }))
      .mockResolvedValueOnce(JSON.stringify({ storyArcs: [mainArc()] }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledTimes(2)
    expect(result.output).toEqual([mainArc()])
    expect(result.artifact).toMatchObject({
      status: 'ready',
      qualityMode: 'balanced',
      repair: {
        targetIssueCodes: expect.arrayContaining(['story-arc-item-invalid']),
        callIndex: 2,
        result: 'repaired',
      },
      callEvidence: [
        { callIndex: 1, purpose: 'generate', status: 'succeeded' },
        { callIndex: 2, purpose: 'repair', status: 'succeeded' },
      ],
    })
    const repairPrompt = runAI.mock.calls[1][0]
      .map((message: { content: string }) => message.content)
      .join('\n')
    expect(repairPrompt).toContain('story-arc-item-invalid')
    expect(repairPrompt).toContain('turningPoint')
    expect(repairPrompt).not.toContain('盐海每十年退潮一次')
  })

  it('唯一一次修复调用失败后停止消耗并保留首次可编辑产物', async () => {
    const { project, scope } = await createWorkspace()
    const invalidRaw = JSON.stringify({
      storyArcs: [{ ...mainArc(), stages: mainArc().stages.slice(0, 2) }],
    })
    const runAI = vi.fn()
      .mockResolvedValueOnce(invalidRaw)
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledTimes(2)
    expect(result.output).toEqual([])
    expect(result.draft).toBe(invalidRaw)
    expect(result.artifact).toMatchObject({
      status: 'manual-repair',
      originalText: invalidRaw,
      repair: { callIndex: 2, result: 'failed' },
      callEvidence: [
        { callIndex: 1, status: 'succeeded' },
        { callIndex: 2, status: 'failed', usageSource: 'unknown' },
      ],
    })
    expect(result.artifact.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'story-arc-item-invalid',
      'story-arc-repair-provider-failed',
    ]))
  })

  it('经济模式结构失败只调用一次并把问题交给作者，不做隐藏重试', async () => {
    const { project, scope } = await createWorkspace()
    const runAI = vi.fn(async () => JSON.stringify({
      storyArcs: [{ ...mainArc(), stages: mainArc().stages.slice(0, 2) }],
    }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'economy',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.artifact.status).toBe('manual-repair')
    expect(result.artifact.repair).toBeNull()
    expect(result.artifact.callEvidence).toHaveLength(1)
  })

  it('经济模式保留合法故事线片段并明确标出被拒绝片段', async () => {
    const { project, scope } = await createWorkspace()
    const invalid = { ...mainArc('损坏支线'), type: 'sub', stages: mainArc().stages.slice(0, 2) }
    const runAI = vi.fn(async () => JSON.stringify({ storyArcs: [mainArc(), invalid] }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'economy',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.output).toEqual([mainArc()])
    expect(result.artifact.status).toBe('usable-with-warnings')
    expect(result.artifact.validFragments).toHaveLength(1)
    expect(result.artifact.rejectedFragments).toHaveLength(1)
    expect(parseStoryArcCandidateDraft(result.draft)).toEqual([mainArc()])
  })

  it('同一次故事线生成携带临时假设，损坏的假设元数据不会拖垮合法产物', async () => {
    const { project, scope } = await createWorkspace()
    const runAI = vi.fn(async () => JSON.stringify({
      storyArcs: [mainArc()],
      assumptions: [
        '潮汐钟可以被改造成只抹除一段指定记忆',
        7,
      ],
    }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
      inheritedAssumptions: [{
        version: 1,
        id: 'upstream:1',
        text: '守灯人此前见过潮汐钟的内部结构',
        derivedFrom: ['candidate:outline-0'],
        confidence: 'low',
        conflictsWith: [],
        status: 'provisional',
      }],
    }, { runAI })

    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.output).toEqual([mainArc()])
    expect(result.artifact.status).toBe('usable-with-warnings')
    expect(result.artifact.assumptions).toEqual([
      expect.objectContaining({
        text: '守灯人此前见过潮汐钟的内部结构',
        status: 'provisional',
      }),
      expect.objectContaining({
        text: '潮汐钟可以被改造成只抹除一段指定记忆',
        status: 'provisional',
        confidence: 'low',
      }),
    ])
    expect(runAI.mock.calls[0][0].map((message: { content: string }) => message.content).join('\n'))
      .toContain('守灯人此前见过潮汐钟的内部结构')
    expect(result.artifact.issues.map(issue => issue.code)).toContain('story-arc-assumption-item-invalid')
    expect(result.artifact.repair).toBeNull()
  })

  it('作者修订后只做本地重新校验，合法草稿恢复采纳资格且不增加模型调用', async () => {
    const { project, scope } = await createWorkspace()
    const runAI = vi.fn(async () => JSON.stringify({
      storyArcs: [{ ...mainArc(), stages: mainArc().stages.slice(0, 2) }],
    }))
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    }, { runAI })
    const generated = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'economy',
    })

    const revalidated = revalidateStoryArcCreativeDraftV1({
      draft: JSON.stringify([mainArc()], null, 2),
      snapshot: prepared.snapshot,
      kind: prepared.kind,
      previousArtifact: generated.artifact,
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(revalidated.status).toBe('ready')
    expect(revalidated.issues).toEqual([])
    expect(revalidated.callEvidence).toEqual(generated.artifact.callEvidence)
    expect(revalidated.originalText).toBe(generated.artifact.originalText)
    expect(() => assertMasterCreativeArtifactAdoptableV1({
      creativeArtifact: generated.artifact,
    } as never)).toThrow('需要手动修复')
    expect(() => assertMasterCreativeArtifactAdoptableV1({
      creativeArtifact: revalidated,
    } as never)).not.toThrow()
  })

  it('作者把候选改成非法结构时重新 gate，且不触发写入', async () => {
    const { project, scope } = await createWorkspace()
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    })
    const blocked = await adoptGenerationNodeOutput(prepared.node, [{
      ...mainArc(),
      stages: mainArc().stages.slice(0, 2),
    }])

    expect(blocked.adopted).toBe(false)
    expect(blocked.gate?.issues.map(issue => issue.code)).toContain('story-arc-invalid-structure')
    expect(await db.storyArcs.count()).toBe(0)
  })

  it('候选生成后故事线基线变化会让旧候选 stale', async () => {
    const { project, scope } = await createWorkspace()
    const prepared = await prepareStoryArcCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: '生成一条主线故事线',
    })
    const saveCandidates = vi.fn()
    const staleNode = createStoryArcCopilotNode(prepared.input, {
      readCurrent: async () => ({ ...prepared.snapshot, serialized: '[changed]' }),
      saveCandidates,
    })

    await expect(adoptGenerationNodeOutput(staleNode, [mainArc()]))
      .rejects.toThrow('故事线已在候选生成后发生变化')
    expect(saveCandidates).not.toHaveBeenCalled()
    expect(await db.storyArcs.count()).toBe(0)
  })

  it('durable 候选刷新恢复不重复模型调用，并只经确认与 adopt 完成终态', async () => {
    const { project, scope } = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      scope,
      worldGroupId: null,
    })
    const execute = vi.fn(async options => {
      const task = options.plan.tasks[0]
      await options.executionTrace?.taskStarted?.(task)
      const prepared = await prepareStoryArcCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: task.instruction,
        skillId: task.skillId,
      }, { runAI: async () => JSON.stringify({ storyArcs: [mainArc()] }) })
      const generated = await runGenerationNode(prepared.node, prepared.prepared)
      const candidate: ExecutedMasterCandidate = {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: 'outline',
          skillId: 'outline.story-arcs',
          label: '主线故事线',
          contextSources: prepared.contextSources,
          contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot,
          storyArcKind: prepared.kind,
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
        },
        draft: JSON.stringify(generated.output, null, 2),
        runtimeNode: prepared.node,
        runtimeOutput: generated.output,
      }
      await options.executionTrace?.candidateReady?.(task, candidate)
      return [candidate]
    })
    const first = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute })

    expect(execute).toHaveBeenCalledOnce()
    expect(await db.storyArcs.count()).toBe(0)
    expect(first.projection.state).toBe('awaiting_confirmation')

    const resumed = await restoreMasterAgentCandidatesV1({ scope, runId: first.runId })
    expect(resumed.candidates).toHaveLength(1)

    const persisted = resumed.candidates[0]
    await updateAgentEventCandidate(
      persisted.event.id!,
      project.id!,
      JSON.stringify([{ ...mainArc(), description: '作者在确认前修订的主线。' }], null, 2),
      scope,
    )
    const adoption = await commitMasterAgentCandidateAdoptionV1({
      scope,
      runId: first.runId,
      candidateEventId: persisted.event.id!,
    })
    expect(adoption.message).toBe('故事线已写入项目。')
    expect(await db.storyArcs.count()).toBe(1)

    const verification = await verifyMasterAgentRunV1({ scope, runId: first.runId })
    expect(verification.accepted, verification.codes.join(',')).toBe(true)
    expect(verification.snapshot.projection.state).toBe('completed')
  })

  it('正式故事线在采纳后被篡改时，终态校验不得签发 completed', async () => {
    const { project, scope } = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      scope,
      worldGroupId: null,
    })
    const execute = async options => {
      const task = options.plan.tasks[0]
      await options.executionTrace?.taskStarted?.(task)
      const prepared = await prepareStoryArcCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: task.instruction,
        skillId: task.skillId,
      }, { runAI: async () => JSON.stringify({ storyArcs: [mainArc('不可篡改主线')] }) })
      const generated = await runGenerationNode(prepared.node, prepared.prepared)
      await options.executionTrace?.candidateReady?.(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: 'outline',
          skillId: 'outline.story-arcs',
          label: '主线故事线',
          contextSources: prepared.contextSources,
          contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot,
          storyArcKind: prepared.kind,
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
        },
        draft: JSON.stringify(generated.output, null, 2),
        runtimeNode: prepared.node,
        runtimeOutput: generated.output,
      })
      return []
    }
    const run = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute })
    const event = run.candidates[0].event
    await commitMasterAgentCandidateAdoptionV1({
      scope,
      runId: run.runId,
      candidateEventId: event.id!,
    })
    const row = await db.storyArcs.toCollection().first()
    await db.storyArcs.update(row!.id!, { description: '外部篡改' })

    const verification = await verifyMasterAgentRunV1({ scope, runId: run.runId })
    expect(verification.accepted).toBe(false)
    expect(verification.codes).toContain('story-arcs-1:post-state-mismatch')
    expect((await readAgentRunV1(scope, run.runId)).projection.state).not.toBe('completed')
  })
})
