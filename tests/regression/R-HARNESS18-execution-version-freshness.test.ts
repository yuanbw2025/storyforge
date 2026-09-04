import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  AGENT_TOOL_SCHEMA_HASH_V1,
  AGENT_TOOL_SCHEMA_VERSION_V1,
  createAgentSkillExecutionBindingV1,
  verifyAgentToolSchemaBindingV1,
} from '../../src/lib/agent/execution-binding'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import {
  assertMasterAgentRunContractExecutionBindingsV1,
  buildMasterAgentRunContractV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { acceptAgentRunContractV1 } from '../../src/lib/agent/run/contract'
import { computeMasterCandidateHashV1 } from '../../src/lib/agent/run/master-candidate-hash'
import { createWorkspace as createCurrentWorkspace } from '../../src/lib/workspace/create-workspace'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'
import { currentWorldOriginCandidateFixtureV1 } from '../helpers/current-worldview-field'
import { prepareRequiredMasterGatewayFixtureV1 } from '../helpers/master-agent-gateway'

const plan: MasterAgentPlan = {
  summary: '补全潮汐世界来源。',
  workflow: {
    version: 1,
    workflowId: 'single-domain-direct',
    reasonCodes: ['single-explicit-domain'],
  },
  tasks: [{
    id: 'world-1',
    agentId: 'world-origin',
    skillId: 'world-origin.worldview-field',
    instruction: '补全潮汐世界来源',
    dependsOn: [],
  }],
}

async function createWorkspace(): Promise<WorkspaceScope> {
  return (await createCurrentWorkspace({
    name: 'H18 版本绑定',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    enableMultiWorld: false,
  }, { kind: 'novel', novelProfile: 'long' })).scope
}

async function createConversation(scope: WorkspaceScope): Promise<number> {
  const conversation = await getOrCreateAgentConversation({
    projectId: scope.projectId,
    scope,
    worldGroupId: null,
    purpose: 'master-authoring',
  })
  return conversation.id
}

function contract() {
  return buildMasterAgentRunContractV1({
    scope: { projectId: 1, worldId: 2, workId: 3 },
    worldGroupId: null,
    plan,
    budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
  })
}

function generationDependency(scope: WorkspaceScope) {
  return {
    execute: async (options: Parameters<NonNullable<Parameters<typeof runDurableMasterAgentPlanV1>[1]['execute']>>[0]) => {
      const task = options.plan.tasks[0]
      const currentWorld = currentWorldOriginCandidateFixtureV1('世界由周期性潮汐塑造。')
      await options.executionTrace?.taskStarted?.(task)
      const gateway = await prepareRequiredMasterGatewayFixtureV1({
        scope: options.scope,
        worldGroupId: options.worldGroupId,
        executionTrace: options.executionTrace!,
      }, task, currentWorld.draft)
      await options.executionTrace?.candidateReady?.(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: '潮汐世界来源',
          contextSources: gateway.contextSources,
          contextEvidence: gateway.contextEvidence,
          ...currentWorld.payload,
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
        },
        draft: currentWorld.draft,
        runtimeNode: {} as any,
        runtimeOutput: currentWorld.runtimeOutput,
        contextGatewayRuntime: gateway.contextGatewayRuntime,
      })
    },
  }
}

describe.sequential('R-HARNESS18 · Skill、Prompt 与 Tool 执行版本绑定', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('新 RunContract 为每个任务冻结当前 Skill、Prompt 和 Tool schema 版本', async () => {
    const current = contract()
    const binding = current.executionBindings[0]
    expect(binding).toEqual({
      stepId: 'master:world-1',
      ...createAgentSkillExecutionBindingV1(getAgentSkillV1('world-origin.worldview-field')),
    })
    expect(binding.toolSchemaVersion).toBe(AGENT_TOOL_SCHEMA_VERSION_V1)
    expect(binding.toolSchemaHash).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(await verifyAgentToolSchemaBindingV1()).toBe(true)

    const accepted = await acceptAgentRunContractV1(current)
    expect(accepted.contractHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('Prompt、Tool hash 或 Skill 身份被篡改时拒绝执行与恢复', () => {
    const current = contract()
    expect(() => assertMasterAgentRunContractExecutionBindingsV1(current, plan)).not.toThrow()

    for (const bindingPatch of [
      { promptVersion: 'worldview-field-copilot-v999' },
      { toolSchemaHash: 'f'.repeat(64) },
      { skillId: 'character.create' },
    ]) {
      const tampered = structuredClone(current)
      Object.assign(tampered.executionBindings[0], bindingPatch)
      expect(() => assertMasterAgentRunContractExecutionBindingsV1(tampered, plan))
        .toThrow('与当前 Skill/Prompt/Tool 版本不一致')
    }
  })

  it('新候选的完整性哈希包含 execution binding，恢复时拒绝被改写的版本', async () => {
    const scope = await createWorkspace()
    const conversationId = await createConversation(scope)
    const result = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      conversationId,
      plan,
      budget: new AgentTeamBudgetTracker('balanced'),
    }, generationDependency(scope))
    const candidate = result.candidates[0]
    expect(candidate.payload.executionBinding?.promptVersion).toBe('worldview-field-copilot-v1')

    const { executionBinding: _executionBinding, ...payloadWithoutBinding } = candidate.payload
    expect(await computeMasterCandidateHashV1(candidate.payload, candidate.draft))
      .toBe(candidate.payload.candidateHash)
    expect(await computeMasterCandidateHashV1(
      payloadWithoutBinding as typeof candidate.payload,
      candidate.draft,
    )).not.toBe(candidate.payload.candidateHash)

    const tampered = JSON.parse(candidate.event.payload)
    tampered.executionBinding.promptVersion = 'worldview-field-copilot-v999'
    await db.agentEvents.update(candidate.event.id!, { payload: JSON.stringify(tampered) })
    await expect(restoreMasterAgentCandidatesV1({ scope, runId: result.runId }))
      .rejects.toThrow('与当前 Skill/Prompt/Tool 版本不一致')
  })

  it('缺少当前 Skill 执行绑定的 RunContract 被拒绝', async () => {
    const { executionBindings: _removed, ...unbound } = contract()
    await expect(acceptAgentRunContractV1(unbound)).rejects.toThrow('必须冻结 runtimeBindingHash 或 executionBindings')
  })
})
