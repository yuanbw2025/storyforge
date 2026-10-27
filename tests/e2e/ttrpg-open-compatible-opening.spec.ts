import { expect, test } from '@playwright/test'
test.setTimeout(120000)
test.use({ actionTimeout: 15000 })
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated author preview') })

test('normal author controls load a published design, add an opening and publish with zero new text calls', async ({ page }, info) => {
  const posts: string[] = []
  await page.route('**/*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    posts.push(route.request().url()); return route.abort('failed')
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), helper = await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const service = await load('/storyforge/src/lib/product-production/service.ts')
    const f = await helper.seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await helper.runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await helper.runOpenBrowserProductionV1(f, true)
    if (!result.terminal) throw Error('initial simulated production incomplete')
    const published = await service.publishProductProductionV1(f)
    const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({ scope: f.scope,
      source: { kind: 'release', productReleaseId: published.receipt.productReleaseId }, title: '原发布存档', seed: 'author.opening.original' })
    await service.beginProductProductionEvolutionV1({ ...f, userText: '追加兼容续团开局', affectedLanes: ['content', 'runtime'] })
    const project = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,
      { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    const base = await (await load('/storyforge/src/lib/ttrpg/open-compatible-opening-source.ts')).readTtrpgCompatibleOpeningAuthoringBaseV1(f)
    return { ...f, count: base.authoring.situationTemplates.length, originalReleases: await db.productReleases.toArray(), sessionId: session.id,
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(session.id) }
  })
  const url = (step: string) => `./ttrpg/${step}?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`
  await page.goto(url('vision'))
  await page.getByText('从已发布设计准备续团开局', { exact: true }).click()
  await page.getByRole('button', { name: '读取当前发布设计', exact: true }).click()
  await page.getByRole('button', { name: '确认将已发布设计载入草稿', exact: true }).click()
  await page.getByLabel('参考局势', { exact: true }).selectOption({ index: 1 })
  await page.getByRole('button', { name: '复制为新开局并选中', exact: true }).click()
  await page.getByText('局势与开场', { exact: true }).click()
  await page.getByLabel(`局势 ${f.count + 1} 标题`, { exact: true }).fill('续团：新的港口委托')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByText('制作配置已保存', { exact: true })).toBeVisible()
  await page.goto(url('confirm'))
  await page.getByRole('button', { name: '为待开始的新版本保存兼容开局', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/agent/)
  await expect(page.getByRole('region', { name: '兼容续团开局', exact: true })).toContainText('续团：新的港口委托')
  expect(posts).toEqual([])
  await page.goto(url('production'))
  const start = page.getByRole('button', { name: '作者授权并开始自动制作', exact: true })
  await expect(start).toBeEnabled()
  await start.click()
  await expect.poll(() => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const production = await db.productProductions.get(f.productionId)
    return (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, production.currentBuildNumber]).first())?.status
  }, f), { timeout: 30000 }).toBe('release-ready')
  await page.getByRole('button', { name: '复验并原子发布', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/, { timeout: 20000 })
  const after = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const production = await db.productProductions.get(f.productionId)
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, production.currentBuildNumber]).first()
    const release = await db.productReleases.get(production.currentProductReleaseId)
    return { oldReleases: await Promise.all(f.originalReleases.map((r: any) => db.productReleases.get(r.id))),
      release, ledger: JSON.parse(build.budgetLedgerJson), source: JSON.parse(release.manifestJson).runtimePackage.ttrpg,
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId) }
  }, f)
  expect(after.oldReleases).toEqual(f.originalReleases); expect(after.state).toEqual(f.state)
  expect(after.source.campaign.situationTemplates).toHaveLength(f.count + 1)
  expect(after.source.campaign.situationTemplates.find((t: any) => after.source.campaign.openingSituationKeys.includes(t.templateKey)).title).toBe('续团：新的港口委托')
  expect(after.ledger.attempts.reduce((n: number, a: any) => n + (a.usage?.modelCalls ?? 0), 0)).toBe(0)
  expect(posts).toEqual([])
  await page.screenshot({ path: info.outputPath('author-compatible-opening-published.png'), fullPage: true })
})
