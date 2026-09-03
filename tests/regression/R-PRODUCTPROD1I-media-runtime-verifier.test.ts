import { describe, expect, it, vi } from 'vitest'
import { verifyProductMediaRuntimeUrlsV1 } from '../../src/lib/product-production/media-runtime-verifier'

const environment = {
  browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
  viewport: { width: 1440, height: 900 },
}

describe('R-PRODUCTPROD-1I · real browser media runtime verifier', () => {
  it('按稳定 assetKey 解码图片与音频，并冻结透明度、声道、采样率和本地音频分析', async () => {
    const decoder = {
      image: vi.fn(async () => ({ width: 1024, height: 576, hasAlpha: false })),
      audio: vi.fn(async () => ({
        durationMs: 3_042, channelCount: 2, sampleRateHz: 48_000,
        integratedLufs: -18, truePeakDbtp: -2, loopSeamDbfs: -40,
      })),
    }
    const result = await verifyProductMediaRuntimeUrlsV1({
      assets: [
        { assetKey: 'music.opening', contentHash: 'b'.repeat(64), mimeType: 'audio/mpeg', width: null, height: null, durationMs: 3_000 },
        { assetKey: 'image.opening', contentHash: 'a'.repeat(64), mimeType: 'image/png', width: 1024, height: 576, durationMs: null },
      ],
      urls: { 'image.opening': 'blob:image', 'music.opening': 'blob:audio' },
      environment, measuredAt: 123, decoder,
    })
    expect(result).toEqual({
      assets: [
        {
          assetKey: 'image.opening', contentHash: 'a'.repeat(64), mimeType: 'image/png',
          mediaClass: 'image', status: 'decoded', decodedWidth: 1024, decodedHeight: 576,
          decodedDurationMs: null, decodedHasAlpha: false, decodedChannelCount: null,
          decodedSampleRateHz: null, integratedLufs: null, truePeakDbtp: null,
          loopSeamDbfs: null, policyFailures: [], failureCode: null,
        },
        {
          assetKey: 'music.opening', contentHash: 'b'.repeat(64), mimeType: 'audio/mpeg',
          mediaClass: 'audio', status: 'decoded', decodedWidth: null, decodedHeight: null,
          decodedDurationMs: 3_042, decodedHasAlpha: null, decodedChannelCount: 2,
          decodedSampleRateHz: 48_000, integratedLufs: -18, truePeakDbtp: -2,
          loopSeamDbfs: -40, policyFailures: [], failureCode: null,
        },
      ],
      environment, measuredAt: 123,
    })
  })

  it('缺失 object URL 与不支持的 MIME 明确产生 failed 证据，不调用 decoder', async () => {
    const decoder = {
      image: vi.fn(async () => ({ width: 1, height: 1, hasAlpha: false })),
      audio: vi.fn(async () => ({
        durationMs: 1, channelCount: 1, sampleRateHz: 44_100,
        integratedLufs: -18, truePeakDbtp: -2, loopSeamDbfs: -40,
      })),
    }
    const result = await verifyProductMediaRuntimeUrlsV1({
      assets: [
        { assetKey: 'image.missing', contentHash: 'c'.repeat(64), mimeType: 'image/png', width: 1, height: 1, durationMs: null },
        { assetKey: 'unknown', contentHash: 'd'.repeat(64), mimeType: 'application/octet-stream', width: null, height: null, durationMs: null },
      ],
      urls: {}, environment, measuredAt: 456, decoder,
    })
    expect(result.assets).toMatchObject([
      { assetKey: 'image.missing', mediaClass: 'image', status: 'failed', failureCode: 'media-url-missing' },
      { assetKey: 'unknown', mediaClass: 'unsupported', status: 'failed', failureCode: 'media-type-unsupported' },
    ])
    expect(decoder.image).not.toHaveBeenCalled()
    expect(decoder.audio).not.toHaveBeenCalled()
  })
})
