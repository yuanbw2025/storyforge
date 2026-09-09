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
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const actors = textOpenWorldVNext.modules.actors.payload as {
      player: { build: { startingItemKeys: string[] } }
    }
    actors.player.build.startingItemKeys.push(
      'item.brine-tonic',
      'item.salt-crystal',
      'item.canal-seal',
    )
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器文字开放世界壳验收',
      textOpenWorldVNext,
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

  await left.getByRole('button', { name: '地图', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'map')
  const mapPanel = page.getByTestId('text-open-world-map-topology')
  const mapSvg = page.getByTestId('text-open-world-map-svg')
  const mapGeometry = await mapSvg.boundingBox()
  // This catches the former global icon rule that collapsed the whole map to
  // 16px while remaining valid inside the desktop shell's bounded main column.
  expect(mapGeometry?.width ?? 0).toBeGreaterThan(400)
  expect(mapGeometry?.height ?? 0).toBeGreaterThan(250)
  const sequenceBeforeMapSelection = await page.getByTestId('text-open-world-global-status').textContent()
  await mapSvg.getByRole('button', { name: /查看地点：断脊渠口/ }).click()
  await expect(mapPanel.getByLabel('选中地点详情')).toContainText('你目前只知道这个地点的名称')
  await expect(mapPanel.locator('[data-map-route="edge.port-ridge"]')).toHaveAttribute('data-route-selected', 'true')
  await expect(page.getByTestId('text-open-world-global-status')).toHaveText(sequenceBeforeMapSelection ?? '')
  await mapPanel.getByLabel('选中地点详情').getByRole('button', { name: /^前往断脊渠口：/ }).click()
  await expect(page.getByTestId('text-open-world-global-status')).toContainText('地点断脊渠口', { timeout: 15_000 })
  await expect(mapPanel.getByTestId('text-open-world-map-feedback')).toBeVisible()
  await expect(mapPanel).toContainText('快速旅行点已解锁')

  await mapPanel.getByRole('button', { name: '查看快旅路线', exact: true }).click()
  await mapPanel.getByLabel('选中地点详情').getByRole('button', { name: /^快速旅行：前往盐港广场/ }).click()
  await expect(page.getByTestId('text-open-world-global-status')).toContainText('地点盐港广场', { timeout: 15_000 })
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  await left.getByRole('button', { name: '任务', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'quests')
  await expect(page.getByTestId('text-open-world-quest-log')).toBeVisible()
  await expect(page.getByTestId('text-open-world-quest-log')).toContainText('断流的盐渠')
  await expect(page.getByTestId('text-open-world-quest-log')).not.toContainText('交付短缺物资')
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  const characterStateBefore = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
    const state = useTextOpenWorldPlayerStore.getState()
    return JSON.stringify({
      runtimeState: state.runtimeState,
      events: state.events,
      checkpoints: state.checkpoints,
      selectedSessionId: state.selectedSessionId,
    })
  })
  const globalStatusBeforeCharacter = await page.getByTestId('text-open-world-global-status').textContent()
  await left.getByRole('button', { name: '角色', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'character')
  const characterPanel = page.getByTestId('text-open-world-character-panel')
  await expect(characterPanel).toBeVisible()
  await expect(characterPanel.getByRole('heading', { name: '来客', exact: true })).toBeVisible()
  await expect(characterPanel.getByTestId('text-open-world-character-progression')).toContainText('等级 1 / 20')
  await expect(characterPanel.getByRole('progressbar', { name: '等级经验进度 0%' })).toBeVisible()
  const characterAttributes = characterPanel.getByTestId('text-open-world-character-attributes')
  await expect(characterAttributes.locator('section')).toHaveCount(3)
  await expect(characterAttributes).toContainText('力量')
  await expect(characterAttributes).toContainText('体质')
  await expect(characterAttributes).toContainText('敏捷')
  const characterSkills = characterPanel.getByTestId('text-open-world-character-skills')
  await expect(characterSkills).toContainText('挥击')
  await expect(characterSkills).toContainText('主动技能 · 攻击 · 单个敌人')
  await expect(characterSkills).toContainText('技能条件就绪')
  await expect(characterSkills).toContainText('规则冷却')
  await expect(characterSkills).toContainText('当前冷却')
  await expect(characterSkills).toContainText('初始可掌握')
  const characterStatBreakdowns = characterPanel.locator(
    'details[data-testid="text-open-world-character-stat-breakdown"]',
  )
  await expect(characterStatBreakdowns).toHaveCount(6)
  await characterStatBreakdowns.first().getByText('展开查看数值来源', { exact: true }).click()
  await expect(characterStatBreakdowns.first()).toContainText('基础生命')
  await expect(characterPanel).not.toContainText(/(?:skill|condition|quest|status|effect)\./)
  await expect(characterPanel).not.toContainText('world-release:')
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')
  await expect(page.getByTestId('text-open-world-global-status')).toHaveText(globalStatusBeforeCharacter ?? '')
  const characterStateAfter = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
    const state = useTextOpenWorldPlayerStore.getState()
    return JSON.stringify({
      runtimeState: state.runtimeState,
      events: state.events,
      checkpoints: state.checkpoints,
      selectedSessionId: state.selectedSessionId,
    })
  })
  expect(characterStateAfter).toBe(characterStateBefore)

  await left.getByRole('button', { name: '更多', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'more')
  const inventoryPanel = page.getByTestId('text-open-world-inventory-panel')
  await expect(inventoryPanel).toBeVisible()
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-summary')).toContainText('种类4')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-summary')).toContainText('总数量4')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-summary')).toContainText('已装备0/3')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-summary')).toContainText('盐票20')
  await expect(inventoryPanel).not.toContainText(/(?:action|condition|effect|instance|item)\./)
  await expect(inventoryPanel).not.toContainText('world-release:')

  const inventoryStateBeforeUiOnly = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
    const state = useTextOpenWorldPlayerStore.getState()
    return JSON.stringify({ runtimeState: state.runtimeState, events: state.events })
  })
  const inventorySearch = inventoryPanel.getByRole('searchbox', { name: '搜索背包' })
  await inventorySearch.fill('守渠印')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-detail')).toContainText('关键物品受到保护')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-detail')).toContainText('不能出售')
  await inventoryPanel.getByRole('button', { name: '材料 1', exact: true }).click()
  await expect(inventoryPanel).toContainText('没有符合当前筛选的物品')
  await inventoryPanel.getByRole('button', { name: '清除筛选', exact: true }).click()
  await inventoryPanel.getByRole('combobox', { name: '背包排序' }).selectOption('base-value')
  const inventoryStateAfterUiOnly = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
    const state = useTextOpenWorldPlayerStore.getState()
    return JSON.stringify({ runtimeState: state.runtimeState, events: state.events })
  })
  expect(inventoryStateAfterUiOnly).toBe(inventoryStateBeforeUiOnly)

  await inventorySearch.fill('盐露药剂')
  const tonicDetail = inventoryPanel.getByTestId('text-open-world-inventory-detail')
  await expect(tonicDetail).toContainText('盐露药剂')
  await expect(tonicDetail.getByRole('button', { name: '使用盐露药剂', exact: true })).toBeDisabled()
  await expect(tonicDetail).toContainText('生命已经满了')

  await inventorySearch.fill('盐晶')
  const saltDetail = inventoryPanel.getByTestId('text-open-world-inventory-detail')
  await expect(saltDetail).toContainText('需前往商店交易')
  await saltDetail.getByRole('button', { name: '丢弃盐晶', exact: true }).click()
  const dropConfirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
  await expect(dropConfirmation).toBeVisible()
  await expect(dropConfirmation).toContainText('丢弃盐晶')
  await dropConfirmation.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(dropConfirmation).toBeHidden()
  await expect(inventoryPanel).toContainText('没有符合当前筛选的物品')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-feedback')).toContainText('丢弃盐晶')

  await inventoryPanel.getByRole('button', { name: '清除筛选', exact: true }).click()
  await inventoryPanel.getByRole('button', { name: '装备', exact: true }).click()
  const equipmentView = inventoryPanel.getByTestId('text-open-world-equipment-view')
  await expect(equipmentView.getByTestId('text-open-world-equipment-slot')).toHaveCount(3)
  const weaponSlot = equipmentView.getByLabel('武器候选装备')
  await expect(weaponSlot).toContainText('旧盐刀')
  await weaponSlot.getByText('查看装备后的旧值、新值与差值', { exact: true }).click()
  await expect(weaponSlot.locator('tr[data-change-direction="increase"]').filter({ hasText: '攻击' })).toContainText('+2')
  await weaponSlot.getByRole('button', { name: '装备旧盐刀', exact: true }).click()
  await expect(equipmentView.getByLabel('武器当前装备')).toContainText('旧盐刀')
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-summary')).toContainText('已装备1/3')

  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  const timelineBeforeConfirmation = await page.getByTestId('text-open-world-global-status').textContent()
  const riskyAction = page.locator('button').filter({ hasText: '偷取盐露药剂' }).first()
  const underlyingAction = page.locator('button').filter({ hasText: '休息' }).first()
  await riskyAction.focus()
  await riskyAction.click()
  const confirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmation.getByRole('button', { name: '确认执行' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused()
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
  const mobileMapList = mapPanel.getByRole('list', { name: '地图列表视图' })
  const mobileRidge = mobileMapList.getByRole('listitem').filter({ hasText: '断脊渠口' })
  await mobileRidge.getByRole('button', { name: /断脊渠口/ }).first().click()
  await mobileRidge.getByRole('button', { name: /^前往断脊渠口：/ }).click()
  await expect(page.getByTestId('text-open-world-global-status')).toContainText('地点断脊渠口', { timeout: 15_000 })
  const mobileSaltPort = mobileMapList.getByRole('listitem').filter({ hasText: '盐港广场' })
  await mobileSaltPort.getByRole('button', { name: /盐港广场/ }).first().click()
  await mobileSaltPort.getByRole('button', { name: /^快速旅行：前往盐港广场/ }).click()
  await expect(page.getByTestId('text-open-world-global-status')).toContainText('地点盐港广场', { timeout: 15_000 })
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'scene')

  await mobileNavigation.getByRole('button', { name: '角色', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'character')
  await expect(characterPanel).toBeVisible()
  const mobileCharacterColumns = await page.evaluate(() => {
    const box = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
      .getBoundingClientRect()
    const progression = box('text-open-world-character-progression')
    const resources = box('text-open-world-character-resources')
    const attributes = box('text-open-world-character-attributes')
    const derived = box('text-open-world-character-derived-stats')
    return {
      progression: { left: progression.left, right: progression.right, bottom: progression.bottom },
      resources: { left: resources.left, right: resources.right, top: resources.top },
      attributes: { left: attributes.left, right: attributes.right, bottom: attributes.bottom },
      derived: { left: derived.left, right: derived.right, top: derived.top },
    }
  })
  expect(Math.abs(mobileCharacterColumns.progression.left - mobileCharacterColumns.resources.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobileCharacterColumns.progression.right - mobileCharacterColumns.resources.right)).toBeLessThanOrEqual(1)
  expect(mobileCharacterColumns.resources.top).toBeGreaterThanOrEqual(mobileCharacterColumns.progression.bottom - 1)
  expect(Math.abs(mobileCharacterColumns.attributes.left - mobileCharacterColumns.derived.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobileCharacterColumns.attributes.right - mobileCharacterColumns.derived.right)).toBeLessThanOrEqual(1)
  expect(mobileCharacterColumns.derived.top).toBeGreaterThanOrEqual(mobileCharacterColumns.attributes.bottom - 1)
  const characterStatuses = characterPanel.getByTestId('text-open-world-character-statuses')
  await characterStatuses.scrollIntoViewIfNeeded()
  await expect(characterStatuses).toBeVisible()
  await expect(characterStatuses).toContainText('当前没有持续状态')

  await mobileNavigation.getByRole('button', { name: '更多', exact: true }).click()
  await expect(main).toHaveAttribute('data-open-world-view', 'more')
  await expect(inventoryPanel).toBeVisible()
  await inventoryPanel.getByRole('button', { name: '背包', exact: true }).click()
  await expect(inventoryPanel.getByTestId('text-open-world-inventory-list')).toBeVisible()
  const mobileInventoryColumns = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[aria-label="背包列表"]')!.getBoundingClientRect()
    const detail = document.querySelector<HTMLElement>('[data-testid="text-open-world-inventory-detail"]')!
      .getBoundingClientRect()
    return {
      list: { left: list.left, right: list.right, bottom: list.bottom },
      detail: { left: detail.left, right: detail.right, top: detail.top },
    }
  })
  expect(Math.abs(mobileInventoryColumns.list.left - mobileInventoryColumns.detail.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobileInventoryColumns.list.right - mobileInventoryColumns.detail.right)).toBeLessThanOrEqual(1)
  expect(mobileInventoryColumns.detail.top).toBeGreaterThanOrEqual(mobileInventoryColumns.list.bottom - 1)

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
