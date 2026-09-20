import { expect, test, type Page } from '@playwright/test'

interface JourneySnapshot {
  sessionStatus: string
  productReleaseId: number | null
  productBuildId: number | null
  lastSequence: number
  runtimeStateJson: string
  reachedEndingKey: string | null
  finalQuestStatus: string | null
  finalQuestRewardClaimKey: string | null
  eventLedger: Array<{
    sequence: number
    type: string
    commandId: string | null
    payloadJson: string
  }>
  checkpointLedger: Array<{
    throughSequence: number
    purpose: string | null
    name: string
    stateHash: string
  }>
  playerActionKeys: string[]
}

async function openTextOpenWorldLibrary(page: Page) {
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  await expect(page.getByTestId('text-open-world-player')).toBeVisible({ timeout: 20_000 })
}

async function openMoreView(page: Page) {
  await page.getByTestId('text-open-world-navigation-rail')
    .getByRole('button', { name: '更多', exact: true })
    .click()
  await expect(page.getByTestId('text-open-world-main-view'))
    .toHaveAttribute('data-open-world-view', 'more')
}

async function returnToCurrentScene(page: Page) {
  await page.getByRole('button', { name: '返回当前场景', exact: true }).click()
  await expect(page.getByTestId('text-open-world-main-view'))
    .toHaveAttribute('data-open-world-view', 'scene')
}

async function readJourneySnapshot(page: Page, sessionId: number): Promise<JourneySnapshot> {
  return page.evaluate(async id => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { readProductRuntimeState }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product/runtime-core.ts'),
    ])
    const [session, runtime, events, checkpoints] = await Promise.all([
      db.productRuntimeSessions.get(id),
      readProductRuntimeState(id),
      db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence'),
      db.productRuntimeCheckpoints.where('sessionId').equals(id).sortBy('throughSequence'),
    ])
    if (!session || !runtime.textOpenWorld) throw new Error('完整旅程 Session 不存在或不是 vNext')
    const finalQuest = Object.values(runtime.textOpenWorld.state.quests.instancesByKey)
      .find((instance: any) => instance.definitionKey === 'quest.main.1') as any
    const playerActionKeys = events
      .filter((event: any) => event.type === 'text-open-world.command.committed')
      .map((event: any) => JSON.parse(event.payloadJson).envelope)
      .filter((envelope: any) => envelope.actorKey === 'player')
      .map((envelope: any) => envelope.actionKey)
    return {
      sessionStatus: session.status,
      productReleaseId: session.productReleaseId ?? null,
      productBuildId: session.productBuildId ?? null,
      lastSequence: runtime.lastSequence,
      runtimeStateJson: JSON.stringify(runtime),
      reachedEndingKey: runtime.textOpenWorld.state.endings.reachedKey,
      finalQuestStatus: finalQuest?.status ?? null,
      finalQuestRewardClaimKey: finalQuest?.rewardClaimKey ?? null,
      eventLedger: events.map((event: any) => ({
        sequence: event.sequence,
        type: event.type,
        commandId: event.commandId ?? null,
        payloadJson: event.payloadJson,
      })),
      checkpointLedger: checkpoints.map((checkpoint: any) => ({
        throughSequence: checkpoint.throughSequence,
        purpose: checkpoint.purpose ?? null,
        name: checkpoint.name,
        stateHash: checkpoint.stateHash,
      })),
      playerActionKeys,
    }
  }, sessionId)
}

test('玩家从正式 Release 目录走完整旅程，并在结局刷新后保留可读且可分支的时间线', async ({ page }) => {
  test.setTimeout(720_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-complete-journey-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')

  let releaseId = 0
  let gameTitle = ''
  let sessionId = 0
  let sessionTitle = ''
  let terminalSnapshot: JourneySnapshot | null = null

  await test.step('只预置经过正式 parser 的不可变 Release，不预建玩家 Session', async () => {
    const seeded = await page.evaluate(async () => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const [
        { createGovernedTextOpenWorldReleaseFixtureV1 },
        { createTextOpenWorldPlayerJourneyFixtureV1 },
      ] = await Promise.all([
        importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
        importer('/storyforge/tests/helpers/text-open-world-player-journey-fixture.ts'),
      ])
      const fixture = await createTextOpenWorldPlayerJourneyFixtureV1()
      const created = await createGovernedTextOpenWorldReleaseFixtureV1({
        name: '浏览器完整旅程验收',
        textOpenWorldVNext: fixture.runtimePackage,
        runtimeShape: 'vnext-only',
      })
      return {
        releaseId: created.release.id as number,
        gameTitle: fixture.runtimePackage.metadata.title,
        packageHash: fixture.packageHash,
      }
    })
    releaseId = seeded.releaseId
    gameTitle = seeded.gameTitle
    expect(releaseId).toBeGreaterThan(0)
    expect(seeded.packageHash).toMatch(/^[a-f0-9]{64}$/)
  })

  await test.step('从正式发布物目录查看游戏并创建新旅程', async () => {
    await page.reload()
    await openTextOpenWorldLibrary(page)
    await page.getByRole('button', { name: `查看游戏：${gameTitle}`, exact: true }).click()
    const detail = page.getByRole('region', { name: '文字开放世界游戏详情' })
    await expect(detail).toContainText('Release v1')
    await detail.getByRole('button', { name: '新旅程', exact: true }).click()
    await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('text-open-world-runtime-source'))
      .toContainText('PRODUCT RELEASE v1 · 已固定')
    const createdSession = await page.evaluate(async () => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
      const state = useTextOpenWorldPlayerStore.getState()
      return { id: state.selectedSession?.id ?? 0, title: state.selectedSession?.title ?? '' }
    })
    sessionId = createdSession.id
    sessionTitle = createdSession.title
    expect(sessionId).toBeGreaterThan(0)
    expect(sessionTitle).toBe(`${gameTitle} · 新旅程`)
    const source = await page.evaluate(async id => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { db } = await importer('/storyforge/src/lib/db/schema.ts')
      const session = await db.productRuntimeSessions.get(id)
      return { releaseId: session?.productReleaseId ?? null, buildId: session?.productBuildId ?? null }
    }, sessionId)
    expect(source).toEqual({ releaseId, buildId: null })
  })

  await test.step('经过开场、接取、调查、提交与正式奖励结算', async () => {
    const published = page.getByTestId('text-open-world-published-scene')
    const fixedChoices = page.getByTestId('text-open-world-fixed-choices')
    await expect(published).toContainText('干涸的内渠')
    await fixedChoices.getByRole('button', { name: /^接下盐渠委托/ }).click()
    await expect(published).toContainText('盐壳下的水痕', { timeout: 30_000 })
    await fixedChoices.getByRole('button', { name: /^俯身检查渠壁/ }).click()
    await expect(page.getByTestId('text-open-world-feedback')).toBeVisible({ timeout: 30_000 })
    await fixedChoices.getByRole('button', { name: /^提交盐渠检查结果/ }).click()
    await expect(published).toContainText('盐渠阶段收束', { timeout: 30_000 })
    await fixedChoices.getByRole('button', { name: /^收下守渠印/ }).click()
    await expect(fixedChoices.getByRole('button', { name: /^选择共管盐渠/ }))
      .toBeVisible({ timeout: 30_000 })
    await expect(fixedChoices.getByRole('button', { name: /^选择港口控渠/ })).toBeVisible()
    await expect(fixedChoices.getByRole('button', { name: /^收下守渠印/ })).toHaveCount(0)
  })

  await test.step('通过地图普通旅行进入断脊并完成确定性一击战斗', async () => {
    await page.getByTestId('text-open-world-navigation-rail')
      .getByRole('button', { name: '地图', exact: true })
      .click()
    const map = page.getByTestId('text-open-world-map-topology')
    const mapSvg = page.getByTestId('text-open-world-map-svg')
    await mapSvg.getByRole('button', { name: /查看地点：断脊渠口/ }).click()
    await map.getByLabel('选中地点详情')
      .getByRole('button', { name: /^前往断脊渠口：/ })
      .click()
    await expect(page.getByTestId('text-open-world-global-status'))
      .toContainText('地点断脊渠口', { timeout: 30_000 })
    await expect(map.getByTestId('text-open-world-map-feedback')).toBeVisible()
    await returnToCurrentScene(page)

    await page.getByTestId('text-open-world-system-actions')
      .getByRole('button', { name: /迎战盐鬣犬/ })
      .click()
    const combat = page.getByTestId('text-open-world-combat-panel')
    await expect(combat).toContainText('战斗进行中', { timeout: 90_000 })
    await combat.getByRole('radio', { name: /盐鬣犬/ }).check()
    const attack = combat.getByRole('button', { name: /普通攻击/ })
    await expect(attack).toBeEnabled({ timeout: 60_000 })
    await attack.click()
    const result = page.getByTestId('text-open-world-combat-result')
    await expect(result).toContainText('通向断流点的道路恢复安静', { timeout: 60_000 })
    await expect(result).toContainText('渠口伏兽奖励')
    await expect(result).toContainText('经验 +100')
    await result.getByRole('button', { name: '返回当前场景', exact: true }).click()
  })

  await test.step('读取成长结果，并从已解锁快旅点返回盐港', async () => {
    const navigation = page.getByTestId('text-open-world-navigation-rail')
    await navigation.getByRole('button', { name: '角色', exact: true }).click()
    await expect(page.getByTestId('text-open-world-character-progression'))
      .toContainText('等级 2 / 20')
    await returnToCurrentScene(page)

    await navigation.getByRole('button', { name: '地图', exact: true }).click()
    const map = page.getByTestId('text-open-world-map-topology')
    await map.getByRole('button', { name: '查看快旅路线', exact: true }).click()
    await map.getByLabel('选中地点详情')
      .getByRole('button', { name: /^快速旅行：前往盐港广场/ })
      .click()
    await expect(page.getByTestId('text-open-world-global-status'))
      .toContainText('地点盐港广场', { timeout: 90_000 })
    await returnToCurrentScene(page)
  })

  await test.step('在商店购买材料、制作药剂，并保存结局前手动检查点', async () => {
    await openMoreView(page)
    const economy = page.getByTestId('text-open-world-crafting-economy-panel')
    await expect(economy).toBeVisible({ timeout: 20_000 })
    await economy.getByTestId('text-open-world-shop-tab').click()
    await economy.getByTestId('text-open-world-trade-item-option').filter({ hasText: '盐晶' }).click()
    const detail = economy.getByTestId('text-open-world-trade-detail')
    await detail.getByRole('spinbutton', { name: '买入数量' }).fill('2')
    await detail.getByTestId('text-open-world-trade-submit').click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('确认买入“盐晶”')
    await confirmation.getByTestId('text-open-world-crafting-economy-confirm-submit').click()
    await expect(economy.getByTestId('text-open-world-crafting-economy-feedback'))
      .toContainText('购买商品已完成', { timeout: 60_000 })

    await economy.getByTestId('text-open-world-crafting-tab').click()
    const recipe = economy.getByTestId('text-open-world-recipe-option').filter({ hasText: '盐露药剂' })
    await expect(recipe).toContainText('可制作')
    await recipe.click()
    const recipeDetail = economy.getByTestId('text-open-world-recipe-detail')
    await recipeDetail.getByRole('spinbutton', { name: '制作数量' }).fill('1')
    await recipeDetail.getByTestId('text-open-world-craft-submit').click()
    const craftConfirmation = page.getByRole('alertdialog')
    await expect(craftConfirmation).toContainText('确认制作“盐露药剂”')
    await craftConfirmation.getByTestId('text-open-world-crafting-economy-confirm-submit').click()
    await expect(economy.getByTestId('text-open-world-crafting-economy-feedback'))
      .toContainText('制作盐露药剂已完成', { timeout: 60_000 })

    const inventory = page.getByTestId('text-open-world-inventory-panel')
    await inventory.scrollIntoViewIfNeeded()
    await inventory.getByRole('searchbox', { name: '搜索背包' }).fill('盐露药剂')
    const tonicDetail = inventory.getByTestId('text-open-world-inventory-detail')
    await expect(tonicDetail).toContainText('盐露药剂')
    await expect(tonicDetail.getByText('持有数量', { exact: true }).locator('..')).toContainText('1')

    const saves = page.getByTestId('text-open-world-save-settings')
    await saves.scrollIntoViewIfNeeded()
    await saves.getByLabel('为当前进度命名').fill('终局前检查点')
    await saves.getByRole('button', { name: '保存当前进度', exact: true }).click()
    const manualSave = saves.locator('[data-save-purpose="manual"] article')
      .filter({ hasText: '终局前检查点' })
    await expect(manualSave).toBeVisible({ timeout: 60_000 })
    await expect(manualSave.getByLabel('可读取')).toBeVisible()
  })

  await test.step('选择唯一终局路线并等待 Session 完成收束', async () => {
    await returnToCurrentScene(page)
    await page.getByTestId('text-open-world-fixed-choices')
      .getByRole('button', { name: /^选择共管盐渠/ })
      .click()
    const confirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
    await expect(confirmation).toContainText('选择共管盐渠')
    await confirmation.getByRole('button', { name: '确认执行', exact: true }).click()

    const ending = page.getByTestId('text-open-world-ending-panel')
    await expect(ending).toHaveAttribute('data-ending-phase', 'completed', { timeout: 60_000 })
    await expect(ending).toContainText('旅程完成')
    await expect(ending).toContainText('共管盐渠')
    await expect(ending).toContainText('时间线已保存')
    await expect(page.getByTestId('text-open-world-journey-status')).toContainText('已完成')

    terminalSnapshot = await readJourneySnapshot(page, sessionId)
    expect(terminalSnapshot).toMatchObject({
      sessionStatus: 'completed',
      productReleaseId: releaseId,
      productBuildId: null,
      reachedEndingKey: 'ending.cooperate',
      finalQuestStatus: 'completed',
    })
    expect(terminalSnapshot.finalQuestRewardClaimKey).toBeTruthy()
    expect(terminalSnapshot.playerActionKeys).toEqual(expect.arrayContaining([
      'action.accept-main',
      'action.investigate-channel',
      'action.complete-main-objective',
      'action.claim-main-reward',
      'action.travel-port-ridge',
      'action.start-ridge-jackal',
      'action.combat-basic-attack',
      'action.fast-travel',
      'action.buy-caretaker',
      'action.craft-brine-tonic',
      'action.ending.ending.cooperate',
    ]))
    expect(terminalSnapshot.playerActionKeys).not.toContain('action.ending.ending.control')
  })

  await test.step('刷新后从正式存档目录重开同一已完成时间线，事件与状态不漂移', async () => {
    if (!terminalSnapshot) throw new Error('缺少刷新前终局快照')
    await page.getByRole('button', { name: '退出游戏', exact: true }).click()
    let formalSaves = page.getByRole('region', { name: '正式存档' })
    let completedSave = formalSaves.locator('.open-world-save-open').filter({ hasText: sessionTitle })
    await expect(completedSave).toContainText('已完成', { timeout: 30_000 })
    await completedSave.click()
    await expect(page.getByTestId('text-open-world-ending-panel'))
      .toHaveAttribute('data-ending-phase', 'completed', { timeout: 30_000 })

    await page.reload()
    await openTextOpenWorldLibrary(page)
    formalSaves = page.getByRole('region', { name: '正式存档' })
    completedSave = formalSaves.locator('.open-world-save-open').filter({ hasText: sessionTitle })
    await expect(completedSave).toContainText('已完成', { timeout: 30_000 })
    await completedSave.click()
    const ending = page.getByTestId('text-open-world-ending-panel')
    await expect(ending).toHaveAttribute('data-ending-phase', 'completed', { timeout: 30_000 })
    await expect(ending).toContainText('共管盐渠')

    const restored = await readJourneySnapshot(page, sessionId)
    expect(restored).toEqual(terminalSnapshot)
  })

  await test.step('终局当前分支不可复制，但结局前可读检查点能够派生新时间线并走完第二结局', async () => {
    await openMoreView(page)
    const saves = page.getByTestId('text-open-world-save-settings')
    await saves.scrollIntoViewIfNeeded()
    await saves.getByRole('navigation', { name: '存档与设置分类' })
      .getByRole('button', { name: /^分支/ })
      .click()
    const branches = saves.getByTestId('text-open-world-branch-list')
    await expect(branches).toContainText('这条时间线已经抵达结局')
    await expect(branches.getByLabel('新时间线名称')).toBeDisabled()
    await expect(branches.getByRole('button', { name: '建立', exact: true })).toBeDisabled()
    await expect(branches.locator('article').filter({ hasText: sessionTitle }))
      .toContainText('运行状态可读取')

    await saves.getByRole('navigation', { name: '存档与设置分类' })
      .getByRole('button', { name: /^存档/ })
      .click()
    const manualSave = saves.locator('[data-save-purpose="manual"] article')
      .filter({ hasText: '终局前检查点' })
    const continueFromCheckpoint = manualSave.getByRole('button', { name: '从此处继续', exact: true })
    await expect(continueFromCheckpoint).toBeEnabled()
    await continueFromCheckpoint.click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('从“终局前检查点”继续？')
    await confirmation.getByRole('button', { name: '建立分支并继续', exact: true }).click()

    await expect.poll(async () => page.evaluate(async () => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { useTextOpenWorldPlayerStore } = await importer('/storyforge/src/stores/text-open-world-player.ts')
      return useTextOpenWorldPlayerStore.getState().selectedSession?.id ?? 0
    }), { timeout: 60_000 }).not.toBe(sessionId)
    await expect(page.getByTestId('text-open-world-ending-panel')).toHaveCount(0, { timeout: 30_000 })
    const fixedChoices = page.getByTestId('text-open-world-fixed-choices')
    const inheritedCombatResult = page.getByTestId('text-open-world-combat-result')
    await expect(fixedChoices.or(inheritedCombatResult)).toBeVisible({ timeout: 30_000 })
    if (await inheritedCombatResult.isVisible()) {
      const returnToScene = inheritedCombatResult.getByRole('button', {
        name: '返回当前场景',
        exact: true,
      })
      await expect(returnToScene).toBeEnabled({ timeout: 30_000 })
      await returnToScene.click()
    }
    await expect(fixedChoices).toContainText('选择共管盐渠', { timeout: 30_000 })
    const child = await page.evaluate(async () => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const [{ db }, { useTextOpenWorldPlayerStore }] = await Promise.all([
        importer('/storyforge/src/lib/db/schema.ts'),
        importer('/storyforge/src/stores/text-open-world-player.ts'),
      ])
      const selectedId = useTextOpenWorldPlayerStore.getState().selectedSession?.id ?? 0
      const session = await db.productRuntimeSessions.get(selectedId)
      return {
        id: selectedId,
        status: session?.status ?? null,
        parentSessionId: session?.parentSessionId ?? null,
        productReleaseId: session?.productReleaseId ?? null,
        productBuildId: session?.productBuildId ?? null,
      }
    })
    expect(child).toMatchObject({
      status: 'active',
      parentSessionId: sessionId,
      productReleaseId: releaseId,
      productBuildId: null,
    })
    expect(child.id).not.toBe(sessionId)

    await fixedChoices.getByRole('button', { name: /^选择港口控渠/ }).click()
    const endingConfirmation = page.getByRole('alertdialog', { name: '确认高风险行动' })
    await expect(endingConfirmation).toContainText('选择港口控渠')
    await endingConfirmation.getByRole('button', { name: '确认执行', exact: true }).click()
    const childEnding = page.getByTestId('text-open-world-ending-panel')
    await expect(childEnding).toHaveAttribute('data-ending-phase', 'completed', { timeout: 60_000 })
    await expect(childEnding).toContainText('港口控渠')

    const [childTerminal, unchangedParent] = await Promise.all([
      readJourneySnapshot(page, child.id),
      readJourneySnapshot(page, sessionId),
    ])
    expect(childTerminal).toMatchObject({
      sessionStatus: 'completed',
      productReleaseId: releaseId,
      productBuildId: null,
      reachedEndingKey: 'ending.control',
      finalQuestStatus: 'completed',
    })
    expect(childTerminal.playerActionKeys).toContain('action.ending.ending.control')
    expect(childTerminal.playerActionKeys).not.toContain('action.ending.ending.cooperate')
    expect(unchangedParent).toEqual(terminalSnapshot)
  })
})
