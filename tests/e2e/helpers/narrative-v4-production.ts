import { expect, type Page } from '@playwright/test'
import { narrativeProductionProtocolFixtureV4 } from '../../helpers/narrative-production-protocol-fixture'

/** In-browser protocol fixture only. Every provider response is intercepted;
 * the production scheduler, Gateway, adoption and IndexedDB remain real.
 * This supplies no model, literary-quality or human acceptance evidence. */
export async function installNarrativeProductionFixtureV4(page: Page, product: 'chat' | 'avg') {
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'openai', baseUrl: 'https://nw-v4-test.invalid/v1', model: 'nw-v4-protocol-fixture',
      temperature: 0, maxTokens: 8000,
    }))
    // The production protocol uses intercepted model responses. The player
    // path below exercises offline messages/choices and refresh recovery.
    if (/\/(?:chat|avg)\/play$/.test(location.pathname)) {
      sessionStorage.removeItem('storyforge-ai-api-key-session')
    } else sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-nw-v4-fixture-key')
  })
  await page.route('https://nw-v4-test.invalid/**', async route => {
    const request = route.request().postDataJSON() as { messages?: Array<{ role: string; content: string }> }
    const system = request.messages?.find(message => message.role === 'system')?.content ?? ''
    const { task, output } = narrativeProductionProtocolFixtureV4(system, product)
    calls.push(task)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: `nw-v4-fixture-${calls.length}`, object: 'chat.completion', created: 0, model: 'nw-v4-protocol-fixture',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }) })
  })
  return calls
}

export async function publishAndOpenNarrativeProductV4(page: Page, product: 'chat' | 'avg', planHash: string) {
  const productionId = Number(new URL(page.url()).searchParams.get('production'))
  expect(Number.isSafeInteger(productionId) && productionId > 0).toBe(true)
  await page.getByRole('button', { name: '作者授权并开始自动制作', exact: true }).click()
  const publish = page.getByRole('button', { name: '复验并原子发布', exact: true })
  await expect(publish).toBeVisible({ timeout: 90000 })
  await publish.click()
  // Both product pages navigate immediately after the committed publication.
  // The studio's transient status can disappear before an assertion sees it.
  // Keep the production identity from the authoring route and check the
  // stable player route plus the persisted release below.
  await expect(page).toHaveURL(url => url.pathname.endsWith(`/${product}/play`), { timeout: 30000 })
  const released = await page.evaluate(async productionId => {
    const load = new Function('path', 'return import(path)')
    const db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const production = await db.productProductions.get(productionId)
    const row = await db.productReleases.get(production.currentProductReleaseId)
    const verified = await (await load('/storyforge/src/lib/product-production/runtime-package.ts')).verifyProductReleaseManifestV1(row.manifestJson)
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first()
    const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({
      scope: { projectId: production.projectId, worldId: production.worldId, workId: production.workId },
      source: { kind: 'release', productReleaseId: row.id }, title: 'NW v4 正式发布接缝',
    })
    return { projectId: production.projectId, workId: production.workId, sessionId: session.id, releaseId: row.id,
      productType: verified.productType, sourceContracts: verified.sourceContracts, packageHash: verified.packageHash,
      buildPackageHash: build.packageHash, buildStatus: build.status, snapshot: JSON.parse(session.canonSnapshotJson) }
  }, productionId)
  expect(released.buildStatus).toBe('released')
  expect(released.productType).toBe(product === 'chat' ? 'character-interaction' : 'avg')
  expect(released.packageHash).toBe(released.buildPackageHash)
  expect(released.sourceContracts.sourcePlan.planHash).toBe(planHash)
  expect(released.sourceContracts.sourceManifest.version).toBe(2)
  expect(released.sourceContracts.sourceManifest.runContextManifests.length).toBeGreaterThan(0)
  expect(released.sourceContracts.sourceManifest.resources.map((item: { resourceKey: string }) => item.resourceKey).sort())
    .toEqual(released.sourceContracts.sourcePlan.exact.requiredResourceKeys)
  expect(released.snapshot.sourceManifest).toMatchObject({ sourcePlanHash: planHash,
    inheritedSourceManifestHash: released.sourceContracts.sourceManifest.manifestHash,
    sourceKind: 'release', directWorldReads: [], readMode: 'frozen-product-package' })
  await page.goto(`./${product}/play?project=${released.projectId}&work=${released.workId}&session=${released.sessionId}`)
  if (product === 'chat') {
    // The generic runtime constructor creates the instance; the player still
    // chooses a scene before sending a message, just as in the product UI.
    await page.getByRole('button', { name: '桥边', exact: true }).click()
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('我们先商议修桥的安排。')
    await page.getByRole('button', { name: '仅保存消息', exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: /^我们先商议修桥的安排。$/ })).toBeVisible()
  } else {
    const choice = page.getByRole('button', { name: /回到渡口/ })
    const arrival = page.getByText('你回到渡口整理工具。', { exact: true })
    const readChoiceProgress = () => page.evaluate(async sessionId => {
      const load = new Function('path', 'return import(path)')
      const db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const store = (await load('/storyforge/src/stores/avg-game-player.ts')).useAvgGamePlayerStore.getState()
      const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()
      return { busy: store.busy, committed: events.filter((event: { type: string; payloadJson: string }) =>
        event.type === 'narrative.choice.committed' && JSON.parse(event.payloadJson).choiceKey === 'choice.return').length }
    }, released.sessionId)
    for (let step = 0; step < 8 && (await readChoiceProgress()).committed === 0; step++) {
      const next = page.getByRole('button', { name: /^(推进|补全|继续)/ }).first()
      // Text completion can replace "continue" with choices between a visibility
      // check and click. Re-resolve either valid action through the same locator.
      await choice.or(next).first().click()
      await expect.poll(async () => (await readChoiceProgress()).busy).toBe(false)
    }
    await expect.poll(async () => (await readChoiceProgress()).committed).toBe(1)
    await expect(arrival).toBeVisible()
  }
  await page.reload()
  if (product === 'chat') {
    await expect(page.getByRole('paragraph').filter({ hasText: /^我们先商议修桥的安排。$/ })).toBeVisible()
  }
  const restored = await page.evaluate(async sessionId => {
    const load = new Function('path', 'return import(path)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const session = await db.productRuntimeSessions.get(sessionId)
    const version = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeStateVersion(sessionId)
    return { releaseId: session.productReleaseId, snapshot: JSON.parse(session.canonSnapshotJson), sequence: version.sequence }
  }, released.sessionId)
  expect(restored.releaseId).toBe(released.releaseId)
  expect(restored.snapshot).toEqual(released.snapshot)
  expect(restored.sequence).toBeGreaterThan(0)
  return released
}
