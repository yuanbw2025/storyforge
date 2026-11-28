import { test, expect } from '@playwright/test'

test('061 choose edited timeline candidates, restore after refresh and supplement without replacing existing events', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let calls = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'history061-events'))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (req.method() === 'POST' && url.pathname.endsWith('/synthetic-history-events/v1/chat/completions')) {
      calls++
      const sent = JSON.parse(req.postData()!).messages.map((m: { content: string }) => m.content).join('\n')
      const ids = [...new Set(sent.match(/res:v1:historical-event:[a-f0-9-]+/g) ?? [])]
      expect(ids.length).toBeGreaterThanOrEqual(2)
      if (calls === 2) expect(sent).toContain('作者改定的事件过程')
      const events = ids.slice(-2).map((draftId, index) => ({ draftId, title: `第${calls}批灰潮${index + 1}`, era: 'custom', date: `灰潮前${index + 1}旬`, description: `待确认的第${calls}批过程${index + 1}`, impact: '人类退向边陲。' }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, events }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }) })
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(req.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const scope = await page.evaluate(async endpoint => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const f = await seedCurrentWorkspace('061 时间轴事件候选')
    useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-local-only', model: 'gpt-4.1-mini', baseUrl: endpoint, maxTokens: 0, temperature: 0.35 })
    return f.scope
  }, `${origin}/synthetic-history-events/v1`)
  const read = () => page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.historicalTimelineEvents.where('projectId').equals(projectId).toArray()
  }, scope.projectId)
  await page.goto(`./workspace/${scope.projectId}?module=history`)
  await page.getByRole('button', { name: 'AI 生成事件', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '历史事件候选', exact: true })
  await dialog.getByRole('spinbutton', { name: '本批最多事件数' }).fill('2')
  await dialog.getByRole('button', { name: '生成事件候选', exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await expect(dialog.getByRole('checkbox').first()).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: '加入所选事件（0）', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: '第1个事件的过程', exact: true }).fill('作者改定的事件过程\n尾空格  ')
  await dialog.getByRole('checkbox').first().check()
  await dialog.getByRole('button', { name: '关闭事件候选', exact: true }).click()
  expect(await read()).toEqual([])
  await page.reload()
  await page.getByRole('button', { name: '继续编辑：历史事件候选', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '历史事件候选', exact: true })
  await expect(dialog.getByRole('textbox', { name: '第1个事件的过程', exact: true })).toHaveValue('作者改定的事件过程\n尾空格  ')
  await expect(dialog.getByRole('checkbox').first()).toBeChecked()
  expect(calls).toBe(1)
  await dialog.getByRole('button', { name: '加入所选事件（1）', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const before = await read()
  expect(before).toHaveLength(1)
  expect(before[0]).toMatchObject({ title: '第1批灰潮1', year: null, description: '作者改定的事件过程\n尾空格  ', isHistorical: false, worldId: scope.worldId })
  expect(before[0].workId).toBeUndefined()
  await page.getByRole('button', { name: 'AI 生成事件', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '历史事件候选', exact: true })
  await expect(dialog.getByRole('combobox', { name: '事件生成方式' })).toHaveValue('supplement')
  await dialog.getByRole('button', { name: '生成事件候选', exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByRole('checkbox').last().check()
  await dialog.getByRole('button', { name: '加入所选事件（1）', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const after = await read()
  expect(after).toHaveLength(2)
  expect(after.find((row: { id: number }) => row.id === before[0].id)).toEqual(before[0])
  expect(after.some((row: { title: string }) => row.title === '第2批灰潮2')).toBe(true)
  expect(calls).toBe(2)
})
