import { expect, test } from '@playwright/test'
import { openCurrentAiTownPlayer, openProductTab, seedCurrentAiTownProduct } from './helpers/current-products'

test('后日谈小镇完成交谈、行动、离线演化、分支与刷新恢复且不改写世界', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'ai-town-e2e')
    localStorage.removeItem('storyforge-ai-config')
  })
  const seeded = await seedCurrentAiTownProduct(page)
  expect(seeded.worldContentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(seeded.packageHash).toMatch(/^[a-f0-9]{64}$/)

  let player = await openCurrentAiTownPlayer(page)
  await expect(player.getByRole('heading', { name: '灯塔余生镇', exact: true })).toBeVisible()
  await expect(player.getByTestId('ai-town-map')).toContainText('住区')
  await expect(player.getByTestId('ai-town-map')).toContainText('广场')
  await expect(player).toContainText('第 1 日 · 早上')
  await expect(player.getByRole('button', { name: '让小镇自行发展', exact: true })).toBeDisabled()

  await player.getByRole('button', { name: /林舟.*calm/ }).click()
  await expect(player.getByRole('heading', { name: '和 林舟 说话', exact: true })).toBeVisible()
  await player.getByPlaceholder('对林舟说……').fill('今天一起把旧茶屋的窗框修好吧。')
  await player.getByRole('button', { name: '仅保存', exact: true }).click()
  await expect(player).toContainText('今天一起把旧茶屋的窗框修好吧。')
  await expect(player).toContainText(/证据 #\d+/)

  await player.getByRole('button', { name: '帮忙', exact: true }).click()
  await expect(player).toContainText('行动 3')
  await expect(player).toContainText('精力 72/100')

  await player.getByRole('button', { name: '离线推进 1 日', exact: true }).click()
  await expect(player).toContainText('第 2 日')
  await expect(player.getByText('第 1 日', { exact: true })).toBeVisible()

  await player.getByPlaceholder('检查点名称').fill('第二日清晨')
  await player.getByPlaceholder('检查点名称').locator('xpath=following-sibling::button').click()
  await expect(player.getByRole('button', { name: /第二日清晨/ })).toBeVisible()

  await player.getByPlaceholder('分支名称').fill('茶屋修缮支线')
  await player.getByPlaceholder('分支名称').locator('xpath=following-sibling::button').click()
  await expect(player.getByText('茶屋修缮支线', { exact: true })).toBeVisible()

  await page.reload()
  await openProductTab(page, 'town')
  player = page.getByTestId('ai-town-player')
  await expect(player).toContainText('茶屋修缮支线')
  await expect(player).toContainText('第 2 日')
  await player.getByRole('button', { name: /林舟.*calm/ }).click()
  await expect(player).toContainText('今天一起把旧茶屋的窗框修好吧。')

  const integrity = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const release = await db.worldReleases.get(input.worldReleaseId)
    const sessions = await db.productRuntimeSessions.where('projectId').equals(input.projectId).toArray()
    const townSessions = sessions.filter((session: { kind: string }) => session.kind === 'ai-town')
    const eventTypes = (await Promise.all(townSessions.map(async (session: { id: number }) => (
      db.productRuntimeEvents.where('sessionId').equals(session.id).toArray()
    )))).flat().map((event: { type: string }) => event.type)
    return {
      worldContentHash: release?.contentHash,
      townSessionCount: townSessions.length,
      eventTypes,
    }
  }, seeded)
  expect(integrity.worldContentHash).toBe(seeded.worldContentHash)
  expect(integrity.townSessionCount).toBe(2)
  expect(integrity.eventTypes).toContain('town.conversation.integrated')
  expect(integrity.eventTypes).toContain('town.offline-batch.completed')

  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow).toEqual({ viewportWidth: 390, documentWidth: 390 })
})
