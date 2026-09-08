import { expect, test } from '@playwright/test'

test('玩家在正式存档完成买材料、制作药剂与卖出产物的同一经济闭环', async ({ page }) => {
  test.setTimeout(210_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-crafting-economy-e2e')
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
      name: '浏览器制作与经济验收',
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊制作与交易存档',
      seed: 'browser-open-world-crafting-economy',
    })
    return { sessionId: created.session.id, title: created.session.title }
  })

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()

  await page.getByTestId('text-open-world-navigation-rail')
    .getByRole('button', { name: '更多', exact: true })
    .click()
  const panel = page.getByTestId('text-open-world-crafting-economy-panel')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  const currencyCard = panel.getByText('持有盐票', { exact: true }).locator('..')
  await expect(currencyCard).toContainText('20')

  const recipe = panel.getByTestId('text-open-world-recipe-option').filter({ hasText: '盐露药剂' })
  await expect(recipe).toContainText('不可用')
  const recipeDetail = panel.getByTestId('text-open-world-recipe-detail')
  await expect(recipeDetail).toContainText('需要 2 / 库存 0')
  await expect(panel.getByTestId('text-open-world-craft-submit')).toBeDisabled()

  await panel.getByTestId('text-open-world-shop-tab').click()
  await expect(panel.getByTestId('text-open-world-buy-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByLabel('买入价格说明')).toContainText('关系')
  const saltToBuy = panel.getByTestId('text-open-world-trade-item-option').filter({ hasText: '盐晶' })
  await saltToBuy.click()
  const buyDetail = panel.getByTestId('text-open-world-trade-detail')
  await expect(buyDetail).toContainText('单价')
  await expect(buyDetail).toContainText('2 盐票')
  await expect(buyDetail).toContainText('本次数量上限')
  await expect(buyDetail).toContainText('3')
  await buyDetail.getByRole('spinbutton', { name: '买入数量' }).fill('2')
  await expect(buyDetail).toContainText('4 盐票')
  await buyDetail.getByTestId('text-open-world-trade-submit').click()
  let confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('确认买入“盐晶”')
  await expect(confirmation).toContainText('数量：2')
  await expect(confirmation).toContainText('总价：4 盐票')
  const buyIdentity = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { useTextOpenWorldPlayerStore },
      { projectTextOpenWorldPlayerCraftingEconomyV1 },
    ] = await Promise.all([
      importer('/storyforge/src/stores/text-open-world-player.ts'),
      importer('/storyforge/src/lib/open-world/player-crafting-economy.ts'),
    ])
    const state = useTextOpenWorldPlayerStore.getState()
    const projection = state.runtimeState.textOpenWorld
    return {
      requestedSessionId: sessionId,
      selectedSessionId: state.selectedSessionId,
      selectedSessionRowId: state.selectedSession?.id ?? null,
      runtimeSequence: state.runtimeState.lastSequence,
      projectionSequence: projection?.lastEventSequence ?? null,
      screenSequence: projection
        ? projectTextOpenWorldPlayerCraftingEconomyV1({
            sessionId,
            projection,
            runtimeEventSequence: state.runtimeState.lastSequence,
          })
          .operationIdentity.expectedBaseSequence
        : null,
    }
  }, seeded.sessionId)
  expect(buyIdentity).toMatchObject({
    requestedSessionId: seeded.sessionId,
    selectedSessionId: seeded.sessionId,
    selectedSessionRowId: seeded.sessionId,
    projectionSequence: 0,
  })
  expect(buyIdentity.screenSequence).toBe(buyIdentity.runtimeSequence)
  expect(buyIdentity.runtimeSequence).toBeGreaterThan(buyIdentity.projectionSequence ?? -1)
  await confirmation.getByTestId('text-open-world-crafting-economy-confirm-submit').click()
  const feedback = panel.getByTestId('text-open-world-crafting-economy-feedback')
  await expect(feedback).toContainText('已完成', { timeout: 30_000 })
  await expect(currencyCard).toContainText('16')
  await expect(buyDetail).toContainText('玩家库存')
  await expect(buyDetail).toContainText('2')
  await expect(buyDetail).toContainText('商店库存')
  await expect(buyDetail).toContainText('1')

  await panel.getByTestId('text-open-world-crafting-tab').click()
  await expect(recipe).toContainText('可制作')
  await expect(recipeDetail).toContainText('需要 2 / 库存 2')
  await expect(recipeDetail).toContainText('耗时 15 分钟')
  await recipeDetail.getByRole('spinbutton', { name: '制作数量' }).fill('1')
  await recipeDetail.getByTestId('text-open-world-craft-submit').click()
  confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('确认制作“盐露药剂”')
  await expect(confirmation).toContainText('材料：盐晶 ×2')
  await expect(confirmation).toContainText('产物：盐露药剂 ×1')
  await expect(confirmation).toContainText('耗时：15 分钟')
  await confirmation.getByTestId('text-open-world-crafting-economy-confirm-submit').click()
  await expect(feedback).toContainText('已完成', { timeout: 30_000 })
  await expect(recipe).toContainText('不可用')
  await expect(recipeDetail).toContainText('需要 2 / 库存 0')

  await panel.getByTestId('text-open-world-shop-tab').click()
  await panel.getByTestId('text-open-world-sell-tab').click()
  await expect(panel.getByTestId('text-open-world-sell-tab')).toHaveAttribute('aria-selected', 'true')
  const tonicToSell = panel.getByTestId('text-open-world-trade-item-option').filter({ hasText: '盐露药剂' })
  await tonicToSell.click()
  const sellDetail = panel.getByTestId('text-open-world-trade-detail')
  await expect(sellDetail).toContainText('4 盐票')
  await expect(sellDetail).toContainText('玩家库存')
  await expect(sellDetail).toContainText('1')
  await sellDetail.getByRole('spinbutton', { name: '卖出数量' }).fill('1')
  await sellDetail.getByTestId('text-open-world-trade-submit').click()
  confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toContainText('确认卖出“盐露药剂”')
  await expect(confirmation).toContainText('总价：4 盐票')
  await confirmation.getByTestId('text-open-world-crafting-economy-confirm-submit').click()
  await expect(feedback).toContainText('已完成', { timeout: 30_000 })
  await expect(currencyCard).toContainText('20')

  const persisted = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { readProductRuntimeState }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product/runtime-core.ts'),
    ])
    const runtime = await readProductRuntimeState(sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const commands = events
      .filter((event: { type: string }) => event.type === 'text-open-world.command.committed')
      .map((event: { payloadJson: string }) => JSON.parse(event.payloadJson).envelope)
      .filter((envelope: { actorKey: string }) => envelope.actorKey === 'player')
      .map((envelope: { actionKey: string; payload: Record<string, unknown> }) => ({
        actionKey: envelope.actionKey,
        payload: envelope.payload,
      }))
    const state = runtime.textOpenWorld.state
    return {
      currency: state.inventory.currency,
      saltCrystalQuantity: state.inventory.stackQuantities['item.salt-crystal'] ?? 0,
      brineTonicQuantity: state.inventory.stackQuantities['item.brine-tonic'] ?? 0,
      worldMinute: state.time.worldMinute,
      commands,
    }
  }, seeded.sessionId)
  expect(persisted).toMatchObject({
    currency: 20,
    saltCrystalQuantity: 0,
    brineTonicQuantity: 0,
    worldMinute: 495,
    commands: [
      {
        actionKey: 'action.buy-caretaker',
        payload: { targetKey: 'vendor.caretaker', quantity: 2, itemKey: 'item.salt-crystal' },
      },
      {
        actionKey: 'action.craft-brine-tonic',
        payload: { targetKey: 'recipe.brine-tonic', quantity: 1 },
      },
      {
        actionKey: 'action.sell-caretaker',
        payload: { targetKey: 'vendor.caretaker', quantity: 1, itemKey: 'item.brine-tonic' },
      },
    ],
  })
})
