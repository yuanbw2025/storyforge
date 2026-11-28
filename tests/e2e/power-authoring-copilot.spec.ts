import { expect, test } from '@playwright/test'

test('048 actual power controls keep independent drafts across refresh, adopt one field and require stage-removal impact confirmation', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let calls = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'power048-copilot'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/synthetic-power/v1/chat/completions')) {
      calls++
      const value = calls === 1 ? { version: 1, value: '候选能力：感知热流，但不能直接生火。' }
        : { version: 1, value: { version: 1, updates: [], additions: [], removals: ['join'] } }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'synthetic-power', choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 100, total_tokens: 1300 } }) })
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
    const { scope } = await seedCurrentWorkspace('048 原界面候选隔离工程')
    const stages = JSON.stringify([{ id: 'root', name: '起境', parentStageIds: [], features: '原能力 α', breakthrough: '原代价', extra: { keep: 125 } },
      { id: 'left', name: '左境', parentStageIds: ['root'] }, { id: 'right', name: '右境', parentStageIds: ['root'] }, { id: 'join', name: '合流', parentStageIds: ['left', 'right'] }])
    const id = await useCultivationStore.getState().addSystem({ projectId: scope.projectId, name: '炭火路径', description: '原独立路径原理', stages }, scope)
    await useWorldviewStore.getState().savePowerSystem({ projectId: scope.projectId, worldGroupId: null, name: '原全局力量规则', description: '原总体', rules: '原规则与代价', levels: '旧说明与阶段图分别保留' }, scope)
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', { projectId: scope.projectId, name: '阶段引用角色', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', cultivationSystemId: id, cultivationStageId: 'join', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
    useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-local-only', model: 'gpt-4.1-mini', baseUrl: endpoint, maxTokens: 0, temperature: 0.35 })
    return { scope, id, stages, characterId }
  }, `${origin}/synthetic-power/v1`)
  await page.goto(`./workspace/${f.scope.projectId}?module=worldview-origin&originField=power`)
  const panel = page.getByRole('region', { name: '修炼体系编辑', exact: true })
  await panel.getByRole('navigation', { name: '境界列表', exact: true }).getByRole('button', { name: '起境', exact: true }).click()
  await panel.getByRole('button', { name: 'AI 能力与限制', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '力量 AI · 能力与限制', exact: true })
  await dialog.getByRole('button', { name: '生成候选', exact: true }).click()
  const editor = dialog.getByRole('textbox', { name: '力量字段候选', exact: true })
  await expect(editor).toHaveValue('候选能力：感知热流，但不能直接生火。')
  const draft = '作者保留稿：感知热流，超过三息会灼伤。\n第二行末尾空白  '
  await editor.fill(draft)
  await dialog.getByRole('button', { name: '关闭力量候选', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '继续编辑：能力与限制', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '力量 AI · 能力与限制', exact: true })
  await expect(dialog.getByRole('textbox', { name: '力量字段候选', exact: true })).toHaveValue(draft)
  expect(calls).toBe(1)
  const original = await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.cultivationSystems.get(id)
  }, f.id)
  expect(original.stages).toBe(f.stages)
  await dialog.getByRole('button', { name: '确认采用', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const adopted = await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.cultivationSystems.get(id)
  }, f.id)
  expect(JSON.parse(adopted.stages)[0]).toEqual({ ...JSON.parse(f.stages)[0], features: draft })
  expect(JSON.parse(adopted.stages).slice(1)).toEqual(JSON.parse(f.stages).slice(1))
  expect(adopted.description).toBe('原独立路径原理')
  await panel.getByRole('button', { name: 'AI 整路径阶段规划', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '力量 AI · 整路径阶段规划', exact: true })
  await dialog.getByRole('button', { name: '生成候选', exact: true }).click()
  await expect(dialog.getByText('阶段引用角色', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认采用', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: '我已核对以上删除和引用影响', exact: true }).check()
  await dialog.getByRole('button', { name: '关闭力量候选', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '继续编辑：整路径阶段规划', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '力量 AI · 整路径阶段规划', exact: true })
  await expect(dialog.getByRole('checkbox', { name: '我已核对以上删除和引用影响', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: '确认采用', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const final = await page.evaluate(async f => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { system: await db.cultivationSystems.get(f.id), character: await db.characters.get(f.characterId), power: await db.powerSystems.where('projectId').equals(f.scope.projectId).first() }
  }, f)
  expect(JSON.parse(final.system.stages).map((s: { id: string }) => s.id)).toEqual(['root', 'left', 'right'])
  expect(final.character.cultivationStageId).toBeNull()
  expect(final.power).toMatchObject({ name: '原全局力量规则', description: '原总体', rules: '原规则与代价', levels: '旧说明与阶段图分别保留' })
  expect(calls).toBe(2)
})
