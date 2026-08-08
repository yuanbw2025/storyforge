import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  replanDurableMasterAgentRunV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { classifyAgentRunFailureV1 } from '../../src/lib/agent/run/failure-policy'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  conversationId: number
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
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const scope = { projectId, worldId, workId }
  const conversation = await getOrCreateAgentConversation({
    projectId,
    worldGroupId,
    scope,
  })
  return { scope, worldGroupId, conversationId: conversation.id! }
}

function plan(): MasterAgentPlan {
  return {
    summary: '建立潮汐世界，再生成守灯人和卷纲。',
    tasks: [
      { id: 'world-1', agentId: 'world-origin', instruction: '建立潮汐世界。', dependsOn: [] },
      { id: 'character-1', agentId: 'character', instruction: '按旧策略生成守灯人。', dependsOn: ['world-1'] },
      { id: 'outline-1', agentId: 'outline', instruction: '根据守灯人规划卷纲。', dependsOn: ['character-1'] },
    ],
  }
}

function revisedPlan(): MasterAgentPlan {
  return {
    ...plan(),
    summary: '保留潮汐世界，调整守灯人及其下游规划。',
    tasks: plan().tasks.map(task => task.id === 'character-1'
      ? { ...task, instruction: '改用角色欲望、阻力和代价三段式生成守灯人。' }
      : task),
  }
}

function outputFor(taskId: string): string {
  if (taskId === 'world-1') return '潮汐由沉睡海神维持。'
  if (taskId === 'character-1') return JSON.stringify({ name: '守灯人', desire: '守住潮门' })
  return JSON.stringify([{ title: '潮门初启', summary: '守灯人发现潮门正在失控。' }])
}

function executor(input: {
  failOldCharacter?: boolean
  failAllCharacters?: boolean
  calls?: ReturnType<typeof vi.fn>
}) {
  return async (options: any): Promise<void> => {
    for (const task of options.plan.tasks) {
      if (options.completedTaskOutputs?.[task.id]) continue
      input.calls?.(task.id, task.instruction)
      await options.executionTrace.taskStarted(task)
      const reservation = options.budget.reserveCall({
        label: task.id,
        messages: [{ role: 'user', content: task.instruction }],
        maxOutputTokens: 100,
      })
      if (
        (input.failAllCharacters || input.failOldCharacter)
        && task.id === 'character-1'
        && (input.failAllCharacters || task.instruction.includes('旧策略'))
      ) {
        options.budget.settleFailedCall(reservation)
        throw new Error('network socket unavailable while generating character')
      }
      const output = outputFor(task.id)
      options.budget.settleCall(reservation, output)
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          label: task.agentId,
          contextSources: ['worldview'],
          baseSnapshot: task.id === 'world-1'
            ? { id: null, updatedAt: null, worldOrigin: '' }
            : {},
          workspaceScope: options.scope,
          dependsOnTaskIds: task.dependsOn,
        },
        draft: output,
        runtimeNode: {},
        runtimeOutput: output,
      })
    }
  }
}

describe.sequential('R-HARNESS24 · 有限重规划与局部 stale', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('失败分类稳定且把临时错误、协议错误和 stale 输入分流到不同动作', async () => {
    const transient = await classifyAgentRunFailureV1(new Error('network timeout 12345'))
    const sameTransient = await classifyAgentRunFailureV1(new Error('network timeout 98765'))
    const protocol = await classifyAgentRunFailureV1(new SyntaxError('JSON 解析失败'))
    const stale = await classifyAgentRunFailureV1(new Error('上游依赖快照已变化'))

    expect(transient).toMatchObject({ category: 'transient', action: 'retry', retryable: true })
    expect(sameTransient.fingerprint).toBe(transient.fingerprint)
    expect(protocol).toMatchObject({ category: 'protocol', action: 'retry' })
    expect(stale).toMatchObject({ category: 'stale-input', action: 'replan', retryable: false })
  })

  it('同一失败第二次出现后自动换代，只重跑失败分支并显式保留上游候选', async () => {
    const fixture = await createWorkspace('自动重规划')
    const calls = vi.fn()
    let runId = 0
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: fixture.conversationId,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
      onDurableBoundary: boundary => { runId = boundary.runId },
    }, {
      execute: executor({ failOldCharacter: true, calls }) as any,
    })).rejects.toThrow('network socket unavailable')

    const first = await readAgentRunV1(fixture.scope, runId)
    expect(first.projection.state).toBe('paused')
    expect(first.projection.steps['master:world-1']?.status).toBe('awaiting_confirmation')
    expect(first.projection.steps['master:character-1']?.failureCode).toBe('provider_transient')
    expect(first.contract.budget.maxReplans).toBe(1)

    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId,
    }, {
      execute: executor({ failOldCharacter: true, calls }) as any,
      replan: async input => {
        const reservation = input.budget.reserveCall({
          label: 'test-replan',
          messages: [{ role: 'user', content: 'replan' }],
          maxOutputTokens: 100,
        })
        input.budget.settleCall(reservation, JSON.stringify(revisedPlan()))
        return revisedPlan()
      },
    })

    expect(result.projection).toMatchObject({ generation: 2, state: 'awaiting_confirmation' })
    expect(result.candidates.map(candidate => candidate.payload.taskId)).toEqual([
      'world-1', 'character-1', 'outline-1',
    ])
    const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    const character = result.candidates.find(candidate => candidate.payload.taskId === 'character-1')!
    expect(world.payload.runGeneration).toBe(1)
    expect(character.payload.runGeneration).toBe(2)
    expect(character.payload.dependencyBindings?.[0]).toMatchObject({
      taskId: 'world-1',
      candidateHash: world.payload.candidateHash,
      generation: 2,
    })
    const snapshot = await readAgentRunV1(fixture.scope, runId)
    expect(snapshot.events.filter(event => event.type === 'step.failed').map(event => (
      event.type === 'step.failed' ? event.payload.action : null
    ))).toEqual(['retry', 'replan'])
    expect(snapshot.events.filter(event => event.type === 'plan.replanned')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'candidate.carried-forward')).toHaveLength(1)
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')).toHaveLength(3)
    expect(result.budgetEvidence.calls).toBe(6)
  })

  it('显式重规划把受影响候选留在历史并局部 stale，不暂停仍有效候选', async () => {
    const fixture = await createWorkspace('局部 stale')
    const generated = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: fixture.conversationId,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: executor({}) as any })
    const paused = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: generated.runId,
      type: 'run.paused',
      payload: { reason: 'author_requested_replan', recoverable: true },
      expectedLastSequence: generated.projection.lastSequence,
    })
    const fingerprint = 'f'.repeat(64)
    const replanned = await replanDurableMasterAgentRunV1({
      scope: fixture.scope,
      runId: generated.runId,
      nextPlan: revisedPlan(),
      rootTaskIds: ['character-1'],
      failures: [{
        taskId: 'character-1',
        code: 'author_steering',
        category: 'deterministic',
        fingerprint,
      }],
      budgetEvidence: generated.budgetEvidence,
      reasonCode: 'author_steering',
    })

    expect(paused.projection.state).toBe('paused')
    expect(replanned.projection).toMatchObject({ generation: 2, state: 'running' })
    expect(replanned.projection.steps['master:world-1']?.status).toBe('awaiting_confirmation')
    expect(replanned.projection.steps['master:character-1']?.status).toBe('scheduled')
    expect(replanned.projection.steps['master:outline-1']?.status).toBe('scheduled')
    expect(replanned.events.filter(event => event.type === 'candidate.staled')).toHaveLength(2)
    expect(replanned.events.filter(event => event.type === 'candidate.carried-forward')).toHaveLength(1)

    const restored = await restoreMasterAgentCandidatesV1({
      scope: fixture.scope,
      runId: generated.runId,
    })
    expect(restored.candidates.map(candidate => candidate.payload.taskId)).toEqual(['world-1'])
    const confirmations = (await db.agentEvents.toArray()).filter(event => event.kind === 'confirmation')
    expect(confirmations).toHaveLength(2)
    expect(confirmations.every(event => JSON.parse(event.payload).decision === 'staled')).toBe(true)
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
    expect(await db.outlineNodes.count()).toBe(0)
  })

  it('新代执行失败保持新计划检查点，第二次同错耗尽 replan 后进入明确终态', async () => {
    const fixture = await createWorkspace('重规划额度')
    let runId = 0
    const dependencies = {
      execute: executor({ failAllCharacters: true }) as any,
      replan: async (input: Parameters<NonNullable<Parameters<typeof runDurableMasterAgentPlanV1>[1]['replan']>>[0]) => {
        const reservation = input.budget.reserveCall({
          label: 'test-replan-limit',
          messages: [{ role: 'user', content: 'replan' }],
          maxOutputTokens: 100,
        })
        input.budget.settleCall(reservation, JSON.stringify(revisedPlan()))
        return revisedPlan()
      },
    }
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: fixture.conversationId,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
      onDurableBoundary: boundary => { runId = boundary.runId },
    }, dependencies)).rejects.toThrow('network socket unavailable')

    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId,
    }, dependencies)).rejects.toThrow('network socket unavailable')
    const generationTwo = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId })
    expect(generationTwo.snapshot.projection).toMatchObject({ generation: 2, state: 'paused' })
    expect(generationTwo.plan.tasks.find(task => task.id === 'character-1')?.instruction)
      .toContain('三段式')
    expect(generationTwo.candidates.map(candidate => candidate.payload.taskId)).toEqual(['world-1'])

    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId,
    }, dependencies)).rejects.toThrow('network socket unavailable')
    const exhausted = await readAgentRunV1(fixture.scope, runId)
    expect(exhausted.projection).toMatchObject({ generation: 2, state: 'failed' })
    expect(exhausted.events.filter(event => event.type === 'plan.replanned')).toHaveLength(1)
    expect(exhausted.events.at(-1)).toMatchObject({
      type: 'budget.exhausted',
      payload: { resource: 'replans' },
    })
  })
})
