import { expect, test } from '@playwright/test'

test('文字冒险候选包在新 Work 上传后可从正式 Release 完成双结局并刷新恢复', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-package-roundtrip-e2e')
  })
  await page.goto('./')
  const prepared = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [fixtureModule, worldModule, schemaModule] = await Promise.all([
      importer('/storyforge/tests/helpers/text-adventure-community-package.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/src/lib/db/schema.ts'),
    ])
    const candidate = await fixtureModule.createTextAdventureCommunityPackageFixtureV1()
    const owned = await worldModule.seedCurrentProductWorld('文字冒险产品包浏览器往返')
    const project = await schemaModule.db.projects.get(owned.scope.projectId)
    await schemaModule.db.projects.update(owned.scope.projectId, {
      productPlatformOptIns: {
        ...(project?.productPlatformOptIns ?? {}),
        productProductionV3: true,
      },
    })
    return {
      packageJson: JSON.stringify(candidate),
      title: candidate.dossier.title,
      candidatePackageHash: candidate.candidatePackageHash,
      targetScope: owned.scope,
      sourceReleaseCount: await schemaModule.db.worldReleases
        .where('worldId').equals(owned.scope.worldId).count(),
    }
  })
  expect(prepared.sourceReleaseCount).toBe(1)

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const packagePanel = page.getByTestId('text-adventure-package-panel')
  await expect(packagePanel).toBeVisible({ timeout: 15_000 })
  await packagePanel.getByLabel('上传文字冒险产品包').setInputFiles({
    name: 'technical-lifecycle-fixture.storyforge-adventure.json',
    mimeType: 'application/json',
    buffer: Buffer.from(prepared.packageJson),
  })

  await expect(page.getByTestId('adventure-game-player')).toBeVisible({ timeout: 15_000 })
  const player = page.getByTestId('adventure-game-player')
  await player.getByRole('button', { name: new RegExp(`查看游戏：${prepared.title}`) }).click()
  await expect(player.getByRole('heading', { name: prepared.title })).toBeVisible()
  await player.getByRole('button', { name: '开始新冒险', exact: true }).click()
  await expect(player).toContainText('封港仓房')

  const completed = await page.evaluate(async candidatePackageHash => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, runtimeApi] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/adventure/runtime-api.ts'),
    ])
    const parent = await db.productRuntimeSessions.orderBy('id').last()
    if (!parent?.id) throw new Error('导入 Release 没有创建玩家会话')
    const act = async (sessionId: number, actionKey: string) => {
      const base = await runtimeApi.readProductRuntimeStateVersion(sessionId)
      await runtimeApi.commitAdventureAction({
        sessionId, actionKey,
        commandId: `package-e2e:${sessionId}:${actionKey}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
    }
    await act(parent.id, 'action.equip.cloak')
    await act(parent.id, 'action.move.marsh')
    await act(parent.id, 'action.find.route')
    await act(parent.id, 'action.move.tower')
    await act(parent.id, 'action.take.lens')
    const choose = (sessionId: number, choiceKey: string) => runtimeApi.commitAdventureNarrativeChoice({
      sessionId, choiceKey, commandId: `package-e2e:${sessionId}:${choiceKey}`,
    })
    await choose(parent.id, 'choice.enter-core')
    await choose(parent.id, 'choice.listen')
    await choose(parent.id, 'choice.promise-people')
    const checkpoint = await runtimeApi.createProductRuntimeCheckpoint({
      sessionId: parent.id, name: '导入包终局分支点',
    })
    const branch = await runtimeApi.branchProductRuntimeSession({
      parentSessionId: parent.id,
      throughSequence: checkpoint.throughSequence,
      title: '导入包 · 封闭光路分支',
    })
    await act(parent.id, 'action.prepare.rescue')
    await choose(parent.id, 'choice.rescue')
    await act(branch.id, 'action.prepare.seal')
    await choose(branch.id, 'choice.seal')
    const [parentState, branchState, release, worldReleaseCount] = await Promise.all([
      runtimeApi.readProductRuntimeState(parent.id),
      runtimeApi.readProductRuntimeState(branch.id),
      db.productReleases.get(parent.productReleaseId),
      db.worldReleases.where('worldId').equals(parent.worldId).count(),
    ])
    return {
      parentSessionId: parent.id,
      branchSessionId: branch.id,
      parentEnding: parentState.narrative?.endingKey,
      branchEnding: branchState.narrative?.endingKey,
      parentCompleted: parentState.narrative?.completed,
      branchCompleted: branchState.narrative?.completed,
      provenance: release?.distributionProvenance,
      releaseCount: await db.productReleases.where('workId').equals(parent.workId).count(),
      worldReleaseCount,
      sourceKind: parent.productReleaseId != null && parent.productBuildId == null ? 'release' : 'invalid',
      candidatePackageHash,
    }
  }, prepared.candidatePackageHash)
  expect(completed).toMatchObject({
    parentEnding: 'ending.rescue',
    branchEnding: 'ending.seal',
    parentCompleted: true,
    branchCompleted: true,
    provenance: {
      source: 'local-file',
      candidatePackageHash: prepared.candidatePackageHash,
      remoteCreatorIdentityVerified: false,
      localCopyPreserved: true,
    },
    releaseCount: 1,
    worldReleaseCount: 1,
    sourceKind: 'release',
  })

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  const restored = page.getByTestId('adventure-game-player')
  await restored.getByRole('button', { name: /雾潮灯塔.*新冒险.*可继续/ }).click()
  await expect(restored).toContainText('海上归灯', { timeout: 15_000 })
  await expect(restored).toContainText('冒险结束')

  await page.getByRole('button', { name: '制作', exact: true }).click()
  const lifecyclePanel = page.getByTestId('text-adventure-package-panel')
  await expect(lifecyclePanel.getByTestId('text-adventure-imported-release-copies')).toContainText(prepared.title)
  await lifecyclePanel.getByRole('button', { name: '删除本地副本', exact: true }).click()
  const deleteDialog = page.getByRole('dialog')
  await expect(deleteDialog).toContainText('全部本地存档')
  await deleteDialog.getByRole('button', { name: '删除副本', exact: true }).click()
  await expect(page.getByTestId('adventure-game-player')).toContainText(/全部游戏\s*0 部可游玩作品/, { timeout: 15_000 })

  const removed = await page.evaluate(async targetScope => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const assetIds = (await db.productMediaAssets.where('workId').equals(targetScope.workId).primaryKeys()) as number[]
    return {
      releaseCount: await db.productReleases.where('workId').equals(targetScope.workId).count(),
      sessionCount: await db.productRuntimeSessions.where('workId').equals(targetScope.workId).count(),
      mediaAssetCount: assetIds.length,
      mediaBindingCount: assetIds.length
        ? await db.productMediaBlobs.where('mediaAssetId').anyOf(assetIds).count()
        : 0,
      blobObjectCount: await db.mediaBlobObjects.where('workId').equals(targetScope.workId).count(),
      worldReleaseCount: await db.worldReleases.where('worldId').equals(targetScope.worldId).count(),
    }
  }, prepared.targetScope)
  expect(removed).toEqual({
    releaseCount: 0,
    sessionCount: 0,
    mediaAssetCount: 0,
    mediaBindingCount: 0,
    blobObjectCount: 0,
    worldReleaseCount: 1,
  })
})
