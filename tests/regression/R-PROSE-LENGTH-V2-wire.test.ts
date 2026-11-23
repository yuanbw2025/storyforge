import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAIStream, type UseAIStreamReturn } from '../../src/hooks/useAIStream'
import { createChapterGenerationNode, InterruptedChapterGenerationErrorV1 } from '../../src/lib/generation/chapter-generation-node'
import { prepareGenerationNode, runGenerationNode } from '../../src/lib/generation/generation-node'
import { freezeFormalAIEntryBindingV1, streamRegisteredAIEntryV1, type PreparedChapterStreamV2 } from '../../src/lib/agent/formal-ai-entry'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { buildProseGenerationRunContractV4 } from '../../src/lib/agent/run/prose-generation-durable'
import { parseAgentRunContractV3, readRunBudgetSemanticsV2 } from '../../src/lib/agent/run/contract'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { bindPreparedRequestObserversV2, chat, freezeAIRequestAssessmentContextV2, prepareAIRequestV2, readPreparedRequestFrameV2,
  resolveRequestConfig, streamChat, type PublicAIResponseV2, type StreamResult } from '../../src/lib/ai/client'
import type { AIConfig, ChatMessage } from '../../src/lib/types'

const config: AIConfig = { provider: 'custom', baseUrl: 'https://b03.invalid/v1', apiKey: 'synthetic-b03-only', model: 'b03-synthetic', temperature: 0, maxTokens: 12 }
const meta = { category: 'chapter.content', transportRetryPolicy: 'none' as const }
const messages: ChatMessage[] = [{ role: 'user', content: '完整设定。'.repeat(5000) + '原文尾部标记。' }]
const packet = (content: string, finish: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ delta: { content, reasoning_content: 'HIDDEN' }, finish_reason: finish }] }) + '\n\n'
const sse = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
beforeEach(async () => {
  await db.delete(); await db.open(); resetModelCapacityForTestsV1()
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
  vi.stubGlobal('location', { hostname: 'localhost' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function prepare(reply: (signal: AbortSignal) => Response | Promise<Response>, guard = async () => {}, saveDelta?: (text: string) => Promise<void>, operation: 'generate' | 'continue' = 'generate') {
  const actualMeta = { ...meta, category: operation === 'continue' ? 'chapter.continue' : 'chapter.content' }
  const posts: string[] = [], deltas: string[] = [], responses: PublicAIResponseV2[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } })
    posts.push(String(init.body)); return reply(init.signal!)
  }))
  const resolution = resolveRequestConfig(config, actualMeta)
  const assessmentContext = await freezeAIRequestAssessmentContextV2(resolution)
  const body = { version: 'context-material-allocation-v2' as const, authorityHash: 'a'.repeat(64), capturedSourceHashes: ['b'.repeat(64)],
    selectedSourceHashes: ['b'.repeat(64)], readPlanHash: 'c'.repeat(64), inputTokenForecast: 0, captureProtocolVersion: 'registered-host-full-v2' as const }
  const contextMaterial = { ...body, allocationHash: await hashCanonicalValue(body) }
  const lengthPlan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: operation === 'continue' ? 'continue' : 'create' })
  const request = await prepareAIRequestV2({ resolution, assessmentContext, messages, stream: true, options: {},
    contextMaterial, lengthPlan, explicitConstraints: null })
  const bound = bindPreparedRequestObserversV2(request.handle, { beforeDispatch: guard,
    onPublicDelta: async delta => { await saveDelta?.(delta); deltas.push(delta) },
    onPublicResponse: async response => { responses.push(response) } })
  const result: StreamResult = {}
  const stream = (signal?: AbortSignal) => streamChat(messages, config, signal, result, actualMeta, resolution, { preparedRequestV2: bound })
  return { posts, deltas, responses, request, bound, resolution, result, stream, contextMaterial, lengthPlan }
}
async function consume(stream: AsyncGenerator<string>) { let output = ''; for await (const delta of stream) output += delta; return output }
async function withRealHook(body: (read: () => UseAIStreamReturn) => Promise<void>) {
  const reactGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true
  let current!: UseAIStreamReturn
  function Probe() { current = useAIStream(); return createElement('p', null, current.output) }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try { await act(async () => root.render(createElement(Probe))); await body(() => current) }
  finally { await act(async () => root.unmount()); host.remove() }
}

describe('B03 same prepared request reaches the real stream transport', () => {
  it('the V4 chapter contract freezes actual request allocation and refuses changed source/length evidence without creating a POST', async () => {
    const f = await prepare(() => sse(packet('不在准备阶段请求', 'stop')))
    const input = { scope: { projectId: 17, worldId: 18, workId: 19 }, worldGroupId: null, chapterId: 31, operation: 'generate' as const,
      planHash: 'd'.repeat(64), material: f.contextMaterial, request: f.request.evidence, lengthPlan: f.lengthPlan,
      sourceTextHash: 'e'.repeat(64), contentRevisionHash: 'f'.repeat(64), informationBoundaryHash: '1'.repeat(64), explicitConstraints: null }
    const contract = parseAgentRunContractV3(await buildProseGenerationRunContractV4(input))
    expect(contract.executionBindings[0]).toMatchObject({ skillId: 'prose.generate.v2', taskRequest: {
      planHash: input.planHash, materialAllocationHash: f.contextMaterial.allocationHash,
    } })
    expect(readRunBudgetSemanticsV2(contract)).toMatchObject({ mode: 'adaptive-plan', allocation: { hardConstraints: null, planHash: input.planHash } })
    expect(contract.budget.maxOutputTokens).toBe(f.request.evidence.forecastOutputTokens)
    expect(contract.budget.maxOutputTokens).toBeGreaterThan(12)
    expect(contract.verificationPlan[0].verifier).toBe('prose-generation-terminal-v4-task-length')
    await expect(buildProseGenerationRunContractV4({ ...input, material: { ...input.material, inputTokenForecast: 1 } })).rejects.toThrow('不一致')
    await expect(buildProseGenerationRunContractV4({ ...input, lengthPlan: resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'continue' }) })).rejects.toThrow('不一致')
    await expect(buildProseGenerationRunContractV4({ ...input, request: { ...input.request, policyHash: '2'.repeat(64) } })).rejects.toThrow('不一致')
    expect(f.posts).toHaveLength(0)
    expect(getAgentSkillV1('prose.consistency', 'prose').maxOutputTokens).toBe(1)
  })

  it('rejects missing, legacy, foreign and broadened frozen admission before any model POST', async () => {
    const f = await prepare(() => sse(packet('合法正文。', 'stop')))
    const binding = await freezeFormalAIEntryBindingV1('prose.chapter.generate.v2'), skill = getAgentSkillV1('prose.generate.v2', 'prose')
    const options = { preparedRequestV2: f.bound }
    const callMeta = { ...meta, formalEntryId: 'prose.chapter.generate.v2' }
    for (const prepared of [undefined,
      { binding: await freezeFormalAIEntryBindingV1('prose.chapter.generate'), skill, options },
      { binding, skill: getAgentSkillV1('world-origin.worldview-field.v2', 'world-origin'), options },
      { binding, skill: { ...skill, contextGateway: { ...skill.contextGateway!, allowedResourceKinds: [...skill.contextGateway!.allowedResourceKinds, 'world-link' as const] } }, options },
    ]) {
      await expect(consume(streamRegisteredAIEntryV1(messages, config, callMeta, undefined, {}, f.resolution, prepared))).rejects.toThrow()
      expect(f.posts).toHaveLength(0)
    }
    expect(await consume(streamRegisteredAIEntryV1(messages, config, callMeta, undefined, {}, f.resolution, { binding, skill, options }))).toBe('合法正文。')
    expect(f.posts).toHaveLength(1)
  })

  it.each(['generate', 'continue'] as const)('the actual %s generation node and hook forward the frozen admission and one exact POST', async operation => {
    const f = await prepare(() => sse(packet('新的正文候选。', 'stop')), undefined, undefined, operation)
    const preparedRequest: PreparedChapterStreamV2 = { binding: await freezeFormalAIEntryBindingV1(`prose.chapter.${operation}.v2`),
      skill: getAgentSkillV1(`prose.${operation}.v2`, 'prose'), options: { preparedRequestV2: f.bound } }
    await withRealHook(async read => {
      const node = createChapterGenerationNode({ operation, category: operation === 'continue' ? 'chapter.continue' : 'chapter.content',
        projectId: 17, chapterIdentity: 31, ai: read(), frozenResolution: f.resolution, streamResult: f.result, preparedRequest })
      const candidateReady = vi.fn()
      await act(async () => { await runGenerationNode(node, prepareGenerationNode(node, messages), {
        shadowTrace: { beforeModel: vi.fn(), modelResponded: vi.fn(), candidateReady, stepSucceeded: vi.fn(), stepFailed: vi.fn() },
      }) })
      expect(candidateReady).toHaveBeenCalledWith('新的正文候选。')
      expect(read().output).toBe('新的正文候选。'); expect(read().isStreaming).toBe(false)
    })
    expect(f.posts).toHaveLength(1); expect(f.posts[0]).toBe(readPreparedRequestFrameV2(f.request.handle).wireBody)
  })

  it('the real hook preserves unknown completion and the node refuses a candidate without another POST', async () => {
    const f = await prepare(() => sse(packet('连接未确认的原片段。')))
    await withRealHook(async read => {
      const node = createChapterGenerationNode({ operation: 'generate', category: 'chapter.content', projectId: 17, chapterIdentity: 31,
        ai: read(), frozenResolution: f.resolution, streamResult: f.result, preparedRequest: {
          binding: await freezeFormalAIEntryBindingV1('prose.chapter.generate.v2'), skill: getAgentSkillV1('prose.generate.v2', 'prose'),
          options: { preparedRequestV2: f.bound },
        } })
      const candidateReady = vi.fn()
      await act(async () => { await expect(runGenerationNode(node, prepareGenerationNode(node, messages), {
        shadowTrace: { beforeModel: vi.fn(), modelResponded: vi.fn(), candidateReady, stepSucceeded: vi.fn(), stepFailed: vi.fn() },
      })).rejects.toBeInstanceOf(InterruptedChapterGenerationErrorV1) })
      expect(f.result.completion).toBe('unknown'); expect(candidateReady).not.toHaveBeenCalled()
      expect(read().output).toBe('连接未确认的原片段。')
    })
    expect(f.posts).toHaveLength(1); expect(f.responses[0].completion).toBe('unknown')
  })

  it('sends the entire request once with frozen stream bytes, no invented max output, and persists each public delta before display', async () => {
    const f = await prepare(() => sse(packet('正文首部。') + packet('正文尾部。', 'stop')
      + 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 5, total_tokens: 5 } }) + '\n\ndata: [DONE]\n\n'))
    let output = ''
    for await (const delta of f.stream()) { output += delta; expect(f.deltas.join('')).toContain(output) }
    expect(output).toBe('正文首部。正文尾部。'); expect(f.posts).toHaveLength(1)
    expect(f.deltas).toEqual(['正文首部。正文尾部。']) // one physical read, not one write per token event
    expect(f.posts[0]).toBe(readPreparedRequestFrameV2(f.request.handle).wireBody)
    expect(JSON.parse(f.posts[0])).toMatchObject({ stream: true, messages })
    expect(JSON.parse(f.posts[0])).not.toHaveProperty('max_tokens')
    expect(f.responses).toMatchObject([{ text: output, completion: 'complete', finishReason: 'stop' }])
    expect(JSON.stringify(f.responses)).not.toContain('HIDDEN')
    expect(f.result).toMatchObject({ completion: 'complete', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 5, totalTokens: 5 } })
    await expect(consume(f.stream())).rejects.toThrow('冻结准备身份不一致')
    expect(f.posts).toHaveLength(1)
  })

  it('author cancellation before dispatch performs zero POSTs and never fabricates a response', async () => {
    const f = await prepare(() => sse(packet('不应请求', 'stop'))), controller = new AbortController()
    controller.abort()
    await expect(consume(f.stream(controller.signal))).rejects.toThrow()
    expect(f.posts).toHaveLength(0); expect(f.responses).toHaveLength(0); expect(f.result.completion).toBe('cancelled')
  })

  it('returning the stream iterator aborts that same POST, retains its exact prefix and never retries it', async () => {
    let transportAborted = false
    const f = await prepare(signal => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(packet('已收到的正文片段。')))
        signal.addEventListener('abort', () => { transportAborted = true; controller.error(new DOMException('stopped', 'AbortError')) }, { once: true })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const iterator = f.stream()
    expect((await iterator.next()).value).toBe('已收到的正文片段。')
    await iterator.return(undefined)
    expect(transportAborted).toBe(true); expect(f.posts).toHaveLength(1)
    expect(f.responses).toMatchObject([{ text: '已收到的正文片段。', completion: 'unknown' }])
    expect(f.result.completion).toBe('cancelled')
    await expect(consume(f.stream())).rejects.toThrow()
    expect(f.posts).toHaveLength(1)
  })

  it.each(['missing-terminal', 'malformed', 'length'] as const)('%s retains visible raw without calling an incomplete answer complete or creating another POST', async kind => {
    const f = await prepare(() => sse(packet('保留完整可得片段。', kind === 'length' ? 'length' : null) + (kind === 'malformed' ? 'data: not-json\n\n' : '')))
    let output = ''
    try { for await (const delta of f.stream()) output += delta } catch { /* Exact observation below is authoritative. */ }
    expect(output).toBe('保留完整可得片段。'); expect(f.posts).toHaveLength(1)
    expect(f.responses[0]).toMatchObject({ text: output, completion: kind === 'length' ? 'incomplete' : 'unknown' })
    expect(f.result.completion).toBe('unknown')
    await expect(consume(f.stream())).rejects.toThrow(); expect(f.posts).toHaveLength(1)
  })

  it('a failing durable pre-dispatch guard blocks transport, and chat cannot consume a streaming handle', async () => {
    const f = await prepare(() => sse(packet('不应请求', 'stop')), async () => { throw new Error('source stale before POST') })
    await expect(chat(messages, config, meta, undefined, {}, { preparedRequestV2: f.bound }, f.resolution)).rejects.toThrow('冻结准备身份不一致')
    expect(f.posts).toHaveLength(0)
    await expect(consume(f.stream())).rejects.toThrow()
    expect(f.posts).toHaveLength(0); expect(f.responses).toHaveLength(0)
  })

  it('a provider JSON fallback remains the same stream POST and exposes only persisted public text', async () => {
    const f = await prepare(() => new Response(JSON.stringify({ choices: [{ message: { content: '正文兼容回答。', reasoning_content: 'HIDDEN' }, finish_reason: 'stop' }] }),
      { headers: { 'Content-Type': 'application/json' } }))
    expect(await consume(f.stream())).toBe('正文兼容回答。')
    expect(f.deltas).toEqual(['正文兼容回答。']); expect(f.posts).toHaveLength(1)
    expect(f.result.completion).toBe('complete')
  })
})
