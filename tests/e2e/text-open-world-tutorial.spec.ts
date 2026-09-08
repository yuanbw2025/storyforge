import { expect, test, type Locator, type Page } from '@playwright/test'

async function openFormalSession(page: Page, title: string) {
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: title }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 20_000 })
}

async function runtimeRowCounts(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return {
      events: await db.productRuntimeEvents.where('sessionId').equals(id).count(),
      checkpoints: await db.productRuntimeCheckpoints.where('sessionId').equals(id).count(),
    }
  }, sessionId)
}

async function expectOnlyHint(
  page: Page,
  stepKey: string,
  targetKey: string,
): Promise<Locator> {
  const hints = page.getByTestId('text-open-world-tutorial-hint')
  await expect(hints).toHaveCount(1)
  const hint = hints.first()
  await expect(hint).toBeVisible({ timeout: 20_000 })
  await expect(hint).toHaveAttribute('data-tutorial-step-key', stepKey)
  await expect(hint).toHaveAttribute('data-tutorial-target-key', targetKey)
  return hint
}

async function acknowledgeAndExpectCycleToStayQuiet(page: Page, hint: Locator) {
  await hint.getByRole('button', { name: '知道了', exact: true }).click()
  await expect(page.getByTestId('text-open-world-tutorial-hint')).toHaveCount(0)
  // Acknowledgement must not cascade through several steps in one render cycle.
  await page.waitForTimeout(150)
  await expect(page.getByTestId('text-open-world-tutorial-hint')).toHaveCount(0)
}

test('正式开放世界按真实周期渐进提示，且教程进度不写入运行存档', async ({ page }) => {
  test.setTimeout(210_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-tutorial-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextP9Fixture },
      { hashProductProductionValueV2 },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
    ])
    const textOpenWorldVNext = createTextOpenWorldVNextP9Fixture()
    // Keep one valid, maximum-length authored hint so the browser path also
    // proves frozen Presentation content remains bounded and operable on mobile.
    textOpenWorldVNext.modules.presentation.payload.tutorials[0].triggerActionKey = 'action.accept-main'
    textOpenWorldVNext.modules.presentation.payload.tutorials[0].body = '教程长文'.repeat(500)
    textOpenWorldVNext.modules.presentation.contentHash = await hashProductProductionValueV2(
      textOpenWorldVNext.modules.presentation.payload,
    )
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器渐进教程验收',
      textOpenWorldVNext,
      runtimeShape: 'vnext-only',
      title: '盐脊渐进教程存档',
      seed: 'browser-open-world-tutorial',
    })
    return {
      sessionId: created.session.id as number,
      title: created.session.title,
      productKey: created.runtimePackage.definition.productKey,
    }
  })

  await page.reload()
  await openFormalSession(page, seeded.title)
  await expect(page.getByTestId('text-open-world-runtime-source'))
    .toContainText('PRODUCT RELEASE v1 · 已固定')

  const beforeTutorial = await runtimeRowCounts(page, seeded.sessionId)
  let hint = await expectOnlyHint(page, 'system.opening', 'play.scene')
  await expect(hint).toContainText('渐进提示')
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  // Release-scoped progress survives a full application reload. The opening
  // step stays completed, while the next genuinely available feature appears.
  await page.reload()
  await openFormalSession(page, seeded.title)
  hint = await expectOnlyHint(page, 'system.system-actions', 'play.system-actions')
  await expect(hint).not.toHaveAttribute('data-tutorial-step-key', 'system.opening')
  const systemActionGeometry = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(
      '[data-open-world-ui-key~="play.system-actions"]',
    )!.getBoundingClientRect()
    return { top: target.top, bottom: target.bottom, viewportHeight: window.innerHeight }
  })
  expect(systemActionGeometry.bottom).toBeGreaterThan(0)
  expect(systemActionGeometry.top).toBeLessThan(systemActionGeometry.viewportHeight)
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  await page.reload()
  await openFormalSession(page, seeded.title)
  hint = await expectOnlyHint(page, 'system.fixed-choices', 'play.fixed-choices')
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  await page.reload()
  await openFormalSession(page, seeded.title)
  hint = await expectOnlyHint(page, 'authored.tutorial.investigate', 'play.system-actions')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hint).toBeVisible()
  const authoredGeometry = await hint.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const target = document.querySelector<HTMLElement>(
      '[data-open-world-ui-key~="play.system-actions"]',
    )!.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      targetTop: target.top,
      targetBottom: target.bottom,
    }
  })
  expect(authoredGeometry.top).toBeGreaterThanOrEqual(0)
  expect(authoredGeometry.bottom).toBeLessThanOrEqual(authoredGeometry.viewportHeight)
  expect(authoredGeometry.scrollHeight).toBeGreaterThan(authoredGeometry.clientHeight)
  expect(authoredGeometry.targetBottom).toBeGreaterThan(0)
  expect(authoredGeometry.targetTop).toBeLessThan(authoredGeometry.viewportHeight)
  const authoredAcknowledge = hint.getByRole('button', { name: '知道了', exact: true })
  await authoredAcknowledge.scrollIntoViewIfNeeded()
  const topmostAtAcknowledge = await authoredAcknowledge.evaluate(button => {
    const rect = button.getBoundingClientRect()
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return topmost === button || button.contains(topmost)
  })
  expect(topmostAtAcknowledge).toBe(true)
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await openFormalSession(page, seeded.title)
  hint = await expectOnlyHint(page, 'system.natural-input', 'play.natural-language')
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  const navigation = page.getByTestId('text-open-world-navigation-rail')
  const main = page.getByTestId('text-open-world-main-view')

  await navigation.getByRole('button', { name: '任务', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'quests')
  await expect(page.getByTestId('text-open-world-quest-log')).toBeVisible()
  hint = await expectOnlyHint(page, 'system.quests', 'overlay.quest-log')
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  await navigation.getByRole('button', { name: '地图', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'map')
  await expect(page.getByTestId('text-open-world-map-topology')).toBeVisible()
  hint = await expectOnlyHint(page, 'system.map-travel', 'overlay.map')
  await acknowledgeAndExpectCycleToStayQuiet(page, hint)

  await navigation.getByRole('button', { name: '更多', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'more')
  await expect(page.getByTestId('text-open-world-inventory-panel')).toBeVisible()
  hint = await expectOnlyHint(page, 'system.inventory-equipment', 'overlay.inventory')
  await hint.getByRole('button', { name: '暂停全部自动提示', exact: true }).click()
  await expect(page.getByTestId('text-open-world-tutorial-hint')).toHaveCount(0)

  await navigation.getByRole('button', { name: '场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')
  await page.waitForTimeout(150)
  await expect(page.getByTestId('text-open-world-tutorial-hint')).toHaveCount(0)

  const coach = page.getByTestId('text-open-world-tutorial-coach')
  await coach.getByRole('button', { name: '帮助与教程', exact: true }).click()
  const help = page.getByRole('dialog', { name: '帮助与教程', exact: true })
  await expect(help).toBeVisible()
  await expect(help.getByRole('button', { name: '恢复自动提示', exact: true })).toBeVisible()
  const openingStep = help.getByRole('listitem').filter({ hasText: '从当前场景开始' })
  await expect(openingStep.locator('[data-tutorial-status="completed"]')).toHaveText('已完成')
  await openingStep.getByRole('button', { name: '重看', exact: true }).click()
  hint = await expectOnlyHint(page, 'system.opening', 'play.scene')
  await expect(hint).toContainText('教程重看')
  await expect(hint.getByRole('button', { name: '稍后再看教程', exact: true })).toBeFocused()

  await page.evaluate(productKey => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return importer('/storyforge/src/lib/open-world/player-preferences.ts').then(module => {
      module.createTextOpenWorldPlayerPreferencesStoreV1({ productionKey: productKey })
        .write({ highContrast: true })
    })
  }, seeded.productKey)
  await expect(page.getByTestId('text-open-world-shell')).toHaveAttribute('data-high-contrast', 'true')
  const highContrast = await hint.evaluate(element => {
    const body = element.querySelector('p')!
    const primary = Array.from(element.querySelectorAll('button'))
      .find(button => button.textContent?.includes('知道了'))!
    return {
      cardBackground: getComputedStyle(element).backgroundColor,
      bodyColor: getComputedStyle(body).color,
      primaryBackground: getComputedStyle(primary).backgroundColor,
      primaryColor: getComputedStyle(primary).color,
    }
  })
  expect(highContrast).toEqual({
    cardBackground: 'rgb(0, 0, 0)',
    bodyColor: 'rgb(255, 255, 255)',
    primaryBackground: 'rgb(255, 255, 255)',
    primaryColor: 'rgb(0, 0, 0)',
  })

  // Build Preview uses a distinct browser-local channel. Exercising the two
  // domain stores here avoids manufacturing an otherwise unrelated Build just
  // to prove that Preview progress cannot overwrite formal Release progress.
  const storageIsolation = await page.evaluate(async productKey => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const {
      createTextOpenWorldPlayerTutorialStoreV1,
      textOpenWorldPlayerTutorialStorageKeyV1,
    } = await importer('/storyforge/src/lib/open-world/player-tutorials.ts')
    const releaseKey = textOpenWorldPlayerTutorialStorageKeyV1({
      productionKey: productKey,
      runtimeChannel: 'release',
    })
    const previewKey = textOpenWorldPlayerTutorialStorageKeyV1({
      productionKey: productKey,
      runtimeChannel: 'build-preview',
    })
    const releaseBefore = localStorage.getItem(releaseKey)
    const previewBefore = localStorage.getItem(previewKey)
    createTextOpenWorldPlayerTutorialStoreV1({
      productionKey: productKey,
      runtimeChannel: 'build-preview',
    }).complete('system.opening')
    return {
      releaseKey,
      previewKey,
      releaseBefore,
      releaseAfter: localStorage.getItem(releaseKey),
      previewBefore,
      previewAfter: localStorage.getItem(previewKey),
    }
  }, seeded.productKey)
  expect(storageIsolation.releaseKey).not.toBe(storageIsolation.previewKey)
  expect(storageIsolation.releaseBefore).not.toBeNull()
  expect(storageIsolation.releaseAfter).toBe(storageIsolation.releaseBefore)
  expect(storageIsolation.previewBefore).toBeNull()
  expect(JSON.parse(storageIsolation.previewAfter ?? '{}')).toMatchObject({
    completedStepKeys: ['system.opening'],
    suppressAutomatic: false,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hint).toBeVisible()
  const mobileGeometry = await page.evaluate(() => {
    const hintRect = document.querySelector<HTMLElement>(
      '[data-testid="text-open-world-tutorial-hint"]',
    )!.getBoundingClientRect()
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      hintLeft: hintRect.left,
      hintRight: hintRect.right,
    }
  })
  expect(mobileGeometry.viewportWidth).toBe(390)
  expect(mobileGeometry.documentWidth).toBeLessThanOrEqual(390)
  expect(mobileGeometry.hintLeft).toBeGreaterThanOrEqual(0)
  expect(mobileGeometry.hintRight).toBeLessThanOrEqual(390)
  await hint.getByRole('button', { name: '稍后再看教程', exact: true }).click()

  expect(await runtimeRowCounts(page, seeded.sessionId)).toEqual(beforeTutorial)
})
