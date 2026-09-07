import { expect, test } from '@playwright/test'

test('文字开放世界玩家壳在桌面三栏与移动五入口之间保持同一场景时间线', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-shell-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextFixture },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
    ])
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器文字开放世界壳验收',
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊浏览器存档',
      seed: 'browser-open-world-shell',
    })
    return {
      projectId: created.scope.projectId,
      sessionId: created.session.id,
      title: created.session.title,
    }
  })

  expect(seeded.projectId).toBeGreaterThan(0)
  expect(seeded.sessionId).toBeGreaterThan(0)
  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()

  const shell = page.getByTestId('text-open-world-shell')
  const left = page.getByTestId('text-open-world-navigation-rail')
  const main = page.getByTestId('text-open-world-main-view')
  const right = page.getByTestId('text-open-world-context-rail')
  await expect(shell).toBeVisible({ timeout: 20_000 })
  await expect(left).toBeVisible()
  await expect(main).toBeVisible()
  await expect(right).toBeVisible()
  await expect(page.getByTestId('text-open-world-runtime-source')).toContainText('PRODUCT RELEASE v1 · 已固定')

  const desktopGeometry = await page.evaluate(() => {
    const rect = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
      .getBoundingClientRect()
    const leftRect = rect('text-open-world-navigation-rail')
    const mainRect = rect('text-open-world-main-view')
    const rightRect = rect('text-open-world-context-rail')
    return {
      left: { left: leftRect.left, right: leftRect.right, width: leftRect.width },
      main: { left: mainRect.left, right: mainRect.right, width: mainRect.width },
      right: { left: rightRect.left, right: rightRect.right, width: rightRect.width },
    }
  })
  expect(desktopGeometry.left.width).toBeGreaterThan(150)
  expect(desktopGeometry.main.width).toBeGreaterThan(400)
  expect(desktopGeometry.right.width).toBeGreaterThan(240)
  expect(desktopGeometry.left.right).toBeLessThanOrEqual(desktopGeometry.main.left + 0.5)
  expect(desktopGeometry.main.right).toBeLessThanOrEqual(desktopGeometry.right.left + 0.5)

  await left.getByRole('button', { name: '任务', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'quests')
  await expect(page.getByTestId('text-open-world-quest-log')).toBeVisible()
  await expect(page.getByTestId('text-open-world-quest-log')).toContainText('断流的盐渠')
  await expect(page.getByTestId('text-open-world-quest-log')).not.toContainText('交付短缺物资')
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  const timelineBeforeConfirmation = await page.getByTestId('text-open-world-global-status').textContent()
  const riskyAction = page.locator('button').filter({ hasText: '偷取盐露药剂' }).first()
  const underlyingAction = page.locator('button').filter({ hasText: '休息' }).first()
  await riskyAction.focus()
  await riskyAction.click()
  const confirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '确认执行' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: '确认执行' })).toBeFocused()
  await underlyingAction.evaluate(element => (element as HTMLButtonElement).click())
  await expect(confirmation).toBeVisible()
  await expect(page.getByTestId('text-open-world-global-status')).toHaveText(timelineBeforeConfirmation ?? '')
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(riskyAction).toBeFocused()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(left).toBeHidden()
  await expect(right).toBeHidden()
  const mobileNavigation = page.getByTestId('text-open-world-mobile-navigation')
  await expect(mobileNavigation).toBeVisible()
  const mobileLabels = await mobileNavigation.getByRole('button').allTextContents()
  expect(mobileLabels.map(label => label.trim())).toEqual(['场景', '地图', '任务', '角色', '更多'])

  await mobileNavigation.getByRole('button', { name: '地图', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'map')
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  await page.getByRole('button', { name: '打开当前位置上下文', exact: true }).click()
  await expect(right).toBeVisible()
  await expect(right).toHaveAttribute('role', 'dialog')
  const mobileDrawerGeometry = await page.evaluate(() => {
    const layout = document.querySelector<HTMLElement>('.open-world-game-layout')!.getBoundingClientRect()
    const drawer = document.querySelector<HTMLElement>('[data-testid="text-open-world-context-rail"]')!
      .getBoundingClientRect()
    return {
      layoutBottom: layout.bottom,
      drawerBottom: drawer.bottom,
      drawerLeft: drawer.left,
      drawerRight: drawer.right,
      drawerTop: drawer.top,
    }
  })
  expect(Math.abs(mobileDrawerGeometry.drawerBottom - mobileDrawerGeometry.layoutBottom)).toBeLessThanOrEqual(1)
  expect(mobileDrawerGeometry.drawerLeft).toBeGreaterThanOrEqual(-0.5)
  expect(mobileDrawerGeometry.drawerRight).toBeLessThanOrEqual(390.5)
  expect(mobileDrawerGeometry.drawerTop).toBeGreaterThan(0)
  const contextClose = right.getByRole('button', { name: '关闭当前位置上下文', exact: true })
  await expect(contextClose).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="text-open-world-context-rail"]'))))
    .toBe(true)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="text-open-world-context-rail"]'))))
    .toBe(true)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(right).toBeVisible()
  await expect(right).not.toHaveAttribute('role', 'dialog')
  await expect(right).not.toHaveAttribute('aria-modal', 'true')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(right).toBeHidden()
  const contextTrigger = page.getByRole('button', { name: '打开当前位置上下文', exact: true })
  await contextTrigger.click()
  await expect(right).toHaveAttribute('role', 'dialog')
  await page.keyboard.press('Escape')
  await expect(right).toBeHidden()
  await expect(contextTrigger).toBeFocused()

  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(element => {
        if (element.closest('[data-testid="text-open-world-global-status"]')) return false
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.left < -0.5 || rect.right > window.innerWidth + 0.5)
      })
      .slice(0, 12)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className),
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      })),
  }))
  expect(overflow, JSON.stringify(overflow, null, 2)).toMatchObject({
    viewportWidth: 390,
    documentWidth: 390,
    elements: [],
  })
})
