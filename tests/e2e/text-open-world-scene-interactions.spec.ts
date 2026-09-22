import { expect, test, type Page } from '@playwright/test'

test('P9场景在真实玩家入口统一承载叙事、固定选项、系统Action和受限自然输入', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-scene-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextP9Fixture },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
    ])
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器P9场景交互验收',
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊P9场景存档',
      seed: 'browser-open-world-p9-scene',
    })
    return { projectId: created.scope.projectId, sessionId: created.session.id, title: created.session.title }
  })

  await page.goto(`./openworld/runtime?project=${seeded.projectId}&mode=play`)
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()

  const published = page.getByTestId('text-open-world-published-scene')
  await expect(published).toContainText('冻结叙事')
  await expect(published).toContainText('干涸的内渠')
  await expect(page.getByTestId('text-open-world-fixed-choices')).toContainText('接下盐渠委托')
  await expect(page.getByTestId('text-open-world-system-actions')).toContainText('接受主线任务')
  await expect(page.getByTestId('text-open-world-natural-input')).toContainText('我接受这个任务')
  await expect(page.getByText('渠边传闻', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '岑阿婆 · 守渠人的话', exact: true }).click()
  const dialogue = page.getByTestId('text-open-world-npc-dialogue')
  await expect(dialogue).toContainText('NPC 对话 · 岑阿婆')
  await expect(dialogue).toContainText('态度一般')
  await expect(dialogue).toContainText('岑阿婆礼貌地点头，等你说明来意。')
  await page.getByRole('button', { name: '岑阿婆 · 干涸的内渠', exact: true }).click()

  const naturalInput = page.getByLabel('你想怎么做？')
  const timeline = page.getByTestId('text-open-world-global-status')
  const timelineBeforeRejectedInput = await timeline.textContent()
  const eventsBeforeRejectedInput = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
  }, seeded.sessionId)
  await naturalInput.fill('我要飞到月亮')
  await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交' }).click()
  await expect(page.getByTestId('text-open-world-input-notice')).toContainText('没有改变世界状态')
  await expect(timeline).toHaveText(timelineBeforeRejectedInput ?? '')
  expect(await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
  }, seeded.sessionId)).toBe(eventsBeforeRejectedInput)

  await page.getByTestId('text-open-world-fixed-choices').getByRole('button', { name: /^接下盐渠委托/ }).click()
  await expect(published).toContainText('盐壳下的水痕', { timeout: 20_000 })
  await expect(page.getByTestId('text-open-world-feedback')).toBeVisible()
  expect(await latestCommandSource(page, seeded.sessionId)).toBe('fixed-choice')

  await page.getByLabel('你想怎么做？').fill('检查一下盐渠')
  await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交' }).click()
  await expect(page.getByTestId('text-open-world-feedback')).toBeVisible()
  await expect.poll(() => latestCommandSource(page, seeded.sessionId)).toBe('mapped-intent')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('text-open-world-natural-input')).toBeVisible()
  await expect(page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交' })).toBeVisible()
  expect(await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))).toEqual({ viewportWidth: 390, documentWidth: 390 })
})

async function latestCommandSource(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const events = await db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence')
    const command = events.reverse().find((event: { type: string }) => event.type === 'text-open-world.command.committed')
    return command ? JSON.parse(command.payloadJson).envelope.source : null
  }, sessionId)
}
