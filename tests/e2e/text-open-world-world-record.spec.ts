import { expect, test, type Page } from '@playwright/test'

const READ_RUMOR = '有人说旧渠门会在盐雾中发出钟声。'
const UNREAD_RUMOR = '这条没有读过的传闻绝不能出现。'
const HIDDEN_FACT_TITLE = '绝不能提前出现的渠门真相'
const HIDDEN_FACT_BODY = '绝不能提前出现的事实正文。'
const HIDDEN_LORE_TITLE = '绝不能出现的隐藏知识'
const HIDDEN_ACHIEVEMENT_TITLE = '绝不能出现的隐藏成就'
const HIDDEN_ACHIEVEMENT_BODY = '绝不能出现的隐藏成就条件描述。'

async function openFormalSession(page: Page, title: string) {
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: title }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 20_000 })
}

async function openDesktopWorldRecord(page: Page) {
  await page.getByTestId('text-open-world-navigation-rail')
    .getByRole('button', { name: '更多', exact: true })
    .click()
  const panel = page.getByTestId('text-open-world-world-record-panel')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  return panel
}

test('世界记录在桌面与390px只披露亲历内容，并从持久Session重建', async ({ page }) => {
  test.setTimeout(210_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-world-record-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextFixture },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
    ])
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const knowledge = textOpenWorldVNext.modules.knowledge.payload as any
    const director = textOpenWorldVNext.modules.director.payload as any

    knowledge.entries.push({
      key: 'knowledge.secret-channel',
      kind: 'quest-clue',
      title: input.hiddenFactTitle,
      content: input.hiddenFactBody,
      sourceRefs: ['world-release:secret-canary'],
      initialPlayerVisibility: 'hidden',
      actorKeys: [],
    }, {
      key: 'knowledge.hidden-lore',
      kind: 'lore',
      title: input.hiddenLoreTitle,
      content: '这项内容在当前Session中始终没有揭示。',
      sourceRefs: ['world-release:hidden-lore'],
      initialPlayerVisibility: 'hidden',
      actorKeys: [],
    })
    knowledge.rumors.push({
      key: 'rumor.secret-channel.read',
      knowledgeKey: 'knowledge.secret-channel',
      text: input.readRumor,
      reliability: 'uncertain',
    }, {
      key: 'rumor.secret-channel.unread',
      knowledgeKey: 'knowledge.secret-channel',
      text: input.unreadRumor,
      reliability: 'confirmed',
    })
    knowledge.achievements.push({
      key: 'achievement.hidden-future',
      title: input.hiddenAchievementTitle,
      description: input.hiddenAchievementBody,
      conditionKeys: ['condition.level-two'],
    })

    // Keep the action and deterministic Director path real, while removing
    // fixture-only random ambiguity: talking can draw only this rumor event.
    director.decks[0].templateKeys = []
    director.decks[0].blankWeight = 0
    director.randomEvents[0].rumorKey = 'rumor.secret-channel.read'

    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器世界记录验收',
      textOpenWorldVNext,
      runtimeShape: 'vnext-only',
      title: '盐脊世界记录存档',
      seed: 'browser-open-world-world-record',
    })
    return { sessionId: created.session.id, title: created.session.title }
  }, {
    readRumor: READ_RUMOR,
    unreadRumor: UNREAD_RUMOR,
    hiddenFactTitle: HIDDEN_FACT_TITLE,
    hiddenFactBody: HIDDEN_FACT_BODY,
    hiddenLoreTitle: HIDDEN_LORE_TITLE,
    hiddenAchievementTitle: HIDDEN_ACHIEVEMENT_TITLE,
    hiddenAchievementBody: HIDDEN_ACHIEVEMENT_BODY,
  })

  await page.reload()
  await openFormalSession(page, seeded.title)

  const talkAction = page.getByTestId('text-open-world-system-actions')
    .getByRole('button', { name: /与岑阿婆交谈/ })
  await expect(talkAction).toBeVisible()
  await talkAction.click()
  await expect.poll(async () => page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runtime = await readProductRuntimeState(sessionId)
    return {
      readRumorKeys: runtime.textOpenWorld?.state.knowledge.readRumorKeys ?? [],
      earnedAchievementKeys: runtime.textOpenWorld?.state.knowledge.earnedAchievementKeys ?? [],
    }
  }, seeded.sessionId)).toEqual({
    readRumorKeys: ['rumor.secret-channel.read'],
    earnedAchievementKeys: ['achievement.first-clue'],
  })

  let panel = await openDesktopWorldRecord(page)
  const tablist = panel.getByRole('tablist', { name: '世界记录分类' })
  await expect(tablist.getByRole('tab')).toHaveText(['关系', '百科', '传闻', '历程', '成就'])
  await expect(tablist.getByRole('tab', { name: '关系', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel).toContainText('岑阿婆')

  await tablist.getByRole('tab', { name: '关系', exact: true }).focus()
  await page.keyboard.press('End')
  await expect(tablist.getByRole('tab', { name: '成就', exact: true })).toBeFocused()
  await expect(tablist.getByRole('tab', { name: '成就', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(panel).toContainText('已获得 1 / 2')
  await expect(panel).toContainText('另有 1 项尚未解锁')
  await expect(panel).toContainText('第一道水痕')
  await expect(panel).not.toContainText(HIDDEN_ACHIEVEMENT_TITLE)
  await expect(panel).not.toContainText(HIDDEN_ACHIEVEMENT_BODY)

  await page.keyboard.press('Home')
  await expect(tablist.getByRole('tab', { name: '关系', exact: true })).toBeFocused()
  await tablist.getByRole('tab', { name: '百科', exact: true }).click()
  await expect(panel).toContainText('老守渠人')
  await expect(panel).not.toContainText(HIDDEN_FACT_TITLE)
  await expect(panel).not.toContainText(HIDDEN_FACT_BODY)
  await expect(panel).not.toContainText(HIDDEN_LORE_TITLE)

  await tablist.getByRole('tab', { name: '传闻', exact: true }).click()
  await expect(panel).toContainText(READ_RUMOR)
  await expect(panel).toContainText('关联事实尚待核实')
  await expect(panel).not.toContainText(UNREAD_RUMOR)
  await expect(panel).not.toContainText(HIDDEN_FACT_TITLE)
  await expect(panel).not.toContainText(HIDDEN_FACT_BODY)

  await tablist.getByRole('tab', { name: '历程', exact: true }).click()
  await expect(panel).toContainText('经历随机事件：渠边传闻')
  await expect(panel).toContainText('听闻一则传闻')
  await expect(panel).toContainText(READ_RUMOR)
  await expect(panel).not.toContainText(UNREAD_RUMOR)
  await expect(panel).not.toContainText(HIDDEN_FACT_BODY)

  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileNavigation = page.getByTestId('text-open-world-mobile-navigation')
  await expect(mobileNavigation).toBeVisible()
  await mobileNavigation.getByRole('button', { name: '更多', exact: true }).click()
  panel = page.getByTestId('text-open-world-world-record-panel')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  const mobileTabs = panel.getByRole('tablist', { name: '世界记录分类' })
  for (const label of ['关系', '百科', '传闻', '历程', '成就']) {
    await expect(mobileTabs.getByRole('tab', { name: label, exact: true })).toBeVisible()
  }
  await mobileTabs.getByRole('tab', { name: '传闻', exact: true }).click()
  await expect(panel).toContainText(READ_RUMOR)
  await expect(panel).not.toContainText(UNREAD_RUMOR)
  await mobileTabs.getByRole('tab', { name: '成就', exact: true }).click()
  await expect(panel).toContainText('第一道水痕')
  await expect(panel).not.toContainText(HIDDEN_ACHIEVEMENT_TITLE)
  expect(await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))).toEqual({ viewportWidth: 390, documentWidth: 390 })

  // A full app reload drops the in-memory Zustand projection. Reopening the
  // formal save must rebuild the exact disclosure state from durable events.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await openFormalSession(page, seeded.title)
  panel = await openDesktopWorldRecord(page)
  const restoredTabs = panel.getByRole('tablist', { name: '世界记录分类' })
  await restoredTabs.getByRole('tab', { name: '传闻', exact: true }).click()
  await expect(panel).toContainText(READ_RUMOR)
  await expect(panel).not.toContainText(UNREAD_RUMOR)
  await expect(panel).not.toContainText(HIDDEN_FACT_BODY)
  await restoredTabs.getByRole('tab', { name: '成就', exact: true }).click()
  await expect(panel).toContainText('已获得 1 / 2')
  await expect(panel).toContainText('第一道水痕')
  await expect(panel).not.toContainText(HIDDEN_ACHIEVEMENT_TITLE)

  const persisted = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { readProductRuntimeState }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product/runtime-core.ts'),
    ])
    const runtime = await readProductRuntimeState(sessionId)
    return {
      lastSequence: runtime.lastSequence,
      readRumorKeys: runtime.textOpenWorld.state.knowledge.readRumorKeys,
      earnedAchievementKeys: runtime.textOpenWorld.state.knowledge.earnedAchievementKeys,
      eventCount: await db.productRuntimeEvents.where('sessionId').equals(sessionId).count(),
    }
  }, seeded.sessionId)
  expect(persisted.lastSequence).toBeGreaterThan(0)
  expect(persisted.eventCount).toBe(persisted.lastSequence)
  expect(persisted.readRumorKeys).toEqual(['rumor.secret-channel.read'])
  expect(persisted.earnedAchievementKeys).toEqual(['achievement.first-clue'])
})
