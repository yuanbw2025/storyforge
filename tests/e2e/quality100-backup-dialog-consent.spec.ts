import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ProjectExportData } from '../../src/lib/export/json-export'

interface DeletionObservation { projectId: number; settled: boolean; error: string | null }
type ObservedGlobal = typeof globalThis & { __quality100Deletions?: DeletionObservation[] }
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

async function databaseBytes(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name))
    return db.transaction('r', tables, async () => JSON.stringify(await Promise.all(tables.map(async table => [table.name, await table.toArray()]))))
  })
}

async function protectedManuscript(page: Page, projectId: number): Promise<string> {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return JSON.stringify(await Promise.all([
      db.projects.get(id), db.worlds.where('projectId').equals(id).toArray(), db.works.where('projectId').equals(id).toArray(),
      db.outlineNodes.where('projectId').equals(id).toArray(), db.chapters.where('projectId').equals(id).toArray(),
    ]))
  }, projectId)
}

async function waitForActualDeletionDecision(page: Page, projectId: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const operations = (globalThis as ObservedGlobal).__quality100Deletions
    return operations?.length === 1 && operations[0]?.settled === true
  }), { timeout: 15_000 }).toBe(true)
  const observed = await page.evaluate(() => (globalThis as ObservedGlobal).__quality100Deletions ?? [])
  expect(observed).toEqual([{ projectId, settled: true, error: null }])
}

for (const choice of ['close', 'escape', 'already-backed-up', 'backup-now'] as const) {
  test('100 actual long-library delete backup choice: ' + choice, async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('100 browser check requires its isolated loopback server')
    const base = new URL(baseURL)
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('100 cannot use an author or external origin')
    const context = await browser.newContext({ baseURL, acceptDownloads: true, serviceWorkers: 'block' })
    const blocked: Array<{ method: string; origin: string; pathname: string }> = []
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin === base.origin && ['GET', 'HEAD'].includes(route.request().method())) await route.continue()
      else {
        blocked.push({ method: route.request().method(), origin: url.origin, pathname: url.pathname })
        await route.abort('blockedbyclient')
      }
    })
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    const page = await context.newPage()
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    try {
      await page.goto('./', { waitUntil: 'domcontentloaded' })
      // Public API seed, not a UI creation claim. No direct table writes or author profile.
      const seeded = await page.evaluate(async () => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
        const { htmlToPlainText } = await load<typeof import('../../src/lib/utils/html')>('/storyforge/src/lib/utils/html.ts')
        const { readOwnedRows } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
        if (await db.projects.count() || await db.works.count()) throw new Error('100 expects fresh isolated storage')
        const targetText = 'Q100_TARGET 原文 & <原样保存> e\u0301 𐀀。'
        const otherText = 'Q100_OTHER 保留作品的每个字。'
        const target = await createWorkspace({ name: 'QUALITY100 待删除原稿', description: '', genres: [], status: 'drafting', targetWordCount: 100_000 }, {
          kind: 'novel', novelProfile: 'long', importedNovelText: targetText,
        })
        const other = await createWorkspace({ name: 'QUALITY100 保留原稿', description: '', genres: [], status: 'drafting', targetWordCount: 100_000 }, {
          kind: 'novel', novelProfile: 'long', importedNovelText: otherText,
        })
        const chapters = await readOwnedRows<import('../../src/lib/types').Chapter>(target.scope, 'chapters', { owner: 'work' })
        if (chapters.length !== 1 || await db.chapters.where('projectId').equals(target.scope.projectId).count() !== 1
          || htmlToPlainText(chapters[0]!.content) !== targetText) throw new Error('100 target must preserve the complete synthetic original')
        return { target: target.scope, other: other.scope, targetText, otherText, targetWorkspaceUid: target.project.workspaceUid,
          targetWorkCode: target.work.code, targetWorldCode: target.world.code,
          targetChapters: chapters.map(row => ({ title: row.title, content: row.content })) }
      })
      await page.goto('./long')
      const targetCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'QUALITY100 待删除原稿', exact: true }) })
      const otherCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'QUALITY100 保留原稿', exact: true }) })
      await expect(targetCard).toBeVisible({ timeout: 15_000 })
      await expect(otherCard).toBeVisible()

      // Passive completion observer for the ORIGINAL public store promise invoked by UI.
      // Return that exact promise; consent, exporter, cascade and result are not mocked.
      // This prevents a false pass from reading DB before an erroneous async delete runs.
      await page.evaluate(async () => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { useProjectStore } = await load<typeof import('../../src/stores/project')>('/storyforge/src/stores/project.ts')
        const operations: DeletionObservation[] = []
        ;(globalThis as ObservedGlobal).__quality100Deletions = operations
        const original = useProjectStore.getState().deleteProject
        useProjectStore.setState({ deleteProject: id => {
          const observation: DeletionObservation = { projectId: id, settled: false, error: null }
          operations.push(observation)
          const result = original(id)
          void result.then(() => { observation.settled = true }, (reason: unknown) => {
            observation.error = reason instanceof Error ? reason.message : String(reason)
            observation.settled = true
          })
          return result
        } })
      })
      const originalOther = await protectedManuscript(page, seeded.other.projectId)
      const before = await databaseBytes(page)
      await targetCard.getByRole('button', { name: '删除作品', exact: true }).click()
      const first = page.getByRole('dialog', { name: '危险操作:删除项目', exact: true })
      await expect(first).toBeVisible()
      await first.getByRole('button', { name: '继续', exact: true }).click()
      const backup = page.getByRole('dialog', { name: /^是否立即下载备份/ })
      await expect(backup).toBeVisible()
      let backupEvidence: { filename: string; sha256: string; bytes: number; chapterHtmlSha256: string } | null = null
      if (choice === 'close') await backup.getByRole('button', { name: '关闭', exact: true }).click()
      else if (choice === 'escape') await page.keyboard.press('Escape')
      else if (choice === 'already-backed-up') await backup.getByRole('button', { name: '已备份，继续', exact: true }).click()
      else {
        const downloaded = page.waitForEvent('download', { timeout: 15_000 })
        await backup.getByRole('button', { name: '立即备份', exact: true }).click()
        const download = await downloaded
        expect(await download.failure()).toBeNull()
        expect(download.suggestedFilename()).toMatch(/^storyforge-backup-before-删除项目-.*\.json$/)
        const path = await download.path()
        if (!path) throw new Error('100 real JSON download must have completed')
        const bytes = await readFile(path)
        const text = bytes.toString('utf8')
        const exported = JSON.parse(text) as ProjectExportData
        expect(exported.project.workspaceUid).toBe(seeded.targetWorkspaceUid)
        expect(exported.worlds).toHaveLength(1)
        expect(exported.works).toHaveLength(1)
        expect(exported.worlds[0]).toMatchObject({ _exportId: exported.ownership.worldExportId, code: seeded.targetWorldCode })
        expect(exported.works[0]).toMatchObject({ _exportId: exported.ownership.workExportId,
          _worldExportId: exported.ownership.worldExportId, code: seeded.targetWorkCode, title: 'QUALITY100 待删除原稿', kind: 'novel', novelProfile: 'long' })
        expect(exported.chapters.map(row => ({ title: row.title, content: row.content }))).toEqual(seeded.targetChapters)
        expect(text).not.toContain(seeded.otherText)
        const expectedHtmlHash = sha256(JSON.stringify(seeded.targetChapters))
        const downloadedHtmlHash = sha256(JSON.stringify(exported.chapters.map(row => ({ title: row.title, content: row.content }))))
        expect(downloadedHtmlHash).toBe(expectedHtmlHash)
        backupEvidence = { filename: download.suggestedFilename(), sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length, chapterHtmlSha256: downloadedHtmlHash }
        await testInfo.attach('100-real-full-project-backup.json', { contentType: 'application/json', body: bytes })
      }
      await waitForActualDeletionDecision(page, seeded.target.projectId)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const canceled = choice === 'close' || choice === 'escape'
      let targetRows: { projectExists: boolean; works: number; outline: number; prose: number } | null = null
      if (canceled) {
        expect(await databaseBytes(page)).toBe(before)
        await expect(targetCard).toBeVisible()
      } else {
        await expect(targetCard).toHaveCount(0)
        targetRows = await page.evaluate(async id => {
          const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
          const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
          return { projectExists: Boolean(await db.projects.get(id)), works: await db.works.where('projectId').equals(id).count(),
            outline: await db.outlineNodes.where('projectId').equals(id).count(), prose: await db.chapters.where('projectId').equals(id).count() }
        }, seeded.target.projectId)
        expect(targetRows).toEqual({ projectExists: false, works: 0, outline: 0, prose: 0 })
      }
      await expect(otherCard).toBeVisible()
      expect(await protectedManuscript(page, seeded.other.projectId)).toBe(originalOther)
      expect(downloads).toHaveLength(choice === 'backup-now' ? 1 : 0)
      expect(blocked).toEqual([])
      await testInfo.attach('100-browser-consent-evidence', { contentType: 'application/json', body: JSON.stringify({
        choice, canceled, sourceCreation: 'public createWorkspace long-original API', consent: 'actual long-library UI and main StrictMode DialogProvider',
        observer: 'Delegated exact original public deleteProject Promise; no result/permission/export/cascade mock',
        scope: { target: seeded.target, other: seeded.other }, databaseBeforeSha256: sha256(before),
        canceledDatabaseUnchanged: canceled, targetRows, targetOriginalTextSha256: sha256(seeded.targetText),
        targetOriginalHtmlSha256: sha256(JSON.stringify(seeded.targetChapters)), protectedOtherManuscriptSha256: sha256(originalOther),
        backupEvidence, downloads, blocked, models: 0, realAuthorProfile: false,
      }, null, 2) })
    } finally { await context.close() }
  })
}
