import { expect, test, type Page } from '@playwright/test'

async function facts(page: Page, projectId: number, chapterId: number) {
  return page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useBackupStore, backupOwnerKey } = await load<typeof import('../../src/stores/backup')>('/storyforge/src/stores/backup.ts')
    const project = (await db.projects.get(input.projectId))!
    const rows = await db.snapshots.where('projectId').equals(input.projectId).toArray()
    return {
      status: useBackupStore.getState().autoStatus[backupOwnerKey({ projectId: input.projectId, workspaceUid: project.workspaceUid })],
      rows: rows.map(row => ({ id: row.id, type: row.type, createdAt: row.createdAt,
        recursive: Reflect.has(JSON.parse(row.data), 'snapshots') })),
      chapter: (await db.chapters.get(input.chapterId))?.content,
      attempts: Reflect.get(globalThis, 'quality143Attempts') as number | undefined,
    }
  }, { projectId, chapterId })
}

test('143 actual author surface preserves a failed snapshot, recovers on its next timer tick and reloads real facts', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('143 requires isolated loopback')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('143 refuses author storage or external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: string[] = [], errors: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(request.method() + ' ' + url.origin); await route.abort() }
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality143-isolated'))
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  try {
    await page.goto('./')
    const fixture = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw new Error('143 requires empty isolated storage')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
      const { useBackupStore } = await load<typeof import('../../src/stores/backup')>('/storyforge/src/stores/backup.ts')
      const f = await createWorkspace({ name: 'QUALITY143隔离自动快照', description: '', genres: ['realism'],
        status: 'drafting', targetWordCount: 1000 }, { kind: 'novel', novelProfile: 'long' })
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
        projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '应保留的章节', summary: '',
        order: 0, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' })) as number
      const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
        projectId: f.scope.projectId, outlineNodeId, title: '应保留的章节', content: '<p>自动快照失败不得丢失的作者原稿。</p>',
        wordCount: 19, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
      }, { owner: 'work' })) as number
      const manualId = await useBackupStore.getState().createSnapshot(f.scope.projectId, '长期手动快照', 'manual')
      return { projectId: f.scope.projectId, chapterId, manualId }
    })
    await page.goto('./workspace/' + fixture.projectId + '?module=info')
    await expect.poll(async () => page.evaluate(async id => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useBackupStore } = await load<typeof import('../../src/stores/backup')>('/storyforge/src/stores/backup.ts')
      return useBackupStore.getState().activeView?.owner?.projectId === id
    }, fixture.projectId)).toBe(true)
    await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      let first = true
      Reflect.set(globalThis, 'quality143Attempts', 0)
      db.snapshots.hook('creating', (_key, row) => {
        if (row.type !== 'auto') return
        Reflect.set(globalThis, 'quality143Attempts', (Reflect.get(globalThis, 'quality143Attempts') as number) + 1)
        if (first) { first = false; throw new DOMException('synthetic private quota details', 'QuotaExceededError') }
      })
    })
    await page.clock.fastForward(5 * 60 * 1000)
    const notice = page.getByRole('alert', { name: '自动快照状态' })
    await expect(notice).toContainText('自动快照未更新')
    await page.clock.fastForward(4000)
    await expect(notice).toBeVisible()
    await expect(notice).not.toContainText('synthetic private')
    const failed = await facts(page, fixture.projectId, fixture.chapterId)
    expect(failed.status.state).toBe('failed')
    expect(failed.rows.map(row => row.id)).toEqual([fixture.manualId])
    expect(failed.chapter).toBe('<p>自动快照失败不得丢失的作者原稿。</p>')
    await page.clock.fastForward(5 * 60 * 1000)
    await expect.poll(async () => (await facts(page, fixture.projectId, fixture.chapterId)).status.state).toBe('saved')
    await expect(notice).toHaveCount(0)
    const recovered = await facts(page, fixture.projectId, fixture.chapterId)
    expect(recovered.attempts).toBe(2)
    expect(recovered.rows.filter(row => row.type === 'auto')).toHaveLength(1)
    expect(recovered.rows.some(row => row.id === fixture.manualId)).toBe(true)
    expect(recovered.rows.every(row => !row.recursive)).toBe(true)
    expect(recovered.chapter).toBe(failed.chapter)
    await page.goto('./home/data?project=' + fixture.projectId)
    await expect(page.getByRole('status', { name: '自动快照状态' })).toContainText('最近可核对的自动快照')
    const cold = await facts(page, fixture.projectId, fixture.chapterId)
    expect(cold.status).toMatchObject({ state: 'unverified', snapshotId: recovered.status.snapshotId, problem: null })
    expect(cold.rows).toEqual(recovered.rows)
    expect(cold.chapter).toBe(failed.chapter)
    expect(forbidden).toEqual([])
    expect(errors).toEqual([])
  } finally { await context.close() }
})
