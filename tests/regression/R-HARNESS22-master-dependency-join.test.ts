import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
} from '../../src/lib/agent/run/master-adoption'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'
import { prepareRequiredMasterGatewayFixtureV1 } from '../helpers/master-agent-gateway'
import { createWorkspace as createCurrentWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import {
  currentWorldOriginCandidateFixtureV1,
  currentWorldOriginDraftV1,
} from '../helpers/current-worldview-field'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const created = await createCurrentWorkspace({
    name: label,
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    enableMultiWorld: true,
  }, { kind: 'novel', novelProfile: 'long' })
  const worldGroupId = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
    projectId: created.scope.projectId,
    name: '主世界',
    type: 'primary',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' })) as number
  return { scope: created.scope, worldGroupId }
}

function plan(): MasterAgentPlan {
  return {
    summary: '先建立世界来源，再生成角色候选。',
    workflow: {
      version: 1,
      workflowId: 'multi-domain-sequential',
      reasonCodes: ['multiple-explicit-domains'],
    },
    tasks: [
      { id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '建立潮汐世界的来源。', dependsOn: [] },
      { id: 'character-1', agentId: 'character', skillId: 'character.create', instruction: '根据世界来源生成守灯人。', dependsOn: ['world-1'] },
    ],
  }
}

function stagedPlan(): MasterAgentPlan {
  return {
    ...plan(),
    workflow: {
      version: 1,
      workflowId: 'staged-author-confirmed',
      reasonCodes: ['outline-prose-confirmation-barrier', 'multiple-explicit-domains'],
    },
  }
}

async function executeFixture(options: any): Promise<void> {
  for (const task of options.plan.tasks) {
    if (options.completedTaskOutputs?.[task.id]) continue
    await emitFixtureTask(options, task)
  }
}

async function emitFixtureTask(options: any, task: MasterAgentPlan['tasks'][number]): Promise<void> {
  await options.executionTrace.taskStarted(task)
  const worldCandidate = task.agentId === 'world-origin'
    ? currentWorldOriginCandidateFixtureV1('潮汐由沉睡的海神维持。')
    : null
  const output = worldCandidate
    ? worldCandidate.draft
    : JSON.stringify({
        name: '守灯人',
        roleWeight: 'main',
        moralAxis: 'good',
        orderAxis: 'lawful',
        relationships: '守护潮门',
        shortDescription: '潮门最后一位守灯人。',
      })
  const reservation = options.budget.reserveCall({
    label: task.id,
    messages: [{ role: 'user', content: task.instruction }],
    maxOutputTokens: 100,
  })
  options.budget.settleCall(reservation, output)
  const gateway = await prepareRequiredMasterGatewayFixtureV1({
    scope: options.scope,
    worldGroupId: options.worldGroupId,
    executionTrace: options.executionTrace,
  }, task, output)
  await options.executionTrace.candidateReady(task, {
    payload: {
      version: 1,
      taskId: task.id,
      agentId: task.agentId,
      skillId: task.skillId,
      label: task.agentId,
      contextSources: gateway.contextSources,
      contextEvidence: gateway.contextEvidence,
      ...(worldCandidate?.payload ?? { baseSnapshot: { serialized: '[]', visibleNames: [] } }),
      workspaceScope: options.scope,
      dependsOnTaskIds: task.dependsOn,
    },
    draft: output,
    runtimeNode: {} as any,
    runtimeOutput: worldCandidate?.runtimeOutput ?? output,
    contextGatewayRuntime: gateway.contextGatewayRuntime,
  })
}

async function createRun(label: string) {
  const fixture = await createWorkspace(label)
  const conversation = await getOrCreateAgentConversation({
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    scope: fixture.scope,
    purpose: 'master-authoring',
  })
  const result = await runDurableMasterAgentPlanV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    conversationId: conversation.id,
    plan: plan(),
    budget: new AgentTeamBudgetTracker('balanced'),
  }, { execute: executeFixture as any })
  const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
  const character = result.candidates.find(candidate => candidate.payload.taskId === 'character-1')!
  return { fixture, result, world, character }
}

describe.sequential('R-HARNESS22 · 主 Agent 同代依赖 join', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('下游候选冻结同 Run、同 generation 的上游 candidate/output hash，且不能提前确认', async () => {
    const { fixture, result, world, character } = await createRun('冻结依赖')
    expect(character.payload.runGeneration).toBe(1)
    expect(character.payload.dependencyBindings).toEqual([{
      taskId: 'world-1',
      candidateHash: world.payload.candidateHash,
      outputHash: await hashCanonicalValue(world.draft),
      generation: 1,
    }])

    await expect(beginMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      purpose: 'master-authoring',
      runId: result.runId,
      candidateEventId: character.event.id!,
    })).rejects.toThrow('请先完成采纳')
    const downstreamStep = (await readAgentRunV1(fixture.scope, result.runId))
      .projection.steps['master:character-1']
    expect(downstreamStep.status).toBe('awaiting_confirmation')
    expect(downstreamStep.confirmation).toBeUndefined()
  })

  it('作者确认分阶段工作流在上游采纳前不启动下游，采纳后从最新 Canon 继续', async () => {
    const fixture = await createWorkspace('分阶段确认屏障')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    const started: string[] = []
    const observedCanon: string[] = []
    const executeStaged = async (options: any): Promise<void> => {
      const confirmed = new Set<string>(options.authorConfirmedTaskIds ?? [])
      for (const task of options.plan.tasks) {
        if (options.completedTaskOutputs?.[task.id]) continue
        if (task.dependsOn.some((taskId: string) => !confirmed.has(taskId))) continue
        started.push(task.id)
        if (task.id === 'character-1') {
          observedCanon.push((await db.worldviews.toArray())[0]?.worldOrigin ?? '')
        }
        await emitFixtureTask(options, task)
      }
    }

    const first = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: stagedPlan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: executeStaged as any })
    expect(started).toEqual(['world-1'])
    expect(first.candidates.map(item => item.payload.taskId)).toEqual(['world-1'])
    expect(first.projection.steps['master:character-1']).toMatchObject({ status: 'scheduled', attempt: 0 })

    const world = first.candidates[0]
    const revisedWorldValue = '潮汐改由月轮与海底钟阵共同维持，旧海神只是失真的民间传说。'
    const revisedWorld = currentWorldOriginDraftV1(revisedWorldValue)
    await updateAgentEventCandidate(
      world.event.id!,
      fixture.scope.projectId,
      revisedWorld,
      fixture.scope,
    )
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: first.runId,
      candidateEventId: world.event.id!,
    })

    const resumed = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId: first.runId,
    }, { execute: executeStaged as any })
    expect(started).toEqual(['world-1', 'character-1'])
    expect(observedCanon).toEqual([revisedWorldValue])
    expect(resumed.candidates.map(item => item.payload.taskId)).toEqual(['world-1', 'character-1'])
  })

  it('durable trace 对绕过分阶段屏障的执行器 fail-closed，且下游没有 model.requested', async () => {
    const fixture = await createWorkspace('恶意绕过分阶段屏障')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: stagedPlan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, {
      execute: (async (options: any) => {
        await emitFixtureTask(options, options.plan.tasks[0])
        await options.executionTrace.taskStarted(options.plan.tasks[1])
      }) as any,
    })).rejects.toThrow('尚未完成作者采纳')

    const run = (await db.agentRuns.toArray())[0]
    const snapshot = await readAgentRunV1(fixture.scope, run.id!)
    expect(snapshot.events.some(event => (
      event.type === 'model.requested'
      && event.payload.stepId === 'master:character-1'
    ))).toBe(false)
  })

  it('作者编辑上游后可完成上游采纳，但旧版本生成的下游被确定性阻断', async () => {
    const { fixture, result, world, character } = await createRun('上游修订')
    await updateAgentEventCandidate(
      world.event.id!,
      fixture.scope.projectId,
      currentWorldOriginDraftV1('潮汐改由月轮与海底钟阵共同维持。'),
      fixture.scope,
    )
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    const revisedWorld = restored.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    expect(revisedWorld.payload.candidateHash).not.toBe(world.payload.candidateHash)
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: revisedWorld.event.id!,
    })

    await expect(beginMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: character.event.id!,
    })).rejects.toThrow('冻结候选版本已经变化')
    expect(await db.characters.count()).toBe(0)
  })

  it('上游版本未变化且已正式采纳时，下游仍可按原作者确认边界写入', async () => {
    const { fixture, result, world, character } = await createRun('有效依赖')
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: world.event.id!,
    })
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: character.event.id!,
    })
    expect(await db.characters.count()).toBe(1)
    expect((await readAgentRunV1(fixture.scope, result.runId)).projection.steps['master:character-1'])
      .toMatchObject({ status: 'succeeded', confirmation: 'adopt' })
  })

  it('缺少当前 generation 与依赖清单的候选不能恢复', async () => {
    const fixture = await createWorkspace('损坏候选拒绝')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: plan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    }, {
      execute: (async (options: any) => {
        await emitFixtureTask(options, options.plan.tasks[0])
        const worldEvent = (await db.agentEvents.toArray()).find(event => event.kind === 'candidate')!
        const incompletePayload = JSON.parse(worldEvent.payload) as Record<string, unknown>
        delete incompletePayload.runGeneration
        delete incompletePayload.dependencyBindings
        await db.agentEvents.update(worldEvent.id!, { payload: JSON.stringify(incompletePayload) })
        await updateAgentEventCandidate(
          worldEvent.id!,
          fixture.scope.projectId,
          worldEvent.content,
          fixture.scope,
        )
        throw new Error('模拟宿主中断')
      }) as any,
    })).rejects.toThrow('模拟宿主中断')

    const run = (await db.agentRuns.toArray())[0]

    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId: run.id!,
    }, { execute: executeFixture as any })).rejects.toThrow(/runGeneration|dependencyBindings/)
  })
})
