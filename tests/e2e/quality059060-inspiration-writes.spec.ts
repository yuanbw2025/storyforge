import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { serialize } from 'node:v8'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'
import type { InspirationFragment, InspirationVersion, InspirationWorkspace } from '../../src/lib/types/inspiration-workspace'
import type { ReverseResult } from '../../src/lib/ai/inspiration-reverse'
import { openLongformLeaf } from './helpers/longform-navigation'

type Tables = Record<string, unknown[]>
const guards = new WeakMap<BrowserContext, { blocked: string[]; pageErrors: string[] }>()
declare global {
  interface Window {
    quality059060WriteFailure?: { calls: number; uninstall: () => void }
  }
}

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('fresh loopback context required')
  const origin = new URL(base).origin
  const state = { blocked: [] as string[], pageErrors: [] as string[] }
  guards.set(context, state)
  const watched = new WeakSet<Page>()
  const watch = (current: Page) => {
    if (watched.has(current)) return
    watched.add(current)
    current.on('pageerror', error => state.pageErrors.push(error.message))
  }
  watch(page)
  context.on('page', watch)
  await context.addInitScript((allowedOrigin: string) => {
    if (location.origin !== allowedOrigin) return
    localStorage.setItem('storyforge_guide_completed', 'quality059060-isolated')
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('quality059060-isolated', { create: true }),
    })
  }, origin)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url())
    const httpOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (httpOrigin !== origin) {
      state.blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      websocket.close({ code: 1008, reason: 'No external network authorized' })
    } else websocket.connectToServer()
  })
})
test.afterEach(async ({ context }, info) => {
  for (const page of context.pages()) {
    if (!page.isClosed()) await page.evaluate(() => window.quality059060WriteFailure?.uninstall())
  }
  const state = guards.get(context)!
  await info.attach('059060-network-and-errors', {
    contentType: 'application/json', body: JSON.stringify({ ...state, realModelCalls: 0 }),
  })
  expect(state.blocked).toEqual([])
  expect(state.pageErrors).toEqual([])
})

async function prepare(page: Page, full: boolean) {
  // The actual creation wizard selects a native OPFS directory. No OS folder
  // or author's profile is used, and no synthetic component DOM is mounted.
  await page.goto('./long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill(full ? '060 来源保留隔离作品' : '059 多标签保存隔离作品')
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  const fixture = await page.evaluate(async full => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { useProjectStore } = await load('/storyforge/src/stores/project.ts') as typeof import('../../src/stores/project')
    const { resolveScopeLike } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { createWorldWork } = await load('/storyforge/src/lib/workspace/works.ts') as typeof import('../../src/lib/workspace/works')
    const { useInspirationWorkspaceStore: store } = await load('/storyforge/src/stores/inspiration-workspace.ts') as typeof import('../../src/stores/inspiration-workspace')
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null) throw new Error('real wizard must establish its Project')
    const scope = await resolveScopeLike(projectId)
    const foreign = await createWorldWork(projectId, { title: '同世界另一作品', kind: 'novel', novelProfile: 'long', targetWordCount: 10000 })
    if (foreign.id == null) throw new Error('public Work creator did not return its identity')
    const foreignScope = { projectId, worldId: foreign.worldId, workId: foreign.id }
    const foreignFragment = await store.getState().addFragment(foreignScope, { text: 'FOREIGN_WORK_COMPLETE_SOURCE e\u0301🌙', label: 'foreign' })
    if (!foreignFragment) throw new Error('public foreign fixture source missing')
    // This is explicit public fixture preparation, not a UI/AI confirmation.
    // Full real ReverseResult shape is required by the actual result consumer.
    const result: ReverseResult = {
      worldview: { worldOrigin: '', powerHierarchy: '', continentLayout: '', climateByRegion: '', races: '', factionLayout: '' },
      history: { overview: '' },
      storyCore: { logline: '既有确认框架，不复制来源原文', theme: '', centralConflict: '', plotPattern: '', mainPlot: '' },
      characters: [],
    }
    await store.getState().saveVersion(foreignScope, { mode: 'single', fragmentIds: [foreignFragment.id], result })
    let first: InspirationFragment | null = null
    let version: InspirationVersion | null = null
    if (full) {
      first = await store.getState().addFragment(scope, { text: 'CONFIRMED_SOURCE_COMPLETE e\u0301🌙', label: 'confirmed-source' })
      if (!first) throw new Error('public confirmed fixture source missing')
      version = await store.getState().saveVersion(scope, { mode: 'single', fragmentIds: [first.id], result })
      for (let index = 1; index < 24; index++) {
        await store.getState().addFragment(scope, { text: `UNREFERENCED_SOURCE_${index}`, label: `unreferenced-${index}` })
      }
    }
    if ((await db.projects.get(projectId))?.activeWorkId !== scope.workId) throw new Error('fixture must not change the UI active Work')
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('quality059060-isolated')
    return { scope, foreignScope, first, version, directory: { name: directory.name, kind: directory.kind } }
  }, full)
  expect(fixture.directory).toEqual({ name: 'quality059060-isolated', kind: 'directory' })
  await openLongformLeaf(page, '灵感反推')
  await expect(page.getByRole('heading', { name: '灵感反推', exact: true })).toBeVisible()
  return fixture
}

function panel(page: Page) {
  return page.getByRole('heading', { name: '灵感反推', exact: true }).locator('..').locator('..')
}
function input(page: Page) { return panel(page).getByPlaceholder(/随便写点什么/) }
function add(page: Page) { return panel(page).getByRole('button', { name: '加入素材库', exact: true }) }
function fragmentRow(page: Page, text: string) {
  return panel(page).getByText(text, { exact: true }).locator('..').locator('..')
}
async function ready(page: Page) {
  await expect(panel(page).getByRole('button', { name: /^(开始反推|融合并更新)$/ })).toBeEnabled()
}

async function read(page: Page, scope: WorkspaceScope) {
  return page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { readOwnedRows } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { parseInspirationFragments, parseInspirationVersions } = await load('/storyforge/src/lib/inspiration/workspace.ts') as typeof import('../../src/lib/inspiration/workspace')
    const { useInspirationWorkspaceStore: store } = await load('/storyforge/src/stores/inspiration-workspace.ts') as typeof import('../../src/stores/inspiration-workspace')
    const rows = await readOwnedRows<InspirationWorkspace>(scope, 'inspirationWorkspaces', { owner: 'work' })
    if (rows.length > 1) throw new Error('duplicate owned inspiration workspaces')
    const row = rows[0] ?? null, cached = store.getState()
    return { row, fragments: parseInspirationFragments(row?.fragments), versions: parseInspirationVersions(row?.versions),
      cache: { scope: cached.scope, fragments: cached.fragments, loading: cached.loading } }
  }, scope)
}

async function tables(page: Page): Promise<Tables> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.transaction('r', db.tables, async () => Object.fromEntries(
      await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))))
  })
}
async function attachTables(info: TestInfo, name: string, value: Tables) {
  await info.attach(name, { contentType: 'application/octet-stream', body: serialize(value) })
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected actual native table row')
  return value as Record<string, unknown>
}
function onlyCurrentWorkspaceMayChange(before: Tables, after: Tables, scope: WorkspaceScope) {
  expect(Object.keys(after)).toEqual(Object.keys(before))
  for (const [name, values] of Object.entries(before)) {
    if (name !== 'inspirationWorkspaces') expect(after[name], name).toEqual(values)
  }
  const others = (rows: unknown[]) => rows.filter(value => {
    const row = object(value)
    return row.projectId !== scope.projectId || row.workId !== scope.workId
  })
  expect(others(after.inspirationWorkspaces)).toEqual(others(before.inspirationWorkspaces))
}

test('059 real two-tab stale caches retain both UI additions and reload native content', async ({ context, page }, info) => {
  const f = await prepare(page, false), second = await context.newPage()
  await second.goto(page.url())
  await openLongformLeaf(second, '灵感反推')
  await expect.poll(async () => (await read(page, f.scope)).cache).toEqual({ scope: f.scope, fragments: [], loading: false })
  await expect.poll(async () => (await read(second, f.scope)).cache).toEqual({ scope: f.scope, fragments: [], loading: false })
  const foreign = (await read(page, f.foreignScope)).row
  expect(foreign).not.toBeNull()
  await input(page).fill('ACTUAL_TAB_A_COMPLETE_SOURCE e\u0301🌙')
  await input(second).fill('ACTUAL_TAB_B_COMPLETE_SOURCE 原文')
  await Promise.all([ready(page), ready(second)])
  const before = await tables(page)
  expect(before.agentRuns).toHaveLength(0)
  expect(before.aiUsageLog).toHaveLength(0)
  await Promise.all([add(page).click(), add(second).click()])
  const expected = ['ACTUAL_TAB_A_COMPLETE_SOURCE e\u0301🌙', 'ACTUAL_TAB_B_COMPLETE_SOURCE 原文'].sort()
  await expect.poll(async () => (await read(page, f.scope)).fragments.map(item => item.text).sort()).toEqual(expected)
  expect(new Set((await read(page, f.scope)).fragments.map(item => item.id)).size).toBe(2)
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await expect(panel(second).getByRole('alert')).toHaveCount(0)
  const after = await tables(page)
  onlyCurrentWorkspaceMayChange(before, after, f.scope)
  await attachTables(info, '059-concurrent-before-native', before)
  await attachTables(info, '059-concurrent-after-native', after)
  expect((await read(page, f.foreignScope)).row).toEqual(foreign)
  await Promise.all([page.reload(), second.reload()])
  await Promise.all([openLongformLeaf(page, '灵感反推'), openLongformLeaf(second, '灵感反推')])
  for (const tab of [page, second]) {
    await expect.poll(async () => (await read(tab, f.scope)).cache.fragments.map(item => item.text).sort()).toEqual(expected)
    expect((await read(tab, f.scope)).fragments.map(item => item.text).sort()).toEqual(expected)
    expect((await read(tab, f.foreignScope)).row).toEqual(foreign)
    for (const original of expected) {
      const rendered = panel(tab).getByText(original, { exact: true })
      await expect(rendered).toHaveCount(1)
      await expect(rendered).toBeVisible()
    }
  }
  await second.close()
})

test('060 actual capacity rejection and native failure preserve input, confirmed source and all native data', async ({ page }, info) => {
  const f = await prepare(page, true)
  if (!f.first || !f.version) throw new Error('capacity fixture did not create its real source and version')
  const first = f.first, version = f.version
  await expect.poll(async () => (await read(page, f.scope)).cache.fragments.length).toBe(24)
  await expect(fragmentRow(page, first.text).getByRole('button', { name: '移除灵感碎片', exact: true })).toBeDisabled()
  await input(page).fill('UNSAVED_TWENTY_FIFTH_COMPLETE_TEXT')
  await ready(page)
  const full = await tables(page)
  expect(full.agentRuns).toHaveLength(0)
  expect(full.aiUsageLog).toHaveLength(0)
  await add(page).click()
  await expect(panel(page).getByRole('alert')).toContainText('24 条上限')
  await expect(input(page)).toHaveValue('UNSAVED_TWENTY_FIFTH_COMPLETE_TEXT')
  const afterCapacity = await tables(page)
  expect(afterCapacity).toEqual(full)
  await attachTables(info, '060-capacity-before-native', full)
  await attachTables(info, '060-capacity-after-native', afterCapacity)
  let current = await read(page, f.scope)
  expect(current.fragments[0]).toEqual(first)
  expect(current.versions).toContainEqual(version)
  await input(page).fill(first.text)
  await add(page).click()
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  expect(await tables(page)).toEqual(full)
  await fragmentRow(page, 'UNREFERENCED_SOURCE_23').getByRole('button', { name: '移除灵感碎片', exact: true }).click()
  await expect.poll(async () => (await read(page, f.scope)).fragments.length).toBe(23)
  await input(page).fill('AUTHOR_EXPLICITLY_MADE_ROOM')
  await add(page).click()
  await expect.poll(async () => (await read(page, f.scope)).fragments.map(item => item.text)).toContain('AUTHOR_EXPLICITLY_MADE_ROOM')
  current = await read(page, f.scope)
  expect(current.fragments).toHaveLength(24)
  expect(current.fragments[0]).toEqual(first)
  expect(current.versions).toContainEqual(version)
  onlyCurrentWorkspaceMayChange(full, await tables(page), f.scope)

  // Make legitimate room before injecting a real native updating-hook error;
  // otherwise the capacity guard would prevent reaching this write boundary.
  await fragmentRow(page, 'UNREFERENCED_SOURCE_22').getByRole('button', { name: '移除灵感碎片', exact: true }).click()
  await expect.poll(async () => (await read(page, f.scope)).fragments.length).toBe(23)
  await input(page).fill('INPUT_SURVIVES_REAL_NATIVE_FAILURE e\u0301🌙')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const state: NonNullable<Window['quality059060WriteFailure']> = {
      calls: 0, uninstall: () => db.inspirationWorkspaces.hook('updating').unsubscribe(reject),
    }
    const reject = () => { state.calls += 1; throw new Error('SFQA059060_REAL_NATIVE_WRITE_FAILURE') }
    window.quality059060WriteFailure = state
    db.inspirationWorkspaces.hook('updating', reject)
  })
  const beforeFailure = await tables(page)
  await add(page).click()
  await expect(panel(page).getByRole('alert')).toContainText('SFQA059060_REAL_NATIVE_WRITE_FAILURE')
  await expect(input(page)).toHaveValue('INPUT_SURVIVES_REAL_NATIVE_FAILURE e\u0301🌙')
  expect(await page.evaluate(() => window.quality059060WriteFailure?.calls)).toBe(1)
  const afterFailure = await tables(page)
  expect(afterFailure).toEqual(beforeFailure)
  await attachTables(info, '059060-write-failure-before-native', beforeFailure)
  await attachTables(info, '059060-write-failure-after-native', afterFailure)
  await page.evaluate(() => window.quality059060WriteFailure!.uninstall())
  await add(page).click()
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await expect.poll(async () => (await read(page, f.scope)).fragments.map(item => item.text)).toContain('INPUT_SURVIVES_REAL_NATIVE_FAILURE e\u0301🌙')
  current = await read(page, f.scope)
  expect(current.fragments).toHaveLength(24)
  expect(current.fragments[0]).toEqual(first)
  expect(current.versions).toContainEqual(version)
  onlyCurrentWorkspaceMayChange(beforeFailure, await tables(page), f.scope)
})
