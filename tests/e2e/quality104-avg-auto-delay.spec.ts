import { expect, test, type Page } from '@playwright/test'

async function runtimeEvidence(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { readProductRuntimeState } = await load('/storyforge/src/lib/product/runtime-core.ts') as typeof import('../../src/lib/product/runtime-core')
    const state = await readProductRuntimeState(id)
    const events = await db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence')
    return { history: state.avgReading?.history, beats: events.filter(event => event.type === 'presentation.beat.reached') }
  }, sessionId)
}

test('reader delay reaches real runtime events and survives refresh without restarting auto', async ({ page }) => {
  let modelCalls = 0
  await page.route('**/chat/completions', async route => { modelCalls++; await route.abort() })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    if (!localStorage.getItem('storyforge.avg.reader-preferences.v1')) {
      localStorage.setItem('storyforge.avg.reader-preferences.v1', JSON.stringify({ version: 1, reducedMotion: true, autoDelayMs: 4000 }))
    }
  })
  await page.goto('./avg/library')
  const owner = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { seedAvgNativePreview } = await load('/storyforge/tests/helpers/avg-native-fixture.ts') as typeof import('../helpers/avg-native-fixture')
    const { avgReadingFixture } = await load('/storyforge/tests/helpers/avg-reading-fixture.ts') as typeof import('../helpers/avg-reading-fixture')
    const { createProductRuntimeInstance } = await load('/storyforge/src/lib/product/runtime-instances.ts') as typeof import('../../src/lib/product/runtime-instances')
    const prepared = await seedAvgNativePreview(undefined, [], avgReadingFixture({ autoDelayMs: 200, voices: [] }))
    const session = await createProductRuntimeInstance({ scope: prepared.scope, kind: 'avg', title: '阅读余量独立测试',
      productSource: { kind: 'build', productBuildId: prepared.buildId, expectedPreviewHash: prepared.preview.previewHash } })
    return { scope: prepared.scope, sessionId: session.id!, buildId: prepared.buildId, previewHash: prepared.preview.previewHash }
  })
  await page.goto(`./avg/play?project=${owner.scope.projectId}&work=${owner.scope.workId}&session=${owner.sessionId}`)
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  const auto = page.getByRole('button', { name: '自动播放', exact: true })
  const beforeAuto = await page.evaluate(() => Date.now())
  await auto.click()
  // Exact 0/100/4000 boundaries are covered with a controlled component clock.
  // This native check crosses the old 650 ms bug using actual UI/IndexedDB.
  await page.waitForTimeout(900)
  expect((await runtimeEvidence(page, owner.sessionId)).beats).toHaveLength(0)
  await expect.poll(async () => (await runtimeEvidence(page, owner.sessionId)).beats.length, { timeout: 6000 }).toBe(1)
  const first = await runtimeEvidence(page, owner.sessionId)
  expect(first.beats[0].createdAt - beforeAuto).toBeGreaterThanOrEqual(4000)
  expect(first.history).toMatchObject([{ kind: 'line', lineKey: 'line.desk', voiceOutcome: 'unvoiced' }])

  await auto.click()
  await page.getByRole('button', { name: '检查封口', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await page.locator('.avg-settings summary').click()
  const delay = page.getByRole('slider', { name: '自动阅读余量', exact: true })
  await expect(delay).toHaveValue('4000')
  await delay.press('Home'); await delay.press('ArrowRight')
  await expect(delay).toHaveValue('100')
  await page.locator('.avg-settings summary').click()
  await auto.click()
  await expect.poll(async () => (await runtimeEvidence(page, owner.sessionId)).beats.length).toBe(2)
  expect((await runtimeEvidence(page, owner.sessionId)).history).toHaveLength(3)

  await page.reload()
  await expect(auto).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.avg-settings summary').click()
  await expect(delay).toHaveValue('100')
  expect((await runtimeEvidence(page, owner.sessionId)).beats).toHaveLength(2)
  const retainedHash = await page.evaluate(async buildId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return (await db.productBuilds.get(buildId))?.previewHash
  }, owner.buildId)
  expect(retainedHash).toBe(owner.previewHash)
  expect(modelCalls).toBe(0)
})
