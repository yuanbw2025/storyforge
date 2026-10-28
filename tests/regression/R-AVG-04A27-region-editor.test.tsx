import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import RegionCompositeRecipeEditor from '../../src/components/avg/RegionCompositeRecipeEditor'
import type { AvgImageRegionCompositeRecipeV3 } from '../../src/lib/avg/image-region-composite-contract'
import type { AvgVisualRawReuseSourceV5 } from '../../src/lib/avg/visual-image-reuse-contract'
import { avgRegionProcessedFixture } from '../helpers/avg-region-processed-fixture'

// UI-only source tokens and deferred reads, not producer/adoption evidence.
// Actual source/worker/restore admission is exercised separately.
const api = vi.hoisted(() => ({ read: vi.fn(), preview: vi.fn() }))
vi.mock('../../src/lib/avg/image-region-editor-preview', () => ({ readAvgRegionEditorImagesV1: api.read, previewAvgRegionEditorV1: api.preview }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.read.mockReset(); api.preview.mockReset()
  let next = 0; vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:region-unit-${++next}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

async function fixture(initial = true) {
  const f = await avgRegionProcessedFixture(), source: AvgVisualRawReuseSourceV5 = {
    schema: 'storyforge.avg.visual-raw-reuse-source', version: 2, productionKey: 'synthetic.absent-current', requirementKey: 'synthetic.expression',
    raw: { schema: 'storyforge.avg.visual-image-producer-proof', version: 5, buildNumber: 1, briefHash: 'a'.repeat(64), planHash: 'b'.repeat(64), controlEpoch: 0,
      taskKey: 'avg.media.generate.synthetic.expression', artifactKey: 'avg.media.raw.synthetic.expression', artifactVersion: 1, contentHash: f.pixels.source.contentHash,
      inputHash: 'c'.repeat(64), producerReceiptHash: 'd'.repeat(64), candidateHash: 'e'.repeat(64), responseEvidenceHash: 'f'.repeat(64), proofHash: '1'.repeat(64) },
    compilation: { artifactKey: 'avg.media.compiled-visual-requirements', version: 1, contentHash: '2'.repeat(64) },
    sourceWorldContentHash: '3'.repeat(64), requirementHash: '4'.repeat(64), semanticRequirementHash: '5'.repeat(64),
  }
  const images = { raw: { asset: f.payload.sourceAsset, data: f.pixels.sourceData, width: 64, height: 64 },
    base: { asset: f.inputEvidence.base.asset, data: f.pixels.baseData, width: 64, height: 64 },
    sourceRead: { raw: { buildId: 1, artifactKey: source.raw.artifactKey, version: 1, contentHash: source.raw.contentHash },
      source: { mode: 'historical' as const, frozen: { expectedBuildRevision: 1, expectedBriefHash: source.raw.briefHash, expectedPlanHash: source.raw.planHash, controlEpoch: 0 } } } }
  api.read.mockResolvedValue(images); api.preview.mockResolvedValue(f.result)
  let recipe: AvgImageRegionCompositeRecipeV3 | null = initial ? f.pixels.recipe : null, scope = { projectId: 1, worldId: 1, workId: 1 }, selectedSource: AvgVisualRawReuseSourceV5 | undefined = source
  const onValid = vi.fn(), onPending = vi.fn(), onChange = vi.fn((next: AvgImageRegionCompositeRecipeV3) => { recipe = next; render() })
  const render = () => root.render(<RegionCompositeRecipeEditor scope={scope} references={[f.reference]} source={selectedSource} recipe={recipe}
    disabled={false} onChange={onChange} onValid={onValid} onPending={onPending} />)
  await act(async () => render()); await flush()
  const button = (name: string) => Array.from(host.querySelectorAll('button')).find(element => element.textContent?.trim() === name)!
  const click = (name: string) => act(async () => { const element = button(name); expect(element).toBeDefined(); expect(element.disabled).toBe(false); element.click() })
  const input = (name: string, value: string) => act(async () => {
    const element = host.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return { ...f, images, source, button, click, input, onChange, onValid, onPending, recipe: () => recipe,
    scope: async (workId: number) => act(async () => { scope = { ...scope, workId }; render() }),
    noSource: async () => act(async () => { selectedSource = undefined; render() }) }
}

describe('AVG two-image region editor preserves explicit author input and trial boundaries', () => {
  it('requires explicit base selection and complete non-default rectangles before a recipe or trial is valid', async () => {
    const f = await fixture(false)
    expect(f.onChange).not.toHaveBeenCalled(); expect(f.onValid).toHaveBeenLastCalledWith(false)
    await f.click('使用此底图配置局部表情'); expect(f.recipe()?.regions).toEqual([])
    await f.click('添加表情区域'); expect(f.recipe()?.regions[0].source.width).toBe(0)
    expect(f.button('试算局部表情效果').disabled).toBe(true)
    for (const side of ['原图取用', '底图替换']) for (const [name, value] of [['左侧', '25'], ['顶部', '25'], ['宽度', '25'], ['高度', '25']]) await f.input(`${side}${name}（%）`, value)
    expect(f.recipe()?.regions[0].target).toEqual({ x: 2500, y: 2500, width: 2500, height: 2500 })
    expect(f.onValid).toHaveBeenLastCalledWith(false) // purpose is still empty
    expect(api.preview).not.toHaveBeenCalled()
  })
  it('normalizes the exact displayed image box, rejects oversized rectangles and restores a cancelled pointer selection', async () => {
    const f = await fixture(), svg = host.querySelector('svg[aria-label="底图替换"]') as SVGSVGElement
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 50, left: 100, top: 50, width: 200, height: 300, right: 300, bottom: 350, toJSON() {} })
    Object.assign(svg, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true })
    const event = (type: string, x: number, y: number) => act(async () => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y })))
    const before = structuredClone(f.recipe()!.regions[0].target)
    await event('pointerdown', 120, 110)
    // A parent notice/reflow must not change coordinates halfway through a drag.
    vi.mocked(svg.getBoundingClientRect).mockReturnValue({ x: 100, y: 90, left: 100, top: 90, width: 200, height: 400, right: 300, bottom: 490, toJSON() {} })
    await event('pointermove', 160, 140)
    expect(f.recipe()!.regions[0].target).toEqual({ x: 1000, y: 2000, width: 2000, height: 1000 })
    await event('pointercancel', 160, 140); expect(f.recipe()!.regions[0].target).toEqual(before)
    await f.input('底图替换宽度（%）', '75'); await f.input('底图替换高度（%）', '75')
    expect(f.onValid).toHaveBeenLastCalledWith(false); expect(f.button('试算局部表情效果').disabled).toBe(true)
  })
  it('shows an explicit in-memory trial and revokes all temporary images on unmount', async () => {
    const f = await fixture(); expect(f.onValid).toHaveBeenLastCalledWith(true)
    await f.click('试算局部表情效果'); await flush()
    expect(api.preview).toHaveBeenCalledTimes(1); expect(host.querySelector('img[alt*="尚未成为制作候选"]')).not.toBeNull()
    expect(host.textContent).toContain('尚未保存为媒资、评审或采用')
    const created = vi.mocked(URL.createObjectURL).mock.results.map(result => result.value)
    await act(async () => root.unmount()); root = createRoot(host)
    for (const url of created) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
  it('cancels an active trial once and discards its late result', async () => {
    const f = await fixture(); let resolve!: (value: typeof f.result) => void
    api.preview.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await f.click('试算局部表情效果'); await flush(); const request = api.preview.mock.calls[0][0]
    await f.click('取消本地试算'); expect(request.signal.aborted).toBe(true)
    await act(async () => resolve(f.result)); await flush()
    expect(api.preview).toHaveBeenCalledTimes(1); expect(host.querySelector('img[alt*="尚未成为制作候选"]')).toBeNull()
  })
  it('invalidates trial/read validity when its exact Work/source changes and discards a late source read', async () => {
    const f = await fixture(); let resolve!: (value: typeof f.images) => void
    api.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await f.scope(2); await flush(); expect(f.onValid).toHaveBeenLastCalledWith(false)
    await f.noSource(); await flush(); await act(async () => resolve(f.images)); await flush()
    expect(host.textContent).toContain('请先为本项沿用已保存原图')
    expect(host.querySelector('svg')).toBeNull(); expect(f.onValid).toHaveBeenLastCalledWith(false)
  })
})
