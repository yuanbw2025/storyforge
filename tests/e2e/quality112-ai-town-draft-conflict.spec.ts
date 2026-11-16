import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { serialize } from 'node:v8'
import type { WorkspaceScope, Work } from '../../src/lib/types'
import type { AiTownAuthoringDraftV1, AiTownAuthoringSettingsV1 } from '../../src/lib/ai-town/authoring-contract'

type Tables = Record<string, unknown[]>
interface Boundary { origin: string; blocked: string[]; pageErrors: string[] }
interface Comparison {
  version: number; kind: string; committedReadError: string | null
  local: { basis: { scope: WorkspaceScope; revision: number; workTitle: string }; title: string; settings: AiTownAuthoringSettingsV1 }
  committed: { basis: { scope: WorkspaceScope; revision: number; workTitle: string }; title: string; settings: AiTownAuthoringSettingsV1 }
}
const boundaries = new WeakMap<BrowserContext, Boundary>()
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('fresh isolated loopback browser required')
  const state: Boundary = { origin: new URL(base).origin, blocked: [], pageErrors: [] }
  boundaries.set(context, state)
  const watched = new WeakSet<Page>()
  const watch = (current: Page) => {
    if (watched.has(current)) return
    watched.add(current)
    current.on('pageerror', error => state.pageErrors.push(error.message))
    current.on('crash', () => state.pageErrors.push('owned isolated page crashed'))
  }
  watch(page); context.on('page', watch)
  await context.addInitScript((allowedOrigin: string) => {
    if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'quality112-isolated')
  }, state.origin)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== state.origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || request.headers().authorization) {
      state.blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url()), origin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (origin !== state.origin) {
      state.blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      websocket.close({ code: 1008, reason: 'No external network authorized' })
    } else websocket.connectToServer()
  })
})
test.afterEach(async ({ context }, info) => {
  const state = boundaries.get(context)
  if (!state) return
  await info.attach('112-network-and-page-errors', { contentType: 'application/json',
    body: JSON.stringify({ ...state, realModelCalls: 0, syntheticModelHttpCalls: 0 }) })
  expect(state.blocked).toEqual([])
  expect(state.pageErrors).toEqual([])
})

async function tables(page: Page): Promise<Tables> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.transaction('r', db.tables, async () => Object.fromEntries(
      await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))))
  })
}
async function attach(info: TestInfo, name: string, value: Tables) {
  await info.attach(name, { contentType: 'application/octet-stream', body: serialize(value) })
}
async function currentScope(page: Page): Promise<WorkspaceScope> {
  const url = new URL(page.url()), projectId = Number(url.searchParams.get('project')), workId = Number(url.searchParams.get('work'))
  return page.evaluate(async ({ projectId, workId }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { resolveScope } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const work = await db.works.get(workId)
    if (!work || work.projectId !== projectId) throw new Error('the actual selected Town owner is missing')
    return resolveScope({ scope: { projectId, workId, worldId: work.worldId } })
  }, { projectId, workId })
}
async function readTown(page: Page, scope: WorkspaceScope): Promise<{ draft: AiTownAuthoringDraftV1; settings: AiTownAuthoringSettingsV1; work: Work }> {
  return page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { readAiTownDraft } = await load('/storyforge/src/lib/ai-town/authoring-service.ts') as typeof import('../../src/lib/ai-town/authoring-service')
    const { settingsFromAiTownDraft } = await load('/storyforge/src/lib/ai-town/authoring-contract.ts') as typeof import('../../src/lib/ai-town/authoring-contract')
    const draft = await readAiTownDraft(scope), work = await db.works.get(scope.workId)
    if (!work) throw new Error('actual Town Work disappeared')
    return { draft, settings: settingsFromAiTownDraft(draft), work }
  }, scope)
}
async function createTown(page: Page, title: string, opening: string) {
  await page.goto('./town/vision')
  await page.getByLabel('小镇名称', { exact: true }).fill(title)
  await page.getByLabel('生活愿景与开场目标').fill(opening)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/town\/vision\?project=\d+&work=\d+/)
  return currentScope(page)
}
async function foreignTown(page: Page, title: string) {
  return page.evaluate(async title => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { createAiTownDraft } = await load('/storyforge/src/lib/ai-town/authoring-service.ts') as typeof import('../../src/lib/ai-town/authoring-service')
    return (await createAiTownDraft(title)).scope
  }, title)
}
async function downloadCopy(page: Page, info: TestInfo, name: string, button = '下载本地与已提交方案比较') {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const download = await pending, output = info.outputPath(name + '.json')
  await download.saveAs(output)
  const value = JSON.parse(await readFile(output, 'utf8')) as Comparison
  await info.attach(name, { contentType: 'application/json', path: output })
  expect(value).toMatchObject({ version: 1, kind: 'ai-town-edit-comparison', committedReadError: null })
  return value
}
function onlyWorkChanged(before: Tables, after: Tables, workId: number) {
  expect(Object.keys(after)).toEqual(Object.keys(before))
  for (const [name, value] of Object.entries(before)) if (!['works', 'aiTownAuthoringDrafts'].includes(name)) expect(after[name], name).toEqual(value)
  expect(after.works).toHaveLength(before.works.length)
  expect(after.aiTownAuthoringDrafts).toHaveLength(before.aiTownAuthoringDrafts.length)
  for (const value of before.works as Work[]) if (value.id !== workId)
    expect((after.works as Work[]).find(item => item.id === value.id)).toEqual(value)
  for (const value of before.aiTownAuthoringDrafts as AiTownAuthoringDraftV1[]) if (value.workId !== workId)
    expect((after.aiTownAuthoringDrafts as AiTownAuthoringDraftV1[]).find(item => item.id === value.id)).toEqual(value)
}

test('112 real two-tab version and generic-title conflicts preserve both copies and exact downloads', async ({ page, context }, info) => {
  const originalTitle = '112 双窗口原始小镇', originalOpening = '112 原始开场', localHome = '112 本地住所 é🌙\n整段保留'
  const scope = await createTown(page, originalTitle, originalOpening), original = await readTown(page, scope)
  const foreign = await foreignTown(page, '112 双窗口无关作品')
  const remote = await context.newPage()
  await remote.goto(page.url())
  await expect(remote.getByLabel('小镇名称', { exact: true })).toHaveValue(originalTitle)
  await page.getByLabel('住所构想').fill(localHome)
  await remote.getByLabel('小镇名称', { exact: true }).fill('112 另一窗口已提交标题')
  await remote.getByLabel('生活愿景与开场目标').fill('112 另一窗口已提交开场')
  await remote.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect.poll(async () => (await readTown(remote, scope)).draft.revision).toBe(1)
  const committed = await readTown(remote, scope), before = await tables(page)
  await expect(page.getByTestId('town-edit-conflict')).toBeVisible()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('其他页面')
  const refused = await tables(page)
  expect(refused).toEqual(before)
  await attach(info, '112-version-before-native', before); await attach(info, '112-version-refused-native', refused)
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(originalTitle)
  await expect(page.getByLabel('生活愿景与开场目标')).toHaveValue(originalOpening)
  await expect(page.getByLabel('住所构想')).toHaveValue(localHome)
  const copy = await downloadCopy(page, info, '112-version-comparison')
  expect(copy.local.settings).toEqual({ ...original.settings, town: { ...original.settings.town, homeConcept: localHome } })
  expect(copy.local).toMatchObject({ title: originalTitle, basis: { scope, revision: 0, workTitle: originalTitle } })
  expect(copy.committed.settings).toEqual(committed.settings)
  expect(copy.committed).toMatchObject({ title: committed.work.title, basis: { scope, revision: 1 } })
  await page.getByRole('button', { name: '保留本地副本，载入已提交版本', exact: true }).click()
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(committed.work.title)
  await expect(page.getByLabel('生活愿景与开场目标')).toHaveValue(committed.settings.openingSituation)
  await page.getByTestId('town-retained-edits').locator('summary').click()
  expect(await downloadCopy(page, info, '112-retained-original-comparison', '下载此本地副本与已提交方案')).toEqual(copy)
  expect(await tables(page)).toEqual(before)
  const genericHome = '112 通用改名后本地住所 é🌙'
  await page.getByLabel('住所构想').fill(genericHome)
  await remote.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { updateWorkTitle } = await load('/storyforge/src/lib/workspace/works.ts') as typeof import('../../src/lib/workspace/works')
    await updateWorkTitle(scope, '112 通用入口已提交标题')
  }, scope)
  const generic = await readTown(remote, scope)
  expect(generic.draft.revision).toBe(1)
  await expect(page.getByTestId('town-edit-conflict')).toBeVisible()
  const genericBefore = await tables(page)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('作品名称')
  const genericAfter = await tables(page)
  expect(genericAfter).toEqual(genericBefore)
  await attach(info, '112-generic-title-before-native', genericBefore); await attach(info, '112-generic-title-refused-native', genericAfter)
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(committed.work.title)
  await expect(page.getByLabel('住所构想')).toHaveValue(genericHome)
  const genericCopy = await downloadCopy(page, info, '112-generic-title-comparison')
  expect(genericCopy.local).toMatchObject({ title: committed.work.title, basis: { scope, revision: 1, workTitle: committed.work.title } })
  expect(genericCopy.local.settings).toEqual({ ...committed.settings, town: { ...committed.settings.town, homeConcept: genericHome } })
  expect(genericCopy.committed).toMatchObject({ title: generic.work.title, basis: { scope, revision: 1, workTitle: generic.work.title } })
  expect((await readTown(page, foreign)).work.title).toBe('112 双窗口无关作品')
  expect(await tables(page)).toEqual(genericBefore)
})

test('112 real saves, World source and Brief survive reload and history-based Work switching', async ({ page }, info) => {
  const title = '112 正常制作主作品', scope = await createTown(page, title, '112 正常原始开场')
  const foreign = await foreignTown(page, '112 正常切换副作品')
  await page.getByLabel('住所构想').fill('112 主作品已保存住所')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect.poll(async () => (await readTown(page, scope)).draft.revision).toBe(1)
  await page.getByLabel('生活愿景与开场目标').fill('112 正常后续开场')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect.poll(async () => (await readTown(page, scope)).draft.revision).toBe(2)
  const source = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { seedCurrentProductWorld } = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    return seedCurrentProductWorld('112 浏览器冻结世界', { minimumCharacters: 4 })
  })
  const contentNav = page.getByRole('navigation', { name: 'AI 小镇内容导航', exact: true })
  const primaryNav = page.getByRole('navigation', { name: 'AI 小镇页面导航', exact: true })
  await contentNav.getByRole('button', { name: '居民与地点', exact: true }).click()
  await page.getByLabel('居民数量（须与所选世界居民一致）').fill('4')
  await primaryNav.getByRole('button', { name: '世界引擎', exact: true }).click()
  await page.getByRole('button', { name: '选择此版本', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('世界版本已选择')
  const sourceScope = page.getByTestId('town-author-page')
  const optional = sourceScope.getByRole('group', { name: '设定', exact: true }).getByRole('checkbox').first()
  await expect(optional).toBeEnabled()
  await optional.setChecked(!(await optional.isChecked()))
  await page.getByRole('button', { name: '保存出口范围', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('出口范围已保存')
  const configured = await readTown(page, scope)
  expect(configured.draft.selectionJson).not.toBeNull()
  await primaryNav.getByRole('button', { name: '制作台', exact: true }).click()
  await contentNav.getByRole('button', { name: '确认制作方案', exact: true }).click()
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page).toHaveURL(/town\/production/)
  await expect(page.getByRole('status')).toHaveText('审查方案已保存，核对后明确授权才会开始制作。')
  const prepared = await readTown(page, scope)
  expect(prepared.draft.preparedRevision).toBe(prepared.draft.revision)
  expect(prepared.draft.selectionJson).toBe(configured.draft.selectionJson)
  expect(prepared.settings.town.residentTarget).toBe(4)
  const normal = await tables(page)
  expect(normal.productBuilds).toEqual([])
  expect(normal.worldReleases.find(value => (value as { id: number }).id === source.release.id)).toEqual(source.release)
  await attach(info, '112-prepared-normal-native', normal)
  await page.reload()
  await expect(page.getByRole('button', { name: '回到方案确认', exact: true })).toBeVisible()
  await primaryNav.getByRole('button', { name: '制作台', exact: true }).click()
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(title)
  await expect(page.getByLabel('住所构想')).toHaveValue('112 主作品已保存住所')
  await expect(page.getByLabel('生活愿景与开场目标')).toHaveValue('112 正常后续开场')
  await primaryNav.getByRole('button', { name: '作品库', exact: true }).click()
  const library = page.locator('.lf-library-grid')
  await library.locator('article').filter({ has: page.getByRole('heading', { name: '112 正常切换副作品', exact: true }) })
    .getByRole('link', { name: '继续制作', exact: true }).click()
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue('112 正常切换副作品')
  await page.getByLabel('住所构想').fill('112 副作品尚未保存的完整住所 é🌙')
  const beforeBack = await tables(page)
  await page.goBack()
  await expect(page).toHaveURL(/town\/library/)
  expect(await tables(page)).toEqual(beforeBack)
  await library.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('link', { name: '继续制作', exact: true }).click()
  await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(title)
  await expect(page.getByLabel('住所构想')).toHaveValue('112 主作品已保存住所')
  await primaryNav.getByRole('button', { name: '作品库', exact: true }).click()
  await library.locator('article').filter({ has: page.getByRole('heading', { name: '112 正常切换副作品', exact: true }) })
    .getByRole('link', { name: '继续制作', exact: true }).click()
  await expect(page.getByLabel('住所构想')).toHaveValue('112 副作品尚未保存的完整住所 é🌙')
  const beforeForeignSave = await tables(page)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect.poll(async () => (await readTown(page, foreign)).draft.revision).toBe(1)
  const afterForeignSave = await tables(page)
  onlyWorkChanged(beforeForeignSave, afterForeignSave, foreign.workId)
  await attach(info, '112-owner-before-native', beforeForeignSave); await attach(info, '112-owner-after-native', afterForeignSave)
  expect((await readTown(page, scope)).draft).toEqual(prepared.draft)
  expect(afterForeignSave.productBuilds).toEqual([])
  expect(afterForeignSave.worldReleases.find(value => (value as { id: number }).id === source.release.id)).toEqual(source.release)
  await page.reload()
  await expect(page.getByLabel('住所构想')).toHaveValue('112 副作品尚未保存的完整住所 é🌙')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
