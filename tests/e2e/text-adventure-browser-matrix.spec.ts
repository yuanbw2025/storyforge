import { expect, test } from '@playwright/test'

test('浏览器持久层覆盖随机长回合、资源临界与支线跳过/完成矩阵', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-browser-matrix-e2e')
  })
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [worldModule, matrixModule, buildModule, runtimeInstanceModule, runtimeApi, schemaModule] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-adventure-flagship-e2e.ts'),
      importer('/storyforge/tests/helpers/current-product-build.ts'),
      importer('/storyforge/src/lib/product/runtime-instances.ts'),
      importer('/storyforge/src/lib/adventure/runtime-api.ts'),
      importer('/storyforge/src/lib/db/schema.ts'),
    ])
    const owned = await worldModule.seedCurrentProductWorld('文字冒险浏览器验收矩阵')
    const sourceCatalog = await worldModule.loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id,
      productType: 'text-adventure',
    })
    const runtimePackage = matrixModule.createTextAdventureBrowserMatrixRuntimePackageV2({
      worldRelease: owned.release,
      sourceCatalog,
    })
    const built = await buildModule.seedCurrentProductBuild({
      scope: owned.scope,
      worldRelease: owned.release,
      runtimePackage,
      title: '文字冒险浏览器矩阵',
      seed: 'matrix-long-run-seed',
    })
    const newSession = (title: string, seed: string) => runtimeInstanceModule.createProductRuntimeInstanceFromSource({
      scope: owned.scope,
      source: {
        kind: 'build',
        productBuildId: built.buildId,
        expectedPreviewHash: built.preview.previewHash,
      },
      title,
      seed,
    })
    const act = async (sessionId: number, actionKey: string, nonce: string) => {
      const base = await runtimeApi.readProductRuntimeStateVersion(sessionId)
      return runtimeApi.commitAdventureAction({
        sessionId,
        actionKey,
        commandId: `browser-matrix:${sessionId}:${nonce}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
    }
    const choose = (sessionId: number, choiceKey: string) => runtimeApi.commitAdventureNarrativeChoice({
      sessionId,
      choiceKey,
      commandId: `browser-matrix:${sessionId}:${choiceKey}`,
    })
    const finishMain = async (sessionId: number) => {
      await act(sessionId, 'action.equip.cloak', 'equip')
      await act(sessionId, 'action.move.marsh', 'move-marsh')
      await act(sessionId, 'action.find.route', 'find-route')
      await act(sessionId, 'action.move.tower', 'move-tower')
      await act(sessionId, 'action.take.lens', 'take-lens')
      await choose(sessionId, 'choice.enter-core')
      await act(sessionId, 'action.prepare.rescue', 'prepare-rescue')
      await choose(sessionId, 'choice.rescue')
      return runtimeApi.readProductRuntimeState(sessionId)
    }

    const longRunSession = built.session
    for (let index = 0; index < 64; index += 1) {
      await act(longRunSession.id, 'action.random-watch', `random-${index}`)
    }
    const longRunBeforeReload = await runtimeApi.readProductRuntimeState(longRunSession.id)
    const longRunAfterReload = await runtimeApi.readProductRuntimeState(longRunSession.id)
    const longRunEvents = await schemaModule.db.productRuntimeEvents
      .where('sessionId').equals(longRunSession.id).toArray()

    const resourceSession = await newSession('资源临界', 'matrix-resource-edge-seed')
    for (let index = 0; index < 7; index += 1) {
      await act(resourceSession.id, 'action.resource-edge', `resource-${index}`)
    }
    const resourceState = await runtimeApi.readProductRuntimeState(resourceSession.id)
    const resourceEvents = await schemaModule.db.productRuntimeEvents
      .where('sessionId').equals(resourceSession.id).toArray()
    const resourceChecks = resourceEvents.filter((event: any) => event.type === 'adventure.check.resolved')
      .map((event: any) => JSON.parse(event.payloadJson).evidence.outcome)

    const skippedSession = await newSession('跳过支线', 'matrix-side-skip-seed')
    const skippedState = await finishMain(skippedSession.id)

    const completedSession = await newSession('完成支线', 'matrix-side-complete-seed')
    await act(completedSession.id, 'action.side.accept', 'side-accept')
    await act(completedSession.id, 'action.side.compare', 'side-compare')
    await act(completedSession.id, 'action.side.finish', 'side-finish')
    const completedBeforeMain = await runtimeApi.readProductRuntimeState(completedSession.id)
    const completedState = await finishMain(completedSession.id)

    return {
      longRun: {
        actionCount: longRunBeforeReload.adventure?.actionHistory.length,
        checkCount: longRunBeforeReload.adventure?.checks.length,
        lastSequence: longRunBeforeReload.lastSequence,
        replaySequence: longRunAfterReload.lastSequence,
        persistedEventCount: longRunEvents.length,
        distinctRolls: new Set(longRunBeforeReload.adventure?.checks.map((check: any) => check.dice.join(','))).size,
      },
      resourceEdge: {
        stamina: resourceState.adventure?.resources['resource.stamina'],
        outcomes: resourceChecks,
        actionCount: resourceState.adventure?.actionHistory.length,
      },
      skippedSideQuest: {
        endingKey: skippedState.narrative?.endingKey,
        status: skippedState.adventure?.quests.find((quest: any) => quest.questKey === 'quest.side-signal-ledger')?.status,
      },
      completedSideQuest: {
        endingKey: completedState.narrative?.endingKey,
        statusBeforeMain: completedBeforeMain.adventure?.quests.find((quest: any) => quest.questKey === 'quest.side-signal-ledger')?.status,
        experienceBeforeMain: completedBeforeMain.adventure?.resources['resource.experience'],
        coinBeforeMain: completedBeforeMain.adventure?.resources['resource.coin'],
      },
    }
  })

  expect(result.longRun).toMatchObject({
    actionCount: 64,
    checkCount: 64,
    replaySequence: result.longRun.lastSequence,
  })
  expect(result.longRun.persistedEventCount).toBeGreaterThanOrEqual(64 * 3)
  expect(result.longRun.distinctRolls).toBeGreaterThan(1)
  expect(result.resourceEdge).toMatchObject({
    stamina: 0,
    actionCount: 7,
    outcomes: ['success', 'success', 'success', 'success', 'success', 'success', 'not-attempted'],
  })
  expect(result.skippedSideQuest).toEqual({ endingKey: 'ending.rescue', status: 'available' })
  expect(result.completedSideQuest).toEqual({
    endingKey: 'ending.rescue',
    statusBeforeMain: 'completed',
    experienceBeforeMain: 5,
    coinBeforeMain: 4,
  })
})
