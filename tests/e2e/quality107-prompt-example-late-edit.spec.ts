import { expect, test, type BrowserContext, type Page, type Request as BrowserRequest, type TestInfo } from '@playwright/test'
import { serialize } from 'node:v8'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const A = 'QUALITY107_AUTHOR_A', B = 'QUALITY107_AUTHOR_B', CURRENT_A = 'QUALITY107_CURRENT_A'
const MODEL = 'quality107-browser-synthetic'
type Tables = Record<string, unknown[]>
type Reply = { kind: 'response'; status: number; body: string; allowClientAbort?: boolean } | { kind: 'cleanup-abort' }
interface Attempt {
  request: BrowserRequest
  messages: string[]
  replySent: boolean
  reply: (value: Reply) => void
  done: Promise<void>
  responseStatus: number | null
  failureText: string | null
  abortedRouteCleanup: string | null
}
interface Boundary {
  origin: string
  modelEndpoint: string
  blocked: string[]
  pageErrors: string[]
  transportErrors: string[]
  attempts: Attempt[]
}
const boundaries = new WeakMap<BrowserContext, Boundary>()

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected actual synthetic request object')
  return value as Record<string, unknown>
}

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('fresh isolated loopback browser required')
  const origin = new URL(base).origin
  const state: Boundary = {
    origin, modelEndpoint: `${origin}/__quality107-model/v1/chat/completions`,
    blocked: [], pageErrors: [], transportErrors: [], attempts: [],
  }
  boundaries.set(context, state)
  const watched = new WeakSet<Page>()
  const watch = (current: Page) => {
    if (watched.has(current)) return
    watched.add(current)
    current.on('pageerror', error => state.pageErrors.push(error.message))
    current.on('crash', () => state.pageErrors.push('owned isolated page crashed'))
    current.on('requestfailed', request => {
      const attempt = state.attempts.find(item => item.request === request)
      if (attempt) attempt.failureText = request.failure()?.errorText ?? 'unknown request failure'
    })
    current.on('response', response => {
      const attempt = state.attempts.find(item => item.request === response.request())
      if (attempt) attempt.responseStatus = response.status()
    })
  }
  watch(page)
  context.on('page', watch)
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality107-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.href === state.modelEndpoint && request.method() === 'POST') {
      const payload = record(request.postDataJSON() as unknown)
      if (payload.model !== MODEL || payload.stream !== true || !Array.isArray(payload.messages)
        || Boolean(request.headers().authorization)) {
        state.blocked.push('unexpected synthetic model request shape or authorization')
        await route.abort('blockedbyclient')
        return
      }
      const messages: string[] = []
      for (const value of payload.messages) {
        const message = record(value)
        if (typeof message.role !== 'string' || typeof message.content !== 'string') throw new Error('unexpected synthetic message shape')
        messages.push(message.content)
      }
      const gate = deferred<Reply>(), finished = deferred<void>()
      const attempt: Attempt = {
        request, messages, replySent: false, reply: value => gate.resolve(value), done: finished.promise,
        responseStatus: null, failureText: null, abortedRouteCleanup: null,
      }
      state.attempts.push(attempt)
      const reply = await gate.promise
      try {
        if (reply.kind === 'cleanup-abort') await route.abort('aborted')
        else await route.fulfill({ status: reply.status, contentType: reply.status === 200 ? 'text/event-stream' : 'application/json', body: reply.body })
        finished.resolve()
      } catch (cause) {
        // Returning a response to a browser-cancelled fetch can itself be
        // rejected by Playwright. This is recorded, never called delivery.
        const failure = request.failure()?.errorText
        if (reply.kind === 'response' && reply.allowClientAbort && failure === 'net::ERR_ABORTED') {
          attempt.abortedRouteCleanup = cause instanceof Error ? cause.message : String(cause)
          finished.resolve()
        } else {
          state.transportErrors.push(cause instanceof Error ? cause.message : String(cause))
          finished.reject(cause)
        }
      }
      return
    }
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url()), httpOrigin = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    if (httpOrigin !== origin) {
      state.blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      websocket.close({ code: 1008, reason: 'No external network authorized' })
    } else websocket.connectToServer()
  })
})
test.afterEach(async ({ context }, info) => {
  const state = boundaries.get(context)!
  const unresolved = state.attempts.filter(item => !item.replySent)
  // Cleanup after a failed test cannot turn an uncompleted scenario green.
  for (const attempt of unresolved) {
    attempt.replySent = true
    attempt.reply({ kind: 'cleanup-abort' })
    await attempt.done
  }
  await info.attach('107-transport-and-errors', { contentType: 'application/json', body: JSON.stringify({
    blocked: state.blocked, pageErrors: state.pageErrors, transportErrors: state.transportErrors,
    unresolvedBeforeCleanup: unresolved.length, realModelCalls: 0,
    attempts: state.attempts.map(item => ({ messages: item.messages, responseStatus: item.responseStatus,
      failureText: item.failureText, abortedRouteCleanup: item.abortedRouteCleanup })),
  }) })
  expect(unresolved).toHaveLength(0)
  expect(state.blocked).toEqual([])
  expect(state.pageErrors).toEqual([])
  expect(state.transportErrors).toEqual([])
})

async function prepare(page: Page) {
  await createLongform(page, '107 提示词草稿隔离入口')
  const modelBase = `${boundaries.get(page.context())!.origin}/__quality107-model/v1`
  const fixture = await page.evaluate(async ({ names, modelBase, model }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    useAIConfigStore.getState().setConfig({ provider: 'custom', baseUrl: modelBase, apiKey: '', model,
      maxTokens: 1024, contextWindow: 128000, temperature: 0.7 })
    const original: PromptTemplate = {
      scope: 'user', moduleKey: 'chapter.content', promptType: 'generate', name: names.a,
      description: 'synthetic template; no profile/credentials', systemPrompt: '107_ORIGINAL_SYSTEM e\u0301🌙',
      userPromptTemplate: '107 ORIGINAL_USER {{subject}}', variables: ['subject'],
      parameters: [{ key: 'tone', label: 'Tone', type: 'text', default: 'exact' }],
      examples: { good: [{ id: 'original-good', text: '107_ORIGINAL_GOOD', source: 'user-marked', rating: 5, createdAt: 1 }],
        bad: [{ id: 'original-bad', text: '107_ORIGINAL_BAD', source: 'user-marked', rating: 1, createdAt: 1 }] },
      lengthMode: 'long', continuityMode: 'off', genres: ['general'], isActive: false, createdAt: 1, updatedAt: 1,
    }
    const a = await usePromptStore.getState().saveTemplate(original)
    const b = await usePromptStore.getState().saveTemplate({ ...original, name: names.b, moduleKey: 'chapter.continue', systemPrompt: '107_B_ORIGINAL' })
    const currentA = await usePromptStore.getState().saveTemplate({ ...original, name: names.currentA })
    await usePromptStore.getState().setActive(b)
    await usePromptStore.getState().setActive(currentA)
    const saved = await db.promptTemplates.get(a)
    if (!saved?.id) throw new Error('public fixture did not create its global template')
    return { a: saved, b, currentA }
  }, { names: { a: A, b: B, currentA: CURRENT_A }, modelBase, model: MODEL })
  await openLongformLeaf(page, '提示词库')
  await page.getByRole('button', { name: new RegExp(A) }).click()
  await expect(page.locator('textarea').first()).toHaveValue(fixture.a.systemPrompt)
  return fixture
}
function system(page: Page) { return page.locator('textarea').first() }
function save(page: Page) { return page.getByRole('button', { name: '保存 *', exact: true }) }
function moduleSelect(page: Page) { return page.getByRole('combobox').filter({ has: page.locator('option[value="chapter.continue"]') }) }
async function begin(page: Page) {
  const state = boundaries.get(page.context())!, index = state.attempts.length
  await page.getByRole('button', { name: 'AI 生成', exact: true }).first().click()
  await expect.poll(() => state.attempts.length).toBe(index + 1)
  return state.attempts[index]
}
function success(text: string, allowClientAbort = false): Reply {
  return { kind: 'response', status: 200, allowClientAbort,
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`
      + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` }
}
async function respond(attempt: Attempt, reply: Reply) {
  if (attempt.replySent) throw new Error('synthetic response already settled')
  attempt.replySent = true
  attempt.reply(reply)
  await attempt.done
}
async function tables(page: Page): Promise<Tables> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.transaction('r', db.tables, async () => Object.fromEntries(
      await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))))
  })
}
async function rows(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.promptTemplates.toArray()
  })
}
async function attachment(info: TestInfo, name: string, value: Tables) {
  await info.attach(name, { contentType: 'application/octet-stream', body: serialize(value) })
}
function onlyTemplateChanged(before: Tables, after: Tables, id: number) {
  expect(Object.keys(after)).toEqual(Object.keys(before))
  for (const [name, value] of Object.entries(before)) if (name !== 'promptTemplates') expect(after[name], name).toEqual(value)
  const oldRows = before.promptTemplates as PromptTemplate[], newRows = after.promptTemplates as PromptTemplate[]
  expect(newRows).toHaveLength(oldRows.length)
  for (const row of oldRows) if (row.id !== id) expect(newRows.find(item => item.id === row.id)).toEqual(row)
}

test('107 actual delayed SSE preserves current author fields and examples until explicit Save', async ({ page }, info) => {
  const f = await prepare(page), before = await tables(page), request = await begin(page)
  expect(request.messages.join('\n')).toContain(f.a.systemPrompt)
  await system(page).fill('107 AUTHOR_CURRENT_SYSTEM e\u0301🌙')
  await page.locator('textarea').nth(1).fill('107 AUTHOR_CURRENT_USER {{subject}}')
  const labelIndex = await page.locator('input').evaluateAll(inputs => inputs.findIndex(item => item instanceof HTMLInputElement && item.value === 'Tone'))
  expect(labelIndex).toBeGreaterThanOrEqual(0)
  await page.locator('input').nth(labelIndex).fill('AUTHOR_CURRENT_PARAMETER')
  await page.getByRole('button', { name: '手动', exact: true }).first().click()
  await page.getByRole('dialog').getByPlaceholder('粘贴示例内容').fill('107_MANUAL_DURING_GENERATION')
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  expect(await tables(page)).toEqual(before)
  await respond(request, success('107_CURRENT_COMPLETE_AI_EXAMPLE'))
  await expect(page.getByText('107_CURRENT_COMPLETE_AI_EXAMPLE', { exact: true })).toBeVisible()
  await expect(system(page)).toHaveValue('107 AUTHOR_CURRENT_SYSTEM e\u0301🌙')
  await expect(page.locator('textarea').nth(1)).toHaveValue('107 AUTHOR_CURRENT_USER {{subject}}')
  const beforeSave = await tables(page)
  expect(beforeSave).toEqual(before)
  await attachment(info, '107-memory-before-native', before)
  await attachment(info, '107-memory-after-native', beforeSave)
  await save(page).click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.a.id)?.systemPrompt).toBe('107 AUTHOR_CURRENT_SYSTEM e\u0301🌙')
  const saved = (await rows(page)).find(row => row.id === f.a.id)!
  expect(saved.userPromptTemplate).toBe('107 AUTHOR_CURRENT_USER {{subject}}')
  expect(saved.parameters).toEqual([{ ...f.a.parameters![0], label: 'AUTHOR_CURRENT_PARAMETER' }])
  expect(saved.examples?.good?.map(item => item.text)).toEqual(['107_ORIGINAL_GOOD', '107_MANUAL_DURING_GENERATION', '107_CURRENT_COMPLETE_AI_EXAMPLE'])
  expect(saved.examples?.good?.[0]).toEqual(f.a.examples?.good?.[0])
  expect(saved.examples?.bad).toEqual(f.a.examples?.bad)
  expect(saved).toEqual({ ...f.a, systemPrompt: saved.systemPrompt, userPromptTemplate: saved.userPromptTemplate,
    parameters: saved.parameters, examples: saved.examples, updatedAt: saved.updatedAt })
  onlyTemplateChanged(before, await tables(page), f.a.id!)
  const users = (await rows(page)).filter(row => row.scope === 'user')
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  expect((await rows(page)).filter(row => row.scope === 'user')).toEqual(users)
  expect(boundaries.get(page.context())!.attempts).toHaveLength(1)
})

test('107 actual module and template changes isolate old requests without losing the new author draft', async ({ page }, info) => {
  const f = await prepare(page), oldModule = await begin(page)
  await system(page).fill('107 AUTHOR_MOVED_MODULE')
  await moduleSelect(page).selectOption('chapter.continue')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  const beforeMoveSave = await tables(page)
  await respond(oldModule, success('107_OLD_MODULE_RESULT', true))
  await expect(system(page)).toHaveValue('107 AUTHOR_MOVED_MODULE')
  await expect(moduleSelect(page)).toHaveValue('chapter.continue')
  await expect(page.getByText('107_OLD_MODULE_RESULT', { exact: true })).toHaveCount(0)
  expect(await tables(page)).toEqual(beforeMoveSave)
  await save(page).click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.a.id)?.moduleKey).toBe('chapter.continue')
  const moved = (await rows(page)).find(row => row.id === f.a.id)!
  expect(moved).toEqual({ ...f.a, moduleKey: 'chapter.continue', systemPrompt: '107 AUTHOR_MOVED_MODULE', isActive: false, updatedAt: moved.updatedAt })
  onlyTemplateChanged(beforeMoveSave, await tables(page), f.a.id!)
  expect((await rows(page)).find(row => row.id === f.b)?.isActive).toBe(true)
  const oldTemplate = await begin(page)
  expect(oldTemplate.messages.join('\n')).toContain('107 AUTHOR_MOVED_MODULE')
  await page.getByRole('button', { name: new RegExp(B) }).click()
  await expect(system(page)).toHaveValue('107_B_ORIGINAL')
  await system(page).fill('107 AUTHOR_CURRENT_B')
  const beforeBSave = await tables(page)
  await respond(oldTemplate, success('107_OLD_TEMPLATE_RESULT', true))
  await expect(page.getByText('107_OLD_TEMPLATE_RESULT', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/示例生成未完整完成|生成失败：/)).toHaveCount(0)
  await expect(system(page)).toHaveValue('107 AUTHOR_CURRENT_B')
  expect(await tables(page)).toEqual(beforeBSave)
  await attachment(info, '107-owner-before-native', beforeBSave)
  await attachment(info, '107-owner-after-native', await tables(page))
  await save(page).click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.b)?.systemPrompt).toBe('107 AUTHOR_CURRENT_B')
  expect((await rows(page)).find(row => row.id === f.a.id)).toEqual(moved)
  onlyTemplateChanged(beforeBSave, await tables(page), f.b)
  expect(boundaries.get(page.context())!.attempts).toHaveLength(2)
})

test('107 failed and explicitly stopped requests never persist examples or roll back current input', async ({ page }, info) => {
  const f = await prepare(page), failed = await begin(page)
  await system(page).fill('107 AUTHOR_AFTER_FAILED_REQUEST')
  const beforeFailure = await tables(page)
  await respond(failed, { kind: 'response', status: 500, body: JSON.stringify({ error: { message: 'SYNTHETIC_107_FAILURE' } }) })
  await expect(page.getByText('示例生成未完整完成，未将部分输出加入草稿；当前编辑仍保留。', { exact: true })).toBeVisible()
  await expect(system(page)).toHaveValue('107 AUTHOR_AFTER_FAILED_REQUEST')
  expect(await tables(page)).toEqual(beforeFailure)
  await save(page).click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.a.id)?.systemPrompt).toBe('107 AUTHOR_AFTER_FAILED_REQUEST')
  const afterFailedSave = (await rows(page)).find(row => row.id === f.a.id)!
  expect(afterFailedSave).toEqual({ ...f.a, systemPrompt: '107 AUTHOR_AFTER_FAILED_REQUEST', updatedAt: afterFailedSave.updatedAt })
  onlyTemplateChanged(beforeFailure, await tables(page), f.a.id!)
  expect(boundaries.get(page.context())!.attempts).toHaveLength(1)
  const stopped = await begin(page)
  await system(page).fill('107 AUTHOR_AFTER_STOP')
  const beforeStop = await tables(page)
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await respond(stopped, success('107_STOPPED_OUTPUT', true))
  await expect(system(page)).toHaveValue('107 AUTHOR_AFTER_STOP')
  await expect(page.getByText('107_STOPPED_OUTPUT', { exact: true })).toHaveCount(0)
  const afterStop = await tables(page)
  expect(afterStop).toEqual(beforeStop)
  await attachment(info, '107-stop-before-native', beforeStop)
  await attachment(info, '107-stop-after-native', afterStop)
  await save(page).click()
  await expect.poll(async () => (await rows(page)).find(row => row.id === f.a.id)?.systemPrompt).toBe('107 AUTHOR_AFTER_STOP')
  const saved = (await rows(page)).find(row => row.id === f.a.id)!
  expect(saved).toEqual({ ...afterFailedSave, systemPrompt: '107 AUTHOR_AFTER_STOP', updatedAt: saved.updatedAt })
  onlyTemplateChanged(beforeStop, await tables(page), f.a.id!)
  expect(boundaries.get(page.context())!.attempts).toHaveLength(2)
})
