import { expect, test } from '@playwright/test'

/** Native isolated IndexedDB and actual API flow; transport is explicitly simulated, public UI/real-provider acceptance remains separate. */
test('fresh open production survives both author-review reloads and resolves a pinned protocol 2 preview without repeating model calls', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const fixture = await helper.seedOpenBrowserProductionV1()
    return { fixture, blocked: await helper.runOpenBrowserProductionV1(fixture) }
  })
  expect(initial.blocked).toMatchObject({ terminal: false, status: 'recovery-required', taskKey: 'ttrpg.open.source-facts', modelCalls: 1 })
  await page.reload()
  const repeated = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')).runOpenBrowserProductionV1(fixture)
  }, initial.fixture)
  expect(repeated.modelCalls).toBe(1)
  const second = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')).runOpenBrowserProductionV1(fixture, true)
  }, initial.fixture)
  expect(second).toMatchObject({ terminal: false, taskKey: 'ttrpg.open.rule-system', modelCalls: 2 })
  await page.reload()
  const final = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    return { completed: await helper.runOpenBrowserProductionV1(fixture, true), preview: await helper.openBrowserProductionPreviewV1(fixture) }
  }, initial.fixture)
  expect(final.completed).toMatchObject({ terminal: true, modelCalls: 4 })
  expect(final.completed.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  expect(final.preview).toMatchObject({ version: 2, state: { ttrpg: { version: 2, runFormat: 'open', openRun: null } } })
  await page.reload()
  const restored = await page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    return { state: await readProductRuntimeState(input.sessionId), build: await db.productBuilds.get(input.buildId) }
  }, { sessionId: final.preview.sessionId, buildId: final.completed.buildId })
  expect(restored.state).toEqual(final.preview.state)
  expect(restored.build.previewHash).toBe(final.completed.previewHash)
})
