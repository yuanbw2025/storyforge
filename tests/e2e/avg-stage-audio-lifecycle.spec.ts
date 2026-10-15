import { test, expect, type Page } from '@playwright/test'

async function openSilentReadingFixture(page: Page, repeated = false, channel: 'sfx' | 'voice' = 'sfx') {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    const target = window as unknown as { avgSfxObserved: Array<{ type: string; time: number }> }
    target.avgSfxObserved = []
    for (const type of ['play', 'ended']) document.addEventListener(type, event => {
      if (event.target instanceof HTMLAudioElement && ['sfx','voice'].includes(event.target.dataset.channel ?? '')) {
        target.avgSfxObserved.push({ type, time: event.target.currentTime })
      }
    }, true)
  })
  await page.goto('./avg/library')
  await expect(page.getByRole('button', { name: '新建 AVG', exact: true })).toBeVisible({ timeout: 30_000 })
  const source = await page.evaluate(async ({repeated,channel}) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/tests/helpers/avg-release-fixture.ts')).prepareAvgMediaReleasePreview(async (workspace: any, context: any) => {
      delete workspace.presentation.reading
      const audio = await (await load('/storyforge/tests/helpers/avg-reading-fixture.ts')).avgReadingAudioFixture(700)
      const asset = await (await load('/storyforge/src/lib/avg/editor-service.ts')).importAvgMediaForAssemblyV1({ scope: context.scope,
        name: '无配音协调的一次性声音测试', kind: channel, data: audio.data, mimeType: 'audio/wav', license: 'CC0-1.0 原创校准音', altText: '', characterTag: '' })
      workspace.presentation.stage.assets.push(asset)
      const add = (cueKey: string, beatKey: string, phase: string, type = 'play-audio', durationMs = 0) =>
        workspace.presentation.stage.cues.push({ cueKey, beatKey, phase, type, durationMs, order: type === 'wait' ? 21 : 20, easing: 'linear',
          ...(type === 'play-audio' ? { assetKey: asset.assetKey, volume: .4, loop: false } : {}) })
      add('sfx.first', 'line.dark', 'before')
      if (repeated) {
        const line = workspace.scripts[0].lines[0]
        workspace.scripts[0].lines.push({ ...line, lineKey: 'line.plain', beatKey: 'line.plain', text: '这一句没有音效。' },
          { ...line, lineKey: 'line.sound', beatKey: 'line.sound', text: '这一句再次播放同一音效。' })
        add('sfx.after', 'line.dark', 'after')
        add('hold.after', 'line.dark', 'after', 'wait', 1100)
        add('sfx.next', 'line.sound', 'before')
      }
    })
  }, {repeated,channel})
  await page.goto(`./avg/play?project=${source.scope.projectId}&work=${source.scope.workId}&session=${source.sessionId}`)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await expect.poll(() => page.locator(`audio[data-channel="${channel}"]`).evaluate((audio: HTMLAudioElement) => audio.ended)).toBe(true)
  return source
}

async function observed(page: Page) {
  return page.evaluate(() => (window as unknown as { avgSfxObserved: Array<{ type: string }> }).avgSfxObserved.map(item => item.type))
}

for (const channel of ['sfx','voice'] as const) test(`native AVG without reading coordinates distinct same-clip ${channel} cues and removes historical one-shots on an uncued line`, async ({ page }) => {
  await openSilentReadingFixture(page, true, channel)
  expect((await observed(page)).filter(type => type === 'ended')).toHaveLength(1)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(async () => (await observed(page)).filter(type => type === 'ended').length).toBe(2)
  await expect(page.locator('.avg-dialogue p')).toHaveText('这一句没有音效。')
  await expect(page.locator(`audio[data-channel="${channel}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('这一句再次播放同一音效。')
  await expect.poll(async () => (await observed(page)).filter(type => type === 'ended').length).toBe(3)
})

test('opening and closing a menu after a non-looping clip ended does not replay that old sound', async ({ page }) => {
  await openSilentReadingFixture(page)
  const initial = await observed(page)
  expect(initial.filter(type => type === 'ended')).toHaveLength(1)
  await page.getByRole('button', { name: '历史', exact: true }).click()
  await page.getByRole('dialog', { name: '历史回看' }).getByRole('button', { name: '关闭', exact: true }).click()
  // A bounded negative observation longer than the real 700ms PCM clip.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 900)))
  expect(await observed(page)).toEqual(initial)
  expect(await page.locator('audio[data-channel="sfx"]').evaluate((audio: HTMLAudioElement) => audio.ended)).toBe(true)
})

test('mute keeps the current music transport and does not recreate an already ended sound on unmute', async ({ page }) => {
  await openSilentReadingFixture(page)
  const initial = await observed(page)
  const music = page.locator('audio[data-channel="bgm"]')
  const originalSrc = await music.getAttribute('src')
  await music.evaluate(element => { (element as HTMLAudioElement).dataset.observedIdentity = 'original-music' })
  await page.locator('summary[aria-label="设置"]').click()
  await page.getByRole('button', { name: '声音', exact: true }).click()
  await expect(page.locator('.avg-stage-status')).toContainText('静音')
  await expect(music).toHaveAttribute('src', originalSrc!)
  await expect(music).toHaveAttribute('data-observed-identity', 'original-music')
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0)
  await page.getByRole('button', { name: '声音', exact: true }).click()
  await page.locator('summary[aria-label="设置"]').click()
  await expect(music).toHaveAttribute('data-observed-identity', 'original-music')
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => !audio.paused && audio.volume > 0)).toBe(true)
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 900)))
  expect(await observed(page)).toEqual(initial)
})
