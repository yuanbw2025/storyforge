import { expect, test } from '@playwright/test'

test('037 complete backup upload discloses unknown associations and retains exact evidence after reload', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('037 requires an isolated loopback origin')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('037 refuses author/external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const blocked: string[] = []
  await context.addInitScript(({ origin }) => {
    if (location.origin === origin) localStorage.setItem('storyforge_guide_completed', 'quality037-isolated')
  }, { origin: base.origin })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort() }
  })
  const page = await context.newPage()
  try {
    await page.goto('./')
    const wire = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
      const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
      if (await db.projects.count()) throw new Error('037 requires empty isolated storage')
      const { scope } = await createWorkspace({ name: '037 原作品保留', genres: [], description: '',
        targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
      await db.notes.add(stampNewRecord(scope, 'notes', {
        projectId: scope.projectId, content: '原作者便签 e\u0301 🌙', color: 'yellow', pinned: false, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      const backup = await exportProjectJSON(scope.projectId)
      Reflect.deleteProperty(backup.notes[0], '_chapterExportId')
      backup.notes[0].chapterId = 98173
      return { backup, original: scope.projectId }
    })
    await page.goto('./home/data')
    const label = '备份恢复：待确认关联'
    await page.getByLabel('导入 JSON 备份', { exact: true }).setInputFiles({
      name: '037-legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wire.backup)),
    })
    const consent = page.getByRole('dialog')
    await expect(consent).toContainText('1 项关联待确认')
    await expect(consent).toContainText(label)
    await consent.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect(page).toHaveURL(/home\/data\?project=\d+/)
    await page.reload()
    await page.locator('summary').filter({ hasText: label }).click()
    await expect(page.locator('pre').filter({ hasText: '"原值":98173' })).toBeVisible()
    const restored = await page.evaluate(async original => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const project = (await db.projects.toArray()).find(row => row.id !== original)!
      const notes = await db.notes.where('projectId').equals(project.id!).toArray()
      const originalNotes = await db.notes.where('projectId').equals(original).toArray()
      return { count: notes.length, originalCount: originalNotes.length,
        chapter: notes.find(note => note.content.startsWith('原作者'))?.chapterId, content: originalNotes[0].content }
    }, wire.original)
    expect(restored).toEqual({ count: 2, originalCount: 1, chapter: null, content: '原作者便签 e\u0301 🌙' })
    expect(blocked).toEqual([])
  } finally { await context.close() }
})
