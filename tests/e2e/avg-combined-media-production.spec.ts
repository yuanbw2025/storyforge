import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { produceCombinedVisualPreview } from '../helpers/avg-combined-native-visual-fixture'
import { combinedProductionUrl, freezeCombinedStage, prepareCombinedSoundInput, produceCombinedSounds,
  produceCombinedVoice, reviseCombinedPreview, startCombinedPlan } from '../helpers/avg-combined-native-media-fixture'
import { assertCombinedAudio, assertCombinedImageConsumers, assertCombinedToolbarInViewport, finishCombinedRoute, observeCombinedNativeAudio,
  publishCombinedPreview, readCombinedRelease } from '../helpers/avg-combined-native-runtime'

test.skip(!process.env.AVG_COMBINED_RELEASE_BACKUP_FILE, 'Dedicated same-Work nine-media producer/export dependency; never substitute old single-line exports')

test('native same-Work five images, original Sound and local fixed voice publish nine exact consumers and retain the earlier five-image Release', async ({ page }, info) => {
  // This is a new four-Build composed case, including two separately confirmed
  // publications and real 24s music audition. The original V5 420s case,
  // all its assertions and the old retry policy remain byte-for-byte intact.
  test.setTimeout(600_000)
  for (const flag of ['VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', 'VITE_STORYFORGE_AVG_VISUAL_PLANNING',
    'VITE_STORYFORGE_AVG_VOICE_PRODUCTION', 'VITE_STORYFORGE_AVG_SOUND_PREPARATION', 'VITE_STORYFORGE_AVG_SOUND_PRODUCTION']) expect(process.env[flag]).toBe('1')
  await observeCombinedNativeAudio(page)
  const s = await produceCombinedVisualPreview(page, info), scope = s.source.scope
  await finishCombinedRoute(page, s.source.scenes, false)
  await publishCombinedPreview(page, scope)
  const earlier = await readCombinedRelease(page, scope)
  expect(earlier.expected.assets).toHaveLength(5)
  const original = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), build = (await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'))[0]
    return { build, rows: await db.productBuildArtifacts.where('buildId').equals(build.id).toArray(),
      release: await db.productReleases.get(build.releasedProductReleaseId) }
  }, scope)
  await reviseCombinedPreview(page)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '保留专业演出图并准备新方案', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已保留准确专业演出图并准备零生成调用的新方案' })).toBeVisible({ timeout: 30_000 })
  await startCombinedPlan(page, s.source.titles)
  await freezeCombinedStage(page)
  expect(s.models).toHaveLength(4); expect(s.images).toHaveLength(5)

  await reviseCombinedPreview(page)
  const audio = await prepareCombinedSoundInput(page, scope)
  await page.reload(); await page.getByRole('button', { name: '素材', exact: true }).click()
  await produceCombinedSounds(page, s.source.titles)
  const sound = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const view = await (await load('/storyforge/src/lib/avg/assembly-service.ts')).readAvgAssemblyWorkspaceV1(scope)
    return { assets: JSON.parse(view.draft.editorJson).presentation.stage.assets, buildNumber: view.details.build.buildNumber }
  }, scope)
  expect(sound.assets).toHaveLength(8)
  expect(sound.assets.find((a: any) => a.assetKey === 'combined.ambience').blobContentHash).toBe(audio.publisher.source.memberHash)
  expect(audio.counts).toMatchObject({ text: 1, music: 1, library: 2, publisher: 1, voice: 0, unknown: [] })
  await reviseCombinedPreview(page)
  audio.setPhase('voice')
  await produceCombinedVoice(page, s.source.titles)
  expect(audio.counts).toMatchObject({ text: 1, music: 1, library: 2, publisher: 1, voice: 1, unknown: [] })
  expect(s.models).toHaveLength(4); expect(s.images).toHaveLength(5)
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const previewUrl = page.url(), previewSessionId = Number(new URL(previewUrl).searchParams.get('session'))
  await assertCombinedAudio(page, previewSessionId, info)
  await assertCombinedImageConsumers(page, s.fixture.templates)
  await finishCombinedRoute(page, s.source.scenes, true)
  const released = await publishCombinedPreview(page, scope)
  const current = await readCombinedRelease(page, scope)
  expect(current.expected.buildNumber).toBe(4); expect(sound.buildNumber).toBe(3)
  expect(current.expected.releaseId).not.toBe(earlier.expected.releaseId)
  expect(current.expected.assets).toHaveLength(9); expect(current.expected.hasKey).toBe(false)
  expect(current.expected.nativeMedia.assets).toHaveLength(9)
  expect(current.expected.nativeMedia.assets.every((a: any) => a.status === 'decoded')).toBe(true)
  expect(current.expected.hashes).toEqual(current.expected.assets.map((a: any) => ({ assetKey: a.assetKey, hash: a.blobContentHash })))
  expect(current.expected.frozenQA).toBe(false)
  for (const asset of earlier.expected.assets) expect(current.expected.assets.find((a: any) => a.assetKey === asset.assetKey)).toEqual(asset)
  const previous = await readCombinedRelease(page, scope, earlier.expected.releaseUid)
  expect(previous.expected.manifestJson).toBe(earlier.expected.manifestJson)
  expect(previous.expected.hashes).toEqual(earlier.expected.hashes)
  const unchanged = await page.evaluate(async original => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    return JSON.stringify({ build: await db.productBuilds.get(original.build.id),
      rows: await db.productBuildArtifacts.where('buildId').equals(original.build.id).toArray(),
      release: await db.productReleases.get(original.release.id) }) === JSON.stringify(original)
  }, original)
  expect(unchanged).toBe(true)
  await released.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const releaseUrl = page.url(), releaseSessionId = Number(new URL(releaseUrl).searchParams.get('session'))
  expect(releaseSessionId).not.toBe(previewSessionId)
  await assertCombinedAudio(page, releaseSessionId, info)
  await assertCombinedImageConsumers(page, s.fixture.templates)
  const pinned = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/src/lib/db/schema.ts')).db.productRuntimeSessions.get(id)
  }, releaseSessionId)
  expect(pinned.productBuildId).toBeNull(); expect(pinned.productReleaseId).toBe(current.expected.releaseId)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await assertCombinedToolbarInViewport(page)
  await page.screenshot({ path: info.outputPath('native-combined-nine-media-release-390px.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await finishCombinedRoute(page, s.source.scenes, true)
  await assertCombinedImageConsumers(page, s.fixture.templates, true)
  await page.goto(combinedProductionUrl(scope))
  audio.setPhase('closed')
  const exported = await readCombinedRelease(page, scope)
  const portable = await page.evaluate(async ({ scope, backup, expected }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, files, lifecycle, packages, modules, media, hashing] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts'),
      load('/storyforge/src/lib/product-production/runtime-package.ts'), load('/storyforge/src/lib/avg/executable-module.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    const before = await files.exportProjectJSON(scope.projectId), copyId = await files.importProjectJSON(backup)
    const record = (await db.productReleases.where('projectId').equals(copyId).toArray()).find((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === expected.releaseUid)
    if (!record || record.workId === scope.workId) throw new Error('Exact imported Release must have a distinct owner')
    const copied = { projectId: copyId, worldId: record.worldId, workId: record.workId }
    const manifest = await packages.verifyProductReleaseManifest(record.manifestJson), assets = modules.avgRuntimeStage(manifest.runtimePackage).assets, hashes = []
    for (const asset of assets) hashes.push({ assetKey: asset.assetKey, hash: await hashing.sha256MediaData(await media.readProductReleaseMediaBytes({ scope: copied, productReleaseId: record.id, asset })) })
    await lifecycle.deleteWork(copied.workId)
    const after = await files.exportProjectJSON(scope.projectId)
    return { hashes, manifestJson: record.manifestJson, originalUnchanged: JSON.stringify({ ...before, exportedAt: 0 }) === JSON.stringify({ ...after, exportedAt: 0 }),
      copyReleases: await db.productReleases.where('workId').equals(copied.workId).count(), originalReleases: await db.productReleases.where('workId').equals(scope.workId).count() }
  }, { scope, backup: exported.backup, expected: exported.expected })
  expect(portable.hashes).toEqual(exported.expected.hashes); expect(portable.manifestJson).toBe(exported.expected.manifestJson)
  expect(portable.originalUnchanged).toBe(true); expect(portable.copyReleases).toBe(0); expect(portable.originalReleases).toBe(2)
  expect(audio.counts).toMatchObject({ text: 1, music: 1, library: 2, publisher: 1, voice: 1, unknown: [] })
  expect(s.models).toHaveLength(4); expect(s.images).toHaveLength(5)
  const final = await readCombinedRelease(page, scope)
  const path = process.env.AVG_COMBINED_RELEASE_BACKUP_FILE!
  await mkdir(dirname(path), { recursive: true })
  // Only the successful end of this exact nine-media case may supply the
  // following closed-factory browser. Failed attempts never write an export.
  await writeFile(path, JSON.stringify({ schema: 'storyforge.avg.combined-release-native-test-export', version: 1, ...final,
    originalFive: earlier.expected, templates: s.fixture.templates, scenes: s.source.scenes,
    providerCounts: { visualPlans: s.models.length, images: s.images.length, ...audio.counts },
    backupSHA256: createHash('sha256').update(JSON.stringify(final.backup)).digest('hex') }), { flag: 'wx' })
})
