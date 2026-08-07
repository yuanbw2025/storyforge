import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  buildMasterAgentRunContractV1,
  hashMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: `world-${label}`,
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `world-${label}`,
    name: `${label}世界`,
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: label,
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
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  return { scope: { projectId, worldId, workId }, worldGroupId }
}

function plan(): MasterAgentPlan {
  return {
    summary: '先建立世界来源，再生成角色候选。',
    tasks: [
      { id: 'world-1', agentId: 'world-origin', instruction: '建立潮汐世界的来源。', dependsOn: [] },
      { id: 'character-1', agentId: 'character', instruction: '根据世界来源生成守灯人。', dependsOn: ['world-1'] },
    ],
  }
}

function fakeExecutor(input: {
  failAfterTask?: string
  calls: ReturnType<typeof vi.fn>
}) {
  return async (options: any): Promise<void> => {
    for (const task of options.plan.tasks) {
      if (options.completedTaskOutputs?.[task.id]) continue
      input.calls(task.id)
      await options.executionTrace.taskStarted(task)
      const output = task.agentId === 'world-origin'
        ? '潮汐由沉睡的海神维持。'
        : JSON.stringify({ name: '守灯人', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', relationships: '守护潮门' })
      const reservation = options.budget.reserveCall({
        label: task.id,
        messages: [{ role: 'user', content: task.instruction }],
        maxOutputTokens: 100,
      })
      options.budget.settleCall(reservation, output)
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          label: task.agentId,
          contextSources: ['worldview'],
          baseSnapshot: {},
          workspaceScope: options.scope,
          dependsOnTaskIds: task.dependsOn,
        },
        draft: output,
        runtimeNode: {} as any,
        runtimeOutput: output,
      })
      if (input.failAfterTask === task.id) throw new Error('模拟宿主中断')
    }
  }
}

describe.sequential('R-HARNESS1-master-durable-orchestrator · 主 Agent durable 编排', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('从三注册表派生多领域契约，候选只写入对话和 run ledger', async () => {
    const fixture = await createWorkspace('契约')
    const evidence = new AgentTeamBudgetTracker('balanced').snapshot()
    const contract = buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: plan(),
      budgetEvidence: evidence,
    })
    expect(contract.workflowKind).toBe('multi-domain-sequential')
    expect(contract.permissions.contextSourceKeys).toEqual(expect.arrayContaining([
      'worldview', 'powerSystem', 'characters', 'characterRelations',
    ]))
    expect(contract.permissions.writeTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'worldviews', fields: ['worldOrigin'] }),
      expect.objectContaining({ table: 'characters' }),
    ]))

    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const calls = vi.fn()
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls }) as any })

    expect(result.projection.state).toBe('awaiting_confirmation')
    expect(result.candidates).toHaveLength(2)
    expect(calls).toHaveBeenCalledTimes(2)
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
    const ledger = await readAgentRunV1(fixture.scope, result.runId)
    expect(ledger.events.map(event => event.type)).toContain('candidate.persisted')
    expect(JSON.stringify(ledger)).not.toContain('潮汐由沉睡的海神')
  })

  it('首任务候选原子持久化后中断，恢复只调用剩余任务并恢复累计预算', async () => {
    const fixture = await createWorkspace('恢复')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const calls = vi.fn()
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ failAfterTask: 'world-1', calls }) as any })).rejects.toThrow('模拟宿主中断')
    const run = (await db.agentRuns.toArray())[0]
    expect(run.status).toBe('paused')
    const candidateEvents = (await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')
    expect(candidateEvents).toHaveLength(1)
    const before = await readAgentRunV1(fixture.scope, run.id!)
    expect(before.projection.steps['master:world-1']).toMatchObject({ status: 'awaiting_confirmation' })

    const resumedCalls = vi.fn()
    const resumed = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId: run.id,
    }, { execute: fakeExecutor({ calls: resumedCalls }) as any })
    expect(resumed.projection.state).toBe('awaiting_confirmation')
    expect(resumed.candidates).toHaveLength(2)
    expect(resumedCalls).toHaveBeenCalledTimes(1)
    expect(resumedCalls).toHaveBeenCalledWith('character-1')
    expect(resumed.budgetEvidence.calls).toBe(2)
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
  })

  it('候选、计划和检查点被篡改时均拒绝恢复', async () => {
    const fixture = await createWorkspace('篡改')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const calls = vi.fn()
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ failAfterTask: 'world-1', calls }) as any })).rejects.toThrow()
    const run = (await db.agentRuns.toArray())[0]
    const candidate = (await db.agentEvents.toArray()).find(event => event.kind === 'candidate')!
    await db.agentEvents.update(candidate.id!, { content: `${candidate.content} 被改写` })
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId: run.id,
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })).rejects.toThrow(/candidateHash/)

    const latest = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.id!)
    expect(latest).not.toBeNull()
    await db.agentEvents.update(candidate.id!, { content: candidate.content })
    await db.agentRunCheckpoints.update(latest!.checkpoint.id, {
      resumePayloadJson: JSON.stringify({
        version: 1,
        kind: 'master-agent-plan',
        plan: { ...plan(), summary: '被篡改的计划' },
        planHash: await hashMasterAgentPlanV1(plan()),
        budgetEvidence: new AgentTeamBudgetTracker('balanced').snapshot(),
      }),
    })
    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.id!)).rejects.toThrow()
  })
})
