import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { AvgImageRegionCompositeRecipeV3 } from '../../src/lib/avg/image-region-composite-contract'
import { avgRegionCompositeByteFixture } from '../helpers/avg-region-composite-byte-fixture'
const vectors = JSON.parse(readFileSync(new URL('../fixtures/avg-region-png/external-vectors-v1.json', import.meta.url), 'utf8')) as Array<{
  channels: number; filter: number; pngBase64: string; expectedRgba: number[]
}>

test('headless region compositor preserves encoded RGBA in the real browser without storage or provider writes', async ({ page }, info) => {
  const network = { posts: 0, external: 0 }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST') { network.posts++; return route.abort() }
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) { network.external++; return route.abort() }
    return route.continue()
  })
  await page.goto('./avg/library')
  await page.getByRole('button', { name: '新建 AVG', exact: true }).waitFor()
  const vector = vectors.find(v => v.channels === 4 && v.filter === 4)!
  const result = await page.evaluate(async vector => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
    const api = await load('/storyforge/src/lib/avg/image-region-composite.ts') as typeof import('../../src/lib/avg/image-region-composite')
    const legacy = await load('/storyforge/src/lib/avg/image-processing-contract.ts') as typeof import('../../src/lib/avg/image-processing-contract')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const counts = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])))
    const before = await counts()
    const externalData = Uint8Array.from(atob(vector.pngBase64), c => c.charCodeAt(0)).buffer
    const external = await api.decodeAvgStraightPngV1(externalData)
    const base = { width: 64, height: 64, rgba: new Uint8ClampedArray(64 * 64 * 4) }
    const source = { width: 64, height: 64, rgba: new Uint8ClampedArray(64 * 64 * 4) }
    for (let pixel = 0; pixel < 4096; pixel++) {
      base.rgba.set([41, 83, 127, [0, 1, 63, 128, 254, 255][pixel % 6]], pixel * 4)
      source.rgba.set([225, 134, 91, 255], pixel * 4)
    }
    const recipe: AvgImageRegionCompositeRecipeV3 = { schema: 'storyforge.avg.image-processing-recipe', version: 3,
      algorithm: 'storyforge.avg.region-bilinear-srgb.v1', width: 64, height: 64,
      baseReference: { assetKey: 'synthetic.base', assetVersion: 1, contentHash: 'a'.repeat(64) },
      regions: [{ source: { x: 5000, y: 5000, width: 2500, height: 2500 }, target: { x: 2500, y: 2500, width: 2500, height: 2500 }, featherPx: 2 }],
      alphaPolicy: 'preserve-base-alpha', declaration: 'Synthetic internal pixel test; no Work input or production/adoption authority.' }
    const output = api.composeAvgCharacterRegionsV1({ recipe, base, source })
    const encoded = await api.encodeAvgStraightPngV1(output), decoded = await api.decodeAvgStraightPngV1(encoded)
    let protectedChanges = 0, alphaChanges = 0, changedPixels = 0
    for (let pixel = 0; pixel < 4096; pixel++) {
      const x = pixel % 64, y = Math.floor(pixel / 64), offset = pixel * 4
      const changed = [0, 1, 2, 3].some(channel => decoded.rgba[offset + channel] !== base.rgba[offset + channel])
      if (changed) { changedPixels++; if (x < 16 || x >= 32 || y < 16 || y >= 32) protectedChanges++ }
      if (decoded.rgba[offset + 3] !== base.rgba[offset + 3]) alphaChanges++
    }
    const bitmap = await createImageBitmap(new Blob([encoded], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    const opaqueSample = Array.from(context.getImageData(21, 20, 1, 1).data)
    canvas.width = 0; canvas.height = 0
    const controller = new AbortController()
    const pending = api.encodeAvgStraightPngV1({ ...base, signal: controller.signal }); controller.abort()
    let cancellation = ''
    try { await pending } catch (error) { cancellation = (error as Error).name }
    let legacyRejected = 0
    for (const parse of [legacy.parseAvgImageProcessingRecipeV1, legacy.parseAvgImageProcessingRecipeV2]) {
      try { parse(recipe) } catch { legacyRejected++ }
    }
    return { externalRgba: Array.from(external.rgba), changedPixels, protectedChanges, alphaChanges, opaqueSample,
      cancellation, legacyRejected, zeroWrites: JSON.stringify(before) === JSON.stringify(await counts()),
      outputBytes: encoded.byteLength, formalProducerOrAdoption: false }
  }, vector)
  expect(result.externalRgba).toEqual(vector.expectedRgba)
  expect(result.changedPixels).toBeGreaterThan(0)
  expect(result.protectedChanges).toBe(0); expect(result.alphaChanges).toBe(0)
  expect(result.opaqueSample).toEqual([225, 134, 91, 255])
  expect(result.cancellation).toBe('AbortError'); expect(result.legacyRejected).toBe(2)
  expect(result.zeroWrites).toBe(true); expect(network).toEqual({ posts: 0, external: 0 })
  await info.attach('native-region-composition', { body: JSON.stringify({ ...result, network }), contentType: 'application/json' })
})

test('native compute and verification workers terminate exactly once and active cancellation returns no artifact', async ({ page }, info) => {
  const network = { posts: 0, external: 0 }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST') { network.posts++; return route.abort() }
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) { network.external++; return route.abort() }
    return route.continue()
  })
  const fixture = await avgRegionCompositeByteFixture()
  const { sourceData, baseData, renderer: _renderer, ...metadata } = fixture
  await page.goto('./avg/library')
  await page.getByRole('button', { name: '新建 AVG', exact: true }).waitFor()
  const result = await page.evaluate(async ({ metadata, source64, base64 }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
    const api = await load('/storyforge/src/lib/avg/image-region-composite.ts') as typeof import('../../src/lib/avg/image-region-composite')
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const counts = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])))
    const before = await counts(), decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer
    const input = { ...metadata, sourceData: decode(source64), baseData: decode(base64) }
    const NativeWorker = window.Worker, workers: Array<{ name: string; terminated: number }> = []
    class ObservedWorker extends NativeWorker {
      readonly observed: { name: string; terminated: number }
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.observed = { name: options?.name ?? '', terminated: 0 }; workers.push(this.observed) }
      terminate() { this.observed.terminated++; super.terminate() }
    }
    window.Worker = ObservedWorker
    try {
      const output = await api.runAvgRegionCompositeWorkersV1(input)
      const native = await createImageBitmap(new Blob([output.data], { type: 'image/png' })), dimensions = { width: native.width, height: native.height }; native.close()
      const controller = new AbortController(), pending = api.runAvgRegionCompositeWorkersV1({ ...input, signal: controller.signal }); controller.abort()
      let cancellation = ''
      try { await pending } catch (error) { cancellation = (error as Error).name }
      return { workers, cancellation, dimensions, receiptVersion: output.receipt.version, inputProof: output.receipt.inputProof,
        hasAlpha: output.receipt.output.hasAlpha, changedPixelCount: output.receipt.preservation.changedPixelCount,
        callerBuffersRetained: input.sourceData.byteLength === metadata.source.byteSize && input.baseData.byteLength === metadata.base.byteSize,
        zeroWrites: JSON.stringify(before) === JSON.stringify(await counts()) }
    } finally { window.Worker = NativeWorker }
  }, { metadata, source64: Buffer.from(sourceData).toString('base64'), base64: Buffer.from(baseData).toString('base64') })
  expect(result.workers).toEqual([{ name: 'avg-region-process-v1', terminated: 1 }, { name: 'avg-region-verify-v1', terminated: 1 }, { name: 'avg-region-process-v1', terminated: 1 }])
  expect(result.cancellation).toBe('AbortError'); expect(result.dimensions).toEqual({ width: 64, height: 64 })
  expect(result.receiptVersion).toBe(3); expect(result.inputProof).toEqual(metadata.inputProof)
  expect(result.hasAlpha).toBe(true); expect(result.changedPixelCount).toBeGreaterThan(0)
  expect(result.callerBuffersRetained).toBe(true); expect(result.zeroWrites).toBe(true)
  expect(network).toEqual({ posts: 0, external: 0 })
  await info.attach('native-region-workers', { body: JSON.stringify({ ...result, network }), contentType: 'application/json' })
})
