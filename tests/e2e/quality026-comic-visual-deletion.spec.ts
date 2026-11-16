/** Native synthetic media is seeded by public APIs. Explicit deletion,
 * confirmation, reloading and image display exercise the actual comic UI. */
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

interface ComicSeed { scope: { projectId: number; worldId: number; workId: number }; subjectId: number; assetId: number; blobId: number; label: string }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function seed(page: Page, sameProject: boolean): Promise<ComicSeed[]> {
  return page.evaluate(async together => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { createAdaptation, listActiveSourceUnits } = await load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts')
    const { defaultComicTargetSpec } = await load<typeof import('../../src/lib/comic/authoring')>('/storyforge/src/lib/comic/authoring.ts')
    const { saveComicVisualSubject } = await load<typeof import('../../src/lib/comic/service')>('/storyforge/src/lib/comic/service.ts')
    const { commitUploadedComicAssetV1, selectComicMediaAssetV1 } = await load<typeof import('../../src/lib/comic/media-service')>('/storyforge/src/lib/comic/media-service.ts')
    if (await db.projects.count() || await db.works.count()) throw new Error('026 requires empty isolated storage')
    const pixels = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMar4DwAC2gG+nphhRgAAAABJRU5ErkJggg==', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPYYlTxHwAFWgJeNUWBEgAAAABJRU5ErkJggg==']
    const result: ComicSeed[] = []
    let firstScope: ComicSeed['scope'] | undefined
    for (const [index, letter] of ['A', 'B'].entries()) {
      const source = together && firstScope ? firstScope : (await createWorkspace({ name: `QUALITY026 原作 ${letter}`, description: '', genres: [], status: 'drafting', targetWordCount: 10_000 },
        { kind: 'novel', novelProfile: 'long', importedNovelText: `清晨，林岚收好车票，走入旧车站。${letter}` })).scope
      firstScope ??= source
      const comic = await createAdaptation({ sourceScope: source, sourceWorkId: source.workId, title: `QUALITY026 漫画 ${letter}`,
        sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: defaultComicTargetSpec() })
      const unit = (await listActiveSourceUnits(comic.adaptation.id!)).find(row => row.sourceKind === 'chapter')
      if (!unit) throw new Error('026 synthetic original chapter missing')
      const label = `QUALITY026 车票 ${letter}`
      const subject = await saveComicVisualSubject({ scope: comic.scope, draft: { stableKey: 'prop.local-ticket', kind: 'prop', characterId: null, locationRefKey: null,
        label, sourceUnitIds: [unit.id!], design: { description: '合成车票道具', silhouette: '矩形', facialFeatures: '', hairAndCostume: '', palette: [], materials: [], distinguishingMarks: [], prohibitedChanges: [] } } })
      const data = Uint8Array.from(atob(pixels[index]!), char => char.charCodeAt(0)).buffer
      const asset = await commitUploadedComicAssetV1({ scope: comic.scope, subjectId: subject.id!, data,
        rights: { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '合成测试图片，不含作者数据。', declaredAt: Date.now() } })
      await selectComicMediaAssetV1({ scope: comic.scope, subjectId: subject.id!, assetKey: asset.stableKey, expectedRevision: subject.revision })
      result.push({ scope: comic.scope, subjectId: subject.id!, assetId: asset.id!, blobId: asset.blobObjectId, label })
    }
    return result
  }, sameProject)
}

async function ownedRows(page: Page, target: ComicSeed) {
  return page.evaluate(async workId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const rows = await Promise.all(db.tables.map(async table => [table.name, (await table.toArray()).filter(row => row.workId === workId || (table.name === 'works' && row.id === workId))]))
    return JSON.parse(JSON.stringify(rows, (_key, value: unknown) => value instanceof ArrayBuffer ? { rawBytes: Array.from(new Uint8Array(value)) } : value)) as unknown
  }, target.scope.workId)
}

async function targetExists(page: Page, target: ComicSeed) {
  return page.evaluate(async item => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return { subject: Boolean(await db.comicVisualSubjects.get(item.subjectId)), asset: Boolean(await db.comicMediaAssets.get(item.assetId)), blob: Boolean(await db.mediaBlobObjects.get(item.blobId)) }
  }, target)
}

for (const sameProject of [false, true]) {
  test(`026 actual visual delete preserves the other same-key comic and its decoded image: ${sameProject ? 'same workspace' : 'different workspaces'}`, async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('026 requires its reviewed isolated loopback server')
    const base = new URL(baseURL)
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('026 refuses author/external origins')
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
    const forbidden: string[] = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
      else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
    })
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    const page = await context.newPage()
    try {
      await page.goto('./', { waitUntil: 'domcontentloaded' })
      const [a, b] = await seed(page, sameProject)
      if (!a || !b) throw new Error('026 missing comic fixtures')
      expect(a.scope.workId).not.toBe(b.scope.workId)
      expect(a.scope.projectId === b.scope.projectId).toBe(sameProject)
      await page.goto(`./comic/references?work=${b.scope.workId}`)
      await expect(page.getByRole('img', { name: `${b.label} 当前参考图`, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.getByRole('img', { name: `${b.label} 当前参考图`, exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1)).toBe(true)
      // The real editor initializes its draft conversation on first open.
      // Complete that normal B initialization before taking its preservation baseline.
      await expect.poll(() => page.evaluate(async item => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        return db.agentConversations.where('projectId').equals(item.scope.projectId).filter(row => row.workId === item.scope.workId && row.purpose.startsWith(`comic-author-draft:subject:${item.subjectId}:r`)).count()
      }, b)).toBeGreaterThan(0)
      await page.goto(`./comic/references?work=${a.scope.workId}`)
      const visual = page.locator('.comic-visual-layout')
      await expect(visual.getByRole('heading', { name: a.label, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => visual.getByRole('img', { name: `${a.label} 当前参考图`, exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1)).toBe(true)
      const beforeA = await ownedRows(page, a), beforeB = await ownedRows(page, b)
      await visual.getByRole('button', { name: '删除', exact: true }).click()
      await page.getByRole('dialog', { name: '删除视觉条目？', exact: true }).getByRole('button', { name: '删除视觉条目', exact: true }).click()
      await expect(visual.locator('aside').getByRole('button').filter({ hasText: a.label })).toHaveCount(0)
      await expect.poll(() => targetExists(page, a)).toEqual({ subject: false, asset: false, blob: false })
      await expect(page.locator('.comic-error')).toHaveCount(0)
      expect(await ownedRows(page, b)).toEqual(beforeB)
      await page.goto(`./comic/references?work=${b.scope.workId}`)
      await expect(page.locator('.comic-visual-layout').getByRole('heading', { name: b.label, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.getByRole('img', { name: `${b.label} 当前参考图`, exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1)).toBe(true)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('img', { name: `${b.label} 当前参考图`, exact: true })).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.getByRole('img', { name: `${b.label} 当前参考图`, exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1)).toBe(true)
      // Project activeWork pointers are shared navigation state. Compare the
      // entire retained Work, its owned table rows and exact Blob bytes instead.
      expect(await ownedRows(page, b)).toEqual(beforeB)
      expect(forbidden).toEqual([])
      await testInfo.attach('026-owner-and-media-preservation', { contentType: 'application/json', body: JSON.stringify({
        sameProject, target: a, retained: b, originalTargetSha256: hash(beforeA), retainedRowsAndBytesSha256: hash(beforeB),
        seed: 'public original/adaptation/visual/upload/select APIs; not UI upload or model generation',
        UI: 'actual comic visual page and explicit deletion; retained comic image decoded before and after reload',
        models: 0, realAuthorData: false, forbidden,
        doesNotClaim: ['cancellation-chain completion', 'full release pin browser coverage', 'full browser transaction-failure coverage', 'all CI/E2E', 'G1'],
      }, null, 2) })
    } finally { await context.close() }
  })
}
