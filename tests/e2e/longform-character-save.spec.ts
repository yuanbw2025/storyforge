import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'

async function createCharacter(page: Page, weight = '主要') {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '角色写入与归属隔离验收')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '角色生成'); await expect(page).toHaveURL(/module=characters/)
  await page.getByRole('button', { name: /^新建角色/ }).click()
  await page.getByRole('main').getByRole('button', { name: weight, exact: true }).first().click()
  await page.getByRole('button', { name: '守序善良', exact: true }).first().click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()
  await expect(page.getByPlaceholder('背景故事…', { exact: true })).toBeVisible()
  return projectId
}
async function row(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.characters.where('projectId').equals(id).first()
  }, projectId)
}
async function refuse(page: Page) {
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.characters.update.bind(db.characters)
    db.characters.update = async () => { throw new DOMException('角色配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreCharacterWrite: () => { db.characters.update = update } })
  })
}

test('a failed character dimension keeps the draft visible and can retry the same text', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await createCharacter(page)
  const before = await row(page, id)
  await refuse(page)
  await page.getByPlaceholder('背景故事…', { exact: true }).fill('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
  await page.getByPlaceholder('背景故事…', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
  await expect(page.getByPlaceholder('背景故事…', { exact: true })).toHaveValue('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
  expect((await row(page, id)).background).toBe(before.background); expect(errors).toEqual([])
  await page.evaluate(() => (window as unknown as { restoreCharacterWrite: () => void }).restoreCharacterWrite())
  await page.getByRole('button', { name: '重试保存背景故事', exact: true }).click()
  await expect.poll(async () => (await row(page, id)).background).toBe('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
})

test('a failed character name stays open and never reports a save before acknowledgement', async ({ page }) => {
  const id = await createCharacter(page)
  await refuse(page)
  await page.getByText('新角色', { exact: true }).last().click()
  const input = page.locator('input.text-2xl')
  await input.fill('林照'); await input.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
  await expect(input).toHaveValue('林照'); expect((await row(page, id)).name).toBe('新角色')
})

test('switching character cannot discard a failed dimension draft', async ({ page }) => {
  const id = await createCharacter(page)
  await page.getByText('新角色', { exact: true }).last().click()
  await page.locator('input.text-2xl').fill('林照')
  await page.locator('input.text-2xl').press('Enter')
  await expect.poll(async () => (await row(page, id)).name).toBe('林照')
  await page.getByRole('button', { name: /^新建角色/ }).click()
  await page.getByRole('button', { name: '主要', exact: true }).first().click()
  await page.getByRole('button', { name: '守序善良', exact: true }).first().click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()
  await expect(page.getByRole('button', { name: '创建并分流', exact: true })).toBeHidden()
  await expect(page.getByText('新角色', { exact: true }).last()).toBeVisible()
  await page.getByText('林照', { exact: true }).first().click()
  await refuse(page)
  const draft = page.getByPlaceholder('背景故事…', { exact: true })
  await draft.fill('这份失败的草稿不能被切换角色丢弃。'); await draft.blur()
  await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
  await page.getByText('新角色', { exact: true }).first().click()
  await expect(draft).toHaveValue('这份失败的草稿不能被切换角色丢弃。')
  expect((await row(page, id)).background).toBe('')
})

for (const role of [
  { weight: '主要', leaf: '主要角色' }, { weight: '次要', leaf: '次要角色' },
  { weight: 'NPC', leaf: 'NPC' }, { weight: '路人', leaf: '路人' },
]) {
  test(`${role.leaf}: all 23 dimensions save, reload, clear, and recover from quota failure`, async ({ page }) => {
    test.setTimeout(120000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const projectId = await createCharacter(page, role.weight)
    const original = await row(page, projectId)
    async function open() {
      await openLongformLeaf(page, role.leaf)
      if (role.weight === '主要') await page.getByText('新角色', { exact: true }).first().click()
      else if (role.weight === '次要') await page.getByRole('button', { name: '展开完整设定 ▾', exact: true }).click()
      else await page.getByRole('button', { name: '展开完整设定', exact: true }).click()
      await expect(page.getByLabel('背景故事', { exact: true })).toBeVisible()
    }
    await open()
    const expected: Record<string, string> = {}
    for (const dimension of CHARACTER_DIMENSIONS) {
      const text = `${role.leaf}-${dimension.label}：探路前先测绳结，遇险时保留退路。`
      expected[dimension.key] = text
      if (role.weight === '主要' && dimension.key === 'shortDescription') {
        await page.getByText('点击添加一句话简介…', { exact: true }).click()
        await page.getByPlaceholder('点击添加一句话简介…', { exact: true }).fill(text)
        await page.getByPlaceholder('点击添加一句话简介…', { exact: true }).press('Enter')
      } else {
        await page.getByLabel(dimension.label, { exact: true }).fill(text)
        await page.getByLabel(dimension.label, { exact: true }).blur()
      }
    }
    await page.evaluate(async () => {
      const { flushPendingEditsV1 } = await (new Function('return import("/storyforge/src/lib/authoring/pending-edit-coordinator.ts")'))()
      await flushPendingEditsV1()
    })
    const saved = await row(page, projectId)
    for (const [key, value] of Object.entries(expected)) expect(saved[key], `${role.leaf}.${key}`).toBe(value)
    expect(saved.worldId).toBe(original.worldId)
    await page.reload(); await open()
    for (const dimension of CHARACTER_DIMENSIONS.filter(d => d.key !== 'shortDescription' || role.weight !== '主要')) {
      await expect(page.getByLabel(dimension.label, { exact: true })).toHaveValue(expected[dimension.key])
    }
    const background = page.getByLabel('背景故事', { exact: true })
    await background.fill(''); await background.blur()
    await expect.poll(async () => (await row(page, projectId)).background).toBe('')
    await refuse(page)
    await background.fill('同一角色的失败稿在原位恢复。'); await background.blur()
    await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
    await expect(background).toHaveValue('同一角色的失败稿在原位恢复。')
    expect((await row(page, projectId)).background).toBe('')
    await page.evaluate(() => (window as unknown as { restoreCharacterWrite: () => void }).restoreCharacterWrite())
    await page.getByRole('button', { name: '重试保存背景故事', exact: true }).click()
    await expect.poll(async () => (await row(page, projectId)).background).toBe('同一角色的失败稿在原位恢复。')
    expect(errors).toEqual([])
  })
}

test('rejecting the last generated character closes its durable run and survives reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'isolated-character', baseUrl: 'https://character-terminal.invalid/v1', maxTokens: 4000, contextWindow: 64000 })))
  const projectId = await createCharacter(page)
  let calls = 0
  await page.route('https://character-terminal.invalid/v1/chat/completions', async route => {
    calls++
    const candidate = {
      ...Object.fromEntries(CHARACTER_DIMENSIONS.map(d => [d.key, `${d.label}：先测绳再探路。`])),
      name: '受限探路人', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', relationships: '',
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } }) })
  })
  await page.getByPlaceholder('角色要求（可选）', { exact: true }).fill('只生成一名主要角色。')
  await page.getByRole('button', { name: 'AI 设计角色', exact: true }).click()
  const candidate = page.getByRole('heading', { name: /^待确认 ·/ }).locator('..').locator('..')
  await expect(candidate.getByLabel('姓名 · 候选 1', { exact: true })).toHaveValue('受限探路人')
  await candidate.getByRole('button', { name: '拒绝', exact: true }).click()
  const status = () => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { runs: await db.agentRuns.where('projectId').equals(id).toArray(), characters: await db.characters.where('projectId').equals(id).count(), events: await db.agentRunEvents.where('projectId').equals(id).toArray() }
  }, projectId)
  await expect.poll(async () => (await status()).runs[0]?.status).toBe('cancelled')
  expect((await status()).characters).toBe(1)
  expect((await status()).events.filter((e: { type: string }) => e.type === 'run.cancelled')).toHaveLength(1)
  await page.reload(); await expect(page.getByRole('button', { name: 'AI 设计角色', exact: true })).toBeEnabled()
  expect((await status()).runs[0]?.status).toBe('cancelled'); expect(calls).toBe(1)
})

