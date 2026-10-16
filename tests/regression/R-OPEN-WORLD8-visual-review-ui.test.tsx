import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), bytes: vi.fn() }))
vi.mock('../../src/lib/open-world/creator-quality', () => ({
  readTextOpenWorldVisualReviewWorkspaceV1: mocks.read, recordTextOpenWorldVisualReviewV1: mocks.save,
}))
vi.mock('../../src/lib/product-production/media-blob-store', () => ({ readMediaBlobObjectData: mocks.bytes }))
import TextOpenWorldVisualReview from '../../src/components/text-game/TextOpenWorldVisualReview'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const scope = { projectId: 1, worldId: 2, workId: 3 }
const assetKey = 'text-open-world.media.visual.001'
const workspace = () => ({
  assets: [{ artifactKey: assetKey, contentHash: 'a'.repeat(64), blobObjectId: 1, byteSize: 8,
    alt: '工程头像', mimeType: 'image/png', width: 32, height: 32, source: 'test', license: 'test' }],
  consistency: { assetsHash: 'b'.repeat(64), issues: [], characterGroups: [] },
  receipt: { status: 'passed', receiptHash: 'c'.repeat(64) }, immutableRelease: false,
})
const saveButton = () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('冻结逐图'))!
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(workspace())
  mocks.save.mockReset().mockResolvedValue(workspace())
  mocks.bytes.mockReset().mockResolvedValue(new ArrayBuffer(8))
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:engineering-test')
    static revokeObjectURL = vi.fn()
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
describe('W6 explicit visual review UI', () => {
  it('does not reuse old approval as new human consent and requires decoded image plus explicit judgment', async () => {
    await act(async () => root.render(createElement(TextOpenWorldVisualReview, { scope, productionId: 4, buildId: 5 })))
    expect(saveButton().disabled).toBe(true)
    expect(host.querySelector('input')!.checked).toBe(false)
    const select = host.querySelector('select')!
    expect(select.value).toBe(''); expect(select.disabled).toBe(true)
    await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('load')) })
    await act(async () => { select.value = 'approved'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(saveButton().disabled).toBe(true)
    await act(async () => { host.querySelector('input')!.click() })
    await act(async () => { saveButton().click() })
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ buildId: 5, imagesActuallyViewed: true,
      noAutomationProxy: true, decisions: [{ artifactKey: assetKey, decision: 'approved', note: '' }] })
  })
  it('image failure never enables signing; changing Build clears the decision', async () => {
    mocks.bytes.mockRejectedValue(new Error('bad bytes'))
    await act(async () => root.render(createElement(TextOpenWorldVisualReview, { scope, productionId: 4, buildId: 5 })))
    expect(host.textContent).toContain('图片字节校验失败')
    await act(async () => { host.querySelector('input')!.click() })
    expect(saveButton().disabled).toBe(true)
    await act(async () => root.render(createElement(TextOpenWorldVisualReview, { scope, productionId: 4, buildId: 6 })))
    expect(host.querySelector('input')!.checked).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
