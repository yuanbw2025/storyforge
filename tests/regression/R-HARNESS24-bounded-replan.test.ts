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
import { createMasterAgentReplanV1, type MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'
import { prepareRequiredMasterGatewayFixtureV1 } from '../helpers/master-agent-gateway'
import { resolveAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { currentWorldOriginCandidateFixtureV1 } from '../helpers/current-worldview-field'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  conversationId: number
}> {
  const now = Date.now()
  const { scope } = await seedCurrentWorkspace(label)
  const { projectId } = scope
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId,
    name: '主世界',
    type: 'primary',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const conversation = await getOrCreateAgentConversation({
    projectId,
    worldGroupId,
    scope,
    purpose: 'bounded-replan-evaluation',
  })
  return { scope, worldGroupId, conversationId: conversation.id! }
}

function plan(): MasterAgentPlan {
  return {
    summary: '建立潮汐世界，再生成守灯人和卷纲。',
    tasks: [
      { id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '建立潮汐世界。', dependsOn: [] },
      { id: 'character-1', agentId: 'character', skillId: 'character.create', instruction: '按基线策略生成守灯人。', dependsOn: ['world-1'] },
      { id: 'outline-1', agentId: 'outline', skillId: 'outline.compose', instruction: '根据守灯人规划卷纲。', dependsOn: ['character-1'] },
    ],
    workflow: {
      version: 1,
      workflowId: 'multi-domain-sequential',
      reasonCodes: ['multiple-explicit-domains'],
    },
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
  if (taskId === 'world-1') return currentWorldOriginCandidateFixtureV1('潮汐由沉睡海神维持。').draft
  if (taskId === 'character-1') return JSON.stringify({ name: '守灯人', desire: '守住潮门' })
  return JSON.stringify([{ title: '潮门初启', summary: '守灯人发现潮门正在失控。' }])
}

function executor(input: {
  failBaselineCharacter?: boolean
  failAllCharacters?: boolean
  calls?: (taskId: string, instruction: string) => void
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
        (input.failAllCharacters || input.failBaselineCharacter)
        && task.id === 'character-1'
        && (input.failAllCharacters || task.instruction.includes('基线策略'))
      ) {
        options.budget.settleFailedCall(reservation)
        throw new Error('network socket unavailable while generating character')
      }
      const output = outputFor(task.id)
      const worldCandidate = task.id === 'world-1'
        ? currentWorldOriginCandidateFixtureV1('潮汐由沉睡海神维持。')
        : null
      options.budget.settleCall(reservation, output)
      const skill = resolveAgentSkillV1(task.agentId, task.skillId)
      const gateway = skill.contextGateway?.rollout === 'required'
        ? await prepareRequiredMasterGatewayFixtureV1({
            scope: options.scope,
            worldGroupId: options.worldGroupId,
            executionTrace: options.executionTrace,
          }, task, output)
        : undefined
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: task.agentId,
          contextSources: gateway?.contextSources ?? ['worldview'],
          ...(gateway ? { contextEvidence: gateway.contextEvidence } : {}),
          ...(worldCandidate?.payload ?? { baseSnapshot: {} }),
          workspaceScope: options.scope,
          dependsOnTaskIds: task.dependsOn,
        },
        draft: output,
        runtimeNode: {},
        runtimeOutput: worldCandidate?.runtimeOutput ?? output,
        ...(gateway ? { contextGatewayRuntime: gateway.contextGatewayRuntime } : {}),
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

  it('模型重规划保留长指令、长摘要和六条有效依赖，并忽略未授权分支修改', async () => {
    const upstreamIds = Array.from({ length: 6 }, (_, index) => `world-${index + 1}`)
    const original: MasterAgentPlan = {
      summary: '先完成六项设定，再设计守灯人。',
      tasks: [
        ...upstreamIds.map(id => ({
          id, agentId: 'world-origin' as const, skillId: 'world-origin.worldview-field' as const,
          instruction: `保留 ${id} 的原始要求。`, dependsOn: [],
        })),
        { id: 'hero', agentId: 'character', skillId: 'character.create', instruction: '旧角色策略。', dependsOn: upstreamIds },
      ],
      workflow: { version: 1, workflowId: 'multi-domain-sequential', reasonCodes: ['multiple-explicit-domains'] },
    }
    const instruction = `改用新的角色策略。${'必须保留的细节。'.repeat(220)}末尾硬约束：不得改名。`
    const summary = `${'完整说明本次修订原因。'.repeat(80)}修订摘要尾部。`
    const budget = new AgentTeamBudgetTracker('service-capacity')
    const complete = vi.fn(async () => JSON.stringify({
      summary,
      tasks: [
        { id: 'hero', instruction, dependsOn: [...upstreamIds, 'missing', 'hero'] },
        { id: 'world-1', instruction: '不得执行的越权上游修改', dependsOn: [] },
      ],
    }))
    const revised = await createMasterAgentReplanV1({
      projectId: 1, plan: original, budget,
      failures: [{ taskId: 'hero', code: 'provider_transient', category: 'transient', fingerprint: 'f'.repeat(64) }],
    }, { complete })

    expect(complete).toHaveBeenCalledOnce()
    expect(revised.summary).toBe(summary)
    expect(revised.tasks[6].instruction).toBe(instruction)
    expect(revised.tasks[6].dependsOn).toEqual(upstreamIds)
    expect(revised.tasks.slice(0, 6)).toEqual(original.tasks.slice(0, 6))
    expect(original.tasks[6].instruction).toBe('旧角色策略。')
    expect(budget.snapshot().calls).toBe(1)
  })

  it('重规划继续拒绝循环依赖，错误结果不会隐藏重发', async () => {
    const budget = new AgentTeamBudgetTracker('service-capacity')
    const complete = vi.fn(async () => JSON.stringify({
      summary: '非法循环。',
      tasks: [{ id: 'character-1', instruction: '改用新的策略。', dependsOn: ['outline-1'] }],
    }))
    await expect(createMasterAgentReplanV1({
      projectId: 1, plan: plan(), budget,
      failures: [{ taskId: 'character-1', code: 'provider_transient', category: 'transient', fingerprint: 'f'.repeat(64) }],
    }, { complete })).rejects.toThrow('循环依赖')
    expect(complete).toHaveBeenCalledOnce()
    expect(budget.snapshot().calls).toBe(1)
  })

  it('未知失败任务在重规划请求前拒绝且不消耗调用', async () => {
    const budget = new AgentTeamBudgetTracker('service-capacity')
    const complete = vi.fn(async () => '{}')
    await expect(createMasterAgentReplanV1({
      projectId: 1, plan: plan(), budget,
      failures: [{ taskId: 'missing', code: 'provider_transient', category: 'transient', fingerprint: 'f'.repeat(64) }],
    }, { complete })).rejects.toThrow('未知任务')
    expect(complete).not.toHaveBeenCalled()
    expect(budget.snapshot().calls).toBe(0)
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
      execute: executor({ failBaselineCharacter: true, calls }) as any,
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
      execute: executor({ failBaselineCharacter: true, calls }) as any,
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
    expect(exhausted.events.at(-2)).toMatchObject({
      type: 'budget.exhausted',
      payload: { resource: 'replans' },
    })
    expect(exhausted.events.at(-1)).toMatchObject({
      type: 'memory.settlement.recorded',
      payload: { state: 'incomplete', terminalReceiptHash: null, workspaceDirty: true },
    })
  })
})
