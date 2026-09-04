import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type {
  ExecutedMasterCandidate,
  MasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import { executeMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  createWorldviewFieldCopilotNode,
  formatWorldviewFieldGenerationRequestV1,
  parseWorldviewFieldCandidateDraft,
  prepareWorldviewFieldCopilot,
  type WorldviewFieldCopilotCandidate,
} from '../../src/lib/agent/worldview-field-copilot'
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
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import type { Project, WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const directWorkflow = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

async function createWorkspace(): Promise<{ project: Project; scope: WorkspaceScope; worldviewId: number }> {
  const now = Date.now()
  const created = await seedCurrentWorkspace('镜城纪事')
  const { project, scope } = created
  const { projectId } = scope
  const worldviewId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId,
    worldOrigin: '镜海退潮时，城民被典当的记忆会凝成盐晶。',
    powerHierarchy: '拾忆师只能读取自愿典当的记忆。',
    factionLayout: '镜税署与拾忆行会争夺盐晶解释权。',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never) as number
  await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId,
    logline: '守灯人追查一枚不属于任何人的记忆盐晶。',
    concept: '记忆可以纳税，也可以被继承。',
    theme: '记忆与责任',
    centralConflict: '主角必须在保住父亲记忆与公开镜税真相之间选择。',
    plotPattern: '线性调查',
    mainPlot: '主角沿盐晶来源追查镜税制度。',
    subPlots: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  return { project, scope, worldviewId }
}

function request(field: 'continentLayout' | 'divineDesign' = 'continentLayout') {
  return formatWorldviewFieldGenerationRequestV1({
    field,
    mode: 'expand',
    hint: '让空间格局直接制造故事冲突',
  })
}

function textCandidate(value = '镜海中央是每月退潮一次的盐晶盆地，三座堤城按潮汐时刻争夺通行权。'): WorldviewFieldCopilotCandidate {
  return { field: 'continentLayout', value }
}

function plan(): MasterAgentPlan {
  return {
    summary: '生成地貌分布候选。',
    tasks: [{
      id: 'worldview-field-1',
      agentId: 'world-origin',
      skillId: 'world-origin.worldview-field',
      instruction: request(),
      dependsOn: [],
    }],
    workflow: directWorkflow,
  }
}

describe.sequential('R-HARNESS32 · 世界基座字段 Agent Skill 与受治理采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('新世界基座请求只路由到同一世界基座 Agent 的 worldview-field Skill', () => {
    const authorRequest = formatWorldviewFieldGenerationRequestV1({
      field: 'politicsOverview',
      mode: 'rewrite',
      hint: '保留镜税署的既有权力边界',
    })
    expect(classifyMasterWorkflowV1(authorRequest)).toMatchObject({
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(selectAgentSkillIdV1('world-origin', authorRequest)).toBe('world-origin.worldview-field')
    expect(getAgentSkillV1('world-origin.worldview-field')).toMatchObject({
      agentId: 'world-origin',
      owner: 'world-foundation-agent',
      executionMode: 'worldview-field',
      writeTargets: [{
        table: 'worldviews',
        fields: expect.arrayContaining(['worldOrigin', 'divineDesign', 'politicsOverview', 'itemDesign']),
      }],
    })
  })

  it('只经登记来源读取上下游，生成严格单字段候选且确认前零写入', async () => {
    const { project, scope, worldviewId } = await createWorkspace()
    let prompt = ''
    const prepared = await prepareWorldviewFieldCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    }, {
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify(textCandidate())
      },
    })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)

    expect(generated.gate?.status).toBe('pass')
    expect(prepared.contextSources).toEqual(['ragSelection'])
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(prepared.snapshot.foundationState).toBe('partial')
    expect(prompt).toContain('记忆可以纳税，也可以被继承')
    expect(prompt).toContain('镜海退潮时')
    expect(prompt).toContain('目标字段是 continentLayout')
    expect((await db.worldviews.get(worldviewId))?.continentLayout).toBeUndefined()

    const edited = textCandidate('镜海由三道潮墙分成互不同时退潮的盆地，堤城只能在短暂重叠期交换盐晶。')
    const adopted = await adoptGenerationNodeOutput(prepared.node, edited)
    expect(adopted.adopted).toBe(true)
    expect((await db.worldviews.get(worldviewId))?.continentLayout).toBe(edited.value)
  })

  it('世界基座为空但已有角色时，明确执行下游反推且仍只写目标字段', async () => {
    const { project, scope } = await createWorkspace()
    await db.worldviews.clear()
    await db.storyCores.clear()
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId: project.id!,
      name: '失忆的守灯人',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      shortDescription: '他只能记住潮水退去后的一小时。',
      personality: '克制而执拗。',
      background: '父亲在潮汐钟失窃当天主动典当了关于他的记忆。',
      motivation: '找回父亲的记忆并查清潮汐钟的用途。',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { owner: 'world' }) as never)
    let prompt = ''
    const prepared = await prepareWorldviewFieldCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    }, {
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify(textCandidate())
      },
    })
    await runGenerationNode(prepared.node, prepared.prepared)

    expect(prepared.snapshot.foundationState).toBe('empty')
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
      consideredSourceKeys: ['worldview', 'storyCore', 'characters', 'storyArcs'],
    })
    expect(prompt).toContain('失忆的守灯人')
    expect(prompt).toContain('下游内容')
    expect(prompt).toContain('反推证据')
    expect(await db.worldviews.count()).toBe(0)
  })

  it('神明字段一次产出结构化对象，额外字段、错投和未变化候选均被拒绝', async () => {
    const divine = {
      field: 'divineDesign',
      value: {
        hasDivinity: true,
        divineRank: '潮母之下设三位守潮神。',
        divineNames: '潮母掌记忆，盐灯神掌见证。',
        divineRules: '神明不得取走未被自愿典当的记忆。',
      },
    } as const
    expect(parseWorldviewFieldCandidateDraft(JSON.stringify(divine))).toEqual(divine)
    expect(() => parseWorldviewFieldCandidateDraft(JSON.stringify({
      ...divine,
      explanation: '多余说明',
    }))).toThrow('只能包含 field、value')
    expect(() => parseWorldviewFieldCandidateDraft(JSON.stringify({
      field: 'divineDesign',
      value: { ...divine.value, extra: '越权字段' },
    }))).toThrow('只能包含 divineNames、divineRank、divineRules、hasDivinity')

    const { project, scope } = await createWorkspace()
    const prepared = await prepareWorldviewFieldCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request('divineDesign'),
    })
    const wrongField = await adoptGenerationNodeOutput(prepared.node, textCandidate())
    expect(wrongField.adopted).toBe(false)
    expect(wrongField.gate?.issues.map(issue => issue.code)).toContain('worldview-field-mismatch')
    const unchanged = await adoptGenerationNodeOutput(prepared.node, {
      field: 'divineDesign',
      value: prepared.snapshot.values.divineDesign as typeof divine.value,
    })
    expect(unchanged.adopted).toBe(false)
    expect(unchanged.gate?.issues.map(issue => issue.code)).toContain('worldview-field-unchanged')
  })

  it('候选生成后任一世界基座字段变化都会阻止旧候选覆盖新基线', async () => {
    const { project, scope } = await createWorkspace()
    const prepared = await prepareWorldviewFieldCopilot({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: request(),
    })
    const adoptOutput = vi.fn()
    const staleNode = createWorldviewFieldCopilotNode(prepared.input, {
      readCurrent: async () => ({ ...prepared.snapshot, serialized: 'changed' }),
      adoptOutput,
    })

    await expect(adoptGenerationNodeOutput(staleNode, textCandidate()))
      .rejects.toThrow('世界基座已在候选生成后发生变化')
    expect(adoptOutput).not.toHaveBeenCalled()
  })

  it('真实主 Agent 分支只调用一次模型并停在待确认候选', async () => {
    const { project, scope } = await createWorkspace()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
      expect(prompt).toContain('目标字段是 continentLayout')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(textCandidate()) } }],
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
      skillId: 'world-origin.worldview-field',
      worldviewField: 'continentLayout',
      workspaceScope: scope,
    })
    expect(candidates[0].runtimeNode.kind).toBe('world-foundation.worldview-field')
    expect(parseWorldviewFieldCandidateDraft(candidates[0].draft)).toEqual(textCandidate())
    expect((await db.worldviews.toCollection().first())?.continentLayout).toBeUndefined()
  })

  it('durable 候选刷新后可编辑采纳，并由终态 verifier 回读正式字段', async () => {
    const { project, scope } = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      purpose: 'worldview-field-generation',
    })
    const execute = vi.fn(async options => {
      const task = options.plan.tasks[0]
      await options.executionTrace?.taskStarted?.(task)
      const prepared = await prepareWorldviewFieldCopilot({
        projectId: project.id!,
        scope,
        worldGroupId: null,
        authorRequest: task.instruction,
        skillId: task.skillId,
      }, { runAI: async () => JSON.stringify(textCandidate()) })
      if (prepared.contextGatewayExecution) {
        await options.executionTrace?.contextGatewayPrepared?.(task, {
          execution: prepared.contextGatewayExecution,
          assembled: prepared.input.assembled,
          renderedRequest: prepared.prepared.messages,
        })
      }
      const generated = await runGenerationNode(prepared.node, prepared.prepared)
      const durableCandidate: ExecutedMasterCandidate = {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: 'world-origin',
          skillId: 'world-origin.worldview-field',
          label: prepared.label,
          contextSources: prepared.contextSources,
          contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot,
          worldviewField: prepared.targetField,
          worldviewFieldOperation: prepared.input.mode,
          worldviewFieldOutputBudget: prepared.input.outputBudget,
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
          generator: prepared.modelIdentity,
        },
        draft: JSON.stringify(generated.output, null, 2),
        runtimeNode: prepared.node,
        runtimeOutput: generated.output,
        ...(prepared.contextGatewayExecution ? {
          contextGatewayRuntime: {
            execution: prepared.contextGatewayExecution,
            assembled: prepared.input.assembled,
            renderedRequest: prepared.prepared.messages,
            rawResponse: generated.output,
          },
        } : {}),
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
    const restored = await restoreMasterAgentCandidatesV1({ scope, runId: run.runId })
    const revised = textCandidate('三座堤城只在双月重合时共享退潮航道，错过潮窗就会被盐雾隔绝一月。')
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
    expect(adoption.message).toBe('世界基座“地貌分布”已写入当前世界。')
    expect((await db.worldviews.toCollection().first())?.continentLayout).toBe(revised.value)

    const worldview = await db.worldviews.toCollection().first()
    await db.worldviews.update(worldview!.id!, {
      continentLayout: '被外部篡改的地貌',
      updatedAt: Date.now() + 1,
    })
    const tampered = await verifyMasterAgentRunV1({ scope, runId: run.runId })
    expect(tampered.accepted).toBe(false)
    expect(tampered.codes).toContain('worldview-field-1:post-state-mismatch')
  })
})
