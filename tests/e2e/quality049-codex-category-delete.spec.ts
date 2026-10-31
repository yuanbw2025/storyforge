import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// External proposal only. Root must review and assign a browser window before execution.
// Browser fixture writes use actual public APIs against a fresh isolated IndexedDB.
// Only the two delete confirmations are exercised as author UI actions; concurrent
// adoption is an explicit native second-writer test operation, never an AI call.
const blockedByContext = new WeakMap<BrowserContext, string[]>()
const errorsByPage = new WeakMap<Page, string[]>()
const ROOT_NAME = '049 等待确认的自定义分类'
const KEEP_NAME = '049 完整保留的分类'
const KNOWN_NAME = '049 需要删除的已加载词条'
const KEEP_ENTRY_NAME = '049 完整保留的词条'
const FAILURE = '049 隔离测试：真实分类删除事务失败，原始数据保留'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('049 requires a fresh loopback app')
  const origin = new URL(baseURL).origin
  const blocked: string[] = [], pageErrors: string[] = []
  blockedByContext.set(context, blocked); errorsByPage.set(page, pageErrors)
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality049-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url())
    const equivalentOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (equivalentOrigin !== origin) {
      blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      websocket.close({ code: 1008, reason: 'External network is not authorized' })
    } else websocket.connectToServer()
  })
})
test.afterEach(async ({ context, page }, info) => {
  const blocked = blockedByContext.get(context) ?? [], pageErrors = errorsByPage.get(page) ?? []
  await info.attach('049-network-and-errors', {
    contentType: 'application/json', body: JSON.stringify({ blocked, pageErrors, realModelCalls: 0 }),
  })
  expect(blocked).toEqual([]); expect(pageErrors).toEqual([])
})

async function seed(page: Page, withReferences: boolean) {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
  return page.evaluate(async ({ rootName, keepName, knownName, keepEntryName, withReferences }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts') as typeof import('../../src/lib/workspace/create-workspace')
    const { useCodexStore } = await load('/storyforge/src/stores/codex.ts') as typeof import('../../src/stores/codex')
    const { adopt } = await load('/storyforge/src/lib/registry/adopt.ts') as typeof import('../../src/lib/registry/adopt')
    const { deriveNovelToWorld } = await load('/storyforge/src/lib/world-engine/derivation.ts') as typeof import('../../src/lib/world-engine/derivation')
    const { addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } = await load('/storyforge/tests/helpers/current-workspace.ts') as typeof import('../helpers/current-workspace')
    const { resolveLongformChapterNavigationV1 } = await load('/storyforge/src/lib/authoring/longform-chapter-navigation.ts') as typeof import('../../src/lib/authoring/longform-chapter-navigation')
    const f = await createWorkspace({
      name: '049 浏览器隔离长篇作品', description: '仅合成验收；不连接作者资料。', genres: ['fantasy'],
      status: 'drafting', targetWordCount: 1000, enableMultiWorld: false,
    }, { kind: 'novel', novelProfile: 'long', purpose: 'independent-work', importedNovelText: '完整作者正文。\n删除词条不能改动这两段文字。🌙e\u0301' })
    await useCodexStore.getState().loadAll(f.scope)
    const makeCategory = (name: string, parentId: number | null = null) => useCodexStore.getState().addCategory({
      projectId: f.scope.projectId, domain: 'humanity', parentId, name,
      icon: '📁', fieldSchema: '[]', hidden: false, order: 0,
    })
    const makeEntry = (categoryId: number, name: string) => useCodexStore.getState().addEntry({
      projectId: f.scope.projectId, categoryId, name, summary: `完整简介：${name}`,
      description: `完整作者词条：${name}。\n保留全部标点、第二段和组合字符。🌙e\u0301`,
      fields: '{}', refs: '{}', tags: '["049"]', order: 0, worldGroupId: null,
    })
    const root = await makeCategory(rootName), child = await makeCategory('049 已加载的子分类', root)
    const keptCategory = await makeCategory(keepName)
    const known = await makeEntry(root, knownName), knownChild = await makeEntry(child, '049 已加载的下层词条')
    const keptEntry = await makeEntry(keptCategory, keepEntryName)
    let characterId: number | null = null
    if (withReferences) {
      await useCodexStore.getState().updateEntry(keptEntry, { refs: JSON.stringify({ related: [known, knownChild, known] }) })
      const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'characters', mode: 'add',
        data: { name: '049 保留完整背景的角色', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
          background: '完整角色背景。引用清理失败时不得只保留姓名。🌙e\u0301', raceEntryId: known } })
      if (result.written.length !== 1 || result.fkErrors.length) throw new Error('049 actual character adoption failed')
      characterId = result.written[0].id
    }
    // Real explicit derivation/publishing APIs create immutable historical bytes.
    // This is setup, not an assertion that the author navigated World sealing UI.
    const historical = await deriveNovelToWorld({ sourceScope: f.scope, targetName: '049 历史封存世界', publish: true })
    if (!historical.release?.id || !historical.revision.id) throw new Error('049 setup needs a real sealed WorldRelease')
    const foreignWorld = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '049 另一个 World', description: '整个 World 都必须原值保留。' })
    if (!foreignWorld.id) throw new Error('049 foreign World must have a real native id')
    const foreignWork = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: foreignWorld.id,
      create: { title: '049 另一个 World 的作品', kind: 'novel', novelProfile: 'long', description: '完整异 World 作品简介。' } })
    const siblingWork = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId,
      create: { title: '049 同 World 的另一部作品', kind: 'novel', novelProfile: 'long', description: '完整同 World 异 Work 简介。' } })
    if (!foreignWork.id || !siblingWork.id) throw new Error('049 unrelated Works must have native ids')
    const foreignScope = { projectId: f.scope.projectId, worldId: foreignWorld.id, workId: foreignWork.id }
    const foreignCategory = await adopt({ projectId: f.scope.projectId, scope: foreignScope, target: 'codexCategories', mode: 'add',
      data: { domain: 'humanity', parentId: null, name: rootName, fieldSchema: '[]', order: 0 } })
    if (foreignCategory.written.length !== 1 || foreignCategory.fkErrors.length) throw new Error('049 actual foreign category adoption failed')
    const foreignCategoryId = foreignCategory.written[0].id
    const foreignEntry = await adopt({ projectId: f.scope.projectId, scope: foreignScope, target: 'codexEntries', mode: 'add',
      data: { categoryId: foreignCategoryId, name: knownName, summary: '异 World 同名词条',
        description: '完整异 World 词条。不能凭同名清理。🌙e\u0301', fields: '{}', refs: '{}' } })
    if (foreignEntry.written.length !== 1 || foreignEntry.fkErrors.length) throw new Error('049 actual foreign entry adoption failed')
    await useCodexStore.getState().loadExisting(f.scope)
    const chapter = await db.chapters.where('projectId').equals(f.scope.projectId).first()
    const knownRow = await db.codexEntries.get(known)
    if (!chapter || !knownRow) throw new Error('049 public setup must retain its real chapter and entry')
    const route = await resolveLongformChapterNavigationV1({ scope: f.scope, outlineNodeId: chapter.outlineNodeId, module: 'chapters-list' })
    return { scope: f.scope, root, child, known, knownChild, keptCategory, keptEntry, characterId,
      foreignScope, foreignCategoryId, foreignEntryId: foreignEntry.written[0].id, siblingWorkId: siblingWork.id,
      historicalScope: historical.targetScope, historicalReleaseId: historical.release.id, historicalRevisionId: historical.revision.id,
      description: knownRow.description, chapterId: chapter.id, chapterContent: chapter.content, url: `.${route}` }
  }, { rootName: ROOT_NAME, keepName: KEEP_NAME, knownName: KNOWN_NAME, keepEntryName: KEEP_ENTRY_NAME, withReferences })
}

async function openCodex(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('[data-workspace-ready]')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '设定查询', exact: true }).click()
  const lookup = page.getByRole('region', { name: '设定查询', exact: true })
  await expect(lookup).toBeVisible()
  await lookup.getByRole('button', { name: '打开词条库提取设定', exact: true }).click()
  await lookup.getByRole('button', { name: '人文环境', exact: true }).click()
  await expect(lookup.getByText(ROOT_NAME, { exact: true })).toBeVisible()
  await lookup.getByText(ROOT_NAME, { exact: true }).click()
  await lookup.getByText(KNOWN_NAME, { exact: true }).click()
  return lookup
}

async function databaseSnapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    type Encoded = null | boolean | number | string | Encoded[] | { [key: string]: Encoded }
    // Native values are captured rather than a hand-picked table/count summary.
    // Tagged exceptional JS values preserve undefined and binary bytes if present.
    const encode = async (value: unknown): Promise<Encoded> => {
      if (value === undefined) return { $native: 'undefined' }
      if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
      if (typeof value === 'number') return Number.isFinite(value) ? value : { $native: String(value) }
      if (typeof value === 'bigint') return { $native: 'bigint', value: value.toString() }
      if (value instanceof Date) return { $native: 'Date', value: value.toISOString() }
      if (value instanceof Blob) return { $native: 'Blob', type: value.type,
        bytes: Array.from(new Uint8Array(await value.arrayBuffer())) }
      if (value instanceof ArrayBuffer) return { $native: 'ArrayBuffer', bytes: Array.from(new Uint8Array(value)) }
      if (ArrayBuffer.isView(value)) return { $native: value.constructor.name,
        bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
      if (Array.isArray(value)) return Promise.all(value.map(encode))
      if (typeof value !== 'object') throw new Error('049 unexpected non-native IndexedDB value')
      const output: { [key: string]: Encoded } = {}
      for (const key of Object.keys(value).sort()) output[key] = await encode((value as Record<string, unknown>)[key])
      return output
    }
    const snapshots = await Promise.all(db.tables.map(async table => [table.name, JSON.stringify(await encode(await table.toArray()))] as const))
    return Object.fromEntries(snapshots)
  })
}
function withoutIds(snapshot: Record<string, string>, table: string, ids: readonly number[]): string {
  const rows: unknown = JSON.parse(snapshot[table])
  if (!Array.isArray(rows)) throw new Error(`049 missing native table ${table}`)
  return JSON.stringify(rows.filter((row: unknown) => {
    if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'number') throw new Error(`049 ${table} row has no native numeric id`)
    return !ids.includes(row.id)
  }))
}

async function openDelete(page: Page) {
  const lookup = page.getByRole('region', { name: '设定查询', exact: true })
  const card = lookup.getByText(ROOT_NAME, { exact: true }).locator('..')
  await card.hover()
  await card.getByRole('button', { name: '删除自定义分类', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `删除自定义分类「${ROOT_NAME}」？`, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('该分类及子分类下的所有词条也会被删除')
  return dialog
}

interface BootstrapSeeds049 { templates: string[]; workflows: string[] }
async function bootstrapSeedNames049(page: Page): Promise<BootstrapSeeds049> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const core = await load('/storyforge/src/lib/ai/prompt-seeds.ts') as typeof import('../../src/lib/ai/prompt-seeds')
    const novel = await load('/storyforge/src/lib/ai/prompt-seeds-novel.ts') as typeof import('../../src/lib/ai/prompt-seeds-novel')
    const craft = await load('/storyforge/src/lib/ai/prompt-seeds-craft.ts') as typeof import('../../src/lib/ai/prompt-seeds-craft')
    const workflows = await load('/storyforge/src/lib/ai/workflow-seeds.ts') as typeof import('../../src/lib/ai/workflow-seeds')
    return { templates: [...core.SYSTEM_PROMPT_SEEDS, ...novel.NOVEL_CONTENT_PROMPT_SEEDS, ...craft.CRAFT_PROMPT_SEEDS].map(seed => seed.name),
      workflows: workflows.SYSTEM_WORKFLOW_SEEDS.map(seed => seed.name) }
  })
}
function bootstrapObject049(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('049 unknown bootstrap record shape')
  return value as Record<string, unknown>
}
function bootstrapArray049(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('049 unknown bootstrap array shape')
  return value.map(bootstrapObject049)
}
function exactBootstrapKeys049(value: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...keys].sort())
}
function rebindBuiltinLinearWorkflow049(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const previousSteps = bootstrapArray049(before.steps), nextSteps = bootstrapArray049(after.steps)
  expect(nextSteps).toHaveLength(previousSteps.length)
  const oldIds = previousSteps.map(step => step.stepId), newIds = nextSteps.map(step => step.stepId)
  if (!oldIds.every((id): id is string => typeof id === 'string' && id.length > 0)
    || !newIds.every((id): id is string => typeof id === 'string' && id.length > 0)
    || new Set(oldIds).size !== oldIds.length || new Set(newIds).size !== newIds.length) throw new Error('049 builtin step IDs must be a unique bijection')
  const graph = bootstrapObject049(before.graph)
  exactBootstrapKeys049(graph, ['version', 'nodes', 'edges', 'viewport'])
  expect(graph.version).toBe(1)
  expect(bootstrapObject049(graph.viewport)).toEqual({ x: 0, y: 0, zoom: 1 })
  const nodes = bootstrapArray049(graph.nodes), edges = bootstrapArray049(graph.edges)
  expect(nodes).toHaveLength(oldIds.length); expect(edges).toHaveLength(Math.max(0, oldIds.length - 1))
  const reboundNodes = nodes.map((node, index) => {
    exactBootstrapKeys049(node, ['stepId', 'x', 'y'])
    expect(node.stepId).toBe(oldIds[index])
    if (typeof node.x !== 'number' || !Number.isFinite(node.x) || typeof node.y !== 'number' || !Number.isFinite(node.y)) throw new Error('049 unknown builtin node position')
    return { ...node, stepId: newIds[index] }
  })
  const reboundEdges = edges.map((edge, index) => {
    exactBootstrapKeys049(edge, ['edgeId', 'sourceStepId', 'targetStepId', 'targetVariable'])
    expect(edge.sourceStepId).toBe(oldIds[index]); expect(edge.targetStepId).toBe(oldIds[index + 1])
    expect(edge.edgeId).toBe(`linear-${oldIds[index]}-${oldIds[index + 1]}`)
    if (typeof edge.targetVariable !== 'string' || !edge.targetVariable.trim()) throw new Error('049 unknown builtin edge mapping')
    return { ...edge, edgeId: `linear-${newIds[index]}-${newIds[index + 1]}`, sourceStepId: newIds[index], targetStepId: newIds[index + 1] }
  })
  // Every non-ID step/graph field, ordering, viewport and mapping remains exact.
  return { ...before, steps: previousSteps.map((step, index) => ({ ...step, stepId: newIds[index] })),
    graph: { ...graph, nodes: reboundNodes, edges: reboundEdges } }
}
function expectedAfterSystemBootstrap049(before: Record<string, string>, after: Record<string, string>,
  seeds: BootstrapSeeds049, window: { start: number; end: number },
): Record<string, string> {
  const expected = { ...before }
  for (const [table, names] of [['promptTemplates', seeds.templates], ['promptWorkflows', seeds.workflows]] as const) {
    const previous = bootstrapArray049(JSON.parse(before[table])), current = bootstrapArray049(JSON.parse(after[table]))
    expect(current.map(row => row.id)).toEqual(previous.map(row => row.id))
    const seedNames = new Set(names)
    const lastSystemRowByName = new Map<string, unknown>()
    for (const row of previous) {
      if (row.scope === 'system' && typeof row.name === 'string') lastSystemRowByName.set(row.name, row.id)
    }
    expected[table] = JSON.stringify(previous.map((row, index) => {
      const next = current[index]
      if (row.scope !== 'system' || typeof row.name !== 'string' || !seedNames.has(row.name)
        || lastSystemRowByName.get(row.name) !== row.id) return row
      if (typeof next.updatedAt !== 'number' || !Number.isFinite(next.updatedAt)
        || next.updatedAt < window.start || next.updatedAt > window.end) throw new Error('049 system seed timestamp is outside actual bootstrap window')
      const body = table === 'promptWorkflows' ? rebindBuiltinLinearWorkflow049(row, next) : row
      return { ...body, updatedAt: next.updatedAt }
    }))
  }
  // No table is omitted. The caller compares the complete native snapshot.
  return expected
}

test('049 actual delete confirmation includes late uncached native descendants and preserves other owners and historical Release values', async ({ page }, info) => {
  const f = await seed(page, false)
  const lookup = await openCodex(page, f.url)
  await expect(lookup.getByPlaceholder('详细描述', { exact: true })).toHaveValue(f.description)
  const dialog = await openDelete(page)
  // Keep the real confirmation pending while a second native writer adopts.
  const late = await page.evaluate(async ({ scope, parentId }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { adopt } = await load('/storyforge/src/lib/registry/adopt.ts') as typeof import('../../src/lib/registry/adopt')
    const { useCodexStore } = await load('/storyforge/src/stores/codex.ts') as typeof import('../../src/stores/codex')
    const child = await adopt({ projectId: scope.projectId, scope, target: 'codexCategories', mode: 'add',
      data: { domain: 'humanity', parentId, name: '049 确认期间正式采纳的未缓存后代', fieldSchema: '[]', order: 1 } })
    if (child.written.length !== 1 || child.fkErrors.length) throw new Error('049 late native category adoption failed')
    const childId = child.written[0].id
    const entry = await adopt({ projectId: scope.projectId, scope, target: 'codexEntries', mode: 'add',
      data: { categoryId: childId, name: '049 未缓存后代中的词条', summary: '真实采纳未刷新缓存',
        description: '确认期间新增的完整词条。🌙e\u0301', fields: '{}', refs: '{}' } })
    if (entry.written.length !== 1 || entry.fkErrors.length) throw new Error('049 late native entry adoption failed')
    const rootEntry = await adopt({ projectId: scope.projectId, scope, target: 'codexEntries', mode: 'add',
      data: { categoryId: parentId, name: '049 已缓存子分类中新增的词条', summary: '真实采纳未刷新缓存',
        description: '第二个未缓存完整词条。🌙e\u0301', fields: '{}', refs: '{}' } })
    if (rootEntry.written.length !== 1 || rootEntry.fkErrors.length) throw new Error('049 second late native entry adoption failed')
    const cache = useCodexStore.getState()
    return { childId, entryId: entry.written[0].id, rootEntryId: rootEntry.written[0].id,
      cachedCategories: cache.categories.map(row => row.id), cachedEntries: cache.entries.map(row => row.id), loadedScope: cache.loadedScope }
  }, { scope: f.scope, parentId: f.child })
  expect(late.loadedScope).toEqual(f.scope)
  expect(late.cachedCategories).not.toContain(late.childId)
  expect(late.cachedEntries).not.toContain(late.entryId)
  expect(late.cachedEntries).not.toContain(late.rootEntryId)
  await expect(dialog).toBeVisible()
  const before = await databaseSnapshot(page)
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(lookup.getByText(ROOT_NAME, { exact: true })).toHaveCount(0)
  await expect(lookup.getByText('049 已加载的子分类', { exact: true })).toHaveCount(0)
  const after = await databaseSnapshot(page)
  const expected = { ...before,
    codexCategories: withoutIds(before, 'codexCategories', [f.root, f.child, late.childId]),
    codexEntries: withoutIds(before, 'codexEntries', [f.known, f.knownChild, late.entryId, late.rootEntryId]) }
  expect(after).toEqual(expected)
  // This comparison includes all actual native tables, other World/Work roots,
  // their complete entries, source prose, revisions and immutable Release rows.
  await lookup.getByText(KEEP_NAME, { exact: true }).click()
  await expect(lookup.getByText(KEEP_ENTRY_NAME, { exact: true })).toBeVisible()
  await info.attach('049-success-native-full-values', { contentType: 'application/json', body: JSON.stringify({ f, late, before, after }) })
  const bootstrapSeeds = await bootstrapSeedNames049(page)
  const bootstrapStart = await page.evaluate(() => Date.now())
  await page.reload()
  await page.getByRole('button', { name: '设定查询', exact: true }).click()
  const refreshed = page.getByRole('region', { name: '设定查询', exact: true })
  await refreshed.getByRole('button', { name: '打开词条库提取设定', exact: true }).click()
  await refreshed.getByRole('button', { name: '人文环境', exact: true }).click()
  await expect(refreshed.getByText(KEEP_NAME, { exact: true })).toBeVisible()
  await expect(refreshed.getByText(ROOT_NAME, { exact: true })).toHaveCount(0)
  const reloaded = await databaseSnapshot(page)
  const bootstrapEnd = await page.evaluate(() => Date.now())
  expect(reloaded).toEqual(expectedAfterSystemBootstrap049(expected, reloaded, bootstrapSeeds, { start: bootstrapStart, end: bootstrapEnd }))
  await info.attach('049-success-reload-native-full-values', { contentType: 'application/json',
    body: JSON.stringify({ expected, reloaded, bootstrapSeeds, bootstrapStart, bootstrapEnd }) })
})

test('049 real IndexedDB delete failure exposes an alert and rolls back categories entries references and all other native values', async ({ page }, info) => {
  const f = await seed(page, true)
  const lookup = await openCodex(page, f.url)
  await expect(lookup.getByPlaceholder('详细描述', { exact: true })).toHaveValue(f.description)
  const dialog = await openDelete(page)
  const before = await databaseSnapshot(page)
  await page.evaluate(async ({ rootId, keptEntryId, characterId, message }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const transactionIds = new WeakMap<object, number>()
    let nextTransactionId = 0
    const describe = (transaction: import('dexie').Transaction) => {
      if (!transactionIds.has(transaction)) transactionIds.set(transaction, ++nextTransactionId)
      return { transactionId: transactionIds.get(transaction), mode: transaction.mode, stores: transaction.storeNames.slice() }
    }
    const observations: { table: string; key: unknown; modifications?: unknown; transactionId?: number; mode: string; stores: string[] }[] = []
    const entryUpdate = (modifications: object, key: unknown, _row: unknown, transaction: import('dexie').Transaction) => {
      if (key === keptEntryId) observations.push({ table: 'codexEntries', key, modifications, ...describe(transaction) })
    }
    const characterUpdate = (modifications: object, key: unknown, _row: unknown, transaction: import('dexie').Transaction) => {
      if (key === characterId) observations.push({ table: 'characters', key, modifications, ...describe(transaction) })
    }
    const fail = (key: unknown, _row: unknown, transaction: import('dexie').Transaction) => {
      if (key !== rootId) return
      observations.push({ table: 'codexCategories', key, ...describe(transaction) })
      throw new Error(message)
    }
    db.codexEntries.hook('updating', entryUpdate)
    db.characters.hook('updating', characterUpdate)
    db.codexCategories.hook('deleting', fail)
    Object.assign(window, { __codex049Failure: { observations, restore: () => {
      db.codexEntries.hook('updating').unsubscribe(entryUpdate)
      db.characters.hook('updating').unsubscribe(characterUpdate)
      db.codexCategories.hook('deleting').unsubscribe(fail)
    } } })
  }, { rootId: f.root, keptEntryId: f.keptEntry, characterId: f.characterId, message: FAILURE })
  try {
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(lookup.getByRole('alert').filter({ hasText: FAILURE })).toBeVisible()
    await expect(lookup.getByText(ROOT_NAME, { exact: true }).locator('..')).toHaveClass(/bg-accent\/10/)
    await expect(lookup.getByPlaceholder('详细描述', { exact: true })).toHaveValue(f.description)
    const observations = await page.evaluate(() => (window as unknown as { __codex049Failure: {
      observations: { table: string; key: unknown; modifications?: unknown; transactionId?: number; mode: string; stores: string[] }[];
    } }).__codex049Failure.observations)
    expect(observations.find(row => row.table === 'codexEntries' && row.key === f.keptEntry))
      .toMatchObject({ modifications: { refs: '{"related":[]}' } })
    expect(observations.find(row => row.table === 'characters' && row.key === f.characterId))
      .toMatchObject({ modifications: { raceEntryId: null } })
    expect(observations.some(row => row.table === 'codexCategories' && row.key === f.root)).toBe(true)
    expect(new Set(observations.map(row => row.transactionId)).size).toBe(1)
    expect(observations.every(row => row.transactionId != null && row.mode === 'readwrite'
      && ['codexCategories', 'codexEntries', 'characters'].every(table => row.stores.includes(table)))).toBe(true)
    const after = await databaseSnapshot(page)
    expect(after).toEqual(before)
    await info.attach('049-real-native-rollback-full-values', { contentType: 'application/json', body: JSON.stringify({ f, observations, before, after }) })
  } finally {
    if (!page.isClosed()) await page.evaluate(() => (window as unknown as { __codex049Failure: { restore: () => void } }).__codex049Failure.restore())
  }
  // Real refresh rebuilds React/cache from the unchanged authored native rows.
  const bootstrapSeeds = await bootstrapSeedNames049(page)
  const bootstrapStart = await page.evaluate(() => Date.now())
  const refreshed = await openCodex(page, f.url)
  await expect(refreshed.getByPlaceholder('详细描述', { exact: true })).toHaveValue(f.description)
  const reloaded = await databaseSnapshot(page)
  const bootstrapEnd = await page.evaluate(() => Date.now())
  expect(reloaded).toEqual(expectedAfterSystemBootstrap049(before, reloaded, bootstrapSeeds, { start: bootstrapStart, end: bootstrapEnd }))
  await info.attach('049-failure-reload-native-full-values', { contentType: 'application/json',
    body: JSON.stringify({ before, reloaded, bootstrapSeeds, bootstrapStart, bootstrapEnd }) })
})
