import { expect, test } from '@playwright/test'

test('Salt Ridge installs a formal release, starts a journey and resumes after reload', async ({ page, baseURL }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'salt-ridge-showcase-e2e')
  })
  const localOrigin = new URL(baseURL!).origin
  const publicOrigin = 'https://salt-ridge.example'
  const externalRequests: string[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === publicOrigin && url.pathname.startsWith('/storyforge/') && route.request().method() === 'GET') {
      return route.fulfill({ response: await route.fetch({ url: localOrigin + url.pathname + url.search }) })
    }
    externalRequests.push(url.origin + url.pathname)
    return route.abort()
  })
  await page.goto(publicOrigin + '/storyforge/')
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
  expect(await page.evaluate(async () => {
    const load = new Function('path','return import(path)') as (path: string) => Promise<typeof import('../../src/lib/db/schema')>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { sessions: await db.productRuntimeSessions.count(), releases: await db.productReleases.count() }
  })).toEqual({ sessions: 1, releases: 1 })
  await page.goto(publicOrigin + '/storyforge/openworld/production')
  await expect(page.getByText('当前产品尚未开放创作；已保存制作记录与发行版本仍可查看和游玩。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '先试玩《盐脊：断流之夜》' })).toBeEnabled()
  expect(externalRequests).toEqual([])
})

test('Salt Ridge landing remains usable on a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./play/salt-ridge')
  await expect(page.getByRole('button', { name: '安装并开始', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
