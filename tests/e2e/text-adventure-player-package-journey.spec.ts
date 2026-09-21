import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

async function finishNarration(player: Locator) {
  const continueButton = player.locator('.adventure-narrative-continue')
  // The strict technical package deliberately contains one long scene whose
  // repeated sentences are presented as separate readable units.
  for (let index = 0; index < 400 && await continueButton.count(); index += 1) {
    await continueButton.last().click()
  }
  await expect(continueButton).toHaveCount(0)
}

async function chooseVisibleAction(player: Locator, label: string) {
  const action = player.getByRole('button', { name: new RegExp(`${label}$`) }).last()
  const entries = player.locator('.adventure-console-entry')
  const priorEntryCount = await entries.count()
  await expect(action).toBeVisible()
  await expect(action).toBeEnabled()
  await action.click()
  await expect.poll(() => entries.count()).toBeGreaterThan(priorEntryCount)
  await finishNarration(player)
}

async function createImportWorkspace(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('文字冒险 UI 往返技术工作区')
  await page.getByPlaceholder('一句话描述这个世界或作品').fill('仅用于验证产品包导入和玩家界面的隔离工作区。')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()
  await expect(page.locator('.sf-worlds-featured').getByRole('heading', { name: '文字冒险 UI 往返技术工作区', exact: true })).toBeVisible()
}

test('制作页真实下载的文字冒险包可在全新 Work 上传、存档恢复、分支双结局并安全删除', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-player-package-journey-e2e')
  })
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  const source = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [worldModule, candidateModule, e2eModule, schemaModule] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-adventure-community-package.ts'),
      importer('/storyforge/tests/helpers/text-adventure-flagship-e2e.ts'),
      importer('/storyforge/src/lib/db/schema.ts'),
    ])
    const owned = await worldModule.seedCurrentProductWorld('文字冒险真实下载源工作区')
    const sourceCatalog = await worldModule.loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id,
      productType: 'text-adventure',
    })
    const candidate = await candidateModule.createTextAdventureCommunityPackageFixtureV1({
      worldRelease: owned.release,
      sourceCatalog,
    })
    const seeded = await e2eModule.seedAuthoredTextAdventureCandidateForExportV1({
      scope: owned.scope,
      worldRelease: owned.release,
      candidate,
    })
    return {
      scope: owned.scope,
      worldReleaseId: owned.release.id,
      worldReleaseHash: owned.release.contentHash,
      productReleaseId: seeded.productReleaseId,
      productionId: seeded.productionId,
      title: candidate.dossier.title,
      candidatePackageHash: candidate.candidatePackageHash,
      distributionBundleHash: candidate.distributionBundle.bundleHash,
      releaseContentHash: candidate.distributionBundle.productRelease.contentHash,
      runtimePackageHash: candidate.dossier.runtimePackageHash,
      sourceReleaseCount: await schemaModule.db.productReleases.where('workId').equals(owned.scope.workId).count(),
    }
  })
  expect(source.sourceReleaseCount).toBe(1)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const sourcePanel = page.getByTestId('text-adventure-package-panel')
  await expect(sourcePanel).toBeVisible({ timeout: 15_000 })
  const downloadEvent = page.waitForEvent('download')
  await sourcePanel.getByRole('button', { name: '复验并导出产品包', exact: true }).click()
  const download = await downloadEvent
  const downloadPath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(downloadPath)
  await expect(sourcePanel.getByRole('status')).toContainText('完整产品包已下载')
  const downloaded = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    candidatePackageHash: string
    distributionBundle: {
      bundleHash: string
      productRelease: { contentHash: string; manifest: { packageHash: string } }
    }
    dossier: { title: string; runtimePackageHash: string }
  }
  expect(downloaded).toMatchObject({
    candidatePackageHash: source.candidatePackageHash,
    distributionBundle: {
      bundleHash: source.distributionBundleHash,
      productRelease: {
        contentHash: source.releaseContentHash,
        manifest: { packageHash: source.runtimePackageHash },
      },
    },
    dossier: { title: source.title, runtimePackageHash: source.runtimePackageHash },
  })

  await createImportWorkspace(page)

  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const enableProduction = page.getByRole('button', { name: '为当前项目显式启用', exact: true })
  if (await enableProduction.count()) await enableProduction.click()

  const packagePanel = page.getByTestId('text-adventure-package-panel')
  await expect(packagePanel).toBeVisible({ timeout: 15_000 })
  await packagePanel.getByLabel('上传文字冒险产品包').setInputFiles(downloadPath)
  // Successful import deliberately switches to the player; persistence and
  // provenance below are the durable success evidence, not a transient toast.
  await expect(page.getByTestId('adventure-game-player')).toBeVisible({ timeout: 15_000 })

  const imported = await page.evaluate(async candidatePackageHash => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, hashModule] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
    ])
    const release = (await db.productReleases.toArray()).find((row: any) => (
      row.distributionProvenance?.candidatePackageHash === candidatePackageHash
    ))
    if (!release?.id) throw new Error('真实文件上传后没有创建导入 Release')
    const project = await db.projects.get(release.projectId)
    if (!project?.workspaceUid) throw new Error('导入 Release 所属工作区缺少稳定身份')
    const manifest = JSON.parse(release.manifestJson)
    return {
      releaseId: release.id,
      workspaceUid: project.workspaceUid,
      scope: { projectId: release.projectId, worldId: release.worldId, workId: release.workId },
      releaseContentHash: release.contentHash,
      runtimePackageHash: manifest.packageHash,
      manifestHash: await hashModule.hashProductProductionValueV2(manifest),
      candidatePackageHash: release.distributionProvenance.candidatePackageHash,
      originalReleaseHash: release.distributionProvenance.originalReleaseHash,
    }
  }, source.candidatePackageHash)
  expect(imported).toMatchObject({
    releaseContentHash: source.releaseContentHash,
    runtimePackageHash: source.runtimePackageHash,
    manifestHash: source.releaseContentHash,
    candidatePackageHash: source.candidatePackageHash,
    originalReleaseHash: source.releaseContentHash,
  })
  expect(new URL(page.url()).searchParams.get('worldWorkspace')).toBe(imported.workspaceUid)

  const player = page.getByTestId('adventure-game-player')
  await expect(player).toBeVisible({ timeout: 15_000 })
  await player.getByRole('button', { name: new RegExp(`查看游戏：${source.title}`) }).click()
  await expect(player.getByRole('heading', { name: source.title })).toBeVisible()
  await player.getByRole('button', { name: '开始新冒险', exact: true }).click()
  await expect(player.getByRole('heading', { name: '封港仓房', exact: true })).toBeVisible()
  await finishNarration(player)
  await expect(player).toContainText('离线确定性模式')

  await player.getByRole('button', { name: '角色', exact: true }).first().click()
  const characterPanel = page.getByRole('region', { name: '角色状态' })
  await expect(characterPanel).toContainText('守灯学徒 · 等级 1')
  await expect(characterPanel).toContainText('生命')
  await expect(characterPanel).toContainText('基础属性')
  await expect(characterPanel).toContainText('感知')
  await characterPanel.getByRole('button', { name: '关闭面板' }).click()

  await player.getByRole('button', { name: /背包/ }).first().click()
  const inventoryPanel = page.getByRole('region', { name: '背包' })
  await expect(inventoryPanel).toContainText('守灯披风')
  await expect(inventoryPanel).toContainText('应急灯油')
  await inventoryPanel.getByRole('button', { name: '关闭面板' }).click()

  await player.getByRole('button', { name: '任务', exact: true }).first().click()
  const questPanel = page.getByRole('region', { name: '任务' })
  await expect(questPanel).toContainText('让灯塔重新发光')
  await expect(questPanel).toContainText('穿好守灯披风并确认出发装备')
  await questPanel.getByRole('button', { name: '关闭面板' }).click()

  await chooseVisibleAction(player, '装备守灯披风')
  await chooseVisibleAction(player, '前往回声盐沼')
  await chooseVisibleAction(player, '辨认稳定路线')
  await expect(player).toContainText('生命 8')
  await chooseVisibleAction(player, '沿石脊前往灯塔')
  await chooseVisibleAction(player, '取下备用透镜')

  await player.getByRole('button', { name: '任务', exact: true }).first().click()
  await expect(questPanel).toContainText('已完成')
  await expect(questPanel).toContainText('取得备用透镜')
  await questPanel.getByRole('button', { name: '关闭面板' }).click()

  await player.getByRole('button', { name: /背包/ }).first().click()
  await expect(inventoryPanel).toContainText('备用透镜')
  await inventoryPanel.getByRole('button', { name: '关闭面板' }).click()

  await chooseVisibleAction(player, '带着透镜进入灯塔核心')
  await chooseVisibleAction(player, '继续听完争论')
  await chooseVisibleAction(player, '先承诺不放弃任何求救者')

  await player.getByRole('button', { name: '存档', exact: true }).first().click()
  const savesPanel = page.getByRole('region', { name: '存档与时间线' })
  await savesPanel.getByPlaceholder('为此刻命名').fill('终局抉择前')
  await savesPanel.getByRole('button', { name: '保存', exact: true }).click()
  await expect(savesPanel.getByRole('button', { name: /终局抉择前.*从这里分支/ })).toBeVisible()
  await savesPanel.getByRole('button', { name: '关闭面板' }).click()

  const damagedCheckpoint = await page.evaluate(async scope => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const checkpoint = (await db.productRuntimeCheckpoints.where('projectId').equals(scope.projectId).toArray())
      .find((row: any) => row.name === '终局抉择前')
    if (!checkpoint?.id) throw new Error('刚保存的真实检查点不存在')
    await db.productRuntimeCheckpoints.update(checkpoint.id, {
      stateJson: '{"damaged":true}',
      stateHash: '0'.repeat(64),
    })
    return { id: checkpoint.id, sessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence }
  }, imported.scope)

  await chooseVisibleAction(player, '校准归航光路')
  await chooseVisibleAction(player, '把灯火引向求救船')
  await chooseVisibleAction(player, '确认获救者已经靠岸')
  await chooseVisibleAction(player, '承担裂隙仍存的后果')
  await expect(player).toContainText('冒险结束')
  await expect(player).toContainText('海上归灯')

  await page.reload({ waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).searchParams.get('worldWorkspace')).toBe(imported.workspaceUid)
  await page.getByTestId('product-tab-text-games').click()
  await expect(page.locator('.sf-binding-banner')).toContainText('文字冒险 UI 往返技术工作区')
  const restoredPlayer = page.getByTestId('adventure-game-player')
  // A completed timeline remains reopenable after refresh so the player can
  // review its ending, inspect the event log, and fork an earlier checkpoint.
  // The launcher deliberately labels that timeline "已通关" rather than
  // "可继续"; both states must remain selectable.
  const restoredSave = restoredPlayer.getByRole('button', { name: /雾潮灯塔.*(?:可继续|已通关)/ }).first()
  await expect(restoredSave).toBeVisible({ timeout: 15_000 })
  await restoredSave.click()
  await expect(restoredPlayer).toContainText('海上归灯', { timeout: 15_000 })
  await expect(restoredPlayer.getByRole('log', { name: '冒险文字记录' })).toContainText('装备守灯披风')

  await restoredPlayer.getByRole('button', { name: '存档', exact: true }).first().click()
  const restoredSaves = page.getByRole('region', { name: '存档与时间线' })
  await restoredSaves.getByRole('button', { name: /终局抉择前.*从这里分支/ }).click()
  await expect(restoredSaves).toContainText('终局抉择前')
  await restoredSaves.getByRole('button', { name: '关闭面板' }).click()

  const recovered = await page.evaluate(async ({ checkpointId, parentSessionId, throughSequence }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, runtimeApi] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product/runtime-api.ts'),
    ])
    const originalStillMarkedDamaged = !await runtimeApi.verifyProductRuntimeCheckpoint(checkpointId)
    const recoveryCheckpoint = (await db.productRuntimeCheckpoints.where('sessionId').equals(parentSessionId).toArray())
      .find((row: any) => row.name === `恢复 #${checkpointId} · 终局抉择前`)
    const recoveryValid = !!recoveryCheckpoint?.id
      && await runtimeApi.verifyProductRuntimeCheckpoint(recoveryCheckpoint.id)
    const children = await db.productRuntimeSessions.where('parentSessionId').equals(parentSessionId).toArray()
    const child = children.sort((left: any, right: any) => (right.id ?? 0) - (left.id ?? 0))[0]
    return {
      originalStillMarkedDamaged,
      recoveryValid,
      recoveryThroughSequence: recoveryCheckpoint?.throughSequence,
      childParentSessionId: child?.parentSessionId,
      childThroughSequence: child?.parentThroughSequence,
      expectedThroughSequence: throughSequence,
    }
  }, {
    checkpointId: damagedCheckpoint.id,
    parentSessionId: damagedCheckpoint.sessionId,
    throughSequence: damagedCheckpoint.throughSequence,
  })
  expect(recovered).toEqual({
    originalStillMarkedDamaged: true,
    recoveryValid: true,
    recoveryThroughSequence: damagedCheckpoint.throughSequence,
    childParentSessionId: damagedCheckpoint.sessionId,
    childThroughSequence: damagedCheckpoint.throughSequence,
    expectedThroughSequence: damagedCheckpoint.throughSequence,
  })

  await chooseVisibleAction(restoredPlayer, '校准封闭光路')
  await chooseVisibleAction(restoredPlayer, '封闭裂隙保护港城')
  await chooseVisibleAction(restoredPlayer, '确认港城屏障已经稳定')
  await chooseVisibleAction(restoredPlayer, '承担船队失去灯火的后果')
  await expect(restoredPlayer).toContainText('冒险结束')
  await expect(restoredPlayer).toContainText('长夜守门')

  const sharedMedia = await page.evaluate(async ({ scope, importedReleaseId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { putMediaBlobObject }, { stampNewRecord }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product-production/media-blob-store.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const importedRelease = await db.productReleases.get(importedReleaseId)
    if (!importedRelease) throw new Error('导入 Release 在共享 Blob 测试前丢失')
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#123456"/></svg>').buffer
    const blob = await putMediaBlobObject({
      scope,
      data: bytes,
      mimeType: 'image/svg+xml',
      backend: 'indexeddb',
      sanitizedSvg: true,
    })
    const exclusiveBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#654321"/></svg>').buffer
    const exclusiveBlob = await putMediaBlobObject({
      scope,
      data: exclusiveBytes,
      mimeType: 'image/svg+xml',
      backend: 'indexeddb',
      sanitizedSvg: true,
    })
    const retainerReleaseId = await db.productReleases.add(stampNewRecord(scope, 'productReleases', {
      ...scope,
      productionKey: `e2e-shared-retainer-${importedReleaseId}`,
      productType: 'text-adventure',
      worldReleaseId: null,
      version: 1,
      label: '共享媒资保留 Release',
      manifestJson: importedRelease.manifestJson,
      contentHash: importedRelease.contentHash,
      createdAt: Date.now(),
    }, { owner: 'work' }))
    const bind = async (productReleaseId: number, assetKey: string, selectedBlob = blob) => {
      const mediaAssetId = await db.productMediaAssets.add(stampNewRecord(scope, 'productMediaAssets', {
        ...scope,
        ownerKind: 'release',
        productType: 'text-adventure',
        productReleaseId,
        productRuntimeSessionId: null,
        assetKey,
        version: 1,
        kind: 'background',
        name: '共享生命周期技术媒资',
        mimeType: selectedBlob.mimeType,
        byteSize: selectedBlob.byteSize,
        width: 16,
        height: 16,
        durationMs: null,
        contentHash: selectedBlob.contentHash,
        source: 'playwright-lifecycle-fixture',
        license: 'CC0-1.0',
        altText: '共享 Blob 生命周期技术图。',
        characterTag: '',
        sceneTag: 'lifecycle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { owner: 'work' }))
      await db.productMediaBlobs.add(stampNewRecord(scope, 'productMediaBlobs', {
        ...scope,
        mediaAssetId,
        blobObjectId: selectedBlob.id,
        data: null,
        createdAt: Date.now(),
      }, { owner: 'work' }))
      return mediaAssetId
    }
    const importedAssetId = await bind(importedReleaseId, 'asset.e2e.shared.imported')
    const retainedAssetId = await bind(retainerReleaseId, 'asset.e2e.shared.retainer')
    const exclusiveAssetId = await bind(importedReleaseId, 'asset.e2e.exclusive.imported', exclusiveBlob)
    return {
      blobObjectId: blob.id,
      exclusiveBlobObjectId: exclusiveBlob.id,
      retainerReleaseId,
      importedAssetId,
      retainedAssetId,
      exclusiveAssetId,
    }
  }, { scope: imported.scope, importedReleaseId: imported.releaseId })

  await page.getByRole('button', { name: '制作', exact: true }).click()
  const lifecyclePanel = page.getByTestId('text-adventure-package-panel')
  await expect(lifecyclePanel.getByTestId('text-adventure-imported-release-copies')).toContainText(source.title)
  await lifecyclePanel.getByRole('button', { name: '删除本地副本', exact: true }).click()
  const deleteDialog = page.getByRole('dialog')
  await expect(deleteDialog).toContainText('全部本地存档')
  await deleteDialog.getByRole('button', { name: '删除副本', exact: true }).click()
  await expect(page.getByTestId('adventure-game-player')).toBeVisible({ timeout: 15_000 })

  const lifecycle = await page.evaluate(async ids => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return {
      importedReleaseExists: !!await db.productReleases.get(ids.importedReleaseId),
      importedSessionCount: await db.productRuntimeSessions.where('productReleaseId').equals(ids.importedReleaseId).count(),
      sourceReleaseExists: !!await db.productReleases.get(ids.sourceProductReleaseId),
      sourceProductionReleaseId: (await db.productProductions.get(ids.sourceProductionId))?.currentProductReleaseId ?? null,
      sourceWorldReleaseHash: (await db.worldReleases.get(ids.sourceWorldReleaseId))?.contentHash ?? null,
      retainerReleaseExists: !!await db.productReleases.get(ids.retainerReleaseId),
      sharedBlobExists: !!await db.mediaBlobObjects.get(ids.blobObjectId),
      sharedBindingCount: await db.productMediaBlobs.where('blobObjectId').equals(ids.blobObjectId).count(),
      exclusiveBlobExists: !!await db.mediaBlobObjects.get(ids.exclusiveBlobObjectId),
      exclusiveBindingCount: await db.productMediaBlobs.where('blobObjectId').equals(ids.exclusiveBlobObjectId).count(),
      importedAssetExists: !!await db.productMediaAssets.get(ids.importedAssetId),
      exclusiveAssetExists: !!await db.productMediaAssets.get(ids.exclusiveAssetId),
      retainedAssetExists: !!await db.productMediaAssets.get(ids.retainedAssetId),
    }
  }, {
    importedReleaseId: imported.releaseId,
    sourceProductReleaseId: source.productReleaseId,
    sourceProductionId: source.productionId,
    sourceWorldReleaseId: source.worldReleaseId,
    retainerReleaseId: sharedMedia.retainerReleaseId,
    blobObjectId: sharedMedia.blobObjectId,
    exclusiveBlobObjectId: sharedMedia.exclusiveBlobObjectId,
    importedAssetId: sharedMedia.importedAssetId,
    exclusiveAssetId: sharedMedia.exclusiveAssetId,
    retainedAssetId: sharedMedia.retainedAssetId,
  })
  expect(lifecycle).toEqual({
    importedReleaseExists: false,
    importedSessionCount: 0,
    sourceReleaseExists: true,
    sourceProductionReleaseId: source.productReleaseId,
    sourceWorldReleaseHash: source.worldReleaseHash,
    retainerReleaseExists: true,
    sharedBlobExists: true,
    sharedBindingCount: 1,
    exclusiveBlobExists: false,
    exclusiveBindingCount: 0,
    importedAssetExists: false,
    exclusiveAssetExists: false,
    retainedAssetExists: true,
  })
})
