import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStoryCoreCopilotNode,
  formatStoryCoreGenerationRequestV1,
  parseStoryCoreCandidateDraft,
  prepareStoryCoreCopilot,
  type StoryCoreCopilotCandidate,
} from '../../src/lib/agent/story-core-copilot'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type {
  ExecutedMasterCandidate,
  MasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import { executeMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  classifyMasterWorkflowV1,
  selectAgentSkillIdV1,
} from '../../src/lib/agent/workflow-catalog'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import type { Project, WorkspaceScope } from '../../src/lib/types'

const directWorkflow = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

async function createWorkspace(): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '镜城纪事',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 120_000,
    worldCode: 'harness-31-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness-31-world',
    name: '镜海世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '镜城纪事',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 120_000,
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
    worldOrigin: '镜海退潮时，城民被典当的记忆会凝成盐晶。',
    factionLayout: '镜税署与拾忆行会争夺盐晶解释权。',
    createdAt: now,
    updatedAt: now,
  } as never)
  await db.storyCores.add({
    projectId,
    workId,
    logline: '守灯人追查一枚不属于任何人的记忆盐晶。',
    concept: '记忆可以纳税，也可以被继承。',
    theme: '记忆与责任',
    centralConflict: '主角必须在保住父亲记忆与公开镜税真相之间选择。',
    plotPattern: '线性调查',
    storyLines: '',
    mainPlot: '主角沿盐晶来源追查镜税制度。',
    subPlots: '拾忆行会内部的继承权争夺。',
    createdAt: now,
    updatedAt: now,
  } as never)
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('测试项目创建失败')
  return { project, scope: { projectId, worldId, workId } }
}

function request(field: 'logline' | 'centralConflict' = 'logline') {
  return formatStoryCoreGenerationRequestV1({
    field,
    mode: 'expand',
    hint: '强化主角必须付出的个人代价',
  })
}

function candidate(value = '守灯人为救父亲的记忆追查无主盐晶，却发现整座镜城靠遗忘维持秩序。'): StoryCoreCopilotCandidate {
  return { field: 'logline', value }
}

function plan(): MasterAgentPlan {
  return {
    summary: '生成一句话故事候选。',
    tasks: [{
      id: 'story-core-1',
      agentId: 'world-origin',
      skillId: 'world-origin.story-core',
      instruction: request(),
      dependsOn: [],
    }],
    workflow: directWorkflow,
  }
}

describe.sequential('R-HARNESS31 · 故事核心 Agent Skill 与受治理采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('故事核心请求只路由到世界基座 Agent 的 story-core Skill', () => {
    const authorRequest = formatStoryCoreGenerationRequestV1({
      field: 'mainPlot',
      mode: 'rewrite',
      hint: '保留故事主线里的父女冲突',
    })
    expect(classifyMasterWorkflowV1(authorRequest)).toMatchObject({
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(selectAgentSkillIdV1('world-origin', authorRequest)).toBe('world-origin.story-core')
    expect(getAgentSkillV1('world-origin.story-core')).toMatchObject({
      agentId: 'world-origin',
      owner: 'world-foundation-agent',
      executionMode: 'story-core',
      writeTargets: [{
        table: 'storyCores',
        fields: ['logline', 'concept', 'theme', 'centralConflict', 'plotPattern', 'mainPlot', 'subPlots'],
      }],
    })
  })

  it('读取完整登记上下文，生成严格单字段候选且确认前零写入', async () => {
    const { project, scope } = await createWorkspace()
    let prompt = ''
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    }, {
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify(candidate())
      },
    })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)

    expect(generated.gate?.status).toBe('pass')
    expect(prepared.contextSources).toEqual(expect.arrayContaining(['worldview', 'storyCore']))
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'complete',
      handling: 'grounded-transform',
    })
    expect(prompt).toContain('记忆可以纳税，也可以被继承')
    expect(prompt).toContain('镜海退潮时')
    expect(prompt).toContain('目标字段是 logline')
    expect((await db.storyCores.get(prepared.snapshot.id!))?.logline)
      .toBe('守灯人追查一枚不属于任何人的记忆盐晶。')

    const edited = candidate('守灯人为救父亲追查无主盐晶，却必须决定是否让整座镜城记起被掩埋的罪。')
    const adopted = await adoptGenerationNodeOutput(prepared.node, edited)
    expect(adopted.adopted).toBe(true)
    expect((await db.storyCores.get(prepared.snapshot.id!))?.logline).toBe(edited.value)
  })

  it('上游为空但已有单个角色时，明确把角色作为下游反推证据而不写入非目标字段', async () => {
    const { project, scope } = await createWorkspace()
    await db.worldviews.clear()
    await db.storyCores.clear()
    await db.characters.add({
      projectId: project.id!,
      worldId: scope.worldId,
      name: '失忆的守灯人',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      role: 'protagonist',
      shortDescription: '他只能记住潮水退去后的一小时。',
      personality: '克制而执拗。',
      background: '父亲在潮汐钟失窃当天主动典当了关于他的记忆。',
      motivation: '找回父亲的记忆并查清潮汐钟的用途。',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never)
    let prompt = ''
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    }, {
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify(candidate())
      },
    })
    await runGenerationNode(prepared.node, prepared.prepared)

    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'empty',
      handling: 'create-from-request',
      consideredSourceKeys: ['worldview', 'storyCore'],
    })
    expect(prepared.contextSources).toContain('characters')
    expect(prompt).toContain('失忆的守灯人')
    expect(prompt).toContain('下游反推证据')
    expect(prompt).toContain('反推当前目标字段')
    expect(await db.storyCores.count()).toBe(0)
  })

  it('未知字段、越界内容、字段错投和未变化候选都在写入前拒绝', async () => {
    expect(() => parseStoryCoreCandidateDraft(JSON.stringify({
      ...candidate(),
      projectId: 1,
    }))).toThrow('只能包含 field 和 value')
    expect(() => parseStoryCoreCandidateDraft(JSON.stringify({
      field: 'unknown',
      value: '内容',
    }))).toThrow('field 不在允许范围')

    const { project, scope } = await createWorkspace()
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    })
    const wrongField = await adoptGenerationNodeOutput(prepared.node, {
      field: 'theme',
      value: '新的主题',
    })
    expect(wrongField.adopted).toBe(false)
    expect(wrongField.gate?.issues.map(issue => issue.code)).toContain('story-core-field-mismatch')
    const unchanged = await adoptGenerationNodeOutput(prepared.node, {
      field: 'logline',
      value: prepared.snapshot.values.logline,
    })
    expect(unchanged.adopted).toBe(false)
    expect(unchanged.gate?.issues.map(issue => issue.code)).toContain('story-core-unchanged')
  })

  it('候选生成后任一故事核心字段变化都会阻止旧候选覆盖新基线', async () => {
    const { project, scope } = await createWorkspace()
    const prepared = await prepareStoryCoreCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    })
    const adoptOutput = vi.fn()
    const staleNode = createStoryCoreCopilotNode(prepared.input, {
      readCurrent: async () => ({
        ...prepared.snapshot,
        serialized: 'changed',
      }),
      adoptOutput,
    })

    await expect(adoptGenerationNodeOutput(staleNode, candidate()))
      .rejects.toThrow('故事核心已在候选生成后发生变化')
    expect(adoptOutput).not.toHaveBeenCalled()
  })

  it('真实主 Agent 执行分支只调用一次模型并停在待确认候选', async () => {
    const { project, scope } = await createWorkspace()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
      expect(prompt).toContain('目标字段是 logline')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(candidate()) } }],
        usage: { prompt_tokens: 31, completion_tokens: 23, total_tokens: 54 },
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
      agentId: 'world-origin',
      skillId: 'world-origin.story-core',
      storyCoreField: 'logline',
      workspaceScope: scope,
    })
    expect(candidates[0].runtimeNode.kind).toBe('world-foundation.story-core')
    expect(parseStoryCoreCandidateDraft(candidates[0].draft)).toEqual(candidate())
    expect((await db.storyCores.toCollection().first())?.logline)
      .toBe('守灯人追查一枚不属于任何人的记忆盐晶。')
  })

  it('durable 候选可在刷新后编辑采纳，并由终态 verifier 回读正式字段', async () => {
    const { project, scope } = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      scope,
      worldGroupId: null,
    })
    const execute = vi.fn(async options => {
      const task = options.plan.tasks[0]
      await options.executionTrace?.taskStarted?.(task)
      const prepared = await prepareStoryCoreCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: task.instruction,
        skillId: task.skillId,
      }, { runAI: async () => JSON.stringify(candidate()) })
      const generated = await runGenerationNode(prepared.node, prepared.prepared)
      const durableCandidate: ExecutedMasterCandidate = {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: 'world-origin',
          skillId: 'world-origin.story-core',
          label: prepared.label,
          contextSources: prepared.contextSources,
          contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot,
          storyCoreField: prepared.targetField,
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
          generator: prepared.modelIdentity,
        },
        draft: JSON.stringify(generated.output, null, 2),
        runtimeNode: prepared.node,
        runtimeOutput: generated.output,
      }
      await options.executionTrace?.candidateReady?.(task, durableCandidate)
      return [durableCandidate]
    })
    const run = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute })

    expect(run.projection.state).toBe('awaiting_confirmation')
    expect(execute).toHaveBeenCalledOnce()
    const restored = await restoreMasterAgentCandidatesV1({ scope, runId: run.runId })
    expect(restored.candidates).toHaveLength(1)
    const revised = candidate('守灯人追查无主盐晶，只为发现父亲主动典当了关于他的全部记忆。')
    await updateAgentEventCandidate(
      restored.candidates[0].event.id!,
      project.id!,
      JSON.stringify(revised, null, 2),
      scope,
    )
    const adoption = await commitMasterAgentCandidateAdoptionV1({
      scope,
      runId: run.runId,
      candidateEventId: restored.candidates[0].event.id!,
    })
    expect(adoption.message).toBe('故事核心“一句话故事”已写入项目。')
    expect((await db.storyCores.toCollection().first())?.logline).toBe(revised.value)

    await db.storyCores.update(restored.candidates[0].payload.baseSnapshot.id, {
      logline: '被外部篡改的内容',
      updatedAt: Date.now() + 1,
    })
    const tampered = await verifyMasterAgentRunV1({ scope, runId: run.runId })
    expect(tampered.accepted).toBe(false)
    expect(tampered.codes).toContain('story-core-1:post-state-mismatch')
  })
})
