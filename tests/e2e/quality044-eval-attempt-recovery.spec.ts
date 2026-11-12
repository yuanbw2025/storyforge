import { expect, test } from '@playwright/test'

test('044 H17 real settings stops at one unknown dispatch and preserves status after reload', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('044 requires an isolated loopback server')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) {
    throw new Error('044 refuses author or external origins')
  }
  const baseUrl = new URL('sfqa044-isolated/v1', base).href
  const endpoint = `${baseUrl}/chat/completions`
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  let posts = 0
  const unexpected: string[] = []
  try {
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (request.url() === endpoint && request.method() === 'POST') {
        posts++
        return route.abort('connectionreset')
      }
      if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    })
    await context.addInitScript(origin => {
      if (location.origin === origin) localStorage.setItem('storyforge_guide_completed', 'sfqa044-isolated')
    }, base.origin)
    const page = await context.newPage()
    await page.goto('./')
    await page.evaluate(async syntheticBaseUrl => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.getState().setConfig({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sfqa044-synthetic-only',
        baseUrl: syntheticBaseUrl, temperature: 0, maxTokens: 3000, contextWindow: 128_000 })
    }, baseUrl)
    await page.goto('./home/settings')
    const section = page.getByRole('heading', { name: 'H17 上下文质量对照', exact: true }).locator('xpath=ancestor::section[1]')
    await section.getByRole('button', { name: '运行', exact: true }).click()
    await expect(section.getByRole('status')).toContainText('上次评测请求结果未知')
    expect(posts).toBe(1)
    await page.reload()
    await expect(section.getByRole('status')).toContainText('上次评测请求结果未知')
    expect(posts).toBe(1)
    expect(unexpected).toEqual([])
  } finally { await context.close() }
})
