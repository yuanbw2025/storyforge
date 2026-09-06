import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTtrpgMediaUrls } from '../../src/components/ttrpg/useTtrpgMediaUrls'
import type { TtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn() }))
vi.mock('../../src/lib/ttrpg/runtime-media', () => ({ readTtrpgRuntimeMediaBlobV1: mocks.read }))
vi.mock('../../src/lib/product-production/preview-source', () => ({ resolveProductRuntimeSource: mocks.resolve }))
const slot = { slotKey: 'private.letter', kind: 'handout' as const, targetRef: 'letter', fallbackText: '文字', altText: '私人信件',
  status: 'available' as const, requestKey: 'request.1', assetKey: null, mediaAssetId: 10, mediaContentHash: 'a'.repeat(64), lastErrorCode: null }
const media: TtrpgViewerProjectionV1['media'] = { generatedCount: 1, maximumGeneratedAssets: 3, slots: [slot] }
function Viewer(props: { viewerKey: string; media: TtrpgViewerProjectionV1['media'] }) {
  const urls = useTtrpgMediaUrls({ ...props, sessionId: 1, scope: { projectId: 1, worldId: 1, workId: 1 }, source: { kind: 'release', productReleaseId: 1 } })
  return createElement('div', {}, ...Object.values(urls).map(url => createElement('img', { src: url, key: url, alt: '当前可见素材' })))
}
afterEach(() => vi.restoreAllMocks())
describe('R-TTRPG4D · image visibility during role handoff', () => {
  it('交接角色时立即移除旧角色图片，并销毁中断加载产生的对象 URL', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-letter')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    let resolveBlob!: (blob: Blob) => void
    mocks.read.mockReset().mockImplementation(() => new Promise<Blob>(resolve => { resolveBlob = resolve }))
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(createElement(Viewer, { viewerKey: 'player.a', media })))
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ viewerKey: 'player.a', mediaAssetId: 10 }))
    await act(async () => root.render(createElement(Viewer, { viewerKey: 'player.b', media: { ...media!, slots: [] } })))
    expect(host.querySelector('img')).toBeNull()
    await act(async () => resolveBlob(new Blob(['private-image'])))
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:private-letter')
    expect(host.querySelector('img')).toBeNull()
    expect(mocks.read).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })
  it('已加载的私人素材不跨角色保留；冻结发布素材只加载投影许可的 key', async () => {
    const dispose = vi.fn(), preload = vi.fn().mockResolvedValue({ urls: { 'asset.allowed': 'blob:allowed' }, failures: [], usedBytes: 1 })
    mocks.resolve.mockReset().mockResolvedValue({ mediaResolver: { preload, dispose } })
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(createElement(Viewer, { viewerKey: 'player.a', media: { ...media!, slots: [{ ...slot, assetKey: 'asset.allowed', mediaAssetId: null }] } })))
    expect(preload).toHaveBeenCalledWith({ assetKeys: ['asset.allowed'], maximumBytes: 100 * 1024 * 1024 })
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:allowed')
    await act(async () => root.render(createElement(Viewer, { viewerKey: 'player.b', media: { ...media!, slots: [] } })))
    expect(host.querySelector('img')).toBeNull()
    expect(dispose).toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
