import { expect, test } from '@playwright/test'
test.setTimeout(120000)
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview') })

/** Native storage and normal S2/start controls. Seed production uses explicit
 * synthetic replies. Any post-start HTTP is a closed fixture, never a provider. */
test('a pending released version saves runtime caps in the same Production, then starts only by a separate author action', async ({ page }, info) => {
  const calls: string[] = []
  await page.route('**/*', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fallback()
    calls.push(new URL(request.url()).pathname)
    if (!request.url().includes('/fixture-pending-runtime/v1/chat/completions')) throw Error('Unexpected POST in pending runtime budget fixture')
    // This case verifies authorization/build creation, not another production
    // or a game. Keep the one post-start transport explicit and unsuccessful.
    return route.fulfill({ status: 400, json: { error: { message: 'explicit post-start fixture boundary', type: 'fixture-only' } } })
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const service = await load('/storyforge/src/lib/product-production/service.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const f = await helper.seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await helper.runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await helper.runOpenBrowserProductionV1(f, true)
    if (!result.terminal) throw Error('fixture production did not finish')
    const published = await service.publishProductProductionV1(f)
    const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({
      scope: f.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId }, title: '原版存档', seed: 'pending.budget.old.save' })
    await service.beginProductProductionEvolutionV1({ ...f, userText: '修订局势完成条件', affectedLanes: ['content'] })
    const project = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,
      { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ provider: 'custom',
      model: 'fixture-pending-runtime', baseUrl: location.origin + '/fixture-pending-runtime/v1', apiKey: 'fixture-only-not-a-key',
      maxTokens: 24000, contextWindow: 131072 })
    const production = await db.productProductions.get(f.productionId)
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision]).first()
    return { ...f, production, row, oldBuilds: await db.productBuilds.toArray(), oldReleases: await db.productReleases.toArray(),
      worlds: await db.worldReleases.toArray(), oldRuns: await db.agentRuns.toArray(), sessionId: session.id,
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(session.id) }
  })
  const url = (part: string) => `./ttrpg/${part}?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`
  await page.goto(url('vision'))
  await page.getByRole('spinbutton', { name: '每次授权总量上限（tokens）', exact: true }).fill('200000')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByText('制作配置已保存', { exact: true })).toBeVisible()
  const savedRevision = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(scope)).revision
  }, f.scope)
  await page.goto(url('confirm'))
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/agent/)
  const saved = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), production = await db.productProductions.get(f.productionId)
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision]).first()
    return { production, row, productions: await db.productProductions.count(), builds: await db.productBuilds.toArray(),
      releases: await db.productReleases.toArray(), runs: await db.agentRuns.toArray(), worlds: await db.worldReleases.toArray(),
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId) }
  }, f)
  expect(calls).toEqual([]); expect(saved.productions).toBe(1); expect(saved.production.status).toBe('brief-ready')
  expect(saved.production.currentBuildNumber).toBe(f.production.currentBuildNumber)
  const before = JSON.parse(f.row.briefJson), after = JSON.parse(saved.row.briefJson)
  expect(after.ttrpgOpen.settingsRevision).toBe(savedRevision)
  expect(after.ttrpgOpen.settings.openAuthoring.runtimePolicy).toEqual({ ...before.ttrpgOpen.settings.openAuthoring.runtimePolicy, maximumEpochTokens: 200000 })
  expect(after.productionBudget).toEqual(before.productionBudget); expect(after.evolution).toEqual({ ...before.evolution, affectedLanes: ['content', 'runtime'] })
  expect(saved.row.sourcePlanJson).toBe(f.row.sourcePlanJson); expect(saved.builds).toEqual(f.oldBuilds)
  expect(saved.releases).toEqual(f.oldReleases); expect(saved.runs).toEqual(f.oldRuns); expect(saved.worlds).toEqual(f.worlds); expect(saved.state).toEqual(f.state)
  await page.reload()
  expect(calls).toEqual([])
  await page.goto(url('production'))
  const start = page.getByRole('button', { name: '作者授权并开始自动制作', exact: true })
  await expect(start).toBeEnabled(); expect(calls).toEqual([])
  await page.screenshot({ path: info.outputPath('pending-runtime-budget-saved-before-start.png'), fullPage: true })
  await start.click()
  await expect.poll(() => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const p = await db.productProductions.get(f.productionId)
    return p.currentBuildNumber
  }, f)).toBe(f.production.currentBuildNumber + 1)
  const started = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const p = await db.productProductions.get(f.productionId)
    return { build: await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, p.currentBuildNumber]).first(),
      oldBuilds: await Promise.all(f.oldBuilds.map((b: any) => db.productBuilds.get(b.id))), releases: await db.productReleases.toArray() }
  }, f)
  expect(started.build.briefRevision).toBe(saved.row.revision); expect(started.build.briefHash).toBe(saved.row.briefHash)
  expect(started.oldBuilds).toEqual(f.oldBuilds); expect(started.releases).toEqual(f.oldReleases)
  await info.attach('pending-budget-only-native-scope', { contentType: 'application/json', body: JSON.stringify({ calls,
    savedBriefRevision: saved.row.revision, startedBuild: started.build.buildNumber, realProvider: false,
    postStartProductionAccepted: false, independentHumanAcceptance: false }) })
})
