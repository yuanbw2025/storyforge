import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
async function seed(page: Page) {
  await page.goto('./')
  return page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { f } = await (await importer('/storyforge/tests/helpers/open-ttrpg-table-conversation.ts')).seedTableConversationV1(true)
    return { sessionId: f.sessionId, heroName: f.campaign.characterTemplates.find((actor: any) => actor.characterKey === 'hero').name }
  })
}
async function player(page: Page, viewer = 'viewer.seat.hero') {
  await page.getByLabel('我的角色', { exact: true }).selectOption(viewer)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
}
async function memory(page: Page) {
  const card = page.getByTestId('ttrpg-open-memory')
  await card.locator('summary').click()
  await expect(card.getByLabel('记忆内容', { exact: true })).toBeVisible()
  return card
}
test('player writes a private memory, retries the original failed save and explicitly shares across real identity handoff', async ({ page }) => {
  test.setTimeout(120000)
  const requests: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) requests.push(request.url()) })
  const fixture = await seed(page)
  await page.goto(`./play/session/${fixture.sessionId}`); await player(page)
  let card = await memory(page)
  await card.getByLabel('记录性质', { exact: true }).selectOption('belief')
  await card.getByLabel('记忆内容', { exact: true }).fill('只有我知道的推测：有人一直盯着旧港。')
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const add = db.ttrpgNarrativeMemories.add.bind(db.ttrpgNarrativeMemories)
    db.ttrpgNarrativeMemories.add = async (...args: any[]) => {
      db.ttrpgNarrativeMemories.add = add
      throw new DOMException(`Memory fixture quota failure ${args.length}`, 'QuotaExceededError')
    }
  })
  await card.getByRole('button', { name: '确认保存记忆', exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('Memory fixture quota failure')
  await expect(card.getByLabel('记忆内容', { exact: true })).toBeDisabled()
  await card.getByRole('button', { name: '重试保存这条记录', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('记忆已保存。')
  await expect(card.getByRole('region', { name: '当前身份可见的冒险记忆' })).toContainText('个人推测')
  await card.getByLabel('记忆内容', { exact: true }).fill('尚未保存的私人文字也应随交接清空')
  await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click(); await player(page, 'viewer.seat.companion.1')
  card = await memory(page)
  await expect(card.getByRole('region', { name: '当前身份可见的冒险记忆' })).not.toContainText('只有我知道')
  await expect(card.getByLabel('记忆内容', { exact: true })).toHaveValue('')
  await card.getByLabel('记录性质', { exact: true }).selectOption('hearsay')
  await card.getByRole('group', { name: '另外分享给', exact: true }).getByLabel(fixture.heroName, { exact: true }).check()
  await card.getByLabel('记忆内容', { exact: true }).fill('我听到的消息，只明确分享给主角。')
  await card.getByRole('button', { name: '确认保存记忆', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('记忆已保存。')
  await page.reload(); await player(page); card = await memory(page)
  const entries = card.getByRole('region', { name: '当前身份可见的冒险记忆' })
  await expect(entries).toContainText('只有我知道的推测')
  await expect(entries).toContainText('只明确分享给主角')
  await expect(entries).not.toContainText('尚未保存')
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: test.info().outputPath('p8-memory-desk-player.png') })
  const state = await page.evaluate(async fixture => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return { state: await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(fixture.sessionId), count: await db.ttrpgNarrativeMemories.count() }
  }, fixture)
  expect(state.count).toBe(2)
  expect(state.state.ttrpg.openRun.worldTime.worldTurn).toBe(0)
  expect(state.state.ttrpg.openRun.coordination.calls).toEqual([])
  expect(requests).toEqual([])
})
test('human host records GM-only and shared notes without exposing the private note on the player desk', async ({ page }) => {
  test.setTimeout(120000)
  const fixture = await seed(page)
  await page.goto(`./play/session/${fixture.sessionId}`)
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  let card = await memory(page)
  await expect(card.getByLabel('记录视角', { exact: true })).toHaveValue('gm')
  await card.getByLabel('记忆内容', { exact: true }).fill('主持私记：下一幕的准备仍需保密。')
  await card.getByRole('button', { name: '确认保存记忆', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('记忆已保存。')
  await card.getByLabel('记录视角', { exact: true }).selectOption('table')
  await card.getByLabel('记忆可见范围', { exact: true }).selectOption('party')
  await card.getByLabel('记忆内容', { exact: true }).fill('共同记录：大家已经在河港会合。')
  await card.getByRole('button', { name: '确认保存记忆', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('记忆已保存。')
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click(); await player(page)
  card = await memory(page)
  const entries = card.getByRole('region', { name: '当前身份可见的冒险记忆' })
  await expect(entries).not.toContainText('下一幕的准备')
  await expect(entries).toContainText('大家已经在河港会合')
  await page.reload(); await player(page); card = await memory(page)
  await expect(card.getByRole('region', { name: '当前身份可见的冒险记忆' })).not.toContainText('下一幕的准备')
})
