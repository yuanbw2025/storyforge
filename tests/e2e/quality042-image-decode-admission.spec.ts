import { expect, test } from '@playwright/test'

test('042 decodes actual raster pixels and exports the selected comic image; legacy damage stays unreadable', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000)
  if (!baseURL) throw Error('042 requires a local isolated base URL')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw Error('042 refuses external origins and author storage')
  }
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const blocked: string[] = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { blocked.push(request.method() + ' ' + url.origin); await route.abort() }
  })
  await context.addInitScript(appOrigin => {
    if (location.origin === appOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa042-isolated')
  }, origin.origin)
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  try {
    await page.goto('./')
    const receipt = await page.evaluate(async animations => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw Error('042 must use empty IndexedDB')
      const fixture = await load<typeof import('../helpers/sfqa043-comic')>('/storyforge/tests/helpers/sfqa043-comic.ts')
      const images = await load<typeof import('../../src/lib/media/blob-store')>('/storyforge/src/lib/media/blob-store.ts')
      const comic = await load<typeof import('../../src/lib/comic/media-service')>('/storyforge/src/lib/comic/media-service.ts')
      const render = await load<typeof import('../../src/lib/comic/renderers')>('/storyforge/src/lib/comic/renderers.ts')
      const f = await fixture.createSfqa043ComicFixtureV1()
      const seeded = await fixture.addSfqa043MediaAndPageV1(f)
      let panel = (await db.comicPanels.get(seeded.panelId))!
      const decoded = []
      const assetDataUrls: Record<string, string> = {}
      const canvas = document.createElement('canvas')
      canvas.width = 48; canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (!ctx) throw Error('native canvas unavailable')
      ctx.fillStyle = 'rgb(205,42,31)'; ctx.fillRect(0, 0, 48, 64)
      for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          value => value?.type === mimeType ? resolve(value) : reject(Error('native encoding unavailable: ' + mimeType)),
          mimeType, .95,
        ))
        const data = await blob.arrayBuffer()
        const before = await db.comicMediaAssets.count()
        const invalid = await comic.commitUploadedComicAssetV1({
          scope: f.scope, panelId: panel.id!, rights: seeded.panelAsset.rights, data: data.slice(0, -4),
        }).then(() => false, () => true)
        if (!invalid || await db.comicMediaAssets.count() !== before) throw Error('truncated media changed assets')
        const asset = await comic.commitUploadedComicAssetV1({
          scope: f.scope, panelId: panel.id!, rights: seeded.panelAsset.rights, data,
        })
        const stored = await images.readVerifiedMediaBlobV1({ scope: f.scope, blobObjectId: asset.blobObjectId })
        const read = await comic.readComicAssetDataUrlV1({ scope: f.scope, assetKey: asset.stableKey })
        const bitmap = await createImageBitmap(new Blob([stored.data], { type: mimeType }))
        const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1
        const pixels = probe.getContext('2d')!
        try { pixels.drawImage(bitmap, 0, 0, 1, 1) } finally { bitmap.close() }
        decoded.push({ mimeType: stored.mimeType, width: stored.width, height: stored.height,
          pixel: [...pixels.getImageData(0, 0, 1, 1).data],
          sameHash: stored.contentHash === await images.sha256BinaryV1(data) })
        assetDataUrls[asset.stableKey] = read.dataUrl
        panel = await comic.selectComicMediaAssetV1({
          scope: f.scope, panelId: panel.id!, expectedRevision: panel.revision, assetKey: asset.stableKey,
        }) as typeof panel
      }
      const animated = []
      for (const [index, base64] of animations.entries()) {
        const data = Uint8Array.from(atob(base64), value => value.charCodeAt(0)).buffer
        const mimeType = index === 0 ? 'image/png' : 'image/webp'
        const supported = typeof ImageDecoder === 'function' && await ImageDecoder.isTypeSupported(mimeType)
        const outcome = await images.prepareMediaBlobV1(data)
          .then(result => ({ width: result.width, height: result.height, error: null }),
            (error: Error) => ({ width: null, height: null, error: error.message }))
        if (supported) {
          if (outcome.error || outcome.width !== 4 || outcome.height !== 3) throw Error('supported animation failed: ' + outcome.error)
        } else if (!outcome.error?.includes('动画解码能力不可用')) throw Error('unsupported animation did not fail visibly')
        animated.push({mimeType, supported, ...outcome})
      }
      const root = (await db.adaptationProjects.get(f.adaptation.id!))!
      const book: import('../../src/lib/comic/renderers').ComicBookRenderV1 = {
        title: '042 光栅导出', targetSpec: root.targetSpec as import('../../src/lib/types').ComicTargetSpecV1,
        pages: [{ page: seeded.page, panels: [panel], assetDataUrls }],
      }
      const exported = []
      for (const format of ['png-zip', 'webp-zip', 'cbz'] as const) {
        const archive = await render.renderComicArchiveV1({ ...book, format })
        const archiveBytes = new Uint8Array(await archive.arrayBuffer())
        const prefix = [...archiveBytes.subarray(0, 4)]
        const directory = new TextDecoder().decode(archiveBytes)
        const pageEntry = /pages\/\d+\.(png|webp)/.exec(directory)?.[1] ?? null
        exported.push({ format, mimeType: archive.type, size: archive.size, prefix, pageEntry,
          manifestEntry: directory.includes('manifest.json'), comicInfo: directory.includes('ComicInfo.xml') })
      }
      const html = await render.renderComicPrintHtmlV1(book)
      const printImage = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(html)?.[1]
      if (!printImage) throw Error('missing printable page')
      const print = await images.prepareMediaBlobV1(Uint8Array.from(atob(printImage), value => value.charCodeAt(0)).buffer)

      const fake = new Uint8Array(32)
      fake.set([137, 80, 78, 71, 13, 10, 26, 10])
      const header = new DataView(fake.buffer); header.setUint32(16, 1024); header.setUint32(20, 1536)
      await db.mediaBlobObjects.update(seeded.panelAsset.blobObjectId, {
        data: fake.buffer, byteSize: fake.length, width: 1024, height: 1536,
        contentHash: await images.sha256BinaryV1(fake.buffer),
      })
      const error = await comic.readComicAssetDataUrlV1({ scope: f.scope, assetKey: seeded.panelAsset.stableKey })
        .then(() => null, (cause: Error) => cause.message)
      const saved = await db.mediaBlobObjects.get(seeded.panelAsset.blobObjectId)
      return { decoded, animated, exported, print: {width: print.width, height: print.height}, printHtml: html,
        legacy: { error, bytesRetained: saved?.data?.byteLength, owner: saved?.workId, expectedOwner: f.scope.workId } }
    }, ["iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAEAAAAAwAAAAAAAAAAAAEACgAAzHMM+wAAABBJREFUeJxjuCOnAUcMODkAEboNmfVnZD4AAAAaZmNUTAAAAAEAAAAEAAAAAwAAAAAAAAAAAAEACgAAVwDmLwAAABRmZEFUAAAAAnicY5A8EQVHDDg5AB0YDsVni2y7AAAAAElFTkSuQmCC","UklGRsIAAABXRUJQVlA4WAoAAAACAAAAAwAAAgAAQU5JTQYAAAAAAAAAAABBTk1GSAAAAAAAAAAAAAMAAAIAAGQAAAJWUDggMAAAANABAJ0BKgQAAwABABwloAJ0ugH4AAOwAP7xlY/8guWF1yNf/PaPz2j89o/88IAAAEFOTUZGAAAAAAAAAAAAAwAAAgAAZAAAAlZQOCAuAAAA0AEAnQEqBAADAAEAHCWgAnS6AfgAA7AA/rZX/4s5GI7DP/8Vv+K3/Fb/+JxAAA=="])
    expect(receipt.decoded.map(row => row.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    for (const row of receipt.decoded) {
      expect(row).toMatchObject({ width: 48, height: 64, sameHash: true })
      expect(row.pixel[0]).toBeGreaterThan(180)
      expect(row.pixel[1]).toBeLessThan(65)
      expect(row.pixel[2]).toBeLessThan(65)
      expect(row.pixel[3]).toBe(255)
    }
    expect(receipt.exported.map(row => row.format)).toEqual(['png-zip', 'webp-zip', 'cbz'])
    for (const archive of receipt.exported) {
      expect(archive.prefix).toEqual([80, 75, 3, 4])
      expect(archive.size).toBeGreaterThan(100)
    }
    expect(receipt.exported.map(row => [row.pageEntry, row.manifestEntry, row.comicInfo])).toEqual([
      ['png', true, false], ['webp', true, false], ['png', true, true],
    ])
    expect(receipt.print).toEqual({width: 1200, height: 1700})
    const printPage = await context.newPage()
    await printPage.setContent(receipt.printHtml, { waitUntil: 'load' })
    const pdf = await printPage.pdf({ preferCSSPageSize: true })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1_000)
    await printPage.close()
    expect(receipt.legacy.error).toContain('图片')
    expect(receipt.legacy.bytesRetained).toBe(32)
    expect(receipt.legacy.owner).toBe(receipt.legacy.expectedOwner)
    expect(blocked).toEqual([])
    expect(pageErrors).toEqual([])
    const { decoded, animated, exported, legacy, print } = receipt
    await testInfo.attach('sfqa042-real-pixels-and-exports', {
      body: Buffer.from(JSON.stringify({decoded, animated, exported, legacy, print, pdfBytes: pdf.length}, null, 2)),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})
