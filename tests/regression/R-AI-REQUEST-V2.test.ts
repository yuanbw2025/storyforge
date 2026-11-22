import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig, ChatMessage } from '../../src/lib/types'
import type { ContextMaterialAllocationV2 } from '../../src/lib/types/agent-run'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { db } from '../../src/lib/db/schema'
import { getLogs } from '../../src/lib/ai/logger'
import { setUsageLoggingEnabled } from '../../src/lib/ai/usage-log'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { bindPreparedRequestObserversV2, chat, createAIRequestAssessorV2, freezeAIRequestAssessmentContextV2,
  prepareAIRequestV2, preparedRequestDispatchGuardV2, readPreparedNativeRequestRefV2, readPreparedRequestFrameV2,
  resolveRequestConfig, type ChatRequestOptions, type PublicAIResponseV2 } from '../../src/lib/ai/client'

// Synthetic transports only. These cases intentionally exercise the public
// client/transport path rather than substitute a product runAI callback.
const config: AIConfig = { provider: 'custom', model: 'b01-synthetic', baseUrl: 'https://b01.invalid/v1',
  apiKey: 'synthetic-b01-key', temperature: 0, maxTokens: 4000 }
const messages: ChatMessage[] = [{ role: 'system', content: '原文完整处理。' }, { role: 'user', content: ' \r\n月栖花😀\r\n末段\n ' }]
const meta = { category: 'codex.extract', transportRetryPolicy: 'none' as const }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
async function material(): Promise<ContextMaterialAllocationV2> {
  const body = { version: 'context-material-allocation-v2' as const, authorityHash: 'a'.repeat(64),
    capturedSourceHashes: ['b'.repeat(64), 'c'.repeat(64)], selectedSourceHashes: ['b'.repeat(64), 'c'.repeat(64)],
    readPlanHash: 'd'.repeat(64), inputTokenForecast: 0, captureProtocolVersion: 'registered-host-full-v2' as const }
  return { ...body, allocationHash: await hashCanonicalValue(body) }
}
async function fixtureAssessment(resolution: ReturnType<typeof resolveRequestConfig>) {
  // Select by the actual route: the routed OpenAI and native cases keep their
  // original fetch mocks, including the native /status preparation request.
  if (resolution.config.provider !== 'custom') return freezeAIRequestAssessmentContextV2(resolution)
  expect(resolution.config.baseUrl).toBe(config.baseUrl)
  expect(resolution.config.model).toBe(config.model)
  expect(resolution.config.apiKey === config.apiKey).toBe(true)
  const originalFetch = globalThis.fetch
  const metadataCalls: { url: string; method: string | undefined; redirect: RequestRedirect | undefined; bodyPresent: boolean }[] = []
  const unexpectedMetadataRequests: typeof metadataCalls = []
  const metadataFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method, redirect: init?.redirect, bodyPresent: init?.body !== undefined }
    metadataCalls.push(call)
    if (call.url !== 'https://b01.invalid/api/v1/models' || call.method !== 'GET'
      || call.redirect !== 'error' || call.bodyPresent) {
      unexpectedMetadataRequests.push(call)
      throw new Error('Unexpected metadata preparation request')
    }
    return json({ models: [] })
  })
  let outcome: { context: Awaited<ReturnType<typeof freezeAIRequestAssessmentContextV2>> } | { error: unknown }
  vi.stubGlobal('fetch', metadataFetch)
  try { outcome = { context: await freezeAIRequestAssessmentContextV2(resolution) } }
  catch (error) { outcome = { error } }
  finally { vi.stubGlobal('fetch', originalFetch) }
  // Discovery catches transport errors. Assert its independent request log
  // outside that catch, before the original inference path is invoked.
  let diagnostics: { error: unknown } | undefined
  try {
    expect(globalThis.fetch).toBe(originalFetch)
    expect(unexpectedMetadataRequests).toEqual([])
    expect(metadataCalls).toEqual([{ url: 'https://b01.invalid/api/v1/models', method: 'GET', redirect: 'error', bodyPresent: false }])
    expect(metadataFetch).toHaveBeenCalledOnce()
    expect(metadataCalls.some(call => call.method === 'POST')).toBe(false)
  } catch (error) { diagnostics = { error } }
  if ('error' in outcome) {
    if (diagnostics) throw Object.assign(new Error('Metadata assessment and fixture diagnostics failed'), {
      assessmentError: outcome.error, fixtureError: diagnostics.error,
    })
    throw outcome.error
  }
  if (diagnostics) throw diagnostics.error
  return outcome.context
}
async function prepared(aiConfig = config, inputMessages = messages, options: ChatRequestOptions = {}) {
  const resolution = resolveRequestConfig(aiConfig, meta)
  const assessmentContext = await fixtureAssessment(resolution)
  const request = await prepareAIRequestV2({ resolution, assessmentContext, messages: inputMessages,
    options, stream: false, contextMaterial: await material(), lengthPlan: null, explicitConstraints: null })
  if (resolution.config.provider === 'custom') {
    expect(request.evidence.capacity).toMatchObject({ contextTokens: null, inputTokens: null, outputTokens: null })
  }
  return { resolution, assessmentContext, ...request }
}
beforeEach(async () => {
  await db.delete(); await db.open(); setUsageLoggingEnabled(true)
  resetModelCapacityForTestsV1()
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
  vi.stubGlobal('location', { hostname: 'localhost' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('B01 C01/C02/C03/C10/C15/C20/C25/C27 · prepared request identity', () => {
  it('binds a frozen typed length plan into policy identity while Codex still refuses a non-null plan before POST', async () => {
    const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const resolution = resolveRequestConfig(config, meta)
    const assessmentContext = await fixtureAssessment(resolution)
    const contextMaterial = await material()
    const lengthPlan = resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'create' })
    const request = await prepareAIRequestV2({ resolution, assessmentContext, messages, options: {}, stream: false,
      contextMaterial, lengthPlan, explicitConstraints: null })
    const expectedHash = await hashCanonicalValue({ profile: 'task-request-v2', materialAllocationHash: contextMaterial.allocationHash,
      lengthPlan, explicitConstraints: null })
    expect(request.evidence.policyHash).toBe(expectedHash)
    const nullPlan = await prepareAIRequestV2({ resolution, assessmentContext, messages, options: {}, stream: false,
      contextMaterial, lengthPlan: null, explicitConstraints: null })
    expect(nullPlan.evidence.policyHash).not.toBe(expectedHash)
    if (lengthPlan.mode !== 'automatic') throw new Error('测试要求自动计划')
    lengthPlan.referenceWords = 1
    expect(request.evidence.policyHash).toBe(expectedHash)
    const bound = bindPreparedRequestObserversV2(request.handle, { beforeDispatch: async () => undefined, onPublicResponse: async () => undefined })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound }, resolution)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(prepareAIRequestV2({ resolution, assessmentContext, messages, options: {}, stream: false, contextMaterial,
      lengthPlan: { ...lengthPlan, unexpectedPermission: true } as never, explicitConstraints: null })).rejects.toThrow()
  })

  it('unknown capacity admits the entire 20k CJK request and omits an invented output cap', async () => {
    const long = [{ role: 'user' as const, content: ' \r\n' + '原文😀\r\n'.repeat(4000) + '尾段 ' }]
    const row = await prepared(config, long), frame = readPreparedRequestFrameV2(row.handle)
    expect(frame.messages).toEqual(long)
    expect(JSON.parse(frame.wireBody).messages).toEqual(long)
    expect(JSON.parse(frame.wireBody)).not.toHaveProperty('max_tokens')
    expect(row.evidence.capacity).toMatchObject({ contextTokens: null, inputTokens: null, outputTokens: null })
    expect(row.evidence.wireOutputTokens).toBeNull()
    expect(row.evidence.forecastOutputTokens).toBeGreaterThan(4000)
    expect(createAIRequestAssessorV2(row.assessmentContext).assess(long, {}).decision).toBe('uncertain')
    expect(JSON.stringify(row.evidence)).not.toContain(config.apiKey)
    expect(JSON.stringify(row.evidence)).not.toContain('b01.invalid')
    expect(() => JSON.stringify(row.handle)).toThrow()
  })

  it('sends exactly the stored body once, then projects only visible text, finish and present usage', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ choices: [{ message: { content: '[invalid domain JSON', reasoning_content: 'HIDDEN' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 9, private_cost: 'HIDDEN' }, hidden: 'HIDDEN' }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), frame = readPreparedRequestFrameV2(row.handle)
    const guard = vi.fn(async () => undefined), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: guard, onPublicResponse: async value => { observed.push(value) } })
    const result = { beforeModelDispatch: preparedRequestDispatchGuardV2(bound) }
    expect(await chat(messages, config, meta, undefined, result, { preparedRequestV2: bound }, row.resolution)).toBe('[invalid domain JSON')
    expect(guard).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(frame.wireBody)
    expect(await sha256Text(frame.wireBody)).toBe(row.evidence.wireBodyHash)
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ text: '[invalid domain JSON', finishReason: 'stop', completion: 'complete', usage: { inputTokens: 0, outputTokens: 9 } })
    expect(observed[0].usage).not.toHaveProperty('totalTokens')
    expect(JSON.stringify(observed)).not.toContain('HIDDEN')
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound }, row.resolution)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([false, true])('accounts complete measured HTTP usage on the frozen actual route once (observer fails=%s)', async observerFails => {
    const routed: AIConfig = { ...config, provider: 'openai', model: 'b01-routed-synthetic', baseUrl: 'https://routed.invalid/v1', apiKey: 'synthetic-route' }
    useAIConfigStore.setState({ presets: [{ id: 'b01-route', name: '合成冻结路由', config: routed }], taskRoutes: { extraction: 'b01-route' } })
    const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 7, total_tokens: 7 } }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: async value => {
      observed.push(value); if (observerFails) throw new Error('raw observer save failed')
    } })
    const invoke = () => chat(messages, config, { ...meta, projectId: 123 }, undefined, {}, { preparedRequestV2: bound }, row.resolution)
    if (observerFails) await expect(invoke()).rejects.toThrow()
    else expect(await invoke()).toBe('[]')
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    expect(await db.aiUsageLog.toArray()).toEqual([expect.objectContaining({ projectId: 123, provider: 'openai', model: routed.model,
      taskKind: 'extraction', category: 'codex.extract', inputTokens: 0, outputTokens: 7 })])
    expect(getLogs().find(log => log.model === routed.model)).toMatchObject({ provider: 'openai', usage: { inputTokens: 0, outputTokens: 7, totalTokens: 7 } })
    expect(observed[0].usage).toEqual({ inputTokens: 0, outputTokens: 7, totalTokens: 7 })
    await expect(invoke()).rejects.toThrow()
    expect(await db.aiUsageLog.count()).toBe(1); expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([{}, { prompt_tokens: 0 }, { completion_tokens: 0 }, { total_tokens: 0 }])('keeps unrepresentable partial HTTP usage as exact evidence without a fabricated bill: %j', async usage => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }], usage })))
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: async value => { observed.push(value) } })
    await chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })
    const expected = Object.fromEntries([['prompt_tokens','inputTokens'],['completion_tokens','outputTokens'],['total_tokens','totalTokens']]
      .filter(([key]) => Object.prototype.hasOwnProperty.call(usage, key)).map(([key,value]) => [value, usage[key as keyof typeof usage]]))
    expect(observed[0].usage).toEqual(expected)
    expect(await db.aiUsageLog.count()).toBe(0)
  })

  it('records both measured zero dimensions without inventing an omitted total in the connection log', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } })))
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: async value => { observed.push(value) } })
    await chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
    expect(observed[0].usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(getLogs().find(log => log.model === config.model)?.usage).toBeUndefined()
  })

  it('accounts fully measured HTTP failure usage once even when saving its safe observation also fails', async () => {
    const fetchMock = vi.fn(async () => json({ error: { message: 'HIDDEN' }, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }, 402))
    vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: async value => {
      observed.push(value); throw new Error('failed outcome could not be saved')
    } })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ provider: config.provider, model: config.model, inputTokens: 0, outputTokens: 0, costUsd: 0 })
    expect(observed).toEqual([expect.objectContaining({ responseStatus: 402, completion: 'failed', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['messages', 'options', 'route', 'guard', 'policy'] as const)('rejects changed %s before POST', async change => {
    const fetchMock = vi.fn(async () => json({})); vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), guard = vi.fn(async () => undefined)
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: guard, onPublicResponse: async () => undefined })
    const actualMessages = change === 'messages' ? [{ role: 'user' as const, content: '篡改' }] : messages
    const actualConfig = change === 'route' ? { ...config, temperature: 0.3 } : config
    const options: ChatRequestOptions = { preparedRequestV2: bound,
      ...(change === 'options' ? { responseFormat: 'json_object' as const } : {}),
      ...(change === 'policy' ? { capacityPolicy: 'reference-service' as const } : {}) }
    const result = change === 'guard' ? { beforeModelDispatch: async () => undefined } : {}
    await expect(chat(actualMessages, actualConfig, meta, undefined, result, options)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not dispatch when the only durable guard fails, and never invokes it twice', async () => {
    const fetchMock = vi.fn(async () => json({})); vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), guard = vi.fn(async () => { throw new Error('save failed') })
    const observer = vi.fn(async () => undefined)
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: guard, onPublicResponse: observer })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    expect(guard).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled()
  })

  it.each([400, 401, 402, 403, 429, 500])('saves a safe HTTP %s observation without a hidden retry', async status => {
    const fetchMock = vi.fn(async () => json({ error: { message: `HIDDEN:${config.apiKey}` }, usage: { completion_tokens: 0 } }, status))
    vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: async value => { observed.push(value) } })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(observed).toEqual([expect.objectContaining({ text: '', completion: 'failed', responseStatus: status, usage: { outputTokens: 0 } })])
    expect(JSON.stringify(observed)).not.toContain('HIDDEN')
  })

  it.each(['length', 'content_filter', 'unknown'])('retains the visible %s response before reporting a stopped request', async finish => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '未完成原答' }, finish_reason: finish }] })))
    const row = await prepared(), observed = vi.fn(async (_value: PublicAIResponseV2) => undefined)
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: observed })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    expect(observed).toHaveBeenCalledOnce()
    expect(observed.mock.calls[0][0]).toMatchObject({ text: '未完成原答', completion: finish === 'length' ? 'incomplete' : 'unknown' })
  })

  it('saves an unknown observation after a dispatched network failure without claiming a measured zero', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('lost') }); vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(), observed = vi.fn(async (_value: PublicAIResponseV2) => undefined)
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined, onPublicResponse: observed })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalledOnce()
    expect(observed.mock.calls[0][0]).toMatchObject({ completion: 'unknown', usage: {}, wireDigest: null })
  })

  it('flushes UTF8 and the last SSE event at EOF, saving incremental public pieces and present zero usage only', async () => {
    const wire = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '月', reasoning_content: 'HIDDEN' } }] }) + '\r\n\r\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: { content: '😀' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0 } })
    const bytes = new TextEncoder().encode(wire)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } })))
    const row = await prepared(), deltas: string[] = [], observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined,
      onPublicDelta: async value => { deltas.push(value) }, onPublicResponse: async value => { observed.push(value) } })
    expect(await chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).toBe('月😀')
    expect(deltas).toEqual(['月','😀'])
    expect(observed).toEqual([expect.objectContaining({ text: '月😀', completion: 'complete', usage: { inputTokens: 0 }, wireDigest: await sha256Text(wire) })])
    expect(JSON.stringify(observed)).not.toContain('HIDDEN')
  })

  it('preserves safe SSE pieces but does not claim complete decoding after a malformed event', async () => {
    const wire = 'data: {"choices":[{"delta":{"content":"可见"}}]}\n\n'
      + 'data: INVALID-HIDDEN\n\n' + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } })))
    const row = await prepared(), observed: PublicAIResponseV2[] = []
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: async () => undefined,
      onPublicDelta: async () => undefined, onPublicResponse: async value => { observed.push(value) } })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: bound })).rejects.toThrow()
    expect(observed).toEqual([expect.objectContaining({ text: '可见', completion: 'unknown', wireDigest: await sha256Text(wire) })])
    expect(JSON.stringify(observed)).not.toContain('INVALID-HIDDEN')
  })

  it('rejects a non-null extraction length plan rather than activating an implicit B02 runtime', async () => {
    const row = await prepared()
    await expect(prepareAIRequestV2({ resolution: row.resolution, assessmentContext: row.assessmentContext,
      messages, options: {}, stream: false, contextMaterial: await material(), lengthPlan: {} as never, explicitConstraints: null })).rejects.toThrow()
  })

  it('fixes native id, retention and exact bytes before binding, preserving the existing six-key ref', async () => {
    const nativeConfig: AIConfig = { ...config, provider: 'codex', apiKey: '', baseUrl: '/storyforge/local-codex/v1' }
    useAIConfigStore.setState({ config: nativeConfig })
    let wire = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/status')) return json({ state: 'ready' })
      if (init?.method === 'POST') { wire = String(init.body); return json({ id: JSON.parse(wire).id }, 202) }
      const body = JSON.parse(wire)
      return json({ id: body.id, model: body.model, createdAt: 1, requestHash: await sha256Text(wire),
        requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: 'until-owner-ack-v1', status: 'completed', text: '[]', dispatched: true,
        usage: { inputTokens: 0, outputTokens: 4, totalTokens: 4 } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const row = await prepared(nativeConfig), frame = readPreparedRequestFrameV2(row.handle), ref = readPreparedNativeRequestRefV2(row.handle)!
    expect(ref.requestHash).toBe(await sha256Text(frame.wireBody))
    expect(Object.keys(ref).sort()).toEqual(['model','provider','requestHash','requestHashAlgorithm','requestId','version'])
    expect(JSON.parse(frame.wireBody)).toMatchObject({ id: ref.requestId, receiptRetention: 'until-owner-ack-v1' })
    expect(JSON.parse(frame.wireBody)).not.toHaveProperty('capacityPolicy')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    const guard = vi.fn(async () => undefined)
    const bound = bindPreparedRequestObserversV2(row.handle, { beforeDispatch: guard, onPublicResponse: async () => undefined, onPublicDelta: async () => undefined })
    expect(await chat(messages, nativeConfig, meta, undefined, {}, { preparedRequestV2: bound }, row.resolution)).toBe('[]')
    expect(wire).toBe(frame.wireBody); expect(guard).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/acknowledge'))).toBe(false)
    await vi.waitFor(async () => expect(await db.aiUsageLog.count()).toBe(1))
    const accounted = await db.aiUsageLog.toArray()
    expect(accounted).toEqual([expect.objectContaining({ provider: 'codex', model: nativeConfig.model, taskKind: 'extraction',
      inputTokens: 0, outputTokens: 4, costUsd: null })])
    const transportCalls = fetchMock.mock.calls.length
    await expect(chat(messages, nativeConfig, meta, undefined, {}, { preparedRequestV2: bound }, row.resolution)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(transportCalls)
    expect(await db.aiUsageLog.toArray()).toEqual(accounted)
  })
})
