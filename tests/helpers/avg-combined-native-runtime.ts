import { expect, type Page, type TestInfo } from '@playwright/test'
import { combinedProductionUrl } from './avg-combined-native-media-fixture'

type Owner = { projectId: number; worldId: number; workId: number }

export async function assertCombinedToolbarInViewport(page: Page) {
  const nav = page.getByRole('navigation', { name: '游玩控制', exact: true })
  await expect(nav.getByRole('button', { name: '返回制作台', exact: true })).toBeVisible()
  await expect(nav.getByRole('button', { name: '物品与证据', exact: true })).toBeVisible()
  const controls = nav.locator(':scope > button, :scope > details > summary')
  await expect(controls).toHaveCount(10)
  // Negative left overflow is invisible to document.scrollWidth. Check every
  // initial center before Playwright can scroll an offscreen button into view.
  for (const control of await controls.all()) {
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
        && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
  }
}

export async function observeCombinedNativeAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as any
    w.__avgCombinedAudio = []
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if ((this as HTMLElement).dataset.channel) for (const kind of ['playing', 'ended']) {
        this.addEventListener(kind, event => {
          w.__avgCombinedAudio.push({ kind, channel: (this as HTMLElement).dataset.channel, trusted: event.isTrusted,
            duration: this.duration, currentTime: this.currentTime, volume: this.volume, rate: this.playbackRate,
            loop: this.loop, muted: this.muted,
            active: Array.from(document.querySelectorAll<HTMLAudioElement>('audio[data-channel]'))
              .filter(a => !a.paused && !a.ended && a.readyState > 0).map(a => a.dataset.channel),
          })
        }, { once: true })
      }
      return original.call(this)
    }
  })
}

export async function finishCombinedVoice(page: Page, sessionId: number) {
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [runtime, reading] = await Promise.all([load('/storyforge/src/lib/product/runtime-core.ts'), load('/storyforge/src/lib/avg/reading-runtime.ts')])
    const state = await runtime.readProductRuntimeState(id), line = reading.avgCurrentReadingLineV1(state), current = state.avgReading.current
    return current?.lineKey === line?.beat.beatKey && current?.visit === line?.visit ? current : null
  }, sessionId)
  const retry = page.getByRole('button', { name: '重试配音', exact: true })
  // A restored ended receipt owns completion; its fresh DOM element must stay
  // unplayed. New requests still require actual playback or explicit recovery.
  await expect.poll(async () => (await read())?.status === 'ended' || await retry.isVisible() || await page.locator('audio[data-channel="voice"]')
    .evaluateAll((rows: HTMLAudioElement[]) => rows.some(a => !a.paused || a.ended))).toBe(true)
  if ((await read())?.status !== 'ended' && await retry.isVisible()) await retry.click()
  await expect.poll(read, { timeout: 15_000 }).toMatchObject({ status: 'ended', playedMs: 4000 })
}

export async function finishCombinedRoute(page: Page, scenes: Array<{ text: string }>, voice: boolean) {
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  expect(sessionId).toBeGreaterThan(0)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  if (await page.locator('.avg-dialogue p').textContent() === scenes[0].text) {
    if (voice) await finishCombinedVoice(page, sessionId)
    await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.getByRole('button', { name: '继续保管', exact: true }).click()
  }
  await expect(page.locator('.avg-dialogue p')).toHaveText(scenes[1].text)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, sessionId)).toBe(true)
  return sessionId
}

export async function publishCombinedPreview(page: Page, scope: Owner) {
  const publicationWaitMs = process.env.CI ? 180_000 : 60_000
  await page.goto(combinedProductionUrl(scope))
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await panel.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await panel.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await expect(panel.getByText(/完整路线：已确认/)).toBeVisible()
  await panel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60_000 })
  await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '本地原型版本已准备' })).toBeVisible({ timeout: publicationWaitMs })
  await expect(panel.getByRole('button', { name: '确认保存本地原型版本', exact: true })).toBeDisabled()
  await panel.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await panel.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await expect(panel.getByText('此版本已冻结；后续修改请创建新 Build。', { exact: true })).toBeVisible({ timeout: publicationWaitMs })
  return panel
}

export async function readCombinedRelease(page: Page, scope: Owner, releaseUid?: string) {
  return page.evaluate(async ({ scope, releaseUid }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, packages, modules, media, hashing, config, files] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/product-production/runtime-package.ts'), load('/storyforge/src/lib/avg/executable-module.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts'),
      load('/storyforge/src/stores/ai-config.ts'), load('/storyforge/src/lib/export/json-export.ts')])
    const builds = await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'), build = builds.at(-1)
    const releases = await db.productReleases.where('workId').equals(scope.workId).toArray()
    const record = releaseUid ? releases.find((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === releaseUid)
      : releases.find((r: any) => r.id === build.releasedProductReleaseId)
    if (!record) throw new Error('Exact original combined Release missing')
    const manifest = await packages.verifyProductReleaseManifest(record.manifestJson), assets = modules.avgRuntimeStage(manifest.runtimePackage).assets
    const hashes = []
    for (const asset of assets) hashes.push({ assetKey: asset.assetKey,
      hash: await hashing.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: record.id, asset })) })
    const gates = await db.productQualityGateReceipts.where('buildId').equals(build.id).toArray()
    const measured = gates.find((r: any) => JSON.parse(r.receiptJson).verifierId === 'storyforge.browser-media-runtime')
    return { backup: await files.exportProjectJSON(scope.projectId), expected: {
      scope, releaseId: record.id, releaseUid: manifest.lineage.releaseUid, manifestJson: record.manifestJson,
      assets, hashes, hasKey: !!config.useAIConfigStore.getState().config.apiKey,
      nativeMedia: measured ? JSON.parse(JSON.parse(measured.receiptJson).measuredJson) : null,
      buildId: build.id, buildNumber: build.buildNumber, frozenQA: JSON.parse(build.qualityReportJson).releaseReady,
    } }
  }, { scope, releaseUid })
}

export async function assertCombinedImageConsumers(page: Page, templates: any[], expression = false) {
  const [background, pose, face, icon, detail] = templates.map(t => t.parameters)
  const character = expression ? face : pose
  await expect(page.locator('.avg-background img')).toHaveAttribute('alt', background.altText)
  await expect.poll(() => page.locator('.avg-background img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(background.width)
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt', character.altText)
  await expect.poll(() => page.locator('.avg-actor img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(character.width)
  await page.getByRole('button', { name: '物品与证据', exact: true }).click()
  const inventory = page.getByRole('dialog', { name: '物品与证据', exact: true })
  await expect.poll(() => inventory.locator('nav img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(icon.width)
  await expect.poll(() => inventory.locator('.avg-inventory-detail-image').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(detail.width)
  await inventory.getByRole('button', { name: '关闭', exact: true }).click()
}

export async function assertCombinedAudio(page: Page, sessionId: number, info: TestInfo) {
  try {
    await expect.poll(() => page.evaluate(() => (window as any).__avgCombinedAudio.some((r: any) =>
      ['bgm', 'sfx', 'ambience', 'voice'].every(channel => r.active.includes(channel)))), { timeout: 10_000 }).toBe(true)
  } catch (error) {
    await info.attach('combined-native-playback-failure', { body: JSON.stringify(await page.evaluate(() => ({
      witness: (window as any).__avgCombinedAudio,
      elements: Array.from(document.querySelectorAll<HTMLAudioElement>('audio[data-channel]')).map(a => ({
        channel: a.dataset.channel, paused: a.paused, ended: a.ended, currentTime: a.currentTime,
        duration: a.duration, readyState: a.readyState, muted: a.muted, volume: a.volume,
      })),
    }))), contentType: 'application/json' })
    throw error
  }
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  const readLine = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
    return { voice: state.avgReading.current, nodeKey: state.narrative.currentNodeKey,
      beatKey: state.presentation.currentBeatKey, historyLength: state.avgReading.history.length }
  }, sessionId)
  const before = await readLine()
  await info.attach('combined-native-before-early-advance', { body: JSON.stringify({ before,
    witness: await page.evaluate(() => (window as any).__avgCombinedAudio) }), contentType: 'application/json' })
  expect(before.voice).toMatchObject({ status: 'requested' })
  // The existing UI keeps this control clickable so it can finish typewriter
  // text. Its wait policy refuses movement while speech is playing. Exercise
  // the real click and durable line, rather than inventing a disabled rule.
  await page.getByRole('button', { name: '继续', exact: true }).click()
  const afterEarlyClick = await readLine()
  expect(afterEarlyClick).toEqual(before)
  await expect(page.getByRole('button', { name: '继续保管', exact: true })).not.toBeVisible()
  await finishCombinedVoice(page, sessionId)
  await expect.poll(() => page.evaluate(() => (window as any).__avgCombinedAudio.some((r: any) => r.channel === 'ambience' && r.kind === 'ended')),
    { timeout: 10_000 }).toBe(true)
  const witness = await page.evaluate(() => (window as any).__avgCombinedAudio)
  const preferences = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/src/lib/avg/reader-preferences.ts')).loadAvgReaderPreferencesV1()
  })
  expect(preferences.volume).toBe(.8)
  for (const [channel, cueVolume] of [['bgm', .2], ['sfx', .5], ['ambience', .3], ['voice', 1]] as const) {
    const played = witness.find((r: any) => r.kind === 'playing' && r.channel === channel)
    expect(played).toMatchObject({ kind: 'playing', channel, trusted: true, muted: false, rate: 1 })
    expect(played.volume).toBeCloseTo(cueVolume * preferences.volume * preferences[`${channel}Volume`], 12)
  }
  expect(witness).toContainEqual(expect.objectContaining({ channel: 'voice', kind: 'ended', trusted: true, currentTime: 4 }))
  expect(witness).toContainEqual(expect.objectContaining({ channel: 'ambience', kind: 'playing', loop: false }))
  await info.attach('combined-four-channel-native-playback', { body: JSON.stringify(witness), contentType: 'application/json' })
  // Settled one-shot cues and settled voice must not replay after refresh.
  // Continuous BGM is allowed to restore its goal from the beginning.
  await page.reload()
  await expect.poll(() => page.locator('audio[data-channel="bgm"]').evaluateAll((rows: HTMLAudioElement[]) => rows.some(a => !a.paused))).toBe(true)
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).avgReading.current
  }, sessionId)).toMatchObject({ status: 'ended', playedMs: 4000 })
  const after = await page.evaluate(() => (window as any).__avgCombinedAudio)
  expect(after.filter((r: any) => ['sfx', 'ambience', 'voice'].includes(r.channel))).toEqual([])
}
