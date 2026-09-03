import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  MASTER_WORKFLOWS,
  MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY,
  MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY,
  assertMasterWorkflowTaskCompatibilityV1,
  classifyMasterWorkflowV1,
  parseMasterWorkflowSelectionV1,
  selectAgentSkillIdV1,
  selectMasterWorkflowV1,
  validateMasterWorkflowDefinitionsV1,
} from '../../src/lib/agent/workflow-catalog'
import {
  buildMasterAgentRunContractV1,
  parseMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'

const directWorkflow = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

async function createWorkspace(): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'H14 工作流',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'h14-world',
    name: 'H14 世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: 'H14 作品',
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
  return { projectId, worldId, workId }
}

describe.sequential('R-HARNESS14 · 固定工作流分类与 Skill 冻结', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY)
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
    db.close()
  })

  it('固定 catalog 的 ID 唯一，明确单领域、多领域、确认屏障和模糊请求分类稳定', () => {
    expect(new Set(MASTER_WORKFLOWS.map(workflow => workflow.id)).size).toBe(MASTER_WORKFLOWS.length)
    expect(() => validateMasterWorkflowDefinitionsV1(MASTER_WORKFLOWS)).not.toThrow()
    expect(classifyMasterWorkflowV1('规划三卷卷纲')).toMatchObject({
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    })
    expect(classifyMasterWorkflowV1('建立潮汐世界并设计守灯人角色').workflowId)
      .toBe('multi-domain-sequential')
    expect(classifyMasterWorkflowV1('同时建立潮汐世界并反推已保存灵感')).toMatchObject({
      workflowId: 'multi-domain-fan-out',
      reasonCodes: ['explicit-independent-fan-out', 'multiple-explicit-domains'],
    })
    expect(classifyMasterWorkflowV1('同时反推灵感并规划第一卷大纲').workflowId)
      .toBe('multi-domain-sequential')
    expect(classifyMasterWorkflowV1('先规划第一卷章纲，再写第一章正文').workflowId)
      .toBe('staged-author-confirmed')
    expect(classifyMasterWorkflowV1('以守灯人视角写第一章正文')).toMatchObject({
      workflowId: 'conservative-sequential',
      reasonCodes: ['perspective-resolution-required', 'single-explicit-domain'],
    })
    expect(classifyMasterWorkflowV1('帮我处理一下').workflowId).toBe('conservative-sequential')
  })

  it('分类器可回滚到保守顺序路径，且不会改变固定 catalog', () => {
    globalThis.localStorage?.setItem(MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY, 'disabled')
    expect(selectMasterWorkflowV1('规划三卷卷纲')).toEqual({
      version: 1,
      workflowId: 'conservative-sequential',
      reasonCodes: ['classifier-disabled'],
    })
    expect(MASTER_WORKFLOWS.map(workflow => workflow.id)).toContain('single-domain-direct')

    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY)
    globalThis.localStorage?.setItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY, 'disabled')
    expect(selectMasterWorkflowV1('同时建立潮汐世界并反推已保存灵感')).toEqual({
      version: 1,
      workflowId: 'multi-domain-sequential',
      reasonCodes: ['fan-out-disabled', 'multiple-explicit-domains'],
    })
  })

  it('大纲和正文的真实执行模式映射为不同 Skill，普通 Agent 使用稳定默认职责', () => {
    expect(selectAgentSkillIdV1('outline', '规划全书三卷卷纲')).toBe('outline.volumes')
    expect(selectAgentSkillIdV1('outline', '把第一卷展开为章节大纲')).toBe('outline.chapters')
    expect(selectAgentSkillIdV1('outline', '完善现有大纲')).toBe('outline.compose')
    expect(selectAgentSkillIdV1('prose', '写第一章正文')).toBe('prose.generate')
    expect(selectAgentSkillIdV1('prose', '继续写第一章')).toBe('prose.continue')
    expect(selectAgentSkillIdV1('character', '设计主角')).toBe('character.create')
  })

  it('新单领域计划从冻结 Skill 派生最小权限并使用 direct RunContract', () => {
    const plan = parseMasterAgentPlanV1({
      summary: '展开第一卷章纲。',
      tasks: [{
        id: 'outline-1',
        agentId: 'outline',
        skillId: 'outline.chapters',
        instruction: '把第一卷展开为章节大纲',
        dependsOn: [],
      }],
      workflow: directWorkflow,
    })
    const contract = buildMasterAgentRunContractV1({
      scope: { projectId: 1, worldId: 2, workId: 3 },
      worldGroupId: null,
      plan,
      budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
    })
    expect(contract.workflowKind).toBe('direct-generation')
    expect(contract.permissions.contextSourceKeys).toEqual(['ragSelection'])
    expect(contract.permissions.writeTargets).toEqual([
      {
        table: 'outlineNodes',
        fields: ['parentId', 'type', 'title', 'summary', 'order'],
        mode: 'author-confirmed',
      },
    ])
  })

  it('旧计划不被补写新字段，继续保持原 plan hash 结构和顺序工作流语义', () => {
    const legacy = {
      summary: '建立世界来源。',
      tasks: [{
        id: 'world-1',
        agentId: 'world-origin',
        instruction: '建立潮汐世界来源',
        dependsOn: [],
      }],
    }
    const parsed = parseMasterAgentPlanV1(legacy)
    expect(parsed).toEqual(legacy)
    expect(buildMasterAgentRunContractV1({
      scope: { projectId: 1, worldId: 2, workId: 3 },
      worldGroupId: null,
      plan: parsed,
      budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
    }).workflowKind).toBe('multi-domain-sequential')
  })

  it('未知 workflow、跨 Agent Skill 和 direct 多任务都 fail-closed', () => {
    expect(() => validateMasterWorkflowDefinitionsV1([
      ...MASTER_WORKFLOWS,
      MASTER_WORKFLOWS[0],
    ])).toThrow('ID 重复')
    expect(() => parseMasterWorkflowSelectionV1({
      version: 1,
      workflowId: 'model-invented-workflow',
      reasonCodes: ['single-explicit-domain'],
    })).toThrow('workflow 版本或 ID 无效')
    expect(() => parseMasterAgentPlanV1({
      summary: '越权计划。',
      tasks: [{
        id: 'outline-1',
        agentId: 'outline',
        skillId: 'prose.generate',
        instruction: '生成大纲',
        dependsOn: [],
      }],
      workflow: directWorkflow,
    })).toThrow('不属于 Agent outline')
    expect(() => assertMasterWorkflowTaskCompatibilityV1(directWorkflow, [
      { agentId: 'world-origin' },
      { agentId: 'character' },
    ])).toThrow('必须且只能包含一个任务')

    expect(() => parseMasterAgentPlanV1({
      summary: '伪并行依赖链。',
      tasks: [
        { id: 'world', agentId: 'world-origin', instruction: '生成世界', dependsOn: [] },
        { id: 'character', agentId: 'character', instruction: '生成角色', dependsOn: ['world'] },
      ],
      workflow: {
        version: 1,
        workflowId: 'multi-domain-fan-out',
        reasonCodes: ['explicit-independent-fan-out'],
      },
    })).toThrow('至少需要一对')

    expect(() => parseMasterAgentPlanV1({
      summary: '共享写目标的伪并行。',
      tasks: [
        { id: 'world-a', agentId: 'world-origin', instruction: '生成世界甲', dependsOn: [] },
        { id: 'world-b', agentId: 'world-origin', instruction: '生成世界乙', dependsOn: [] },
      ],
      workflow: {
        version: 1,
        workflowId: 'multi-domain-fan-out',
        reasonCodes: ['explicit-independent-fan-out'],
      },
    })).toThrow('写目标不冲突')
  })

  it('durable trace 拒绝 Skill 与实际输出模式不一致的候选', async () => {
    const scope = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: scope.projectId,
      scope,
      worldGroupId: null,
    })
    const plan: MasterAgentPlan = {
      summary: '展开章纲。',
      tasks: [{
        id: 'outline-1',
        agentId: 'outline',
        skillId: 'outline.chapters',
        instruction: '展开第一卷章纲',
        dependsOn: [],
      }],
      workflow: directWorkflow,
    }
    await expect(runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId: conversation.id,
      plan,
      budget: new AgentTeamBudgetTracker('balanced'),
    }, {
      execute: async options => {
        const task = options.plan.tasks[0]
        await options.executionTrace?.taskStarted?.(task)
        await options.executionTrace?.candidateReady?.(task, {
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: 'outline.chapters',
            label: '错误卷纲',
            contextSources: ['worldview'],
            baseSnapshot: {},
            outlineMode: 'volumes',
            outlineParentId: null,
            dependsOnTaskIds: [],
            workspaceScope: scope,
            teamBudgetEvidence: options.budget.snapshot(),
          },
          draft: JSON.stringify([{ title: '第一卷', summary: '错误模式' }]),
          runtimeNode: {} as any,
          runtimeOutput: [],
        })
      },
    })).rejects.toThrow('大纲模式与 Skill 不一致')
    expect(await db.outlineNodes.count()).toBe(0)
  })
})
