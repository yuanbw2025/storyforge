import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ProjectExportData } from '../../src/lib/export/json-export'

interface Seed {
  projectId: number
  badId: number
  goodId: number
  url: string
  backup: ProjectExportData | null
}

async function seed(page: Page, corrupt: boolean): Promise<Seed> {
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  return page.evaluate(async damaged => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    if (await db.projects.count()) throw new Error('129 requires empty isolated storage')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { useLocationStore } = await load<typeof import('../../src/stores/location')>('/storyforge/src/stores/location.ts')
    const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
    const { worldModulePath } = await load<typeof import('../../src/components/world-engine/navigation')>('/storyforge/src/components/world-engine/navigation.ts')
    const f = await createWorkspace({ name: 'QUALITY129隔离备份与地点', description: '', genres: ['realism'], status: 'drafting', targetWordCount: 10_000 },
      { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const add = (name: string) => useLocationStore.getState().addLocation({ projectId: f.scope.projectId, name,
      tags: '["港口"]', description: '逐字保留的地点原文', significance: '作者确认的剧情作用', parentId: null, sortOrder: 0 })
    const badId = await add('旧港'), goodId = await add('可正常编辑的邻港')
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
      projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '到港', summary: '船到旧港。', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })) as number
    await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId,
      title: '到港', content: '<p>需要保护的作者原稿。</p>', wordCount: 10, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const backup = damaged ? null : await exportProjectJSON(f.scope.projectId)
    // Historical corruption fixture only. All new author writes use the guarded store.
    if (damaged) await db.importantLocations.update(badId, { tags: 'null' })
    return { projectId: f.scope.projectId, badId, goodId, backup,
      url: `.${worldModulePath(f.scope.projectId, 'locations', new URLSearchParams({ placeTab: 'locations' }))}` }
  }, corrupt)
}

async function counts(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])))
  })
}

async function rows(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return { locations: await db.importantLocations.where('projectId').equals(id).toArray(),
      chapters: await db.chapters.where('projectId').equals(id).toArray() }
  }, projectId)
}

for (const scenario of ['backup-preflight', 'explicit-repair'] as const) {
  test(`129 actual ${scenario} preserves author rows without any model request`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('129 requires isolated loopback')
    const base = new URL(baseURL)
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('129 refuses author or external origins')
    const context = await browser.newContext({ baseURL, acceptDownloads: true, serviceWorkers: 'block' })
    const forbidden: string[] = [], errors: string[] = []
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality129-isolated'))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
      else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort() }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    try {
      const f = await seed(page, scenario === 'explicit-repair')
      if (scenario === 'backup-preflight') {
        const backup = f.backup!
        await page.goto('./home/data')
        const upload = page.getByLabel('导入 JSON 备份', { exact: true })
        await expect(upload).toBeAttached()
        const before = await counts(page), original = await rows(page, f.projectId)
        for (const kind of ['null-tags', 'object-tags', 'body-object']) {
          const bad = structuredClone(backup)
          if (kind === 'body-object') Reflect.set(bad.chapters[0], 'content', { blocks: [] })
          else bad.importantLocations[0].tags = kind === 'null-tags' ? 'null' : '{}'
          await upload.setInputFiles({ name: `quality129-${kind}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) })
          await expect(page.getByRole('alert').filter({ hasText: kind === 'body-object' ? /chapters\[0\].*content/ : /importantLocations\[0\].*tags/ })).toBeVisible()
          await expect(page.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
          expect(await counts(page)).toEqual(before)
          expect(await rows(page, f.projectId)).toEqual(original)
        }
        await upload.setInputFiles({ name: 'quality129-valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
        await page.getByRole('button', { name: '确认导入', exact: true }).click()
        await expect.poll(async () => (await counts(page)).projects).toBe(before.projects + 1)
        const restoredId = await page.evaluate(async id => {
          const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
          const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
          return (await db.projects.toArray()).find(project => project.id !== id)!.id!
        }, f.projectId)
        const restored = await rows(page, restoredId)
        expect(restored.locations.map(row => row.tags)).toEqual(original.locations.map(row => row.tags))
        expect(restored.chapters[0].content).toBe(original.chapters[0].content)
        expect(await rows(page, f.projectId)).toEqual(original)
      } else {
        const before = await rows(page, f.projectId)
        await page.goto(f.url)
        await expect(page.getByRole('region', { name: '地点与地图工作区' })).toBeVisible()
        const raw = page.getByRole('textbox', { name: '旧港标签原值', exact: true })
        const draft = page.getByRole('textbox', { name: '修复旧港标签', exact: true })
        await expect(raw).toHaveValue('null')
        await expect(page.locator('svg text').filter({ hasText: /^可正常编辑的邻港$/ })).toBeVisible()
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出标签原值', exact: true }).click()])
        const downloadedPath = await download.path()
        if (!downloadedPath) throw new Error('129 actual raw-value download missing')
        expect(JSON.parse(await readFile(downloadedPath, 'utf8'))).toEqual({ locationId: f.badId, field: 'tags', storedType: 'string', value: 'null' })
        expect(await rows(page, f.projectId)).toEqual(before)
        await draft.fill('[7]')
        await page.getByRole('button', { name: '保存标签修复', exact: true }).click()
        await expect(page.getByRole('alert').filter({ hasText: '非字符串' })).toBeVisible()
        expect(await rows(page, f.projectId)).toEqual(before)
        await draft.fill('["港口","城市"]')
        await page.getByRole('button', { name: '保存标签修复', exact: true }).click()
        await expect.poll(async () => (await rows(page, f.projectId)).locations.find(row => row.id === f.badId)?.tags).toBe('["港口","城市"]')
        await expect(draft).toHaveCount(0)
        const after = await rows(page, f.projectId)
        expect(after.locations.find(row => row.id === f.goodId)).toEqual(before.locations.find(row => row.id === f.goodId))
        expect(after.chapters).toEqual(before.chapters)
        expect(after.locations.find(row => row.id === f.badId)?.description).toBe(before.locations.find(row => row.id === f.badId)?.description)
        await page.reload()
        await expect(page.getByRole('region', { name: '地点与地图工作区' })).toBeVisible()
        await expect(page.getByRole('textbox', { name: '修复旧港标签', exact: true })).toHaveCount(0)
        expect(await rows(page, f.projectId)).toEqual(after)
        await page.getByRole('button', { name: '列表', exact: true }).click()
        await expect(page.getByRole('button', { name: /^旧港/ })).toBeVisible()
      }
      expect(forbidden).toEqual([]); expect(errors).toEqual([])
    } finally { await context.close() }
  })
}
