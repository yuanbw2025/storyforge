import { expect, test, type Page } from '@playwright/test'

async function readRows(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return {
      locations: await db.importantLocations.where('projectId').equals(id).toArray(),
      chapters: await db.chapters.where('projectId').equals(id).toArray(),
    }
  }, projectId)
}

test('129 restores absent legacy fields without backfill, then saves only an explicit author tag edit', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(60_000)
  if (!baseURL) throw new Error('129 requires an isolated loopback origin')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('129 refuses author/external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: string[] = [], errors: string[] = []
  await context.addInitScript(({ allowedOrigin }) => {
    if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'quality129-missing-isolated')
  }, { allowedOrigin: base.origin })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort() }
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 })
    const seeded = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
      const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
      if (await db.projects.count()) throw new Error('129 requires empty isolated storage')
      const owned = await createWorkspace({ name: 'QUALITY129缺失字段隔离恢复', description: '', genres: ['realism'], status: 'drafting', targetWordCount: 10_000 },
        { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
      const location = await adopt({ projectId: owned.scope.projectId, scope: owned.scope, target: 'importantLocations', mode: 'add',
        data: { name: '旧港', tags: ['港口'], description: '作者原地点正文', significance: '原剧情作用', parentId: null, sortOrder: 0 } })
      const outline = await adopt({ projectId: owned.scope.projectId, scope: owned.scope, target: 'outlineNodes', mode: 'add',
        data: { title: '原章纲', type: 'chapter', parentId: null, summary: '原章纲正文', order: 0 } })
      if (location.written.length !== 1 || outline.written.length !== 1) throw new Error('129 public fixture adoption failed')
      const chapter = await adopt({ projectId: owned.scope.projectId, scope: owned.scope, target: 'chapters', mode: 'add',
        data: { outlineNodeId: outline.written[0].id, title: '旧章节', content: '', wordCount: 0, order: 0, status: 'outline', notes: '' } })
      if (chapter.written.length !== 1) throw new Error('129 public chapter fixture adoption failed')
      const backup = await exportProjectJSON(owned.scope.projectId)
      // Model the exact historical absence proven by the pre-fix public-adopt
      // probe. Only the portable DTO changes; the actual source rows stay intact.
      Reflect.deleteProperty(backup.importantLocations[0], 'tags')
      Reflect.deleteProperty(backup.chapters[0], 'content')
      return { sourceId: owned.scope.projectId, wire: JSON.stringify(backup) }
    })
    const sourceBefore = await readRows(page, seeded.sourceId)
    await testInfo.attach('legacy-missing-synthetic-wire', { body: Buffer.from(seeded.wire), contentType: 'application/json' })
    await page.goto('./home/data')
    const upload = page.getByLabel('导入 JSON 备份', { exact: true })
    await expect(upload).toBeAttached()
    await upload.setInputFiles({ name: 'quality129-legacy-missing.json', mimeType: 'application/json', buffer: Buffer.from(seeded.wire) })
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      return db.projects.count()
    })).toBe(2)
    const restored = await page.evaluate(async sourceId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { worldModulePath } = await load<typeof import('../../src/components/world-engine/navigation')>('/storyforge/src/components/world-engine/navigation.ts')
      const project = (await db.projects.toArray()).find(row => row.id !== sourceId)
      if (!project?.id) throw new Error('129 restored workspace missing')
      return { projectId: project.id, url: worldModulePath(project.id, 'locations') }
    }, seeded.sourceId)
    const before = await readRows(page, restored.projectId)
    expect(before.locations).toHaveLength(1); expect(before.chapters).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(before.locations[0], 'tags')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(before.chapters[0], 'content')).toBe(false)
    await page.goto(`.${restored.url}`)
    const region = page.getByRole('region', { name: '地点与地图工作区', exact: true })
    await expect(region).toBeVisible({ timeout: 20_000 })
    await expect(region.locator('svg text').filter({ hasText: /^旧港$/ })).toBeVisible()
    await expect(region.getByRole('textbox', { name: '旧港标签原值', exact: true })).toHaveCount(0)
    expect(await readRows(page, restored.projectId)).toEqual(before)
    await region.getByRole('button', { name: '列表', exact: true }).click()
    await region.getByRole('button', { name: '旧港', exact: true }).click()
    await region.getByRole('button', { name: '展开标签选择', exact: true }).click()
    await region.getByRole('button', { name: /港口/ }).click()
    await expect.poll(async () => (await readRows(page, restored.projectId)).locations[0].tags).toBe('["港口"]')
    const edited = await readRows(page, restored.projectId)
    expect(edited.locations[0].description).toBe(before.locations[0].description)
    expect(edited.locations[0].ragDocumentId).toBe(before.locations[0].ragDocumentId)
    expect(edited.chapters).toEqual(before.chapters)
    expect(await readRows(page, seeded.sourceId)).toEqual(sourceBefore)
    await page.reload()
    await expect(region).toBeVisible({ timeout: 20_000 })
    expect(await readRows(page, restored.projectId)).toEqual(edited)
    const exported = await page.evaluate(async projectId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
      const { inspectProjectBackup } = await load<typeof import('../../src/lib/export/backup-trust')>('/storyforge/src/lib/export/backup-trust.ts')
      const backup = await exportProjectJSON(projectId)
      return { valid: inspectProjectBackup(backup).valid, chapterHasContent: Object.prototype.hasOwnProperty.call(backup.chapters[0], 'content') }
    }, restored.projectId)
    expect(exported).toEqual({ valid: true, chapterHasContent: false })
    expect(forbidden).toEqual([]); expect(errors).toEqual([])
  } finally { await context.close() }
})
