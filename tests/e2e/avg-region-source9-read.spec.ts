import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const flags = ['VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', 'VITE_STORYFORGE_AVG_VISUAL_PLANNING',
  'VITE_STORYFORGE_AVG_VOICE_PRODUCTION', 'VITE_STORYFORGE_AVG_SOUND_PREPARATION',
  'VITE_STORYFORGE_AVG_SOUND_PRODUCTION', 'VITE_STORYFORGE_AVG_AUDIO_PROCESSING']
test.skip(!process.env.AVG_REGION_RELEASE_BACKUP_FILE, 'Requires the exact preceding actual composed-image prototype backup')

async function renderedHash(page: Page) {
  return page.locator('.avg-actor img').evaluate(async (image: HTMLImageElement) => {
    const bytes = await (await fetch(image.src)).arrayBuffer()
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')
  })
}

test('actual Source9 restores and re-proves its two-input composition, plays a Release-only save with factories closed, and deletes only the mapped owner', async ({ page }, info) => {
  test.setTimeout(300_000)
  for (const flag of flags) expect(process.env[flag]).toBe('0')
  const bytes = await readFile(process.env.AVG_REGION_RELEASE_BACKUP_FILE!), exported = JSON.parse(bytes.toString())
  expect(exported.schema).toBe('storyforge.avg.region-release-native-test-export')
  expect(exported.version).toBe(1); expect(exported.expected.source9.version).toBe(9)
  expect(createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex')).toBe(exported.backupSHA256)
  const requests: string[] = [], origin = new URL(info.project.use.baseURL!).origin
  await page.route('**/*', route => {
    const request = route.request(), u = new URL(request.url())
    if (!['GET', 'HEAD'].includes(request.method()) || u.protocol.startsWith('http') && u.origin !== origin) {
      requests.push(`${request.method()} ${u.pathname}`); return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const copied = await page.evaluate(async ({ backup, expected }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, files, drafts] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/avg/draft-service.ts')])
    const occupied = Math.max(expected.scope.projectId, expected.scope.workId, expected.scope.worldId)
    if (!Number.isSafeInteger(occupied) || occupied < 1 || occupied > 8) throw new Error('Bounded isolated owner range required')
    let placeholder: any
    for (let i = 0; i < occupied; i++) placeholder = await drafts.createAvgDraftV1(`Source9恢复的隔离占位作品 ${i + 1}`)
    const projectId = await files.importProjectJSON(backup)
    const releases = (await db.productReleases.where('projectId').equals(projectId).toArray())
      .filter((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === expected.releaseUid)
    if (releases.length !== 1) throw new Error('Exact original composed Release missing or ambiguous')
    const release = releases[0], production = await db.productProductions.where('workId').equals(release.workId).first()
    const counts = await Promise.all(['productBuilds', 'agentRuns', 'productQualityGateReceipts', 'productProductionCommands', 'productReleases']
      .map(table => db.table(table).count()))
    return { projectId, worldId: release.worldId, workId: release.workId, releaseId: release.id,
      productionId: production.id, manifestJson: release.manifestJson, placeholderWorkId: placeholder.scope.workId, counts }
  }, { backup: exported.backup, expected: exported.expected })
  for (const key of ['projectId', 'workId', 'worldId'] as const) expect(copied[key]).not.toBe(exported.expected.scope[key])
  expect(copied.manifestJson).toBe(exported.expected.manifestJson)
  const scope = { projectId: copied.projectId, worldId: copied.worldId, workId: copied.workId }
  await page.goto(`./avg/production?project=${scope.projectId}&work=${scope.workId}&production=${copied.productionId}&assembly=1`)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '专业视觉原型验收与发布关闭' })).toBeVisible()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await expect(panel.getByRole('button', { name: '准备本地原型版本', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  const pose = exported.expected.assets.find((a: any) => a.kind === 'character-pose')
  const expression = exported.expected.assets.find((a: any) => a.kind === 'character-expression')
  await expect.poll(() => renderedHash(page)).toBe(pose.contentHash)
  await page.getByRole('button', { name: '物品与证据', exact: true }).click()
  const inventory = page.getByRole('dialog', { name: '物品与证据', exact: true })
  await expect(inventory.getByRole('button', { name: '向保管员出示', exact: true })).toBeDisabled()
  await inventory.getByRole('button', { name: '检查信封', exact: true }).click()
  await expect(inventory.getByRole('button', { name: '向保管员出示', exact: true })).toBeEnabled()
  await inventory.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '快速存档', exact: true }).click()
  await expect(page.getByText('已快速存档', { exact: true })).toBeVisible()
  await page.reload(); await page.getByRole('button', { name: '物品与证据', exact: true }).click()
  await expect(inventory.getByRole('button', { name: '向保管员出示', exact: true })).toBeEnabled()
  await inventory.getByRole('button', { name: '向保管员出示', exact: true }).click()
  await expect(inventory.getByRole('status')).toHaveText('保管员辨认了缺口，现在可以确认交接。')
  await inventory.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '确认交接', exact: true }).click()
  await expect.poll(() => renderedHash(page)).toBe(expression.contentHash)
  await page.reload(); await expect.poll(() => renderedHash(page)).toBe(expression.contentHash)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const portraitArt = await page.locator('.avg-stage-scene').boundingBox()
  expect(portraitArt!.width / portraitArt!.height).toBeCloseTo(16 / 9, 2)
  expect((await page.locator('.avg-dialogue').boundingBox())!.y).toBeGreaterThanOrEqual(portraitArt!.y + portraitArt!.height)
  await expect(page.locator('.avg-stage-scene')).toHaveAttribute('data-actor-count', '1')
  const actorPixels = await page.locator('.avg-actor img').evaluate((image: HTMLImageElement) => {
    const box = image.getBoundingClientRect(), scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
    return { renderedHeight: image.naturalHeight * scale, viewportHeight: innerHeight }
  })
  expect(actorPixels.renderedHeight).toBeGreaterThan(actorPixels.viewportHeight * .4)
  await page.screenshot({ path: info.outputPath('source9-closed-release-mobile.png') })
  const played = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { session: await db.productRuntimeSessions.get(id), counts: await Promise.all(['productBuilds', 'agentRuns',
      'productQualityGateReceipts', 'productProductionCommands', 'productReleases'].map(table => db.table(table).count())) }
  }, sessionId)
  expect(played.session.productBuildId).toBeNull(); expect(played.session.productReleaseId).toBe(copied.releaseId)
  expect(played.counts).toEqual(copied.counts)
  await page.goto('./avg/library')
  await page.getByRole('button', { name: '新建 AVG', exact: true }).waitFor()
  const physical = await page.evaluate(async ({ scope, source }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, reader, blobs] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/avg/media-generated-reference.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    const counts = () => Promise.all(db.tables.map((t: any) => t.count())), before = await counts()
    const prototype = IDBObjectStore.prototype, saved = { add: prototype.add, put: prototype.put, delete: prototype.delete, clear: prototype.clear }
    let writes = 0
    for (const name of ['add', 'put', 'delete', 'clear'] as const) {
      const original = saved[name]
      prototype[name] = function (...args: any[]) { writes++; return Reflect.apply(original, this, args) } as typeof original
    }
    let hash = '', oldSourceRefused = false
    try {
      const image = await reader.readAvgGeneratedReferenceImageV2({ scope, source })
      hash = await blobs.sha256MediaData(image.data)
      const old = { ...source, version: 8 }; delete old.composition
      try { await reader.readAvgGeneratedReferenceImageV2({ scope, source: old }) }
      catch (error) { oldSourceRefused = String(error).includes('旧来源8不能解释局部合成图') }
    } finally { Object.assign(prototype, saved) }
    return { hash, oldSourceRefused, writes, before, after: await counts() }
  }, { scope, source: exported.expected.source9 })
  expect(physical.hash).toBe(expression.contentHash); expect(physical.oldSourceRefused).toBe(true)
  expect(physical.writes).toBe(0); expect(physical.after).toEqual(physical.before)
  const removed = await page.evaluate(async ({ scope, placeholderWorkId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, lifecycle] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts')])
    await lifecycle.deleteWork(scope.workId)
    const remaining = await Promise.all(['productBuilds', 'agentRuns', 'mediaBlobObjects', 'productReleases']
      .map(table => db.table(table).where('workId').equals(scope.workId).count()))
    await lifecycle.deleteWorkspace(scope.projectId)
    return { remaining, placeholderPreserved: !!await db.works.get(placeholderWorkId), workspaceRemoved: !await db.projects.get(scope.projectId) }
  }, { scope, placeholderWorkId: copied.placeholderWorkId })
  expect(removed.remaining).toEqual([0, 0, 0, 0]); expect(removed.placeholderPreserved).toBe(true); expect(removed.workspaceRemoved).toBe(true)
  expect(requests).toEqual([])
  expect(createHash('sha256').update(await readFile(process.env.AVG_REGION_RELEASE_BACKUP_FILE!)).digest('hex'))
    .toBe(createHash('sha256').update(bytes).digest('hex'))
  const path = info.outputPath('source9-closed-lifecycle.json')
  await writeFile(path, JSON.stringify({ schema: 'storyforge.avg.region-closed-lifecycle', version: 1,
    backupSHA256: exported.backupSHA256, releaseUid: exported.expected.releaseUid, sourceVersion: 9,
    contentHash: physical.hash, composition: exported.expected.source9.composition, allFactoriesClosed: true,
    ownerRemapped: true, releaseOnlySave: true, sourceReadWrites: physical.writes, oldSourceRefused: physical.oldSourceRefused,
    productionCountsUnchanged: true, mappedOwnerDeleted: true, unrelatedWorkPreserved: true, requests,
    humanOrCommercialArtAccepted: false }), { flag: 'wx' })
  await info.attach('source9-closed-lifecycle', { path, contentType: 'application/json' })
})
