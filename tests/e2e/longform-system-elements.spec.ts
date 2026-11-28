import { enterRuleSourceEditorV1, expectRuleSourceValueV1 } from './helpers/markdown-source'
import { installBrowserServiceCapacityFixtureV1 } from './helpers/browser-ai-config'
import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('系统文元素保留原文风；原生候选刷新恢复、编辑确认后才写入，同一 Work 可回读', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://system-elements.invalid/v1', model: 'elements-test', maxTokens: 4000, temperature: 0 })))
  await installBrowserServiceCapacityFixtureV1(page, { provider: 'ollama', baseUrl: 'https://system-elements.invalid/v1', model: 'elements-test' }, 64000)
  let calls = 0
  const value = { version: 1, enabled: false, protagonistIntent: '保住小店', systemMechanism: '每日签到免费领礼物', rewardGrowth: '计划增加手艺，不当作已有余额', limitsCosts: '无惩罚', oppositionRelations: '邻居有不同诉求' }
  await page.route('https://system-elements.invalid/v1/chat/completions', async route => {
    calls++
    expect(route.request().postDataJSON().messages.map((row: { content: string }) => row.content).join('\n')).toContain('目标字段是 systemFictionElements')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'systemFictionElements', value }) }, finish_reason: 'stop' }] }) })
  })
  await createLongform(page, '系统文元素隔离验收')
  await openLongformLeaf(page, '创作规则')
  await enterRuleSourceEditorV1(page, '写作风格', page.getByPlaceholder('描述期望的写作风格', { exact: false }))
  await page.getByPlaceholder('描述期望的写作风格', { exact: false }).fill('作者自己的轻松文风')
  const section = page.getByRole('region', { name: '系统文元素配置', exact: true })
  await page.getByLabel('系统文元素 · 系统机制', { exact: true }).fill('人工设定：一次免费签到')
  const savedElements = section.locator('[data-local-save-status]')
  await expect(savedElements).toHaveAttribute('data-local-save-status', 'dirty')
  await section.getByRole('button', { name: '保存元素', exact: true }).click()
  await expect(savedElements).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload()
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('人工设定：一次免费签到')
  await expectRuleSourceValueV1(page, '写作风格', page.getByPlaceholder('描述期望的写作风格', { exact: false }), '作者自己的轻松文风')
  await section.getByRole('button', { name: 'AI 建议', exact: true }).click()
  const draft = page.getByLabel('系统文元素候选 · 系统机制', { exact: true })
  await expect(draft).toHaveValue(value.systemMechanism)
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('人工设定：一次免费签到')
  await page.reload()
  await expect(draft).toHaveValue(value.systemMechanism)
  await draft.fill('作者修订：每天首次签到才免费')
  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('作者修订：每天首次签到才免费')
  await page.reload()
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('作者修订：每天首次签到才免费')
  await expectRuleSourceValueV1(page, '写作风格', page.getByPlaceholder('描述期望的写作风格', { exact: false }), '作者自己的轻松文风')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(calls).toBe(1)
})

test('790 native structured first creation preserves the same page text draft, original identity and reopened values', async ({ page }) => {
  let modelCalls = 0
  await page.route(/\/(?:chat\/completions|responses|messages)(?:\?|$)/, async route => { modelCalls++; await route.abort() })
  await createLongform(page, '790 双向首次规则保存')
  await openLongformLeaf(page, '创作规则')
  const section = page.getByRole('region', { name: '系统文元素配置', exact: true })
  const raw = '  # 作者原文\n中文 e\u0301 🌙 保留尾空白。  '
  const scope = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const work = (await db.works.toArray()).find(row => row.title === '790 双向首次规则保存')
    if (!work?.id) throw Error('Missing the actual isolated Work')
    const { readOwnedRows } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    if ((await readOwnedRows({ projectId: work.projectId, worldId: work.worldId, workId: work.id }, 'creativeRules', { owner: 'work' })).length) throw Error('First-create fixture already has a rule row')
    const scope = { projectId: work.projectId, worldId: work.worldId, workId: work.id }
    const { coordinatePendingEditV1 } = await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    let reached!: () => void
    const started = new Promise<void>(resolve => { reached = resolve })
    void coordinatePendingEditV1({ key: `project-singleton:creativeRules:${scope.projectId}:${scope.workId}:default`,
      persist: () => new Promise<void>(resolve => { window.addEventListener('release-isolated-rule790', () => resolve(), { once: true }); reached() }),
    }).catch(() => undefined)
    await started
    return scope
  })
  const read = () => page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { readOwnedRows } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    return readOwnedRows(scope, 'creativeRules', { owner: 'work' })
  }, scope)
  try {
    await page.getByLabel('系统文元素 · 系统机制', { exact: true }).fill(raw)
    await section.getByRole('button', { name: '保存元素', exact: true }).click()
    await expect(section.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saving')
    const style = page.getByPlaceholder('描述期望的写作风格', { exact: false })
    await enterRuleSourceEditorV1(page, '写作风格', style)
    await style.fill(raw)
    await section.getByRole('heading', { name: '系统文元素', exact: true }).click()
    expect(await read()).toEqual([])
    await page.evaluate(() => window.dispatchEvent(new Event('release-isolated-rule790')))
    await expect(section.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
    await expect.poll(async () => (await read())[0]?.writingStyle).toBe(raw)
    const before = await read()
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ projectId: scope.projectId, workId: scope.workId,
      writingStyle: raw, systemFictionElements: { systemMechanism: raw } })
    expect(before[0].ragDocumentId).toBeTruthy()
    await page.reload()
    await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue(raw)
    await expectRuleSourceValueV1(page, '写作风格', style, raw)
    expect(await read()).toEqual(before)
    expect(modelCalls).toBe(0)
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event('release-isolated-rule790'))).catch(() => undefined)
  }
})
