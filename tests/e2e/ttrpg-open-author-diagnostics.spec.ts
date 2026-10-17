import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/** Actual author page and isolated IndexedDB; author production transport is an explicit fixture. */
test('author exports source-bound playtest diagnosis and explicitly creates a revision without changing the save', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const sessionHelper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.seedOpenBrowserProductionV1()
    await helper.runOpenBrowserProductionV1(f);await helper.runOpenBrowserProductionV1(f,true);await helper.runOpenBrowserProductionV1(f,true)
    const preview = await helper.openBrowserProductionPreviewV1(f)
    const build = (await db.productBuilds.where('productionId').equals(f.productionId).first())!
    const campaign = JSON.parse(build.previewManifestJson).runtimePackage.ttrpg.campaign
    await sessionHelper.configureOpenSeatsV1(preview.sessionId)
    const state = await api.readProductRuntimeState(preview.sessionId)
    await api.completeTtrpgOpenSessionZeroV1({ ...await sessionHelper.openEnvelopeV1(preview.sessionId,'diagnosis.zero'),acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys,
      selectedCharacterKeys: campaign.characterTemplates.filter((c: any) => c.role === 'player').map((c: any) => c.characterKey),viewerKey: 'viewer.seat.hero' })
    await api.startTtrpgOpenRunV1({ ...await sessionHelper.openEnvelopeV1(preview.sessionId,'diagnosis.start'),viewerKey: 'viewer.seat.hero' })
    return { ...f,sessionId: preview.sessionId,build,production: await db.productProductions.get(f.productionId),state: await api.readProductRuntimeState(preview.sessionId) }
  })
  await page.goto(`./ttrpg/scenes?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const panel = page.getByTestId('ttrpg-open-author-diagnostics')
  await expect(panel).toBeVisible()
  await panel.getByRole('button',{ name: '读取本作品的试玩记录',exact: true }).click()
  await panel.getByRole('button',{ name: '读取诊断',exact: true }).click()
  await expect(panel).toContainText('尚无实际质量门检查记录')
  const downloading = page.waitForEvent('download')
  await panel.getByRole('button',{ name: '导出诊断',exact: true }).click()
  const download = await downloading, report = JSON.parse(await readFile((await download.path())!,'utf8'))
  expect(report.source.packageHash).toBe(f.build.packageHash);expect(report.evaluations).toEqual([])
  const request = page.getByLabel('跑团内容修订要求',{ exact: true })
  await request.fill('保留作者已有要求：调整灯塔开场。')
  await panel.getByRole('button',{ name: '加入修订要求',exact: true }).click()
  await expect(request).toHaveValue(/保留作者已有要求：调整灯塔开场。\n\n试玩诊断修订依据/)
  await panel.screenshot({ path: test.info().outputPath('p6-author-diagnostics-browser.png') })
  const before = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return { production: await db.productProductions.get(f.productionId),build: await db.productBuilds.get(f.build.id) }
  },f)
  expect(before.production).toEqual(f.production);expect(before.build).toEqual(f.build)
  await page.getByRole('button',{ name: '创建修订轮次',exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/production/)
  const after = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const production = await db.productProductions.get(f.productionId)
    return { production,brief: await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId,production.currentBriefRevision]).first(),
      oldBuild: await db.productBuilds.get(f.build.id),state: await api.readProductRuntimeState(f.sessionId) }
  },f)
  expect(after.production.currentBriefRevision).toBeGreaterThan(f.production.currentBriefRevision)
  expect(after.brief.userIntentSummary).toContain('试玩诊断修订依据')
  expect(after.oldBuild).toEqual(f.build);expect(after.state).toEqual(f.state)
})
