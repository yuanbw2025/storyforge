import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

// Isolated Playwright profile, synthetic HTTP only, never an opt-in live model.
const sourceText = ' \r\n响盐矿会记录一次敲击声。😀\r\n' + '完整设定与反例。'.repeat(3000) + '末尾限制：不可预知未来。\n '
const entry = { name: '响盐矿', icon: '🪨', summary: '记录一次敲击声', description: '不可预知未来。', fields: {},
  tags: [], importance: 2, evidenceQuotes: ['响盐矿会记录一次敲击声。'], provenance: 'verbatim-extraction' }
interface SyntheticHTTPControls {
  beforeReply?: (body: string) => Promise<void>
  entryFor?: (body: string) => typeof entry
}
async function installSyntheticHTTP(page: Page, posts: string[], unknown = false, controls: SyntheticHTTPControls = {}) {
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname === 'b01-e2e.invalid' && request.method() === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = request.postData() ?? ''
      posts.push(body)
      await controls.beforeReply?.(body)
      if (unknown) return route.abort('failed')
      return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify([controls.entryFor?.(body) ?? entry]), reasoning_content: 'HIDDEN' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 30 } } })
    }
    if (['localhost','127.0.0.1'].includes(url.hostname) || !['http:','https:'].includes(url.protocol)) return route.continue()
    return route.abort()
  })
}
async function openResourceExtractor(page: Page, category?: string) {
  await openLongformLeaf(page, '自然环境')
  await page.getByRole('button').filter({ hasText: /自然资源$/ }).last().click()
  if (category) await page.getByText(category, { exact: true }).last().click()
  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
  if (category) await expect(page.getByRole('heading', { name: `AI 原文提取「${category}」`, exact: true })).toBeVisible()
}
async function setup(page: Page, unknown = false, controls: SyntheticHTTPControls = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    // This isolated profile explicitly persists only its synthetic credential.
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'custom', model: 'b01-e2e-synthetic',
      apiKey: 'synthetic-b01-e2e', baseUrl: 'https://b01-e2e.invalid/v1', temperature: 0, maxTokens: 4000 }))
  })
  const posts: string[] = []
  await installSyntheticHTTP(page, posts, unknown, controls)
  await createLongform(page, 'B01 complete-source synthetic UI')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  expect(new URL(page.url()).searchParams.has('codexExtractionV2')).toBe(false)
  await openResourceExtractor(page)
  const sourceInput = page.getByPlaceholder('粘贴或编辑要拆分的整段设定内容', { exact: true })
  await sourceInput.fill(sourceText)
  // HTML textarea value normalizes CRLF before React receives author input.
  // Freeze this actual boundary value; all other whitespace and full tail stay.
  const admittedText = await sourceInput.inputValue()
  expect(admittedText).toBe(sourceText.replace(/\r\n/g, '\n'))
  return { projectId, posts, admittedText }
}
/** Native readonly IndexedDB inspection works for both cold production bundles
 * and the dev server; it never imports a service or writes author data. */
async function ownedRows(page: Page, table: 'codexEntries' | 'agentRuns', projectId: number): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(({ table, projectId }) => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const request = indexedDB.open('storyforge-core')
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Authoring database has not been initialized')) }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(table, 'readonly')
      const rows = transaction.objectStore(table).index('projectId').getAll(IDBKeyRange.only(projectId))
      rows.onsuccess = () => resolve(rows.result as Array<Record<string, unknown>>)
      rows.onerror = () => reject(rows.error)
      transaction.oncomplete = () => db.close()
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  }), { table, projectId })
}
async function formalRows(page: Page, projectId: number) {
  return ownedRows(page, 'codexEntries', projectId)
}
async function reopenWithoutNewStartFlag(page: Page) {
  const url = new URL(page.url()); url.searchParams.delete('codexExtractionV2'); await page.goto(url.toString())
  await openLongformLeaf(page, '自然环境')
  await page.getByRole('button').filter({ hasText: /自然资源$/ }).last().click()
  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
}

test('B01 C03/C17/C19: full source → actual wire → pending → author draft → refresh with start off → explicit adopt', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { projectId, posts, admittedText } = await setup(page)
  await page.getByRole('button', { name: '开始拆分', exact: true }).click()
  await expect(page.locator('[aria-label="候选1名称"]')).toHaveValue('响盐矿')
  expect(posts).toHaveLength(1)
  const body = JSON.parse(posts[0])
  expect(body.messages.some((row: { content: string }) => row.content.includes(admittedText))).toBe(true)
  expect(body.messages.filter((row: { role: string }) => row.role === 'system')).toHaveLength(1)
  expect(body.messages[0].role).toBe('system')
  expect(body.messages[0].content).toContain('name/icon/summary/description/fields/tags/importance/provenance')
  expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('capacityPolicy')
  expect(await formalRows(page, projectId)).toEqual([])
  await page.getByText('编辑作者稿', { exact: true }).click()
  await page.getByRole('textbox', { name: '候选1名称', exact: true }).fill('作者命名的响盐矿')
  await page.getByRole('textbox', { name: '候选1描述', exact: true }).fill('作者修订：只保留一次声音，不得预知未来。')
  await page.getByRole('button', { name: '保存作者稿', exact: true }).click()
  await expect(page.getByText('作者稿尚未保存', { exact: false })).toHaveCount(0)
  await reopenWithoutNewStartFlag(page)
  await expect(page.locator('[aria-label="候选1名称"]')).toHaveValue('作者命名的响盐矿')
  await expect(page.getByPlaceholder('粘贴或编辑要拆分的整段设定内容', { exact: true })).toHaveValue(admittedText)
  expect(await formalRows(page, projectId)).toEqual([])
  await page.getByRole('button', { name: '写入所选 1 项', exact: true }).click()
  await expect.poll(async () => (await formalRows(page, projectId)).length).toBe(1)
  expect((await formalRows(page, projectId))[0]).toMatchObject({ name: '作者命名的响盐矿', origin: 'manual',
    description: '作者修订：只保留一次声音，不得预知未来。' })
  expect(posts).toHaveLength(1); expect(errors).toEqual([])
})

test('B01 C13/C15/C19: unknown HTTP preserves original input and never offers a resend as recovery', async ({ page }) => {
  const { projectId, posts, admittedText } = await setup(page, true)
  await page.getByRole('button', { name: '开始拆分', exact: true }).click()
  await expect(page.getByText('先核对已存原答和原请求；未知结果不会重新发送。', { exact: false })).toBeVisible()
  expect(posts).toHaveLength(1)
  await reopenWithoutNewStartFlag(page)
  await expect(page.getByPlaceholder('粘贴或编辑要拆分的整段设定内容', { exact: true })).toHaveValue(admittedText)
  await expect(page.getByRole('button', { name: '核对原请求并继续', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始拆分', exact: true })).toBeDisabled()
  expect(posts).toHaveLength(1); expect(await formalRows(page, projectId)).toEqual([])
})


test('B01 native two-page same-target admission and explicit abandonment while the first POST hangs', async ({ page, context }) => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  let replies = 0
  const controls: SyntheticHTTPControls = { beforeReply: () => ++replies === 1 ? barrier : Promise.resolve() }
  const { projectId, posts, admittedText } = await setup(page, false, controls)
  const other = await context.newPage()
  try {
    await installSyntheticHTTP(other, posts, false, controls)
    await other.goto(page.url())
    await openResourceExtractor(other)
    const otherSource = admittedText + '\n第二页尚未提交的补充输入。'
    const otherInput = other.getByPlaceholder('粘贴或编辑要拆分的整段设定内容', { exact: true })
    await otherInput.fill(otherSource)
    const otherAdmittedText = await otherInput.inputValue()
    expect(otherAdmittedText).toBe(otherSource)
    await expect(other.getByRole('button', { name: '开始拆分', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '开始拆分', exact: true }).click()
    await expect.poll(() => posts.length).toBe(1)
    await expect.poll(() => page.evaluate(async () => ((await navigator.locks.query()).held ?? [])
      .filter(lock => lock.name?.startsWith('storyforge:codex-extraction-start-v2:storyforge-core:')).length)).toBe(0)
    await other.getByRole('button', { name: '开始拆分', exact: true }).click()
    await expect(other.getByText('原提取运行尚未处理完毕或证据待核验；本页输入与原件已保留，不重新发送。', { exact: true })).toBeVisible()
    await expect(otherInput).toHaveValue(otherAdmittedText)
    expect(posts).toHaveLength(1)
    expect(await ownedRows(page, 'agentRuns', projectId)).toHaveLength(1)
    expect(await formalRows(page, projectId)).toEqual([])
    // Reopening reads the paid Run; the author explicitly ends it before
    // starting another request while page A's physical POST is still hanging.
    const oldRunId = (await ownedRows(page, 'agentRuns', projectId))[0].id
    await other.reload()
    await openResourceExtractor(other)
    await other.getByRole('button', { name: '放弃旧运行', exact: true }).click()
    await expect(other.getByRole('button', { name: '开始拆分', exact: true })).toBeEnabled()
    await otherInput.fill(otherAdmittedText)
    await other.getByRole('button', { name: '开始拆分', exact: true }).click()
    await expect(other.locator('[aria-label="候选1名称"]')).toHaveValue('响盐矿')
    expect(posts).toHaveLength(2)
    expect((await ownedRows(other, 'agentRuns', projectId)).find(row => row.id === oldRunId)?.status).toBe('cancelled')
    expect(await formalRows(other, projectId)).toEqual([])
    release()
    await expect(page.getByRole('button', { name: '停止生成并保留已存稿', exact: true })).toHaveCount(0)
    expect(posts).toHaveLength(2)
    expect(await ownedRows(other, 'agentRuns', projectId)).toHaveLength(2)
    expect(await formalRows(other, projectId)).toEqual([])
  } finally { release(); await other.close() }
})

test('B01 native two-page distinct legitimate targets can hold independent admissions and perform two POSTs', async ({ page, context }) => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const herbSource = '月栖花生于湿地。'
  const controls: SyntheticHTTPControls = { beforeReply: () => barrier, entryFor: body => body.includes(herbSource)
    ? { ...entry, name: '月栖花', icon: '🌿', summary: '生于湿地', description: '生于湿地。', evidenceQuotes: [herbSource] } : entry }
  const { projectId, posts } = await setup(page, false, controls)
  const other = await context.newPage()
  try {
    await installSyntheticHTTP(other, posts, false, controls)
    await other.goto(page.url())
    await openResourceExtractor(other, '灵植草药')
    await other.getByPlaceholder('粘贴或编辑要拆分的整段设定内容', { exact: true }).fill(herbSource)
    await page.getByRole('button', { name: '开始拆分', exact: true }).click()
    await expect.poll(() => posts.length).toBe(1)
    await other.getByRole('button', { name: '开始拆分', exact: true }).click()
    await expect.poll(() => posts.length).toBe(2)
    await expect.poll(() => page.evaluate(async () => ((await navigator.locks.query()).held ?? [])
      .filter(lock => lock.name?.startsWith('storyforge:codex-extraction-start-v2:storyforge-core:')).length)).toBe(0)
    expect(await ownedRows(page, 'agentRuns', projectId)).toHaveLength(2)
    expect(await formalRows(page, projectId)).toEqual([])
    release()
    await expect(page.locator('[aria-label="候选1名称"]')).toHaveValue('响盐矿')
    await expect(other.locator('[aria-label="候选1名称"]')).toHaveValue('月栖花')
    expect(posts).toHaveLength(2)
    expect(await ownedRows(other, 'agentRuns', projectId)).toHaveLength(2)
  } finally { release(); await other.close() }
})
