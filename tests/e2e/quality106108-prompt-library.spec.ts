import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { serialize } from 'node:v8'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const SOURCE = '106 浏览器完整参考模板'
const MOVING = '108 浏览器编辑中的模板'
const CURRENT_A = '108 当前正文选择'
const CURRENT_B = '108 当前续写选择'
const blockedByContext = new WeakMap<BrowserContext, string[]>()
const errorsByPage = new WeakMap<Page, string[]>()
type Tables = Record<string, unknown[]>

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('106/108 requires a fresh loopback browser')
  const origin = new URL(base).origin
  const blocked: string[] = [], errors: string[] = []
  blockedByContext.set(context, blocked)
  errorsByPage.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality106108-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url())
    const httpOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (httpOrigin !== origin) {
      blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      websocket.close({ code: 1008, reason: 'No external network authorized' })
    } else websocket.connectToServer()
  })
})
test.afterEach(async ({ context, page }, info) => {
  const blocked = blockedByContext.get(context) ?? [], pageErrors = errorsByPage.get(page) ?? []
  await info.attach('106108-network-and-errors', { contentType: 'application/json', body: JSON.stringify({ blocked, pageErrors, realModelCalls: 0 }) })
  expect(blocked).toEqual([])
  expect(pageErrors).toEqual([])
})

async function seed(page: Page, activation: boolean) {
  await createLongform(page, activation ? '108 隔离长篇入口' : '106 隔离长篇入口')
  const created = await page.evaluate(async ({ sourceName, movingName, currentA, currentB, activation }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const source: PromptTemplate = {
      scope: 'system', moduleKey: 'chapter.content', promptType: 'author-browser-check',
      name: sourceName, description: 'Full synthetic template; no provider or author profile.',
      systemPrompt: '  SYSTEM 原文 🌙\ne\u0301 {{tone}}  ', userPromptTemplate: '材料 {{subject}} {{count}} {{enabled}}',
      variables: ['subject', 'tone', 'count', 'enabled'], modelOverride: { temperature: 0, maxTokens: 0 },
      isDefault: false, genres: ['general'], assetId: 'QUALITY106-BROWSER',
      parameters: [
        { key: 'tone', label: '文风', type: 'select', options: ['exact', 'warm'], default: 'exact', optional: false, description: '' },
        { key: 'count', label: '次数', type: 'number', default: 0, min: 0, max: 10, step: 1 },
        { key: 'enabled', label: '开关', type: 'boolean', default: false, optional: true },
        { key: 'size', label: '长度', type: 'slider', default: 2, min: 0, max: 10, maxFromModelOutput: false },
        { key: 'extra', label: '补充', type: 'text', default: '' },
      ],
      examples: { good: [{ id: 'g', text: '  GOOD 🌙\ne\u0301  ', source: 'user-marked', rating: 5, note: '', createdAt: 0 }],
        bad: [{ id: 'b', text: 'BAD 原文', source: 'ai-generated', rating: 1, createdAt: 1 }] },
      lengthMode: 'long', continuityMode: 'required',
      variableBindings: [{ variable: 'subject', label: '材料', manual: true, required: true, placeholder: '完整材料', description: '' },
        { variable: 'canon', label: '已登记来源', sourceKeys: ['characters'], workField: 'title', manual: false, required: false }],
      applicability: { lengthModes: ['long'], serializationModes: ['standalone'], genres: ['general'] },
      isActive: false, createdAt: 1, updatedAt: 1,
    }
    // Public native fixture setup. These rows are not claimed to have been
    // created through the UI or to authorize any model/World/Run action.
    if (!activation) {
      const id = await usePromptStore.getState().saveTemplate(source)
      const row = await db.promptTemplates.get(id)
      if (!row?.id) throw new Error('Missing synthetic source template')
      return { source: row, movingId: id, a: id, b: id }
    }
    const id = await usePromptStore.getState().saveTemplate({ ...source, scope: 'user', name: movingName })
    const a = await usePromptStore.getState().saveTemplate({ ...source, scope: 'user', name: currentA })
    const b = await usePromptStore.getState().saveTemplate({ ...source, scope: 'user', name: currentB, moduleKey: 'chapter.continue' })
    await usePromptStore.getState().setActive(a)
    await usePromptStore.getState().setActive(b)
    const row = await db.promptTemplates.get(id)
    if (!row?.id) throw new Error('Missing synthetic editor template')
    return { source: row, movingId: id, a, b }
  }, { sourceName: SOURCE, movingName: MOVING, currentA: CURRENT_A, currentB: CURRENT_B, activation })
  await openLongformLeaf(page, '提示词库')
  return created
}

async function tables(page: Page): Promise<Tables> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const result: Record<string, unknown[]> = {}
    for (const table of db.tables) result[table.name] = await table.toArray()
    return result
  })
}

async function rows(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.promptTemplates.toArray()
  })
}

function content({ id: _id, scope: _scope, isActive: _active, parentId: _parent,
  createdAt: _created, updatedAt: _updated, ...value }: PromptTemplate) { return value }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected actual export object')
  return value as Record<string, unknown>
}

function envelope(json: string) {
  const root = record(JSON.parse(json) as unknown)
  expect(root.format).toBe('storyforge.prompt-templates')
  expect(root.version).toBe(1)
  if (!Array.isArray(root.templates)) throw new Error('Actual export has no templates array')
  return { ...root, templates: root.templates.map(record) }
}

async function download(page: Page, name: string) {
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const result = await waiting
  const path = await result.path()
  if (!path) throw new Error('Actual browser download has no owned artifact')
  return readFile(path, 'utf8')
}

async function upload(page: Page, json: string) {
  const input = page.getByRole('button', { name: '导出全部', exact: true }).locator('..').locator('input[type=file]')
  await input.setInputFiles({ name: 'quality-prompts.json', mimeType: 'application/json', buffer: Buffer.from(json) })
}

async function attachTables(info: TestInfo, label: string, value: Tables) {
  await info.attach(label, { contentType: 'application/octet-stream', body: serialize(value) })
}

function expectOnlyAddedTemplates(before: Tables, after: Tables, expected: unknown[]) {
  for (const [name, value] of Object.entries(before)) {
    if (name !== 'promptTemplates') expect(after[name], name).toEqual(value)
  }
  const previous = before.promptTemplates as PromptTemplate[], next = after.promptTemplates as PromptTemplate[]
  for (const original of previous) expect(next.find(row => row.id === original.id)).toEqual(original)
  const oldIds = new Set(previous.map(row => row.id))
  const added = next.filter(row => !oldIds.has(row.id)).sort((a, b) => a.id! - b.id!)
  expect(added).toHaveLength(expected.length)
  added.forEach((row, index) => {
    expect(content(row)).toEqual(expected[index])
    expect(row.scope).toBe('user')
    expect(row.isActive).toBe(false)
    expect(row.parentId).toBeUndefined()
    expect(row.createdAt).toBeGreaterThan(1)
    expect(row.updatedAt).toBe(row.createdAt)
  })
  return added
}

test('106 actual downloads/uploads retain complete content and malformed batches write nothing', async ({ page }, info) => {
  const f = await seed(page, false)
  await page.getByRole('button', { name: new RegExp(SOURCE) }).click()
  const before = await tables(page)
  const singleJson = await download(page, '导出')
  await info.attach('106-actual-single-download', { contentType: 'application/json', body: singleJson })
  expect(envelope(singleJson).templates).toEqual([content(f.source)])
  await upload(page, singleJson)
  await expect(page.getByText('成功导入 1 条模板', { exact: true })).toBeVisible()
  const afterSingle = await tables(page)
  expectOnlyAddedTemplates(before, afterSingle, [content(f.source)])

  const file = envelope(singleJson)
  const expected = [{ ...file.templates[0], name: '106 批量副本一' }, { ...file.templates[0], name: '106 批量副本二' }]
  await upload(page, JSON.stringify({ ...file, templates: expected }))
  await expect(page.getByText('成功导入 2 条模板', { exact: true })).toBeVisible()
  const afterMultiple = await tables(page)
  expectOnlyAddedTemplates(afterSingle, afterMultiple, expected)
  const allJson = await download(page, '导出全部')
  expect(envelope(allJson).templates).toEqual((await rows(page)).map(content))
  await info.attach('106-actual-all-download', { contentType: 'application/json', body: allJson })

  const beforeBad = await tables(page)
  await attachTables(info, '106-before-bad-full-native', beforeBad)
  await upload(page, JSON.stringify({ ...file, templates: [file.templates[0], { ...file.templates[0], parameters: 'BROKEN' }] }))
  await expect(page.getByText(/导入失败：templates\[1\]\.parameters/)).toBeVisible()
  const afterBad = await tables(page)
  await attachTables(info, '106-after-bad-full-native', afterBad)
  expect(afterBad).toEqual(beforeBad)

  const usersBeforeReload = (await rows(page)).filter(row => row.scope === 'user')
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  expect((await rows(page)).filter(row => row.scope === 'user')).toEqual(usersBeforeReload)
  expect((await rows(page)).find(row => row.id === f.source.id)).toEqual(f.source)
  // No whole-database zero-write claim across bootstrap: existing system seeds
  // refresh their own timestamps and builtin workflow ids (the separate049 lead).
})

test('108 actual dirty editor preserves explicit activation and rejects stale/unsaved routes', async ({ page }, info) => {
  const f = await seed(page, true)
  await page.getByRole('combobox').filter({ has: page.locator('option[value="user"]') }).selectOption('user')
  await page.getByRole('button', { name: new RegExp(MOVING) }).click()
  const system = page.locator('textarea').first()
  const save = page.getByRole('button', { name: '保存 *', exact: true })
  const activate = page.getByRole('button', { name: '设为激活', exact: true })
  const module = page.getByRole('combobox').filter({ has: page.locator('option[value="chapter.continue"]') })
  await system.fill('108 AUTHOR_DIRTY_A 🌙\ne\u0301')
  await activate.click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.movingId)?.isActive).toBe(true)
  await expect(system).toHaveValue('108 AUTHOR_DIRTY_A 🌙\ne\u0301')
  await expect(save).toBeEnabled()
  expect((await rows(page)).find(row => row.id === f.movingId)?.systemPrompt).toBe(f.source.systemPrompt)
  await save.click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.movingId)?.systemPrompt).toBe('108 AUTHOR_DIRTY_A 🌙\ne\u0301')

  await system.fill('108 AUTHOR_AFTER_EXTERNAL_A2')
  // Explicit native second writer, not an invented author UI action.
  await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
    await usePromptStore.getState().setActive(id)
  }, f.a)
  await save.click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.movingId)?.systemPrompt).toBe('108 AUTHOR_AFTER_EXTERNAL_A2')
  expect((await rows(page)).find(row => row.id === f.movingId)?.isActive).toBe(false)
  expect((await rows(page)).find(row => row.id === f.a)?.isActive).toBe(true)

  await module.selectOption('chapter.continue')
  const beforeUnsaved = await tables(page)
  await activate.click()
  await expect(page.getByText('请先保存模块变更，再在新模块设为激活；未保存的编辑仍保留。', { exact: true })).toBeVisible()
  expect(await tables(page)).toEqual(beforeUnsaved)
  await expect(system).toHaveValue('108 AUTHOR_AFTER_EXTERNAL_A2')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('已移到新模块，尚未激活；需要时请在新模块显式设为激活。', { exact: true })).toBeVisible()
  expect((await rows(page)).find(row => row.id === f.movingId)).toMatchObject({ moduleKey: 'chapter.continue', isActive: false })
  expect((await rows(page)).find(row => row.id === f.b)?.isActive).toBe(true)
  await system.fill('108 AUTHOR_UNSAVED_OWN_B')
  await activate.click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.movingId)?.isActive).toBe(true)
  await expect(system).toHaveValue('108 AUTHOR_UNSAVED_OWN_B')
  await expect(save).toBeEnabled()
  expect((await rows(page)).find(row => row.id === f.movingId)?.systemPrompt).toBe('108 AUTHOR_AFTER_EXTERNAL_A2')

  await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const current = await db.promptTemplates.get(id)
    if (!current) throw new Error('External-route control lost its actual row')
    await usePromptStore.getState().saveTemplate({ ...current, moduleKey: 'chapter.content' }, { expectedModuleKey: 'chapter.continue' })
  }, f.movingId)
  const beforeStale = await tables(page)
  await attachTables(info, '108-before-stale-full-native', beforeStale)
  await expect(module).toHaveValue('chapter.continue')
  await activate.click()
  await expect(page.getByText('模板所属模块已在其他位置改变，激活未执行；请先核对当前模块。', { exact: true })).toBeVisible()
  expect(await tables(page)).toEqual(beforeStale)
  await save.click()
  await expect(page.getByText('模板所属模块已在其他位置改变，未保存的编辑仍保留；请重新选择模板后核对。', { exact: true })).toBeVisible()
  const afterStale = await tables(page)
  await attachTables(info, '108-after-stale-full-native', afterStale)
  expect(afterStale).toEqual(beforeStale)
  await expect(system).toHaveValue('108 AUTHOR_UNSAVED_OWN_B')
  await expect(save).toBeEnabled()
  const usersBeforeReload = (await rows(page)).filter(row => row.scope === 'user')
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  expect((await rows(page)).filter(row => row.scope === 'user')).toEqual(usersBeforeReload)
})
