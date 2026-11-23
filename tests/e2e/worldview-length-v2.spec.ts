import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

// All tests own a fresh Playwright profile. No author data or saved connections.
// Live acceptance must never record credentials or requests in trace/video.
if (process.env.STORYFORGE_B02_LIVE === '1') test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const source = '潮汐城每年只在春汛开启盐门，守门人不得用记忆换取通行。'.repeat(800) + '尾部唯一约束：盐门不能预知未来。'
const count = (text: string) => text.replace(/\s/g, '').length
async function rows(page: Page, table: string) {
  return page.evaluate(table => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const request = indexedDB.open('storyforge-core')
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Expected initialized isolated storage')) }
    request.onerror = () => reject(new Error('Cannot read isolated storage'))
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(table, 'readonly'), read = tx.objectStore(table).getAll()
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => reject(new Error('Cannot read isolated rows'))
      tx.oncomplete = () => db.close()
      tx.onabort = () => { db.close(); reject(new Error('Isolated read aborted')) }
    }
  }), table)
}
const reviewFor = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: '待确认 · 世界来源', exact: true }) }).last()
async function openOrigin(page: Page) {
  await openLongformLeaf(page, '世界起源')
  await page.getByRole('button', { name: '世界来源', exact: true }).click()
}
async function setup(page: Page, answers: Array<string | null>) {
  const posts: Array<Record<string, unknown>> = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'b02-isolated')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'custom', apiKey: 'b02-synthetic',
      baseUrl: 'https://b02-e2e.invalid/v1', model: 'b02-e2e-synthetic', temperature: 0, maxTokens: 2000 }))
  })
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname === 'b02-e2e.invalid') {
      if (req.method() !== 'POST') return route.fulfill({ json: { models: [] } })
      posts.push(req.postDataJSON())
      const value = answers[posts.length - 1]
      if (value === undefined) throw new Error('Unexpected additional B02 model POST')
      if (value === null) return route.abort('failed')
      return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ field: 'worldOrigin', value }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: count(value) } } })
    }
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return route.continue()
    return route.abort()
  })
  await createLongform(page, 'B02 隔离篇幅验收')
  await openOrigin(page)
  await page.getByRole('button', { name: '重写', exact: true }).click()
  await page.getByPlaceholder('给 AI 的补充说明（可选）', { exact: true }).filter({ visible: true }).fill(source)
  await page.getByRole('combobox', { name: '篇幅安排', exact: true }).selectOption('exact')
  await page.getByRole('spinbutton', { name: '目标字数', exact: true }).fill('100')
  return posts
}

test('B02 normal UI: full source → four semantic revisions → editable candidate → reload → explicit adoption', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const posts = await setup(page, [40, 60, 80, 100].map(n => '甲'.repeat(n)))
  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  const review = reviewFor(page), editor = review.getByRole('textbox', { name: '世界来源候选内容', exact: true })
  await expect(editor).toHaveValue('甲'.repeat(100), { timeout: 30_000 })
  expect(posts).toHaveLength(4)
  for (const post of posts) {
    expect(JSON.stringify(post.messages)).toContain(source)
    expect(post).not.toHaveProperty('max_tokens')
  }
  expect(await rows(page, 'worldviews')).toHaveLength(0)
  const edited = '甲'.repeat(100) + '作者补注：盐门不能预知未来。'
  await editor.fill(edited)
  await expect(review.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  await page.reload(); await openOrigin(page)
  await expect(editor).toHaveValue(edited)
  await review.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect.poll(async () => (await rows(page, 'agentRuns'))[0]?.status).toBe('completed')
  expect((await rows(page, 'worldviews'))[0]?.worldOrigin).toBe(edited)
  expect(await rows(page, 'chapters')).toHaveLength(0)
  expect(await rows(page, 'agentRuns')).toHaveLength(1)
  await page.reload(); await openOrigin(page)
  await expect(review).toHaveCount(0)
  expect(posts).toHaveLength(4); expect(errors).toEqual([])
})

for (const kind of ['no-progress', 'unknown'] as const) test(`B02 ${kind}: retains best draft, visible unmet state and no automatic POST after reload`, async ({ page }) => {
  const posts = await setup(page, ['甲'.repeat(40), kind === 'unknown' ? null : '甲'.repeat(30)])
  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  const review = reviewFor(page)
  await expect(review.getByRole('textbox', { name: '世界来源候选内容', exact: true })).toHaveValue('甲'.repeat(40), { timeout: 30_000 })
  await expect(review).toContainText('40 字')
  expect(posts).toHaveLength(2); expect(await rows(page, 'worldviews')).toHaveLength(0)
  const candidate = (await rows(page, 'agentEvents')).find(row => row.kind === 'candidate')!
  expect(JSON.parse(String(candidate.payload)).worldviewFieldV2.disposition).toBe('needs-attention')
  await page.reload(); await openOrigin(page)
  await expect(review.getByRole('textbox', { name: '世界来源候选内容', exact: true })).toHaveValue('甲'.repeat(40))
  expect(posts).toHaveLength(2)
  await review.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(await rows(page, 'worldviews')).toHaveLength(0)
})

test.describe('B02 opt-in official GPT acceptance', () => {
  test('actual model → counted range → saved candidate → reload → author edit → adopt', async ({ page }, info) => {
    test.skip(process.env.STORYFORGE_B02_LIVE !== '1', 'Explicit local API acceptance only')
    test.setTimeout(240_000)
    const baseUrl = process.env.STORYFORGE_DSH_OPENAI_BASE_URL, apiKey = process.env.STORYFORGE_DSH_OPENAI_API_KEY
    if (!baseUrl || !apiKey || new URL(baseUrl).hostname !== 'api.openai.com') throw new Error('Official local OpenAI profile unavailable')
    // Match this session exactly; never select the helper script’s other default model.
    const model = 'gpt-6.1-sol'
    if (!JSON.parse(process.env.STORYFORGE_DSH_OPENAI_MODELS ?? '[]').includes(model)) throw new Error('Session model not registered for official API')
    await page.addInitScript(config => {
      localStorage.setItem('storyforge_guide_completed', 'b02-live-isolated')
      // Only the fresh test profile holds this connection, never author storage.
      localStorage.setItem('storyforge-ai-api-key-remember', 'true')
      localStorage.setItem('storyforge-ai-config', JSON.stringify(config))
    }, { provider: 'openai', baseUrl, apiKey, model, temperature: 1, maxTokens: 2000 })
    let posts = 0
    page.on('request', request => { if (new URL(request.url()).hostname === 'api.openai.com' && request.method() === 'POST') posts++ })
    await createLongform(page, 'B02 官方 GPT 合成验收作品')
    await openOrigin(page)
    await page.getByRole('button', { name: '重写', exact: true }).click()
    await page.getByPlaceholder('给 AI 的补充说明（可选）', { exact: true }).filter({ visible: true }).fill('创作潮汐城的世界来源：盐门来自古代治水工程，守门人不得用记忆换取通行，盐门不能预知未来。说明发现过程、可信证据、日常影响与仍未解的疑问。遵守本次篇幅范围，不含标题。')
    await page.getByRole('combobox', { name: '篇幅安排', exact: true }).selectOption('range')
    await page.getByRole('spinbutton', { name: '最少字数', exact: true }).fill('600')
    await page.getByRole('spinbutton', { name: '最多字数', exact: true }).fill('900')
    await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
    const review = reviewFor(page), editor = review.getByRole('textbox', { name: '世界来源候选内容', exact: true })
    await expect(editor).toBeVisible({ timeout: 180_000 })
    const draft = await editor.inputValue(), words = count(draft)
    expect(words).toBeGreaterThanOrEqual(600); expect(words).toBeLessThanOrEqual(900)
    const candidate = (await rows(page, 'agentEvents')).find(row => row.kind === 'candidate')!
    const metadata = JSON.parse(String(candidate.payload)).worldviewFieldV2
    expect(metadata.disposition).toBe('ready'); expect(metadata.lengthObservation.measuredWords).toBe(words)
    expect(await rows(page, 'worldviews')).toHaveLength(0)
    const paid = posts
    await page.reload(); await openOrigin(page)
    await expect(editor).toHaveValue(draft)
    await editor.fill(draft + '\n作者核对：保留未解之谜，不赋予预知能力。')
    await expect(review.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
    await review.getByRole('button', { name: '采纳', exact: true }).click()
    await expect(review).toHaveCount(0)
    await expect.poll(async () => (await rows(page, 'agentRuns'))[0]?.status).toBe('completed')
    expect((await rows(page, 'worldviews'))[0]?.worldOrigin).toBe(draft + '\n作者核对：保留未解之谜，不赋予预知能力。')
    expect(posts).toBe(paid); expect(paid).toBeGreaterThan(0)
    await info.attach('b02-live-summary', { body: Buffer.from(JSON.stringify({ model, modelPOSTs: paid, rounds: metadata.roundRefs.length,
      measuredWords: words, range: [600, 900], disposition: metadata.disposition, restored: true, explicitAuthorAdoption: true, terminal: 'completed' })), contentType: 'application/json' })
  })
})
