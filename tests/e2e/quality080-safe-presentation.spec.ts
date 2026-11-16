import { expect, test, type Page } from '@playwright/test'

const SELF_SECRET = 'QUALITY080_BROWSER_SELF_PRIVATE_KNOWLEDGE'
const OTHER_SECRET = 'QUALITY080_BROWSER_OTHER_PRIVATE_KNOWLEDGE'
const SAFETY_SECRET = 'QUALITY080_BROWSER_SELF_SAFETY_NOTE'
const PUBLIC_KNOWLEDGE = 'QUALITY080_BROWSER_PUBLIC_KNOWLEDGE'

async function databaseBytes(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const tables = [...db.tables].sort((left, right) => left.name.localeCompare(right.name))
    return db.transaction('r', tables, async () => JSON.stringify(
      await Promise.all(tables.map(async table => [table.name, await table.toArray()])),
    ))
  })
}

async function allDisplayedData(page: Page): Promise<string> {
  // Hidden CSS panels, values, accessibility labels and titles all count. A
  // password or hidden field is not accepted as a public presentation boundary.
  return page.locator('body').evaluate(element => JSON.stringify({
    text: element.textContent,
    fields: [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].map(field => field.value),
    labels: [...element.querySelectorAll('[aria-label],[title]')].map(node => [node.getAttribute('aria-label'), node.getAttribute('title')]),
  }))
}

test('080 actual scripted inventory route keeps theater public across character selection and restores the selected owner', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('080 requires the configured isolated loopback server')
  const address = new URL(baseURL)
  if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(address.hostname)) {
    throw new Error('080 browser verification must not access an author deployment or profile')
  }
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const blocked: Array<{ method: string; origin: string; pathname: string }> = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === address.origin && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.continue()
    else {
      blocked.push({ method: request.method(), origin: url.origin, pathname: url.pathname })
      await route.abort('blockedbyclient')
    }
  })
  await context.addInitScript(origin => {
    if (location.origin === origin) localStorage.setItem('storyforge_guide_completed', 'e2e')
  }, address.origin)
  const page = await context.newPage()
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    // Explicit API + current Build metadata fixture, not a UI production DAG
    // or a substitute for release quality/human acceptance. No model callbacks.
    const seed = await page.evaluate(async sentinels => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count() || await db.works.count()) throw new Error('080 requires an empty isolated browser DB')
      const { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } = await load<typeof import('../helpers/current-product-world')>('/storyforge/tests/helpers/current-product-world.ts')
      const { createCurrentTtrpgRuntimePackageFixture } = await load<typeof import('../helpers/current-ttrpg-runtime-package')>('/storyforge/tests/helpers/current-ttrpg-runtime-package.ts')
      const { seedCurrentProductBuild } = await load<typeof import('../helpers/current-product-build')>('/storyforge/tests/helpers/current-product-build.ts')
      const { suggestProductStartingPoints, draftProductProductionBriefV3 } = await load<typeof import('../../src/lib/product-production/consultation')>('/storyforge/src/lib/product-production/consultation.ts')
      const { parseProductRuntimePackageV1 } = await load<typeof import('../../src/lib/product-production/runtime-package')>('/storyforge/src/lib/product-production/runtime-package.ts')
      const api = await load<typeof import('../../src/lib/ttrpg/runtime-api')>('/storyforge/src/lib/ttrpg/runtime-api.ts')
      const world = await seedCurrentProductWorld('QUALITY080 isolated browser world')
      if (world.release.id == null) throw new Error('080 requires a real frozen WorldRelease')
      const release = { ...world.release, id: world.release.id }
      const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'ttrpg' })
      const seats: import('../../src/lib/types').TtrpgProductionSeatV2[] = ['QUALITY080 browser first', 'QUALITY080 browser second']
        .map((name, index) => ({ seatKey: 'player.' + (index + 1), label: name, controller: 'human', role: 'player',
          characterMode: 'quick-card', sourceCharacterResourceKey: null, characterName: name, rankTier: 'B', privateGoal: 'Preserve the individual goal.' }))
      const input = await createCurrentTtrpgRuntimePackageFixture({ scope: world.scope, worldRelease: release,
        sourceCatalog, title: 'QUALITY080 public browser campaign', gmMode: 'human', playerController: 'human', authoredScenario: true, seats })
      const players = input.ttrpg?.campaign.characterTemplates.filter(row => row.role === 'player')
      if (!players || players.length !== 2 || players.some(row => !row.characterSheet)) throw new Error('080 requires two actual complete human sheets')
      for (const [index, player] of players.entries()) {
        if (!player.characterSheet) throw new Error('080 missing complete sheet')
        player.characterSheet.identity.privateKnowledge = [index === 0 ? sentinels.self : sentinels.other]
        player.characterSheet.identity.safetyNotes = [sentinels.safety]
        player.characterSheet.identity.publicKnowledge = [sentinels.public]
      }
      const runtimePackage = parseProductRuntimePackageV1(input)
      if (!runtimePackage.ttrpg) throw new Error('080 runtime package must stay scripted TTRPG V1')
      const suggestions = await suggestProductStartingPoints({ scope: world.scope, worldReleaseId: release.id })
      const suggestion = suggestions.suggestions[0]
      if (!suggestion) throw new Error('080 requires an actual product starting point')
      const brief = await draftProductProductionBriefV3({ scope: world.scope, worldReleaseId: release.id,
        suggestionKey: suggestion.suggestionKey, productType: 'ttrpg', qualityProfile: 'prototype', scale: 'campaign',
        visualLevel: 'none', audioLevel: 'none', playerRole: '调查队成员', openingSituation: 'QUALITY080 browser campaign', confirmTtrpgDefaultMappings: true })
      const built = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage,
        title: 'QUALITY080 browser session', seed: 'quality080-browser', brief })
      const sessionId = built.session.id
      if (sessionId == null) throw new Error('080 requires a persisted actual session')
      const initial = await api.readProductRuntimeState(sessionId)
      if (!initial.ttrpg?.product) throw new Error('080 requires governed product state')
      let version = await api.readProductRuntimeStateVersion(sessionId)
      await api.completeTtrpgSessionZero({ sessionId, commandId: 'quality080.browser.zero', baseSequence: version.sequence,
        baseStateHash: version.stateHash, acceptedItemKeys: initial.ttrpg.product.sessionZero.requiredItemKeys,
        selectedCharacterKeys: players.map(row => row.characterKey), completedBy: 'viewer.gm' })
      version = await api.readProductRuntimeStateVersion(sessionId)
      await api.openTtrpgCampaignScene({ sessionId, commandId: 'quality080.browser.open', baseSequence: version.sequence,
        baseStateHash: version.stateHash, sceneKey: runtimePackage.ttrpg.campaign.openingSceneKey })
      if (await db.productMediaAssets.count() || await db.productMediaBlobs.count() || await db.mediaBlobObjects.count()) throw new Error('080 row-byte snapshot assumes no binary fixture assets')
      return { scope: world.scope, sessionId, playerNames: players.map(row => row.name) }
    }, { self: SELF_SECRET, other: OTHER_SECRET, safety: SAFETY_SECRET, public: PUBLIC_KNOWLEDGE })

    await page.goto(`./ttrpg/inventory?project=${seed.scope.projectId}&work=${seed.scope.workId}&session=${seed.sessionId}`)
    const guide = page.getByTestId('formal-ttrpg-campaign-guide')
    await expect(guide).toBeVisible({ timeout: 20_000 })
    await guide.getByRole('button', { name: '玩家视图', exact: true }).click()
    const sheet = guide.getByTestId('ttrpg-complete-character-sheet')
    await expect(sheet).toContainText(SELF_SECRET)
    await expect(sheet).toContainText(PUBLIC_KNOWLEDGE)
    expect(await allDisplayedData(page)).not.toContain(OTHER_SECRET)
    const before = await databaseBytes(page)
    for (let repetition = 0; repetition < 2; repetition++) {
      await guide.getByRole('button', { name: '安全投屏', exact: true }).click()
      await expect(guide.getByRole('button', { name: '退出投屏', exact: true })).toHaveAttribute('aria-pressed', 'true')
      for (const name of seed.playerNames) {
        await guide.getByRole('button', { name: '查看角色：' + name, exact: true }).click()
        const data = await allDisplayedData(page)
        for (const secret of [SELF_SECRET, OTHER_SECRET, SAFETY_SECRET]) expect(data).not.toContain(secret)
        expect(data).toContain(PUBLIC_KNOWLEDGE)
      }
      await guide.getByRole('button', { name: '退出投屏', exact: true }).click()
      await expect(guide.getByRole('button', { name: '玩家视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(sheet).toContainText(OTHER_SECRET)
      await expect(sheet).not.toContainText(SELF_SECRET)
      expect(await databaseBytes(page)).toBe(before)
    }
    const after = await databaseBytes(page)
    expect(after).toBe(before)
    await testInfo.attach('quality080-database-before.json', { body: before, contentType: 'application/json' })
    await testInfo.attach('quality080-database-after.json', { body: after, contentType: 'application/json' })
  } finally {
    await testInfo.attach('quality080-network-isolation.json', { body: JSON.stringify({ blocked, realProviderCalls: 0 }), contentType: 'application/json' })
    await context.close()
    expect(blocked).toEqual([])
  }
})
