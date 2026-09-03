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
  hashMasterAgentPlanV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
  MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
  MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1,
  type MasterAgentPlanCheckpointV1,
} from '../../src/lib/agent/run/master-durable'
import { acceptAgentRunContractV1 } from '../../src/lib/agent/run/contract'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'

const plan: MasterAgentPlan = {
  summary: '补全潮汐世界来源。',
  tasks: [{
    id: 'world-1',
    agentId: 'world-origin',
    skillId: 'world-origin.complete',
    instruction: '补全潮汐世界来源',
    dependsOn: [],
  }],
}

async function createWorkspace(): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'H18 版本绑定',
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
    code: 'h18-world',
    name: 'H18 世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: 'H18 作品',
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

async function createConversation(scope: WorkspaceScope): Promise<number> {
  const conversation = await getOrCreateAgentConversation({
    projectId: scope.projectId,
    scope,
    worldGroupId: null,
  })
  return conversation.id
}

function contract(includeExecutionBindings = true) {
  return buildMasterAgentRunContractV1({
    scope: { projectId: 1, worldId: 2, workId: 3 },
    worldGroupId: null,
    plan,
    budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
    includeExecutionBindings,
  })
}

function generationDependency(scope: WorkspaceScope) {
  return {
    execute: async (options: Parameters<NonNullable<Parameters<typeof runDurableMasterAgentPlanV1>[1]['execute']>>[0]) => {
      const task = options.plan.tasks[0]
      await options.executionTrace?.taskStarted?.(task)
      await options.executionTrace?.candidateReady?.(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: '潮汐世界来源',
          contextSources: ['worldview'],
          baseSnapshot: {},
          dependsOnTaskIds: [],
          workspaceScope: scope,
          teamBudgetEvidence: options.budget.snapshot(),
        },
        draft: '世界由周期性潮汐塑造。',
        runtimeNode: {} as any,
        runtimeOutput: '世界由周期性潮汐塑造。',
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
      ...createAgentSkillExecutionBindingV1(getAgentSkillV1('world-origin.complete')),
    })
    expect(binding.toolSchemaVersion).toBe(AGENT_TOOL_SCHEMA_VERSION_V1)
    expect(binding.toolSchemaHash).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(await verifyAgentToolSchemaBindingV1()).toBe(true)

    const accepted = await acceptAgentRunContractV1(current)
    const acceptedLegacy = await acceptAgentRunContractV1(contract(false))
    expect(accepted.contractHash).not.toBe(acceptedLegacy.contractHash)
  })

  it('Prompt、Tool hash 或 Skill 身份被篡改时拒绝执行与恢复', () => {
    const current = contract()
    expect(() => assertMasterAgentRunContractExecutionBindingsV1(current, plan)).not.toThrow()

    for (const bindingPatch of [
      { promptVersion: 'world-origin-copilot-v999' },
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
    expect(candidate.payload.executionBinding?.promptVersion).toBe('world-origin-copilot-v1')

    const { candidateHash, executionBinding, ...payloadWithoutHashOrBinding } = candidate.payload
    expect(await hashCanonicalValue({
      draft: candidate.draft,
      payload: { ...payloadWithoutHashOrBinding, executionBinding },
    })).toBe(candidateHash)
    expect(await hashCanonicalValue({
      draft: candidate.draft,
      payload: payloadWithoutHashOrBinding,
    })).not.toBe(candidateHash)

    const tampered = JSON.parse(candidate.event.payload)
    tampered.executionBinding.promptVersion = 'world-origin-copilot-v999'
    await db.agentEvents.update(candidate.event.id!, { payload: JSON.stringify(tampered) })
    await expect(restoreMasterAgentCandidatesV1({ scope, runId: result.runId }))
      .rejects.toThrow('与当前 Skill/Prompt/Tool 版本不一致')
  })

  it('HARNESS-18 前的旧 RunContract 与无 binding 候选仍可实际生成和恢复', async () => {
    const scope = await createWorkspace()
    const conversationId = await createConversation(scope)
    const budgetEvidence = new AgentTeamBudgetTracker('balanced').snapshot()
    const legacyContract = buildMasterAgentRunContractV1({
      scope,
      worldGroupId: null,
      plan,
      budgetEvidence,
      includeExecutionBindings: false,
    })
    let snapshot = await createAgentRunV1({
      scope,
      worldGroupId: null,
      conversationId,
      contract: legacyContract,
    })
    snapshot = await appendAgentRunEventV1({
      scope,
      runId: snapshot.run.id,
      type: 'step.scheduled',
      payload: { stepId: 'master:world-1' },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    const checkpoint: MasterAgentPlanCheckpointV1 = {
      version: MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1,
      kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
      plan,
      planHash: await hashMasterAgentPlanV1(plan),
      budgetEvidence,
    }
    const saved = await createAgentRunCheckpointV1({
      scope,
      runId: snapshot.run.id,
      resumePayload: checkpoint,
      expectedLastSequence: snapshot.projection.lastSequence,
    })

    const resumed = await runDurableMasterAgentPlanV1({
      scope,
      worldGroupId: null,
      runId: saved.snapshot.run.id,
    }, generationDependency(scope))
    expect(resumed.candidates[0].payload.executionBinding).toBeUndefined()

    const restored = await restoreMasterAgentCandidatesV1({ scope, runId: resumed.runId })
    expect(restored.snapshot.contract.executionBindings).toBeUndefined()
    expect(restored.candidates[0].payload.executionBinding).toBeUndefined()
    expect(restored.candidates[0].draft).toBe('世界由周期性潮汐塑造。')
  })
})
