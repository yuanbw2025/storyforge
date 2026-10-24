import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {db} from '../../src/lib/db/schema'
import BuildMediaInspector from '../../src/components/character-interaction/BuildMediaInspector'
import BuildInspector from '../../src/components/character-interaction/BuildInspector'
import * as source from '../../src/lib/product-production/preview-source'
import * as service from '../../src/lib/product-production/service'
import {seedChatMediaBuildFixture} from '../helpers/chat-media-fixture'

let host: HTMLDivElement, root: Root
const made = vi.fn(), revoked = vi.fn()
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  made.mockReset(); revoked.mockReset(); made.mockImplementation(() => `blob:build-test-${made.mock.calls.length}`)
  vi.stubGlobal('URL', class extends URL {static createObjectURL = made; static revokeObjectURL = revoked})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})
async function settled(check: () => void) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 10))})
    try {check(); return} catch (error) {if (attempt === 199) throw error}
  }
}
async function fixture() {
  const f = await seedChatMediaBuildFixture()
  return {f, props: {scope: f.scope, buildId: f.buildId, previewHash: f.preview.previewHash, pkg: f.runtimePackage}}
}

it('shows accepted Build images with their exact role, location and license without confirming or publishing', async () => {
  const {f, props} = await fixture(), worlds = await db.worldReleases.toArray(), releases = await db.productReleases.toArray(), artifacts = await db.productBuildArtifacts.toArray()
  await act(async () => root.render(createElement(BuildMediaInspector, props)))
  await settled(() => expect(host.querySelectorAll('img')).toHaveLength(3))
  expect(host.textContent).toContain('叶岑 · 头像；叶岑 · 在场立绘')
  expect(host.textContent).toContain('驿站 · 场景背景'); expect(host.textContent).toContain('test-only')
  expect(await db.agentRuns.count()).toBe(0); expect(await db.productReleases.toArray()).toEqual(releases)
  expect(await db.productBuildArtifacts.toArray()).toEqual(artifacts); expect(await db.worldReleases.toArray()).toEqual(worlds)
  expect(await db.productBuilds.get(f.buildId)).toMatchObject({status: 'preview-ready'})
})

it('does not replace an unavailable Build image with the same asset from its Release', async () => {
  const {f, props} = await fixture()
  await db.productBuildArtifacts.where('buildId').equals(f.buildId).filter(row => row.artifactKey === 'guard.portrait').delete()
  await act(async () => root.render(createElement(BuildMediaInspector, props)))
  await settled(() => expect(host.querySelectorAll('img')).toHaveLength(2))
  expect(host.textContent).toContain('图片暂不可用，文字内容仍可查看')
  expect(host.querySelector('img[alt="叶岑工程头像与立绘"]')).toBeNull()
  expect(await db.productMediaAssets.where('productReleaseId').equals(f.releaseId).count()).toBe(3)
})

it('reports incomplete license metadata while keeping the author image available for inspection', async () => {
  const {props} = await fixture(), pkg = structuredClone(props.pkg)
  pkg.presentation!.assets[0].license = ''
  await act(async () => root.render(createElement(BuildMediaInspector, {...props, pkg})))
  await settled(() => expect(host.querySelectorAll('img')).toHaveLength(3))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('图片信息不完整')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('许可')
})

it('clears old images and refuses a stale preview identity before reading image bytes', async () => {
  const {props} = await fixture()
  await act(async () => root.render(createElement(BuildMediaInspector, props)))
  await settled(() => expect(host.querySelectorAll('img')).toHaveLength(3))
  const count = made.mock.calls.length
  await act(async () => root.render(createElement(BuildMediaInspector, {...props, previewHash: 'f'.repeat(64)})))
  expect(host.querySelector('img')).toBeNull()
  await settled(() => expect(host.textContent).toContain('hash 不一致'))
  expect(made).toHaveBeenCalledTimes(count); expect(revoked).toHaveBeenCalledTimes(count)
})

it('disposes a late author image reader after the inspector is closed', async () => {
  const {props} = await fixture(), resolved = await source.resolveProductRuntimeSource({scope: props.scope, source: {kind: 'build', productBuildId: props.buildId, expectedPreviewHash: props.previewHash}})
  const preload = vi.spyOn(resolved.mediaResolver, 'preload'), dispose = vi.spyOn(resolved.mediaResolver, 'dispose')
  let finish!: (value: typeof resolved) => void
  vi.spyOn(source, 'resolveProductRuntimeSource').mockImplementationOnce(() => new Promise(resolve => {finish = resolve}))
  await act(async () => root.render(createElement(BuildMediaInspector, props)))
  await act(async () => root.render(null))
  await act(async () => finish(resolved))
  expect(dispose).toHaveBeenCalled(); expect(preload).not.toHaveBeenCalled(); expect(made).not.toHaveBeenCalled()
})

it('clears loading when leaving a production and ignores a late details response', async () => {
  const {f} = await fixture()
  let finish!: (value: Awaited<ReturnType<typeof service.readProductProductionDetailsV1>>) => void
  vi.spyOn(service, 'readProductProductionDetailsV1').mockImplementationOnce(() => new Promise(resolve => {finish = resolve}))
  const props = {scope: f.scope, productionId: f.productionId, page: 'media', onProduction: vi.fn()}
  await act(async () => root.render(createElement(BuildInspector, props)))
  expect(host.textContent).toContain('正在校验生成版本')
  await act(async () => root.render(createElement(BuildInspector, {...props, scope: null, productionId: null})))
  expect(host.textContent).toContain('尚无生成版本'); expect(host.textContent).not.toContain('正在校验生成版本')
  await act(async () => finish({build: null} as Awaited<ReturnType<typeof service.readProductProductionDetailsV1>>))
  expect(host.querySelector('img')).toBeNull(); expect(made).not.toHaveBeenCalled()
})
