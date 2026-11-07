import { expect, test, type Request, type Route } from '@playwright/test'

const A = 'https://sfqa103-a.invalid/v1'
const B = 'https://sfqa103-b.invalid/v1'
const KEY_A = 'SFQA103_SYNTHETIC_BROWSER_A'
const KEY_B = 'SFQA103_SYNTHETIC_BROWSER_B'
const KEY_C = 'SFQA103_SYNTHETIC_BROWSER_REPLACEMENT'

interface ModelRequest { route: Route; request: Request; completed: boolean }

test('103 actual settings keeps delayed model lists with their destination and private credential', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('103 requires its isolated loopback server')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw new Error('103 refuses external or author browser origins')
  }
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const requests: ModelRequest[] = [], forbidden: string[] = []
  const cors = { 'access-control-allow-origin': origin.origin,
    'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    if (['sfqa103-a.invalid', 'sfqa103-b.invalid'].includes(url.hostname) && url.pathname === '/v1/models') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (request.method() === 'GET') {
        // Leave the real HTTP request paused until the test releases this exact response.
        requests.push({ route, request, completed: false })
        return
      }
    }
    forbidden.push(`${request.method()} ${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  await context.addInitScript(allowedOrigin => {
    if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa103-isolated-native')
  }, origin.origin)
  const page = await context.newPage()
  async function complete(index: number, models: string[], status = 200) {
    const pending = requests[index]
    if (!pending || pending.completed) throw new Error('103 requires an unsettled actual model-list request')
    const response = page.waitForResponse(row => row.request() === pending.request)
    pending.completed = true
    await pending.route.fulfill({ status, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ data: models.map(id => ({ id })) }) })
    expect(await (await response).finished()).toBeNull()
    // Flush rendering after the actual response body has completed, without a timed sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  }
  try {
    await page.goto('./home/settings')
    await page.getByRole('heading', { name: 'AI 模型配置', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    const provider = page.locator('label:has-text("提供商") + select')
    const address = page.locator('label:has-text("Base URL") + input').first()
    const key = page.locator('label:has-text("API Key") + div input').first()
    const manual = page.getByPlaceholder('手动输入模型名', { exact: true })
    const refresh = page.getByTitle('从当前服务刷新模型列表', { exact: true })
    const list = page.getByRole('combobox', { name: '服务返回的模型列表', exact: true })
    await provider.selectOption('custom')
    await address.fill(A); await key.fill(KEY_A); await manual.fill('author-manual')
    await refresh.click(); await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].request.url()).toBe(`${A}/models`)
    expect(requests[0].request.headers().authorization).toBe(`Bearer ${KEY_A}`)

    // Editing stays available while A is pending. Only B may publish B's options.
    await expect(address).toBeEditable(); await expect(key).toBeEditable(); await expect(manual).toBeEditable()
    await address.fill(B); await key.fill(KEY_B)
    await expect(refresh).toBeEnabled()
    await refresh.click(); await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].request.url()).toBe(`${B}/models`)
    expect(requests[1].request.headers().authorization).toBe(`Bearer ${KEY_B}`)
    await complete(1, ['current-B'])
    await expect(list.locator('option')).toHaveText(['选择服务返回的模型（1）', 'current-B'])
    await complete(0, ['late-A'])
    await expect(list.locator('option')).toHaveText(['选择服务返回的模型（1）', 'current-B'])
    await expect(manual).toHaveValue('author-manual')
    await list.selectOption('current-B'); await expect(manual).toHaveValue('current-B')
    await manual.fill('author-after-B')

    // The same URL with a different private key is a different result owner.
    await refresh.click(); await expect.poll(() => requests.length).toBe(3)
    await key.fill(KEY_C)
    await expect(list).toHaveCount(0); await expect(refresh).toBeEnabled()
    await refresh.click(); await expect.poll(() => requests.length).toBe(4)
    expect(requests[3].request.url()).toBe(`${B}/models`)
    expect(requests[3].request.headers().authorization).toBe(`Bearer ${KEY_C}`)
    await complete(2, [], 503)
    await expect(refresh).toBeDisabled()
    await expect(page.getByText('模型列表请求失败（HTTP 503）', { exact: true })).toHaveCount(0)
    await complete(3, ['current-key-C'])
    await expect(list.locator('option')).toHaveText(['选择服务返回的模型（1）', 'current-key-C'])
    await expect(refresh).toBeEnabled(); await expect(manual).toHaveValue('author-after-B')

    // A same-owner refresh retains the last successful choices and the author's input.
    await refresh.click(); await expect.poll(() => requests.length).toBe(5)
    await expect(list.locator('option')).toHaveText(['选择服务返回的模型（1）', 'current-key-C'])
    await manual.fill('author-during-refresh')
    await complete(4, ['fresh-current'])
    await expect(manual).toHaveValue('author-during-refresh')
    await list.selectOption('fresh-current'); await expect(manual).toHaveValue('fresh-current')
    await manual.fill('author-final-model')
    const localValues = await page.evaluate(() => Object.values(localStorage).join('\n'))
    for (const secret of [KEY_A, KEY_B, KEY_C]) expect(localValues).not.toContain(secret)
    await page.reload()
    await page.getByRole('heading', { name: 'AI 模型配置', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    await expect(manual).toHaveValue('author-final-model')
    await expect(address).toHaveValue(B); await expect(key).toHaveValue(KEY_C)
    await expect(list).toHaveCount(0); await expect(refresh).toBeEnabled()
    expect(requests).toHaveLength(5)
    expect(forbidden).toEqual([])
  } finally {
    await testInfo.attach('103-isolated-transport', { body: JSON.stringify({
      modelRequests: requests.map(row => ({ destination: row.request.url(), completed: row.completed })), forbidden,
      realProviderCalls: 0, authorBrowserUsed: false,
    }), contentType: 'application/json' })
    for (const pending of requests) if (!pending.completed) await pending.route.abort('blockedbyclient').catch(() => undefined)
    await context.close()
  }
})
