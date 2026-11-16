import { expect, test } from '@playwright/test'

test('030 backup upload rejects invalid mandatory references before consent and reopens valid non-continuous IDs', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('030 requires an isolated loopback origin')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('030 refuses author/external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: string[] = []
  await context.addInitScript(({ allowedOrigin }) => {
    if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'quality030-isolated')
  }, { allowedOrigin: base.origin })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort() }
  })
  const page = await context.newPage()
  try {
    await page.goto('./')
    const seeded = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
      const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
      if (await db.projects.count()) throw new Error('030 requires empty isolated storage')
      const { scope } = await createWorkspace({ name: '030 原作品保留', genres: ['fantasy'], description: '',
        targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
      const text = '<p>潮汐 e\u0301 🌙 逐字保留。</p>'
      const outline = await adopt({ scope, projectId: scope.projectId, target: 'outlineNodes', mode: 'add',
        data: { title: '原章纲', type: 'chapter', summary: '潮汐', parentId: null, order: 0 } })
      const chapter = await adopt({ scope, projectId: scope.projectId, target: 'chapters', mode: 'add',
        data: { title: '原稿章', content: text, wordCount: 9, order: 0, status: 'draft', notes: '', outlineNodeId: outline.written[0].id } })
      if (chapter.written.length !== 1) throw new Error('030 fixture must contain one actual chapter')
      return { backup: await exportProjectJSON(scope.projectId), sourceId: scope.projectId, text }
    })
    const counts = () => page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      return { projects: await db.projects.count(), worlds: await db.worlds.count(), works: await db.works.count(),
        outlines: await db.outlineNodes.count(), chapters: await db.chapters.count() }
    })
    const original = await counts()
    await page.goto('./home/data')
    const upload = page.getByLabel('导入 JSON 备份', { exact: true })
    for (const broken of ['outline', 'active-work'] as const) {
      const invalid = structuredClone(seeded.backup)
      if (broken === 'outline') Reflect.deleteProperty(invalid.chapters[0], '_outlineExportId')
      else invalid.project._activeWorkExportId = null
      const expected = broken === 'outline' ? /chapters.*outline/i : /project.*activeWork/i
      await upload.setInputFiles({ name: `030-${broken}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) })
      await expect(page.getByRole('alert').filter({ hasText: expected })).toBeVisible()
      await expect(page.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
      expect(await counts()).toEqual(original)
    }

    const valid = structuredClone(seeded.backup)
    valid.outlineNodes[0]._exportId = 799
    valid.chapters[0]._outlineExportId = 799
    Object.assign(valid.chapters[0], { _perspectiveCharacterExportId: null })
    await upload.setInputFiles({ name: '030-valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(valid)) })
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect.poll(async () => (await counts()).projects).toBe(original.projects + 1)
    const result = await page.evaluate(async sourceId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { resolveWorkspaceScope } = await load<typeof import('../../src/lib/workspace/ownership')>('/storyforge/src/lib/workspace/ownership.ts')
      const project = (await db.projects.toArray()).find(row => row.id !== sourceId)!
      const scope = await resolveWorkspaceScope(project.id!)
      const chapter = (await db.chapters.where('projectId').equals(project.id!).first())!
      const original = (await db.chapters.where('projectId').equals(sourceId).first())!
      const outline = (await db.outlineNodes.get(chapter.outlineNodeId))!
      return { text: chapter.content, originalText: original.content, target: outline.title, optional: chapter.perspectiveCharacterId,
        sameWork: outline.workId === scope.workId && Object.getOwnPropertyDescriptor(chapter, 'workId')?.value === scope.workId, physicalRemap: outline.id !== original.outlineNodeId }
    }, seeded.sourceId)
    expect(result).toEqual({ text: seeded.text, originalText: seeded.text, target: '原章纲', optional: null,
      sameWork: true, physicalRemap: true })
    expect(forbidden).toEqual([])
  } finally { await context.close() }
})
