import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated open author preview') })
for (const revisionPage of ['scenes','media'] as const) {
test(`${revisionPage}: restored published backup creates a new revision and preserves the original save`, async ({ page,browser }) => {
  await page.goto('./')
  const source = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts'),service = await importer('/storyforge/src/lib/product-production/service.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),instances = await importer('/storyforge/src/lib/product/runtime-instances.ts')
    const f = await helper.seedOpenBrowserProductionV1()
    await helper.runOpenBrowserProductionV1(f);await helper.runOpenBrowserProductionV1(f,true);await helper.runOpenBrowserProductionV1(f,true)
    const published = await service.publishProductProductionV1(f)
    await instances.createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: published.receipt.productReleaseId },title: '原版存档',seed: 'native.restored.original' })
    return { productionKey: (await db.productProductions.get(f.productionId)).productionKey,
      backup: await (await importer('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(f.scope.projectId) }
  })
  const isolated = await browser.newContext()
  try {
    const other = await isolated.newPage()
    await other.goto(new URL('/storyforge/',page.url()).href)
    const f = await other.evaluate(async source => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      const { db } = await importer('/storyforge/src/lib/db/schema.ts'),seed = await importer('/storyforge/tests/helpers/current-product-world.ts')
      for (let i = 0; i < 3; i++) await seed.seedCurrentProductWorld(`different local IDs ${i}`)
      let projectId: number
      try { projectId = await (await importer('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(source.backup) }
      catch (error: any) { throw new Error(`Published backup import: ${error?.name}: ${error?.message}`) }
      const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find((p: any) => p.productionKey === source.productionKey)
      const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id,1]).first()
      const release = await db.productReleases.get(production.currentProductReleaseId),session = await db.productRuntimeSessions.where('productReleaseId').equals(release.id).first()
      return { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id,build,release,sessionId: session.id,
        state: await (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(session.id) }
    },source)
    const url = (part: string) => new URL(`/storyforge/ttrpg/${part}?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`,page.url()).href
    await other.goto(url('release'))
    const optIn = other.getByRole('button',{ name: '启用本作品的自动制作',exact: true })
    if (await optIn.count()) await optIn.click()
    await other.getByTestId('product-production-recover-import-proof').click()
    await expect(other.getByTestId('product-production-import-proof-recovery')).toHaveCount(0,{ timeout: 20000 })
    await other.goto(url(revisionPage))
    await other.getByLabel('跑团内容修订要求',{ exact: true }).fill('恢复后修订灯塔开场，沿用已确认的世界和旧版记录。')
    await other.getByRole('button',{ name: '创建修订轮次',exact: true }).click()
    await expect(other).toHaveURL(/\/ttrpg\/production/)
    const productionResult = await other.evaluate(async f => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      const { db } = await importer('/storyforge/src/lib/db/schema.ts'),command = await importer('/storyforge/src/lib/product-production/commands.ts'),helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
      const production = await db.productProductions.get(f.productionId),brief = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,production.currentBriefRevision]).first()
      if (JSON.parse(brief.briefJson).source.worldReleaseId !== brief.sourceWorldReleaseId) throw new Error('new revision retained the wrong local source locator')
      const started = await command.executeProductProductionCommand({ scope: f.scope,productionId: f.productionId,command: { type: 'authorize-start',commandId: 'native.restored.revision.start',
        expectedStateRevision: production.stateRevision,briefRevision: brief.revision,briefHash: brief.briefHash,authorizationNonce: 'author.confirmed.restored.revision' } })
      if (!started.ok) throw new Error(JSON.stringify(started))
      let result = await helper.runOpenBrowserProductionV1(f)
      for (let i = 0; i < 2 && !result.terminal; i++) result = await helper.runOpenBrowserProductionV1(f,true)
      return result
    },f)
    expect(productionResult.terminal).toBe(true)
    if (revisionPage === 'media') expect(productionResult.modelCalls).toBe(1)
    await other.goto(url('release'))
    await other.getByRole('button',{ name: '复验并原子发布',exact: true }).click()
    await expect(other).toHaveURL(/\/ttrpg\/play/,{ timeout: 20000 })
    const after = await other.evaluate(async f => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      const { db } = await importer('/storyforge/src/lib/db/schema.ts'),api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
      return { oldBuild: await db.productBuilds.get(f.build.id),oldRelease: await db.productReleases.get(f.release.id),state: await api.readProductRuntimeState(f.sessionId),
        versions: (await db.productReleases.where('workId').equals(f.scope.workId).toArray()).map((r: any) => r.version).sort() }
    },f)
    expect(after.oldBuild).toEqual(f.build);expect(after.oldRelease).toEqual(f.release);expect(after.state).toEqual(f.state)
    expect(after.versions).toEqual([1,2])
    await other.screenshot({ path: test.info().outputPath(`p2-restored-evolution-${revisionPage}-browser.png`),fullPage: true })
  } finally { await isolated.close() }
})
}
