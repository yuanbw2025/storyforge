import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test.skip(!process.env.AVG_VISUAL_RELEASE_BACKUP_FILE || process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '0'
  || process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING !== '0', 'Requires actual preceding V5 publication export and both image/planning factories closed')

test('original V5 published images and local derivative restore and play with both visual factories closed and no new provider/quality authority', async ({ page }, info) => {
  test.setTimeout(150_000)
  const sourceBytes = await readFile(process.env.AVG_VISUAL_RELEASE_BACKUP_FILE!), exported = JSON.parse(sourceBytes.toString())
  expect(exported.schema).toBe('storyforge.avg.visual-release-native-test-export')
  expect(createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex')).toBe(exported.backupSHA256)
  const requests: string[] = []
  await page.route('**/*', route => {
    const request = route.request(), u = new URL(request.url())
    if (!['GET', 'HEAD'].includes(request.method()) || ['5297', '5298', '11434'].includes(u.port)
      || u.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(u.hostname)) {
      requests.push(`${request.method()} ${u.origin}${u.pathname}`); return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const copied = await page.evaluate(async ({ backup, expected }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, files, { db }, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const occupied = Math.max(expected.scope.projectId, expected.scope.workId)
    if (!Number.isSafeInteger(occupied) || occupied < 1 || occupied > 32) throw new Error('Native fixture owner range exceeded')
    for (let i = 0; i < occupied; i++) await drafts.createAvgDraftV1(`V5版本恢复的隔离占位作品 ${i + 1}`)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://v5-proposal.fixture.invalid/v1', apiKey: '', model: 'agnes-2.5-flash' })
    const projectId = await files.importProjectJSON(backup), rows = await db.productReleases.where('projectId').equals(projectId).toArray()
    const matches = rows.filter((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === expected.releaseUid)
    if (matches.length !== 1) throw new Error('Missing or ambiguous exact original V5 Release')
    const record = matches[0]
    return { projectId, worldId: record.worldId, workId: record.workId, releaseId: record.id, manifestJson: record.manifestJson,
      counts: [await db.productBuilds.count(), await db.agentRuns.count(), await db.productQualityGateReceipts.count(), await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, { backup: exported.backup, expected: exported.expected })
  expect(copied.projectId).not.toBe(exported.expected.scope.projectId); expect(copied.workId).not.toBe(exported.expected.scope.workId)
  expect(copied.manifestJson).toBe(exported.expected.manifestJson)
  await page.goto(`./avg/production?project=${copied.projectId}&work=${copied.workId}&assembly=1`)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '专业视觉原型验收与发布关闭' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '导入的视觉制作证明尚待显式复验' })).toBeVisible()
  await expect(page.getByRole('button', { name: '复验导入视觉证明', exact: true })).toBeEnabled()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await expect(panel.getByRole('button', { name: '准备本地原型版本', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  const expectedAsset = (key: string) => exported.expected.assets.find((a: any) => a.assetKey === key)
  await expect.poll(() => page.locator('.avg-background img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(expectedAsset(exported.expected.backgroundKey).width)
  await expect.poll(() => page.locator('.avg-actor img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(expectedAsset(exported.expected.poseKey).width)
  await page.getByRole('button', { name: '物品与证据', exact: true }).click()
  const inventory = page.getByRole('dialog', { name: '物品与证据', exact: true })
  await expect.poll(() => inventory.locator('nav img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(expectedAsset(exported.expected.iconKey).width)
  await expect.poll(() => inventory.locator('.avg-inventory-detail-image').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(expectedAsset(exported.expected.detailKey).width)
  await inventory.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '继续保管', exact: true }).click()
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt', expectedAsset(exported.expected.expressionKey).altText)
  await page.reload()
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt', expectedAsset(exported.expected.expressionKey).altText)
  const read = await page.evaluate(async ({ scope, sessionId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, pkg, module, media, hash, config] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/avg/executable-module.ts'), load('/storyforge/src/lib/product-production/release-media.ts'),
      load('/storyforge/src/lib/product-production/media-blob-store.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const record = await db.productReleases.get(scope.releaseId), manifest = await pkg.verifyProductReleaseManifest(record.manifestJson), assets = module.avgRuntimeStage(manifest.runtimePackage).assets
    const hashes = []
    for (const asset of assets) hashes.push({ assetKey: asset.assetKey, hash: await hash.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: record.id, asset })) })
    return { hashes, session: await db.productRuntimeSessions.get(sessionId), hasKey: !!config.useAIConfigStore.getState().config.apiKey,
      counts: [await db.productBuilds.count(), await db.agentRuns.count(), await db.productQualityGateReceipts.count(), await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, { scope: copied, sessionId })
  expect(read.hasKey).toBe(false); expect(read.session.productBuildId).toBeNull(); expect(read.session.productReleaseId).toBe(copied.releaseId)
  expect(read.counts).toEqual(copied.counts); expect(read.hashes).toEqual(exported.expected.assets.map((a: any) => ({ assetKey: a.assetKey, hash: a.blobContentHash })))
  expect(requests).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('native-v5-release-closed-factory.png') })
  expect(createHash('sha256').update(await readFile(process.env.AVG_VISUAL_RELEASE_BACKUP_FILE!)).digest('hex')).toBe(createHash('sha256').update(sourceBytes).digest('hex'))
})
