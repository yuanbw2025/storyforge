import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await createLongform(page, 'SFQA122 隔离世界编辑验收')
  const id = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  const fixture = await page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { useWorldGroupStore } = await load<typeof import('../../src/stores/world-group')>('/storyforge/src/stores/world-group.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { useGeographyStore } = await load<typeof import('../../src/stores/project-singletons')>('/storyforge/src/stores/project-singletons.ts')
    const scope = await resolveScopeLike(projectId)
    await db.projects.update(projectId, { enableMultiWorld: true })
    const a = await useWorldGroupStore.getState().createGroup({ projectId, name: '已写世界A', description: '', type: 'primary', order: 0 }, scope)
    const b = await useWorldGroupStore.getState().createGroup({ projectId, name: '空世界B', description: '', type: 'parallel', order: 1 }, scope)
    await useWorldviewStore.getState().saveWorldview({ projectId, worldGroupId: a, worldStructure: '只属于A的结构', races: '只属于A的种族' }, scope)
    await useGeographyStore.getState().save({ projectId, worldGroupId: a, overview: '只属于A的地理', locations: JSON.stringify([
      { id: 'A-only-port', name: 'A独有港口', type: 'city', description: '原港口', significance: '', parentId: null, order: 0 },
    ]) }, scope)
    return { a, b, original: (await db.geographies.where('projectId').equals(projectId).toArray())[0] }
  }, id)
  await page.reload()
  return { id, ...fixture }
}

async function switchGroup(page: Page, from: string, to: string) {
  await page.getByRole('button').filter({ hasText: new RegExp(`${from}$`) }).last().click()
  await page.getByRole('button').filter({ hasText: to }).last().click()
  await expect(page.locator('[aria-label="世界编辑作用域保护"]')).toBeEnabled()
}
async function rows(page: Page, id: number) {
  return page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return { geographies: await db.geographies.where('projectId').equals(projectId).toArray(), worldviews: await db.worldviews.where('projectId').equals(projectId).toArray() }
  }, id)
}

test('SFQA122 natural and humanity clear empty groups, preserve unblurred input and survive refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const made = await setup(page)
  for (const [leaf, text, updated, field] of [
    ['自然环境', '只属于A的结构', 'A结构的未失焦编辑', 'worldStructure'],
    ['人文环境', '只属于A的种族', 'A种族的未失焦编辑', 'races'],
  ] as const) {
    await openLongformLeaf(page, leaf)
    if (leaf === '人文环境') await page.getByRole('button', { name: /种族与民族/ }).click()
    const display = page.locator('div.cursor-text:visible').first()
    await expect(display).toHaveText(text)
    await display.click()
    await page.locator('textarea:visible').first().fill(updated)
    // The real switcher invokes the shared draft barrier before changing groups.
    await switchGroup(page, '已写世界A', '空世界B')
    if (leaf === '人文环境') await page.getByRole('button', { name: /种族与民族/ }).click()
    await expect(page.locator('div.cursor-text:visible').first()).not.toHaveText(text)
    await expect(page.locator('div.cursor-text:visible').first()).not.toHaveText(updated)
    const state = await rows(page, made.id)
    expect(state.worldviews.find(row => row.worldGroupId === made.a)?.[field]).toBe(updated)
    expect(state.worldviews.some(row => row.worldGroupId === made.b)).toBe(false)
    await switchGroup(page, '空世界B', '已写世界A')
    if (leaf === '人文环境') await page.getByRole('button', { name: /种族与民族/ }).click()
    await expect(page.locator('div.cursor-text:visible').first()).toHaveText(updated)
    await page.reload()
    await openLongformLeaf(page, leaf)
    if (leaf === '人文环境') await page.getByRole('button', { name: /种族与民族/ }).click()
    await expect(page.locator('div.cursor-text:visible').first()).toHaveText(updated)
  }
  expect(errors).toEqual([])
})

test('SFQA122 Geography Add in empty B saves only B data, including a draft flushed by the real switcher', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const made = await setup(page)
  await openLongformLeaf(page, '地理设定')
  const overview = page.locator('textarea:visible').first()
  await expect(overview).toHaveValue('只属于A的地理')
  await switchGroup(page, '已写世界A', '空世界B')
  await expect(overview).toHaveValue('')
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  await expect.poll(async () => (await rows(page, made.id)).geographies.find(row => row.worldGroupId === made.b)?.locations).toContain('新地点')
  await overview.fill('B作者的新地理草稿')
  await switchGroup(page, '空世界B', '已写世界A')
  await expect(overview).toHaveValue('只属于A的地理')
  const saved = (await rows(page, made.id)).geographies
  expect(saved.find(row => row.worldGroupId === made.a)).toEqual(made.original)
  const b = saved.find(row => row.worldGroupId === made.b)!
  expect(JSON.parse(b.locations)).toHaveLength(1)
  expect(b.locations).not.toContain('A-only-port')
  expect(b.overview).toBe('B作者的新地理草稿')
  await page.reload()
  await openLongformLeaf(page, '地理设定')
  await switchGroup(page, '已写世界A', '空世界B')
  await expect(overview).toHaveValue('B作者的新地理草稿')
  expect(errors).toEqual([])
})
