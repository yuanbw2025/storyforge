import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptRestoredCreativeRulesCandidateV1,
  createCreativeRulesCopilotNodeV1,
  formatCreativeRulesGenerationRequestV1,
  parseCreativeRulesCandidateDraftV1,
  prepareCreativeRulesCopilotV1,
  type CreativeRulesCopilotCandidateV1,
} from '../../src/lib/agent/creative-rules-copilot'
import {
  getOrCreateAgentConversation,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { executeMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  classifyMasterWorkflowV1,
  selectAgentSkillIdV1,
} from '../../src/lib/agent/workflow-catalog'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import type { Project, WorkspaceScope } from '../../src/lib/types'

const now = 1_920_000_000_000

async function seedWorkspace(): Promise<{ project: Project; scope: WorkspaceScope; rulesId: number }> {
  const projectId = await db.projects.add({
    name: '潮钟纪事',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 120_000,
    worldCode: 'harness39-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness39-world',
    name: '潮钟世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮钟纪事',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 120_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  const scope = { projectId, worldId, workId }
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  await db.worldviews.add({
    projectId,
    worldId,
    worldOrigin: '港城以潮汐钟封存居民主动典当的记忆。',
    factionLayout: '守钟会与拾忆行会争夺记忆的归还权。',
    createdAt: now,
    updatedAt: now,
  } as never)
  await db.storyCores.add({
    projectId,
    workId,
    theme: '记忆与责任',
    centralConflict: '主角必须在救回父亲与公开制度真相之间选择。',
    createdAt: now,
    updatedAt: now,
  } as never)
  const rulesId = await db.creativeRules.add({
    projectId,
    workId,
    writingStyle: '克制、具体，以行动代替解释。',
    narrativePOV: 'third-limited',
    toneAndMood: '',
    atmosphere: '冷峻中保留微弱希望。',
    prohibitions: JSON.stringify(['不得使用现代网络用语']),
    consistencyRules: JSON.stringify(['记忆转移必须经潮汐钟见证']),
    specialRequirements: '重要秘密必须通过可见证据逐步释放。',
    referenceWorks: '[]',
    createdAt: now,
    updatedAt: now,
  } as never) as number
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('测试项目创建失败')
  return { project, scope, rulesId }
}

function candidate(value = '采用冷静、具象的第三人称限知；多写可观察动作，避免用全知解释人物动机。'): CreativeRulesCopilotCandidateV1 {
  return { field: 'writingStyle', value }
}

function plan(): MasterAgentPlan {
  return {
    summary: '生成写作风格候选。',
    tasks: [{
      id: 'creative-rules-1',
      agentId: 'world-origin',
      skillId: 'world-origin.creative-rules',
      instruction: formatCreativeRulesGenerationRequestV1({ field: 'writingStyle' }),
      dependsOn: [],
    }],
    workflow: {
      version: 1,
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    },
  }
}

describe.sequential('R-HARNESS39 · 创作规则 Agent Skill 与受治理采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('创作规则请求只路由到世界基座 Agent 的单字段 Skill', () => {
    const request = formatCreativeRulesGenerationRequestV1({ field: 'atmosphere' })
    expect(classifyMasterWorkflowV1(request)).toMatchObject({
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(selectAgentSkillIdV1('world-origin', request)).toBe('world-origin.creative-rules')
    expect(getAgentSkillV1('world-origin.creative-rules')).toMatchObject({
      agentId: 'world-origin',
      owner: 'world-foundation-agent',
      executionMode: 'creative-rules',
      contextSourceKeys: ['projectStatus', 'worldview', 'storyCore', 'creativeRules'],
      writeTargets: [{
        table: 'creativeRules',
        fields: ['writingStyle', 'atmosphere', 'specialRequirements'],
      }],
    })
  })

  it('读取登记上下文并复用 rules.generate 模板，生成严格候选且确认前零写入', async () => {
    const { project, scope, rulesId } = await seedWorkspace()
    let prompt = ''
    const prepared = await prepareCreativeRulesCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'writingStyle' }),
    }, {
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return JSON.stringify(candidate())
      },
    })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)

    expect(generated.gate?.status).toBe('pass')
    expect(prepared.contextSources).toEqual(['projectStatus', 'worldview', 'storyCore', 'creativeRules'])
    expect(prepared.contextEvidence.sourceEvidence?.every(source => source.sourceHash)).toBe(true)
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'complete',
      handling: 'grounded-transform',
    })
    expect(prompt).toContain('资深的创作顾问')
    expect(prompt).toContain('港城以潮汐钟封存')
    expect(prompt).toContain('记忆与责任')
    expect(prompt).toContain('目标字段是 writingStyle')
    expect((await db.creativeRules.get(rulesId))?.writingStyle).toBe('克制、具体，以行动代替解释。')

    const edited = candidate('作者确认：保持克制短句，以动作和物件呈现压力，避免直接解释角色心理。')
    const adopted = await adoptGenerationNodeOutput(prepared.node, edited)
    expect(adopted.adopted).toBe(true)
    expect((await db.creativeRules.get(rulesId))?.writingStyle).toBe(edited.value)
    expect((await db.creativeRules.get(rulesId))?.atmosphere).toBe('冷峻中保留微弱希望。')
  })

  it('空、部分输入采用不同处理策略，未知字段、错投和未变化候选在写入前拒绝', async () => {
    expect(() => parseCreativeRulesCandidateDraftV1(JSON.stringify({
      ...candidate(),
      extra: true,
    }))).toThrow('只能包含 field 和 value')
    expect(() => parseCreativeRulesCandidateDraftV1(JSON.stringify({
      field: 'prohibitions',
      value: '不要出现现代用语',
    }))).toThrow('field 不在允许范围')

    const { project, scope } = await seedWorkspace()
    await db.worldviews.clear()
    await db.storyCores.clear()
    await db.creativeRules.clear()
    const empty = await prepareCreativeRulesCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'atmosphere' }),
    })
    expect(empty.contextEvidence.inputState).toMatchObject({
      state: 'empty',
      handling: 'create-from-request',
    })

    await db.storyCores.add({
      projectId: project.id!,
      workId: scope.workId,
      theme: '记忆与责任',
      createdAt: now,
      updatedAt: now,
    } as never)
    const partial = await prepareCreativeRulesCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'atmosphere' }),
    })
    expect(partial.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })

    const wrongField = await adoptGenerationNodeOutput(partial.node, candidate())
    expect(wrongField.adopted).toBe(false)
    expect(wrongField.gate?.issues.map(issue => issue.code)).toContain('creative-rules-field-mismatch')

    await db.creativeRules.add({
      projectId: project.id!,
      workId: scope.workId,
      writingStyle: '',
      narrativePOV: 'third-limited',
      toneAndMood: '',
      atmosphere: '压抑但不绝望',
      prohibitions: '[]',
      consistencyRules: '[]',
      specialRequirements: '',
      referenceWorks: '[]',
      createdAt: now,
      updatedAt: now,
    } as never)
    const unchangedPrepared = await prepareCreativeRulesCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'atmosphere' }),
    })
    const unchanged = await adoptGenerationNodeOutput(unchangedPrepared.node, {
      field: 'atmosphere',
      value: '压抑但不绝望',
    })
    expect(unchanged.adopted).toBe(false)
    expect(unchanged.gate?.issues.map(issue => issue.code)).toContain('creative-rules-unchanged')
  })

  it('候选生成后任一创作规则变化都会使旧候选过期', async () => {
    const { project, scope, rulesId } = await seedWorkspace()
    const prepared = await prepareCreativeRulesCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'writingStyle' }),
    })
    await db.creativeRules.update(rulesId, {
      narrativePOV: 'first-person',
      updatedAt: now + 1,
    })
    await expect(adoptRestoredCreativeRulesCandidateV1({
      projectId: project.id!,
      scope,
      snapshot: prepared.snapshot,
      targetField: 'writingStyle',
      draft: JSON.stringify(candidate()),
    })).rejects.toThrow('创作规则已在候选生成后发生变化')
    expect((await db.creativeRules.get(rulesId))?.writingStyle).toBe('克制、具体，以行动代替解释。')

    const adoptOutput = vi.fn()
    const staleNode = createCreativeRulesCopilotNodeV1(prepared.input, {
      readCurrent: async () => ({ ...prepared.snapshot, serialized: 'changed' }),
      adoptOutput,
    })
    await expect(adoptGenerationNodeOutput(staleNode, candidate())).rejects.toThrow('创作规则已在候选生成后发生变化')
    expect(adoptOutput).not.toHaveBeenCalled()
  })

  it('真实主 Agent 和 durable 恢复只调用一次模型，编辑确认后签发可失效终态回执', async () => {
    const { project, scope, rulesId } = await seedWorkspace()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      expect(prompt).toContain('创作规则候选硬约束')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(candidate()) } }],
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const direct = await executeMasterAgentPlan({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    expect(direct[0].payload).toMatchObject({
      skillId: 'world-origin.creative-rules',
      creativeRulesField: 'writingStyle',
      workspaceScope: scope,
    })
    expect(direct[0].runtimeNode.kind).toBe('world-foundation.creative-rules')
    expect((await db.creativeRules.get(rulesId))?.writingStyle).toBe('克制、具体，以行动代替解释。')

    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      scope,
      worldGroupId: null,
    })
    const run = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    const restored = await restoreMasterAgentCandidatesV1({ scope, runId: run.runId })
    expect(restored.candidates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const revised = candidate('作者确认：用克制短句呈现压力，只写视角人物可感知的信息，避免全知说明。')
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
    expect(adoption.message).toBe('创作规则“写作风格”已写入项目。')
    expect((await db.creativeRules.get(rulesId))?.writingStyle).toBe(revised.value)
    const verified = await verifyMasterAgentRunV1({ scope, runId: run.runId })
    expect(verified.accepted).toBe(true)
    expect(verified.receipt?.receiptHash).toMatch(/^[a-f0-9]{64}$/)

    const secondRun = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    const secondRestored = await restoreMasterAgentCandidatesV1({ scope, runId: secondRun.runId })
    const secondRevision = candidate('第二次作者确认：保持限知和短句，所有判断都必须落到视角人物可见的动作证据。')
    await updateAgentEventCandidate(
      secondRestored.candidates[0].event.id!,
      project.id!,
      JSON.stringify(secondRevision, null, 2),
      scope,
    )
    await commitMasterAgentCandidateAdoptionV1({
      scope,
      runId: secondRun.runId,
      candidateEventId: secondRestored.candidates[0].event.id!,
    })
    await db.creativeRules.update(rulesId, {
      writingStyle: '外部篡改',
      updatedAt: now + 2,
    })
    const tampered = await verifyMasterAgentRunV1({ scope, runId: secondRun.runId })
    expect(tampered.accepted).toBe(false)
    expect(tampered.codes).toContain('creative-rules-1:post-state-mismatch')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
