import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { streamChat, type StreamResult } from '../../src/lib/ai/client'
import { clearLogs, getLogs } from '../../src/lib/ai/logger'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAIStream } from '../../src/hooks/useAIStream'
import { createChapterGenerationNode, InterruptedChapterGenerationErrorV1 } from '../../src/lib/generation/chapter-generation-node'
import { prepareGenerationNode, runGenerationNode } from '../../src/lib/generation/generation-node'
import { MemoryRouter } from 'react-router'
import ChapterEditor from '../../src/components/editor/ChapterEditor'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { useAIGenerationSessionStore } from '../../src/stores/ai-generation-session'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { hashChapterText, sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  beginProseGenerationGatewayStepV1, createProseGenerationDurableRunV1,
  failProseGenerationStepV1, finalizeProseGenerationGatewayStepV1,
  readLatestInterruptedProseGenerationV1, readProseGenerationObservedUsageV1,
  recordInterruptedProseGenerationV1,
} from '../../src/lib/agent/run/prose-generation-durable'

const config = { provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://example.invalid/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 1000 }
beforeEach(async () => { await db.delete(); await db.open(); clearLogs(); useAIConfigStore.setState({ config, taskRoutes: {} }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

it.each(['reader-error', 'abort'] as const)('142 real ReadableStream retains observed usage on %s', async terminal => {
  const controller = new AbortController()
  let source!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) {
    source = value
    value.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":7,"total_tokens":38}}\n\ndata: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
  const fetch = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetch)
  const result: StreamResult = {}
  const iterator = streamChat([{ role: 'user', content: 'synthetic' }], config, controller.signal, result,
    { category: `quality142.${terminal}`, transportRetryPolicy: 'none' })
  expect(await iterator.next()).toMatchObject({ value: 'partial', done: false })
  if (terminal === 'abort') controller.abort()
  source.error(terminal === 'abort' ? new DOMException('synthetic cancel', 'AbortError') : new Error('synthetic reader failure'))
  await expect(iterator.next()).rejects.toThrow()
  expect(result).toMatchObject({ usage: { inputTokens: 31, outputTokens: 7, totalTokens: 38 },
    completion: terminal === 'abort' ? 'cancelled' : 'failed' })
  expect(getLogs()[0]).toMatchObject({ status: 'error', usage: result.usage })
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 31, outputTokens: 7 })
  expect(fetch).toHaveBeenCalledTimes(1)
})


function reply(events: unknown[], done = true) {
  return new Response(events.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('')
    + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'Content-Type': 'text/event-stream' } })
}
async function collect(result: StreamResult) {
  let text = ''
  for await (const chunk of streamChat([], config, undefined, result, { category: 'quality142.probe', transportRetryPolicy: 'none' })) text += chunk
  return text
}
const actualUsage = { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 }
const expectedUsage = { inputTokens: 31, outputTokens: 7, totalTokens: 38 }

it.each(['done', 'eof-complete', 'eof-unknown'] as const)('normal %s keeps the last cumulative snapshot exactly once within this generator', async terminal => {
  const events: unknown[] = [{ usage: { prompt_tokens: 31, completion_tokens: 2, total_tokens: 33 } }, { usage: actualUsage },
    { choices: [{ delta: { content: 'synthetic' }, ...(terminal === 'eof-unknown' ? {} : { finish_reason: 'stop' }) }] }]
  const fetch = vi.fn(async () => reply(events, terminal === 'done')); vi.stubGlobal('fetch', fetch)
  const result: StreamResult = {}
  expect(await collect(result)).toBe('synthetic')
  expect(result).toMatchObject({ usage: expectedUsage, completion: terminal === 'eof-unknown' ? 'unknown' : 'complete' })
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 31, outputTokens: 7 })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('consumer return retains already parsed usage; same delta event=%s', async sameEvent => {
  const events = sameEvent ? [{ usage: actualUsage, choices: [{ delta: { content: 'partial' } }] }]
    : [{ usage: actualUsage }, { choices: [{ delta: { content: 'partial' } }] }]
  const fetch = vi.fn(async () => reply(events)); vi.stubGlobal('fetch', fetch)
  const result: StreamResult = {}; const iterator = streamChat([], config, undefined, result)
  expect(await iterator.next()).toMatchObject({ value: 'partial' })
  await iterator.return(undefined)
  expect(result).toMatchObject({ usage: expectedUsage, completion: 'cancelled' })
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('no provider usage stays unknown without inventing a zero bill', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ choices: [{ delta: { content: 'partial' } }] }], false)))
  const result: StreamResult = {}; await collect(result)
  expect(result.usage).toBeUndefined(); expect(result.completion).toBe('unknown')
  expect(await db.aiUsageLog.count()).toBe(0)
})

it.each([false, true])('malformed usage cannot create zero or replace a prior valid snapshot: previous=%s', async prior => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([...(prior ? [{ usage: actualUsage }] : []), { usage: {} }])))
  const result: StreamResult = {}; await collect(result)
  expect(result.usage).toEqual(prior ? expectedUsage : undefined)
  await expect.poll(() => db.aiUsageLog.count()).toBe(prior ? 1 : 0)
  if (prior) expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 31, outputTokens: 7 })
})

it('reusing a result object cannot transfer previous-request usage into an unknown request', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply([{ usage: actualUsage }]))
    .mockResolvedValueOnce(reply([{ choices: [{ delta: { content: 'partial' } }] }], false))
  vi.stubGlobal('fetch', fetch)
  const result: StreamResult = {}; await collect(result); expect(result.usage).toEqual(expectedUsage)
  await collect(result); expect(result.usage).toBeUndefined()
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('a mutable result alias cannot change the private observed usage or its accounting', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ usage: actualUsage }, { choices: [{ delta: { content: 'partial' }, finish_reason: 'stop' }] }])))
  const result: StreamResult = {}; const iterator = streamChat([], config, undefined, result)
  await iterator.next()
  result.usage ??= { ...expectedUsage }
  Object.assign(result.usage, { inputTokens: 999, outputTokens: 999, totalTokens: 1998 })
  await iterator.next()
  expect(result.usage).toEqual(expectedUsage)
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 31, outputTokens: 7 })
})


it.each([false, true])('original stream failure identity survives accounting, including best-effort DB failure=%s', async dbFailure => {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) {
    source = value
    value.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":31,"completion_tokens":7,"total_tokens":38}}\n\ndata: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
  } }))
  const fetch = vi.fn(async () => response); vi.stubGlobal('fetch', fetch)
  const writer = dbFailure ? vi.spyOn(db.aiUsageLog, 'add').mockRejectedValue(new Error('synthetic usage DB unavailable')) : undefined
  const result: StreamResult = {}; const iterator = streamChat([], config, undefined, result)
  await iterator.next()
  const failure = new Error('original synthetic stream failure'); source.error(failure)
  const caught: unknown = await iterator.next().catch(error => error)
  expect(caught).toBe(failure)
  expect(result).toMatchObject({ usage: expectedUsage, completion: 'failed' })
  if (dbFailure) { expect(writer).toHaveBeenCalledTimes(1); expect(await db.aiUsageLog.count()).toBe(0) }
  else await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('actual hook and chapter node retain observed usage on their interrupted handoff', async () => {
  let reads = 0
  const response = new Response(new ReadableStream<Uint8Array>({ pull(source) {
    if (++reads === 1) source.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":31,"completion_tokens":7,"total_tokens":38}}\n\ndata: {"choices":[{"delta":{"content":"真实调用链的合成片段"}}]}\n\n'))
    else source.error(new Error('synthetic chapter reader failure'))
  } }))
  const fetch = vi.fn(async () => response); vi.stubGlobal('fetch', fetch)
  const streamResult: StreamResult = {}
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let current!: ReturnType<typeof useAIStream>
  function View() { current = useAIStream(); return null }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(View)))
  let failure: unknown
  try {
    const node = createChapterGenerationNode({ operation: 'generate', category: 'chapter.content', projectId: 17,
      chapterIdentity: 31, ai: current, streamResult })
    await act(async () => {
      try { await runGenerationNode(node, prepareGenerationNode(node, [{ role: 'user', content: '合成正文请求' }])) }
      catch (error) { failure = error }
    })
    // Prove the provider was actually invoked and the fixed transport retained
    // real metering before testing the downstream handoff, never a fake result.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(streamResult).toMatchObject({ usage: expectedUsage, completion: 'failed' })
    expect(failure).toBeInstanceOf(InterruptedChapterGenerationErrorV1)
    expect(failure).toMatchObject({ output: '真实调用链的合成片段', completion: 'failed' })
  } finally { await act(async () => root.unmount()); host.remove() }
})

async function editorFixture(name = '142真实正文用量') {
  const f = await seedCurrentWorkspace(name, { genres: ['realism'] })
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '收店', summary: '店主收好工具后关灯。',
    order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId, title: '收店', content: '<p></p>', wordCount: 0, status: 'draft', order: 0,
    notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', {
    projectId: f.scope.projectId, outlineNodeId, scenes: [{ sceneId: 'closing', title: '收店', summary: '店主收好工具后关灯。',
      characterIds: [], conflict: '', location: '小店', pace: 'slow', estimatedWords: 500, notes: '' }], createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  return { ...f, outlineNodeId, chapterId }
}

async function beginAttempt(f: Awaited<ReturnType<typeof editorFixture>>) {
  const assembled = await prepareProseGatewayAssemblyV1({ projectId: f.scope.projectId, scope: f.scope,
    chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, operation: 'generate',
    authorRequest: '写收店章', config })
  const messages = [{ role: 'user' as const, content: assembled.text }]
  const initial = await createProseGenerationDurableRunV1({ scope: f.scope, worldGroupId: null,
    chapterId: f.chapterId, operation: 'generate' })
  return beginProseGenerationGatewayStepV1({ scope: f.scope, snapshot: initial, worldGroupId: null,
    chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, assembled, messages,
    binding: { operation: 'generate', sourceTextHash: await hashChapterText('<p></p>'),
      promptHash: await hashCanonicalValue(messages), informationBoundaryHash: 'a'.repeat(64) }, budgetReservationTokens: 1000 })
}

it.each(['complete', 'interrupted', 'cancelled', 'no-usage'] as const)('actual ChapterEditor %s retains metering evidence with the original run/step/attempt', async terminal => {
  const completed = terminal === 'complete' || terminal === 'no-usage'
  const hasUsage = terminal !== 'no-usage'
  const originalBody = '<p></p>'
  const f = await editorFixture()
  const { outlineNodeId, chapterId } = f
  await useOutlineStore.getState().loadAll(f.project.id!)
  await useChapterStore.getState().loadAll(f.project.id!)
  useChapterStore.getState().selectChapter(chapterId)
  const output = '店主把工具逐件收进铁盒，检查门窗，最后熄灭了门边的灯。'
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (terminal === 'cancelled') return new Response(new ReadableStream<Uint8Array>({ start(source) {
      source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ usage: actualUsage, choices: [{ delta: { content: output } }] })}\n\n`))
      init?.signal?.addEventListener('abort', () => source.error(new DOMException('synthetic author stop', 'AbortError')), { once: true })
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
    return reply([...(hasUsage ? [{ usage: actualUsage }] : []), { choices: [{ delta: { content: output },
      ...(completed ? { finish_reason: 'stop' } : {}) }] }], completed)
  })
  vi.stubGlobal('fetch', fetch)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const button = (text: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text)
  const settle = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      let done = false
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); done = await condition() })
      if (done) return
    }
    throw new Error(`actual editor did not settle: ${host.textContent?.slice(-800)}`)
  }
  let runId = 0
  let stopped = false
  try {
    await act(async () => root.render(createElement(MemoryRouter, null,
      createElement(ToastProvider, null, createElement(DialogProvider, null,
        createElement(ChapterEditor, { project: f.project, outlineNodeId }))))))
    await settle(() => Boolean(button('✨ 生成正文')))
    await act(async () => button('✨ 生成正文')!.click())
    await settle(() => Boolean(button('开始生成')))
    await act(async () => button('开始生成')!.click())
    await settle(async () => {
      if (terminal === 'cancelled' && !stopped && host.textContent?.includes(output) && button('停止')) {
        stopped = true; button('停止')!.click()
      }
      if (button('发送本次版本')) await act(async () => button('发送本次版本')!.click())
      const runs = await db.agentRuns.where('workId').equals(f.scope.workId).toArray()
      const row = runs.find(value => {
        const contract = JSON.parse(value.contractJson)
        return contract.executionBindings?.some((binding: { stepId: string }) => binding.stepId === 'prose-generation')
      })
      if (!row?.id) return false
      runId = row.id
      const snapshot = await readAgentRunV1(f.scope, runId)
      return ['awaiting_confirmation', 'failed'].includes(snapshot.projection.steps['prose-generation']?.status ?? '')
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect.poll(() => db.aiUsageLog.count()).toBe(hasUsage ? 1 : 0)
    if (hasUsage) expect((await db.aiUsageLog.toArray())[0]).toMatchObject({ inputTokens: 31, outputTokens: 7 })
  } finally { await act(async () => root.unmount()); host.remove() }
  // Read from the persisted run after a database reopen, not from React state.
  db.close(); await db.open()
  const snapshot = await readAgentRunV1(f.scope, runId)
  const event = [...snapshot.events].reverse().find(value => value.type === 'evidence.artifact.recorded'
    && value.payload.stepId === 'prose-generation' && value.payload.artifactKind === 'raw-response')
  if (!event || event.type !== 'evidence.artifact.recorded') throw new Error('actual ChapterEditor raw response evidence missing')
  expect(event.payload.attempt).toBe(1)
  const raw = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
    artifactKind: 'raw-response', contentHash: event.payload.contentHash }))
  const containsUsage = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    const row = value as Record<string, unknown>
    return row.inputTokens === 31 && row.outputTokens === 7 && row.totalTokens === 38
      || Object.values(row).some(containsUsage)
  }
  const evidence = await Promise.all(snapshot.events.filter(value => value.type === 'evidence.artifact.recorded'
    && value.payload.stepId === 'prose-generation' && value.payload.attempt === 1).map(async value => {
    if (value.type !== 'evidence.artifact.recorded') return null
    const text = await readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
      artifactKind: value.payload.artifactKind, contentHash: value.payload.contentHash })
    try { return JSON.parse(text) as unknown } catch { return text }
  }))
  const settled = snapshot.events.find(value => value.type === 'budget.settled' && value.payload.stepId === 'prose-generation')
  console.info('142 actual editor receipt', { terminal, stepStatus: snapshot.projection.steps['prose-generation']?.status,
    rawVersion: raw.version, observedInOriginalAttempt: evidence.some(containsUsage),
    budgetTokens: settled?.type === 'budget.settled' ? settled.payload.tokens : null })
  expect(raw.text ?? raw.outputText).toBe(output)
  expect(snapshot.projection.steps['prose-generation']?.status).toBe(completed ? 'awaiting_confirmation' : 'failed')
  expect(evidence.some(containsUsage), 'provider usage must be retained in exact evidence of this run/step/attempt').toBe(hasUsage)
  expect(raw.observedUsage).toEqual(hasUsage ? expectedUsage : null)
  expect(raw.usageBasis).toBe(hasUsage ? 'provider-observed' : 'unknown')
  expect(raw.budgetTokenBasis).toBe(completed ? hasUsage ? 'provider-observed' : 'estimated' : 'reserved')
  if (completed && hasUsage) expect(settled?.type === 'budget.settled' ? settled.payload.tokens : null).toBe(38)
  if (!completed) { expect(raw.completion).toBe(terminal === 'cancelled' ? 'cancelled' : 'unknown'); expect(settled).toBeUndefined() }
  expect((await db.chapters.get(chapterId))?.content).toBe(originalBody)
  useAIGenerationSessionStore.setState({ sessions: {} })
  const recoveredHost = document.createElement('div'); document.body.append(recoveredHost)
  const recoveredRoot = createRoot(recoveredHost)
  try {
    await act(async () => recoveredRoot.render(createElement(MemoryRouter, null,
      createElement(ToastProvider, null, createElement(DialogProvider, null,
        createElement(ChapterEditor, { project: f.project, outlineNodeId }))))))
    await settle(() => recoveredHost.textContent?.includes(output) === true)
    const tokenMeter = recoveredHost.querySelector('[title="输入 31 + 输出 7"]')
    if (hasUsage) expect(tokenMeter, 'restored author UI must display the verified provider observation').not.toBeNull()
    else expect(tokenMeter).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally { await act(async () => recoveredRoot.unmount()); recoveredHost.remove() }
}, 15_000)

it('duplicate evidence in one attempt is idempotent while a second real request with equal counts keeps its own receipt', async () => {
  const f = await editorFixture()
  const fetch = vi.fn(async () => reply([{ usage: actualUsage }, { choices: [{ delta: { content: '同一合成片段。' } }] }], false))
  vi.stubGlobal('fetch', fetch)
  const hashes: string[] = []
  const runIds: number[] = []
  for (let index = 0; index < 2; index++) {
    const begun = await beginAttempt(f)
    const result: StreamResult = {}
    const outputText = await collect(result)
    expect(result).toMatchObject({ usage: expectedUsage, completion: 'unknown' })
    const response = { version: 'prose-interrupted-response-v1' as const, outputText,
      completion: 'unknown' as const, message: '未确认完成。', observedUsage: result.usage }
    const recorded = await recordInterruptedProseGenerationV1({ scope: f.scope, snapshot: begun.snapshot, response })
    // A key-order difference cannot turn a duplicate observation into another
    // event, request or charge. The existing exact artifact identity governs it.
    const duplicate = await recordInterruptedProseGenerationV1({ scope: f.scope, snapshot: recorded,
      response: { observedUsage: { totalTokens: 38, outputTokens: 7, inputTokens: 31 },
        message: response.message, completion: response.completion, outputText, version: response.version } })
    expect(duplicate.projection.lastSequence).toBe(recorded.projection.lastSequence)
    const failed = await failProseGenerationStepV1({ scope: f.scope, snapshot: duplicate, code: 'stream-unconfirmed', retryable: false })
    const artifacts = failed.events.filter(event => event.type === 'evidence.artifact.recorded'
      && event.payload.stepId === 'prose-generation' && event.payload.attempt === 1 && event.payload.artifactKind === 'raw-response')
    expect(artifacts).toHaveLength(1)
    const event = artifacts[0]
    if (event.type !== 'evidence.artifact.recorded') throw new Error('missing original-attempt artifact')
    hashes.push(event.payload.contentHash); runIds.push(failed.run.id)
    expect(await readProseGenerationObservedUsageV1({ scope: f.scope, runId: failed.run.id, attempt: 1 })).toEqual(expectedUsage)
    expect(await readProseGenerationObservedUsageV1({ scope: f.scope, runId: failed.run.id, attempt: 2 })).toBeNull()
    expect(failed.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(failed.events.filter(event => event.type === 'budget.reserved')).toHaveLength(1)
    expect(failed.events.some(event => event.type === 'budget.settled')).toBe(false)
  }
  expect(runIds[0]).not.toBe(runIds[1])
  expect(hashes[0]).toBe(hashes[1])
  expect(await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId, 'raw-response', hashes[0]]).count()).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(2)
  await expect.poll(() => db.aiUsageLog.count()).toBe(2)
  expect((await db.aiUsageLog.toArray()).map(row => [row.inputTokens, row.outputTokens])).toEqual([[31, 7], [31, 7]])
})

it('historical fragments stay unmetered across reopen without borrowing global usage, rewriting their hash or appending events', async () => {
  const f = await editorFixture()
  const begun = await beginAttempt(f)
  const response = { version: 'prose-interrupted-response-v1' as const, outputText: '旧版原片段。', completion: 'cancelled' as const, message: '作者停止。' }
  const recorded = await recordInterruptedProseGenerationV1({ scope: f.scope, snapshot: begun.snapshot, response })
  const failed = await failProseGenerationStepV1({ scope: f.scope, snapshot: recorded, code: 'cancelled', retryable: false })
  const contentHash = await sha256Text(JSON.stringify(response))
  const event = failed.events.find(value => value.type === 'evidence.artifact.recorded'
    && value.payload.artifactKind === 'raw-response' && value.payload.contentHash === contentHash)
  expect(event).toBeDefined()
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ usage: actualUsage }])))
  await collect({})
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  const before = await db.agentRunEvents.where('runId').equals(failed.run.id).toArray()
  const beforeArtifacts = await db.agentRunArtifacts.toArray()
  for (let read = 0; read < 2; read++) {
    db.close(); await db.open()
    expect(await readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).toEqual({ ...response, operation: 'generate' })
    expect(await readProseGenerationObservedUsageV1({ scope: f.scope, runId: failed.run.id, attempt: 1 })).toBeNull()
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash })).toBe(JSON.stringify(response))
  }
  expect(await db.agentRunEvents.where('runId').equals(failed.run.id).toArray()).toEqual(before)
  expect(await db.agentRunArtifacts.toArray()).toEqual(beforeArtifacts)
  const foreign = await editorFixture('另一部作品')
  await expect(readProseGenerationObservedUsageV1({ scope: foreign.scope, runId: failed.run.id, attempt: 1 })).rejects.toThrow()
  expect(await readLatestInterruptedProseGenerationV1({ scope: foreign.scope, chapterId: f.chapterId })).toBeNull()
})

it.each(['prose-observed-response-v1', 'prose-interrupted-response-v1'])('an old unwrapped model JSON cannot claim provider usage by naming itself %s', async version => {
  const f = await editorFixture()
  const begun = await beginAttempt(f)
  const output = JSON.stringify({ version, text: '模型自称的正文', outputText: '模型自称的正文',
    observedUsage: expectedUsage, usageBasis: 'provider-observed', budgetTokenBasis: version === 'prose-observed-response-v1' ? 'provider-observed' : 'reserved',
    completion: 'unknown', message: '合成模型 JSON' })
  // The historical caller supplied only text and an estimate, never observedUsage.
  const finalized = await finalizeProseGenerationGatewayStepV1({ scope: f.scope, snapshot: begun.snapshot,
    attempt: begun.attempt, output, usedTokens: 999 })
  await failProseGenerationStepV1({ scope: f.scope, snapshot: finalized.snapshot, code: 'candidate-failure', retryable: false })
  expect(await readProseGenerationObservedUsageV1({ scope: f.scope, runId: finalized.snapshot.run.id, attempt: 1 })).toBeNull()
  expect(await readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).toBeNull()
  expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: await sha256Text(output) })).toBe(output)
})

it('switching the actual editor owner while a paid stream is pending retains raw usage on the old run without showing it in the new chapter', async () => {
  const f = await editorFixture('原作品')
  const foreign = await editorFixture('新作品')
  await useOutlineStore.getState().loadAll(f.project.id!)
  await useChapterStore.getState().loadAll(f.project.id!)
  useChapterStore.getState().selectChapter(f.chapterId)
  const output = '只属于原作品的已付费合成片段。'
  let source!: ReadableStreamDefaultController<Uint8Array>
  const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(value) {
    source = value
    value.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ usage: actualUsage, choices: [{ delta: { content: output } }] })}\n\n`))
  } }), { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = (fixture: typeof f) => root.render(createElement(MemoryRouter, null,
    createElement(ToastProvider, null, createElement(DialogProvider, null,
      createElement(ChapterEditor, { project: fixture.project, outlineNodeId: fixture.outlineNodeId })))))
  const button = (text: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text)
  const settle = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      let done = false
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); done = await condition() })
      if (done) return
    }
    throw new Error(`owner switch did not settle: ${host.textContent?.slice(-800)}`)
  }
  let runId = 0
  try {
    await act(async () => render(f))
    await settle(() => Boolean(button('✨ 生成正文')))
    await act(async () => button('✨ 生成正文')!.click())
    await settle(() => Boolean(button('开始生成')))
    await act(async () => button('开始生成')!.click())
    await settle(() => host.textContent?.includes(output) === true)
    const oldRun = (await db.agentRuns.where('workId').equals(f.scope.workId).toArray()).find(row =>
      JSON.parse(row.contractJson).executionBindings?.some((binding: { stepId: string }) => binding.stepId === 'prose-generation'))
    runId = oldRun!.id!
    await act(async () => {
      await useOutlineStore.getState().loadAll(foreign.project.id!)
      await useChapterStore.getState().loadAll(foreign.project.id!)
      useChapterStore.getState().selectChapter(foreign.chapterId)
      render(foreign)
    })
    await settle(() => !host.textContent?.includes(output))
    await act(async () => source.close())
    await settle(async () => (await readAgentRunV1(f.scope, runId)).projection.steps['prose-generation']?.status === 'failed')
    expect(host.textContent).not.toContain(output)
    expect(host.querySelector('[title="输入 31 + 输出 7"]')).toBeNull()
    expect((await db.chapters.get(foreign.chapterId))?.content).toBe('<p></p>')
    expect((await db.chapters.get(f.chapterId))?.content).toBe('<p></p>')
    expect(await db.agentRuns.where('workId').equals(foreign.scope.workId).count()).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()); host.remove() }
  db.close(); await db.open()
  expect(await readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).toMatchObject({
    outputText: output, observedUsage: expectedUsage, usageBasis: 'provider-observed', budgetTokenBasis: 'reserved', completion: 'unknown' })
  expect(await readProseGenerationObservedUsageV1({ scope: f.scope, runId, attempt: 1 })).toEqual(expectedUsage)
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
}, 15_000)
