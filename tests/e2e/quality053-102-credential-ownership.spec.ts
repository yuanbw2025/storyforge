import { expect, test, type Page } from '@playwright/test'

const KEY_A = 'SYNTHETIC_BROWSER_PROVIDER_A_ONLY'
const KEY_B = 'SYNTHETIC_BROWSER_PROVIDER_B_ONLY'

async function readNodeSelection(page: Page, presetId: string) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { requestedAIConfig } = await load<typeof import('../../src/lib/node-authoring/executor')>('/storyforge/src/lib/node-authoring/executor.ts')
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const selected = requestedAIConfig({ id: 'synthetic-node', templateId: 'processor.free-generation', templateVersion: 1,
      title: '合成连接选择', x: 0, y: 0, config: { aiPresetId: id }, inputs: [], outputs: [] })
    return { selected, global: useAIConfigStore.getState().config }
  }, presetId)
}

for (const scenario of ['preset', 'embedding', 'partial-storage'] as const) {
  test(`053/102 actual settings and native session storage: ${scenario}`, async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('053/102 requires its isolated loopback server')
    const origin = new URL(baseURL)
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('053/102 refuses external or author origins')
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
    const forbidden: string[] = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
      else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
    })
    await context.addInitScript(expectedOrigin => {
      if (location.origin === expectedOrigin) localStorage.setItem('storyforge_guide_completed', 'e2e')
    }, origin.origin)
    const page = await context.newPage()
    try {
      await page.goto('./home/settings')
      await expect(page.getByRole('heading', { name: 'AI 模型配置', exact: true })).toBeVisible({ timeout: 20_000 })
      const presetId = await page.evaluate(async ({ keyA, keyB }) => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
        const store = useAIConfigStore.getState()
        if (localStorage.getItem('storyforge-ai-config') || localStorage.getItem('storyforge-embedding-config')) throw new Error('053/102 requires empty isolated settings')
        store.setConfig({ provider: 'custom', baseUrl: 'https://provider-a.invalid/v1', model: 'synthetic-a', apiKey: keyA })
        const id = useAIConfigStore.getState().saveAsPreset('QUALITY053 临时 A')
        useAIConfigStore.getState().setConfig({ provider: 'deepseek', baseUrl: 'https://provider-b.invalid/v1', model: 'synthetic-b', apiKey: keyB })
        useAIConfigStore.getState().setEmbeddingConfig({ enabled: true, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', apiKey: keyA })
        return id
      }, { keyA: KEY_A, keyB: KEY_B })
      const embedding = page.locator('div.bg-bg-surface').filter({ has: page.getByRole('heading', { name: /语义检索/ }) })
      const chatKey = page.locator('label:has-text("API Key") + div input').first()
      const embeddingKey = embedding.locator('label:has-text("API Key") + input')
      if (scenario === 'preset') {
        const before = await readNodeSelection(page, presetId)
        expect(before.selected).toMatchObject({ baseUrl: 'https://provider-a.invalid/v1', apiKey: KEY_A })
        expect(before.global).toMatchObject({ baseUrl: 'https://provider-b.invalid/v1', apiKey: KEY_B })
        await page.getByRole('button', { name: 'QUALITY053 临时 A', exact: true }).click()
        await expect(chatKey).toHaveValue(KEY_A)
        await page.reload()
        await expect(chatKey).toHaveValue(KEY_A)
        const after = await readNodeSelection(page, presetId)
        expect(after.selected).toMatchObject({ baseUrl: 'https://provider-a.invalid/v1', apiKey: KEY_A })
      } else if (scenario === 'embedding') {
        await expect(embeddingKey).toHaveValue(KEY_A)
        await embedding.getByRole('button', { name: /通义 · v3/ }).click()
        await expect(embeddingKey).toHaveValue('')
        await page.reload()
        await expect(embeddingKey).toHaveValue('')
        await embeddingKey.fill(KEY_B)
        await page.reload()
        await expect(embeddingKey).toHaveValue(KEY_B)
        await expect(embedding.locator('label:has-text("Base URL") + input')).toHaveValue('/qwen-proxy/compatible-mode/v1')
      } else {
        const failures = await page.evaluate(async ({ keyA, keyB }) => {
          const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
          const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
          useAIConfigStore.getState().setConfig({ provider: 'custom', baseUrl: 'https://provider-a.invalid/v1', apiKey: keyA })
          const original = Storage.prototype.setItem
          const results: string[] = []
          Storage.prototype.setItem = function (key: string, value: string) {
            if (this === sessionStorage && ['storyforge-ai-api-key-session', 'storyforge-embedding-key-session'].includes(key)) throw new DOMException('synthetic second-write failure', 'QuotaExceededError')
            return original.call(this, key, value)
          }
          try {
            for (const save of [
              () => useAIConfigStore.getState().setConfig({ provider: 'custom', baseUrl: 'https://provider-c.invalid/v1', apiKey: keyB }),
              () => useAIConfigStore.getState().setEmbeddingConfig({ provider: 'custom', baseUrl: 'https://provider-c.invalid/v1', apiKey: keyB }),
            ]) {
              try { save(); results.push('unexpected success') } catch (error) { results.push(error instanceof DOMException ? error.name : 'unexpected error') }
            }
          } finally { Storage.prototype.setItem = original }
          return results
        }, { keyA: KEY_A, keyB: KEY_B })
        expect(failures).toEqual(['QuotaExceededError', 'QuotaExceededError'])
        await page.reload()
        await expect(chatKey).toHaveValue('')
        await expect(embeddingKey).toHaveValue('')
        await expect(page.getByText(/临时 API Key 未能与当前配置匹配/)).toHaveCount(2)
        const addresses = page.locator('label:has-text("Base URL") + input')
        await expect(addresses.nth(0)).toHaveValue('https://provider-c.invalid/v1')
        await expect(addresses.nth(1)).toHaveValue('https://provider-c.invalid/v1')
      }
      expect(forbidden).toEqual([])
    } finally {
      await testInfo.attach('053-102-network-boundary', { body: JSON.stringify({ scenario, forbidden }), contentType: 'application/json' })
      await context.close()
    }
  })
}
