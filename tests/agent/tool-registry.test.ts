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

function createTool(
  overrides: Partial<StoryForgeTool<{ value: string }, string>> = {},
): StoryForgeTool<{ value: string }, string> {
  return {
    name: 'storyforge.test.read',
    title: '测试读取',
    description: '测试工具',
    inputSchema: { type: 'object' },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    execute: vi.fn(async (_context, input) => input.value),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('注册工具、保留原始对象身份并拒绝重复名称', () => {
    const registry = new ToolRegistry()
    const tool = createTool()

    registry.register(tool)

    expect(registry.get(tool.name)).toBe(tool)
    expect(() => registry.register(tool)).toThrow('duplicate tool storyforge.test.read')
  })

  it('listAvailable：scope 完全满足但平台错误时仍不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    expect(registry.listAvailable(createContext({
      scopes: new Set<ToolScope>(['project:write']),
    }))).toEqual([])
  })

  it('execute：scope 完全满足但平台错误时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
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
        scopes: new Set<ToolScope>(['project:write']),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.desktop.write is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('listAvailable：平台正确但缺少唯一 required scope 时不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    expect(registry.listAvailable(createContext({
      platform: 'desktop',
      scopes: new Set<ToolScope>(),
    }))).toEqual([])
  })

  it('execute：平台正确但缺少唯一 required scope 时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
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
        scopes: new Set<ToolScope>(),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.desktop.write is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('listAvailable：多 scope 只缺一个时不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.multi-scope',
      requiredScopes: ['project:read', 'project:write'],
    }))

    expect(registry.listAvailable(createContext({
      scopes: new Set<ToolScope>(['project:read']),
    }))).toEqual([])
  })

  it('execute：多 scope 只缺一个时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    registry.register(createTool({
      name: 'storyforge.multi-scope',
      requiredScopes: ['project:read', 'project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.multi-scope',
      createContext({
        scopes: new Set<ToolScope>(['project:read']),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.multi-scope is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('在平台与全部 scope 均满足时执行工具', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'written')
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:read', 'project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.desktop.write',
      createContext({
        platform: 'desktop',
        scopes: new Set<ToolScope>(['project:read', 'project:write']),
      }),
      { value: 'write-me' },
    )).resolves.toBe('written')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('将原始 context 与 input 透传给 execute', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => ({ ok: true }))
    const tool: StoryForgeTool<{ nested: { value: string } }, { ok: boolean }> = {
      name: 'storyforge.test.nested',
      title: '嵌套输入',
      description: '验证输入透传',
      inputSchema: { type: 'object' },
      risk: 'read',
      availability: 'both',
      requiredScopes: ['project:read'],
      execute,
    }
    const context = createContext()
    const input = { nested: { value: 'unchanged' } }
    registry.register(tool)

    await registry.execute(tool.name, context, input)

    expect(execute).toHaveBeenCalledWith(context, input)
    expect(execute.mock.calls[0]?.[0]).toBe(context)
    expect(execute.mock.calls[0]?.[1]).toBe(input)
  })

  it('拒绝未知工具', async () => {
    const registry = new ToolRegistry()

    await expect(registry.execute('storyforge.missing', createContext(), {}))
      .rejects.toThrow('unknown tool storyforge.missing')
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

  it('注册后篡改策略与 executor 仍无法绕过注册时快照', async () => {
    const registry = new ToolRegistry()
    const originalExecute = vi.fn(async () => 'original')
    const replacementExecute = vi.fn(async () => 'replacement')
    const requiredScopes: ToolScope[] = ['project:write', 'manuscript:write']
    const tool = createTool({
      name: 'storyforge.snapshot.write',
      risk: 'write',
      availability: 'desktop',
      requiredScopes,
      execute: originalExecute,
    })
    registry.register(tool)

    Reflect.set(requiredScopes, 'length', 0)
    Reflect.set(tool, 'availability', 'web')
    Reflect.set(tool, 'requiredScopes', [])
    Reflect.set(tool, 'risk', 'read')
    Reflect.set(tool, 'execute', replacementExecute)

    const bypassContext = createContext({
      platform: 'web',
      scopes: new Set<ToolScope>(),
    })
    expect(registry.listAvailable(bypassContext)).toEqual([])
    await expect(registry.execute(tool.name, bypassContext, { value: 'blocked' }))
      .rejects.toThrow('tool storyforge.snapshot.write is not available')
    expect(originalExecute).not.toHaveBeenCalled()
    expect(replacementExecute).not.toHaveBeenCalled()

    const authorizedContext = createContext({
      platform: 'desktop',
      scopes: new Set<ToolScope>(['project:write', 'manuscript:write']),
    })
    expect(registry.listAvailable(authorizedContext)).toEqual([tool])
    await expect(registry.execute(tool.name, authorizedContext, { value: 'allowed' }))
      .resolves.toBe('original')
    expect(originalExecute).toHaveBeenCalledOnce()
    expect(replacementExecute).not.toHaveBeenCalled()
  })

  it('锁定只读工具元数据与动态 execute 的 unknown 返回契约', () => {
    type ToolMetadata = Pick<
      StoryForgeTool,
      'name' | 'title' | 'description' | 'inputSchema' | 'risk' | 'availability' | 'requiredScopes'
    >

    expectTypeOf<ToolMetadata>().toEqualTypeOf<Readonly<ToolMetadata>>()
    expectTypeOf<StoryForgeTool['requiredScopes']>().toEqualTypeOf<readonly ToolScope[]>()
    expectTypeOf<ToolRegistry['execute']>().toEqualTypeOf<
      (
        name: string,
        context: ToolExecutionContext,
        input: unknown,
      ) => Promise<unknown>
    >()
    expectTypeOf<ReturnType<ToolRegistry['execute']>>().toEqualTypeOf<Promise<unknown>>()
    expectTypeOf<ReturnType<ToolRegistry['execute']>>().not.toEqualTypeOf<Promise<Date>>()
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
