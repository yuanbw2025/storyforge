import { expect, test } from '@playwright/test'

test('mobile home directory closes through the scrim, toggle and destination without covering desktop', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 850 })
    await page.goto('./')
    await page.getByTestId('home-page').waitFor()
    const menu = page.getByRole('button', { name: '页面目录', exact: true })
    const drawer = page.locator('.home-app .lf-sidebar')
    await expect(menu).toBeVisible()
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await expect(drawer).toBeVisible()
    const scrim = page.getByRole('button', { name: '关闭页面目录', exact: true })
    await expect(scrim).toBeVisible()
    expect(await page.evaluate(width => ({
      outside: document.elementFromPoint(width - 10, 200)?.closest('.home-menu-scrim') != null,
      inside: document.elementFromPoint(20, 200)?.closest('.lf-sidebar') != null,
    }), width)).toEqual({ outside: true, inside: true })
    await page.mouse.click(width - 10, 200)
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(scrim).toHaveCount(0)
    await menu.click()
    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await page.getByRole('navigation', { name: '首页导航' }).getByRole('button', { name: '任务中心', exact: true }).click()
    await expect(page).toHaveURL(/home\/tasks/)
    await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(scrim).toHaveCount(0)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  await page.getByTestId('home-page').waitFor()
  await expect(page.locator('.home-app .lf-sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: '页面目录', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '关闭页面目录', exact: true })).toHaveCount(0)
  expect(await page.locator('.home-main').evaluate(main => {
    const box = main.getBoundingClientRect()
    return main.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 100))
  })).toBe(true)
})
