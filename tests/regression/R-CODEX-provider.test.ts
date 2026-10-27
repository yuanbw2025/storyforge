import { classifyAgentRunFailureV1 } from '../../src/lib/agent/run/failure-policy'
import { classifyHarnessFailureV1 } from '../../src/lib/agent/run/harness-failure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streamCodex, CODEX_BASE_URL, readBoundCodexReceiptV1, acknowledgeBoundCodexReceiptV1, CODEX_REQUEST_HASH_ALGORITHM_V1, CODEX_DURABLE_RECEIPT_RETENTION_V1, type CodexRequestRefV1 } from '../../src/lib/ai/codex-transport'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { chat, streamChat, type ChatResult } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { db } from '../../src/lib/db/schema'
import { recordUsage } from '../../src/lib/ai/usage-log'
import { getAIProviderCapabilityProfileV1 } from '../../src/lib/ai/provider-capabilities'
import type { AIConfig } from '../../src/lib/types'

const config: AIConfig = { provider: 'codex', apiKey: '', model: 'test', baseUrl: CODEX_BASE_URL, temperature: 0.7, maxTokens: 1024 }
const messages = [{ role: 'user' as const, content: 'Write a candidate.' }]
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
async function collect(generator: AsyncGenerator<string>) { let text = ''; for await (const part of generator) text += part; return text }
function mockBridge(status: string = 'ready', terminal: string = 'completed') {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return response({ state: status })
    if (url.endsWith('/requests') && init?.method === 'POST') return response({ id: 'accepted' }, 202)
    if (url.endsWith('/cancel')) return response({ requested: true })
    return response({ status: terminal, text: '{"title":"候选"}', dispatched: true, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, error: terminal === 'unknown' ? '结果未知' : undefined })
  })
}
beforeEach(() => {
  vi.stubGlobal('location', { hostname: 'localhost' })
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

describe('Codex subscription transport shares the governed client', () => {
  it('awaits one immutable request reference before dispatch and freezes the actual messages/schema across that wait', async () => {
    let enter!: () => void, release!: () => void, saved = false
    const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    const original = [{ role: 'user' as const, content: 'original private source' }], schema = { type: 'object', properties: { title: { type: 'string' } } }
    const result: ChatResult = { onCodexRequestPrepared: vi.fn(async ref => {
      expect(Object.isFrozen(ref)).toBe(true); expect(Object.keys(ref).sort()).toEqual(['model', 'provider', 'requestHash', 'requestHashAlgorithm', 'requestId', 'version'])
      enter(); await gate; saved = true
    }) }
    let wire = ''
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) return response({ state: 'ready' })
      if (init?.method === 'POST') { expect(saved).toBe(true); wire = init.body as string; return response({ id: JSON.parse(wire).id }, 202) }
      const ref = result.localCodexRequest!
      return response({ id: ref.requestId, model: ref.model, createdAt: 1, requestHash: ref.requestHash, requestHashAlgorithm: ref.requestHashAlgorithm,
        status: 'completed', text: '{"title":"retained"}', dispatched: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = collect(streamCodex(original, 'test', undefined, result, schema, 'json_object'))
    await entered
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    original[0].content = 'later edit'; schema.properties.title.type = 'number'; release()
    expect(await pending).toBe('{"title":"retained"}')
    expect(JSON.parse(wire)).toMatchObject({ messages: [{ role: 'user', content: 'original private source' }], receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1,
      outputSchema: { properties: { title: { type: 'string' } } }, responseFormat: 'json_object' })
    expect(result.localCodexRequest?.requestHash).toBe(await sha256Text(wire))
    expect(result.onCodexRequestPrepared).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('does not dispatch or cancel when durable reference persistence fails', async () => {
    const fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    const result: ChatResult = { onCodexRequestPrepared: vi.fn(async () => { throw new Error('original-reference-write-failed') }) }
    await expect(collect(streamCodex(messages, 'test', undefined, result))).rejects.toThrow('original-reference-write-failed')
    expect(result.requestLifecycle?.phase).toBe('pre-dispatch')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
  it('stops before dispatch if cancelled while its original reference is being saved', async () => {
    const controller = new AbortController(), fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    const result: ChatResult = { onCodexRequestPrepared: vi.fn(async () => { controller.abort() }) }
    await expect(collect(streamCodex(messages, 'test', controller.signal, result))).rejects.toThrow('取消')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(result.requestLifecycle?.phase).toBe('pre-dispatch')
  })
  const reference: CodexRequestRefV1 = { version: 1, provider: 'codex', requestId: 'e4e175fe-0509-4a7f-8f90-b0556ce166c1', model: 'test',
    requestHash: 'a'.repeat(64), requestHashAlgorithm: CODEX_REQUEST_HASH_ALGORITHM_V1 }
  const receipt = () => ({ id: reference.requestId, model: reference.model, createdAt: 1, requestHash: reference.requestHash,
    requestHashAlgorithm: reference.requestHashAlgorithm, status: 'completed', text: 'retained raw', dispatched: true })
  it.each(['running', 'completed', 'unknown'])('only reads the original hash-bound %s receipt without treating it as a candidate or replaying', async status => {
    const value = { ...receipt(), status }, fetchMock = vi.fn(async () => response(value)); vi.stubGlobal('fetch', fetchMock)
    expect(await readBoundCodexReceiptV1(reference)).toEqual(value)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]).toMatchObject([`${CODEX_BASE_URL}/requests/${reference.requestId}`, { method: 'GET' }])
  })
  it.each([
    { id: 'foreign-request' }, { model: 'other-model' }, { requestHash: 'b'.repeat(64) }, { requestHashAlgorithm: 'future-unknown' },
    { requestHash: undefined }, { status: 'new-unknown-status' }, { text: null }, { createdAt: null }, { dispatched: undefined },
    { receiptRetention: 'future-unknown' }, { ownerAcknowledgedAt: 'invalid-time' },
  ])('refuses mismatched or incomplete original receipt metadata with one GET and no fallback: %j', async patch => {
    const fetchMock = vi.fn(async () => response({ ...receipt(), ...patch })); vi.stubGlobal('fetch', fetchMock)
    await expect(readBoundCodexReceiptV1(reference)).rejects.toThrow('原冻结 Codex 请求不一致')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('rejects an invalid request reference before network access', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await expect(readBoundCodexReceiptV1({ ...reference, requestHash: '' })).rejects.toThrow('原 Codex 请求引用不完整')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([null, [], 'invalid-record', 7])('refuses a malformed receipt envelope without replay: %j', async value => {
    const fetchMock = vi.fn(async () => response(value)); vi.stubGlobal('fetch', fetchMock)
    await expect(readBoundCodexReceiptV1(reference)).rejects.toThrow('原冻结 Codex 请求不一致')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it.each(['completed', 'unknown'] as const)('hands off only the caller-saved original %s record, without a generation or candidate decision', async status => {
    const value = { id: reference.requestId, acknowledged: true, acknowledgedAt: 10, status }
    const fetchMock = vi.fn(async () => response(value)); vi.stubGlobal('fetch', fetchMock)
    expect(await acknowledgeBoundCodexReceiptV1({ request: reference, rawResponseHash: 'b'.repeat(64), confirmation: 'owner-record-saved-v1' })).toEqual(value)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]).toMatchObject([`${CODEX_BASE_URL}/requests/${reference.requestId}/acknowledge`, { method: 'POST' }])
  })
  it('refuses an unconfirmed owner handoff or incomplete acknowledgement without a generation fallback', async () => {
    const fetchMock = vi.fn(async () => response({ id: reference.requestId, acknowledged: false })); vi.stubGlobal('fetch', fetchMock)
    await expect(acknowledgeBoundCodexReceiptV1({ request: reference, rawResponseHash: '', confirmation: 'owner-record-saved-v1' })).rejects.toThrow('原作品保存准确回执')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(acknowledgeBoundCodexReceiptV1({ request: reference, rawResponseHash: 'b'.repeat(64), confirmation: 'owner-record-saved-v1' })).rejects.toThrow('交接返回不完整')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('chat and stream select the local transport, pass schema and expose usage/lifecycle', async () => {
    const fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    const result: ChatResult = {}
    expect(await chat(messages, config, undefined, undefined, result, { jsonSchema: { name: 'candidate', schema: { type: 'object' } } })).toBe('{"title":"候选"}')
    expect(result.requestLifecycle).toEqual({ phase: 'response-observed', responseStatus: 200 })
    expect(result.usage?.totalTokens).toBe(15)
    const request = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/requests') && init?.method === 'POST')!
    expect(JSON.parse(request[1]!.body as string).outputSchema).toEqual({ type: 'object' })
    expect(request[1]!.headers).not.toHaveProperty('Authorization')
    expect(await collect(streamChat(messages, config))).toBe('{"title":"候选"}')
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith(CODEX_BASE_URL))).toBe(true)
    expect(await chat(messages, config, undefined, undefined, undefined, { responseFormat: 'json_object' })).toBe('{"title":"候选"}')
  })
  it('JSON object mode rejects arrays, prose and fenced JSON without a repair call', async () => {
    for (const output of ['[]', 'not JSON', '```json\n{}\n```']) {
      const base = mockBridge()
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => url.includes('/requests/')
        ? response({ status: 'completed', text: output, dispatched: true }) : base(url, init))
      vi.stubGlobal('fetch', fetchMock)
      await expect(chat(messages, config, undefined, undefined, undefined, { responseFormat: 'json_object' })).rejects.toThrow('有效 JSON 对象')
      expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/requests') && init?.method === 'POST')).toHaveLength(1)
    }
  })
  it('a keyless routed Codex preset is used even when the global provider has a paid key', async () => {
    const apiConfig: AIConfig = { ...config, provider: 'openai', apiKey: 'must-not-send', baseUrl: 'https://api.openai.com/v1' }
    useAIConfigStore.setState({ config: apiConfig, presets: [{ id: 'codex', name: 'Codex', config }], taskRoutes: { creation: 'codex' } })
    const fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    await chat(messages, apiConfig, { category: 'chapter.content' })
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith(CODEX_BASE_URL))).toBe(true)
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('must-not-send')
  })
  it('wrong authentication and hosted origin fail without submitting a generation', async () => {
    const fetchMock = mockBridge('wrong-auth'); vi.stubGlobal('fetch', fetchMock)
    await expect(collect(streamCodex(messages, 'test'))).rejects.toThrow('登录')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.stubGlobal('location', { hostname: 'storyforge-lab.com' })
    await expect(collect(streamCodex(messages, 'test'))).rejects.toThrow('本机运行')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('unknown results never resubmit and retain the dispatched boundary', async () => {
    const fetchMock = mockBridge('ready', 'unknown'); vi.stubGlobal('fetch', fetchMock)
    const result: ChatResult = {}
    const error = await chat(messages, config, undefined, undefined, result).catch(e => e)
    expect(error.message).toContain('结果未知')
    expect((await classifyAgentRunFailureV1(error)).retryable).toBe(false)
    expect((await classifyHarnessFailureV1(error)).retryable).toBe(false)
    expect(result.requestLifecycle?.phase).toBe('request-dispatched')
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/requests') && init?.method === 'POST')).toHaveLength(1)
  })
  it('aborted calls never dispatch; closing a stream cancels its pending request', async () => {
    const fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController(); controller.abort()
    await expect(collect(streamCodex(messages, 'test', controller.signal))).rejects.toThrow('取消')
    expect(fetchMock).not.toHaveBeenCalled()
    const running = mockBridge('ready', 'running'); vi.stubGlobal('fetch', running)
    const generator = streamCodex(messages, 'test')
    await generator.next(); await generator.return()
    expect(running.mock.calls.some(([url]) => url.endsWith('/cancel'))).toBe(true)
  })
  it('native tools fail closed and API fields cannot persist in Codex config/presets', async () => {
    expect(getAIProviderCapabilityProfileV1('codex').nativeToolCalls).toBe('unsupported')
    const fetchMock = mockBridge(); vi.stubGlobal('fetch', fetchMock)
    await expect(chat(messages, config, { category: 'eval.h4.verifier' })).rejects.toThrow('金额统计')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(chat(messages, config, undefined, undefined, undefined, { tools: [{ type: 'function', function: { name: 'exec', description: '', parameters: {} } }] })).rejects.toThrow('tool_calls')
    useAIConfigStore.getState().setConfig({ apiKey: 'do-not-store', baseUrl: 'https://bad.test' })
    useAIConfigStore.getState().saveAsPreset('Local')
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
    expect(useAIConfigStore.getState().config.baseUrl).toBe(CODEX_BASE_URL)
    expect(JSON.stringify(localStorage)).not.toContain('do-not-store')
  })
  it('subscription usage has unknown cost rather than a fabricated API estimate', async () => {
    await db.aiUsageLog.clear()
    await recordUsage({ provider: 'codex', model: 'gpt-4o', category: 'test', timestamp: Date.now(), taskKind: null, inputTokens: 100, outputTokens: 100 })
    const row = (await db.aiUsageLog.toArray()).find(r => r.model === 'gpt-4o')
    expect(row?.costUsd).toBeNull()
  })
})
