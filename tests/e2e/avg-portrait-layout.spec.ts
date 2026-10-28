import { expect, test } from '@playwright/test'

for (const scene of [{ actorCount: 1, cover: null }, { actorCount: 2, cover: null },
  { actorCount: 1, cover: 'cg' }, { actorCount: 1, cover: 'overlay' }] as const) {
  const { actorCount, cover } = scene
  test(`portrait foreground with ${actorCount} actors and ${cover ?? 'no cover'} retains the art frame and runtime state across rotation`, async ({ page }, info) => {
    test.setTimeout(90_000)
    const writes: string[] = []
    await page.route('**/*', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort() }
      return route.continue()
    })
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await page.goto('./avg/library')
    await page.getByRole('button', { name: '新建 AVG', exact: true }).waitFor()
    const owned = await page.evaluate(async ({ count, cover }) => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [fixture, systems, runtime, blobs] = await Promise.all([load('/storyforge/tests/helpers/avg-native-fixture.ts'),
        load('/storyforge/tests/helpers/avg-system-fixture.ts'), load('/storyforge/src/lib/product/runtime-instances.ts'),
        load('/storyforge/src/lib/product-production/media-blob-store.ts')])
      const plan = systems.avgSystemFixture(), media: any[] = [], cues: any[] = []
      if (count === 2) plan.characters.push({ key: 'courier', displayName: '测试来客' })
      const add = async (key: string, kind: string, width: number, height: number, drawing: string, character: string) => {
        const data = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${drawing}</svg>`).buffer
        const contentHash = await blobs.sha256MediaData(data)
        const asset = { assetKey: key, version: 1, kind, name: key, contentHash, blobContentHash: contentHash,
          mimeType: 'image/svg+xml', byteSize: data.byteLength, width, height, durationMs: null,
          source: 'controlled-native-viewport-fixture', license: 'CC0 original test geometry', altText: key,
          characterTag: character, sceneTag: 'desk' }
        media.push({ asset, data }); return asset
      }
      const background = await add('viewport.background', 'background', 400, 300,
        '<rect width="400" height="300" fill="#274455"/><path d="M0 0h60v60H0zM340 240h60v60h-60z" fill="#eec66a"/><path d="M340 0h60v60h-60zM0 240h60v60H0z" fill="#a8d4b9"/>', '')
      cues.push({ cueKey: 'viewport.bg', beatKey: 'line.desk', type: 'set-background', assetKey: background.assetKey,
        phase: 'before', durationMs: 0, order: 1, easing: 'linear' })
      for (const [index, character] of ['keeper', 'courier'].slice(0, count).entries()) {
        const actor = await add(`viewport.pose.${character}`, 'character-pose', 200, 400,
          `<rect x="50" y="10" width="100" height="380" rx="12" fill="${index ? '#b9c6e9' : '#e9c9ac'}"/>`, character)
        cues.push({ cueKey: `viewport.actor.${character}`, beatKey: 'line.desk', type: 'show-actor',
          actorKey: character, assetKey: actor.assetKey, slot: count === 1 ? 'center' : index ? 'right' : 'left',
          opacity: 1, scale: 1, phase: 'before', durationMs: 0, order: 2 + index, easing: 'linear' })
      }
      if (cover) {
        const foreground = await add(`viewport.cover.${cover}`, cover === 'cg' ? 'cg' : 'ui', 400, 300,
          '<rect width="400" height="300" fill="#48566b"/><rect x="20" y="20" width="360" height="260" fill="none" stroke="#f7f0dd" stroke-width="8"/>', '')
        cues.push({ cueKey: 'viewport.cover', beatKey: 'line.desk', type: cover === 'cg' ? 'show-cg' : 'set-overlay',
          assetKey: foreground.assetKey, phase: 'before', durationMs: 0, order: 10, easing: 'linear' })
      }
      // The helper explicitly controls Preview freezing; no provider, artistic
      // quality, real producer or author media acceptance is claimed here.
      const s = await fixture.seedAvgNativePreview(plan, media, undefined, cues)
      const session = await runtime.createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '竖屏布局工程场景',
        productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
      return { scope: s.scope, sessionId: session.id, previewHash: s.preview.previewHash }
    }, { count: actorCount, cover })
    await page.goto(`./avg/play?project=${owned.scope.projectId}&work=${owned.scope.workId}&session=${owned.sessionId}`)
    await expect(page.locator('.avg-actor')).toHaveCount(actorCount)
    await expect.poll(() => page.locator('.avg-actor img').evaluateAll((images: HTMLImageElement[]) => images.every(image => image.complete && image.naturalWidth === 200))).toBe(true)
    await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
    const narrative = () => page.evaluate(async id => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative
    }, owned.sessionId)
    const before = await narrative()
    await page.setViewportSize({ width: 390, height: 844 })
    const art = await page.locator('.avg-stage-scene').boundingBox()
    expect(art!.width / art!.height).toBeCloseTo(16 / 9, 2)
    expect((await page.locator('.avg-dialogue').boundingBox())!.y).toBeGreaterThanOrEqual(art!.y + art!.height)
    await expect(page.locator('.avg-stage-scene')).toHaveAttribute('data-actor-count', String(actorCount))
    await expect(page.locator('.avg-stage-scene')).toHaveAttribute('data-character-layout', cover ? 'framed' : 'portrait-expanded')
    const portrait = await page.locator('.avg-actor img').evaluateAll((images: HTMLImageElement[]) => images.map(image => {
      const box = image.getBoundingClientRect(), scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
      return { width: box.width, height: image.naturalHeight * scale, viewport: innerWidth, viewportHeight: innerHeight }
    }))
    for (const actor of portrait) {
      if (cover) expect(actor.height).toBeLessThanOrEqual(art!.height)
      else expect(actor.height).toBeGreaterThan(actor.viewportHeight * .4)
      if (actorCount === 2) expect(actor.width).toBeLessThan(actor.viewport * .7)
    }
    await expect(page.locator('.avg-background img')).toHaveCSS('object-fit', 'contain')
    if (cover) await expect(page.locator(`.avg-${cover} img`)).toHaveCSS('object-fit', 'contain')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`portrait-${actorCount}-actors-${cover ?? 'plain'}.png`) })
    await page.setViewportSize({ width: 700, height: 390 })
    await expect(page.locator('.avg-background img')).toHaveCSS('object-fit', 'cover')
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.locator('.avg-background img')).toHaveCSS('object-fit', 'cover')
    expect(await narrative()).toEqual(before)
    expect(writes).toEqual([])
  })
}
