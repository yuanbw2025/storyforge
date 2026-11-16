import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const boundaries = new WeakMap<BrowserContext, string[]>()
const errors = new WeakMap<Page, string[]>()
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('isolated loopback app required')
  const origin = new URL(baseURL).origin, blocked: string[] = [], pageErrors: string[] = []
  boundaries.set(context, blocked); errors.set(page, pageErrors)
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality047-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient')
    } else await route.continue()
  })
})
test.afterEach(async ({ context, page }, info) => {
  const blocked = boundaries.get(context) ?? [], pageErrors = errors.get(page) ?? []
  await info.attach('location-network-and-errors', { contentType: 'application/json', body: JSON.stringify({ blocked, pageErrors, realModelCalls: 0 }) })
  expect(blocked).toEqual([]); expect(pageErrors).toEqual([])
})

async function seed(page: Page, legacy: boolean) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
  return page.evaluate(async legacy => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { createWorkspace } = await importer('/storyforge/src/lib/workspace/create-workspace.ts') as typeof import('../../src/lib/workspace/create-workspace')
    const { useLocationStore } = await importer('/storyforge/src/stores/location.ts') as typeof import('../../src/stores/location')
    const { useCharacterStore } = await importer('/storyforge/src/stores/character.ts') as typeof import('../../src/stores/character')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const releases = await importer('/storyforge/src/lib/world-engine/releases.ts') as typeof import('../../src/lib/world-engine/releases')
    const { worldModulePath } = await importer('/storyforge/src/components/world-engine/navigation.ts') as typeof import('../../src/components/world-engine/navigation')
    const f = await createWorkspace({ name: '隔离地点联动', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 0 },
      { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const add = (name: string, parentId: number | null = null) => useLocationStore.getState().addLocation({
      projectId: f.scope.projectId, name, parentId, tags: '[]', description: `${name}的完整原文`, significance: '保留剧情作用', sortOrder: 0,
    })
    const a = await add('海港'), b = await add('码头', a), c = await add('灯塔')
    const character = await useCharacterStore.getState().addCharacter({ projectId: f.scope.projectId,
      name: '检票员', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '作者简介',
      appearance: '外貌', personality: '性格', background: '完整背景原文', motivation: '动机', abilities: '能力',
      relationships: '[]', arc: '成长原文', location: '原作者地点描述', importantLocationId: b })
    const revision = await releases.createWorldRevision({ scope: f.scope, label: '地点编辑前版本' })
    const release = await releases.publishWorldRevision(revision.id!)
    if (legacy) {
      // Historical corruption fixture only: new writes must use the guarded store.
      await db.importantLocations.update(a, { parentId: b })
      await db.importantLocations.update(c, { parentId: 987654 })
    }
    return { a, b, c, character, revision, release, originalCharacter: (await db.characters.get(character))!,
      originalLocations: await db.importantLocations.toArray(),
      url: `.${worldModulePath(f.scope.projectId, 'locations', new URLSearchParams({ placeTab: 'locations' }))}` }
  }, legacy)
}

async function read(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { locations: await db.importantLocations.toArray(), characters: await db.characters.toArray(),
      revisions: await db.worldRevisions.toArray(), releases: await db.worldReleases.toArray() }
  })
}

test('author parent edits reject cycles, retain focus and clean registered character pointers on subtree deletion', async ({ page }, info) => {
  const f = await seed(page, false)
  await page.goto(f.url)
  await expect(page.getByRole('region', { name: '地点与地图工作区' })).toBeVisible()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.getByRole('button', { name: /^海港/ }).click()
  const parent = page.getByRole('combobox', { name: /设置海港.*的上级地点/ })
  expect(await parent.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['', String(f.c)])
  await parent.evaluate((element, descendant) => {
    const select = element as HTMLSelectElement, option = document.createElement('option')
    option.value = String(descendant); option.textContent = '合成伪造的子地点选项'; select.appendChild(option)
    select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }))
  }, f.b)
  await expect(page.getByRole('alert')).toContainText(/层级|自身|子地点/)
  expect((await read(page)).locations).toEqual(f.originalLocations)
  await parent.selectOption(String(f.c))
  await expect.poll(async () => (await read(page)).locations.find(row => row.id === f.a)?.parentId).toBe(f.c)
  const name = parent.locator('..').locator('..').locator('input')
  await name.fill('海港修订')
  await expect.poll(async () => (await read(page)).locations.find(row => row.id === f.a)?.name).toBe('海港修订')
  await expect(name).toBeFocused()
  await page.getByRole('button', { name: '删除地点', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(async () => (await read(page)).locations.map(row => row.id)).toEqual([f.c])
  const after = await read(page)
  expect(after.characters).toEqual([{ ...f.originalCharacter, importantLocationId: null }])
  expect(after.revisions).toEqual([f.revision]); expect(after.releases).toEqual([f.release])
  await page.reload()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await expect(page.getByRole('button', { name: '灯塔', exact: true })).toBeVisible()
  expect(await read(page)).toEqual(after)
  await page.screenshot({ path: info.outputPath('location-delete-retained.png'), fullPage: true })
})

test('legacy cycles and missing parents stay visible and unchanged until the author explicitly repairs them', async ({ page }, info) => {
  const f = await seed(page, true), before = await read(page)
  await page.goto(f.url)
  await expect(page.getByRole('status').filter({ hasText: '上级关系异常' })).toBeVisible()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  for (const name of ['海港', '码头', '灯塔']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  expect(await read(page)).toEqual(before)
  await page.reload()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  expect(await read(page)).toEqual(before)
  await page.getByRole('button', { name: '海港', exact: true }).click()
  const parent = page.getByRole('combobox', { name: '设置海港的上级地点' })
  await expect(parent).toHaveValue(String(f.b))
  await expect(parent.locator(`option[value="${f.b}"]`)).toBeDisabled()
  await parent.selectOption('')
  await expect.poll(async () => (await read(page)).locations.find(row => row.id === f.a)?.parentId).toBeNull()
  const after = await read(page)
  expect(after.locations).toEqual(before.locations.map(row => row.id === f.a ? { ...row, parentId: null, updatedAt: expect.any(Number) } : row))
  expect(after.characters).toEqual(before.characters)
  expect(after.revisions).toEqual(before.revisions); expect(after.releases).toEqual(before.releases)
  await page.screenshot({ path: info.outputPath('legacy-explicit-repair.png'), fullPage: true })
})
