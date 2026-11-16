import { expect, test } from '@playwright/test'

test('真实审校组件切章即隐藏原章候选，返回可只读恢复，两个原稿和运行证据均不变', async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error('isolated origin required')
  const origin = new URL(baseURL).origin
  let externalRequests = 0
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { externalRequests++; return route.abort() }
    return route.continue()
  })
  await page.goto('./world/worlds')
  // The frozen server compiles lazy bootstrap modules on its first navigation.
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: '世界引擎', exact: true })).toBeVisible()
  await page.evaluate(async () => (await (new Function('return import("/storyforge/tests/helpers/review-owner-browser.tsx")'))()).prepare())
  const fixture = page.getByTestId('review-owner-fixture')
  await expect(fixture.getByRole('button', { name: '确认采纳修订', exact: true })).toBeVisible()
  await expect(fixture.getByTestId('quality-revision-preview')).toContainText('陈禾签下名字。')
  const switched = await page.evaluate(async () => (await (new Function('return import("/storyforge/tests/helpers/review-owner-browser.tsx")'))()).switchTo(1))
  expect(switched.hasCandidate).toBe(false)
  expect(switched.text).not.toContain('陈禾签下名字。')
  expect(switched.buttons).not.toContain('确认采纳修订')
  await expect(fixture.getByTestId('quality-revision-preview')).toHaveCount(0)
  await page.evaluate(async () => (await (new Function('return import("/storyforge/tests/helpers/review-owner-browser.tsx")'))()).switchTo(0))
  await expect(fixture.getByRole('button', { name: '确认采纳修订', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await (new Function('return import("/storyforge/tests/helpers/review-owner-browser.tsx")'))()).unchanged())).toBe(true)
  expect(externalRequests).toBe(0)
})
