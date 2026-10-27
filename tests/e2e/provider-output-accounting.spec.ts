import { expect, test } from '@playwright/test'

for (const config of [
  { provider: 'poe', baseUrl: 'https://api.poe.com/v1', model: 'GPT-4o' },
  { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash' },
] as const) {
  test(`隔离浏览器实际传输请求 usage 并保留输出预算：${config.provider}`, async ({ page }) => {
    // A synthetic protocol probe, not a new product AI entry. No external
    // request is allowed through and no author browser/profile data is used.
    await page.route(/^https?:\/\//, route => {
      const host = new URL(route.request().url()).hostname
      return ['127.0.0.1', 'localhost'].includes(host) ? route.fallback() : route.abort()
    })
    const requests: Record<string, unknown>[] = []
    await page.route('**/chat/completions', async route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      const chunks = ['data: {"choices":[{"delta":{"content":"合成协议回执"},"finish_reason":null}]}', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}']
      if (body.stream_options?.include_usage) chunks.push('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}')
      chunks.push('data: [DONE]')
      await route.fulfill({ contentType: 'text/event-stream', body: chunks.join('\n\n') + '\n\n' })
    })
    await page.goto('./')
    const result = await page.evaluate(async providerConfig => {
      const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { useAIConfigStore } = await imp('/storyforge/src/stores/ai-config.ts')
      const config = { ...providerConfig, apiKey: 'synthetic-only', maxTokens: 1024, temperature: 0.3 }
      useAIConfigStore.setState({ config, taskRoutes: {} })
      const { streamChat } = await imp('/storyforge/src/lib/ai/client.ts')
      const receipt: { usage?: { inputTokens: number; outputTokens: number; totalTokens: number } } = {}
      let text = ''
      for await (const chunk of streamChat([{ role: 'user', content: '合成协议请求' }], config, undefined, receipt)) text += chunk
      return { text, usage: receipt.usage }
    }, config)
    expect(result).toEqual({ text: '合成协议回执', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ model: config.model, max_tokens: 1024, stream_options: { include_usage: true } })
  })
}
