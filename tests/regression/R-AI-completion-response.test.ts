import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, type ChatResult } from '../../src/lib/ai/client'
import { AICompletionResponseErrorV1, requireCompletionTextV1 } from '../../src/lib/ai/completion-response'
import { clearLogs, formatLog, getLogs } from '../../src/lib/ai/logger'
import { classifyHarnessFailureV1 } from '../../src/lib/agent/run/harness-failure'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { AIConfig } from '../../src/lib/types'

const config: AIConfig = { provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://example.test/v1', apiKey: 'test-only-secret', temperature: 0.5, maxTokens: 6000 }
const completion = (content: unknown) => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })
const reply = (body: unknown) => vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }))

describe('HTTP 200 is not sufficient evidence of a usable model answer', () => {
  beforeEach(() => { clearLogs(); useAIConfigStore.setState({ config, taskRoutes: {} }) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('rejects an empty answer once, without turning it into a JSON repair', async () => {
    const fetch = reply(completion(''))
    vi.stubGlobal('fetch', fetch)
    let failure: unknown
    try { await chat([{ role: 'user', content: 'private-author-request' }], config) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(AICompletionResponseErrorV1)
    expect(await classifyHarnessFailureV1(failure)).toMatchObject({ failureClass: 'provider', code: 'provider_response_empty', retryable: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getLogs()[0]).toMatchObject({ type: 'chat', status: 'error', statusCode: 200 })
    expect(formatLog(getLogs()[0])).toContain('content=0 chars')
    expect(JSON.stringify(getLogs())).not.toMatch(/test-only-secret|private-author-request/)
  })

  it('does not present reasoning or a refusal as the answer', () => {
    for (const message of [{ content: null, reasoning_content: 'private-reasoning' }, { content: '', refusal: 'private-refusal' }]) {
      try { requireCompletionTextV1({ choices: [{ message, finish_reason: 'stop' }] }); expect.fail('must reject') } catch (error) {
        expect(error).toBeInstanceOf(AICompletionResponseErrorV1)
        expect((error as Error).message).not.toMatch(/private-reasoning|private-refusal/)
      }
    }
  })

  it('retains declared tool-only responses for the Agent protocol to validate', async () => {
    const calls = [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }]
    vi.stubGlobal('fetch', reply({ choices: [{ message: { content: null, tool_calls: calls }, finish_reason: 'tool_calls' }] }))
    const result: ChatResult = {}
    await expect(chat([], config, undefined, undefined, result, { tools: [{ type: 'function', function: { name: 'read', description: 'Read', parameters: {} } }] })).resolves.toBe('')
    expect(result).toMatchObject({ toolCallsPresent: true, toolCalls: calls, finishReason: 'tool_calls' })
  })

  it('the settings test rejects HTTP 200 without a usable completion', async () => {
    for (const body of [completion(''), {}, null, { error: { message: 'provider internal error' } }]) {
      vi.stubGlobal('fetch', reply(body))
      expect(await useAIConfigStore.getState().testConnection()).toMatchObject({ ok: false })
    }
  })

  it('records successful text diagnostics without retaining the answer', async () => {
    const fetch = reply(completion('private-answer'))
    vi.stubGlobal('fetch', fetch)
    await expect(chat([], config)).resolves.toBe('private-answer')
    expect(getLogs()[0]).toMatchObject({ status: 'success', statusCode: 200 })
    expect(JSON.stringify(getLogs())).not.toContain('private-answer')
    expect(await useAIConfigStore.getState().testConnection()).toMatchObject({ ok: true })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ max_tokens: 1024 })
  })

  it('reports malformed HTTP 200 JSON as a non-retryable provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    await expect(chat([], config)).rejects.toMatchObject({ problem: 'invalid-json', retryable: false })
  })
})
