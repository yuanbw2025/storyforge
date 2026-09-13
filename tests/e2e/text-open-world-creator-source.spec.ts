import { expect, test, type Page } from '@playwright/test'

interface ProtectedTableCounts {
  worldReleases: number
  productions: number
  briefs: number
  commands: number
  builds: number
  artifacts: number
  qualityReceipts: number
  releases: number
  runtimeSessions: number
  runtimeEvents: number
  runtimeCheckpoints: number
}

async function openProductHub(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-creator-source-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '你的创作与游玩空间', exact: true }))
    .toBeVisible({ timeout: 20_000 })
}

async function readProtectedTableCounts(page: Page): Promise<ProtectedTableCounts> {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const [
      worldReleases,
      productions,
      briefs,
      commands,
      builds,
      artifacts,
      qualityReceipts,
      releases,
      runtimeSessions,
      runtimeEvents,
      runtimeCheckpoints,
    ] = await Promise.all([
      db.worldReleases.count(),
      db.productProductions.count(),
      db.productProductionBriefs.count(),
      db.productProductionCommands.count(),
      db.productBuilds.count(),
      db.productBuildArtifacts.count(),
      db.productQualityGateReceipts.count(),
      db.productReleases.count(),
      db.productRuntimeSessions.count(),
      db.productRuntimeEvents.count(),
      db.productRuntimeCheckpoints.count(),
    ])
    return {
      worldReleases,
      productions,
      briefs,
      commands,
      builds,
      artifacts,
      qualityReceipts,
      releases,
      runtimeSessions,
      runtimeEvents,
      runtimeCheckpoints,
    }
  })
}

interface CreatorNovelFixtureV1 {
  projectId: number
  chapterId: number
  title: string
  sourceUnitCount: number
  totalWordCount: number
  sourceVersionHash: string
  sourceBoundaryHash: string
}

async function openCreatorProductHub(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'deepseek',
      apiKey: 'creator-source-cas-e2e-key',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))
  })
  await openProductHub(page)
}

async function seedCreatorNovelFixture(page: Page, input: {
  name: string
  chapterChars: number
  outlineCount: number
}): Promise<CreatorNovelFixtureV1> {
  return page.evaluate(async ({ name, chapterChars, outlineCount }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { createWorkspace },
      { stampNewRecord },
      { inspectTextOpenWorldCreatorNovelSourceV1 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/workspace/create-workspace.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/open-world/creator-source.ts'),
    ])
    const created = await createWorkspace({
      name,
      genres: ['fantasy'],
      status: 'drafting',
      description: '巡井人沿盐脊追查断流，并把每条线索整理为可冻结的作者来源。',
      targetWordCount: 4_000_000,
      enableMultiWorld: false,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const now = Date.now()
    const outlineRows = Array.from({ length: outlineCount }, (_, index) => stampNewRecord(
      created.scope,
      'outlineNodes',
      {
        projectId: created.scope.projectId,
        parentId: null,
        type: 'chapter',
        title: `盐脊线索 ${String(index + 1).padStart(3, '0')}`,
        summary: `第 ${index + 1} 条断流线索。`,
        order: index,
        createdAt: now,
        updatedAt: now,
      },
      { owner: 'work' },
    ))
    await db.outlineNodes.bulkAdd(outlineRows)
    const firstOutline = await db.outlineNodes
      .where('projectId').equals(created.scope.projectId)
      .sortBy('order')
      .then((rows: any[]) => rows[0])
    if (!firstOutline?.id) throw new Error('Creator CAS E2E 缺少章节大纲')
    const body = '盐'.repeat(chapterChars)
    const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId,
      outlineNodeId: firstOutline.id,
      title: '第一章 断流长卷',
      content: `<p>${body}</p>`,
      wordCount: body.length,
      status: 'final',
      order: 0,
      notes: '',
      summary: '巡井人读取完整盐脊长卷。',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' })) as number
    const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
    })
    return {
      projectId: created.scope.projectId,
      chapterId,
      title: created.work.title,
      sourceUnitCount: preview.sourceUnitCount,
      totalWordCount: preview.totalWordCount,
      sourceVersionHash: preview.sourceVersionHash,
      sourceBoundaryHash: preview.sourceBoundaryHash,
    }
  }, input)
}

async function openEntireNovelCreatorBrief(page: Page, fixture: CreatorNovelFixtureV1) {
  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await expect(page.getByRole('heading', { name: '长篇小说创作', exact: true })).toBeVisible()
  await expect(page.getByText(fixture.title, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '制作文字开放世界', exact: true }).click()

  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio).toBeVisible({ timeout: 30_000 })
  const catalog = studio.getByTestId('creator-novel-catalog')
  await expect(catalog).toBeVisible({ timeout: 30_000 })
  await expect(catalog.getByRole('radio', { name: '整部小说', exact: true })).toBeChecked()
  await catalog.getByRole('button', { name: '核验小说候选', exact: true }).click()

  const preview = studio.getByTestId('creator-novel-preview')
  await expect(preview).toBeVisible({ timeout: 180_000 })
  await expect(preview.getByText('候选单元', { exact: true }).locator('..'))
    .toContainText(`${fixture.sourceUnitCount} 项`)
  await expect(preview.getByText(fixture.sourceVersionHash, { exact: true })).toBeVisible()
  await expect(preview.getByText(fixture.sourceBoundaryHash, { exact: true })).toBeVisible()
  await studio.getByTestId('creator-source-continue').click()
}

async function confirmCreatorBriefAndPreflight(page: Page) {
  const briefStudio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(briefStudio).toBeVisible({ timeout: 180_000 })
  await briefStudio.getByLabel('我确认当前来源身份与 Hash').check()
  await briefStudio.getByLabel('我理解首版是有边界的自由演绎，关键主线受保护').check()
  await briefStudio.getByLabel('我确认未决问题已经清空或转为接受的假设').check()
  await briefStudio.getByLabel('我理解通过质量门后直接发布，问题以新版本修复').check()
  await briefStudio.getByTestId('text-open-world-creator-brief-confirm').click()
  await expect(briefStudio.getByText('Brief 已就绪', { exact: true })).toBeVisible({ timeout: 180_000 })
  await briefStudio.getByTestId('text-open-world-creator-brief-continue').click()

  const readiness = page.getByTestId('text-open-world-creator-production-readiness')
  await expect(readiness).toBeVisible({ timeout: 180_000 })
  await expect(readiness.getByTestId('text-open-world-preflight-budget')).toBeVisible({ timeout: 180_000 })
  await expect(readiness.getByTestId('text-open-world-preflight-blockers')).toHaveCount(0)
  const acknowledgements = readiness.locator('input[type="checkbox"]')
  await expect(acknowledgements).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) await acknowledgements.nth(index).check()
  await readiness.getByTestId('text-open-world-preflight-confirm').click()

  const start = page.getByTestId('text-open-world-creator-production-start')
  await expect(start).toBeVisible({ timeout: 180_000 })
  await start.getByLabel('权利基础').selectOption('author-owned')
  await start.getByRole('button', { name: '生成并检查冻结计划', exact: true }).click()
  await expect(start.getByTestId('text-open-world-creator-plan-preview')).toBeVisible({ timeout: 180_000 })
  return start
}

test('小说项目无需世界项目即可从作品入口完成选区预检与 Creator Brief 确认，且不提前创建 Build', async ({ page }) => {
  test.setTimeout(120_000)
  await openProductHub(page)

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { createWorkspace },
      { stampNewRecord },
      { inspectTextOpenWorldCreatorNovelSourceV1 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/workspace/create-workspace.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/open-world/creator-source.ts'),
    ])
    const created = await createWorkspace({
      name: '浏览器小说独立来源',
      genres: ['fantasy'],
      status: 'drafting',
      description: '一名巡井人追查盐脊各地的断流。',
      targetWordCount: 120_000,
      enableMultiWorld: false,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const now = Date.now()
    const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId: created.scope.projectId,
      parentId: null,
      type: 'volume',
      title: '盐脊卷',
      summary: '巡井人从盐港出发，逐步发现旧日契约。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    const outlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId: created.scope.projectId,
      parentId: volumeId,
      type: 'chapter',
      title: '第一章 断流',
      summary: '巡井人在旧渠发现被抹去的盐印。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    const secretBody = '浏览器验收正文只可参与内部快照，不得出现在来源确认页面。'.repeat(18)
    const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId,
      outlineNodeId: outlineId,
      title: '第一章 断流',
      content: `<p>${secretBody}</p>`,
      wordCount: secretBody.length,
      status: 'final',
      order: 0,
      notes: '',
      summary: '巡井人在旧渠发现被抹去的盐印。',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
      projectId: created.scope.projectId,
      theme: '成长与守护',
      centralConflict: '巡井人必须在城邦秩序与断流真相之间作出选择。',
      plotPattern: '调查—成长—远行—回归',
      logline: '巡井人追查正在吞噬各地水源的旧日契约。',
      concept: '小说拆解为文字开放世界',
      mainPlot: '逐区追查断流源头。',
      subPlots: '各地角色、势力和地域命运故事。',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
    const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: created.scope,
      selection: { mode: 'chapters', chapterIds: [chapterId] },
    })
    return {
      projectId: created.scope.projectId,
      chapterId,
      title: created.work.title,
      secretBody,
      sourceVersionHash: preview.sourceVersionHash,
      sourceBoundaryHash: preview.sourceBoundaryHash,
      totalWordCount: preview.totalWordCount,
      sourceUnitCount: preview.sourceUnitCount,
      worldProjectCount: await db.projects.filter((project: any) => (
        project.workspacePurpose === 'world-engine'
      )).count(),
    }
  })
  expect(seeded.worldProjectCount).toBe(0)
  expect(seeded.sourceVersionHash).toMatch(/^[a-f0-9]{64}$/)
  expect(seeded.sourceBoundaryHash).toMatch(/^[a-f0-9]{64}$/)
  const before = await readProtectedTableCounts(page)

  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await expect(page.getByRole('heading', { name: '长篇小说创作', exact: true })).toBeVisible()
  await expect(page.getByText(seeded.title, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '制作文字开放世界', exact: true }).click()

  await expect(page.getByRole('heading', { name: '文字开放世界制作', exact: true })).toBeVisible()
  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio).toBeVisible({ timeout: 30_000 })
  await expect(studio.getByRole('tab', { name: '小说作品', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(studio.getByRole('note')).toContainText('尚未冻结、模型尚未实读、未开始计费和生产')

  const catalog = studio.getByTestId('creator-novel-catalog')
  await expect(catalog).toBeVisible({ timeout: 30_000 })
  await expect(catalog).toContainText('1 章')
  await expect(catalog).toContainText('2 项')
  await catalog.getByRole('radio', { name: '指定章节', exact: true }).check()
  await catalog.getByRole('checkbox', { name: /第一章 断流/ }).check()
  await catalog.getByRole('button', { name: '核验小说候选', exact: true }).click()

  const preview = studio.getByTestId('creator-novel-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(preview).toContainText('指定章节：1章')
  await expect(preview.getByText('候选字数', { exact: true }).locator('..'))
    .toContainText(`${new Intl.NumberFormat('zh-CN').format(seeded.totalWordCount)} 字`)
  await expect(preview.getByText('候选单元', { exact: true }).locator('..'))
    .toContainText(`${seeded.sourceUnitCount} 项`)
  await expect(preview.getByText(seeded.sourceVersionHash, { exact: true })).toBeVisible()
  await expect(preview.getByText(seeded.sourceBoundaryHash, { exact: true })).toBeVisible()
  await expect(studio).not.toContainText(seeded.secretBody)

  const continueButton = studio.getByTestId('creator-source-continue')
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  const briefStudio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(briefStudio).toBeVisible({ timeout: 30_000 })
  await expect(briefStudio.getByText('会谈中', { exact: true })).toBeVisible()
  await expect(briefStudio.getByText('当前修订 0 · Build 0', { exact: true })).toBeVisible()
  expect(await readProtectedTableCounts(page)).toEqual({
    ...before,
    productions: before.productions + 1,
    commands: before.commands + 1,
  })

  await briefStudio.getByLabel('我确认当前来源身份与 Hash').check()
  await briefStudio.getByLabel('我理解首版是有边界的自由演绎，关键主线受保护').check()
  await briefStudio.getByLabel('我确认未决问题已经清空或转为接受的假设').check()
  await briefStudio.getByLabel('我理解通过质量门后直接发布，问题以新版本修复').check()
  await briefStudio.getByTestId('text-open-world-creator-brief-confirm').click()
  await expect(briefStudio.getByText('Brief 已就绪', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(briefStudio).toContainText('已确认 v1')
  expect(await readProtectedTableCounts(page)).toEqual({
    ...before,
    productions: before.productions + 1,
    briefs: before.briefs + 1,
    commands: before.commands + 2,
  })
})

test('世界引擎 handoff 按用户选择的冻结 Release ID 与完整 Hash 打开同一候选，且保持只读', async ({ page }) => {
  test.setTimeout(120_000)
  await openProductHub(page)

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { seedCurrentProductWorld }, { createWorldRevision, publishWorldRevision }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/src/lib/world-engine/releases.ts'),
    ])
    const world = await seedCurrentProductWorld('浏览器世界版本来源')
    const firstRelease = world.release
    const worldview = await db.worldviews.where('projectId').equals(world.scope.projectId).first()
    if (!worldview?.id) throw new Error('世界来源 fixture 缺少世界观记录')
    await db.worldviews.update(worldview.id, {
      worldOrigin: '第二版把潮汐源头改为海底旧城。',
      updatedAt: Date.now() + 1,
    })
    const secondRevision = await createWorldRevision({
      scope: world.scope,
      label: '浏览器世界来源 v2',
      parentRevisionId: world.revision.id,
    })
    const secondRelease = await publishWorldRevision(secondRevision.id)
    return {
      worldName: world.world.name,
      first: {
        id: firstRelease.id,
        version: firstRelease.version,
        label: firstRelease.label,
        hash: firstRelease.contentHash,
      },
      second: {
        id: secondRelease.id,
        version: secondRelease.version,
        label: secondRelease.label,
        hash: secondRelease.contentHash,
      },
    }
  })
  expect(seeded.first.id).not.toBe(seeded.second.id)
  expect(seeded.first.hash).not.toBe(seeded.second.hash)
  const before = await readProtectedTableCounts(page)

  await page.reload()
  await page.getByTestId('product-tab-worlds').click()
  const releasePanel = page.getByRole('region', { name: '世界修订、发布与产品交接' })
  await expect(releasePanel).toBeVisible({ timeout: 30_000 })
  const releaseSelect = releasePanel.getByLabel('冻结世界版本')
  await expect(releaseSelect).toHaveValue(String(seeded.second.id))
  await releaseSelect.selectOption(String(seeded.first.id))
  await expect(releaseSelect).toHaveValue(String(seeded.first.id))
  await expect(releasePanel.locator('code'))
    .toContainText(seeded.first.hash.slice(0, 16))
  await releasePanel.getByRole('button', { name: '交给文字开放世界', exact: true }).click()

  await expect(page.getByRole('heading', { name: '文字开放世界制作', exact: true })).toBeVisible()
  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio.getByRole('tab', { name: '冻结世界版本', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const selectedCandidate = studio.locator('[role="radio"][aria-checked="true"]')
  await expect(selectedCandidate).toHaveCount(1, { timeout: 30_000 })
  await expect(selectedCandidate).toContainText(`Release v${seeded.first.version}`)
  await expect(selectedCandidate).toContainText(seeded.first.label)
  await expect(selectedCandidate).toContainText(seeded.first.hash)

  const preview = studio.getByTestId('creator-world-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(preview.getByRole('heading', {
    name: `${seeded.worldName} · v${seeded.first.version}`,
    exact: true,
  })).toBeVisible()
  await expect(preview.getByText(seeded.first.hash, { exact: true })).toBeVisible()
  await expect(preview).not.toContainText(seeded.second.hash)
  await expect(preview).toContainText('文字开放世界需求核对')
  await expect(preview).toContainText('世界基础')

  const continueButton = studio.getByTestId('creator-source-continue')
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  const briefStudio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(briefStudio).toBeVisible({ timeout: 30_000 })
  await expect(briefStudio.getByText('会谈中', { exact: true })).toBeVisible()
  await expect(briefStudio).toContainText('主 Agent 只理解你的设定与来源摘要')
  expect(await readProtectedTableCounts(page)).toEqual({
    ...before,
    productions: before.productions + 1,
    commands: before.commands + 1,
  })
})

test('真实 Chromium Creator 链路以 512 个小说来源单元和约 390 万字完成原子 Build 授权', async ({ page }, testInfo) => {
  test.setTimeout(600_000)
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(`${error.name}: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  await openCreatorProductHub(page)
  const fixture = await seedCreatorNovelFixture(page, {
    name: 'Creator 512 单元长篇来源',
    chapterChars: 3_900_000,
    outlineCount: 491,
  })
  expect(fixture.sourceUnitCount).toBe(512)
  expect(fixture.totalWordCount).toBeGreaterThanOrEqual(3_800_000)
  expect(fixture.totalWordCount).toBeLessThanOrEqual(4_000_000)
  const before = await readProtectedTableCounts(page)

  const startedAt = Date.now()
  await openEntireNovelCreatorBrief(page, fixture)
  const start = await confirmCreatorBriefAndPreflight(page)
  expect(await readProtectedTableCounts(page)).toEqual({
    ...before,
    productions: before.productions + 1,
    briefs: before.briefs + 1,
    commands: before.commands + 2,
  })
  await start.getByRole('button', { name: '再次复验并创建 Build', exact: true }).click()
  await expect(page.getByTestId('product-production-studio')).toBeVisible({ timeout: 300_000 })
  const durationMs = Date.now() - startedAt

  const authorization = await page.evaluate(async projectId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const [production, brief, builds, commands] = await Promise.all([
      db.productProductions.where('projectId').equals(projectId).first(),
      db.productProductionBriefs.where('projectId').equals(projectId).first(),
      db.productBuilds.where('projectId').equals(projectId).toArray(),
      db.productProductionCommands.where('projectId').equals(projectId).toArray(),
    ])
    const sourcePlan = JSON.parse(brief?.sourcePlanJson ?? '{}')
    return {
      productionStatus: production?.status ?? null,
      currentBuildNumber: production?.currentBuildNumber ?? null,
      briefStatus: brief?.status ?? null,
      buildStatuses: builds.map((row: any) => row.status),
      sourceKind: sourcePlan.sourceKind ?? null,
      sourceUnitCount: sourcePlan.selection?.sourceUnitCount ?? null,
      sourceUnitArtifactKeyCount: sourcePlan.sourceUnitArtifactKeys?.length ?? null,
      startCommandStatuses: commands
        .filter((row: any) => row.type === 'authorize-text-open-world-creator-start')
        .map((row: any) => row.status),
    }
  }, fixture.projectId)
  expect(authorization).toMatchObject({
    productionStatus: 'producing',
    currentBuildNumber: 1,
    briefStatus: 'authorized',
    sourceKind: 'novel',
    sourceUnitCount: 512,
    sourceUnitArtifactKeyCount: 512,
    startCommandStatuses: ['succeeded'],
  })
  expect(authorization.buildStatuses).toHaveLength(1)
  expect(['authorized', 'building']).toContain(authorization.buildStatuses[0])
  expect(browserErrors.join('\n')).not.toMatch(/PrematureCommitError/i)
  testInfo.annotations.push({ type: 'creator-cas-duration-ms', description: String(durationMs) })
  console.log(`[CREATOR-CAS-E2E] 512 units / ${fixture.totalWordCount} chars authorized in ${durationMs}ms`)
})

test('Creator 事务外准备完成后并发改写小说行会以 source-stale 失败且零 Build 授权', async ({ page }) => {
  test.setTimeout(300_000)
  await openCreatorProductHub(page)
  const fixture = await seedCreatorNovelFixture(page, {
    name: 'Creator CAS 并发反例',
    chapterChars: 40_000,
    outlineCount: 1,
  })
  await openEntireNovelCreatorBrief(page, fixture)
  const start = await confirmCreatorBriefAndPreflight(page)

  await page.evaluate(async chapterId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const mutableDb = db as {
      name: string
      transaction: (...args: any[]) => Promise<unknown>
    }
    const originalTransaction = mutableDb.transaction
    const marker = {
      transactionIntercepted: false,
      mutationCommitted: false,
      interceptedTableNames: [] as string[],
    }
    ;(window as any).__creatorNovelCasRace = marker
    mutableDb.transaction = async function (...args: any[]) {
      const tableNames = (Array.isArray(args[1]) ? args[1] : [])
        .map((table: { name?: string }) => table?.name ?? '')
      const isCreatorAuthorization = args[0] === 'rw'
        && tableNames.includes('productBuilds')
        && tableNames.includes('productProductionCommands')
        && tableNames.includes('chapters')
      if (!marker.transactionIntercepted && isCreatorAuthorization) {
        marker.transactionIntercepted = true
        marker.interceptedTableNames = tableNames
        mutableDb.transaction = originalTransaction
        await new Promise<void>((resolve, reject) => {
          const openRequest = indexedDB.open(mutableDb.name)
          openRequest.onerror = () => reject(openRequest.error ?? new Error('并发 IndexedDB 连接失败'))
          openRequest.onsuccess = () => {
            const connection = openRequest.result
            const transaction = connection.transaction('chapters', 'readwrite')
            const store = transaction.objectStore('chapters')
            const readRequest = store.get(chapterId)
            readRequest.onerror = () => reject(readRequest.error ?? new Error('并发读取小说行失败'))
            readRequest.onsuccess = () => {
              const row = readRequest.result
              if (!row) {
                transaction.abort()
                reject(new Error('并发修改目标小说行不存在'))
                return
              }
              store.put({
                ...row,
                content: '<p>事务外见证完成后，另一个浏览器连接并发改写了小说正文。</p>',
                updatedAt: Date.now() + 1,
              })
            }
            transaction.oncomplete = () => {
              marker.mutationCommitted = true
              connection.close()
              resolve()
            }
            transaction.onerror = () => {
              connection.close()
              reject(transaction.error ?? new Error('并发小说事务失败'))
            }
            transaction.onabort = () => {
              connection.close()
              reject(transaction.error ?? new Error('并发小说事务已中止'))
            }
          }
        })
      }
      return originalTransaction.apply(db, args)
    }
  }, fixture.chapterId)

  await start.getByRole('button', { name: '再次复验并创建 Build', exact: true }).click()
  const alert = start.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 180_000 })
  await expect(alert).toContainText('Creator 来源在原子授权边界已经变化')

  const result = await page.evaluate(async projectId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const marker = (window as any).__creatorNovelCasRace
    const [production, briefs, builds] = await Promise.all([
      db.productProductions.where('projectId').equals(projectId).first(),
      db.productProductionBriefs.where('projectId').equals(projectId).toArray(),
      db.productBuilds.where('projectId').equals(projectId).toArray(),
    ])
    return {
      marker,
      productionStatus: production?.status ?? null,
      currentBuildNumber: production?.currentBuildNumber ?? null,
      authorizedBriefCount: briefs.filter((row: any) => row.status === 'authorized').length,
      buildCount: builds.length,
    }
  }, fixture.projectId)
  expect(result.marker).toMatchObject({
    transactionIntercepted: true,
    mutationCommitted: true,
  })
  expect(result.marker.interceptedTableNames).toEqual(expect.arrayContaining([
    'chapters',
    'productBuilds',
    'productProductionCommands',
  ]))
  expect(result).toMatchObject({
    productionStatus: 'brief-ready',
    currentBuildNumber: null,
    authorizedBriefCount: 0,
    buildCount: 0,
  })
})
