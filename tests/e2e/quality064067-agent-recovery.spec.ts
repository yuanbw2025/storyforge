import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const helperPath = '/storyforge/tests/helpers/sfqa064067-native-recovery.ts'
async function openIsolated(page: Page, context: BrowserContext, baseURL: string | undefined) {
  if (!baseURL) throw Error('Missing isolated origin')
  const local = new URL(baseURL).origin
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['http:', 'https:'].includes(url.protocol) && url.origin !== local && url.hostname !== 'sfqa064067.invalid'
      ? route.abort() : route.continue()
  })
  await page.goto('./world/worlds')
  // The real page is mounted after prompt/workflow bootstrap finishes.
  await expect(page.getByRole('heading', {name: '世界引擎', exact: true})).toBeVisible()
}

test('064 actual IndexedDB rolls back appended chapters with a failed final receipt, then restores the same intent without a model', async ({page, context, baseURL}) => {
  await openIsolated(page, context, baseURL)
  let modelRequests = 0
  await page.route('https://sfqa064067.invalid/**', route => { modelRequests++; return route.abort() })
  const before = await page.evaluate(async path => {
    const load = new Function('p','return import(p)') as <T>(p:string)=>Promise<T>
    return (await load<typeof import('../helpers/sfqa064067-native-recovery')>(path)).prepareReceiptRollback()
  }, helperPath)
  expect(before.injected).toBe(1)
  expect(before.recovery).toEqual({recoveredRunIds: [], failed:[{runId:before.runId,reason:'native064 final receipt fault'}]})
  expect(before.rollbackEvents).toEqual(before.beforeEvents)
  expect(before.rollbackOutline).toEqual(before.beforeOutline)
  expect(modelRequests).toBe(0)
  await page.reload()
  await expect(page.getByRole('heading', {name: '世界引擎', exact: true})).toBeVisible()
  const after = await page.evaluate(async input => {
    const load = new Function('p','return import(p)') as <T>(p:string)=>Promise<T>
    return (await load<typeof import('../helpers/sfqa064067-native-recovery')>(input.path)).finishReceiptRollback(input)
  }, {path: helperPath, scope: before.scope, runId: before.runId})
  expect(after.recovery).toEqual({recoveredRunIds:[before.runId],failed:[]})
  expect(after.committed).toBe(1); expect(after.succeeded).toBe(1)
  expect(after.chapters).toEqual(before.items)
  expect(after.raw).toContain(before.items[0].title)
  expect(modelRequests).toBe(0)
})

test('067 intercepted provider response pauses on stale source; reload/mount/direct resume preserve exact output and observed usage without a new request', async ({page, context, baseURL}) => {
  await openIsolated(page, context, baseURL)
  const fixture = await page.evaluate(async path => {
    const load = new Function('p','return import(p)') as <T>(p:string)=>Promise<T>
    return (await load<typeof import('../helpers/sfqa064067-native-recovery')>(path)).prepareStaleDetails()
  }, helperPath)
  let requests = 0
  await page.route('https://sfqa064067.invalid/**', async route => {
    requests++
    await page.evaluate(async f => {
      const {db}=await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as ()=>Promise<typeof import('../../src/lib/db/schema')>)()
      await db.outlineNodes.update(f.outlineId,{summary:f.updated,updatedAt:f.now+1})
    },fixture)
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      choices:[{message:{content:fixture.output},finish_reason:'stop'}],usage:{prompt_tokens:31,completion_tokens:23,total_tokens:54},
    })})
  })
  const before = await page.evaluate(async input => {
    const load = new Function('p','return import(p)') as <T>(p:string)=>Promise<T>
    return (await load<typeof import('../helpers/sfqa064067-native-recovery')>(input.path)).runStaleDetails(input.fixture)
  },{path:helperPath,fixture})
  expect(before.failure).toMatch(/来源已变化.*等待作者/)
  expect(before.state).toBe('paused');expect(before.candidates).toBe(0);expect(before.replans).toBe(0);expect(before.details).toBe(0)
  expect(JSON.parse(before.raw)).toMatchObject({version:'creation-model-response-v1',raw:fixture.output,
    observation:{usage:{inputTokens:31,outputTokens:23,totalTokens:54}}})
  expect(requests).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', {name: '世界引擎', exact: true})).toBeVisible()
  const after = await page.evaluate(async input => {
    const load = new Function('p','return import(p)') as <T>(p:string)=>Promise<T>
    return (await load<typeof import('../helpers/sfqa064067-native-recovery')>(input.path)).resumeStaleDetails(input)
  },{path:helperPath,scope:fixture.scope,conversationId:fixture.conversationId,runId:before.runId})
  expect(after.failure).toMatch(/来源已变化.*等待作者/)
  expect(after.mount).toEqual({recoveredRunIds:[],failed:[]});expect(after.resumable).toBeNull();expect(after.eventsUnchanged).toBe(true)
  expect(after.raw).toBe(before.raw);expect(after.state).toBe('paused');expect(requests).toBe(1)
})
