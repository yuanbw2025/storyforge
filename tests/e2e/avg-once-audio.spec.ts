import { expect, test } from '@playwright/test'
import { prepare, snapshot, captured, capturedFrames, musicPlaying } from '../helpers/avg-once-audio-browser-fixture'

test('actual ended 100ms SFX and non-loop ambience survive refresh without replay while loop music restores', async ({ page }, info) => {
  await prepare(page)
  await expect.poll(async () => (await snapshot(page)).receipts.filter((r: { status: string }) => r.status === 'ended').length).toBe(2)
  const before = await snapshot(page), events = await captured(page)
  for (const channel of ['sfx', 'ambience']) {
    expect(events.filter(e => e.channel === channel && e.type === 'playing')).toHaveLength(1)
    expect(events.filter(e => e.channel === channel && e.type === 'ended')).toHaveLength(1)
    expect(events.filter(e => e.channel === channel).every(e => e.trusted)).toBe(true)
  }
  await info.attach('actual-one-shot-ended-before-refresh', { body: JSON.stringify({ before, events }, null, 2), contentType: 'application/json' })
  await page.reload()
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await musicPlaying(page)
  expect(await snapshot(page)).toEqual(before)
  expect((await captured(page)).filter(e => ['sfx', 'ambience'].includes(e.channel) && e.type === 'playing')).toEqual([])
  await page.screenshot({ path: info.outputPath('once-audio-ended-restored.png'), fullPage: true })
})

test('a refreshed in-flight one-shot stays unknown until explicit replay admits a fresh generation', async ({ page }) => {
  await prepare(page, 7000, false)
  await expect.poll(() => page.locator('audio[data-channel="sfx"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
  const before = await snapshot(page)
  expect(before.receipts[0].status).toBe('requested')
  await page.reload()
  await expect(page.getByText('上次声音播放未确认结束。', { exact: true })).toBeVisible()
  await musicPlaying(page)
  expect(await snapshot(page)).toEqual(before)
  expect((await captured(page)).filter(e => e.channel === 'sfx' && e.type === 'playing')).toEqual([])
  await page.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
  await expect.poll(() => page.locator('audio[data-channel="sfx"]').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > .02)).toBe(true)
  await expect.poll(async () => (await snapshot(page)).receipts[0].generation).toBeGreaterThan(before.receipts[0].generation)
  await expect.poll(async () => (await snapshot(page)).receipts[0].status, { timeout: 10_000 }).toBe('ended')
  expect((await snapshot(page)).receipts[0].playedMs).toBe(7000)
})

test('actual decoder failure is durable, never fabricated ended, and explicit retry remains a distinct failed generation', async ({ page }) => {
  await prepare(page, 100, false, true)
  await expect.poll(async () => (await snapshot(page)).receipts[0]?.status).toBe('failed')
  const before = await snapshot(page)
  expect(before.receipts[0].playedMs).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '重新播放声音片段', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: '重新播放声音片段', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).receipts[0].generation).toBeGreaterThan(before.receipts[0].generation)
  await expect.poll(async () => (await snapshot(page)).receipts[0].status).toBe('failed')
  expect((await captured(page)).filter(e => e.channel === 'sfx' && e.type === 'ended')).toEqual([])
})


test('four native channels genuinely overlap with a 100ms SFX after durable playback admission', async ({ page }, info) => {
  await prepare(page, 100, true, false, true)
  try {
    await expect.poll(async () => (await capturedFrames(page)).some(frame => ['bgm', 'ambience', 'sfx', 'voice'].every(channel => frame.channels.some(a => a.channel === channel && !a.paused && !a.ended && a.time > 0 && a.time < a.duration))), { timeout: 10_000 }).toBe(true)
  } finally {
    await info.attach('actual-short-four-channel-playback', { body: JSON.stringify({ state: await snapshot(page), events: await captured(page), frames: await capturedFrames(page) }, null, 2), contentType: 'application/json' })
  }
  expect((await captured(page)).every(event => event.trusted)).toBe(true)
})
