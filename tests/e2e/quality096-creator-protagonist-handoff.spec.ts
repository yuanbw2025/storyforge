import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test('native Creator restores an exact frozen protagonist and carries it through public Start and P0/P1/P2', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('096 requires disposable loopback origin')
  const origin = new URL(baseURL).origin
  const blocked: string[] = []
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : (blocked.push(`${request.method()} ${new URL(request.url()).origin}`), route.abort())
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality096-isolated'))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 30_000 })
  const fixture = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } =
      await importer('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
    useAIConfigStore.setState({ rememberApiKey: false, presets: [], taskRoutes: {} })
    useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: 'sfqa096-isolated-no-real-key',
      model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, maxTokens: 0 })
    const f = await seedCurrentProductWorld('096 browser source protagonist')
    const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: f.scope, worldReleaseId: f.release.id!, productType: 'text-open-world' })
    return { projectId: f.scope.projectId, scope: f.scope, releaseId: f.release.id!, releaseJson: f.release.manifestJson, role: catalog.characters[0]! }
  })
  await page.goto(`./world/versions?project=${fixture.projectId}`)
  const versions = page.getByRole('region', { name: '世界修订、发布与产品交接' })
  await expect(versions).toBeVisible({ timeout: 30_000 })
  await versions.getByLabel('冻结世界版本').selectOption(String(fixture.releaseId))
  await versions.getByRole('button', { name: '交给文字开放世界', exact: true }).click()
  const source = page.getByTestId('text-open-world-creator-studio')
  await expect(source.getByTestId('creator-source-continue')).toBeEnabled({ timeout: 30_000 })
  await source.getByTestId('creator-source-continue').click()
  const studio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(studio).toBeVisible()
  await studio.getByLabel('主角来源').selectOption('source-character')
  const confirm = studio.getByTestId('text-open-world-creator-brief-confirm')
  await expect(confirm).toBeDisabled()
  const role = studio.getByLabel('封存角色')
  await expect(role.locator('option').filter({ hasText: fixture.role.name })).toHaveCount(1)
  await role.selectOption(fixture.role.resourceKey)
  await studio.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(studio).toContainText('草稿已保存，可刷新后继续')
  await page.reload()
  await expect(studio).toBeVisible({ timeout: 30_000 })
  await expect(studio.getByLabel('主角来源')).toHaveValue('source-character')
  await expect(studio.getByLabel('封存角色')).toHaveValue(fixture.role.resourceKey)
  await expect(confirm).toBeDisabled()
  const checks = studio.getByRole('checkbox')
  await expect(checks).toHaveCount(4)
  for (const check of await checks.all()) await check.check()
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(studio).toContainText('Brief v1 已确认')
  const prefix = await page.evaluate(async fixture => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [briefApi, locatorApi, preflightApi, startApi, { runSfqa096CreatorPrefixV1 }, { useAIConfigStore }, { db }] = await Promise.all([
      load<typeof import('../../src/lib/open-world/creator-brief')>('/storyforge/src/lib/open-world/creator-brief.ts'),
      load<typeof import('../../src/lib/open-world/creator-brief-persistence')>('/storyforge/src/lib/open-world/creator-brief-persistence.ts'),
      load<typeof import('../../src/lib/open-world/creator-production-preflight')>('/storyforge/src/lib/open-world/creator-production-preflight.ts'),
      load<typeof import('../../src/lib/product-production/service')>('/storyforge/src/lib/product-production/service.ts'),
      load<typeof import('../helpers/sfqa096-creator-prefix')>('/storyforge/tests/helpers/sfqa096-creator-prefix.ts'),
      load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
    ])
    const session = await briefApi.recoverLatestTextOpenWorldCreatorBriefSessionV1([fixture.scope])
    if (!session?.confirmedBrief || !session.selection) throw new Error('096 missing actual UI-confirmed Brief')
    const brief = session.confirmedBrief
    if (brief.draft.protagonistSourceResourceKey !== fixture.role.resourceKey) throw new Error('096 UI role was not persisted')
    const provider = { projectId: session.scope.projectId, aiConfig: useAIConfigStore.getState().config, rememberApiKey: false }
    const preflight = await preflightApi.createTextOpenWorldCreatorProductionPreflightV1({ brief, ...provider, pricing: { mode: 'catalog' } })
    const confirmation = await preflightApi.confirmTextOpenWorldCreatorProductionPreflightV1({ brief, preflight, ...provider,
      acknowledgement: { credentialPolicyReviewed: true, providerAndModelReviewed: true, priceAndBudgetReviewed: true, mediaCostBoundaryReviewed: true } })
    const input = { scope: session.scope, productionId: session.production.id, briefRevision: brief.revision,
      briefHash: brief.briefHash, expectedStateRevision: session.production.stateRevision,
      sourceLocator: locatorApi.createTextOpenWorldCreatorSourceLocatorV1(session.selection), preflight, confirmation,
      rightsBasis: 'author-owned' as const, rightsNote: '本次隔离测试合成冻结来源。', authorizationNonce: 'sfqa096.native.role', authorizedAt: Date.now() }
    const preview = await startApi.previewTextOpenWorldCreatorProductionStartV1(input)
    const receipt = await startApi.authorizeTextOpenWorldCreatorProductionStartV1({ ...input, expectedPlanHash: preview.start.productionPlanHash })
    if (!receipt.ok || receipt.replayed) throw new Error('096 expected one fresh public Start')
    const result = await runSfqa096CreatorPrefixV1(preview, fixture.role)
    if ((await db.worldReleases.get(fixture.releaseId))?.manifestJson !== fixture.releaseJson) throw new Error('096 source release changed')
    return result
  }, fixture)
  expect(prefix.gameBrief.scale.endingCount).toBe(2)
  expect(prefix.protagonist).toMatchObject({ origin: 'source-character', displayName: fixture.role.name, sourceRefs: [fixture.role.resourceKey] })
  expect(prefix.protagonist.sourceClaimKeys.length).toBeGreaterThan(0)
  expect(prefix.stages.map(stage => stage.taskKey)).toEqual(['p0.source-lock', 'p1.source-curation', 'p2.experience-design'])
  expect(prefix.stages.every(stage => /^[a-f0-9]{64}$/.test(stage.terminalReceiptHash))).toBe(true)
  await page.reload()
  const retained = await page.evaluate(async buildId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const rows = await db.productBuildArtifacts.where('buildId').equals(buildId)
      .filter(row => row.artifactKey === 'text-open-world.protagonist-asset' && row.status === 'accepted').toArray()
    return rows.map(row => JSON.parse(row.payloadJson) as unknown)
  }, prefix.buildId)
  expect(retained).toEqual([prefix.protagonist])
  expect(blocked).toEqual([])
})
