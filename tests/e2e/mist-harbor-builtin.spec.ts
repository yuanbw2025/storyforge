import { expect, test } from '@playwright/test'
import {
  MIST_HARBOR_ROADSHOW_BEATS as beats,
  MIST_HARBOR_ROADSHOW_CHOICES as choices,
} from '../../src/content/mist-harbor/story'

test('fresh install, AVG real art, complete route, refreshed save and separate restart', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  await page.goto('./')
  await page.getByRole('button', { name: '跳过引导', exact: true }).first().click()
  await page.getByRole('link', { name: '体验内置作品：雾港，失潮钟声' }).click()
  await expect(page.getByRole('heading', { name: '雾港 失潮钟声' })).toBeVisible()
  await page.getByRole('button', { name: '开始故事', exact: true }).click()
  await expect(page.locator('.avg-playing')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.avg-background img')).toHaveAttribute('src', /^blob:/)
  let node = 'entry'
  while (!['truth', 'home', 'sea'].includes(node)) {
    for (const beat of beats.filter((beat) => beat.nodeKey === node)) {
      await expect(page.locator('.avg-dialogue')).toContainText(beat.text.slice(0, 6))
      if (beat.speaker) await expect(page.locator('.avg-speaker')).toHaveText(beat.speaker)
      await page.getByRole('button', { name: '继续', exact: true }).click()
    }
    if (node === 'entry') {
      await expect(page.locator('.avg-actor img').first()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('avg-first-choice.png') })
      await page.getByRole('button', { name: '快速存档', exact: true }).click()
      await page.reload()
      await page.getByRole('button', { name: '继续游玩', exact: true }).click()
    }
    const choice = choices.find((choice) => choice.sourceNodeKey === node)!
    await page.getByRole('button', { name: new RegExp(choice.text) }).click()
    node = choice.targetNodeKey
  }
  for (const beat of beats.filter((beat) => beat.nodeKey === node)) {
    await expect(page.locator('.avg-dialogue')).toContainText(beat.text.slice(0, 6))
    await page.getByRole('button', { name: '继续', exact: true }).click()
  }
  await expect(page.locator('.avg-cg img')).toHaveAttribute('src', /^blob:/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('avg-ending.png') })
  await page.reload()
  await page.getByRole('button', { name: '从头开始', exact: true }).click()
  await expect(page.locator('.avg-dialogue')).toContainText('第一幕：失潮之夜')
})

test('mobile landing and adventure start are usable without API settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./play/mist-harbor')
  await expect(page.getByRole('button', { name: '开始故事', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mobile-landing.png'), fullPage: true })
  await page.getByRole('button', { name: /TEXT ADVENTURE/ }).click()
  await page.getByRole('button', { name: '开始故事', exact: true }).click()
  await expect(page.getByRole('log', { name: '冒险文字记录' })).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('adventure-mobile.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('button', { name: '继续游玩', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /TEXT ADVENTURE/ }).click()
  await page.getByRole('button', { name: '继续游玩', exact: true }).click()
  await expect(page.getByRole('log', { name: '冒险文字记录' })).toBeVisible()
})
