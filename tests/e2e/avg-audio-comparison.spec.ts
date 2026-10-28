import { expect, test } from '@playwright/test'

test('native original comparison plays exact bytes, stops on exit and cannot count as processed audition', async ({ page, baseURL }, info) => {
  const remote: string[] = [], origin = new URL(baseURL!).origin
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      remote.push(url.origin); await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const before = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return JSON.stringify(await Promise.all([db.productBuilds.toArray(), db.productBuildArtifacts.toArray(), db.agentRuns.toArray(),
      db.agentRunEvents.toArray(), db.mediaBlobObjects.toArray()]))
  })
  const hashes = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    return (await load('/storyforge/tests/helpers/avg-audio-comparison-browser-fixture.tsx')).mountAvgAudioComparisonFixture()
  })
  expect(hashes.originalHash).not.toBe(hashes.processedHash)
  const panel = page.locator('[data-audio-comparison-fixture]')
  const observation = panel.getByLabel('工程观察数')
  await panel.getByRole('button', { name: '从头审听加工声音', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '加工声音已完整原速播放 1 遍' })).toBeVisible()
  await expect(observation).toHaveText('1')
  await panel.getByRole('button', { name: '打开原始只读对照', exact: true }).click()
  const original = panel.getByLabel('原始版本对照播放器')
  await expect(original).toBeVisible(); await expect(observation).toHaveText('0')
  await expect(panel.getByRole('button', { name: '从头审听加工声音', exact: true })).toHaveCount(0)
  await original.evaluate((audio: HTMLAudioElement) => audio.play())
  await expect.poll(() => original.evaluate((audio: HTMLAudioElement) => audio.ended)).toBe(true)
  expect(await original.evaluate((audio: HTMLAudioElement) => audio.duration)).toBeCloseTo(1, 3)
  await expect(observation).toHaveText('0')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await original.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
  await info.attach('原始只读对照-390', { body: await page.screenshot(), contentType: 'image/png' })
  await original.evaluate((audio: HTMLAudioElement) => { Object.assign(window, { __avgOriginalComparison: audio }); return audio.play() })
  await expect.poll(() => original.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > .05)).toBe(true)
  await panel.getByRole('button', { name: '返回加工候选', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { __avgOriginalComparison: HTMLAudioElement }).__avgOriginalComparison.paused)).toBe(true)
  await expect(original).toHaveCount(0); await expect(observation).toHaveText('0')
  await panel.getByRole('button', { name: '从头审听加工声音', exact: true }).click()
  await expect(observation).toHaveText('1')
  const after = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return JSON.stringify(await Promise.all([db.productBuilds.toArray(), db.productBuildArtifacts.toArray(), db.agentRuns.toArray(),
      db.agentRunEvents.toArray(), db.mediaBlobObjects.toArray()]))
  })
  expect(after).toBe(before); expect(remote).toEqual([])
})
