import { expect, test, type Page, type Locator } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return
  const value = await page.evaluate(() => {
    const state = (window as any).audioTransition
    const node = (el: HTMLAudioElement) => ({ connected: el.isConnected, paused: el.paused, volume: el.volume, muted: el.muted, sourcePresent: !!el.getAttribute('src'), readyState: el.readyState })
    return { old: state ? node(state.old) : null, samples: state?.samples ?? [], revoked: state ? state.revoked.includes(state.url) : null,
      current: [...document.querySelectorAll('[data-testid="ttrpg-open-audio-panel"] article:not([hidden]) audio')].map(el => node(el as HTMLAudioElement)),
      status: [...document.querySelectorAll('[data-testid="ttrpg-open-audio-panel"] [role="status"]')].map(el => el.textContent) }
  }).catch(() => null)
  if (value) await info.attach('audio-transition-native-state', { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
})
async function seed(page: Page, humanGm = true) {
  await page.goto('./')
  return page.evaluate(async humanGm => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-audio-runtime.ts')
    const s = await helper.setupAudioRuntimeV1(humanGm), core = await load('/storyforge/src/lib/product/runtime-core.ts'), state = await core.readProductRuntimeState(s.owner.sessionId)
    return { owner: s.owner, narrationSourceRef: s.narrationSourceRef, text: s.text, fileBytes: Array.from(new Uint8Array(await helper.audioWavFixtureV1().arrayBuffer())),
      beforeEntities: JSON.stringify(state.entities), beforeProduct: JSON.stringify(state.ttrpg.product), beforeTime: JSON.stringify(state.ttrpg.openRun.worldTime) }
  }, humanGm)
}
async function enter(page: Page, sessionId: number, humanGm = true) {
  await page.goto('./play/session/' + sessionId)
  if (humanGm) {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  } else {
    await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  const card = page.getByTestId('ttrpg-open-audio-panel'); await expect(card).toBeVisible({ timeout: 30000 })
  return card
}
async function fill(card: Locator, f: Awaited<ReturnType<typeof seed>>, channel = 'music', audience = 'party', fade = 0) {
  const summary = card.getByText('主持音轨管理', { exact: true })
  if (!await summary.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await summary.click()
  await card.getByLabel('音轨类型', { exact: true }).selectOption(channel)
  if (channel !== 'voice') await card.getByLabel('音轨播放渐入', { exact: true }).selectOption(String(fade))
  await card.getByLabel('音频接收范围', { exact: true }).selectOption(audience)
  await card.getByLabel('音频依据', { exact: true }).selectOption(JSON.stringify(f.narrationSourceRef))
  await card.getByLabel('音频文件', { exact: true }).setInputFiles({ name: '本机音轨.wav', mimeType: 'audio/wav', buffer: Buffer.from(f.fileBytes as number[]) })
  await card.getByLabel('音频来源', { exact: true }).fill('NATIVE-AUDIO-SOURCE-CANARY')
  await card.getByLabel('音频许可', { exact: true }).fill('NATIVE-AUDIO-LICENSE-CANARY；确定性静音样本，仅工程验证。')
  if (channel === 'voice') await card.getByLabel('我已试听并核对音频与上述文字一致。', { exact: true }).check()
  await card.getByRole('button', { name: '保存文件并核对音轨', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-audio-review'); await expect(review).toBeVisible({ timeout: 30000 }); return review
}
async function approve(review: Locator) {
  const button = review.getByRole('button', { name: '确认本次音轨控制', exact: true }); await expect(button).toBeDisabled()
  await review.getByLabel('我已核对文件、文字与接收范围，并确认拥有本次使用许可。', { exact: true }).check(); await button.click()
}
async function inspect(page: Page, id: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
    return { sequence: state.lastSequence, audio: state.ttrpg.openRun.audioReceipts?.length ?? 0, entities: JSON.stringify(state.entities), product: JSON.stringify(state.ttrpg.product),
      time: JSON.stringify(state.ttrpg.openRun.worldTime), assets: await db.productMediaAssets.where('productRuntimeSessionId').equals(id).count(), calls: state.ttrpg.openRun.coordination.calls.length }
  }, id)
}
const currentAudio = (card: Locator) => card.locator('article:not([hidden]) audio')
async function replay(card: Locator) {
  const summary = card.getByText('本桌可读的已保存音轨', { exact: true })
  if (!await summary.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await summary.click()
  await card.getByRole('button', { name: '核对重播', exact: true }).first().click()
  const review = card.getByTestId('ttrpg-open-audio-review'); await expect(review).toBeVisible({ timeout: 30000 })
  await approve(review); await expect(review).toHaveCount(0)
}
async function watchTransition(card: Locator, label = '背景音乐播放') {
  const old = await card.locator('article:not([hidden]) audio').and(card.getByLabel(label, { exact: true })).elementHandle()
  await old!.evaluate((el: HTMLAudioElement) => {
    const state = (window as any).audioTransition = { old: el, url: el.src, samples: [] as any[], revoked: [] as string[] }
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = value => { state.revoked.push(value); revoke(value) }
    el.addEventListener('volumechange', () => {
      const incoming = [...document.querySelectorAll('[data-testid="ttrpg-open-audio-panel"] article:not([hidden]) audio')].find(node => node.getAttribute('aria-label') === el.getAttribute('aria-label')) as HTMLAudioElement | undefined
      if (state.samples.length < 400) state.samples.push({ old: el.volume, oldPaused: el.paused, incoming: incoming !== el ? incoming?.volume : null, incomingPaused: incoming?.paused })
    })
  })
  return old!
}
async function playingFixture(page: Page, fade = 3000) {
  const f = await seed(page), card = await enter(page, f.owner.sessionId), review = await fill(card, f, 'music', 'party', fade)
  await approve(review); await expect(review).toHaveCount(0)
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  const audio = currentAudio(card); await expect(audio).toHaveCount(1, { timeout: 30000 })
  await audio.focus(); await audio.press('Space'); await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.volume), { timeout: 6000 }).toBe(1)
  return { f, card }
}
test('native opted-in background crossfade overlaps actual decoded nodes, releases the old URL and refreshes with follow disabled', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', req => { if (req.url().includes('/chat/completions')) sends++ })
  const { f, card } = await playingFixture(page)
  await expect(card.getByLabel('跟随背景与环境音轨', { exact: true })).not.toBeChecked()
  await card.getByLabel('跟随背景与环境音轨', { exact: true }).check()
  const old = await watchTransition(card); await replay(card)
  await expect.poll(() => page.evaluate(() => (window as any).audioTransition.samples.some((r: any) => !r.oldPaused && r.old > 0 && r.old < 1 && !r.incomingPaused && r.incoming > 0 && r.incoming < 1)), { timeout: 15000 }).toBe(true)
  expect(await old.evaluate(el => el.isConnected && !!el.closest('article')?.hidden)).toBe(true)
  expect(await page.evaluate(() => {
    const old = (window as any).audioTransition.old as HTMLAudioElement
    if (old.paused) return false
    const button = [...document.querySelectorAll('[data-testid="ttrpg-open-audio-panel"] button')].find(node => node.textContent === '重新读取音轨') as HTMLButtonElement
    button.click(); return !old.paused && !!old.getAttribute('src')
  })).toBe(true)
  await expect.poll(() => old.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  expect(await old.evaluate(el => el.getAttribute('src'))).toBeNull()
  expect(await page.evaluate(() => (window as any).audioTransition.revoked.includes((window as any).audioTransition.url))).toBe(true)
  await expect.poll(() => currentAudio(card).evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.reload(); const refreshed = await enter(page, f.owner.sessionId)
  await expect(currentAudio(refreshed)).toHaveCount(0); await expect(refreshed.getByLabel('跟随背景与环境音轨', { exact: true })).not.toBeChecked()
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 2, assets: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime }); expect(sends).toBe(0)
})
test('native reviewed stop fades the retained playing node without follow and local mute stops it immediately', async ({ page }) => {
  test.setTimeout(240000); const { f, card } = await playingFixture(page), old = await watchTransition(card)
  await card.getByLabel('停止音轨渐出', { exact: true }).selectOption('3000')
  await card.getByRole('button', { name: '核对停止背景音乐', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-audio-review'); await expect(review).toContainText('停止时渐出：最多 3 秒')
  await approve(review); await expect(currentAudio(card)).toHaveCount(0, { timeout: 30000 })
  await expect.poll(() => page.evaluate(() => (window as any).audioTransition.samples.some((r: any) => !r.oldPaused && r.old > 0 && r.old < 1))).toBe(true)
  expect(await old.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await card.getByRole('button', { name: '本机静音', exact: true }).click()
  expect(await old.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true); expect(await old.evaluate(el => el.getAttribute('src'))).toBeNull()
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 2, assets: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime })
})
test('native replacement remains manual by default and blocked follow preserves current manual controls without retry', async ({ page }) => {
  test.setTimeout(240000); const { card } = await playingFixture(page, 0), old = await currentAudio(card).elementHandle()
  await replay(card); await expect.poll(() => old!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await expect(currentAudio(card)).toHaveCount(1, { timeout: 30000 }); expect(await currentAudio(card).evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await card.getByLabel('跟随背景与环境音轨', { exact: true }).check()
  await currentAudio(card).focus(); await currentAudio(card).press('Space')
  await expect.poll(() => currentAudio(card).evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play; (window as any).blockedAudioFollow = 0
    HTMLMediaElement.prototype.play = function () { (window as any).blockedAudioFollow++; if ((window as any).blockedAudioFollow === 1) return Promise.reject(new DOMException('ENGINEERING-BLOCKED-FOLLOW', 'NotAllowedError')); return play.call(this) }
  })
  await replay(card); await expect(card).toContainText('旧音轨已停止，新音轨请按播放继续。', { timeout: 30000 })
  await expect(currentAudio(card)).toHaveCount(1); expect(await currentAudio(card).evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  expect(await currentAudio(card).getAttribute('src')).toMatch(/^blob:/)
  await card.getByRole('button', { name: '重新读取音轨', exact: true }).click()
  expect(await page.evaluate(() => (window as any).blockedAudioFollow)).toBe(1)
  await currentAudio(card).focus(); await currentAudio(card).press('Space')
  await expect.poll(() => currentAudio(card).evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
})
test('native identity handoff immediately releases both sides of an active background crossfade', async ({ page }) => {
  test.setTimeout(240000); const { f, card } = await playingFixture(page)
  await card.getByLabel('跟随背景与环境音轨', { exact: true }).check()
  const old = await watchTransition(card); await replay(card)
  await expect.poll(() => page.evaluate(() => (window as any).audioTransition.samples.some((r: any) => !r.oldPaused && r.old > 0 && r.old < 1 && !r.incomingPaused && r.incoming > 0 && r.incoming < 1)), { timeout: 15000 }).toBe(true)
  const incoming = await currentAudio(card).elementHandle()
  expect(await old.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  for (const node of [old, incoming!]) { expect(await node.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true); expect(await node.evaluate(el => el.getAttribute('src'))).toBeNull() }
  const player = await enter(page, f.owner.sessionId, false)
  await expect(currentAudio(player)).toHaveCount(0); await expect(player.getByLabel('跟随背景与环境音轨', { exact: true })).not.toBeChecked()
  await expect(player).not.toContainText('NATIVE-AUDIO-LICENSE-CANARY')
})
test('native ambience crossfade preserves the connected playing music node without a pause or restart', async ({ page }) => {
  test.setTimeout(240000); const { f, card } = await playingFixture(page)
  const music = await card.getByLabel('背景音乐播放', { exact: true }).elementHandle()
  await music!.evaluate((el: HTMLAudioElement) => {
    const state = (window as any).unchangedMusic = { pauses: 0, plays: 0 }
    el.addEventListener('pause', () => state.pauses++); el.addEventListener('play', () => state.plays++)
  })
  const review = await fill(card, f, 'ambience', 'party', 3000); await approve(review); await expect(review).toHaveCount(0)
  const ambience = card.getByLabel('环境声播放', { exact: true }); await expect(ambience).toHaveCount(1, { timeout: 30000 })
  await ambience.focus(); await ambience.press('Space'); await expect.poll(() => ambience.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await expect.poll(() => ambience.evaluate((el: HTMLAudioElement) => el.volume), { timeout: 6000 }).toBe(1)
  await card.getByLabel('跟随背景与环境音轨', { exact: true }).check(); const old = await watchTransition(card, '环境声播放')
  const library = card.getByText('本桌可读的已保存音轨', { exact: true }); if (!await library.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await library.click()
  await card.getByRole('button', { name: '核对重播', exact: true }).nth(1).click()
  await approve(card.getByTestId('ttrpg-open-audio-review'))
  await expect.poll(() => page.evaluate(() => (window as any).audioTransition.samples.some((r: any) => !r.oldPaused && r.old > 0 && r.old < 1 && !r.incomingPaused && r.incoming > 0 && r.incoming < 1)), { timeout: 15000 }).toBe(true)
  await expect.poll(() => old.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  expect(await music!.evaluate((el: HTMLAudioElement) => el.isConnected && !el.paused && el.volume === 1)).toBe(true)
  expect(await page.evaluate(() => (window as any).unchangedMusic)).toEqual({ pauses: 0, plays: 0 })
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 3, assets: 2, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime })
})
test('native manual file review retries storage once, really decodes/plays, reloads silently and stops private playback on identity handoff', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', req => { if (req.url().includes('/chat/completions')) sends++ })
  const f = await seed(page); let card = await enter(page, f.owner.sessionId)
  await expect(card.locator('audio')).toHaveCount(0)
  const review = await fill(card, f, 'music', 'gm-only', 1000); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  await expect(review).toContainText('播放时渐入：1 秒')
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => { if (row.type === 'ttrpg.audio.cue.applied') { db.productRuntimeEvents.add = add; throw new Error('NATIVE-AUDIO-STORAGE-CUT') } return add(row, ...args) }
  })
  await approve(review); await expect(card.getByRole('alert')).toBeVisible(); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  await expect(review.getByRole('checkbox')).toBeChecked(); await review.getByRole('button', { name: '确认本次音轨控制', exact: true }).click()
  await expect(review).toHaveCount(0); await expect(card).toContainText('音轨控制已保存')
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  const audio = card.locator('audio'); await expect(audio).toHaveCount(1, { timeout: 30000 })
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0)
  const node = await audio.elementHandle()
  await audio.evaluate((el: HTMLAudioElement) => { (window as any).audioFadeSamples = []; el.addEventListener('volumechange', () => (window as any).audioFadeSamples.push(el.volume)) })
  await audio.focus(); await audio.press('Space')
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await expect.poll(() => page.evaluate(() => (window as any).audioFadeSamples.some((v: number) => v > 0 && v < 1))).toBe(true)
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.volume)).toBe(1)
  await audio.press('Space'); await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await audio.evaluate((el: HTMLAudioElement) => { el.currentTime = 0.125 })
  await card.getByRole('button', { name: '本机静音', exact: true }).click(); await expect(audio).toHaveCount(0); expect(await node!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click(); await expect(card.locator('audio')).toHaveCount(1, { timeout: 30000 })
  await expect.poll(() => card.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(0.125, 2)
  expect(await card.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await page.reload(); card = await enter(page, f.owner.sessionId); await expect(card.locator('audio')).toHaveCount(0)
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click(); await expect(card.locator('audio')).toHaveCount(1, { timeout: 30000 })
  const privateNode = await card.locator('audio').elementHandle(); await card.locator('audio').focus(); await card.locator('audio').press('Space')
  await expect.poll(() => card.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  expect(await privateNode!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  card = await enter(page, f.owner.sessionId, false); await expect(card.locator('audio')).toHaveCount(0)
  await expect(card).not.toContainText('NATIVE-AUDIO-LICENSE-CANARY'); await expect(card).not.toContainText('NATIVE-AUDIO-SOURCE-CANARY')
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 1, assets: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime }); expect(sends).toBe(0)
})
test('native pending upload is not confirmed by reload; mobile child retains exact audio bytes after parent deletion and complete backup', async ({ page }, info) => {
  test.setTimeout(240000); const f = await seed(page); let card = await enter(page, f.owner.sessionId)
  await fill(card, f); await page.reload(); card = await enter(page, f.owner.sessionId)
  await expect(card.getByTestId('ttrpg-open-audio-review')).toHaveCount(0); expect((await inspect(page, f.owner.sessionId)).audio).toBe(0)
  const review = await fill(card, f); await approve(review); await expect(review).toHaveCount(0)
  const child = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await core.readProductRuntimeState(owner.sessionId), child = await core.branchProductRuntimeSession({ parentSessionId: owner.sessionId, throughSequence: state.lastSequence, title: 'audio native child' })
    const before = await core.readProductRuntimeState(child.id), version = await core.readProductRuntimeStateVersion(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({ sessionId: child.id, commandId: 'native.audio.child.zero', baseSequence: version.sequence, baseStateHash: version.stateHash,
      viewerKey: owner.viewerKey, acceptedItemKeys: before.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await core.deleteProductRuntimeSession(owner.sessionId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return { sessionId: copy.id, assets: await db.productMediaAssets.where('productRuntimeSessionId').equals(copy.id).count() }
  }, f.owner)
  expect(child.assets).toBe(1); await page.setViewportSize({ width: 390, height: 844 }); card = await enter(page, child.sessionId)
  await expect(card.locator('audio')).toHaveCount(0); await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  await expect(card.locator('audio')).toHaveCount(1, { timeout: 30000 }); await expect.poll(() => card.locator('audio').evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await card.screenshot({ path: info.outputPath('audio-child-mobile.png') })
})
test('native AI-host common voice binds the accepted script, hides private controls and falls back to text on corrupt bytes', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', req => { if (req.url().includes('/chat/completions')) sends++ })
  const f = await seed(page, false), card = await enter(page, f.owner.sessionId, false), review = await fill(card, f, 'voice')
  await expect(card.getByLabel('音频接收范围', { exact: true })).toHaveCount(0)
  await expect(review).toContainText(f.text); await approve(review); await expect(review).toHaveCount(0)
  await expect(card.getByLabel('音频接收范围', { exact: true }).locator('option[value="gm-only"]')).toHaveCount(0)
  await expect(card.getByLabel('音频接收范围', { exact: true }).locator('option[value="private"]')).toHaveCount(0)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), object = await db.mediaBlobObjects.toCollection().first()
    await db.mediaBlobObjects.update(object.id, { data: new Uint8Array([0]).buffer })
  })
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  await expect(card).toContainText('音频不可用，已保留文字说明。', { timeout: 30000 }); await expect(card.locator('audio')).toHaveCount(0); await expect(card).toContainText(f.text)
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ audio: 1, calls: 0, entities: f.beforeEntities, product: f.beforeProduct, time: f.beforeTime }); expect(sends).toBe(0)
})
test('native caption seeks and follows the exact original timeline inside its own box without playing or changing the game', async ({ page }) => {
  test.setTimeout(240000); await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-audio-runtime.ts'), api = await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')
    const prefix = '门口留有明确的巡逻痕迹。'.repeat(160), ending = '最后一段：你们已经确认线索。', text = prefix + ending
    const s = await helper.setupAudioRuntimeV1(true, text), request = s.request('native.caption.timeline', 'voice', 'party')
    request.voiceTimeline.marks = [{ textOffset: 0, textLength: prefix.length, startMs: 0, durationMs: 4000 }, { textOffset: prefix.length, textLength: ending.length, startMs: 4000, durationMs: 4000 }]
    const review = await api.prepareTtrpgOpenAudioUploadV1({ ...s.owner, request, file: helper.audioWavFixtureV1(8000), name: '工程字幕样本.wav', source: 'deterministic silent file, explicit test timeline', license: 'engineering fixture only', durationMs: 8000, decision: 'prepare-this-file-for-reviewed-audio' })
    await api.confirmTtrpgOpenAudioReviewV1({ ...s.owner, review, decision: 'confirm-this-audio-and-audience' })
    return { sessionId: s.owner.sessionId, text, ending }
  })
  const before = await inspect(page, seeded.sessionId), card = await enter(page, seeded.sessionId)
  await card.getByRole('button', { name: '开启本机音频', exact: true }).click()
  const audio = card.locator('audio'); await expect(audio).toHaveCount(1, { timeout: 30000 }); await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBe(8)
  const pageY = await page.evaluate(() => scrollY)
  await audio.evaluate((el: HTMLAudioElement) => { el.currentTime = 5 })
  await expect(card.getByTestId('ttrpg-audio-caption-active')).toHaveText(seeded.ending)
  const caption = card.getByLabel('配音字幕', { exact: true }); await expect(caption).toHaveText(seeded.text)
  await expect.poll(() => caption.evaluate(el => el.scrollTop)).toBeGreaterThan(0); expect(await page.evaluate(() => scrollY)).toBe(pageY)
  await card.getByRole('button', { name: '回到本段开头', exact: true }).click(); await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(4)
  await card.getByRole('button', { name: '上一段字幕', exact: true }).click(); await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(0)
  expect(await audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
  await card.getByRole('button', { name: '本机静音', exact: true }).click(); await expect(audio).toHaveCount(0); await expect(caption).toHaveText(seeded.text)
  expect(await inspect(page, seeded.sessionId)).toEqual(before)
})


test('native voice intent survives a real IndexedDB reload and cancels without model, media or time effects', async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page), card = await enter(page, f.owner.sessionId)
  await expect(currentAudio(card)).toHaveCount(0)
  const before = await inspect(page, f.owner.sessionId)
  const key = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const audio = await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')
    const review = await audio.prepareTtrpgOpenVoiceScriptV1({ ...f.owner, narrationSourceRef: f.narrationSourceRef,
      audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
    const result = await audio.reserveTtrpgOpenVoiceRequestV1({ ...f.owner, review, submissionKey: 'native.original.voice-intent',
      part: { textOffset: 0, textLength: f.text.length }, decision: 'reserve-this-original-voice-part' })
    return result.requestKey as string
  }, f)
  await page.reload()
  const result = await page.evaluate(async ({ f, key }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const audio = await load('/storyforge/src/lib/ttrpg/open-audio-service.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const desk = await audio.readTtrpgOpenVoiceRequestDeskV1(f.owner)
    const cancellation = await audio.cancelTtrpgOpenVoiceRequestV1({ ...f.owner, requestKey: key, decision: 'cancel-this-unsent-voice-request' })
    const again = await audio.cancelTtrpgOpenVoiceRequestV1({ ...f.owner, requestKey: key, decision: 'cancel-this-unsent-voice-request' })
    return { desk, cancellation, again, final: await audio.readTtrpgOpenVoiceRequestDeskV1(f.owner),
      modelEvents: (await db.agentRunEvents.toArray()).filter((e: any) => ['model.requested', 'tool.called'].includes(e.type)).length }
  }, { f, key })
  expect(result.desk.requests[0].script.text).toBe(f.text)
  expect(result.desk.budget).toMatchObject({ requests: 1, characters: f.text.length })
  expect(result.final.requests[0].status).toBe('cancelled-before-send')
  expect(result.final.budget).toEqual(result.desk.budget)
  expect(result.again).toEqual(result.cancellation); expect(result.modelEvents).toBe(0)
  const after = await inspect(page, f.owner.sessionId)
  expect(after.sequence).toBe(before.sequence + 2)
  expect({ ...after, sequence: 0 }).toEqual({ ...before, sequence: 0 })
})
