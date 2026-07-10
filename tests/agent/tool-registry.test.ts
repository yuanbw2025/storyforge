import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import type { AgentEvent } from '../../src/lib/agent/events/agent-events'
import type {
  AgentRunInput,
  AgentRuntimePort,
  AgentScope,
  ApprovalDecision,
} from '../../src/lib/agent/runtime/agent-runtime-port'
import type {
  Actor,
  ApprovalReference,
  StoryForgeTool,
  ToolExecutionContext,
  ToolScope,
} from '../../src/lib/agent/tools/tool-types'

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    project: { backend: 'dexie', projectId: 1 },
    platform: 'web',
    scopes: new Set<ToolScope>(['project:read']),
    signal: new AbortController().signal,
    actor: { id: 'user-1', kind: 'user' },
    ...overrides,
  }
}

function createTool<Input = { value: string }, Output = string>(
  overrides: Partial<StoryForgeTool<Input, Output>> = {},
): StoryForgeTool<Input, Output> {
  return {
    name: 'storyforge.test.read',
    title: '测试读取',
    description: '测试工具',
    inputSchema: { type: 'object' },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    execute: vi.fn(async (_context: ToolExecutionContext, input: Input) => input as Output),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('注册工具并拒绝重复名称', () => {
    const registry = new ToolRegistry()
    const tool = createTool()

    registry.register(tool)

    expect(registry.get(tool.name)).toBe(tool)
    expect(() => registry.register(tool)).toThrow('duplicate tool storyforge.test.read')
  })

  it('按平台和 requiredScopes 过滤可用工具', () => {
    const registry = new ToolRegistry()
    registry.register(createTool())
    registry.register(createTool({
      name: 'storyforge.multi-scope',
      requiredScopes: ['project:read', 'project:write'],
    }))
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    expect(registry.listAvailable(createContext()).map(tool => tool.name)).toEqual([
      'storyforge.test.read',
    ])
    expect(registry.listAvailable(createContext({
      platform: 'desktop',
      scopes: new Set<ToolScope>(['project:write']),
    })).map(tool => tool.name)).toEqual(['storyforge.desktop.write'])
  })

  it('在满足平台与 project:write 权限时执行写工具', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'written')
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.desktop.write',
      createContext({
        platform: 'desktop',
        scopes: new Set<ToolScope>(['project:write']),
      }),
      { value: 'write-me' },
    )).resolves.toBe('written')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('将原始 context 与 input 透传给 execute', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => ({ ok: true }))
    const tool = createTool<{ nested: { value: string } }, { ok: boolean }>({ execute })
    const context = createContext()
    const input = { nested: { value: 'unchanged' } }
    registry.register(tool)

    await registry.execute(tool.name, context, input)

    expect(execute).toHaveBeenCalledWith(context, input)
    expect(execute.mock.calls[0]?.[0]).toBe(context)
    expect(execute.mock.calls[0]?.[1]).toBe(input)
  })

  it('拒绝未知工具与缺少 scope 的不可用工具', async () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    await expect(registry.execute('storyforge.missing', createContext(), {}))
      .rejects.toThrow('unknown tool storyforge.missing')
    await expect(registry.execute('storyforge.desktop.write', createContext(), {}))
      .rejects.toThrow('tool storyforge.desktop.write is not available')
  })

  it('signal 已 abort 时抛出 AbortError 且不执行工具', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    const tool = createTool({ execute })
    registry.register(tool)
    const controller = new AbortController()
    controller.abort()

    const error = await registry.execute(tool.name, createContext({ signal: controller.signal }), {})
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(execute).not.toHaveBeenCalled()
  })

  it('工具类型包含会话、作用域、actor 与 approval 元数据', () => {
    const actor: Actor = { id: 'background-1', kind: 'background-agent' }
    const approval: ApprovalReference = { approvalId: 'approval-1', planHash: 'sha256:plan' }
    const context: ToolExecutionContext = createContext({
      actor,
      approval,
      worldGroupId: 2,
      outlineNodeId: 3,
      chapterId: 4,
    })

    expectTypeOf<ToolScope>().toEqualTypeOf<
      'project:read' | 'project:write' | 'manuscript:write' | 'external:read' | 'external:write'
    >()
    expectTypeOf<Actor['kind']>().toEqualTypeOf<'user' | 'background-agent' | 'system'>()
    expectTypeOf<StoryForgeTool<{ value: string }, string>['execute']>().toEqualTypeOf<
      (context: ToolExecutionContext, input: { value: string }) => Promise<string>
    >()
    expect(context.sessionId).toBe('session-1')
    expect(context.approval).toEqual(approval)
  })

  it('锁定 runtime port 的输入与返回类型', () => {
    const scope: AgentScope = { chapterId: 4, selection: { text: '选中的章节文本' } }
    const input: AgentRunInput = {
      conversationId: 'conversation-1',
      project: { backend: 'dexie', projectId: 1 },
      scope,
      userMessage: '请润色选中的章节',
    }
    const decision: ApprovalDecision = { approvalId: 'approval-1', decision: 'approved' }

    expect(input.scope).toBe(scope)
    expect(decision.decision).toBe('approved')
    expectTypeOf<AgentRuntimePort['run']>().toEqualTypeOf<
      (input: AgentRunInput) => AsyncIterable<AgentEvent>
    >()
    expectTypeOf<AgentRuntimePort['resume']>().toEqualTypeOf<
      (runId: string, decision?: ApprovalDecision) => AsyncIterable<AgentEvent>
    >()
    expectTypeOf<AgentRuntimePort['cancel']>().toEqualTypeOf<
      (runId: string) => Promise<void>
    >()
  })
})
