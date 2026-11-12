import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useGeographyStore } from '../../src/stores/project-singletons'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { sanitizeSvg } from '../../src/lib/utils/sanitize-svg'
import GeographyPanel from '../../src/components/geography/GeographyPanel'
import { ToastProvider } from '../../src/components/shared/Toast'
import type { Project } from '../../src/lib/types'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'


const ai = vi.hoisted(() => ({ output: '', start: vi.fn(async () => '') }))
vi.mock('../../src/hooks/useAIStream', () => ({ useAIStream: () => ({ ...ai, isStreaming: false, error: null, tokenUsage: null }) }))
vi.mock('../../src/components/geography/LocationTreeMap', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mapA = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="sfqa131-untrusted-map" viewBox="0 0 100 100"><defs><linearGradient id="sfqa131-shade"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/></linearGradient></defs><style>body,#sfqa131-outside { color: rgb(255,0,0) !important; } .map-region { fill: url(#sfqa131-shade); stroke: #fff; }</style><path class="map-region" d="M0 0H100V100H0Z"/><text x="2" y="20">港口</text></svg>'
const mapB = mapA.replace('港口', '山城')
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let sequence = 0
const blobs = new Map<string, Blob>()

async function settle(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    if (check()) return
  }
  expect(check()).toBe(true)
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))
  expect(button, text).toBeTruthy()
  await act(async () => { button!.click() })
}
function image() { return host.querySelector<HTMLImageElement>('img[alt="地理概念地图"]') }
async function fixture() {
  const made = await seedCurrentWorkspace('131 isolated map')
  await db.geographies.add(stampNewRecord(made.scope, 'geographies', {
    projectId: made.scope.projectId, worldGroupId: null, overview: '地图预览原文',
    locations: JSON.stringify([{ id: 'harbor', name: '港口', type: 'city', description: '', significance: '', parentId: null, order: 0 }]),
    createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
  return made
}
async function mount(project: Project, output = mapA) {
  ai.output = output
  await act(async () => root.render(createElement(ToastProvider, null, createElement(GeographyPanel, { project }))))
  await settle(() => !!image() || !!host.querySelector('#sfqa131-untrusted-map') || host.textContent?.includes('地图预览暂不可用') === true)
  await settle(() => !useGeographyStore.getState().loading && useGeographyStore.getState().loadedScope?.projectId === project.id)
}

beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1()
  await db.delete(); await db.open()
  ai.output = ''; ai.start.mockReset().mockResolvedValue('')
  useWorldGroupStore.setState({ groups: [], activeGroupId: null })
  useGeographyStore.setState({ geography: null, loadedScope: null, activeWorldGroupId: null, loading: false, loadError: null })
  blobs.clear(); sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => {
    if (!(value instanceof Blob)) throw new Error('131 preview must use its actual SVG Blob')
    const url = `blob:sfqa131-${++sequence}`; blobs.set(url, value); return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network request') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); db.close()
})

describe('SFQA131 · actual Geography concept-map preview boundary', () => {
  it('keeps untrusted SVG/style out of the host DOM and preserves local style, defs and SVG bytes in an image', async () => {
    const made = await fixture(), before = await db.geographies.toArray()
    await mount(made.project)
    expect(host.querySelector('#sfqa131-untrusted-map')).toBeNull()
    const img = image(); expect(img).not.toBeNull()
    const blob = blobs.get(img!.getAttribute('src')!); expect(blob).toBeDefined()
    expect(blob!.type).toBe('image/svg+xml')
    const text = await blob!.text()
    expect(text).toBe(sanitizeSvg(mapA))
    expect(text).toContain('.map-region'); expect(text).toContain('linearGradient'); expect(text).toContain('港口')
    expect(await db.geographies.toArray()).toEqual(before)
    expect(ai.start).not.toHaveBeenCalled()
  })

  it('releases the previous image while a replacement is pending and renders only the new exact SVG afterward', async () => {
    const made = await fixture(); await mount(made.project)
    const original = image()?.getAttribute('src'); expect(original).toBeTruthy()
    let finish!: (value: string) => void
    ai.output = ''
    ai.start.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
    await click('生成 AI 概念地图')
    expect(image()).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(original)
    await act(async () => finish(mapB))
    await settle(() => !!image())
    const next = image()!.getAttribute('src')!; expect(next).not.toBe(original)
    expect(await blobs.get(next)!.text()).toBe(sanitizeSvg(mapB))
    expect(host.querySelector('#sfqa131-untrusted-map')).toBeNull()
  })

  it('releases a hidden view URL and restores the same SVG without generation when the map view returns', async () => {
    const made = await fixture(); await mount(made.project)
    const original = image()?.getAttribute('src'); expect(original).toBeTruthy()
    await click('列表')
    expect(image()).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(original)
    await click('AI地图'); await settle(() => !!image())
    const restored = image()!.getAttribute('src')!; expect(restored).not.toBe(original)
    expect(await blobs.get(restored)!.text()).toBe(sanitizeSvg(mapA))
    expect(ai.start).not.toHaveBeenCalled()
  })

  it('releases the final URL at unmount without changing the owner or geography records', async () => {
    const made = await fixture(), before = { project: await db.projects.get(made.project.id!), geography: await db.geographies.toArray() }
    await mount(made.project)
    const url = image()?.getAttribute('src'); expect(url).toBeTruthy()
    await act(async () => root.render(null))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    expect(await db.projects.get(made.project.id!)).toEqual(before.project)
    expect(await db.geographies.toArray()).toEqual(before.geography)
  })
  it('keeps the source after URL creation failure and retries preview only on the explicit action', async () => {
    const made = await fixture(), before = await db.geographies.toArray()
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('131 bounded URL failure') })
    await mount(made.project)
    expect(host.textContent).toContain('地图预览暂不可用，原图已保留。')
    expect(image()).toBeNull(); expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(ai.start).not.toHaveBeenCalled()
    await click('重试预览'); await settle(() => !!image())
    expect(await blobs.get(image()!.getAttribute('src')!)!.text()).toBe(sanitizeSvg(mapA))
    expect(ai.start).not.toHaveBeenCalled(); expect(await db.geographies.toArray()).toEqual(before)
  })

  it('runtime SVG import keeps its existing bytes/hash policy and product ownership independently of the author preview', async () => {
    const seeded = await seedCurrentProductWorld('131 runtime SVG owner')
    if (typeof seeded.release.id !== 'number') throw new Error('131 requires a real frozen WorldRelease')
    const world = { ...seeded, release: { ...seeded.release, id: seeded.release.id } }
    const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: world.release.id, productType: 'avg' })
    const runtimePackage = createCurrentRuntimePackageFixture({ productType: 'avg', worldRelease: world.release, sourceCatalog: catalog })
    const build = await seedCurrentProductBuild({ scope: world.scope, worldRelease: world.release, runtimePackage, title: '131 runtime SVG consumer' })
    const releaseBefore = await db.worldReleases.get(world.release.id)
    const asset = await importProductRuntimeMediaAssetV1({ scope: world.scope, productRuntimeSessionId: build.session.id!,
      assetKey: 'sfqa131.map', kind: 'background', name: '131 existing SVG policy',
      blob: new Blob([mapA], { type: 'image/svg+xml' }), width: 100, height: 100,
      source: 'isolated deterministic SVG fixture', license: 'fixture only' })
    if (asset.id == null) throw new Error('131 runtime SVG has no persisted asset identity')
    const binding = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id).first()
    if (!binding) throw new Error('131 runtime SVG has no governed physical binding')
    const bytes = await readMediaBlobObjectData({ scope: world.scope, blobObjectId: binding.blobObjectId,
      expected: { contentHash: asset.contentHash, byteSize: asset.byteSize, mimeType: asset.mimeType } })
    const text = new TextDecoder().decode(bytes)
    expect(text).toBe(sanitizeSvg(mapA))
    expect(text).toContain('.map-region'); expect(text).toContain('linearGradient')
    expect(asset).toMatchObject({ ownerKind: 'runtime', projectId: world.scope.projectId, worldId: world.scope.worldId,
      workId: world.scope.workId, productRuntimeSessionId: build.session.id, mimeType: 'image/svg+xml' })
    expect(await db.worldReleases.get(world.release.id)).toEqual(releaseBefore)
  })

  it('handles the current asynchronous image error by releasing its URL and explicitly retrying the same SVG without a model', async () => {
    const made = await fixture(), ownerBefore = { project: await db.projects.get(made.project.id!), geography: await db.geographies.toArray() }
    await mount(made.project)
    const oldImage = image()!, oldUrl = oldImage.getAttribute('src')!
    await act(async () => { oldImage.dispatchEvent(new Event('error')) })
    expect(image()).toBeNull()
    expect(host.textContent).toContain('地图预览暂不可用，原图已保留。')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldUrl)
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(([url]) => url === oldUrl)).toHaveLength(1)
    expect(ai.start).not.toHaveBeenCalled()
    await click('重试预览'); await settle(() => !!image())
    const current = image()!, currentUrl = current.getAttribute('src')!
    expect(currentUrl).not.toBe(oldUrl)
    expect(await blobs.get(currentUrl)!.text()).toBe(sanitizeSvg(mapA))
    await act(async () => { oldImage.dispatchEvent(new Event('error')) })
    expect(image()).toBe(current)
    expect(image()!.getAttribute('src')).toBe(currentUrl)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(currentUrl)
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(([url]) => url === oldUrl)).toHaveLength(1)
    expect(ai.start).not.toHaveBeenCalled()
    expect(await db.projects.get(made.project.id!)).toEqual(ownerBefore.project)
    expect(await db.geographies.toArray()).toEqual(ownerBefore.geography)
  })

  it('keeps a retired image separate so a delayed old image error cannot replace the new SVG', async () => {
    const made = await fixture(); await mount(made.project)
    const oldImage = image()!, oldUrl = oldImage.getAttribute('src')!
    ai.output = ''; ai.start.mockResolvedValueOnce(mapB)
    await click('生成 AI 概念地图')
    await settle(() => image()?.getAttribute('src') !== oldUrl)
    const current = image()!, currentUrl = current.getAttribute('src')!
    expect(current).not.toBe(oldImage)
    await act(async () => { oldImage.dispatchEvent(new Event('error')) })
    expect(image()).toBe(current)
    expect(await blobs.get(currentUrl)!.text()).toBe(sanitizeSvg(mapB))
    expect(host.textContent).not.toContain('地图预览暂不可用，原图已保留。')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(currentUrl)
    expect(ai.start).toHaveBeenCalledTimes(1)
  })

})
