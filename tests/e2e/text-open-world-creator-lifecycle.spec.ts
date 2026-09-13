import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-creator-lifecycle-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '你的创作与游玩空间', exact: true }))
    .toBeVisible({ timeout: 20_000 })
}

async function seedPublishedCreator(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { createTextOpenWorldCreatorReleaseFixtureV1 },
      { acceptTextOpenWorldSourcePinBundleV1 },
      { createTextOpenWorldInstance },
      { hashProductProductionValueV2 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/text-open-world-creator-release.ts'),
      importer('/storyforge/src/lib/open-world/source-pin.ts'),
      importer('/storyforge/src/lib/product/runtime-instances.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
    ])
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const sourceArtifacts = await acceptTextOpenWorldSourcePinBundleV1({
      scope: fixture.scope,
      buildId: fixture.creator.buildId,
      controlEpoch: fixture.creator.controlEpoch,
      bundle: fixture.pinBundle,
    })
    const now = Date.now()
    const release = {
      ...fixture.scope,
      productionKey: fixture.creator.productionKey,
      productType: 'text-open-world',
      worldReleaseId: fixture.localWorldReleaseId,
      version: 1,
      label: '浏览器 Creator 正式发布',
      manifestJson: JSON.stringify(fixture.manifest),
      contentHash: await hashProductProductionValueV2(fixture.manifest),
      createdAt: now,
    }
    release.id = await db.productReleases.add(release)
    await db.productBuilds.update(fixture.creator.buildId, {
      status: 'released',
      manifestHash: fixture.manifest.productionProvenance.buildManifestHash,
      packageHash: fixture.manifest.packageHash,
      rootTerminalReceiptHash: fixture.manifest.productionProvenance.rootTerminalReceiptHash,
      releasedProductReleaseId: release.id,
      completedAt: now,
      updatedAt: now,
    })
    await db.productProductions.update(fixture.creator.productionId, {
      title: '浏览器 Creator 完整工作台',
      status: 'released',
      currentProductReleaseId: release.id,
      updatedAt: now,
    })
    const session = await createTextOpenWorldInstance({
      scope: fixture.scope,
      productReleaseId: release.id,
      title: '浏览器 Creator 正式存档',
      seed: 'g5-12-browser-roundtrip',
    })
    const project = await db.projects.get(fixture.scope.projectId)
    return {
      projectId: fixture.scope.projectId,
      projectName: project.name,
      productionKey: fixture.creator.productionKey,
      sessionTitle: session.title,
      sourceArtifactCount: 1 + sourceArtifacts.unitArtifacts.length,
    }
  })
}

function projectRow(page: Page, name: string) {
  return page.getByTestId('workspace-library').locator('article').filter({ hasText: name })
}

test('Creator正式游戏经UI篡改拒绝、导出导入、玩家恢复与项目删除保持完整', async ({ page }) => {
  test.setTimeout(300_000)
  await openHome(page)
  const seeded = await seedPublishedCreator(page)

  await page.goto(`./workspace/${seeded.projectId}`)
  await expect(page.getByTitle(seeded.projectName)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()

  const exportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const backup = await exportDownload
  const backupPath = await backup.path()
  expect(backupPath).not.toBeNull()
  const backupText = await readFile(backupPath!, 'utf8')
  const backupData = JSON.parse(backupText)
  expect(backupData.productBuildArtifacts).toHaveLength(seeded.sourceArtifactCount)

  const projectsBeforeTamperedImport = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.projects.count()
  })
  const tampered = structuredClone(backupData)
  const tamperedManifest = JSON.parse(tampered.productReleases[0].manifestJson)
  tamperedManifest.packageHash = '0'.repeat(64)
  tampered.productReleases[0].manifestJson = JSON.stringify(tamperedManifest)
  let fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
  await (await fileChooser).setFiles({
    name: 'tampered-creator-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  })
  await expect(page.getByText(/导入失败：.*ProductRelease 内容、身份或Hash无效/))
    .toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.projects.count()
  })).toBe(projectsBeforeTamperedImport)

  fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
  await (await fileChooser).setFiles(backupPath!)
  await expect.poll(() => Number(page.url().match(/\/workspace\/(\d+)$/)?.[1]), {
    timeout: 30_000,
  }).not.toBe(seeded.projectId)
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  const importedProjectId = Number(page.url().match(/\/workspace\/(\d+)$/)?.[1])
  expect(importedProjectId).toBeGreaterThan(0)
  expect(importedProjectId).not.toBe(seeded.projectId)

  const imported = await page.evaluate(async ({ importedProjectId, productionKey }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { assertProductReleaseUnchanged },
      { verifyTextOpenWorldVNextSessionBindingV1 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product/releases.ts'),
      importer('/storyforge/src/lib/open-world/session-binding.ts'),
    ])
    const [project, production, build, release, session] = await Promise.all([
      db.projects.get(importedProjectId),
      db.productProductions.where('projectId').equals(importedProjectId)
        .filter((row: any) => row.productionKey === productionKey).first(),
      db.productBuilds.where('projectId').equals(importedProjectId).first(),
      db.productReleases.where('projectId').equals(importedProjectId).first(),
      db.productRuntimeSessions.where('projectId').equals(importedProjectId).first(),
    ])
    if (!project || !production || !build || !release || !session) {
      throw new Error('浏览器 Creator 导入缺少正式生命周期行')
    }
    await assertProductReleaseUnchanged(release.id)
    await verifyTextOpenWorldVNextSessionBindingV1(session)
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(build.id).count()
    const commands = await db.productProductionCommands.where('productionId').equals(production.id).toArray()
    const result = commands
      .map((command: any) => JSON.parse(command.resultJson))
      .find((candidate: any) => candidate.buildId != null)
    if (!result) throw new Error('浏览器 Creator 导入缺少 Build 命令回执')
    const importedName = `${project.name}（导入副本）`
    if (!project.activeWorkId) throw new Error('浏览器 Creator 导入缺少活动作品')
    await db.works.update(project.activeWorkId, { title: importedName, updatedAt: Date.now() })
    return {
      importedName,
      sessionTitle: session.title,
      artifacts,
      commandBuildId: result.buildId,
      buildId: build.id,
      releaseId: release.id,
      productionReleaseId: production.currentProductReleaseId,
      sessionReleaseId: session.productReleaseId,
    }
  }, { importedProjectId, productionKey: seeded.productionKey })
  expect(imported).toMatchObject({
    sessionTitle: seeded.sessionTitle,
    artifacts: seeded.sourceArtifactCount,
    commandBuildId: imported.buildId,
    productionReleaseId: imported.releaseId,
    sessionReleaseId: imported.releaseId,
  })

  await page.goto('./')
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(imported.sessionTitle, { exact: true })).toBeVisible({ timeout: 30_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: imported.sessionTitle }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('text-open-world-runtime-source')).toContainText('PRODUCT RELEASE v1 · 已固定')

  await page.goto('./')
  const importedRow = projectRow(page, imported.importedName)
  await expect(importedRow).toHaveCount(1)
  await importedRow.getByRole('button', { name: `删除 ${imported.importedName}`, exact: true }).click()
  await importedRow.getByRole('button', { name: `确认删除 ${imported.importedName}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: '危险操作:删除项目' })).toBeVisible()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('heading', { name: '是否立即下载备份(JSON 文件到本地)?' })).toBeVisible()
  await page.getByRole('button', { name: '已备份，继续', exact: true }).click()
  await expect(projectRow(page, imported.importedName)).toHaveCount(0)
  await expect(projectRow(page, seeded.projectName)).toHaveCount(1)

  const remaining = await page.evaluate(async ({ importedProjectId, sourceProjectId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return {
      importedProject: Boolean(await db.projects.get(importedProjectId)),
      sourceProject: Boolean(await db.projects.get(sourceProjectId)),
      productions: await db.productProductions.where('projectId').equals(importedProjectId).count(),
      builds: await db.productBuilds.where('projectId').equals(importedProjectId).count(),
      artifacts: await db.productBuildArtifacts.where('projectId').equals(importedProjectId).count(),
      releases: await db.productReleases.where('projectId').equals(importedProjectId).count(),
      sessions: await db.productRuntimeSessions.where('projectId').equals(importedProjectId).count(),
      runs: await db.agentRuns.where('projectId').equals(importedProjectId).count(),
    }
  }, { importedProjectId, sourceProjectId: seeded.projectId })
  expect(remaining).toEqual({
    importedProject: false,
    sourceProject: true,
    productions: 0,
    builds: 0,
    artifacts: 0,
    releases: 0,
    sessions: 0,
    runs: 0,
  })
})
