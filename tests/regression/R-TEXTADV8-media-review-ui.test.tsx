import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TextAdventureMediaThumbnail,
  visualReviewRepairTargets,
} from '../../src/components/product/ProductProductionStudio'
import type { TextAdventureMediaAssetV1 } from '../../src/lib/product-production/service'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mediaMocks = vi.hoisted(() => ({
  read: vi.fn(),
}))

vi.mock('../../src/lib/product-production/service', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/product-production/service')>(),
  readTextAdventureMediaAssetBytesV1: mediaMocks.read,
}))

const scope = { projectId: 1, worldId: 2, workId: 3 }

function asset(suffix: string): TextAdventureMediaAssetV1 {
  return {
    assetKey: `media.asset.${suffix}`,
    artifactKey: `media.visual.${suffix}`,
    version: 1,
    status: 'accepted',
    contentHash: suffix.repeat(64).slice(0, 64),
    blobObjectId: Number(suffix),
    mediaKind: 'cg',
    mimeType: 'image/png',
    byteSize: 4,
    metadata: { altText: `图片 ${suffix}` },
    quality: {},
    rights: {},
    locked: false,
  }
}

describe('R-TEXTADV-8 · 作者逐图审查 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let createObjectUrl: ReturnType<typeof vi.fn>
  let revokeObjectUrl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mediaMocks.read.mockReset()
    createObjectUrl = vi.fn()
      .mockReturnValueOnce('blob:asset-1')
      .mockReturnValueOnce('blob:asset-3')
    revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('把旧报告中误放行的可读文字 warning 纳入批量返修目标', () => {
    const targets = visualReviewRepairTargets({
      artifactKey: 'quality.visual-review',
      payload: {
        reviews: [{
          artifactKey: 'media.visual.001', verdict: 'accept',
          issues: [{
            severity: 'warning', category: 'artifact',
            detail: '潮钟表盘上的罗马数字清晰可辨。',
            recommendation: '重绘为无字符的机械外壳。',
          }],
        }],
      },
    } as never)
    expect(targets).toEqual([expect.objectContaining({
      artifactKey: 'media.visual.001', verdict: 'accept',
      issues: [expect.objectContaining({ severity: 'blocking', category: 'artifact' })],
    })])
  })

  it('资产变化时不泄漏旧 URL，并能从失败恢复到新图及用 Escape 关闭原图', async () => {
    let rejectSecond: (reason: Error) => void = () => undefined
    mediaMocks.read
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]).buffer)
      .mockImplementationOnce(() => new Promise<ArrayBuffer>((_resolve, reject) => { rejectSecond = reject }))
      .mockResolvedValueOnce(new Uint8Array([5, 6, 7, 8]).buffer)

    await act(async () => {
      root.render(createElement(TextAdventureMediaThumbnail, { scope, asset: asset('1') }))
    })
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:asset-1')

    await act(async () => {
      root.render(createElement(TextAdventureMediaThumbnail, { scope, asset: asset('2') }))
    })
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('正在校验图片')

    await act(async () => rejectSecond(new Error('corrupt image')))
    expect(host.textContent).toContain('图片校验失败')

    await act(async () => {
      root.render(createElement(TextAdventureMediaThumbnail, { scope, asset: asset('3') }))
    })
    expect(host.textContent).not.toContain('图片校验失败')
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:asset-3')

    const enlarge = host.querySelector<HTMLButtonElement>('button[aria-label="放大查看 media.visual.3"]')!
    await act(async () => enlarge.click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    const close = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '关闭')!
    expect(close.tabIndex).toBe(0)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-1')
  })
})
