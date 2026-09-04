import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  runDurableMasterAgentPlanV1,
  type DurableMasterAgentResultV1,
} from '../../src/lib/agent/run/master-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY } from '../../src/lib/agent/workflow-catalog'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import type { WorkspaceScope } from '../../src/lib/types'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { currentWorldOriginDraftV1 } from '../helpers/current-worldview-field'

const inspirationResult = {
  worldview: {
    worldOrigin: '旧城由一场遗忘诞生',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    races: '',
    factionLayout: '',
  },
  history: { overview: '' },
  storyCore: {
    logline: '守塔人追查被雨抹去的名字',
    theme: '记忆',
    centralConflict: '保存与遗忘',
    plotPattern: '探索',
    mainPlot: '寻找旧城失忆的源头',
  },
  characters: [],
}

function modelContent(prompt: string): string {
  if (prompt.includes('反推灵感中的记忆冲突')) return JSON.stringify(inspirationResult)
  if (prompt.includes('根据两个上游候选设计守忆者角色')) {
    return JSON.stringify({
      name: '守忆者',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'lawful',
      relationships: '守护盐城记忆',
      shortDescription: '负责记录被雨抹去之名的人。',
    })
  }
  return currentWorldOriginDraftV1('潮汐退去之后，第一座盐城从海床苏醒，并以月轮记录文明纪年。')
}

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace('有限并行项目')
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
  const worldGroupId = await db.worldGroups.add({
    projectId,
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.inspirationWorkspaces.add({
    projectId,
    worldId,
    workId,
    fragments: JSON.stringify([{
      id: 'rain-memory',
      text: '旧城每次下雨都会忘记一个人',
      label: '城市规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: '[]',
    createdAt: now,
    updatedAt: now,
  } as any)
  await stampCurrentFixtureResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, worldGroupId }
}

function fanOutPlan(): MasterAgentPlan {
  return {
    summary: '并行生成彼此独立的世界来源和灵感反推候选。',
    tasks: [
      {
        id: 'world-1',
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: '建立潮汐退去后盐城苏醒的世界来源。',
        dependsOn: [],
      },
      {
        id: 'inspiration-1',
        agentId: 'inspiration',
        skillId: 'inspiration.reverse',
        instruction: '反推灵感中的记忆冲突。',
        dependsOn: [],
      },
      {
        id: 'character-1',
        agentId: 'character',
        skillId: 'character.create',
        instruction: '根据两个上游候选设计守忆者角色。',
        dependsOn: ['world-1', 'inspiration-1'],
      },
    ],
    workflow: {
      version: 1,
      workflowId: 'multi-domain-fan-out',
      reasonCodes: ['explicit-independent-fan-out', 'multiple-explicit-domains'],
    },
  }
}

describe.sequential('R-HARNESS23 · 主 Agent 有限 fan-out', { timeout: 15_000 }, () => {
  const originalConfig = useAIConfigStore.getState().config

  beforeEach(async () => {
    await db.delete()
    await db.open()
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
    useAIConfigStore.setState({
      config: {
        ...originalConfig,
        provider: 'custom',
        apiKey: '',
        model: 'fan-out-test',
        baseUrl: 'https://fan-out.invalid/v1',
        maxTokens: 8_000,
        contextWindow: 64_000,
      },
      presets: [],
      taskRoutes: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
    useAIConfigStore.setState({ config: originalConfig, presets: [], taskRoutes: {} })
    db.close()
  })

  it('两路模型调用并行、账本串行；一叶失败后保留成功候选且恢复只重跑失败叶', async () => {
    const fixture = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    let activeCalls = 0
    let maxActiveCalls = 0
    let failInspiration = true
    let initialLeafStarts = 0
    let releaseInitialLeaves: (() => void) | null = null
    const initialLeavesReady = new Promise<void>(resolve => {
      releaseInitialLeaves = resolve
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ content?: string }>
      }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      const inspiration = prompt.includes('反推灵感中的记忆冲突')
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      if (failInspiration) {
        initialLeafStarts += 1
        if (initialLeafStarts === 2) releaseInitialLeaves?.()
        await Promise.race([
          initialLeavesReady,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error('fan-out 叶子模型调用未并发启动')),
            1_000,
          )),
        ])
      } else {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      activeCalls -= 1
      if (inspiration && failInspiration) throw new Error('模拟灵感调用失败')
      const content = modelContent(prompt)
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    let interruptedRunId = 0
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: fanOutPlan(),
      budget: new AgentTeamBudgetTracker('balanced'),
      onDurableBoundary: boundary => {
        interruptedRunId = boundary.runId
      },
    })).rejects.toThrow('模拟灵感调用失败')

    expect(maxActiveCalls).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const interrupted = await readAgentRunV1(fixture.scope, interruptedRunId)
    expect(interrupted.contract.workflowKind).toBe('fan-out-synthesize')
    expect(interrupted.projection.state).toBe('paused')
    expect(interrupted.projection.steps['master:world-1']?.status).toBe('awaiting_confirmation')
    expect(interrupted.projection.steps['master:inspiration-1']?.status).toBe('failed')
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')).toHaveLength(1)
    const firstResponded = interrupted.events.findIndex(event => event.type === 'model.responded')
    expect(interrupted.events
      .slice(0, firstResponded)
      .filter(event => event.type === 'model.requested')).toHaveLength(2)
    expect(await db.worldviews.count()).toBe(0)

    failInspiration = false
    maxActiveCalls = 0
    const resumed: DurableMasterAgentResultV1 = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      runId: interruptedRunId,
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(maxActiveCalls).toBe(1)
    expect(resumed.candidates.map(candidate => candidate.payload.taskId).sort())
      .toEqual(['character-1', 'inspiration-1', 'world-1'])
    expect(resumed.projection.state).toBe('awaiting_confirmation')
    expect(resumed.candidates.every(candidate => candidate.payload.runGeneration === 1)).toBe(true)
    expect(resumed.candidates.find(candidate => candidate.payload.taskId === 'character-1')
      ?.payload.dependencyBindings?.map(binding => binding.taskId))
      .toEqual(['world-1', 'inspiration-1'])
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
  })

  it('运行时回滚开关让既有 fan-out 契约按原顺序执行且不改写计划', async () => {
    const fixture = await createWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    globalThis.localStorage?.setItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY, 'disabled')
    let activeCalls = 0
    let maxActiveCalls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ content?: string }>
      }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await new Promise(resolve => setTimeout(resolve, 20))
      activeCalls -= 1
      return new Response(JSON.stringify({
        choices: [{ message: { content: modelContent(prompt) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: fanOutPlan(),
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    expect(maxActiveCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.plan.workflow.workflowId).toBe('multi-domain-fan-out')
    expect((await readAgentRunV1(fixture.scope, result.runId)).contract.workflowKind)
      .toBe('fan-out-synthesize')
  })
})
