import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {db} from '../../src/lib/db/schema'
import MediaSelection from '../../src/components/character-interaction/MediaSelection'
import * as authority from '../../src/lib/product-production/chat-media-authority'
import {seedChatMediaBuildFixture} from '../helpers/chat-media-fixture'
import {createChatMediaReviewSourceV1} from '../../src/lib/character-interaction/media-selection'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'

let host: HTMLDivElement, root: Root
const made = vi.fn(), revoked = vi.fn()
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  made.mockReset(); revoked.mockReset(); made.mockImplementation(() => `blob:confirm-test-${made.mock.calls.length}`)
  vi.stubGlobal('URL', class extends URL {static createObjectURL = made; static revokeObjectURL = revoked})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})
async function fixture() {
  const f = await seedChatMediaBuildFixture(), build = (await db.productBuilds.get(f.buildId))!
  const source = createChatMediaReviewSourceV1(f.runtimePackage.interaction!, f.runtimePackage.presentation!.assets)
  const review = {source, sourceHash: await hashProductProductionValueV2(source),
    images: source.assets.map(asset => ({asset, artifactKey: asset.assetKey, bytes: new Uint8Array([1, 2, 3]).buffer}))}
  return {props: {scope: f.scope, build, disabled: false, onConfirm: vi.fn()}, review}
}

it('shows exact roles, original images and licenses; only an explicit click after image display submits the frozen decision', async () => {
  const {props, review} = await fixture(), reader = vi.spyOn(authority, 'readCurrentChatMediaReviewV1').mockResolvedValue(review)
  await act(async () => root.render(createElement(MediaSelection, props)))
  expect(reader).toHaveBeenCalledWith({scope: props.scope, build: props.build})
  expect(host.textContent).toContain('叶岑 · 头像与在场立绘'); expect(host.textContent).toContain('驿站 · 开场背景')
  expect(host.textContent).toContain('test-only'); expect(props.onConfirm).not.toHaveBeenCalled()
  const button = host.querySelector('button')!
  expect(button.disabled).toBe(true)
  for (const image of host.querySelectorAll('img')) await act(async () => {image.dispatchEvent(new Event('load'))})
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
  expect(props.onConfirm).toHaveBeenCalledTimes(1)
  expect(props.onConfirm.mock.calls[0][0]).toMatchObject({buildNumber: props.build.buildNumber, controlEpoch: props.build.controlEpoch,
    sourceHash: review.sourceHash, bindings: {participants: [{participantKey: 'guard', avatarAssetKey: 'guard.portrait', portraitAssetKey: 'guard.portrait'},
      {participantKey: 'artisan', avatarAssetKey: 'artisan.portrait', portraitAssetKey: 'artisan.portrait'}], scenes: [{sceneKey: 'inn', location: '驿站', backgroundAssetKey: 'inn.background'}]}})
  expect(await db.productProductionCommands.count()).toBe(0)
})

it('blocks confirmation when bytes or image decoding fail and preserves the author decision boundary while busy', async () => {
  const {props, review} = await fixture(), reader = vi.spyOn(authority, 'readCurrentChatMediaReviewV1').mockResolvedValue(review)
  await act(async () => root.render(createElement(MediaSelection, {...props, disabled: true})))
  for (const image of host.querySelectorAll('img')) await act(async () => {image.dispatchEvent(new Event('load'))})
  expect(host.querySelector('button')!.disabled).toBe(true)
  await act(async () => root.render(createElement(MediaSelection, props)))
  await act(async () => {host.querySelector('img')!.dispatchEvent(new Event('error'))})
  expect(host.querySelector('button')!.disabled).toBe(true)
  expect(host.textContent).toContain('原图无法显示')
  reader.mockRejectedValueOnce(new Error('当前图片原始字节缺失或跨作品'))
  await act(async () => root.render(createElement(MediaSelection, {...props, build: {...props.build, controlEpoch: props.build.controlEpoch + 1}})))
  expect(host.querySelectorAll('img')).toHaveLength(0); expect(revoked).toHaveBeenCalledTimes(3)
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('原始字节缺失')
  expect(props.onConfirm).not.toHaveBeenCalled()
})

it('ignores an old asynchronous read after switching Build and revokes the current image URLs on close', async () => {
  const {props, review} = await fixture()
  let finish!: (value: typeof review) => void
  const reader = vi.spyOn(authority, 'readCurrentChatMediaReviewV1').mockImplementationOnce(() => new Promise(resolve => {finish = resolve}))
  await act(async () => root.render(createElement(MediaSelection, props)))
  reader.mockResolvedValue(review)
  const next = {...props, build: {...props.build, controlEpoch: props.build.controlEpoch + 1}}
  await act(async () => root.render(createElement(MediaSelection, next)))
  expect(host.querySelectorAll('img')).toHaveLength(3)
  await act(async () => finish({...review, sourceHash: 'f'.repeat(64)}))
  expect(made).toHaveBeenCalledTimes(3)
  for (const image of host.querySelectorAll('img')) await act(async () => {image.dispatchEvent(new Event('load'))})
  await act(async () => host.querySelector('button')!.click())
  expect(props.onConfirm.mock.calls[0][0]).toMatchObject({controlEpoch: next.build.controlEpoch, sourceHash: review.sourceHash})
  await act(async () => root.render(null))
  expect(revoked).toHaveBeenCalledTimes(3)
})
