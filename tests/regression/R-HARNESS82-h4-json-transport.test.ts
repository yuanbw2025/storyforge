import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, estimateChatRequestOptionsTokens } from '../../src/lib/ai/client'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

const CONFIG: AIConfig = {
  provider: 'agnes',
  apiKey: 'test-only',
  baseUrl: 'https://example.invalid/v1',
  model: 'agnes-2.5-flash',
  temperature: 0,
  maxTokens: 4_000,
}

const ORIGINAL_STATE = {
  config: structuredClone(useAIConfigStore.getState().config),
  presets: structuredClone(useAIConfigStore.getState().presets),
  taskRoutes: structuredClone(useAIConfigStore.getState().taskRoutes),
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAIConfigStore.setState(ORIGINAL_STATE)
})

describe('R-HARNESS82 · H4 JSON transport', () => {
  it('binds judge v3 transport to OpenAI-compatible JSON object mode without adding tool schemas', async () => {
    useAIConfigStore.setState({ config: CONFIG, presets: [], taskRoutes: {} })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"schemaVersion":1,"issues":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(chat(
      [{ role: 'user', content: '返回 JSON' }],
      CONFIG,
      { category: 'eval.h4.verifier', contextOverflowPolicy: 'reject' },
      undefined,
      undefined,
      { responseFormat: 'json_object' },
    )).resolves.toBe('{"schemaVersion":1,"issues":[]}')

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
    expect(estimateChatRequestOptionsTokens({ responseFormat: 'json_object' })).toBeGreaterThan(0)
  })
})
