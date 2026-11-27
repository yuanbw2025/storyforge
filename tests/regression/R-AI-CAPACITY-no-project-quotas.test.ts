import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, streamChat, resolveRequestConfig } from '../../src/lib/ai/client'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createPromptExecutionRequestV1, freezePromptExecutionOptionsV1, renderFrozenPromptExecutionV1 } from '../../src/lib/agent/prompt-execution'
import { parseWorldviewFieldCandidateDraft, parseWorldviewFieldOutputBudgetV1, resolveWorldviewFieldOutputBudgetV1 } from '../../src/lib/agent/worldview-field-copilot'
import type { AIConfig, ChatMessage } from '../../src/lib/types'
import type { PromptTemplate } from '../../src/lib/types/prompt'

const config = (maxTokens = 0): AIConfig => ({ provider: 'custom', model: 'isolated-long-context',
  baseUrl: 'https://capacity.invalid/v1', apiKey: 'SYNTHETIC_ONLY', temperature: 0, maxTokens })

beforeEach(() => {
  resetModelCapacityForTestsV1()
  useAIConfigStore.setState({ config: config(), taskRoutes: {}, presets: [] })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function transport(reply: string, window?: number, stream = false) {
  const bodies: Array<{ messages: ChatMessage[]; max_tokens?: number }> = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'GET') return Response.json(window == null ? {} : {
      models: [{ key: config().model, type: 'llm', loaded_instances: [{ config: { context_length: window } }] }],
    })
    bodies.push(JSON.parse(String(init?.body)))
    return stream ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] })
  }))
  return bodies
}

describe('current AI requests have no project text/output quotas', () => {
  it.each([false, true])('sends full unknown-capacity input and receives >200k characters (stream=%s)', async streaming => {
    const messages: ChatMessage[] = [{ role: 'system', content: '保留原设定与末段规则。' },
      { role: 'user', content: '完整设定。'.repeat(12_000) + '末段不得丢失。' }]
    const reply = '完整正文。'.repeat(41_000) + '末尾校验'
    const bodies = transport(reply, undefined, streaming)
    let received = ''
    if (streaming) for await (const delta of streamChat(messages, config(32), undefined, undefined, { category: 'capacity.closeout', contextOverflowPolicy: 'reject' })) received += delta
    else received = await chat(messages, config(32), { category: 'capacity.closeout', contextOverflowPolicy: 'reject' })
    expect(received).toBe(reply)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].messages).toEqual(messages)
    expect(bodies[0]).not.toHaveProperty('max_tokens')
  })

  it('ignores saved global/preset and per-call token limits while preserving routing and temperature', async () => {
    const cfg = config(32), preset = {...config(64), model: 'legacy-preset-model'}
    useAIConfigStore.setState({config: cfg, presets: [{id: 'legacy', name: '旧预设', config: preset}], taskRoutes: {creation: 'legacy'}})
    const meta = {category: 'chapter.content', configOverrides: {maxTokens: 16, temperature: .2}}
    const bodies = transport('完整生成')
    await chat([{role: 'user', content: '生成完整设定'}], cfg, meta)
    expect(bodies[0]).not.toHaveProperty('max_tokens')
    expect(resolveRequestConfig(cfg, meta).config).toMatchObject({model: preset.model, temperature: .2, maxTokens: 0})
    expect(cfg.maxTokens).toBe(32)
    expect(preset.maxTokens).toBe(64)
  })

  it('lets the service manage output when only its context window is evidenced', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: '完整证据。'.repeat(2_000) }]
    const bodies = transport('完整回答', 100_000)
    await chat(messages, config(64))
    expect(bodies[0]).not.toHaveProperty('max_tokens')
    expect(bodies[0].messages).toEqual(messages)
  })

  it('uses an evidenced service output limit rather than a saved small API limit', async () => {
    const cfg: AIConfig = {...config(64), provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1'}
    const bodies = transport('完整结果')
    await chat([{role: 'user', content: '按任务完成内容'}], cfg)
    expect(bodies[0].max_tokens).toBe(65_500)
    expect(cfg.maxTokens).toBe(64)
  })

  it('still rejects an actually evidenced small service window before a POST', async () => {
    const bodies = transport('不应派发', 4_096)
    await expect(chat([{ role: 'user', content: '原文'.repeat(20_000) }], config(), { contextOverflowPolicy: 'reject' }))
      .rejects.toThrow('实际上下文窗口')
    expect(bodies).toHaveLength(0)
  })

  it('retains complete registered material despite old source/role quotas', async () => {
    await db.delete(); await db.open()
    const { scope } = await seedCurrentWorkspace('unbounded context regression')
    transport('未调用模型')
    const text = '基础设定与细节。'.repeat(12_000) + '最后一条禁例'
    const result = await assembleContext({ projectId: scope.projectId, scope, sourceKeys: ['manualText'],
      manualSourceText: text, modelConfig: config(), inputBudgetTokens: 64, inputBudgetMaxTokens: 64, sourceBudgetScale: .1 })
    expect(result.text).toContain(text)
    expect(result.trimmed).toEqual([])
    expect(result.sourceEvidence?.[0]).toMatchObject({ delivery: 'full', originalCharacters: text.length, inputCharacters: text.length })
    expect(Number.isSafeInteger(result.inputBudget)).toBe(true)
  })

  it('accepts long author templates/parameters while retaining hashes and field scope', async () => {
    const text = '作者原始设定。'.repeat(25_000)
    const template: PromptTemplate = { id: 71, scope: 'user', moduleKey: 'worldview.dimension', promptType: 'generate', name: '长设定',
      description: '', systemPrompt: text, userPromptTemplate: '{{setting}}', variables: ['setting'],
      parameters: [{ key: 'setting', label: '设定', type: 'text', default: '' }], isActive: true, createdAt: 1, updatedAt: 1 }
    const options = await freezePromptExecutionOptionsV1({ template, request: createPromptExecutionRequestV1({
      moduleKey: 'worldview.dimension', parameterValues: { setting: text }, userOverride: text }) })
    const result = await renderFrozenPromptExecutionV1({ options, context: {}, hardSystem: '字段/权限不变', authorInstruction: text })
    expect(result.messages.map(message => message.content).join('\n')).toContain(text)
    await expect(renderFrozenPromptExecutionV1({ options: { ...options, template: { ...options.template, systemPrompt: '篡改' } },
      context: {}, hardSystem: '不变', authorInstruction: text })).rejects.toThrow()
    const raw = JSON.stringify({ field: 'races', value: text })
    expect(parseWorldviewFieldCandidateDraft(raw).value).toBe(text)
    expect(() => parseWorldviewFieldCandidateDraft(JSON.stringify({ field: 'not-a-writable-field', value: text }))).toThrow()
  })

  it('node/legacy-field starts use automatic output without a Skill/field cap, and old budgets remain readable', () => {
    const automatic = resolveWorldviewFieldOutputBudgetV1({ config: config(), targetField: 'races', skillMaxOutputTokens: 6_000 })
    expect(automatic).toMatchObject({ effectiveMaxTokens: 0, schemaCapTokens: 0, skillCapTokens: 0, longOutputMode: 'service-capacity' })
    const explicit = resolveWorldviewFieldOutputBudgetV1({ config: config(), targetField: 'races', skillMaxOutputTokens: 6_000, requestedMaxTokens: 64_000 })
    expect(explicit.effectiveMaxTokens).toBe(0)
    expect(explicit.authorConfigCapTokens).toBe(0)
    expect(parseWorldviewFieldOutputBudgetV1(explicit)).toEqual(explicit)
    expect(parseWorldviewFieldOutputBudgetV1({ version: 1, source: 'default', requestedTokens: 8_000,
      effectiveMaxTokens: 4_000, effectiveCapTokens: 4_000, modelCapTokens: 4_000, authorConfigCapTokens: 4_000,
      schemaCapTokens: 30_256, skillCapTokens: 6_000, longOutputMode: 'disabled' })).toMatchObject({ effectiveMaxTokens: 4_000 })
  })
})
