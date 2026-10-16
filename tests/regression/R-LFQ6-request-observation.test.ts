import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, streamChat, describeResolvedAIRequestSettingsV1, resolveRequestConfig, type StreamResult } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { parseProseRequestSettingsV1, proseRenderedRequestV1 } from '../../src/lib/prose/request-evidence'
import { observeProseLengthV1, proseLengthExpectationV1, parseProseLengthObservationV1 } from '../../src/lib/prose/length-observation'

const previous = useAIConfigStore.getState()
const config = { ...previous.config, provider: 'deepseek' as const, model: 'deepseek-chat', apiKey: 'test-only-secret', baseUrl: 'http://localhost:1234/v1', temperature: 0, maxTokens: 3000 }

describe('LFQ6 · 实际请求参数与正文完成情况', () => {
  afterEach(() => { vi.unstubAllGlobals(); useAIConfigStore.setState(previous, true) })

  it.each([429, 503])('durable 显式禁止重发时 HTTP %s 只发送一次', async status => {
    const fetch = vi.fn(async () => new Response('暂时不可用', { status }))
    vi.stubGlobal('fetch', fetch)
    await expect((async () => {
      for await (const _chunk of streamChat([{ role: 'user', content: '全文评审' }], config, undefined, {}, { transportRetryPolicy: 'none' })) { /* collect until failure */ }
    })()).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('参数证据对应真实请求构造，提供商不支持的参数不能冒充已发送；从不含密钥、地址或提示词', () => {
    useAIConfigStore.setState({ config })
    const resolution = resolveRequestConfig(config)
    const safe = describeResolvedAIRequestSettingsV1(resolution, false)
    expect(safe.parameters).toEqual({ temperature: 0, max_tokens: 3000 })
    expect(JSON.stringify(safe)).not.toContain('test-only-secret')
    expect(JSON.stringify(safe)).not.toContain('localhost')
    expect(parseProseRequestSettingsV1(safe)).toEqual(safe)
    const glm = describeResolvedAIRequestSettingsV1({ ...resolution, config: { ...config, provider: 'glm' } }, true)
    expect(glm.requested.temperature).toBe(0)
    expect(glm.parameters.temperature).toBe(0.01)
    const poe = describeResolvedAIRequestSettingsV1({ ...resolution, config: { ...config, provider: 'poe' } }, false)
    expect(poe.parameters).toEqual({})
    expect(() => parseProseRequestSettingsV1({ ...safe, apiKey: 'leak' })).toThrow('无效')
    expect(() => parseProseRequestSettingsV1({ ...safe, parameters: { apiKey: 'leak' } })).toThrow('禁止')
    expect(proseRenderedRequestV1([{ role: 'user', content: '正文任务' }], safe).messages[0].content).toBe('正文任务')
  })

  it('路由在准备后改变，非流式与流式均使用冻结的模型参数；保留 length 终止原因', async () => {
    useAIConfigStore.setState({ config, taskRoutes: {} })
    const resolution = resolveRequestConfig(config)
    useAIConfigStore.setState({ config: { ...config, model: 'different-model', temperature: 0.9 } })
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body)
      if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"只到这里"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      return new Response(JSON.stringify({ choices: [{ message: { content: '已完成的一段。' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
    }))
    await chat([{ role: 'user', content: '正文任务' }], config, undefined, undefined, undefined, undefined, resolution)
    const stream: StreamResult = {}; let text = ''
    for await (const chunk of streamChat([{ role: 'user', content: '正文任务' }], config, undefined, stream, undefined, resolution)) text += chunk
    expect(text).toBe('只到这里')
    expect(stream.finishReason).toBe('length')
    expect(stream.completion).toBe('complete')
    expect(bodies.map(body => [body.model, body.temperature, body.max_tokens])).toEqual([['deepseek-chat', 0, 3000], ['deepseek-chat', 0, 3000]])
  })

  it('JSON评审的实际模式进入安全参数证据，不能伪造任意schema或密钥', async () => {
    const options = { responseFormat: 'json_object' as const }
    const resolution = resolveRequestConfig(config)
    const settings = describeResolvedAIRequestSettingsV1(resolution, false, options)
    expect(settings.parameters.response_format).toEqual({ type: 'json_object' })
    expect(parseProseRequestSettingsV1(settings)).toEqual(settings)
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.stream).toBe(false)
      expect(body.response_format).toEqual(settings.parameters.response_format)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"只读报告"}' }, finish_reason: 'stop' }] }))
    })
    vi.stubGlobal('fetch', fetch)
    await chat([{ role: 'user', content: '完整章节' }], config, { contextOverflowPolicy: 'reject' }, undefined, {}, options, resolution)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(() => parseProseRequestSettingsV1({ ...settings, parameters: { response_format: { type: 'json_object', apiKey: 'leak' } } })).toThrow('JSON')
  })

  it('显式范围、单个目标、只设上限、留白及截断区别提示，未自动重发或强制文学结论', () => {
    const range = proseLengthExpectationV1('只写600～900字，签收处停笔', 2500)!
    expect(range).toMatchObject({ min: 600, max: 900, source: 'author' })
    expect(observeProseLengthV1('字'.repeat(465), range).status).toBe('short')
    expect(observeProseLengthV1('字'.repeat(700), range).status).toBe('within')
    expect(observeProseLengthV1('字'.repeat(950), range).status).toBe('long')
    const cap = proseLengthExpectationV1('不要超过600字')!
    expect(observeProseLengthV1('字'.repeat(100), cap).status).toBe('within')
    expect(proseLengthExpectationV1('按场景自然收尾')).toBeNull()
    expect(proseLengthExpectationV1('不要写600字那种摘要')).toBeNull()
    expect(proseLengthExpectationV1('上章写了600字，本章顺其自然')).toBeNull()
    const target = proseLengthExpectationV1('只写500字')!
    expect(target).toMatchObject({ min: 400, max: 600, target: 500 })
    const cut = observeProseLengthV1('字'.repeat(700), range, 'length')
    expect(cut.status).toBe('truncated')
    expect(cut.message).toContain('没有自动重发')
    expect(parseProseLengthObservationV1(cut)).toEqual(cut)
    expect(() => parseProseLengthObservationV1({ ...cut, wordCount: -1 })).toThrow('无效')
    expect(() => parseProseLengthObservationV1({ ...cut, expectation: false })).toThrow('无效')
    expect(() => parseProseLengthObservationV1({ ...cut, status: 'within' })).toThrow('不一致')
    expect(() => parseProseLengthObservationV1({ ...cut, message: '伪造的提示' })).toThrow('不一致')
  })

  it('没有完成标记的连接结束保留 unknown，不能冒充完整响应', async () => {
    useAIConfigStore.setState({ config, taskRoutes: {} })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"半段文字"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })))
    const result: StreamResult = {}; let text = ''
    for await (const chunk of streamChat([{ role: 'user', content: '正文任务' }], config, undefined, result)) text += chunk
    expect(text).toBe('半段文字')
    expect(result.completion).toBe('unknown')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
