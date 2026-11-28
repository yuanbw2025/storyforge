import { expect, test } from '@playwright/test'

test('048 native same-name rule selection preserves draft barriers and frozen AI targets while shared paths remain independent', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let calls = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '048-selected-record'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/synthetic-rule/v1/chat/completions')) {
      calls++
      const prompt = (request.postDataJSON().messages as Array<{ content: string }>).map(message => message.content).join('\n')
      for (const marker of ['第一规则约束', '第二条原约束', '共享概述：热量守恒', '第二条不丢属性']) expect(prompt).toContain(marker)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"version":1,"value":"只修改第二条的 AI 规则"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1800, completion_tokens: 80, total_tokens: 1880 } }) })
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const f = await page.evaluate(async endpoint => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { useCultivationStore } = await load<typeof import('../../src/stores/cultivation')>('/storyforge/src/stores/cultivation.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const { scope } = await seedCurrentWorkspace('048 明确规则记录隔离工程')
    const ids: number[] = []
    for (const [description, rules, marker] of [['第一规则描述', '第一规则约束', '第一条不丢属性'], ['第二规则描述', '第二条原约束', '第二条不丢属性']]) ids.push(await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', { projectId: scope.projectId, worldGroupId: null, name: '同名规则', description, rules, levels: JSON.stringify({ 上阶: { 原属性: marker, value: 125 } }), createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number)
    const stages = '[{"id":"root","name":"独立起境","parentStageIds":[],"extra":{"keep":125}}]'
    const pathId = await useCultivationStore.getState().addSystem({ projectId: scope.projectId, worldGroupId: null, name: '共享成长路径', description: '不属于某条规则记录', stages }, scope)
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: null, powerHierarchy: '共享概述：热量守恒' }, scope)
    useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-only', model: 'gpt-4.1-mini', baseUrl: endpoint, maxTokens: 0 })
    return { scope, ids, pathId, stages, first: await db.powerSystems.get(ids[0]), second: await db.powerSystems.get(ids[1]) }
  }, `${origin}/synthetic-rule/v1`)
  await page.goto(`./workspace/${f.scope.projectId}?module=worldview-origin&originField=power`)
  const panel = page.getByRole('group', { name: '力量体系规则明细', exact: true }), picker = panel.getByRole('combobox', { name: '选择力量规则明细', exact: true })
  await expect(picker).toHaveValue('')
  await expect(panel.getByText('第一规则描述', { exact: true })).toHaveCount(0)
  await picker.selectOption(String(f.ids[0]))
  await expect(panel.locator('[data-markdown-read-view]').filter({ hasText: '第一规则描述' })).toBeVisible()
  await page.evaluate(async () => {
    const { registerPendingDraftFlusherV1 } = await (new Function('return import("/storyforge/src/lib/authoring/pending-edit-coordinator.ts")'))()
    Reflect.set(window, '__power048Unblock', registerPendingDraftFlusherV1(async () => { throw new Error('synthetic pending draft prevents rule switch') }))
  })
  await picker.selectOption(String(f.ids[1]))
  await expect(panel.getByRole('alert')).toContainText('synthetic pending draft')
  await expect(picker).toHaveValue(String(f.ids[0]))
  await expect(panel.locator('[data-markdown-read-view]').filter({ hasText: '第一规则描述' })).toBeVisible()
  await page.evaluate(() => Reflect.get(window, '__power048Unblock')())
  await picker.selectOption(String(f.ids[1]))
  const view = panel.locator('[data-markdown-read-view]').filter({ hasText: '第二规则描述' })
  await view.getByRole('button', { name: '编辑源码', exact: true }).click()
  const description = ' 第二条作者独立稿\n完整尾空白  '
  await panel.getByRole('textbox').fill(description)
  await picker.focus()
  await expect.poll(() => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.powerSystems.get(id)).description
  }, f.ids[1])).toBe(description)
  await panel.getByRole('button', { name: 'AI 规则与代价', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '力量 AI · 规则与代价', exact: true })
  await dialog.getByRole('button', { name: '生成候选', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '力量字段候选', exact: true })).toHaveValue('只修改第二条的 AI 规则')
  await dialog.getByRole('button', { name: '关闭力量候选', exact: true }).click()
  await picker.selectOption(String(f.ids[0]))
  await page.getByRole('button', { name: `继续编辑：规则与代价（规则记录 #${f.ids[1]}）`, exact: true }).click()
  dialog = page.getByRole('dialog', { name: '力量 AI · 规则与代价', exact: true })
  await expect(dialog.getByRole('heading')).toContainText(`规则记录 #${f.ids[1]}`)
  await dialog.getByRole('button', { name: '确认采用', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const saved = await page.evaluate(async f => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { first: await db.powerSystems.get(f.ids[0]), second: await db.powerSystems.get(f.ids[1]), path: await db.cultivationSystems.get(f.pathId) }
  }, f)
  expect(saved.first).toEqual(f.first)
  expect(saved.second).toMatchObject({ description, rules: '只修改第二条的 AI 规则', levels: f.second!.levels, ragDocumentId: Reflect.get(f.second!, 'ragDocumentId') })
  expect(saved.path.stages).toBe(f.stages)
  await expect(page.getByRole('navigation', { name: '修炼路径', exact: true }).getByRole('button', { name: /共享成长路径/ })).toBeVisible()
  expect(calls).toBe(1)
})
