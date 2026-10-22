import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated preview') })

/** Local publication only: production transport is an explicit fixture, all author/play UI and DB are real. */
test('normal author UI publishes the actual open Build, then opens a release-bound adventure and restores it', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts'),{ db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.seedOpenBrowserProductionV1()
    await helper.runOpenBrowserProductionV1(f);await helper.runOpenBrowserProductionV1(f,true);await helper.runOpenBrowserProductionV1(f,true)
    return { ...f,build: await db.productBuilds.where('productionId').equals(f.productionId).first() }
  })
  await page.goto(`./ttrpg/release?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const optIn = page.getByRole('button',{ name: '启用本作品的自动制作',exact: true })
  if (await optIn.count()) await optIn.click()
  await page.getByRole('button',{ name: '复验并原子发布',exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/,{ timeout: 20000 })
  await page.getByRole('button',{ name: /· v1 开新团/ }).click()
  await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('checkbox',{ name: '我已了解安全约定和 AI 身份，并确认这是我的角色。',exact: true }).check()
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  await page.getByRole('checkbox',{ name: '我确认以上约定，开始这场冒险。',exact: true }).check()
  await page.getByRole('button',{ name: '开始冒险',exact: true }).click()
  await expect(page.getByText('冒险已经开始。',{ exact: true })).toBeVisible()
  const saved = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const release = await db.productReleases.where('workId').equals(f.scope.workId).first(),session = await db.productRuntimeSessions.where('productReleaseId').equals(release.id).first()
    return { release,session,state: await api.readProductRuntimeState(session.id) }
  },f)
  expect(saved.session.productBuildId).toBeNull();expect(saved.session.runtimeSourceHash).toBe(f.build.packageHash)
  expect(saved.state.ttrpg.openRun).not.toBeNull()
  await page.screenshot({ path: test.info().outputPath('p2-author-published-play-browser.png'),fullPage: true })
  await page.reload()
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  },saved.session.id)
  expect(restored).toEqual(saved.state)
})

test('a separate clean browser restores the complete author backup and explicitly revalidates its original source before publishing', async ({ page,browser }) => {
  await page.goto('./')
  const source = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts'),{ db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.seedOpenBrowserProductionV1()
    await helper.runOpenBrowserProductionV1(f);await helper.runOpenBrowserProductionV1(f,true);await helper.runOpenBrowserProductionV1(f,true)
    const backup = await (await importer('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(f.scope.projectId)
    return { ...f,backup,productionKey: (await db.productProductions.get(f.productionId)).productionKey }
  })
  const isolated = await browser.newContext()
  try {
    const other = await isolated.newPage()
    await other.goto(new URL('/storyforge/',page.url()).href)
    const f = await other.evaluate(async source => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      const seed = await importer('/storyforge/tests/helpers/current-product-world.ts'),{ db } = await importer('/storyforge/src/lib/db/schema.ts')
      let projectId: number
      try {
        for (let i = 0; i < 3; i++) await seed.seedCurrentProductWorld(`fresh local workspace ${i}`)
        projectId = await (await importer('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(source.backup)
      } catch (error: any) { throw new Error(`Native backup restore: ${error?.name}: ${error?.message}; inner=${error?.inner?.name}:${error?.inner?.message}; ${error?.stack}`) }
      const production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find((p: any) => p.productionKey === source.productionKey)
      return { scope: { projectId,worldId: production.worldId,workId: production.workId },productionId: production.id }
    },source)
    expect(f.scope.projectId).not.toBe(source.scope.projectId)
    await other.goto(new URL(`/storyforge/ttrpg/release?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`,page.url()).href)
    const optIn = other.getByRole('button',{ name: '启用本作品的自动制作',exact: true })
    if (await optIn.count()) await optIn.click()
    await other.getByTestId('product-production-recover-import-proof').click()
    await expect(other.getByTestId('product-production-import-proof-recovery')).toHaveCount(0,{ timeout: 20000 })
    await other.getByRole('button',{ name: '复验并原子发布',exact: true }).click()
    await expect(other).toHaveURL(/\/ttrpg\/play/,{ timeout: 20000 })
    await expect(other.getByRole('button',{ name: /· v1 开新团/ })).toBeVisible()
    expect(await page.evaluate(async () => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      return (await importer('/storyforge/src/lib/db/schema.ts')).db.productReleases.count()
    })).toBe(0)
    await other.screenshot({ path: test.info().outputPath('p2-author-backup-browser.png'),fullPage: true })
  } finally { await isolated.close() }
})
