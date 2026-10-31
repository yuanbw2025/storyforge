import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {expect, test} from '@playwright/test'

for (const width of [390, 1440]) test(`legacy chat image confirmation remains readable before assembly at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844})
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://chat-production.invalid/v1', apiKey: 'isolated-test-key' })
  let externalCalls = 0
  for (const pattern of ['**/chat/completions', '**/images/generations', '**/local-codex/v1/requests']) {
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST') {externalCalls++; await route.abort()} else await route.continue()
    })
  }
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-media-production-fixture.ts')).seedChatMediaConfirmationFixture()
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const selection = page.getByTestId('chat-media-selection'), confirm = selection.getByRole('button', {name: '确认这些图片与用途并继续', exact: true})
  await expect(selection.getByRole('img')).toHaveCount(2)
  await expect(selection.getByRole('heading', {name: '苏禾 · 头像与在场立绘', exact: true})).toBeVisible()
  await expect(confirm).toBeEnabled()
  await expect(page.getByRole('button', {name: '重试失败任务', exact: true})).toHaveCount(0)
  const read = () => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(f.buildId)
    const rows = await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()
    const runtime = rows.find((row: {artifactKey: string; controlEpoch: number}) => row.artifactKey === 'runtime.package' && row.controlEpoch === build.controlEpoch)
    return {status: build.status, world: JSON.stringify(await db.worldReleases.toArray()), releases: await db.productReleases.count(),
      selection: rows.filter((row: {artifactKey: string}) => row.artifactKey === 'media.chat-selection').length,
      runtime: runtime ? JSON.parse(runtime.payloadJson) : null}
  }, f)
  const before = await read()
  expect(before).toMatchObject({status: 'recovery-required', releases: 0, selection: 0, runtime: null})
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(confirm).toBeEnabled()
  expect(await read()).toEqual(before)
  await confirm.scrollIntoViewIfNeeded()
  await expect(confirm).toBeInViewport({ratio: 1})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath(`chat-picture-confirmation-${width}.png`), fullPage: false})
  await confirm.click()
  // The durable assembly and QA tasks continue after the confirmation receipt.
  await expect.poll(async () => (await read()).status, {timeout: 15_000}).toBe('release-ready')
  const after = await read()
  expect(after.selection).toBeGreaterThan(0)
  expect(after.runtime.interaction.chatMedia.participants).toHaveLength(1)
  expect(after.runtime.interaction.chatMedia.scenes).toHaveLength(1)
  expect(after.runtime.presentation.assets).toHaveLength(2)
  expect(after.runtime.presentation.cues).toEqual([])
  expect(after.world).toBe(f.world); expect(after.releases).toBe(0)
  expect(externalCalls).toBe(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(selection).toHaveCount(0)
  expect(await read()).toEqual(after)
  expect(externalCalls).toBe(0)
})
