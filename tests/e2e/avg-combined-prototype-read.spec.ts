import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { combinedProductionUrl } from '../helpers/avg-combined-native-media-fixture'
import { assertCombinedAudio, assertCombinedImageConsumers, assertCombinedToolbarInViewport, finishCombinedRoute, observeCombinedNativeAudio,
  readCombinedRelease } from '../helpers/avg-combined-native-runtime'

const flags = ['VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', 'VITE_STORYFORGE_AVG_VISUAL_PLANNING',
  'VITE_STORYFORGE_AVG_VOICE_PRODUCTION', 'VITE_STORYFORGE_AVG_SOUND_PREPARATION', 'VITE_STORYFORGE_AVG_SOUND_PRODUCTION']
test.skip(!process.env.AVG_COMBINED_RELEASE_BACKUP_FILE, 'Requires the exact successful preceding nine-media publication export')

test('the same successful nine-media export restores all native consumers and Release-only saves with all five factories closed and no new production authority', async ({ page }, info) => {
  test.setTimeout(180_000)
  for (const flag of flags) expect(process.env[flag]).toBe('0')
  const sourceBytes = await readFile(process.env.AVG_COMBINED_RELEASE_BACKUP_FILE!), exported = JSON.parse(sourceBytes.toString())
  expect(exported.schema).toBe('storyforge.avg.combined-release-native-test-export'); expect(exported.version).toBe(1)
  expect(exported.expected.assets).toHaveLength(9); expect(exported.originalFive.assets).toHaveLength(5)
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
  await observeCombinedNativeAudio(page)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const copied = await page.evaluate(async ({ backup, expected, old }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, files, { db }, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const occupied = Math.max(expected.scope.projectId, expected.scope.workId)
    if (!Number.isSafeInteger(occupied) || occupied < 1 || occupied > 32) throw new Error('The isolated native owner range must be bounded')
    for (let i = 0; i < occupied; i++) await drafts.createAvgDraftV1(`九媒资关闭恢复的隔离占位作品 ${i + 1}`)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: '', baseUrl: 'https://visual.fixture.invalid/v1', model: 'agnes-2.5-flash' })
    const projectId = await files.importProjectJSON(backup), releases = await db.productReleases.where('projectId').equals(projectId).toArray()
    const find = (uid: string) => releases.filter((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === uid)
    const current = find(expected.releaseUid), earlier = find(old.releaseUid)
    if (current.length !== 1 || earlier.length !== 1) throw new Error('Both exact original Releases must survive owner remapping')
    return { projectId, worldId: current[0].worldId, workId: current[0].workId, releaseId: current[0].id,
      manifestJson: current[0].manifestJson, oldManifestJson: earlier[0].manifestJson,
      counts: [await db.productBuilds.count(), await db.agentRuns.count(), await db.productQualityGateReceipts.count(),
        await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, { backup: exported.backup, expected: exported.expected, old: exported.originalFive })
  expect(copied.projectId).not.toBe(exported.expected.scope.projectId); expect(copied.workId).not.toBe(exported.expected.scope.workId)
  expect(copied.manifestJson).toBe(exported.expected.manifestJson); expect(copied.oldManifestJson).toBe(exported.originalFive.manifestJson)
  await page.goto(combinedProductionUrl(copied))
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await expect(panel.getByRole('button', { name: '准备本地原型版本', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  await assertCombinedAudio(page, sessionId, info)
  await assertCombinedImageConsumers(page, exported.templates)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await assertCombinedToolbarInViewport(page)
  await page.screenshot({ path: info.outputPath('native-combined-nine-media-closed-factories-390px.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await finishCombinedRoute(page, exported.scenes, true)
  await assertCombinedImageConsumers(page, exported.templates, true)
  await page.reload(); await assertCombinedImageConsumers(page, exported.templates, true)
  const current = await readCombinedRelease(page, copied, exported.expected.releaseUid)
  const earlier = await readCombinedRelease(page, copied, exported.originalFive.releaseUid)
  expect(current.expected.hashes).toEqual(exported.expected.hashes)
  expect(earlier.expected.hashes).toEqual(exported.originalFive.hashes)
  expect(current.expected.hasKey).toBe(false)
  const after = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { session: await db.productRuntimeSessions.get(id), counts: [await db.productBuilds.count(), await db.agentRuns.count(),
      await db.productQualityGateReceipts.count(), await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, sessionId)
  expect(after.session.productBuildId).toBeNull(); expect(after.session.productReleaseId).toBe(copied.releaseId)
  expect(after.counts).toEqual(copied.counts); expect(requests).toEqual([])
  expect(createHash('sha256').update(await readFile(process.env.AVG_COMBINED_RELEASE_BACKUP_FILE!)).digest('hex'))
    .toBe(createHash('sha256').update(sourceBytes).digest('hex'))
  const receipt = { schema: 'storyforge.avg.combined-closed-export-read', version: 1,
    sourceFileSHA256: createHash('sha256').update(sourceBytes).digest('hex'), backupSHA256: exported.backupSHA256,
    releaseUid: exported.expected.releaseUid, originalFiveReleaseUid: exported.originalFive.releaseUid,
    assetCount: current.expected.assets.length, originalFiveAssetCount: earlier.expected.assets.length,
    allFactoriesClosed: true, ownerRemapped: true, releaseOnlySave: true, newProviderRequests: requests.length,
    productionAuthorityCountsUnchanged: true, artOrListeningAccepted: false }
  const path = info.outputPath('combined-closed-consumed-export.json')
  await writeFile(path, JSON.stringify(receipt), { flag: 'wx' })
  await info.attach('combined-closed-consumed-export', { path, contentType: 'application/json' })
})
