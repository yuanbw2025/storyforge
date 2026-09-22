import { expect, test } from '@playwright/test'

test('玩家从正式存档进入双敌战斗，显式选敌并完成四类操作与逃跑结算', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-combat-e2e')
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
    const combat = textOpenWorldVNext.modules.combat.payload as {
      encounters: Array<{
        key: string
        locationKey: string
        enemyGroups: Array<{ count: number }>
      }>
    }
    const actions = textOpenWorldVNext.modules.actions.payload as {
      actions: Array<{ key: string; locationKeys: string[] }>
    }
    actors.player.build.startingItemKeys.push('item.brine-tonic')
    const encounter = combat.encounters.find(candidate => candidate.key === 'encounter.ridge-jackal')!
    encounter.locationKey = 'location.salt-port'
    encounter.enemyGroups[0]!.count = 2
    actions.actions.find(candidate => candidate.key === 'action.start-ridge-jackal')!.locationKeys = [
      'location.salt-port',
    ]
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器战斗交互验收',
      textOpenWorldVNext,
      runtimeShape: 'vnext-only',
      title: '盐脊双敌战斗存档',
      seed: 'browser-open-world-combat',
    })
    return { projectId: created.scope.projectId, sessionId: created.session.id, title: created.session.title }
  })

  await page.goto(`./openworld/runtime?project=${seeded.projectId}&mode=play`)
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()

  await page.getByTestId('text-open-world-system-actions')
    .getByRole('button', { name: /迎战盐鬣犬/ })
    .click()
  const panel = page.getByTestId('text-open-world-combat-panel')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(panel).toContainText('战斗进行中')
  expect(await panel.locator('[data-action-group]').evaluateAll(nodes => (
    nodes.map(node => node.getAttribute('data-action-group'))
  ))).toEqual(['attack', 'skill', 'item', 'escape'])

  const targets = panel.getByRole('radio')
  await expect(targets).toHaveCount(2)
  const basicAttack = panel.getByRole('button', { name: /普通攻击/ })
  await expect(basicAttack).toBeDisabled()
  await expect(panel).toContainText('请先选择一名仍可行动的敌人')
  const secondTarget = panel.getByRole('radio', { name: /盐鬣犬 2/ })
  await secondTarget.check()
  await expect(basicAttack).toBeEnabled()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel).toBeVisible()
  expect(await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))).toEqual({ viewportWidth: 390, documentWidth: 390 })

  await panel.getByRole('button', { name: /重击/ }).click()
  const combatLog = panel.locator('[aria-label="本场战斗记录"]')
  await expect(combatLog).toContainText('来客使用重击', { timeout: 30_000 })

  const combatItem = panel.getByRole('button', { name: /使用盐露药剂/ })
  await expect(combatItem).toBeEnabled({ timeout: 30_000 })
  await combatItem.click()
  await expect(secondTarget).toBeEnabled({ timeout: 60_000 })
  await secondTarget.check()
  await expect(panel.getByRole('button', { name: /普通攻击/ })).toBeEnabled({ timeout: 60_000 })
  await panel.getByRole('button', { name: /普通攻击/ }).click()

  const escape = panel.getByRole('button', { name: /逃跑/ })
  await expect(page.getByTestId('text-open-world-shell')).not.toHaveAttribute(
    'aria-busy',
    'true',
    { timeout: 120_000 },
  )
  await expect(escape).toBeEnabled({ timeout: 20_000 })
  await escape.click()
  const result = page.getByTestId('text-open-world-combat-result')
  await expect(result).toContainText('已经脱离战斗', { timeout: 30_000 })
  await expect(result.getByRole('button', { name: '返回当前场景', exact: true })).toBeEnabled()

  const playerActionKeys = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    return events
      .filter((event: { type: string }) => event.type === 'text-open-world.command.committed')
      .map((event: { payloadJson: string }) => JSON.parse(event.payloadJson).envelope)
      .filter((envelope: { actorKey: string }) => envelope.actorKey === 'player')
      .map((envelope: { actionKey: string }) => envelope.actionKey)
  }, seeded.sessionId)
  expect(playerActionKeys).toEqual(expect.arrayContaining([
    'action.start-ridge-jackal',
    'action.combat-power-strike',
    'action.combat-brine-tonic',
    'action.combat-basic-attack',
    'action.combat-escape',
  ]))
})
