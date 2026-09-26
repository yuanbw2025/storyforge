import { expect, test } from '@playwright/test'

test('Salt Ridge installs a formal release, starts a journey and resumes after reload', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'salt-ridge-showcase-e2e')
  })
  await page.goto('./')
  await page.getByRole('button', { name: /进入完整展示作品/ }).click()
  await expect(page).toHaveURL(/play\/salt-ridge/)
  await expect(page.getByRole('heading', { name: /盐脊.*断流之夜/ })).toBeVisible()
  await expect(page.getByText('完整系统纵向样板')).toBeVisible()
  await expect(page.getByRole('button', { name: '安装并开始', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: '安装并开始', exact: true }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId('text-open-world-runtime-source'))
    .toContainText('PRODUCT RELEASE v1 · 已固定')
  await expect(page.getByTestId('text-open-world-navigation-rail')).toBeVisible()

  const installed = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const releases = await db.productReleases.toArray()
    const sessions = await db.productRuntimeSessions.toArray()
    return {
      releaseCount: releases.length,
      sessionCount: sessions.length,
      releaseId: sessions[0]?.productReleaseId ?? null,
      buildId: sessions[0]?.productBuildId ?? null,
    }
  })
  expect(installed).toMatchObject({ releaseCount: 1, sessionCount: 1, buildId: null })
  expect(installed.releaseId).toBeGreaterThan(0)

  await page.getByRole('button', { name: '返回作品介绍', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续最近旅程', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '继续最近旅程', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继续最近旅程', exact: true }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 30_000 })
})

test('Salt Ridge landing remains usable on a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./play/salt-ridge')
  await expect(page.getByRole('button', { name: '安装并开始', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
