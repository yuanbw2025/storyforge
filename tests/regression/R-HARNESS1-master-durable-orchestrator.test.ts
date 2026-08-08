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
} from '../../src/lib/agent/run/master-durable'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
  recoverPendingMasterAgentAdoptionsV1,
} from '../../src/lib/agent/run/master-adoption'
import { adoptMasterCandidate } from '../../src/lib/agent/orchestrator'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { adopt } from '../../src/lib/registry/adopt'
import { countWords } from '../../src/lib/utils/html'
import { plainTextToHtml } from '../../src/lib/utils/html'
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
          baseSnapshot: task.agentId === 'world-origin'
            ? { id: null, updatedAt: null, worldOrigin: '' }
            : {},
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

function longDraft(label: string): string {
  return `${label}。潮声从城墙外一层层压来，守门人握紧手中的灯柄，记起今日必须完成的约定。`
    .repeat(3)
}

describe.sequential('R-HARNESS1-master-durable-orchestrator · 主 Agent durable 编排', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('正文视角进入严格计划契约并决定角色认知读取权限', async () => {
    const fixture = await createWorkspace('视角契约')
    const budgetEvidence = new AgentTeamBudgetTracker('balanced').snapshot()
    const withPerspective = parseMasterAgentPlanV1({
      summary: '以守灯人视角生成正文。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        instruction: '写第一章正文。',
        dependsOn: [],
        perspectiveCharacterId: 7,
      }],
    })
    const withoutPerspective = parseMasterAgentPlanV1({
      summary: '生成正文，但不猜测叙事视角。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        instruction: '写第一章正文。',
        dependsOn: [],
      }],
    })

    expect(withPerspective.tasks[0].perspectiveCharacterId).toBe(7)
    expect(buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: withPerspective,
      budgetEvidence,
    }).permissions.contextSourceKeys).toContain('characterKnowledge')
    expect(buildMasterAgentRunContractV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      plan: withoutPerspective,
      budgetEvidence,
    }).permissions.contextSourceKeys).not.toContain('characterKnowledge')
    expect(() => parseMasterAgentPlanV1({
      summary: '无效视角。',
      tasks: [{
        id: 'prose-1',
        agentId: 'prose',
        instruction: '写第一章正文。',
        dependsOn: [],
        perspectiveCharacterId: 0,
      }],
    })).toThrow('perspectiveCharacterId 无效')
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

  it('确认与采纳沿 candidateHash 推进，重复确认和重复提交不重复写入', async () => {
    const fixture = await createWorkspace('采纳')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '建立世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', instruction: '生成世界来源。', dependsOn: [] }],
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
    expect(committed.message).toContain('世界来源')
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
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '建立可修订的世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', instruction: '生成世界来源。', dependsOn: [] }],
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: fakeExecutor({ calls: vi.fn() }) as any })
    const original = result.candidates[0]
    const revisedDraft = '作者确认后的潮汐世界来源。'

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
    expect(committed.message).toContain('世界来源')
    expect((await db.worldviews.toArray()).map(row => row.worldOrigin)).toEqual([revisedDraft])
  })

  it('业务写入后宿主中断，恢复扫描只补齐采纳证据，不重复写业务', async () => {
    const fixture = await createWorkspace('采纳恢复')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '建立世界来源。',
        tasks: [{ id: 'world-1', agentId: 'world-origin', instruction: '生成世界来源。', dependsOn: [] }],
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
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '生成第一卷章节大纲。',
        tasks: [{ id: 'outline-1', agentId: 'outline', instruction: '生成两个章节。', dependsOn: [] }],
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
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          label: '章节大纲',
          contextSources: ['storyCore'],
          baseSnapshot: prepared.snapshot,
          outlineMode: prepared.mode,
          outlineParentId: prepared.parentVolumeId,
          workspaceScope: options.scope,
          dependsOnTaskIds: [],
        },
        draft,
        runtimeNode: {} as any,
        runtimeOutput: draft,
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
      })
      const result = await runDurableMasterAgentPlanV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
        conversationId: conversation.id,
        plan: {
          summary: '生成第一章正文。',
          tasks: [{ id: 'prose-1', agentId: 'prose', instruction: '写第一章正文。', dependsOn: [] }],
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
        await options.executionTrace.candidateReady(task, {
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '第一章正文',
            contextSources: ['chapterOutline'],
            baseSnapshot: prepared.snapshot,
            proseOperation: 'generate',
            proseOutlineNodeId: chapterOutlineId,
            workspaceScope: options.scope,
            dependsOnTaskIds: [],
          },
          draft,
          runtimeNode: {} as any,
          runtimeOutput: draft,
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
