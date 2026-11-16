import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const boundaries = new WeakMap<BrowserContext, string[]>()
const errors = new WeakMap<Page, string[]>()
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('isolated loopback app required')
  const origin = new URL(baseURL).origin, blocked: string[] = [], pageErrors: string[] = []
  boundaries.set(context, blocked); errors.set(page, pageErrors)
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality048-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
})
test.afterEach(async ({ context, page }, info) => {
  const blocked = boundaries.get(context) ?? [], pageErrors = errors.get(page) ?? []
  await info.attach('foreshadow-network-and-errors', {
    contentType: 'application/json', body: JSON.stringify({ blocked, pageErrors }),
  })
  expect(blocked).toEqual([]); expect(pageErrors).toEqual([])
})

async function seed(page: Page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts') as typeof import('../../src/lib/workspace/create-workspace')
    const { adopt } = await load('/storyforge/src/lib/registry/adopt.ts') as typeof import('../../src/lib/registry/adopt')
    const { useDetailedOutlineStore } = await load('/storyforge/src/stores/detailed-outline.ts') as typeof import('../../src/stores/detailed-outline')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { seedCurrentProductWorld } = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    const f = await createWorkspace({ name: '隔离伏笔删除作品', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 1000 },
      { kind: 'novel', novelProfile: 'long', importedNovelText: '完整作者正文。雨夜的船票没有被删除。' })
    const add = async (name: string) => {
      const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'foreshadows', mode: 'add',
        data: { name, type: 'chekhov', status: 'planned', description: `${name}的完整描述。e\u0301🌙` } })
      if (result.written.length !== 1) throw new Error('公开采纳必须生成真实伏笔')
      return result.written[0].id
    }
    const removed = await add('被删除的船票'), kept = await add('保留的灯火')
    const chapter = (await db.chapters.where('projectId').equals(f.scope.projectId).first())!
    const detail = await useDetailedOutlineStore.getState().getOrCreate(f.scope, chapter.outlineNodeId)
    await useDetailedOutlineStore.getState().save(detail.id!, { foreshadowIds: [kept, removed, kept], openingHook: '细纲作者完整开篇' }, f.scope)
    await seedCurrentProductWorld('伏笔删除的另一个冻结世界')
    return { projectId: f.scope.projectId, removed, kept, detailId: detail.id!, nodeId: chapter.outlineNodeId,
      description: (await db.foreshadows.get(removed))!.description, url: `./workspace/${f.scope.projectId}?module=foreshadow` }
  })
}

async function read(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { foreshadows: await db.foreshadows.toArray(), details: await db.detailedOutlines.toArray(),
      chapters: await db.chapters.toArray(), revisions: await db.worldRevisions.toArray(), releases: await db.worldReleases.toArray() }
  })
}

async function selectRemoved(page: Page) {
  await page.getByText('被删除的船票', { exact: true }).click()
  await expect(page.getByRole('button', { name: '删除伏笔', exact: true })).toBeVisible()
}

test('real author deletion removes only its references and permits the next scene edit and refresh', async ({ page }, info) => {
  const f = await seed(page)
  await page.goto(f.url)
  await selectRemoved(page)
  const before = await read(page)
  await page.getByRole('button', { name: '删除伏笔', exact: true }).click()
  await expect.poll(async () => (await read(page)).foreshadows.some(row => row.id === f.removed)).toBe(false)
  const after = await read(page)
  expect(after.foreshadows).toEqual(before.foreshadows.filter(row => row.id !== f.removed))
  expect(after.details).toEqual(before.details.map(row => row.id === f.detailId
    ? { ...row, foreshadowIds: [f.kept, f.kept], updatedAt: expect.any(Number) } : row))
  expect(after.chapters).toEqual(before.chapters)
  expect(after.revisions).toEqual(before.revisions); expect(after.releases).toEqual(before.releases)
  await page.goto(`./workspace/${f.projectId}?module=detailed-outline&chapter=${f.nodeId}`)
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await expect.poll(async () => (await read(page)).details.find(row => row.id === f.detailId)?.scenes.length).toBe(1)
  const edited = await read(page)
  expect(edited.details.find(row => row.id === f.detailId)?.foreshadowIds).toEqual([f.kept, f.kept])
  expect(edited.chapters).toEqual(before.chapters)
  expect(edited.releases).toEqual(before.releases)
  await page.reload()
  await expect(page.getByRole('button', { name: '添加场景', exact: true })).toBeVisible()
  expect(await read(page)).toEqual(edited)
  await info.attach('foreshadow-delete-and-scene-readback', { contentType: 'application/json', body: JSON.stringify({ before, after, edited }) })
})

test('real native deletion failure keeps the selected complete description and survives refresh', async ({ page }, info) => {
  const f = await seed(page)
  await page.goto(f.url)
  await selectRemoved(page)
  await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    // Actual native deleting hook: related updates must roll back with it.
    db.foreshadows.hook('deleting', key => {
      if (key === id) throw new Error('隔离测试：删除未提交，原数据保留')
    })
  }, f.removed)
  const before = await read(page)
  await page.getByRole('button', { name: '删除伏笔', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('隔离测试：删除未提交，原数据保留')
  await expect(page.getByRole('button', { name: '删除伏笔', exact: true })).toBeEnabled()
  expect(await page.locator('textarea').evaluateAll(inputs => inputs.map(input => (input as HTMLTextAreaElement).value))).toContain(f.description)
  expect(await read(page)).toEqual(before)
  await info.attach('foreshadow-native-failure', { contentType: 'application/json', body: JSON.stringify({ before, after: await read(page) }) })
  await page.reload()
  await selectRemoved(page)
  expect(await page.locator('textarea').evaluateAll(inputs => inputs.map(input => (input as HTMLTextAreaElement).value))).toContain(f.description)
  expect(await read(page)).toEqual(before)
})
