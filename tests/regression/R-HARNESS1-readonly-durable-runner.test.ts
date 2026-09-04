import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildReadOnlyAgentRunContractV1,
  runDurableReadOnlyAgentV1,
  type ReadOnlyAgentDurableBoundaryV1,
} from '../../src/lib/agent/run/read-only-durable'
import { runDurableReadOnlyAgentWithClientV1 } from '../../src/lib/agent/client-adapter'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { AgentModelAdapter } from '../../src/lib/agent/runner'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { AGENT_READ_TOOLS } from '../../src/lib/agent/tool-registry'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace(label, { enableMultiWorld: true })
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
  const worldGroupId = await db.worldGroups.add({
    projectId,
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId, worldId, workId }, worldGroupId }
}

function finalModel(answer: string, calls = { count: 0 }): AgentModelAdapter {
  return {
    complete: vi.fn(async () => {
      calls.count += 1
      return {
        content: JSON.stringify({ type: 'final', answer }),
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      }
    }),
  }
}

function durableInput(
  fixture: { scope: WorkspaceScope; worldGroupId: number },
  model: AgentModelAdapter,
  overrides: Partial<Parameters<typeof runDurableReadOnlyAgentV1>[0]> = {},
): Parameters<typeof runDurableReadOnlyAgentV1>[0] {
  return {
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    goal: '核查当前项目并给出有证据的结论',
    context: {
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
    },
    model,
    allowedToolNames: AGENT_READ_TOOLS.map(tool => tool.name),
    executionBinding: {
      provider: 'test',
      model: 'scripted-readonly',
      adapterVersion: 'test-v1',
    },
    ...overrides,
  }
}

async function contentTableCounts(): Promise<Record<string, number>> {
  const excluded = new Set([
    'aiUsageLog',
    'agentRuns',
    'agentRunEvents',
    'agentRunCheckpoints',
  ])
  return Object.fromEntries(await Promise.all(PROJECT_TABLES
    .filter(spec => !excluded.has(spec.name))
    .map(async spec => [spec.name, await spec.table.count()] as const)))
}

describe('R-HARNESS1 · 只读 Runner durable adapter', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  it('从只读工具闭包生成零写权限契约，并持久化模型/工具/预算/检查点证据', async () => {
    const fixture = await createWorkspace('只读持久证据')
    const before = await contentTableCounts()
    const outputs = [
      '{"type":"tool","calls":[{"name":"read_work_status","arguments":{}}]}',
      '{"type":"final","answer":"项目资料已核查。"}',
    ]
    const model: AgentModelAdapter = {
      complete: vi.fn(async () => ({ content: outputs.shift()! })),
    }
    const contract = buildReadOnlyAgentRunContractV1({
      goal: '核查当前项目并给出有证据的结论',
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      runtimeBindingHash: 'a'.repeat(64),
    })
    expect(contract.workflowKind).toBe('read-only-audit')
    expect(contract.permissions.writeTargets).toEqual([])
    expect(contract.permissions.contextSourceKeys).toContain('workStatus')
    expect(contract.permissions.contextSourceKeys).toContain('chapterContent')
    expect(contract.budget).toMatchObject({
      maxToolResultTokens: 24_000,
      maxProtocolErrors: 2,
    })

    const result = await runDurableReadOnlyAgentV1(durableInput(fixture, model))
    expect(result.execution).toMatchObject({
      status: 'completed',
      answer: '项目资料已核查。',
      steps: 2,
      toolCalls: 1,
    })
    expect(result.resumed).toBe(false)
    expect(result.projection.state).toBe('paused')
    expect(result.projection.terminalReceiptHash).toBeUndefined()
    expect(result.projection.steps['read-only-audit']?.status).toBe('succeeded')

    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    expect(snapshot.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'model.requested',
      'model.responded',
      'tool.called',
      'tool.returned',
      'budget.reserved',
      'budget.settled',
      'checkpoint.created',
      'step.succeeded',
      'run.paused',
    ]))
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, result.runId)
    expect(checkpoint?.resumePayload).toMatchObject({
      version: 1,
      kind: 'read-only-agent-result',
      answer: '项目资料已核查。',
    })
    expect(JSON.stringify(checkpoint?.resumePayload)).not.toContain('read_work_status')
    expect(await contentTableCounts()).toEqual(before)
  })

  it('真实 client adapter 锁定 agent.readonly 统计并复用同一 durable Runner', async () => {
    const fixture = await createWorkspace('真实客户端持久运行')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"type":"final","answer":"客户端检查完成"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runDurableReadOnlyAgentWithClientV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      goal: '通过当前提供商检查项目',
      context: {
        projectId: fixture.scope.projectId,
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
      },
      config: {
        provider: 'custom',
        apiKey: '',
        model: 'durable-agent-test',
        baseUrl: 'https://example.invalid/v1',
        temperature: 0,
        maxTokens: 1024,
        contextWindow: 32_000,
      },
      allowedToolNames: AGENT_READ_TOOLS.map(tool => tool.name),
      meta: {
        category: 'chapter.content',
        projectId: fixture.scope.projectId + 999,
        contextOverflowPolicy: 'trim',
      },
    })

    expect(result.execution.answer).toBe('客户端检查完成')
    expect(result.projection.state).toBe('paused')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      expect(await db.aiUsageLog.toCollection().last()).toMatchObject({
        projectId: fixture.scope.projectId,
        category: 'agent.readonly',
        taskKind: 'review',
      })
    })
  })

  it.each([
    ['model.responded', 2],
    ['checkpoint.created', 1],
    ['step.succeeded', 1],
    ['run.paused', 1],
  ] as const)('在 %s 后中断 5 次均收敛，模型总调用符合整步恢复边界', async (boundary, expectedCalls) => {
    const fixture = await createWorkspace(`中断-${boundary}`)
    for (let index = 0; index < 5; index += 1) {
      const calls = { count: 0 }
      const model = finalModel(`恢复答复-${boundary}-${index}`, calls)
      let runId = 0
      let crashed = false
      const onDurableBoundary = async (event: ReadOnlyAgentDurableBoundaryV1) => {
        runId = event.runId
        if (!crashed && event.type === boundary) {
          crashed = true
          throw new Error(`模拟宿主在 ${boundary} 后中断`)
        }
      }
      await expect(runDurableReadOnlyAgentV1(durableInput(fixture, model, {
        onDurableBoundary,
      }))).rejects.toThrow('模拟宿主')
      expect(runId).toBeGreaterThan(0)

      const recovered = await runDurableReadOnlyAgentV1(durableInput(fixture, model, { runId }))
      expect(recovered.execution.answer).toBe(`恢复答复-${boundary}-${index}`)
      expect(recovered.resumed).toBe(boundary !== 'model.responded')
      expect(recovered.projection.state).toBe('paused')
      expect(recovered.projection.steps['read-only-audit']?.status).toBe('succeeded')
      expect(calls.count).toBe(expectedCalls)
    }
  })

  it('checkpoint 被篡改后 fail-closed，且不以重新调用模型掩盖证据损坏', async () => {
    const fixture = await createWorkspace('检查点篡改')
    const calls = { count: 0 }
    const model = finalModel('不会被重新生成', calls)
    let runId = 0
    await expect(runDurableReadOnlyAgentV1(durableInput(fixture, model, {
      onDurableBoundary(event) {
        runId = event.runId
        if (event.type === 'checkpoint.created') throw new Error('截断')
      },
    }))).rejects.toThrow('截断')
    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(runId).last()
    expect(checkpoint?.id).toBeDefined()
    await db.agentRunCheckpoints.update(checkpoint!.id!, {
      resumePayloadJson: JSON.stringify({ version: 1, kind: 'read-only-agent-result', answer: '伪造' }),
    })

    await expect(runDurableReadOnlyAgentV1(durableInput(fixture, model, { runId })))
      .rejects.toThrow('恢复载荷哈希不匹配')
    expect(calls.count).toBe(1)
  })

  it('协议和预算终止写入明确失败态，不伪造 step success 或 terminal receipt', async () => {
    const fixture = await createWorkspace('预算终止')
    const protocol = await runDurableReadOnlyAgentV1(durableInput(
      fixture,
      { complete: vi.fn(async () => ({ content: '不是 JSON' })) },
      { limits: { maxProtocolErrors: 0 } },
    ))
    expect(protocol.execution.status).toBe('protocol_error')
    expect(protocol.projection.state).toBe('failed')
    expect(protocol.projection.steps['read-only-audit']?.status).toBe('failed')
    expect(protocol.projection.terminalReceiptHash).toBeUndefined()

    const noModel = finalModel('不应调用')
    const budget = await runDurableReadOnlyAgentV1(durableInput(
      fixture,
      noModel,
      { limits: { maxTotalTokens: 1 } },
    ))
    expect(budget.execution.status).toBe('token_budget')
    expect(budget.projection.state).toBe('failed')
    expect(noModel.complete).not.toHaveBeenCalled()
    const snapshot = await readAgentRunV1(fixture.scope, budget.runId)
    expect(snapshot.events.some(event => event.type === 'budget.exhausted')).toBe(true)
    expect(snapshot.events.some(event => event.type === 'verification.accepted')).toBe(false)
  })

  it('恢复时重新校验完整契约与 Work scope，越界 run 不可读取或执行', async () => {
    const owner = await createWorkspace('所有者')
    const foreign = await createWorkspace('其它作品')
    const first = await runDurableReadOnlyAgentV1(durableInput(owner, finalModel('所有者结论')))

    await expect(runDurableReadOnlyAgentV1(durableInput(foreign, finalModel('越界'), {
      runId: first.runId,
    }))).rejects.toThrow('不属于当前 Work')
    await expect(runDurableReadOnlyAgentV1(durableInput(owner, finalModel('不同目标'), {
      runId: first.runId,
      goal: '偷偷换一个目标',
    }))).rejects.toThrow('目标、权限或预算契约不一致')
  })
})
