import { expect, test } from '@playwright/test'

const routes = ['world/settings', 'short/intent', 'script/editor', 'comic/script', 'motion/series', 'chat/vision', 'town/vision', 'ttrpg/vision', 'avg/vision', 'community/market']

for (const width of [1440, 1920, 768, 390]) {
  test(`product workspaces reserve content space and keep navigation usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      await page.goto(`./${route}`)
      const main = page.locator('.lf-main').first()
      const heading = page.locator('.lf-heading').first()
      await expect(heading).toBeVisible()
      const bounds = (await main.boundingBox())!
      expect(bounds.width, `${route} at ${width}`).toBeGreaterThan(width - (width > 650 ? 155 : 2))
      const top = (await heading.boundingBox())!
      expect(top.height, `${route} toolbar at ${width}`).toBeLessThanOrEqual(width > 650 ? 60 : 110)
      if (width > 700) {
        const category = page.locator('.lf-steps,.cp-subnav,.mm-subnav,.lf-step-nav').first()
        if (await category.isVisible()) expect((await category.boundingBox())!.width).toBeLessThanOrEqual(144)
      }
      if (width <= 700) {
        const active = page.locator('.cp-subnav [aria-current="page"], .mm-subnav [aria-current="page"], .lf-step-nav [aria-current="page"]')
        if (await active.count()) await expect(active).toBeInViewport()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${route} page overflow`).toBe(true)
    }
    await page.goto('./adventure/vision')
    await expect(page.getByText('文字冒险 · 可验证预览', { exact: true })).toBeVisible()
    const adventureMain = page.locator('.lf-main').first()
    await expect(adventureMain).toBeVisible()
    expect((await adventureMain.boundingBox())!.width).toBeGreaterThan(width - (width > 650 ? 155 : 2))

    await page.goto('./openworld/vision')
    await expect(page.getByRole('note')).toBeVisible()
    const previewMain = page.locator('.main')
    await expect(previewMain).toBeVisible()
    expect((await previewMain.boundingBox())!.width).toBeGreaterThan(width - (width > 650 ? 155 : 2))
  })
}

test('longform modes share a compact toolbar and the saved editor fills the reclaimed space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./long')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('工作区布局验收')
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  const modes = page.getByRole('navigation', { name: '工作台创作方式' })
  const heading = (await page.locator('.lf-heading').boundingBox())!
  expect(heading.height).toBeLessThanOrEqual(52)
  expect((await modes.boundingBox())!.y).toBeLessThan(heading.y + heading.height)
  const content = (await page.locator('.lf-content').boundingBox())!
  expect(content.width).toBeGreaterThan(1100)
  expect(content.height).toBeGreaterThan(750)
  await page.getByRole('navigation', { name: '长篇工作台二级导航' }).getByRole('button', { name: '世界与设定', exact: true }).click()
  await page.getByRole('button', { name: '世界起源', exact: true }).click()
  const origin = page.locator('.worldview-origin-layout')
  await expect(origin).toBeVisible()
  expect((await origin.boundingBox())!.width).toBeGreaterThan(1080)
  expect((await page.locator('.worldview-origin-nav').boundingBox())!.width).toBeLessThanOrEqual(136)
  for (const name of ['节点创作', 'Agent', '分步骤模式']) {
    await modes.getByRole('button', { name, exact: true }).click()
    await expect(modes.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    expect((await page.locator('.lf-content').boundingBox())!.height).toBeGreaterThan(750)
  }
  await page.getByRole('navigation', { name: '长篇工作台二级导航' }).getByRole('button', { name: '世界与设定', exact: true }).click()
  await page.getByRole('button', { name: '世界起源', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const hint = page.getByPlaceholder('给 AI 的补充说明（可选）').filter({ visible: true })
  await expect(hint).toBeVisible()
  const field = (await hint.boundingBox())!
  expect(field.x).toBeGreaterThanOrEqual(0)
  expect(field.x + field.width).toBeLessThanOrEqual(390)
  const generate = (await page.getByRole('button', { name: 'AI 生成', exact: true }).boundingBox())!
  expect(generate.x + generate.width).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '分步骤目录', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '长篇工作台二级导航' })).toBeVisible()
})
