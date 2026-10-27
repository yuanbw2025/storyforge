import { expect, test, type Page } from '@playwright/test'
import { assertCombinedToolbarInViewport, finishCombinedRoute, finishCombinedVoice } from '../helpers/avg-combined-native-runtime'

/** Exercise the route helper at actual reading boundaries before the costly
 * nine-media producer. This seeds public author fixtures, never a model call. */
async function prepare(page: Page, voiced: boolean, withInventory = false) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge.avg.reader-preferences.v1', JSON.stringify({ version: 1, textSpeed: 5, reducedMotion: false }))
  })
  await page.goto('./avg/library')
  const owned = await page.evaluate(async ({ voiced, withInventory }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [native, reading, rules, runtime] = await Promise.all([load('/storyforge/tests/helpers/avg-native-fixture.ts'),
      load('/storyforge/tests/helpers/avg-reading-fixture.ts'), load('/storyforge/tests/helpers/avg-system-fixture.ts'),
      load('/storyforge/src/lib/product/runtime-instances.ts')])
    const plan = withInventory ? (await load('/storyforge/tests/helpers/avg-inventory-fixture.ts')).avgInventoryFixture() : rules.avgSystemFixture()
    plan.actions.find((a: { key: string }) => a.key === 'wait').label = '继续保管'
    const audio = voiced ? await reading.avgReadingAudioFixture(4000) : null
    const source = await native.seedAvgNativePreview(plan, audio ? [audio] : [], voiced ? reading.avgReadingFixture() : undefined)
    const session = await runtime.createProductRuntimeInstance({ scope: source.scope, kind: 'avg', title: '路线恢复辅助流程工程回归',
      productSource: { kind: 'build', productBuildId: source.buildId, expectedPreviewHash: source.preview.previewHash } })
    return { scope: source.scope, sessionId: session.id }
  }, { voiced, withInventory })
  await page.goto(`./avg/play?project=${owned.scope.projectId}&work=${owned.scope.workId}&session=${owned.sessionId}${withInventory ? '&assembly=1' : ''}`)
  await expect(page.locator('.avg-text-cursor')).toBeAttached()
  return owned
}
async function readVoice(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [runtime, { db }] = await Promise.all([load('/storyforge/src/lib/product/runtime-core.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const state = await runtime.readProductRuntimeState(id)
    return { current: state.avgReading?.current ?? null, history: state.avgReading?.history ?? [],
      starts: await db.productRuntimeEvents.where('sessionId').equals(id).filter((e: { type: string }) => e.type === 'avg.reading.voice.started').count() }
  }, sessionId)
}
const scenes = [{ text: '封口仍在。' }, { text: '你把信封放回桌上。' }]

for (const width of [320, 390]) {
  test(`mobile combined toolbar keeps all ten controls reachable with inventory and workbench return at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await prepare(page, false, true)
    await assertCombinedToolbarInViewport(page)
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const node = document.querySelector(selector)
        if (!node) throw new Error(`Missing actual player region: ${selector}`)
        const r = node.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, width: r.width, height: r.height }
      }
      return { toolbar: box('.avg-toolbar'), stage: box('.avg-stage'), art: box('.avg-stage-scene'), dialogue: box('.avg-dialogue') }
    })
    expect(layout.stage.top).toBeGreaterThanOrEqual(layout.toolbar.bottom)
    expect(layout.stage.height).toBeGreaterThan(844 / 2)
    expect(layout.art.width / layout.art.height).toBeCloseTo(16 / 9, 2)
    expect(layout.dialogue.top).toBeGreaterThanOrEqual(layout.art.bottom)
    expect(layout.dialogue.bottom).toBeLessThanOrEqual(844)
    await page.getByRole('button', { name: '物品与证据', exact: true }).click()
    await page.getByRole('dialog', { name: '物品与证据', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '历史', exact: true }).click()
    await page.getByRole('dialog', { name: '历史回看', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    await assertCombinedToolbarInViewport(page)
    await page.screenshot({ path: info.outputPath(`combined-toolbar-${width}.png`), fullPage: true })
  })
}

test('combined route completion waits for the actual first-line typewriter before choosing the next scene', async ({ page }) => {
  await prepare(page, false)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '检查封口', exact: true }).click()
  await expect(page.locator('.avg-text-cursor')).not.toHaveClass(/is-complete/)
  await finishCombinedRoute(page, scenes, false)
})

test('combined route resumes a real ended voice receipt after refresh without requiring or issuing another playback', async ({ page }) => {
  const owned = await prepare(page, true)
  await finishCombinedVoice(page, owned.sessionId)
  const before = await readVoice(page, owned.sessionId)
  expect(before.current).toMatchObject({ status: 'ended', playedMs: 4000 })
  expect(before.starts).toBeGreaterThanOrEqual(1)
  await page.reload()
  await expect(page.locator('.avg-text-cursor')).toBeAttached()
  const audio = await page.locator('audio[data-channel="voice"]').evaluate((a: HTMLAudioElement) => ({ paused: a.paused, ended: a.ended, time: a.currentTime }))
  expect(audio).toEqual({ paused: true, ended: false, time: 0 })
  expect(await readVoice(page, owned.sessionId)).toEqual(before)
  await finishCombinedRoute(page, scenes, true)
  const after = await readVoice(page, owned.sessionId)
  expect(after.starts).toBe(before.starts)
  expect(after.history[0]).toMatchObject({ voiceOutcome: 'ended', voicePlayedMs: 4000 })
})
