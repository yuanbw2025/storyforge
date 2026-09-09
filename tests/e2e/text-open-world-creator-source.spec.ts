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

test('小说项目无需世界项目即可从作品入口完成选区预检与来源确认，且不创建产品生命周期记录', async ({ page }) => {
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
  await expect(page.getByTestId('text-open-world-creator-boundary'))
    .toContainText('尚未创建 Production、Build、Release 或 Session')
  expect(await readProtectedTableCounts(page)).toEqual(before)
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
  await expect(page.getByTestId('text-open-world-creator-boundary'))
    .toContainText('来源交接已确认')
  expect(await readProtectedTableCounts(page)).toEqual(before)
})
