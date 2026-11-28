import { test, expect } from '@playwright/test'

test('061 original history fields start empty, retain an independent candidate after refresh and adopt only author-confirmed text', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let calls = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'history061-copilot'))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (req.method() === 'POST' && url.pathname.endsWith('/synthetic-history/v1/chat/completions')) {
      calls++
      const payload = JSON.parse(req.postData()!), sent = payload.messages.map((m: { content: string }) => m.content).join('\n')
      expect(sent).toContain('不默认套地球历法');expect(sent).toContain(calls === 1 ? '历史总述' : '纪年体系')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, value: calls === 1 ? '待确认设想：先有灰潮，后有炭火纪元。' : '待确认设想：以炭火初燃为纪元起点，每年九月，每月九日。' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 800, completion_tokens: 100, total_tokens: 900 } }) })
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(req.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const f = await page.evaluate(async endpoint => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const f = await seedCurrentWorkspace('061 空白历史起草')
    useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-local-only', model: 'gpt-4.1-mini', baseUrl: endpoint, maxTokens: 0, temperature: 0.35 })
    return f.scope
  }, `${origin}/synthetic-history/v1`)
  await page.goto(`./workspace/${f.projectId}?module=history`)
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await page.getByRole('button', { name: 'AI 历史总述', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '历史 AI · 历史总述', exact: true })
  await expect(dialog.getByText('内置-历史总述起草', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: '生成候选', exact: true }).click()
  const editor = dialog.getByRole('textbox', { name: '历史字段候选', exact: true })
  await expect(editor).toHaveValue('待确认设想：先有灰潮，后有炭火纪元。')
  const draft = '作者确认前的历史稿：先有灰潮，后有炭火纪元。\n行尾保留  '
  await editor.fill(draft)
  await dialog.getByRole('button', { name: '关闭历史候选', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑：历史总述', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '历史 AI · 历史总述', exact: true })
  await expect(dialog.getByRole('textbox', { name: '历史字段候选', exact: true })).toHaveValue(draft)
  const read = () => page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.histories.where('projectId').equals(projectId).toArray()
  }, f.projectId)
  expect(await read()).toEqual([]);expect(calls).toBe(1)
  await dialog.getByRole('button', { name: '确认采用', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await read())[0]).toMatchObject({ overview: draft, eraSystem: '', events: '[]' })
  await page.getByRole('button', { name: 'AI 纪年体系', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '历史 AI · 纪年体系', exact: true })
  await dialog.getByRole('button', { name: '生成候选', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '历史字段候选', exact: true })).toHaveValue('待确认设想：以炭火初燃为纪元起点，每年九月，每月九日。')
  await dialog.getByRole('button', { name: '拒绝候选', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '历史字段候选', exact: true })).not.toBeVisible()
  expect((await read())[0]).toMatchObject({ overview: draft, eraSystem: '', events: '[]' });expect(calls).toBe(2)
})
