import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { WorkspaceScope } from '../../src/lib/types'

test.use({ serviceWorkers: 'block' })
const blockedRequests = new WeakMap<BrowserContext, string[]>()
test.beforeEach(async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('SFQA097 requires a disposable loopback browser context')
  }
  const origin = new URL(baseURL).origin
  const blocked: string[] = []
  blockedRequests.set(context, blocked)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa097-isolated'))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
})
test.afterEach(async ({ context }, info) => {
  const blocked = blockedRequests.get(context) ?? []
  await info.attach('sfqa097-network', { body: JSON.stringify({ blocked, actualExternalRequests: 0,
    profile: 'ephemeral Playwright context; synthetic provider transport' }), contentType: 'application/json' })
  expect(blocked).toEqual([])
})

async function startAndRunPrefix(page: Page, scope: WorkspaceScope, nonce: string) {
  return page.evaluate(async ({ scope, nonce }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ recoverLatestTextOpenWorldCreatorBriefSessionV1 }, { createTextOpenWorldCreatorSourceLocatorV1 },
      preflightApi, startApi, { runSfqa097CreatorPrefixV1 }, { useAIConfigStore }] = await Promise.all([
      load<typeof import('../../src/lib/open-world/creator-brief')>('/storyforge/src/lib/open-world/creator-brief.ts'),
      load<typeof import('../../src/lib/open-world/creator-brief-persistence')>('/storyforge/src/lib/open-world/creator-brief-persistence.ts'),
      load<typeof import('../../src/lib/open-world/creator-production-preflight')>('/storyforge/src/lib/open-world/creator-production-preflight.ts'),
      load<typeof import('../../src/lib/product-production/service')>('/storyforge/src/lib/product-production/service.ts'),
      load<typeof import('../helpers/sfqa097-creator-prefix')>('/storyforge/tests/helpers/sfqa097-creator-prefix.ts'),
      load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
    ])
    const session = await recoverLatestTextOpenWorldCreatorBriefSessionV1([scope])
    if (!session?.confirmedBrief || !session.selection) throw new Error('Missing exact confirmed Creator session')
    const brief = session.confirmedBrief
    const provider = { projectId: scope.projectId, aiConfig: useAIConfigStore.getState().config, rememberApiKey: false }
    const preflight = await preflightApi.createTextOpenWorldCreatorProductionPreflightV1({
      brief, ...provider, pricing: { mode: 'catalog' },
    })
    const confirmation = await preflightApi.confirmTextOpenWorldCreatorProductionPreflightV1({
      brief, preflight, ...provider, acknowledgement: { credentialPolicyReviewed: true,
        providerAndModelReviewed: true, priceAndBudgetReviewed: true, mediaCostBoundaryReviewed: true },
    })
    const input = { scope, productionId: session.production.id, briefRevision: brief.revision,
      briefHash: brief.briefHash, expectedStateRevision: session.production.stateRevision,
      sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(session.selection), preflight, confirmation,
      rightsBasis: 'author-owned' as const, rightsNote: '本次隔离测试合成世界由测试作者拥有。',
      authorizationNonce: nonce, authorizedAt: Date.now() }
    const preview = await startApi.previewTextOpenWorldCreatorProductionStartV1(input)
    const receipt = await startApi.authorizeTextOpenWorldCreatorProductionStartV1({
      ...input, expectedPlanHash: preview.start.productionPlanHash,
    })
    if (!receipt.ok || receipt.replayed) throw new Error('Public Start was not newly authorized')
    return { ...await runSfqa097CreatorPrefixV1(preview), productionId: session.production.id,
      startHash: preview.start.startHash, briefRevision: brief.revision }
  }, { scope, nonce })
}

test('SFQA097 · actual Brief controls reject 0/1/13 and two endings reach Start/P0/P1/P2 after refresh', async ({ page }) => {
  test.setTimeout(120_000)
  const seeded = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ seedCurrentProductWorld }, { useAIConfigStore }] = await Promise.all([
      load<typeof import('../helpers/current-product-world')>('/storyforge/tests/helpers/current-product-world.ts'),
      load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
    ])
    useAIConfigStore.setState({ rememberApiKey: false, presets: [], taskRoutes: {} })
    useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: 'sfqa097-isolated-no-real-key',
      model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, maxTokens: 0 })
    const world = await seedCurrentProductWorld('SFQA097 native ending boundary')
    return { scope: world.scope }
  })
  await page.goto(`./world/versions?project=${seeded.scope.projectId}`)
  await page.getByRole('region', { name: '世界修订、发布与产品交接' })
    .getByRole('button', { name: '交给文字开放世界', exact: true }).click()
  await expect(page.getByTestId('creator-world-preview')).toBeVisible()
  await page.getByTestId('creator-source-continue').click()
  const studio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(studio).toBeVisible()
  const endings = studio.locator('#tow-endings')
  await expect(endings).toHaveAttribute('min', '2')
  await expect(endings).toHaveAttribute('max', '12')
  const checks = studio.getByRole('checkbox')
  await expect(checks).toHaveCount(4)
  for (const checkbox of await checks.all()) await checkbox.check()
  for (const [count, valid] of [[0, false], [1, false], [2, true], [12, true], [13, false]] as const) {
    await endings.fill(String(count))
    await expect(endings).toHaveValue(String(count))
    await expect(endings).toHaveAttribute('aria-invalid', String(!valid))
    await expect(studio.getByTestId('text-open-world-creator-brief-confirm')).toBeEnabled({ enabled: valid })
    await expect(studio.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled({ enabled: valid })
    if (!valid) await expect(studio.locator('#tow-ending-count-error')).toContainText('2 至 12 个合规结局')
  }
  await endings.fill('2')
  await studio.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(studio).toContainText('草稿已保存，可刷新后继续。')
  await page.reload()
  await expect(studio.locator('#tow-endings')).toHaveValue('2')
  for (const checkbox of await studio.getByRole('checkbox').all()) await checkbox.check()
  await studio.getByTestId('text-open-world-creator-brief-confirm').click()
  await expect(studio).toContainText('Brief v1 已确认')
  await page.reload()
  await expect(studio).toContainText('已确认 v1')
  const prefix = await startAndRunPrefix(page, seeded.scope, 'sfqa097.native.two-endings')
  expect(prefix.gameBrief.scale.endingCount).toBe(2)
  expect(prefix.stages.map(stage => stage.taskKey)).toEqual(['p0.source-lock', 'p1.source-curation', 'p2.experience-design'])
  expect(prefix.stages.every(stage => /^[a-f0-9]{64}$/.test(stage.terminalReceiptHash))).toBe(true)
  await test.info().attach('sfqa097-native-prefix', { body: JSON.stringify(prefix), contentType: 'application/json' })
})

test('SFQA097 · native historical one-ending Start stays immutable and explicit revision authorizes a successor', async ({ page }) => {
  test.setTimeout(120_000)
  const archive = JSON.parse(gunzipSync(readFileSync('tests/fixtures/text-open-world/quality097-legacy-one-ending-v1.json.gz')).toString('utf8'))
  const legacy = await page.evaluate(async archive => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { importProjectJSON }, briefApi, startApi, preflightApi, { assertTextOpenWorldBuildNewWorkV1 },
      { runProductProductionSchedulerCycleV1 }, { stopProductProductionV1 }, { useAIConfigStore }] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
      load<typeof import('../../src/lib/open-world/creator-brief')>('/storyforge/src/lib/open-world/creator-brief.ts'),
      load<typeof import('../../src/lib/open-world/creator-production-start')>('/storyforge/src/lib/open-world/creator-production-start.ts'),
      load<typeof import('../../src/lib/open-world/creator-production-preflight')>('/storyforge/src/lib/open-world/creator-production-preflight.ts'),
      load<typeof import('../../src/lib/open-world/source-admission')>('/storyforge/src/lib/open-world/source-admission.ts'),
      load<typeof import('../../src/lib/product-production/scheduler')>('/storyforge/src/lib/product-production/scheduler.ts'),
      load<typeof import('../../src/lib/product-production/service')>('/storyforge/src/lib/product-production/service.ts'),
      load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
    ])
    const aiConfig = { provider: 'deepseek' as const, apiKey: 'sfqa097-isolated-no-real-key',
      model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, maxTokens: 0 }
    useAIConfigStore.setState({ rememberApiKey: false, presets: [], taskRoutes: {} })
    useAIConfigStore.getState().setConfig(aiConfig)
    const projectId = await importProjectJSON(archive)
    const production = (await db.productProductions.where('projectId').equals(projectId).first())!
    const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
    const briefRow = (await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first())!
    const scope = { projectId, worldId: production.worldId, workId: production.workId }
    const frozen = await startApi.readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
    if (frozen.creatorBrief.draft.scale.endings !== 1 || frozen.executionBrief.scale.targetEndingCount !== 1
      || briefRow.confirmedBriefJson !== archive.productProductionBriefs[0].confirmedBriefJson) throw new Error('Historical Start wire changed')
    const footprint = async () => JSON.stringify(await Promise.all([db.agentRuns.toArray(), db.productProductionBriefs.toArray(),
      db.productBuilds.toArray(), db.productBuildArtifacts.toArray(), db.productProductionCommands.toArray(), db.productProductions.toArray()]))
    const before = await footprint()
    const errors = []
    for (const attempt of [
      () => preflightApi.createTextOpenWorldCreatorProductionPreflightV1({ brief: frozen.creatorBrief,
        projectId, aiConfig, rememberApiKey: false, pricing: { mode: 'catalog' } }),
      () => assertTextOpenWorldBuildNewWorkV1({ scope, productionId: production.id!, buildId: build.id!, operation: 'native legacy new work' }),
      () => runProductProductionSchedulerCycleV1({ scope, productionId: production.id!,
        executor: async () => { throw new Error('Legacy executor must never dispatch') } }),
    ]) {
      let message = ''
      try { await attempt() } catch (cause) { message = cause instanceof Error ? cause.message : String(cause) }
      if (!message.includes('2 至 12 个合规结局')) throw new Error(`Legacy admission did not reject deterministically: ${message}`)
      errors.push(message)
    }
    if (await footprint() !== before) throw new Error('Rejected legacy new work wrote production state')
    await stopProductProductionV1({ scope, production })
    const cancelledBuildJson = JSON.stringify(await db.productBuilds.get(build.id!))
    const session = await briefApi.recoverLatestTextOpenWorldCreatorBriefSessionV1([scope])
    if (!session) throw new Error('Stopped legacy session did not recover')
    await briefApi.confirmTextOpenWorldCreatorBriefV1({ session,
      draft: { ...session.draft, scale: { ...session.draft.scale, endings: 2 } },
      acknowledgements: { sourceIdentityReviewed: true, productBoundaryReviewed: true,
        unresolvedItemsClosed: true, directPublishWorkflowReviewed: true } })
    return { scope, buildId: build.id!, buildNumber: build.buildNumber, cancelledBuildJson,
      briefRowId: briefRow.id!, briefJson: briefRow.briefJson, startJson: briefRow.confirmedBriefJson,
      startHash: frozen.start.startHash, rejectedOperations: errors.length }
  }, archive)
  const prefix = await startAndRunPrefix(page, legacy.scope, 'sfqa097.native.legacy-revised')
  expect(prefix.briefRevision).toBe(2)
  expect(prefix.gameBrief.scale.endingCount).toBe(2)
  expect(prefix.startHash).not.toBe(legacy.startHash)
  const preserved = await page.evaluate(async legacy => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const oldBrief = (await db.productProductionBriefs.get(legacy.briefRowId))!
    const successor = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([oldBrief.productionId, legacy.buildNumber + 1]).first()
    return { oldBuildUnchanged: JSON.stringify(await db.productBuilds.get(legacy.buildId)) === legacy.cancelledBuildJson,
      oldBriefUnchanged: oldBrief.briefJson === legacy.briefJson && oldBrief.confirmedBriefJson === legacy.startJson,
      parentBuildNumber: successor?.parentBuildNumber }
  }, legacy)
  expect(preserved).toEqual({ oldBuildUnchanged: true, oldBriefUnchanged: true, parentBuildNumber: legacy.buildNumber })
  await test.info().attach('sfqa097-native-legacy-proof', { body: JSON.stringify({ preserved,
    rejectedOperations: legacy.rejectedOperations, priorStartHash: legacy.startHash, prefix }), contentType: 'application/json' })
})
