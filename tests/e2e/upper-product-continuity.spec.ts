import { expect, test, type Page } from '@playwright/test'
import { openCurrentTtrpgPlayer, seedCurrentTtrpgProduct } from './helpers/current-products'
import { publishCurrentWorldRelease } from './helpers/world-release'

async function seedFormalTtrpgCampaign(page: Page) {
  return seedCurrentTtrpgProduct(page, {
    title: '浏览器正式跑团验收',
    gmMode: 'human',
    playerController: 'human',
    ruleOrigin: 'builtin-storyforge',
  })
}

async function seedEvolutionCompatibilityCampaign(page: Page) {
  await page.goto('./')
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { seedCurrentProductWorld },
      { suggestGameStartingPoints, draftGameProductionBriefV3 },
      { executeGameProductionCommand },
      { runLocalGameProductionVerticalSlice },
      { publishGameProductionV1, beginGameProductionEvolutionV1 },
      { createPlayableGameInstance },
      {
        readSimulationState,
        hashSimulationRuntimeStateV1,
        commitNarrativeChoiceWithStateV1,
      },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/src/lib/game-production/consultation.ts'),
      importer('/storyforge/src/lib/game-production/commands.ts'),
      importer('/storyforge/src/lib/game-production/vertical-slice.ts'),
      importer('/storyforge/src/lib/game-production/service.ts'),
      importer('/storyforge/src/lib/world-engine/instances.ts'),
      importer('/storyforge/src/lib/simulation/runtime.ts'),
    ])
    const world = await seedCurrentProductWorld('浏览器演化兼容验收')
    const projectId = world.scope.projectId
    const scope = world.scope
    const worldRelease = world.release
    await db.projects.update(projectId, { gamePlatformOptIns: { gameProductionV3: true } })
    const suggestions = await suggestGameStartingPoints({
      scope, worldReleaseId: worldRelease.id,
    })
    const startingPoint = suggestions.suggestions.find((item: { kind: string }) => item.kind === 'mainline')
      ?? suggestions.suggestions[0]
    if (!startingPoint) throw new Error('演化兼容验收缺少可玩起点')
    const brief = await draftGameProductionBriefV3({
      scope, worldReleaseId: worldRelease.id, suggestionKey: startingPoint.suggestionKey,
      productType: 'storygame', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
      requiredFacts: ['旧港失踪案的既有证据不得被新版覆盖'],
      forbiddenChanges: ['旧 Release 与旧存档必须继续固定在原 packageHash'],
    })
    const created = await executeGameProductionCommand({
      scope,
      command: {
        type: 'create-intent', commandId: 'browser-evolution.intent',
        productionKey: 'browser.evolution.compatibility', worldReleaseId: worldRelease.id,
        userText: '浏览器演化兼容游戏',
      },
    })
    const saved = await executeGameProductionCommand({
      scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'browser-evolution.brief-1',
        expectedStateRevision: 0, parentRevision: null, brief,
      },
    })
    const authorized = await executeGameProductionCommand({
      scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'browser-evolution.authorize-1',
        expectedStateRevision: 1, briefRevision: 1,
        briefHash: saved.result.briefHash, authorizationNonce: 'browser-evolution-author-1',
      },
    })
    if (!authorized.ok) throw new Error('首版 Build 授权失败')
    const firstBuild = await runLocalGameProductionVerticalSlice({
      scope, productionId: created.productionId,
    })
    const published = await publishGameProductionV1({ scope, productionId: created.productionId })
    const oldReleaseId = published.receipt.gameReleaseId
    const oldRelease = await db.gameReleases.get(oldReleaseId)
    if (!oldRelease) throw new Error('首版 GameRelease 缺失')
    const oldSession = await createPlayableGameInstance({
      scope, source: { kind: 'release', gameReleaseId: oldReleaseId },
      title: '旧版固定存档', seed: 'browser-evolution-old-session',
    })
    const initialState = await readSimulationState(oldSession.id)
    await commitNarrativeChoiceWithStateV1({
      sessionId: oldSession.id, choiceKey: 'choice.observe',
      commandId: 'browser-evolution.old-session.observe',
      baseSequence: initialState.lastSequence,
      baseStateHash: await hashSimulationRuntimeStateV1(initialState),
    })
    const eventsBeforeEvolution = await db.simulationEvents.where('sessionId').equals(oldSession.id).count()

    await beginGameProductionEvolutionV1({
      scope, productionId: created.productionId,
      userText: '保留既有选择后果，增加旧港失踪案的后续调查表现。',
      affectedLanes: ['content'],
    })
    const production = await db.gameProductions.get(created.productionId)
    if (!production?.currentBriefRevision) throw new Error('演化 Brief 未生成')
    const evolvedBrief = await db.gameProductionBriefs
      .where('[productionId+revision]')
      .equals([created.productionId, production.currentBriefRevision])
      .first()
    if (!evolvedBrief) throw new Error('演化 Brief 行缺失')
    const evolvedAuthorization = await executeGameProductionCommand({
      scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'browser-evolution.authorize-2',
        expectedStateRevision: production.stateRevision,
        briefRevision: evolvedBrief.revision, briefHash: evolvedBrief.briefHash,
        authorizationNonce: 'browser-evolution-author-2',
      },
    })
    if (!evolvedAuthorization.ok) throw new Error('演化 Build 授权失败')
    const secondBuild = await runLocalGameProductionVerticalSlice({
      scope, productionId: created.productionId,
    })
    const secondBuildRow = await db.gameBuilds.get(secondBuild.buildId)
    const oldSessionAfterEvolution = await db.simulationSessions.get(oldSession.id)
    const oldReleaseAfterEvolution = await db.gameReleases.get(oldReleaseId)
    if (!secondBuildRow || !oldSessionAfterEvolution || !oldReleaseAfterEvolution) {
      throw new Error('演化后冻结记录缺失')
    }
    const compatibility = JSON.parse(secondBuildRow.compatibilityJson)
    return {
      projectId,
      productionId: created.productionId,
      oldReleaseId,
      oldReleaseHash: oldRelease.contentHash,
      oldReleaseHashAfterEvolution: oldReleaseAfterEvolution.contentHash,
      oldSessionId: oldSession.id,
      oldSessionReleaseId: oldSessionAfterEvolution.gameReleaseId,
      oldSessionRuntimeSourceHash: oldSessionAfterEvolution.runtimeSourceHash,
      eventsBeforeEvolution,
      firstPackageHash: firstBuild.packageHash,
      secondPackageHash: secondBuild.packageHash,
      secondBuildNumber: secondBuildRow.buildNumber,
      secondParentBuildNumber: secondBuildRow.parentBuildNumber,
      compatibility,
    }
  })
}

test('正式跑团从冻结发布完成 Session Zero、规则桌面、安全暂停与刷新恢复', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'formal-ttrpg-e2e')
  })
  const seeded = await seedFormalTtrpgCampaign(page)
  expect(seeded.releaseHash).toMatch(/^[a-f0-9]{64}$/)
  const guide = await openCurrentTtrpgPlayer(page)
  await expect(guide.getByRole('heading', { name: '浏览器正式跑团验收', exact: true })).toBeVisible()
  const sessionZero = guide.getByTestId('ttrpg-session-zero')
  await expect(sessionZero).toContainText('开局共识与安全工具')
  const consent = sessionZero
    .getByTestId('ttrpg-session-zero-consent-checklist')
    .locator('input[type="checkbox"]')
  await expect(consent).toHaveCount(4)
  for (let index = 0; index < await consent.count(); index += 1) await consent.nth(index).check()
  await sessionZero.getByRole('button', { name: '确认共识并开始战役', exact: true }).click()
  await expect(guide).toContainText('Session Zero 已完成')
  await expect(guide.getByTestId('ttrpg-gm-prep-board')).toContainText('失败前进')

  await guide.getByRole('button', { name: '打开场景', exact: true }).click()
  await expect(guide.getByTestId('ttrpg-active-actor')).toBeVisible()
  await expect(guide).toContainText('可用行动')
  await expect(guide).toContainText('潮门之前')

  await guide.getByRole('button', { name: '玩家视图', exact: true }).click()
  await expect(guide.getByText('GM 私密提示', { exact: true })).toHaveCount(0)
  await expect(guide).not.toContainText('两条线索分别指向时间与动机')
  await guide.getByLabel('安全暂停原因').fill('浏览器验收暂停并确认边界')
  await guide.getByRole('button', { name: '立即暂停', exact: true }).click()
  await expect(guide).toContainText('战役已安全暂停')

  await page.reload()
  const restored = await openCurrentTtrpgPlayer(page)
  await expect(restored).toContainText('战役已安全暂停')
  await restored.getByRole('button', { name: '确认边界并恢复', exact: true }).click()
  await expect(restored).toContainText('安全工具可用')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(restored.getByRole('button', { name: '玩家视图', exact: true })).toBeVisible()
  await expect(restored.getByTestId('ttrpg-active-actor')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('演化 Build 展示稳定键兼容报告且旧 Release 与旧存档继续可玩', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'evolution-compatibility-e2e')
  })
  const seeded = await seedEvolutionCompatibilityCampaign(page)
  expect(seeded.firstPackageHash).toMatch(/^[a-f0-9]{64}$/)
  expect(seeded.secondPackageHash).toMatch(/^[a-f0-9]{64}$/)
  expect(seeded.secondPackageHash).not.toBe(seeded.firstPackageHash)
  expect(seeded.oldReleaseHashAfterEvolution).toBe(seeded.oldReleaseHash)
  expect(seeded.oldSessionReleaseId).toBe(seeded.oldReleaseId)
  expect(seeded.oldSessionRuntimeSourceHash).toBe(seeded.firstPackageHash)
  expect(seeded.secondBuildNumber).toBe(2)
  expect(seeded.secondParentBuildNumber).toBe(1)
  expect(seeded.compatibility).toMatchObject({
    level: 'compatible', fromBuildNumber: 1, toBuildNumber: 2,
    migrationPolicy: 'identity', removedStableKeys: [], changedStableKeys: [],
  })

  await page.reload()
  await page.getByTestId('product-tab-game').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const studio = page.getByTestId('game-production-studio')
  await expect(studio).toBeVisible({ timeout: 15_000 })
  const compatibility = studio.getByTestId('game-production-compatibility')
  await expect(compatibility).toContainText('存档兼容报告')
  await expect(compatibility).toContainText('可兼容')
  await expect(compatibility).toContainText('Build #1 → #2 · identity')
  await expect(compatibility).toContainText('变化只涉及不进入存档语义的表现内容')
  const lineage = studio.getByTestId('game-production-version-history')
  await expect(lineage).toContainText('Build #2')
  await expect(lineage).toContainText('parent #1')
  await expect(lineage).toContainText('Build #1')
  await expect(lineage).toContainText(`Release #${seeded.oldReleaseId}`)

  await page.getByRole('button', { name: '玩家', exact: true }).click()
  await expect(page.getByText('旧版固定存档', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /旧版固定存档.*自动保存/ }).click()
  await expect(page.getByRole('heading', { name: '先理解局势', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '显示全文', exact: true }).click()
  await page.getByRole('button', { name: '进入选择', exact: true }).click()
  await page.getByRole('button', { name: /带着证据作结/ }).click()
  await expect(page.getByRole('heading', { name: '看清代价', exact: true })).toBeVisible()

  const oldBindingAfterPlay = await page.evaluate(async oldSessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const session = await db.simulationSessions.get(oldSessionId)
    return {
      gameReleaseId: session?.gameReleaseId,
      runtimeSourceHash: session?.runtimeSourceHash,
      eventCount: await db.simulationEvents.where('sessionId').equals(oldSessionId).count(),
    }
  }, seeded.oldSessionId)
  expect(oldBindingAfterPlay).toMatchObject({
    gameReleaseId: seeded.oldReleaseId,
    runtimeSourceHash: seeded.firstPackageHash,
  })
  expect(oldBindingAfterPlay.eventCount).toBeGreaterThan(seeded.eventsBeforeEvolution)
})

test('世界到游戏只进入统一制作中心并自动复用全局 AI 配置', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'agnes',
      apiKey: 'e2e-existing-global-key',
      model: 'agnes-2.0-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('游戏生产入口验收世界')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByTitle('新增主线').click()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()

  await page.goto('./')
  await page.getByTestId('product-tab-worlds').click()
  const pipeline = await publishCurrentWorldRelease(page, '生产入口修订')
  await expect(pipeline.getByRole('button', { name: /主 Agent 生成游戏候选|快速映射|直接发布/ })).toHaveCount(0)
  await pipeline.getByRole('button', { name: '交给文字游戏', exact: true }).click()

  await expect(page.getByRole('heading', { name: '游戏制作中心', exact: true })).toBeVisible()
  await expect(page.getByText('自动游戏制作需要项目授权', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '为当前项目显式启用', exact: true }).click()
  await expect(page.getByText('文本生成能力已就绪', { exact: true })).toBeVisible()
  await expect(page.getByText(/直接复用 agnes \/ agnes-2\.0-flash，无需再次填写 API Key/)).toBeVisible()
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0)

  await expect(page.getByRole('button', { name: '手工维护', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /新建空白游戏|载入验收样例/ })).toHaveCount(0)
  await expect(page.getByTestId('game-production-studio')).toBeVisible()
  await page.getByRole('combobox', { name: /产品形态/ }).selectOption('avg')
  await page.getByRole('combobox', { name: /制作质量/ }).selectOption('commercial-candidate')
  await expect(page.getByText(/图片能力已就绪：复用同一 Agnes Key.*agnes-image-2\.1-flash/)).toBeVisible()
  await expect(page.getByText(/Agnes 当前公开接口未提供独立音乐\/SFX 生成/)).toBeVisible()
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: /产品形态/ }).selectOption('storygame')
  await page.getByRole('combobox', { name: /制作质量/ }).selectOption('prototype')

  const authoredTitle = '用户明确命名的游戏'
  const authoredRole = '扮演收到失踪导师信号的守灯人'
  const authoredOpening = '封港钟响起前先救人，再决定是否公开港务厅隐瞒的真相。'
  await page.getByRole('textbox', { name: '游戏标题', exact: true }).fill(authoredTitle)
  await page.getByRole('textbox', { name: '玩家身份 / 主角', exact: true }).fill(authoredRole)
  await page.getByRole('combobox', { name: '游戏规模', exact: true }).selectOption('short-arc')
  await page.getByRole('textbox', { name: /你想玩的第一幕与核心目标/ }).fill(authoredOpening)
  await page.getByRole('button', { name: '分析可玩起点', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '游戏标题', exact: true })).toHaveValue(authoredTitle)
  await expect(page.getByRole('textbox', { name: '玩家身份 / 主角', exact: true })).toHaveValue(authoredRole)
  await expect(page.getByRole('combobox', { name: '游戏规模', exact: true })).toHaveValue('short-arc')
  await expect(page.getByRole('textbox', { name: /你想玩的第一幕与核心目标/ })).toHaveValue(authoredOpening)
})
