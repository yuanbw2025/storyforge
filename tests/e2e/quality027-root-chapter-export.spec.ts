import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

async function databaseBytes(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name))
    return db.transaction('r', tables, async () => JSON.stringify(
      await Promise.all(tables.map(async table => [table.name, await table.toArray()])),
    ))
  })
}

async function editorPlainText(page: Page): Promise<string> {
  return page.locator('.tiptap-editor').evaluate(async element => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { htmlToPlainText } = await load<typeof import('../../src/lib/utils/html')>('/storyforge/src/lib/utils/html.ts')
    return htmlToPlainText(element.innerHTML)
  })
}

function assertFullBodiesOnceInOrder(text: string, bodies: string[]) {
  let previousEnd = -1
  for (const body of bodies) {
    expect(text.split(body).length - 1, `full body occurrences: ${body.slice(0, 24)}`).toBe(1)
    const start = text.indexOf(body)
    expect(start).toBeGreaterThan(previousEnd)
    previousEnd = start + body.length - 1
  }
}

test('027 public long-import API → default root-chapter UI → real TXT/Markdown downloads', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('027 browser verification requires the configured loopback baseURL')
  const origin = new URL(baseURL).origin
  if (new URL(baseURL).protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('027 browser verification is limited to the isolated loopback test server')
  }
  // Explicit fresh browser storage; no persistent author profile or configured provider.
  const context = await browser.newContext({ baseURL, acceptDownloads: true, serviceWorkers: 'block' })
  const blocked: Array<{ method: string; origin: string; pathname: string }> = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else {
      blocked.push({ method: request.method(), origin: url.origin, pathname: url.pathname })
      await route.abort('blockedbyclient')
    }
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  const page = await context.newPage()
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    const source = [
      `第一章 初潮\nQ027_FIRST_BEGIN & <literal> e\u0301 𐀀|${'甲'.repeat(11_000)}|Q027_FIRST_END`,
      `第二章 晚港\nQ027_SECOND_BEGIN & <literal> é 𐀀|${'乙'.repeat(11_000)}|Q027_SECOND_END`,
    ].join('\n')
    // API seed through the real governed long-original importer, not a UI import
    // wizard and not direct table insertion. All following selection/downloads use UI.
    const seed = await page.evaluate(async text => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { readOwnedRows } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
      const { htmlToPlainText } = await load<typeof import('../../src/lib/utils/html')>('/storyforge/src/lib/utils/html.ts')
      if (await db.projects.count() || await db.works.count()) throw new Error('027 context must start without author works')
      const created = await createWorkspace({ name: 'QUALITY027 根级原作', description: 'isolated synthetic source', genres: [], targetWordCount: 100_000, status: 'drafting' }, {
        purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: text,
      })
      const nodes = (await readOwnedRows<import('../../src/lib/types').OutlineNode>(created.scope, 'outlineNodes', { owner: 'work' }))
        .sort((a, b) => a.order - b.order || a.id! - b.id!)
      const rows = await readOwnedRows<import('../../src/lib/types').Chapter>(created.scope, 'chapters', { owner: 'work' })
      if (nodes.length !== 2 || rows.length !== 2 || nodes.some(node => node.type !== 'chapter' || node.parentId !== null)) {
        throw new Error('027 fixture must contain exactly two real root chapters and no synthetic volume')
      }
      const chapters = nodes.map(node => {
        const row = rows.find(chapter => chapter.outlineNodeId === node.id)
        if (!row?.id || !node.id) throw new Error('027 imported source/body identity is incomplete')
        return { id: row.id, outlineNodeId: node.id, title: node.title, html: row.content, plain: htmlToPlainText(row.content) }
      })
      return { scope: created.scope, chapters }
    }, source)
    expect(seed.chapters.map(chapter => chapter.plain).join('\n')).toBe(source)

    const defaultURL = `./workspace/${seed.scope.projectId}?module=chapters-list`
    await page.goto(defaultURL)
    await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).searchParams.has('chapter')).toBe(false)
    await expect(page.locator('.tiptap-editor')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => editorPlainText(page), { timeout: 15_000 }).toBe(seed.chapters[0].plain)
    await expect(page.getByText(/共 2 章 ·/)).toBeVisible()
    for (const chapter of seed.chapters) {
      await expect(page.getByRole('button').filter({ has: page.getByText(chapter.title, { exact: true }) })).toHaveCount(1)
    }
    await page.getByRole('button').filter({ has: page.getByText(seed.chapters[1].title, { exact: true }) }).click()
    await expect.poll(() => editorPlainText(page), { timeout: 15_000 }).toBe(seed.chapters[1].plain)
    expect(new URL(page.url()).searchParams.has('chapter')).toBe(false)

    expect(await openLongformLeaf(page, '数据管理')).toBe(true)
    await expect(page.getByRole('button', { name: '导出 TXT', exact: true })).toBeVisible({ timeout: 15_000 })
    const beforeDownloads = await databaseBytes(page)
    const downloads: Array<{ format: string; sha256: string; bytes: number }> = []
    for (const format of ['TXT', 'Markdown'] as const) {
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name: `导出 ${format}`, exact: true }).click()
      const download = await pending
      expect(await download.failure()).toBeNull()
      expect(download.suggestedFilename()).toMatch(format === 'TXT' ? /\.txt$/ : /\.md$/)
      const saved = await download.path()
      if (!saved) throw new Error('027 download did not produce a real local file')
      const text = await readFile(saved, 'utf8')
      const expectedBodies = seed.chapters.map(chapter => format === 'TXT' ? chapter.plain : chapter.plain.replace(/\n/g, '\n\n'))
      assertFullBodiesOnceInOrder(text, expectedBodies)
      expect(await databaseBytes(page)).toBe(beforeDownloads)
      await testInfo.attach(`027-actual-${format}`, { path: saved, contentType: 'text/plain; charset=utf-8' })
      downloads.push({ format, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8') })
    }
    const originalBodies = await page.evaluate(async scope => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { readOwnedRows } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
      const chapters = await readOwnedRows<import('../../src/lib/types').Chapter>(scope, 'chapters', { owner: 'work' })
      return chapters.map(chapter => ({ id: chapter.id, outlineNodeId: chapter.outlineNodeId, content: chapter.content })).sort((a, b) => a.id! - b.id!)
    }, seed.scope)
    expect(originalBodies).toEqual(seed.chapters.map(chapter => ({ id: chapter.id, outlineNodeId: chapter.outlineNodeId, content: chapter.html })).sort((a, b) => a.id - b.id))
    expect(blocked).toEqual([])
    await testInfo.attach('027-browser-evidence', { contentType: 'application/json', body: JSON.stringify({
      sourceCreation: 'public createWorkspace importedNovelText API', defaultURL, noChapterQuery: true,
      scope: seed.scope, chapterIds: seed.chapters.map(chapter => chapter.id), outlineNodeIds: seed.chapters.map(chapter => chapter.outlineNodeId),
      sourceSha256: sha256(source), sourceBodyHashes: seed.chapters.map(chapter => sha256(chapter.plain)),
      databaseBeforeAndAfterDownloadsSha256: sha256(beforeDownloads), downloads, blockedRequests: blocked,
      models: 0, realAuthorProfile: false,
    }, null, 2) })
  } finally { await context.close() }
})
