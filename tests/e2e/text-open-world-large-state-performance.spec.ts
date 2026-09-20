import { expect, test, type Page, type TestInfo } from '@playwright/test'

const BUDGET_MS = {
  formalSessionOpen: 50_000,
  largeMapRender: 20_000,
  largeQuestLogRender: 5_000,
  largeInventoryRender: 5_000,
  mobileMapListRender: 5_000,
} as const

async function measured(
  name: keyof typeof BUDGET_MS,
  operation: () => Promise<void>,
  results: Record<string, number>,
) {
  const startedAt = Date.now()
  await operation()
  const durationMs = Date.now() - startedAt
  results[name] = durationMs
  expect(durationMs, `${name}超过当前Chromium自动化基线`).toBeLessThan(BUDGET_MS[name])
}

async function openTextOpenWorldPlayer(page: Page, title: string) {
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: title }).click()
}

test('大状态正式Release在桌面与390px移动端保持性能、等价地图和基础可访问性', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(180_000)
  const measurements: Record<string, number> = {}
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-large-state-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { createLargeTextOpenWorldSessionFixtureV1, TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1 } = await importer(
      '/storyforge/tests/helpers/text-open-world-large-state.ts',
    )
    const created = await createLargeTextOpenWorldSessionFixtureV1({
      name: '浏览器大状态性能验收',
      title: '盐脊大状态浏览器存档',
      seed: 'text-open-world-large-state-browser-v1',
    })
    return {
      title: created.session.title,
      counts: TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1,
    }
  })

  await page.reload()
  await measured('formalSessionOpen', async () => {
    await openTextOpenWorldPlayer(page, seeded.title)
    await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: BUDGET_MS.formalSessionOpen })
  }, measurements)

  const desktopNavigation = page.getByTestId('text-open-world-navigation-rail')
  await measured('largeMapRender', async () => {
    await desktopNavigation.getByRole('button', { name: '地图', exact: true }).click()
    const map = page.getByTestId('text-open-world-map-topology')
    await expect(map).toBeVisible()
    await expect(map.locator('[data-map-location]')).toHaveCount(seeded.counts.locations)
    await expect(map.getByRole('list', { name: '地图列表视图' }).getByRole('listitem'))
      .toHaveCount(seeded.counts.locations)
  }, measurements)

  await measured('largeQuestLogRender', async () => {
    await desktopNavigation.getByRole('button', { name: '任务', exact: true }).click()
    const questLog = page.getByTestId('text-open-world-quest-log')
    await expect(questLog).toBeVisible()
    await expect(questLog.locator('div[role="listitem"][data-quest-instance]'))
      .toHaveCount(seeded.counts.questInstances + 1)
    await expect(questLog.getByText(`${seeded.counts.questInstances + 1}/${seeded.counts.questInstances + 1} 项`, { exact: true }))
      .toBeVisible()
  }, measurements)

  await measured('largeInventoryRender', async () => {
    await desktopNavigation.getByRole('button', { name: '更多', exact: true }).click()
    const inventory = page.getByTestId('text-open-world-inventory-panel')
    await expect(inventory).toBeVisible()
    await expect(inventory.getByTestId('text-open-world-inventory-item'))
      .toHaveCount(seeded.counts.inventoryItems - 3)
    await expect(inventory.getByTestId('text-open-world-inventory-summary'))
      .toContainText(`种类${seeded.counts.inventoryItems - 3}`)
  }, measurements)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileNavigation = page.getByTestId('text-open-world-mobile-navigation')
  await expect(mobileNavigation).toBeVisible()
  await measured('mobileMapListRender', async () => {
    await mobileNavigation.getByRole('button', { name: '地图', exact: true }).click()
    const map = page.getByTestId('text-open-world-map-topology')
    await expect(map.getByRole('list', { name: '地图列表视图' }).getByRole('listitem'))
      .toHaveCount(seeded.counts.locations)
  }, measurements)

  const accessibility = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const nameOf = (element: HTMLElement) => {
      const labelledBy = element.getAttribute('aria-labelledby')
      const labelled = labelledBy
        ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ')
        : ''
      return [
        element.getAttribute('aria-label'),
        labelled,
        element.getAttribute('title'),
        element.textContent,
        element instanceof HTMLInputElement ? element.value || element.placeholder : '',
      ].find(value => value?.trim())?.trim() ?? ''
    }
    const candidates = [...document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="button"][tabindex]',
    )].filter(visible).filter(element => !element.hasAttribute('disabled'))
    return {
      unnamed: candidates.filter(element => !nameOf(element)).map(element => element.outerHTML.slice(0, 180)),
      interactiveCount: candidates.length,
      mainCount: document.querySelectorAll('main, [role="main"]').length,
      navigationCount: document.querySelectorAll('nav, [role="navigation"]').length,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(accessibility.interactiveCount).toBeGreaterThan(100)
  expect(accessibility.unnamed).toEqual([])
  expect(accessibility.mainCount).toBeGreaterThan(0)
  expect(accessibility.navigationCount).toBeGreaterThan(0)
  expect(accessibility.horizontalOverflow).toBeLessThanOrEqual(1)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)

  console.info(`[text-open-world-browser-performance] ${JSON.stringify({
    profile: 'local-playwright-chromium-desktop-and-390x844',
    measurements,
    accessibility,
  })}`)

  await testInfo.attach('text-open-world-large-state-performance.json', {
    body: Buffer.from(JSON.stringify({
      profile: 'local-playwright-chromium-desktop-and-390x844',
      counts: seeded.counts,
      budgetsMs: BUDGET_MS,
      measurements,
      accessibility,
    }, null, 2)),
    contentType: 'application/json',
  })
})
