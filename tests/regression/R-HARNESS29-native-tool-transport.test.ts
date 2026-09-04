import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NATIVE_READ_TOOLS_STORAGE_KEY_V1,
  resolveAgentToolTransportV1,
  runDurableReadOnlyAgentWithClientV1,
  runReadOnlyAgentWithClient,
} from '../../src/lib/agent/client-adapter'
import { parseNativeAgentToolCalls } from '../../src/lib/agent/protocol'
import {
  buildReadOnlyAgentRunContractV1,
} from '../../src/lib/agent/run/read-only-durable'
import { createAgentRunV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  getAIProviderCapabilityProfileV1,
  getJsonObjectResponseCapabilityV1,
  supportsVerifiedJsonObjectResponseV1,
} from '../../src/lib/ai/provider-capabilities'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { AGENT_READ_TOOLS } from '../../src/lib/agent/tool-registry'
import type { AIConfig, WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const OPENAI_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-native-tool-test',
  baseUrl: 'https://example.invalid/v1',
  temperature: 0,
  maxTokens: 1_024,
  contextWindow: 32_000,
}

const ALL_READ_TOOL_NAMES = AGENT_READ_TOOLS.map(tool => tool.name)

const ROUTED_CUSTOM_CONFIG: AIConfig = {
  ...OPENAI_CONFIG,
  provider: 'custom',
  model: 'routed-review-model',
  baseUrl: 'https://routed-review.invalid/v1',
}

const ORIGINAL_AI_STATE = {
  config: structuredClone(useAIConfigStore.getState().config),
  presets: structuredClone(useAIConfigStore.getState().presets),
  taskRoutes: structuredClone(useAIConfigStore.getState().taskRoutes),
}

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

async function contentTableCounts(): Promise<Record<string, number>> {
  const excluded = new Set(['aiUsageLog', 'agentRuns', 'agentRunEvents', 'agentRunCheckpoints'])
  return Object.fromEntries(await Promise.all(PROJECT_TABLES
    .filter(spec => !excluded.has(spec.name))
    .map(async spec => [spec.name, await spec.table.count()] as const)))
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('R-HARNESS29 · provider-native read tool transport', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.removeItem(NATIVE_READ_TOOLS_STORAGE_KEY_V1)
    useAIConfigStore.setState({ config: OPENAI_CONFIG, presets: [], taskRoutes: {} })
  })

  afterEach(() => {
    db.close()
    localStorage.removeItem(NATIVE_READ_TOOLS_STORAGE_KEY_V1)
    useAIConfigStore.setState(ORIGINAL_AI_STATE)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps native tools opt-in and refuses providers without verified contract evidence', () => {
    expect(getAIProviderCapabilityProfileV1('openai').nativeToolCalls).toBe('supported')
    expect(getAIProviderCapabilityProfileV1('custom').nativeToolCalls).toBe('unverified')
    expect(resolveAgentToolTransportV1({ config: OPENAI_CONFIG })).toBe('text-json-v1')

    localStorage.setItem(NATIVE_READ_TOOLS_STORAGE_KEY_V1, 'enabled')
    expect(resolveAgentToolTransportV1({ config: OPENAI_CONFIG })).toBe('native-tools-v1')
    expect(resolveAgentToolTransportV1({
      config: { ...OPENAI_CONFIG, provider: 'custom' },
    })).toBe('text-json-v1')
    expect(() => resolveAgentToolTransportV1({
      config: { ...OPENAI_CONFIG, provider: 'custom' },
      preference: 'native-tools-v1',
    })).toThrow('尚无 StoryForge 原生工具调用合同证据')
  })

  it('keeps verified JSON-object transport independent from native tool-call capability', () => {
    expect(getJsonObjectResponseCapabilityV1('openai')).toBe('supported')
    expect(getJsonObjectResponseCapabilityV1('agnes')).toBe('unverified')
    expect(getJsonObjectResponseCapabilityV1('doubao')).toBe('supported')
    expect(getJsonObjectResponseCapabilityV1('custom')).toBe('unverified')
    expect(supportsVerifiedJsonObjectResponseV1('agnes')).toBe(false)
    expect(supportsVerifiedJsonObjectResponseV1('custom')).toBe(false)
    expect(getAIProviderCapabilityProfileV1('agnes').nativeToolCalls).toBe('unverified')
  })

  it('strictly maps native tool calls into the same closed read-only protocol', () => {
    expect(parseNativeAgentToolCalls([{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_work_status', arguments: '{}' },
    }])).toEqual({
      type: 'tool',
      calls: [{ name: 'read_work_status', arguments: {} }],
    })
    expect(() => parseNativeAgentToolCalls([{
      id: 'call-1',
      type: 'function',
      function: { name: 'unknown_write', arguments: '{}' },
    }])).toThrow('只读工具')
    expect(() => parseNativeAgentToolCalls([{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_work_status', arguments: '{bad' },
    }])).toThrow('不是合法 JSON')
    expect(() => parseNativeAgentToolCalls([{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_work_status', arguments: '{}' },
      injected: true,
    }])).toThrow('只允许')
  })

  it('uses registry-derived native declarations, executes through the same tool gate, and stays read-only', async () => {
    const fixture = await createWorkspace('原生工具运行')
    const before = await contentTableCounts()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'call-project',
              type: 'function',
              function: { name: 'read_work_status', arguments: '{}' },
            }],
          },
        }],
        usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
      }))
      .mockResolvedValueOnce(response({
        choices: [{ finish_reason: 'stop', message: { content: '项目与世界作用域已核查。' } }],
        usage: { prompt_tokens: 450, completion_tokens: 30, total_tokens: 480 },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runReadOnlyAgentWithClient({
      goal: '核查项目与世界作用域',
      context: {
        projectId: fixture.scope.projectId,
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
      },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
    })

    expect(result).toMatchObject({
      status: 'completed',
      answer: '项目与世界作用域已核查。',
      steps: 2,
      toolCalls: 1,
    })
    expect(result.events.some(event => event.type === 'protocol-error')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(firstBody.tool_choice).toBe('auto')
    expect(firstBody.tools).toHaveLength(AGENT_READ_TOOLS.length)
    expect(firstBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(
      AGENT_READ_TOOLS.map(tool => tool.name),
    )
    expect(firstBody.tools.map((tool: { function: { name: string } }) => tool.function.name))
      .toContain('read_character_driven_plan')
    expect(JSON.stringify(firstBody.tools)).not.toMatch(/projectId|worldGroupId/u)
    expect(firstBody.messages[0].content).not.toContain('read_work_status(')
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(secondBody.messages.at(-1).content).toContain('只读工具结果')
    expect(secondBody.messages.at(-1).content).toContain('read_work_status')
    expect(await contentTableCounts()).toEqual(before)
  })

  it('counts native schemas against the physical context window before fetch', async () => {
    const fixture = await createWorkspace('原生工具窗口')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await runReadOnlyAgentWithClient({
      goal: '核查项目',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: { ...OPENAI_CONFIG, contextWindow: 512, maxTokens: 128 },
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
    })
    expect(result.status).toBe('model_error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records malformed native responses as bounded protocol errors without executing tools', async () => {
    const fixture = await createWorkspace('原生工具错误')
    const fetchMock = vi.fn(async () => response({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'bad-call',
            type: 'function',
            function: { name: 'not_registered', arguments: '{}' },
          }],
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runReadOnlyAgentWithClient({
      goal: '禁止未登记工具',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
      limits: { maxProtocolErrors: 0 },
    })
    expect(result.status).toBe('protocol_error')
    expect(result.toolCalls).toBe(0)
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'protocol-error',
      error: expect.stringContaining('只读工具'),
    }))
  })

  it('does not ignore a malformed tool_calls field when finish_reason claims a final answer', async () => {
    const fixture = await createWorkspace('原生工具字段错误')
    vi.stubGlobal('fetch', vi.fn(async () => response({
      choices: [{
        finish_reason: 'stop',
        message: { content: '不能掩盖错误字段', tool_calls: { injected: true } },
      }],
    })))

    const result = await runReadOnlyAgentWithClient({
      goal: '拒绝畸形工具字段',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
      limits: { maxProtocolErrors: 0 },
    })
    expect(result.status).toBe('protocol_error')
    expect(result.answer).toBe('')
    expect(result.toolCalls).toBe(0)
  })

  it('keeps native protocol instructions after a recoverable malformed response', async () => {
    const fixture = await createWorkspace('原生工具纠错')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'bad-call',
              type: 'function',
              function: { name: 'not_registered', arguments: '{}' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(response({
        choices: [{ finish_reason: 'stop', message: { content: '纠错后完成。' } }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReadOnlyAgentWithClient({
      goal: '在原生协议内纠错',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
      limits: { maxProtocolErrors: 1 },
    })).resolves.toMatchObject({
      status: 'completed',
      answer: '纠错后完成。',
      steps: 2,
      toolCalls: 0,
    })
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(retryBody.messages.at(-1).content).toContain('只调用已声明的只读工具')
    expect(retryBody.messages.at(-1).content).not.toContain('tool 或 final JSON')
    expect(retryBody.tools).toHaveLength(AGENT_READ_TOOLS.length)
    expect(retryBody.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(
      AGENT_READ_TOOLS.map(tool => tool.name),
    )
  })

  it('selects transport from the routed provider and rejects unsupported native calls before fetch', async () => {
    const fixture = await createWorkspace('任务路由能力')
    localStorage.setItem(NATIVE_READ_TOOLS_STORAGE_KEY_V1, 'enabled')
    useAIConfigStore.setState({
      config: OPENAI_CONFIG,
      allowedToolNames: ALL_READ_TOOL_NAMES,
      presets: [{ id: 'routed-review', name: '评审路由', config: ROUTED_CUSTOM_CONFIG }],
      taskRoutes: { review: 'routed-review' },
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://routed-review.invalid/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('routed-review-model')
      expect(body.tools).toBeUndefined()
      expect(body.tool_choice).toBeUndefined()
      return response({
        choices: [{ message: { content: '{"type":"final","answer":"已按路由核查"}' } }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReadOnlyAgentWithClient({
      goal: '按真实 provider 选择 transport',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      allowedToolNames: ALL_READ_TOOL_NAMES,
    })).resolves.toMatchObject({ status: 'completed', answer: '已按路由核查' })
    expect(fetchMock).toHaveBeenCalledOnce()

    expect(() => runReadOnlyAgentWithClient({
      goal: '禁止把 native tools 发往未验证端点',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
    })).toThrow('尚无 StoryForge 原生工具调用合同证据')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('binds durable runs to the routed provider and model', async () => {
    const fixture = await createWorkspace('任务路由绑定')
    useAIConfigStore.setState({
      config: OPENAI_CONFIG,
      presets: [{ id: 'routed-review', name: '评审路由', config: ROUTED_CUSTOM_CONFIG }],
      taskRoutes: { review: 'routed-review' },
    })
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://routed-review.invalid/v1/chat/completions')
      return response({
        choices: [{ message: { content: '{"type":"final","answer":"路由绑定完成"}' } }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = runDurableReadOnlyAgentWithClientV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      goal: '冻结真实路由连接',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'auto',
      allowedToolNames: ALL_READ_TOOL_NAMES,
    })
    useAIConfigStore.setState({
      presets: [{ id: 'changed-route', name: '运行中改路由', config: OPENAI_CONFIG }],
      taskRoutes: { review: 'changed-route' },
    })
    const result = await pending
    const capabilityProfileHash = await hashCanonicalValue(
      getAIProviderCapabilityProfileV1(ROUTED_CUSTOM_CONFIG.provider),
    )
    const executionBinding = {
      provider: ROUTED_CUSTOM_CONFIG.provider,
      model: ROUTED_CUSTOM_CONFIG.model,
      adapterVersion: 'chat-client-text-json-v1',
      capabilityProfileHash,
    }
    const toolSchemaSetHash = await hashCanonicalValue(AGENT_READ_TOOLS.map(tool => ({
      name: tool.name,
      risk: tool.risk,
      parameters: tool.parameters,
      sourceKeys: tool.sourceKeys,
      inputBudgetTokens: tool.inputBudgetTokens,
    })))
    const expectedBindingHash = await hashCanonicalValue({
      executionBinding,
      allowedToolNames: ALL_READ_TOOL_NAMES,
      toolSchemaSetHash,
    })

    expect((await readAgentRunV1(fixture.scope, result.runId)).contract.runtimeBindingHash)
      .toBe(expectedBindingHash)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('freezes provider/model/transport for new durable runs and rejects a transport switch', async () => {
    const fixture = await createWorkspace('原生工具恢复')
    const fetchMock = vi.fn(async () => response({
      choices: [{ message: { content: '{"type":"final","answer":"首次结果"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    let runId = 0

    await expect(runDurableReadOnlyAgentWithClientV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      goal: '冻结 transport',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'text-json-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
      onDurableBoundary: boundary => {
        runId = boundary.runId
        if (boundary.type === 'model.responded') throw new Error('simulated-stop')
      },
    })).rejects.toThrow('simulated-stop')
    expect((await readAgentRunV1(fixture.scope, runId)).contract.runtimeBindingHash).toMatch(/^[0-9a-f]{64}$/u)

    await expect(runDurableReadOnlyAgentWithClientV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      goal: '冻结 transport',
      context: { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId },
      config: OPENAI_CONFIG,
      transport: 'native-tools-v1',
      allowedToolNames: ALL_READ_TOOL_NAMES,
      runId,
    })).rejects.toThrow('目标、权限或预算契约不一致')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('拒绝缺失运行时绑定的非现行只读契约', async () => {
    const fixture = await createWorkspace('拒绝无绑定契约')
    const contract = buildReadOnlyAgentRunContractV1({
      goal: '验证当前只读契约边界',
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      runtimeBindingHash: 'b'.repeat(64),
    })
    const { runtimeBindingHash: _removedBinding, ...unboundContract } = contract
    await expect(createAgentRunV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      contract: unboundContract,
    })).rejects.toThrow(/runtimeBindingHash|executionBindings/)
  })
})
