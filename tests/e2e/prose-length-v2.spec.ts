import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
if (process.env.STORYFORGE_B03_LIVE === '1') test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function readRows(page: Page, table: string) {
  return page.evaluate(table => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const request = indexedDB.open('storyforge-core')
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Expected initialized isolated database')) }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, tx = db.transaction(table, 'readonly'), read = tx.objectStore(table).getAll()
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close() }
  }), table)
}
async function setup(page: Page, answers: Array<string | null>, live?: { provider: string; baseUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number }) {
  await page.addInitScript(config => {
    localStorage.setItem('storyforge_guide_completed', 'b03-isolated')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify(config))
  }, live ?? { provider: 'custom', baseUrl: 'https://b03-e2e.invalid/v1', model: 'b03-ui-synthetic', apiKey: 'b03-synthetic-only', temperature: 0, maxTokens: 12 })
  const posts: Array<Record<string, unknown>> = []
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (live && url.hostname === 'api.openai.com') {
      if (request.method() === 'POST') posts.push(request.postDataJSON())
      return route.continue()
    }
    if (url.hostname === 'b03-e2e.invalid') {
      if (request.method() !== 'POST') return route.fulfill({ json: { models: [] } })
      posts.push(request.postDataJSON())
      const answer = answers[posts.length - 1]
      if (answer === undefined) throw new Error('Unexpected extra B03 model POST')
      if (answer === null) return route.abort('failed')
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: answer.length, total_tokens: 10 + answer.length } }) + '\n\ndata: [DONE]\n\n' })
    }
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    return route.abort()
  })
  await createLongform(page, 'B03 字数闭环隔离作品')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('店主检查名单，确认后关门，不增加明日情节。')
  await page.getByTitle('编辑本章细纲', { exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('核对名单后立即停笔。')
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  // Isolate this editor test from the separately required B03b child-chain test.
  // Only the one fresh test Work is changed; no author profile/storage is used.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('storyforge-core'); request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, tx = db.transaction('works', 'readwrite'), store = tx.objectStore('works'), read = store.getAll()
      read.onsuccess = () => { if (read.result.length !== 1) { tx.abort(); return }
        store.put({ ...read.result[0], postAdoptionPolicy: 'off', updatedAt: Date.now() }) }
      tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => { db.close(); reject(new Error('Expected one isolated Work')) } }
  }))
  await page.reload()
  await page.getByRole('combobox', { name: '篇幅安排', exact: true }).selectOption('exact')
  await page.getByRole('spinbutton', { name: '目标字数', exact: true }).fill('100')
  return posts
}
async function generate(page: Page) {
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示' }).getByRole('button', { name: '开始生成', exact: true }).click()
}

test('B03 ordinary editor revises four drafts, restores author edits, and adopts without another model POST', async ({ page }) => {
  const posts = await setup(page, [40, 60, 80, 100].map(n => '甲'.repeat(n)))
  await generate(page)
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue('甲'.repeat(100), { timeout: 30_000 })
  expect(posts).toHaveLength(4)
  for (const body of posts) { expect(body.stream).toBe(true); expect(body).not.toHaveProperty('max_tokens') }
  expect((await readRows(page, 'chapters'))[0].wordCount).toBe(0)
  const edited = '甲'.repeat(100) + '作者核对后保留的补注。'
  await draft.fill(edited)
  await page.getByRole('button', { name: '保存候选修改', exact: true }).click()
  await expect(page.getByText('候选已保存，尚未采纳。', { exact: true })).toBeVisible()
  await page.reload()
  await expect(draft).toHaveValue(edited)
  expect(posts).toHaveLength(4)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect.poll(async () => (await readRows(page, 'agentRuns')).find(row => String(row.contractJson).includes('prose.generate.v2'))?.status).toBe('completed')
  expect(String((await readRows(page, 'chapters'))[0].content)).toContain(edited)
  expect(posts).toHaveLength(4)
})

test('B03 unknown initial request stays visible/read-only through reload and never becomes automatic resend', async ({ page }) => {
  const posts = await setup(page, [null])
  await generate(page)
  await expect(page.getByText('以下只读原答不是可采纳候选：', { exact: false })).toBeVisible({ timeout: 30_000 })
  expect(posts).toHaveLength(1)
  await page.reload()
  await expect(page.getByText('以下只读原答不是可采纳候选：', { exact: false })).toBeVisible()
  expect(posts).toHaveLength(1)
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect((await readRows(page, 'agentEvents')).filter(row => row.kind === 'candidate')).toHaveLength(0)
  expect((await readRows(page, 'chapters'))[0].wordCount).toBe(0)
  await page.getByRole('button', { name: '结束未完成任务并保留原答', exact: true }).click()
  await expect(page.getByText('原任务已明确结束，原答保留；现在可以明确开始新任务。', { exact: false })).toBeVisible()
  expect(posts).toHaveLength(1)
})

test('B03 official selected GPT editor acceptance', async ({ page }) => {
  test.skip(process.env.STORYFORGE_B03_LIVE !== '1', 'Explicit isolated official API acceptance only')
  test.setTimeout(240_000)
  const baseUrl = process.env.STORYFORGE_DSH_OPENAI_BASE_URL, apiKey = process.env.STORYFORGE_DSH_OPENAI_API_KEY, model = 'gpt-6.1-sol'
  if (!baseUrl || !apiKey || new URL(baseUrl).hostname !== 'api.openai.com'
    || !JSON.parse(process.env.STORYFORGE_DSH_OPENAI_MODELS ?? '[]').includes(model)) throw new Error('Official selected GPT profile unavailable')
  const posts = await setup(page, [], { provider: 'openai', baseUrl, apiKey, model, temperature: 1, maxTokens: 12 })
  await page.getByRole('combobox', { name: '篇幅安排', exact: true }).selectOption('range')
  await page.getByRole('spinbutton', { name: '最少字数', exact: true }).fill('600')
  await page.getByRole('spinbutton', { name: '最多字数', exact: true }).fill('900')
  await generate(page)
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toBeVisible({ timeout: 180_000 })
  const text = await draft.inputValue(), words = text.replace(/\s/g, '').length
  expect(words).toBeGreaterThanOrEqual(600); expect(words).toBeLessThanOrEqual(900)
  const paid = posts.length
  expect(paid).toBeGreaterThan(0)
  await page.reload(); await expect(draft).toHaveValue(text)
  expect(posts).toHaveLength(paid)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect.poll(async () => (await readRows(page, 'agentRuns')).find(row => String(row.contractJson).includes('prose.generate.v2'))?.status).toBe('completed')
  expect(posts).toHaveLength(paid)
  console.info(JSON.stringify({ acceptance: 'B03-editor', model, actualModelPOSTs: paid, measuredWords: words, range: [600, 900], restored: true, adopted: true }))
})
