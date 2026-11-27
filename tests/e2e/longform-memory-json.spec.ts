import { enterChapterSummaryEditorV1 } from './helpers/markdown-source'
import { installBrowserServiceCapacityFixtureV1 } from './helpers/browser-ai-config'
import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const prose = '林舟合上账本，先问苏砚是否愿意留下。苏砚把旧灯放回窗边，答应明天再来，两人这才关门。'
const summary = '林舟先询问苏砚意愿，苏砚答应明日再来，两人关门。'
const memory = JSON.stringify({ summary, handoff: {
  finalScene: { location: '店内', storyTime: '', activeCharacters: ['林舟', '苏砚'], lastAction: '两人关门' },
  stateChanges: ['已经关门'], knowledgeChanges: [], commitments: ['明天再来'], openLoops: [],
  immediateNextIntent: '', evidenceQuotes: [{ quote: prose }],
} })

async function addChapter(page: Page, first: boolean) {
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  if (first) await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(first ? 1 : 2)
  const summary = await enterChapterSummaryEditorV1(page, first ? 0 : 1)
  await summary.fill('先询问意愿，再回应关门，不展开次日。')
  await page.getByTitle('编辑本章细纲', { exact: true }).last().click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('询问、回应、关门。')
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
  await page.getByRole('textbox', { name: '自定义指令...', exact: true }).fill(`写${prose.length}字。`)
}

async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({
    provider: 'ollama', baseUrl: 'https://memory-json.invalid/v1', model: 'memory-json-test',
    maxTokens: 4000, contextWindow: 64000, temperature: 0,
  })))
  await installBrowserServiceCapacityFixtureV1(page, { provider: 'ollama', baseUrl: 'https://memory-json.invalid/v1', model: 'memory-json-test' }, 64000)
  const requests: Array<Record<string, any>> = []
  await page.route('https://memory-json.invalid/v1/chat/completions', async route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    if (body.stream) {
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: prose }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
    } else {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: memory }, finish_reason: 'stop' }] }) })
    }
  })
  await createLongform(page, '章节记忆 JSON 真实请求验收')
  await addChapter(page, true)
  return requests
}

async function chapters(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.chapters.toArray()
  })
}

test('手动记忆使用 JSON 对象；正文完整读取修改后的前章，不隐式补建记忆', async ({ page }) => {
  const requests = await prepare(page)
  await page.locator('.tiptap-editor').fill(prose)
  await page.getByRole('button', { name: '生成章节记忆', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新章节记忆', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ stream: false, response_format: { type: 'json_object' }, model: 'memory-json-test', temperature: 0 })
  expect(requests[0]).not.toHaveProperty('max_tokens')
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('storyforge-ai-config')!)).maxTokens).toBe(4000)
  const first = (await chapters(page))[0]
  expect(first.summary).toBe(summary)
  expect(first.continuityHandoff.sourceTextHash).toBe(first.summarySourceTextHash)
  await page.reload()
  await expect(page.getByRole('button', { name: '刷新章节记忆', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)

  await page.locator('.tiptap-editor').fill(`${prose}林舟把钥匙交给苏砚。`)
  await addChapter(page, false)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(prose)
  expect(requests).toHaveLength(2)
  expect(requests[1].stream).toBe(true)
  expect(requests[1].messages.map((message: any) => message.content).join('\n')).toContain('林舟把钥匙交给苏砚。')
  const refreshed = (await chapters(page)).find((row: any) => row.id === first.id)
  expect(refreshed.summarySourceTextHash).toBe(first.summarySourceTextHash)
  expect(refreshed.continuityHandoff.sourceTextHash).toBe(first.summarySourceTextHash)
})

test('采纳后经作者授权的记忆任务使用 JSON 模式，完成后刷新不重做', async ({ page }) => {
  const requests = await prepare(page)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope }, policy] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'), importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/prose/post-adoption-policy.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    await policy.updateWorkPostAdoptionSettingsV1({ scope, settings: policy.resolveWorkPostAdoptionSettingsV1({
      postAdoptionPolicy: 'suggest', postAdoptionTaskTypes: ['memory'],
    }) })
  })
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(prose)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await page.getByRole('button', { name: '确认并开始章后任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新章节记忆', exact: true })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({ stream: false, response_format: { type: 'json_object' } })
  expect(requests[1]).not.toHaveProperty('max_tokens')
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('storyforge-ai-config')!)).maxTokens).toBe(4000)
  const stored = (await chapters(page))[0]
  expect(stored.summary).toBe(summary)
  expect(stored.continuityHandoff.sourceTextHash).toBe(stored.summarySourceTextHash)
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toHaveText(prose)
  await expect(page.getByRole('button', { name: '刷新章节记忆', exact: true })).toBeVisible()
  expect(requests).toHaveLength(2)
})
