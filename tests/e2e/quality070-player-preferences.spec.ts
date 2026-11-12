import { expect, test, type Page } from '@playwright/test'

async function openPreferences(page: Page, projectId: number, title: string) {
  await page.goto(`./openworld/runtime?project=${projectId}&mode=play`)
  const saves = page.getByRole('region', { name: '正式存档' })
  await expect(saves.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await saves.locator('.open-world-save-open').filter({ hasText: title }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('text-open-world-navigation-rail').getByRole('button', { name: '更多', exact: true }).click()
  const settings = page.getByTestId('text-open-world-save-settings')
  await settings.getByRole('navigation', { name: '存档与设置分类' }).getByRole('button', { name: '设置', exact: true }).click()
  return settings.getByTestId('text-open-world-player-preferences')
}

for (const mode of ['available', 'set-fails', 'unavailable'] as const) {
  test(`SFQA070 real controls preserve earlier choices when preference storage is ${mode}`, async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => {
      const hostname = new URL(route.request().url()).hostname
      return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? route.continue() : route.abort()
    })
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa070'))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('./')
    await page.waitForFunction(() => Boolean(document.querySelector('#root')?.childElementCount))
    const seeded = await page.evaluate(async () => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [fixture, content] = await Promise.all([
        importer<typeof import('../helpers/text-open-world-product-session')>('/storyforge/tests/helpers/text-open-world-product-session.ts'),
        importer<typeof import('../helpers/text-open-world-vnext-fixture')>('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
      ])
      const created = await fixture.createGovernedTextOpenWorldSessionFixtureV1({
        name: 'SFQA070 偏好隔离验证',
        textOpenWorldVNext: content.createTextOpenWorldVNextFixture(),
        runtimeShape: 'vnext-only',
        title: 'SFQA070 本机阅读设置',
        seed: 'sfqa070-preferences',
      })
      return { projectId: created.scope.projectId, title: created.session.title, productionKey: created.runtimePackage.definition.productKey }
    })
    if (mode !== 'available') await page.addInitScript(storageMode => {
      const prefix = 'storyforge:text-open-world:player-preferences:v1:'
      const get = Storage.prototype.getItem
      const set = Storage.prototype.setItem
      const remove = Storage.prototype.removeItem
      Storage.prototype.getItem = function (key) {
        if (storageMode === 'unavailable' && key.startsWith(prefix)) throw new DOMException('blocked', 'SecurityError')
        return get.call(this, key)
      }
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith(prefix)) throw new DOMException('full', 'QuotaExceededError')
        return set.call(this, key, value)
      }
      Storage.prototype.removeItem = function (key) {
        if (storageMode === 'unavailable' && key.startsWith(prefix)) throw new DOMException('blocked', 'SecurityError')
        return remove.call(this, key)
      }
    }, mode)

    const preferences = await openPreferences(page, seeded.projectId, seeded.title)
    const shell = page.getByTestId('text-open-world-shell')
    const ranges = preferences.locator('input[type="range"]')
    await ranges.nth(0).fill('26')
    await ranges.nth(1).fill('2.2')
    await preferences.getByLabel('高对比度', { exact: true }).check()
    await preferences.getByLabel('减少动画', { exact: true }).check()
    await ranges.nth(2).fill('0.35')
    await preferences.getByLabel('声音开启', { exact: true }).check()
    await expect(ranges.nth(0)).toHaveValue('26')
    await expect(ranges.nth(1)).toHaveValue('2.2')
    await expect(ranges.nth(2)).toHaveValue('0.35')
    await expect(shell).toHaveAttribute('data-high-contrast', 'true')
    await expect(shell).toHaveAttribute('data-reduced-motion', 'true')
    await expect(shell).toHaveAttribute('data-muted', 'true')
    await expect(shell).toHaveAttribute('data-player-state', 'ready')
    await expect.poll(() => shell.evaluate(element => getComputedStyle(element).getPropertyValue('--open-world-reader-font-size').trim())).toBe('26px')
    const persisted = await page.evaluate(async productionKey => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const api = await importer<typeof import('../../src/lib/open-world/player-preferences')>('/storyforge/src/lib/open-world/player-preferences.ts')
      return api.readTextOpenWorldPlayerPreferencesV1({ productionKey })
    }, seeded.productionKey)
    expect(persisted.fontSizePx).toBe(mode === 'available' ? 26 : 18)

    if (mode === 'available') {
      const other = await context.newPage()
      other.on('pageerror', error => errors.push(error.message))
      await other.setViewportSize({ width: 1440, height: 1000 })
      const otherPreferences = await openPreferences(other, seeded.projectId, seeded.title)
      await expect(otherPreferences.locator('input[type="range"]').nth(0)).toHaveValue('26')
      await otherPreferences.locator('input[type="range"]').nth(0).fill('29')
      await expect(ranges.nth(0)).toHaveValue('29')
      await expect(preferences.getByLabel('高对比度', { exact: true })).toBeChecked()
      await otherPreferences.getByRole('button', { name: '恢复默认', exact: true }).click()
      await expect(ranges.nth(0)).toHaveValue('18')
      await expect(preferences.getByLabel('高对比度', { exact: true })).not.toBeChecked()
      await other.close()
    } else {
      await preferences.getByRole('button', { name: '恢复默认', exact: true }).click()
      await expect(ranges.nth(0)).toHaveValue('18')
      await expect(ranges.nth(2)).toHaveValue('1')
      await expect(shell).not.toHaveAttribute('data-high-contrast')
      await expect(shell).not.toHaveAttribute('data-muted')
    }
    expect(errors).toEqual([])
  })
}
