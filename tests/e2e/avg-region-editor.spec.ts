import { expect, test } from '@playwright/test'
import { avgRegionEditorUiFixture } from '../helpers/avg-region-editor-ui-fixture'

test('controlled region editor draws exact image coordinates, trials real workers and clears stale results on mobile', async ({ page }, info) => {
  const f = await avgRegionEditorUiFixture(), network = { posts: 0, external: 0 }, modules: Record<string, string> = {}
  page.on('response', response => { const url = response.url(), path = new URL(url).pathname
    if (path.endsWith('/react.js')) modules.react = url
    if (path.endsWith('/react-dom_client.js')) modules.dom = url
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST') { network.posts++; return route.abort() }
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(info.project.use.baseURL!).origin) { network.external++; return route.abort() }
    return route.continue()
  })
  // Only the source authority is controlled here. The component, PNG bytes,
  // pointer geometry and both independent native workers are real. No saved
  // producer or adoption is manufactured by this fixture.
  await page.route('**/src/lib/avg/image-region-editor-preview.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { runAvgRegionCompositeWorkersV1 } from '/storyforge/src/lib/avg/image-region-composite-worker-client.ts';
    export async function readAvgRegionEditorImagesV1(){return window.__regionEditorFixture.images;}
    export async function previewAvgRegionEditorV1(input){const f=window.__regionEditorFixture;return runAvgRegionCompositeWorkersV1({...f.pixels,recipe:input.recipe,signal:input.signal});}
  ` }))
  await page.goto('avg/library'); await page.getByRole('button', { name: '新建 AVG', exact: true }).waitFor()
  expect(modules.react).toBeTruthy(); expect(modules.dom).toBeTruthy()
  const { sourceData: _source, baseData: _base, ...pixels } = f.pixels
  await page.evaluate(async seed => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<Record<string, unknown>>
    const reactModule = await load(seed.modules.react), domModule = await load(seed.modules.dom)
    const react = (reactModule.default ?? reactModule) as typeof import('react'), dom = (domModule.default ?? domModule) as typeof import('react-dom/client')
    const component = await load('/storyforge/src/components/avg/RegionCompositeRecipeEditor.tsx') as typeof import('../../src/components/avg/RegionCompositeRecipeEditor')
    const sourceData = Uint8Array.from(seed.sourceBytes).buffer, baseData = Uint8Array.from(seed.baseBytes).buffer
    const state = { recipe: seed.recipe, valid: false, pixels: { ...seed.pixels, sourceData, baseData },
      images: { raw: { asset: seed.rawAsset, data: sourceData, width: 64, height: 64 },
        base: { asset: seed.baseAsset, data: baseData, width: 64, height: 64 }, sourceRead: {} } }
    Object.defineProperty(window, '__regionEditorFixture', { value: state, configurable: true })
    const host = document.createElement('main'); host.style.cssText = 'position:fixed;inset:0;z-index:10000;overflow:auto;padding:12px;box-sizing:border-box;background:white'; document.body.append(host)
    const root = dom.createRoot(host), render = () => root.render(react.createElement(component.default, { scope: { projectId: 1, worldId: 1, workId: 1 },
      references: [seed.reference], source: seed.sourceToken, recipe: state.recipe, disabled: false,
      onChange: recipe => { state.recipe = recipe; render() }, onValid: value => { state.valid = value }, onPending() {} }))
    render()
  }, { modules, recipe: f.pixels.recipe, pixels, reference: f.reference, rawAsset: f.rawAsset, baseAsset: f.baseAsset,
    sourceBytes: Array.from(new Uint8Array(f.pixels.sourceData)), baseBytes: Array.from(new Uint8Array(f.pixels.baseData)),
    sourceToken: { schema: 'storyforge.avg.visual-raw-reuse-source', version: 2 } as Parameters<typeof import('../../src/components/avg/RegionCompositeRecipeEditor').default>[0]['source'] })
  const target = page.getByRole('img', { name: '底图替换', exact: true }), trial = page.getByRole('button', { name: '试算局部表情效果', exact: true })
  await expect(target).toBeVisible(); await expect(trial).toBeEnabled()
  const before = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema'); return Promise.all(db.tables.map(async table => [table.name, await table.count()])) })
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25); await page.mouse.down()
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5, { steps: 3 }); await page.mouse.up()
  const rect = await page.evaluate(() => Object.getOwnPropertyDescriptor(window, '__regionEditorFixture')!.value.recipe.regions[0].target)
  expect(Math.abs(rect.x - 2500)).toBeLessThan(25); expect(Math.abs(rect.y - 2500)).toBeLessThan(25)
  expect(Math.abs(rect.width - 2500)).toBeLessThan(25); expect(Math.abs(rect.height - 2500)).toBeLessThan(25)
  // Set the exact fixture rectangle after proving the actual drag mapping.
  for (const label of ['左侧', '顶部', '宽度', '高度']) await page.getByLabel(`底图替换${label}（%）`, { exact: true }).fill('25')
  await expect(trial).toBeEnabled(); await trial.click()
  const result = page.getByRole('img', { name: '本地局部表情试算，尚未成为制作候选或采用', exact: true })
  await expect(result).toBeVisible(); const actualHash = await result.evaluate(async image => {
    const img = image as HTMLImageElement; await img.decode(); const bytes = await (await fetch(img.src)).arrayBuffer()
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  })
  expect(actualHash).toBe(f.result.receipt.output.contentHash)
  const after = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema'); return Promise.all(db.tables.map(async table => [table.name, await table.count()])) })
  expect(after).toEqual(before); expect(network).toEqual({ posts: 0, external: 0 })
  await page.setViewportSize({ width: 390, height: 844 }); await target.scrollIntoViewIfNeeded()
  const mobile = (await target.boundingBox())!; expect(mobile.x).toBeGreaterThanOrEqual(0); expect(mobile.x + mobile.width).toBeLessThanOrEqual(390)
  await page.getByLabel('底图替换宽度（%）', { exact: true }).fill('75'); await page.getByLabel('底图替换高度（%）', { exact: true }).fill('75')
  await expect(trial).toBeDisabled(); await expect(result).toHaveCount(0)
  await info.attach('controlled-region-ui-physical-proof', { body: JSON.stringify({ sourceAuthority: 'controlled fixture only', actualNativeUI: true,
    realWorkers: true, actualPngHash: actualHash, dragRect: rect, mobileWidth: mobile.width, staleTrialRemoved: true, zeroTableCountDelta: true, network }), contentType: 'application/json' })
})
