import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../src/lib/agent/conversations'
import {
  buildMasterAgentRunContractV1,
  hashMasterAgentPlanV1,
  parseMasterAgentPlanV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
  type MasterAgentDurableDependenciesV1,
} from '../../src/lib/agent/run/master-durable'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
  recoverPendingMasterAgentAdoptionsV1,
} from '../../src/lib/agent/run/master-adoption'
import { adoptMasterCandidate } from '../../src/lib/agent/orchestrator'
import { selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { prepareProseCopilot, runProseCreativeReliabilityV1 } from '../../src/lib/agent/prose-copilot'
import { adopt } from '../../src/lib/registry/adopt'
import { countWords, htmlToPlainText } from '../../src/lib/utils/html'
import { plainTextToHtml } from '../../src/lib/utils/html'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import {
  configureHarnessFaultInjectionV1,
  resetHarnessFaultInjectionV1,
} from '../../src/lib/agent/dev-fault-injection'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { ExecutedMasterCandidate, MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'
import { prepareRequiredMasterGatewayFixtureV1 } from '../helpers/master-agent-gateway'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import {
  currentWorldOriginCandidateFixtureV1,
  currentWorldOriginDraftV1,
} from '../helpers/current-worldview-field'

const DIRECT_WORKFLOW = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

const SEQUENTIAL_WORKFLOW = {
  version: 1 as const,
  workflowId: 'multi-domain-sequential' as const,
  reasonCodes: ['multiple-explicit-domains' as const],
}

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label, { enableMultiWorld: true })
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
    tasks: [
      { id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '建立潮汐世界的来源。', dependsOn: [] },
      { id: 'character-1', agentId: 'character', skillId: 'character.create', instruction: '根据世界来源生成守灯人。', dependsOn: ['world-1'] },
    ],
    workflow: SEQUENTIAL_WORKFLOW,
  }
}

function fakeExecutor(input: {
  failAfterTask?: string
  calls: (taskId: string) => void
}) {
  return async (options: any): Promise<void> => {
    for (const task of options.plan.tasks) {
      if (options.completedTaskOutputs?.[task.id]) continue
      input.calls(task.id)
      await options.executionTrace.taskStarted(task)
      const worldCandidate = task.agentId === 'world-origin'
        ? currentWorldOriginCandidateFixtureV1('潮汐由沉睡的海神维持。')
        : null
      const output = worldCandidate
        ? worldCandidate.draft
        : JSON.stringify({ name: '守灯人', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', relationships: '守护潮门' })
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
          ...(worldCandidate?.payload ?? { baseSnapshot: {} }),
          workspaceScope: options.scope,
          dependsOnTaskIds: task.dependsOn,
        },
        draft: output,
        runtimeNode: {} as any,
        runtimeOutput: worldCandidate?.runtimeOutput ?? output,
        contextGatewayRuntime: gateway.contextGatewayRuntime,
      })
      if (input.failAfterTask === task.id) throw new Error('模拟宿主中断')
    }
  }
}

function longDraft(label: string): string {
  return `${label}。潮声从城墙外一层层压来，守门人握紧手中的灯柄，记起今日必须完成的约定。`
    .repeat(3)
}

describe.sequential('R-HARNESS1-master-durable-orchestrator · 主 Agent durable 编排', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    resetHarnessFaultInjectionV1()
    db.close()
  })

  it('正文视角进入严格计划契约并决定角色认知读取权限', async () => {
    const fixture = await createWorkspace('视角契约')
    const budgetEvidence = new AgentTeamBudgetTracker('balanced').snapshot()
    const withPerspective = parseMasterAgentPlanV1({
      summary: '以守灯人视角生成正文。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        skillId: 'prose.write',
        instruction: '写第一章正文。',
        dependsOn: [],
        perspectiveCharacterId: 7,
      }],
      workflow: DIRECT_WORKFLOW,
    })
    const withoutPerspective = parseMasterAgentPlanV1({
      summary: '生成正文，但不猜测叙事视角。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        skillId: 'prose.write',
        instruction: '写第一章正文。',
        dependsOn: [],
      }],
      workflow: DIRECT_WORKFLOW,
    })

    expect(withPerspective.tasks[0].perspectiveCharacterId).toBe(7)
    expect(buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: withPerspective,
      budgetEvidence,
    }).permissions.contextSourceKeys).toEqual(['ragSelection', 'workAuthoringIntent'])
    expect(buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: withoutPerspective,
      budgetEvidence,
    }).permissions.contextSourceKeys).toEqual(['ragSelection', 'workAuthoringIntent'])
    expect(() => parseMasterAgentPlanV1({
      summary: '无效视角。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        skillId: 'prose.write',
        instruction: '写第一章正文。',
        dependsOn: [],
        perspectiveCharacterId: 0,
      }],
      workflow: DIRECT_WORKFLOW,
    })).toThrow('perspectiveCharacterId 无效')
  })

  it('持久计划读入保留超过五个任务、六条依赖、长摘要及完整长文本', () => {
    const instruction = `基础要求。${'完整细节。'.repeat(1_700)}尾部约束：禁止遗失。`
    const upstreamIds = Array.from({ length: 6 }, (_, index) => `world-${index + 1}`)
    const original: MasterAgentPlan = {
      summary: `${'完整计划说明。'.repeat(100)}摘要尾部。`,
      tasks: [
        ...upstreamIds.map(id => ({
          id, agentId: 'world-origin' as const, skillId: 'world-origin.worldview-field' as const,
          instruction, dependsOn: [],
          requestContext: { originalRequest: instruction, plannerInstruction: instruction },
        })),
        { id: 'hero', agentId: 'character', skillId: 'character.create', instruction, dependsOn: upstreamIds },
      ],
      workflow: SEQUENTIAL_WORKFLOW,
    }
    const parsed = parseMasterAgentPlanV1(original)
    expect(parsed).toEqual(original)
    expect(parsed.tasks[6].dependsOn).toHaveLength(6)
    expect(parsed.tasks[0].requestContext?.originalRequest).toBe(instruction)
  })

  it('持久计划读入接受长的无环依赖链', () => {
    const tasks: MasterAgentPlan['tasks'] = Array.from({ length: 2_048 }, (_, index) => ({
      id: `world-${index}`, agentId: 'world-origin', skillId: 'world-origin.worldview-field',
      instruction: `补充第 ${index} 项世界来源。`,
      dependsOn: index === 0 ? [] : [`world-${index - 1}`],
    }))
    const parsed = parseMasterAgentPlanV1({ summary: '完整依赖链。', tasks, workflow: SEQUENTIAL_WORKFLOW })
    expect(parsed.tasks).toEqual(tasks)
  })

  it.each([
    { label: '重复任务 ID', mutate: (value: MasterAgentPlan) => { value.tasks[1].id = value.tasks[0].id }, error: '重复任务 ID' },
    { label: '不存在的依赖', mutate: (value: MasterAgentPlan) => { value.tasks[1].dependsOn = ['missing-task'] }, error: '依赖不存在的任务' },
    { label: '自身依赖', mutate: (value: MasterAgentPlan) => { value.tasks[0].dependsOn = [value.tasks[0].id] }, error: '不得依赖自身' },
    { label: '循环依赖', mutate: (value: MasterAgentPlan) => { value.tasks[0].dependsOn = [value.tasks[1].id] }, error: '循环依赖' },
    { label: '空白任务内容', mutate: (value: MasterAgentPlan) => { value.tasks[0].instruction = ' \n\t ' }, error: 'instruction' },
    { label: '空白摘要', mutate: (value: MasterAgentPlan) => { value.summary = ' \n\t ' }, error: 'summary' },
  ])('取消内容配额后严格读入仍拒绝$label', ({ mutate, error }) => {
    const invalid = plan()
    mutate(invalid)
    expect(() => parseMasterAgentPlanV1(invalid)).toThrow(error)
  })

  it('旧冻结计划的空白、换行和固定哈希保持兼容', async () => {
    const legacy: MasterAgentPlan = {
      summary: '  历史计划\r\n保留缩进  ',
      tasks: [
        {
          id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field',
          instruction: ' \n建立潮汐世界。\t ', dependsOn: [],
          requestContext: { originalRequest: ' 作者原话\r\n尾部留白 ', plannerInstruction: ' \t保留规划原文\n ' },
        },
        {
          id: 'character-1', agentId: 'character', skillId: 'character.create',
          instruction: '  根据世界来源生成守灯人。\n', dependsOn: ['world-1'],
        },
      ],
      workflow: SEQUENTIAL_WORKFLOW,
    }
    expect(parseMasterAgentPlanV1(legacy)).toEqual(legacy)
    // 固定值来自修改前 reader 的原样文本与 canonical JSON，不随新实现重新生成期望值。
    expect(await hashMasterAgentPlanV1(legacy)).toBe('f977315cb8fc6a4c8fa056c9290f0a4667123b27ee3ddf38bca1f4fda9fb1ce7')
  })

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
      'worldview', 'powerSystem', 'characters', 'ragSelection',
    ]))
    expect(contract.permissions.writeTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'worldviews', fields: ['worldOrigin'] }),
      expect.objectContaining({ table: 'characters' }),
    ]))

    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
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
    expect(result.candidates.every(candidate => candidate.payload.contextManifestHash?.length === 64)).toBe(true)
  })

  it('新运行默认无内部总额度，超过七次和旧最高总量后仍保留候选及恢复证据', async () => {
    const fixture = await createWorkspace('实际容量新运行')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId, scope: fixture.scope,
      worldGroupId: fixture.worldGroupId, purpose: 'master-authoring',
    })
    const execute = vi.fn(async (options: any) => {
      for (let index = 0; index < 8; index += 1) {
        const reservation = options.budget.reserveCall({
          label: `已完成资料处理${index}`,
          messages: [{ role: 'user', content: '完整材料'.repeat(20_000) }],
          maxOutputTokens: 100,
        })
        options.budget.settleCall(reservation, '已完成资料处理')
      }
      return fakeExecutor({ calls: vi.fn() })(options)
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id, plan: plan(),
    }, { execute: execute as any })
    expect(result.budgetEvidence).toMatchObject({ profile: 'service-capacity', calls: 10 })
    expect(result.budgetEvidence.usedTokens).toBeGreaterThan(240_000)
    expect(result.projection.state).toBe('awaiting_confirmation')
    expect(result.candidates).toHaveLength(2)
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(restored.candidates).toHaveLength(2)
    expect(restored.budgetEvidence).toEqual(result.budgetEvidence)
    const reread = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(reread.budgetEvidence).toEqual(result.budgetEvidence)
    expect(execute).toHaveBeenCalledOnce()
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
  })

  it('候选持久化前故障零候选，持久化后故障保留可恢复候选且不写 Canon', async () => {
    const beforeFixture = await createWorkspace('候选前故障')
    const beforeConversation = await getOrCreateAgentConversation({
      projectId: beforeFixture.scope.projectId,
      worldGroupId: beforeFixture.worldGroupId,
      scope: beforeFixture.scope,
      purpose: 'master-authoring',
    })
    configureHarnessFaultInjectionV1(['candidate.before-persist'])
    await expect(runDurableMasterAgentPlanV1({
      scope: beforeFixture.scope,
      worldGroupId: beforeFixture.worldGroupId,
      conversationId: beforeConversation.id,
      plan: {
        summary: '建立世界。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })).rejects.toThrow('candidate.before-persist')
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')).toHaveLength(0)
    expect(await db.worldviews.count()).toBe(0)

    resetHarnessFaultInjectionV1()
    await db.delete()
    await db.open()
    const afterFixture = await createWorkspace('候选后故障')
    const afterConversation = await getOrCreateAgentConversation({
      projectId: afterFixture.scope.projectId,
      worldGroupId: afterFixture.worldGroupId,
      scope: afterFixture.scope,
      purpose: 'master-authoring',
    })
    configureHarnessFaultInjectionV1(['candidate.after-persist'])
    await expect(runDurableMasterAgentPlanV1({
      scope: afterFixture.scope,
      worldGroupId: afterFixture.worldGroupId,
      conversationId: afterConversation.id,
      plan: {
        summary: '建立世界。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })).rejects.toThrow('candidate.after-persist')
    const run = (await db.agentRuns.toArray())[0]
    resetHarnessFaultInjectionV1()
    const restored = await restoreMasterAgentCandidatesV1({ scope: afterFixture.scope, runId: run.id! })
    expect(restored.candidates).toHaveLength(1)
    expect(restored.candidates[0].payload.contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.worldviews.count()).toBe(0)
  })

  it('首任务候选原子持久化后中断，恢复只调用剩余任务并恢复累计预算', async () => {
    const fixture = await createWorkspace('恢复')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
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
    const afterResume = await readAgentRunV1(fixture.scope, run.id!)
    expect(resumed.budgetEvidence.profile).toBe('balanced')
    expect(afterResume.run.contractHash).toBe(before.run.contractHash)
    expect(afterResume.contract.budget.serviceCapacityOnly).toBeUndefined()
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
  })

  it('候选、计划和检查点被篡改时均拒绝恢复', async () => {
    const fixture = await createWorkspace('篡改')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
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

  it('确认与采纳沿 candidateHash 推进，重复确认和重复提交不重复写入', async () => {
    const fixture = await createWorkspace('采纳')
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
      plan: {
        summary: '建立世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成世界来源。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })
    const candidate = result.candidates[0]
    const ref = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
    }
    await beginMasterAgentCandidateAdoptionV1(ref)
    await beginMasterAgentCandidateAdoptionV1(ref)
    let snapshot = await readAgentRunV1(fixture.scope, result.runId)
    expect(snapshot.projection.steps['master:world-1']).toMatchObject({
      status: 'running',
      confirmation: 'adopt',
      candidateHash: candidate.payload.candidateHash,
    })
    const committed = await commitMasterAgentCandidateAdoptionV1(ref)
    expect(committed.message).toContain('世界基座')
    snapshot = await readAgentRunV1(fixture.scope, result.runId)
    expect(snapshot.projection.steps['master:world-1']).toMatchObject({
      status: 'succeeded',
      confirmation: 'adopt',
      adoptionHash: committed.adoptionHash,
    })
    expect(snapshot.events.map(event => event.type).slice(-4)).toEqual([
      'confirmation.recorded',
      'adoption.started',
      'adoption.committed',
      'step.succeeded',
    ])
    expect((await db.agentEvents.where('conversationId').equals(conversation.id!).toArray())
      .filter(event => event.kind === 'confirmation')).toHaveLength(1)
    expect((await db.worldviews.toArray()).map(row => row.worldOrigin)).toEqual(['潮汐由沉睡的海神维持。'])
    const repeated = await commitMasterAgentCandidateAdoptionV1(ref)
    expect(repeated.adoptionHash).toBe(committed.adoptionHash)
    expect((await readAgentRunV1(fixture.scope, result.runId)).events.map(event => event.type))
      .toEqual(snapshot.events.map(event => event.type))
  })

  it('作者编辑 durable 候选后追加修订证据，刷新恢复仍可按新 hash 采纳', async () => {
    const fixture = await createWorkspace('候选修订')
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
      plan: {
        summary: '建立可修订的世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成世界来源。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })
    const original = result.candidates[0]
    const revisedValue = '作者确认后的潮汐世界来源。'
    const revisedDraft = currentWorldOriginDraftV1(revisedValue)

    await updateAgentEventCandidate(
      original.event.id!,
      fixture.scope.projectId,
      revisedDraft,
      fixture.scope,
    )

    const restoredEvents = await readAgentEvents(conversation.id!, fixture.scope)
    const revised = restoredEvents.find(event => event.id === original.event.id)
    expect(revised?.content).toBe(revisedDraft)
    expect((await readAgentRunV1(fixture.scope, result.runId)).events
      .filter(event => event.type === 'candidate.revised')).toHaveLength(1)
    const restoredCandidate = await restoreMasterAgentCandidatesV1({
      scope: fixture.scope,
      runId: result.runId,
    })
    expect(restoredCandidate.candidates[0].draft).toBe(revisedDraft)
    expect(restoredCandidate.snapshot.projection.steps['master:world-1'].candidateHash)
      .toBe(restoredCandidate.candidates[0].payload.candidateHash)

    const committed = await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: original.event.id!,
    })
    expect(committed.message).toContain('世界基座')
    expect((await db.worldviews.toArray()).map(row => row.worldOrigin)).toEqual([revisedValue])
  })

  it('业务写入后宿主中断，恢复扫描只补齐采纳证据，不重复写业务', async () => {
    const fixture = await createWorkspace('采纳恢复')
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
      plan: {
        summary: '建立世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成世界来源。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })
    const candidate = result.candidates[0]
    const ref = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
    }
    await beginMasterAgentCandidateAdoptionV1(ref)
    await adoptMasterCandidate({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      event: candidate.event,
      payload: candidate.payload,
      draft: candidate.draft,
    })
    expect(await db.worldviews.count()).toBe(1)
    const recovered = await recoverPendingMasterAgentAdoptionsV1(fixture.scope)
    expect(recovered).toEqual({ recoveredRunIds: [result.runId], failed: [] })
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    expect(snapshot.projection.steps['master:world-1']).toMatchObject({
      status: 'succeeded',
      confirmation: 'adopt',
    })
    expect(await recoverPendingMasterAgentAdoptionsV1(fixture.scope))
      .toEqual({ recoveredRunIds: [], failed: [] })
    expect(await db.worldviews.count()).toBe(1)
  })

  it('标准采纳/终态故障点保持零越权写入，并可从 ledger 补齐回执', async () => {
    const fixture = await createWorkspace('标准故障恢复')
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
      plan: {
        summary: '建立世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', skillId: 'world-origin.worldview-field', instruction: '生成世界来源。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })
    const ref = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: result.candidates[0].event.id!,
    }

    configureHarnessFaultInjectionV1(['adoption.before-write'])
    await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('adoption.before-write')
    expect(await db.worldviews.count()).toBe(0)

    configureHarnessFaultInjectionV1(['adoption.after-write'])
    await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('adoption.after-write')
    expect(await db.worldviews.count()).toBe(1)
    expect((await readAgentRunV1(fixture.scope, result.runId)).projection.steps['master:world-1'])
      .toMatchObject({ status: 'running', confirmation: 'adopt' })

    resetHarnessFaultInjectionV1()
    expect(await recoverPendingMasterAgentAdoptionsV1(fixture.scope))
      .toEqual({ recoveredRunIds: [result.runId], failed: [] })
    expect(await db.worldviews.count()).toBe(1)

    configureHarnessFaultInjectionV1(['terminal.after-receipt'])
    await expect(verifyMasterAgentRunV1({ scope: fixture.scope, runId: result.runId }))
      .rejects.toThrow('terminal.after-receipt')
    const completed = await readAgentRunV1(fixture.scope, result.runId)
    expect(completed.projection).toMatchObject({ state: 'completed' })
    expect(completed.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)

    resetHarnessFaultInjectionV1()
    const replayed = await verifyMasterAgentRunV1({ scope: fixture.scope, runId: result.runId })
    expect(replayed.accepted).toBe(true)
    expect(replayed.snapshot.projection.terminalReceiptHash).toBe(completed.projection.terminalReceiptHash)
  })

  it('大纲部分写入后恢复只补齐缺项，不产生重复条目', async () => {
    const fixture = await createWorkspace('大纲部分恢复')
    await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
    const volumeId = await db.outlineNodes.add({
      projectId: fixture.scope.projectId,
      worldId: null,
      workId: fixture.scope.workId,
      worldGroupId: fixture.worldGroupId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '潮门即将关闭。',
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number
    await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
    const prepared = await prepareOutlineCopilot({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      authorRequest: '展开第一卷章节大纲',
    })
    const items = [
      { title: '潮门关闭', summary: '城门在潮汐前关闭，守灯人被迫留下。' },
      { title: '最后一班船', summary: '守灯人发现仍有一艘船没有返航。' },
    ]
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
      plan: {
        summary: '生成第一卷章节大纲。',
        tasks: [{ id: 'outline-1', agentId: 'outline', skillId: 'outline.compose', instruction: '生成两个章节。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: async (options: any) => {
      const task = options.plan.tasks[0]
      await options.executionTrace.taskStarted(task)
      const reservation = options.budget.reserveCall({
        label: task.id,
        messages: [{ role: 'user', content: task.instruction }],
        maxOutputTokens: 100,
      })
      const draft = JSON.stringify(items)
      options.budget.settleCall(reservation, draft)
      // Exercise the real outline preparation policy, not a test-only Gateway
      // rebuilt from task.skillId (which hid the compose/volumes mismatch).
      const renderedRequest = [{ role: 'user' as const, content: task.instruction }]
      const execution = prepared.contextGatewayExecution
      const assembled = prepared.input.assembled
      await options.executionTrace.contextGatewayPrepared(task, { execution, assembled, renderedRequest })
      const gateway = {
        contextSources: prepared.contextSources,
        contextEvidence: prepared.contextEvidence,
        contextGatewayRuntime: { execution, assembled, renderedRequest, rawResponse: draft },
      }
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: '章节大纲',
          contextSources: gateway.contextSources,
          contextEvidence: gateway.contextEvidence,
          baseSnapshot: prepared.snapshot,
          outlineMode: prepared.mode,
          outlineParentId: prepared.parentVolumeId,
          workspaceScope: options.scope,
          dependsOnTaskIds: [],
        },
        draft,
        runtimeNode: {} as any,
        runtimeOutput: draft,
        contextGatewayRuntime: gateway.contextGatewayRuntime,
      })
    }})
    const candidate = result.candidates[0]
    const ref = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
      worldGroupId: fixture.worldGroupId,
    }
    await beginMasterAgentCandidateAdoptionV1(ref)
    await adoptGeneratedOutlineItems({
      projectId: fixture.scope.projectId,
      workspaceScope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      parentId: volumeId,
      type: 'chapter',
      items: [items[0]],
      startingOrder: prepared.snapshot.startingOrder,
    })

    const recovered = await recoverPendingMasterAgentAdoptionsV1(fixture.scope)
    expect(recovered).toEqual({ recoveredRunIds: [result.runId], failed: [] })
    const chapters = (await db.outlineNodes.toArray())
      .filter(row => row.type === 'chapter')
      .sort((left, right) => left.order - right.order)
    expect(chapters.map(row => ({ title: row.title, summary: row.summary, order: row.order })))
      .toEqual([
        { title: items[0].title, summary: items[0].summary, order: 0 },
        { title: items[1].title, summary: items[1].summary, order: 1 },
      ])
    expect(await recoverPendingMasterAgentAdoptionsV1(fixture.scope))
      .toEqual({ recoveredRunIds: [], failed: [] })
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(2)
  })

  it('超过20万字符的正文经过真实trace持久化、恢复和默认采用，保留全文且仍拒绝篡改', async () => {
    const fixture = await createWorkspace('长正文正式候选')
    const now = Date.now()
    const volumeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', {
      projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, parentId: null, type: 'volume',
      title: '第一卷', summary: '守灯人寻找潮汐钟。', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    const chapterOutlineId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', {
      projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, parentId: volumeId, type: 'chapter',
      title: '第一章', summary: '守灯人推开木门，沿海堤寻找铜铃。', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
    // 正文非空白字数及显式作者目标都超过20万，不能靠空白计数差绕过门。
    const paragraph = '守灯人沿海堤前行，把铜铃交给邮差，又转身寻找下一条线索。'
    const raw = '【首部】守灯人推开木门，决定沿海堤寻找铜铃。\n'
      + Array.from({ length: 1_000 }, (_, index) => `第${index + 1}次潮汐。${paragraph.repeat(8)}`).join('\n')
      + '\n【尾部】邮差交还铜铃，守灯人带着新的线索离开。'
    const wordCount = countWords(raw)
    expect(raw.length).toBeGreaterThan(200_000)
    expect(wordCount).toBeGreaterThan(200_000)
    const instruction = `写第一章正文，目标字数${wordCount}字，保留完整首尾和段落。`
    const skillId = selectAgentSkillIdV1('prose', instruction)
    expect(skillId).toBe('prose.generate')
    const runAI = vi.fn(async () => raw)
    const prepared = await prepareProseCopilot({
      projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      authorRequest: instruction, skillId, parameterValues: { wordCount },
    }, { runAI })
    expect(prepared.input.parameterValues?.wordCount).toBe(wordCount)
    expect(prepared.prepared.messages.map(message => message.content).join('\n')).toContain(instruction)
    const execute: NonNullable<MasterAgentDurableDependenciesV1['execute']> = async options => {
      const budget = options.budget
      const trace = options.executionTrace
      if (!budget || !trace?.taskStarted || !trace.contextGatewayPrepared
        || !trace.modelCallRequested || !trace.modelCallReturned || !trace.candidateReady) {
        throw new Error('长正文测试必须进入正式Master预算和完整trace')
      }
      const { taskStarted, contextGatewayPrepared, modelCallRequested, modelCallReturned, candidateReady } = trace
      const task = options.plan.tasks[0]
      expect(options.scope).toEqual(fixture.scope)
      await taskStarted(task)
      const gateway = {
        execution: prepared.contextGatewayExecution,
        assembled: prepared.input.assembled,
        renderedRequest: prepared.renderedRequest,
      }
      await contextGatewayPrepared(task, gateway)
      let callIndex = 0
      const runRaw: typeof prepared.runRaw = async (messages, result = {}) => {
        callIndex += 1
        await modelCallRequested(task, { callIndex, messages })
        result.finishReason = 'stop'
        const response = await prepared.runRaw(messages, result)
        await modelCallReturned(task, { callIndex, raw: response.output, result })
        return response
      }
      const result = await runProseCreativeReliabilityV1({
        prepared: { ...prepared, runRaw }, budget, qualityMode: 'economy',
      })
      expect(result.draft).toBe(raw)
      expect(result.artifact.originalText).toBe(raw)
      expect(result.artifact.editableText).toBe(raw)
      expect(result.artifact.validFragments[0]?.text).toBe(raw)
      expect(result.artifact.issues.some(issue => issue.code.startsWith('prose-length-'))).toBe(false)
      const candidate: ExecutedMasterCandidate = {
        payload: {
          version: 1, taskId: task.id, agentId: task.agentId, skillId: task.skillId,
          label: prepared.label, contextSources: prepared.contextSources, contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot, workspaceScope: fixture.scope,
          proseOperation: prepared.operation, proseOutlineNodeId: prepared.outlineNodeId,
          perspectiveCharacterId: prepared.perspectiveCharacterId, dependsOnTaskIds: task.dependsOn,
          creativeArtifact: result.artifact, narrativeBrief: prepared.input.narrativeBrief,
          informationBoundary: prepared.informationBoundary,
        },
        draft: result.draft, runtimeNode: prepared.node, runtimeOutput: result.output,
        contextGatewayRuntime: { ...gateway, rawResponse: result.artifact },
      }
      await candidateReady(task, candidate)
      return [candidate]
    }
    const executeSpy = vi.fn(execute)
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      purpose: 'master-authoring',
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, conversationId: conversation.id,
      plan: {
        summary: '完整生成第一章正文。',
        tasks: [{ id: 'prose-1', agentId: 'prose', skillId, instruction, dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
    }, { execute: executeSpy })
    expect(result.projection.state).toBe('awaiting_confirmation')
    expect(result.budgetEvidence).toMatchObject({ profile: 'service-capacity', calls: 1 })
    expect(await db.chapters.count()).toBe(0)
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    const candidateEventId = candidate.event.id
    const frozenHash = candidate.payload.candidateHash
    if (candidateEventId == null || !frozenHash) throw new Error('正式长候选缺少持久身份')
    const frozenPayload = candidate.event.payload
    expect(candidate.draft).toBe(raw)
    expect(candidate.event.content).toBe(raw)
    expect(frozenHash).toMatch(/^[a-f0-9]{64}$/)
    const ledger = await readAgentRunV1(fixture.scope, result.runId)
    const rawEvent = ledger.events.find(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'raw-response')
    if (rawEvent?.type !== 'evidence.artifact.recorded') throw new Error('正式trace未保存原响应')
    const rawEvidence: unknown = JSON.parse(await readAgentRunArtifactExactV1({
      projectId: fixture.scope.projectId, artifactKind: 'raw-response', contentHash: rawEvent.payload.contentHash,
    }))
    if (!rawEvidence || typeof rawEvidence !== 'object' || !('raw' in rawEvidence)) {
      throw new Error('正式原响应工件结构无效')
    }
    expect(rawEvidence.raw).toBe(raw)
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(restored.candidates[0].draft).toBe(raw)
    expect(restored.candidates[0].payload.candidateHash).toBe(frozenHash)
    expect(restored.candidates[0].payload.creativeArtifact?.originalText).toBe(raw)
    expect(restored.budgetEvidence).toEqual(result.budgetEvidence)

    // 仅测试夹具篡改持久行；取消长度门不允许跳过既有candidateHash校验。
    await db.agentEvents.update(candidateEventId, { content: `${raw}\n非法追加` })
    await expect(restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId }))
      .rejects.toThrow('candidateHash 校验失败')
    expect(await db.chapters.count()).toBe(0)
    await db.agentEvents.update(candidateEventId, { content: raw })
    const restoredAgain = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(restoredAgain.candidates[0].payload.candidateHash).toBe(frozenHash)

    const ref = { scope: fixture.scope, runId: result.runId, candidateEventId, worldGroupId: fixture.worldGroupId }
    // 不传runtime，强制走刷新后的正式恢复采用入口和默认业务写入器。
    const adopted = await commitMasterAgentCandidateAdoptionV1(ref)
    const chapter = await db.chapters.where('outlineNodeId').equals(chapterOutlineId).first()
    if (!chapter) throw new Error('正式采用没有写入目标正文')
    expect(htmlToPlainText(chapter.content)).toBe(raw)
    expect(chapter.wordCount).toBe(wordCount)
    expect(chapter).toMatchObject({ workId: fixture.scope.workId })
    expect(Object.prototype.hasOwnProperty.call(chapter, 'worldId')).toBe(false)
    expect(await db.chapters.count()).toBe(1)
    expect((await commitMasterAgentCandidateAdoptionV1(ref)).adoptionHash).toBe(adopted.adoptionHash)
    expect(await db.chapters.count()).toBe(1)
    const stored = await db.agentEvents.get(candidateEventId)
    expect(stored?.content).toBe(raw)
    expect(stored?.payload).toBe(frozenPayload)
    expect(runAI).toHaveBeenCalledOnce()
    expect(executeSpy).toHaveBeenCalledOnce()
  })

  it('完整正文已经写入时恢复只补齐采纳证据，部分正文则 fail-closed', async () => {
    const runProseRecovery = async (label: string, partial: boolean) => {
      const fixture = await createWorkspace(label)
      await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
      const volumeId = await db.outlineNodes.add({
        projectId: fixture.scope.projectId,
        worldId: null,
        workId: fixture.scope.workId,
        worldGroupId: fixture.worldGroupId,
        parentId: null,
        type: 'volume',
        title: '第一卷',
        summary: '潮门即将关闭。',
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any) as number
      const chapterOutlineId = await db.outlineNodes.add({
        projectId: fixture.scope.projectId,
        worldId: null,
        workId: fixture.scope.workId,
        worldGroupId: fixture.worldGroupId,
        parentId: volumeId,
        type: 'chapter',
        title: '第一章',
        summary: '守灯人等待潮汐。',
        order: 0,
        updatedAt: Date.now(),
      } as any) as number
      await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
      const prepared = await prepareProseCopilot({
        projectId: fixture.scope.projectId,
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        authorRequest: '写第一章正文',
      })
      const draft = longDraft(label)
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
        plan: {
          summary: '生成第一章正文。',
          tasks: [{ id: 'prose-1', agentId: 'prose', skillId: 'prose.write', instruction: '写第一章正文。', dependsOn: [] }],
          workflow: DIRECT_WORKFLOW,
        },
        budget: new AgentTeamBudgetTracker('balanced'),
      }, { execute: async (options: any) => {
        const task = options.plan.tasks[0]
        await options.executionTrace.taskStarted(task)
        const reservation = options.budget.reserveCall({
          label: task.id,
          messages: [{ role: 'user', content: task.instruction }],
          maxOutputTokens: 100,
        })
        options.budget.settleCall(reservation, draft)
        const gateway = await prepareRequiredMasterGatewayFixtureV1({
          scope: options.scope,
          worldGroupId: options.worldGroupId,
          chapterId: prepared.snapshot.chapterId,
          characterId: prepared.perspectiveCharacterId ?? null,
          executionTrace: options.executionTrace,
        }, task, draft)
        await options.executionTrace.candidateReady(task, {
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: task.skillId,
            label: '第一章正文',
            contextSources: gateway.contextSources,
            contextEvidence: gateway.contextEvidence,
            baseSnapshot: prepared.snapshot,
            proseOperation: 'generate',
            proseOutlineNodeId: chapterOutlineId,
            perspectiveCharacterId: prepared.perspectiveCharacterId,
            workspaceScope: options.scope,
            dependsOnTaskIds: [],
          },
          draft,
          runtimeNode: {} as any,
          runtimeOutput: draft,
          contextGatewayRuntime: gateway.contextGatewayRuntime,
        })
      }})
      const candidate = result.candidates[0]
      const ref = {
        scope: fixture.scope,
        runId: result.runId,
        candidateEventId: candidate.event.id!,
        worldGroupId: fixture.worldGroupId,
      }
      await beginMasterAgentCandidateAdoptionV1(ref)
      if (partial) {
        const partialText = draft.slice(0, -10)
        await adopt({
          projectId: fixture.scope.projectId,
          scope: fixture.scope,
          worldGroupId: fixture.worldGroupId,
          target: 'chapters',
          mode: 'add',
          data: {
            outlineNodeId: chapterOutlineId,
            title: '第一章',
            content: plainTextToHtml(partialText),
            wordCount: countWords(partialText),
            status: 'draft',
            order: 0,
            notes: '',
          },
        })
      } else {
        await adoptMasterCandidate({
          projectId: fixture.scope.projectId,
          scope: fixture.scope,
          worldGroupId: fixture.worldGroupId,
          event: candidate.event,
          payload: candidate.payload,
          draft: candidate.draft,
        })
      }
      return { fixture, result, ref, draft, chapterOutlineId }
    }

    const complete = await runProseRecovery('正文完整恢复', false)
    expect((await recoverPendingMasterAgentAdoptionsV1(complete.fixture.scope)))
      .toEqual({ recoveredRunIds: [complete.result.runId], failed: [] })
    expect(await db.chapters.where('outlineNodeId').equals(complete.chapterOutlineId).count()).toBe(1)
    const completeSnapshot = await readAgentRunV1(complete.fixture.scope, complete.result.runId)
    expect(completeSnapshot.projection.steps['master:prose-1']).toMatchObject({ status: 'succeeded' })

    const partial = await runProseRecovery('正文部分恢复', true)
    const partialBefore = await db.chapters.where('outlineNodeId').equals(partial.chapterOutlineId).toArray()
    const failed = await recoverPendingMasterAgentAdoptionsV1(partial.fixture.scope)
    expect(failed.recoveredRunIds).toEqual([])
    expect(failed.failed).toHaveLength(1)
    expect((await db.chapters.where('outlineNodeId').equals(partial.chapterOutlineId).toArray()).map(row => row.content))
      .toEqual(partialBefore.map(row => row.content))
    expect((await readAgentRunV1(partial.fixture.scope, partial.result.runId)).projection.steps['master:prose-1'])
      .toMatchObject({ status: 'running', confirmation: 'adopt' })
  })
})
