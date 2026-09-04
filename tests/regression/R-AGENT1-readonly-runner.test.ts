import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAgentProtocolSystemPrompt,
  formatAgentToolCatalog,
  parseAgentProtocolAction,
} from '../../src/lib/agent/protocol'
import { chat } from '../../src/lib/ai/client'
import {
  runReadOnlyAgentWithClient,
} from '../../src/lib/agent/client-adapter'
import {
  runReadOnlyAgent,
  type AgentModelAdapter,
  type AgentModelCompletion,
} from '../../src/lib/agent/runner'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { AGENT_READ_TOOLS } from '../../src/lib/agent/tool-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const ALL_READ_TOOL_NAMES = AGENT_READ_TOOLS.map(tool => tool.name)

async function addProject(name = 'Agent Runner') {
  return (await seedCurrentWorkspace(name)).scope.projectId
}

async function addChapter(projectId: number, content: string) {
  const now = Date.now()
  const scope = await resolveWorkspaceScope(projectId)
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'chapter',
    title: '第一章',
    summary: '',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  return await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title: '第一章',
    content,
    wordCount: content.length,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
}

function scriptedModel(
  outputs: Array<string | AgentModelCompletion | Error>,
  seen: Array<Parameters<AgentModelAdapter['complete']>[0]> = [],
): AgentModelAdapter {
  let index = 0
  return {
    complete: vi.fn(async messages => {
      seen.push(messages)
      const next = outputs[index++]
      if (next instanceof Error) throw next
      if (typeof next === 'string') return { content: next }
      if (!next) throw new Error('脚本模型没有更多输出')
      return next
    }),
  }
}

async function tableCounts() {
  return Object.fromEntries(await Promise.all(PROJECT_TABLES.map(async spec => (
    [spec.name, await spec.table.count()] as const
  ))))
}

function contentTableCounts(counts: Record<string, number>) {
  return Object.fromEntries(Object.entries(counts).filter(([name]) => name !== 'aiUsageLog'))
}

describe('R-AGENT1 · 严格只读 AgentRunner', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    db.close()
    vi.unstubAllGlobals()
  })

  it('动作协议拒绝围栏、额外字段、未知/非只读工具，并用紧凑目录隐藏作用域参数', () => {
    expect(parseAgentProtocolAction('{"type":"final","answer":"完成"}')).toEqual({
      type: 'final',
      answer: '完成',
    })
    expect(() => parseAgentProtocolAction('```json\n{"type":"final","answer":"完成"}\n```')).toThrow('单个 JSON')
    expect(() => parseAgentProtocolAction('{"type":"final","answer":"完成","extra":1}')).toThrow('只允许')
    expect(() => parseAgentProtocolAction(
      '{"type":"tool","calls":[{"name":"save_chapter_content","arguments":{}}]}',
    )).toThrow('只读工具')
    expect(formatAgentToolCatalog(ALL_READ_TOOL_NAMES)).not.toMatch(/\((?:[^)]*,\s*)?(projectId|worldGroupId):/)
    expect(buildAgentProtocolSystemPrompt(ALL_READ_TOOL_NAMES)).toContain('不可信数据')
  })

  it('协议型客户端在物理窗口不足时拒绝静默裁掉目标或工具证据', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      provider: 'custom' as const,
      apiKey: '',
      model: 'tiny-agent-test',
      baseUrl: 'https://example.invalid/v1',
      temperature: 0,
      maxTokens: 64,
      contextWindow: 256,
    }

    await expect(chat(
      [
        { role: 'system', content: '只返回严格 JSON。' },
        { role: 'user', content: `【用户目标】\n${'检查项目。'.repeat(500)}` },
      ],
      config,
      {
        category: 'agent.readonly',
        projectId: 1,
        contextOverflowPolicy: 'reject',
      },
    )).rejects.toThrow('拒绝静默裁剪')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('真实客户端锁定只读分类和项目归属，只允许标准消耗统计增长', async () => {
    const projectId = await addProject()
    const before = await tableCounts()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"type":"final","answer":"只读检查完成"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runReadOnlyAgentWithClient({
      goal: '只读检查',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      config: {
        provider: 'custom',
        apiKey: '',
        model: 'agent-test',
        baseUrl: 'https://example.invalid/v1',
        temperature: 0,
        maxTokens: 1024,
        contextWindow: 32_000,
      },
      meta: {
        category: 'chapter.content',
        projectId: projectId + 999,
        contextOverflowPolicy: 'trim',
      },
    })

    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      const entry = await db.aiUsageLog.toCollection().last()
      expect(entry).toMatchObject({
        projectId,
        category: 'agent.readonly',
        taskKind: 'review',
      })
    })
    const after = await tableCounts()
    expect(contentTableCounts(after)).toEqual(contentTableCounts(before))
    expect(after.aiUsageLog).toBe(before.aiUsageLog + 1)
  })

  it('一轮批量读取两个独立工具，下一轮汇总；全过程不改变任何项目表', async () => {
    const projectId = await addProject()
    const before = await tableCounts()
    const seen: Array<Parameters<AgentModelAdapter['complete']>[0]> = []
    const model = scriptedModel([
      '{"type":"tool","calls":[{"name":"read_work_status","arguments":{}},{"name":"read_world_groups","arguments":{}}]}',
      '{"type":"final","answer":"项目为单世界，当前尚未建立正文。"}',
    ], seen)

    const result = await runReadOnlyAgent({
      goal: '检查项目基础情况',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model,
    })

    expect(result.status).toBe('completed')
    expect(result.answer).toContain('单世界')
    expect(result.steps).toBe(2)
    expect(result.toolCalls).toBe(2)
    expect(seen).toHaveLength(2)
    expect(seen[1].at(-1)?.content).toContain('read_work_status')
    expect(seen[1].at(-1)?.content).toContain('只读工具结果')
    expect(await tableCounts()).toEqual(before)
  })

  it('坏格式只作为协议错误反馈，允许有限修正，不从自然语言猜动作', async () => {
    const projectId = await addProject()
    const seen: Array<Parameters<AgentModelAdapter['complete']>[0]> = []
    const result = await runReadOnlyAgent({
      goal: '给出结论',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        '我认为可以完成。```json\n{"type":"final","answer":"猜测"}\n```',
        '{"type":"final","answer":"已按严格协议修正"}',
      ], seen),
    })

    expect(result.status).toBe('completed')
    expect(result.answer).toBe('已按严格协议修正')
    expect(result.events.some(event => event.type === 'protocol-error')).toBe(true)
    expect(seen[1].at(-1)?.content).toContain('未执行')

    const rejectImmediately = await runReadOnlyAgent({
      goal: '禁止修正',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel(['不是 JSON']),
      limits: { maxProtocolErrors: 0 },
    })
    expect(rejectImmediately.status).toBe('protocol_error')
    expect(rejectImmediately.steps).toBe(1)
  })

  it('重复同一只读调用立即识别为循环，不再次执行', async () => {
    const projectId = await addProject()
    const action = '{"type":"tool","calls":[{"name":"read_work_status","arguments":{}}]}'
    const result = await runReadOnlyAgent({
      goal: '检查',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([action, action]),
    })

    expect(result.status).toBe('loop_detected')
    expect(result.steps).toBe(2)
    expect(result.toolCalls).toBe(1)
  })

  it('模型轮次、工具数、模型 token 和工具结果预算均由代码停止', async () => {
    const projectId = await addProject()
    const chapterId = await addChapter(projectId, '汉'.repeat(60_000))

    const noModel = scriptedModel(['{"type":"final","answer":"不应调用"}'])
    const preflight = await runReadOnlyAgent({
      goal: '预算太小',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: noModel,
      limits: { maxTotalTokens: 1 },
    })
    expect(preflight.status).toBe('token_budget')
    expect(preflight.steps).toBe(0)
    expect(noModel.complete).not.toHaveBeenCalled()

    const usageOverflow = await runReadOnlyAgent({
      goal: '真实 usage 超限',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([{
        content: '{"type":"final","answer":"不会采用"}',
        usage: { inputTokens: 5_000, outputTokens: 1_000, totalTokens: 6_000 },
      }]),
      limits: { maxTotalTokens: 5_000 },
    })
    expect(usageOverflow.status).toBe('token_budget')
    expect(usageOverflow.answer).toBe('')

    const underreportedUsage = await runReadOnlyAgent({
      goal: '不能相信零用量',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([{
        content: '{"type":"final","answer":"完成"}',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }]),
    })
    expect(underreportedUsage.status).toBe('completed')
    expect(underreportedUsage.totalTokens).toBeGreaterThan(0)

    const toolLimit = await runReadOnlyAgent({
      goal: '工具过多',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        '{"type":"tool","calls":[{"name":"read_work_status","arguments":{}},{"name":"read_world_groups","arguments":{}}]}',
      ]),
      limits: { maxToolCalls: 1 },
    })
    expect(toolLimit.status).toBe('max_tool_calls')
    expect(toolLimit.toolCalls).toBe(0)

    const resultOverflow = await runReadOnlyAgent({
      goal: '读取超长章节',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        `{"type":"tool","calls":[{"name":"read_chapter","arguments":{"chapterId":${chapterId}}}]}`,
      ]),
      limits: { maxToolResultTokens: 100 },
    })
    expect(resultOverflow.status).toBe('tool_result_budget')
    expect(resultOverflow.toolCalls).toBe(1)

    const stopBeforeSecondTool = await runReadOnlyAgent({
      goal: '读取超长章节后不要继续',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        `{"type":"tool","calls":[{"name":"read_chapter","arguments":{"chapterId":${chapterId}}},{"name":"read_work_status","arguments":{}}]}`,
      ]),
      limits: { maxToolResultTokens: 100 },
    })
    expect(stopBeforeSecondTool.status).toBe('tool_result_budget')
    expect(stopBeforeSecondTool.toolCalls).toBe(1)
    expect(stopBeforeSecondTool.events.some(
      event => event.type === 'tool' && event.name === 'read_work_status',
    )).toBe(false)
  })

  it('跨项目工具失败只作为证据回传，模型可基于失败给出诚实结论', async () => {
    const projectId = await addProject('当前项目')
    const foreignProjectId = await addProject('其它项目')
    const foreignChapterId = await addChapter(foreignProjectId, '不能泄漏')
    const seen: Array<Parameters<AgentModelAdapter['complete']>[0]> = []
    const result = await runReadOnlyAgent({
      goal: '读取指定章节',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        `{"type":"tool","calls":[{"name":"read_chapter","arguments":{"chapterId":${foreignChapterId}}}]}`,
        '{"type":"final","answer":"该章节不属于当前项目，无法读取。"}',
      ], seen),
    })

    expect(result.status).toBe('completed')
    expect(result.answer).toContain('不属于当前项目')
    expect(seen[1].at(-1)?.content).toContain('章节不属于当前项目')
    expect(seen[1].at(-1)?.content).not.toContain('不能泄漏')
  })

  it('已取消信号在任何模型调用前停止', async () => {
    const projectId = await addProject()
    const controller = new AbortController()
    controller.abort()
    const model = scriptedModel(['{"type":"final","answer":"不应调用"}'])
    const result = await runReadOnlyAgent({
      goal: '停止',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model,
      signal: controller.signal,
    })
    expect(result.status).toBe('aborted')
    expect(result.steps).toBe(0)
    expect(model.complete).not.toHaveBeenCalled()
  })

  it('批量工具执行期间收到取消信号后不再启动下一个工具', async () => {
    const projectId = await addProject()
    const controller = new AbortController()
    const result = await runReadOnlyAgent({
      goal: '读取后停止',
      context: { projectId },
      allowedToolNames: ALL_READ_TOOL_NAMES,
      model: scriptedModel([
        '{"type":"tool","calls":[{"name":"read_work_status","arguments":{}},{"name":"read_world_groups","arguments":{}}]}',
      ]),
      signal: controller.signal,
      onEvent: event => {
        if (event.type === 'tool') controller.abort()
      },
    })

    expect(result.status).toBe('aborted')
    expect(result.toolCalls).toBe(1)
    expect(result.events.some(
      event => event.type === 'tool' && event.name === 'read_world_groups',
    )).toBe(false)
  })
})
