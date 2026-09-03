import type { ProductPlaythroughBrowserEnvironmentV1, ProductMediaRuntimeMeasurementV1 } from './quality-receipts'
import { analyzeDecodedProductAudioPcmV1, type ProductAudioQualityAnalysisV1 } from './audio-quality-analyzer'

export interface ProductMediaRuntimeAssetDescriptorV1 {
  assetKey: string
  contentHash: string
  mimeType: string
  width: number | null
  height: number | null
  durationMs: number | null
}

export interface ProductMediaRuntimeDecoderV1 {
  image(url: string, timeoutMs: number): Promise<{ width: number; height: number; hasAlpha: boolean }>
  audio(url: string, timeoutMs: number): Promise<ProductAudioQualityAnalysisV1>
}

function withTimeout<T>(input: {
  timeoutMs: number
  timeoutCode: string
  start: (resolve: (value: T) => void, reject: (reason: Error) => void) => () => void
}): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = 0
    let cleanup: () => void = () => undefined
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      cleanup()
      callback()
    }
    cleanup = input.start(
      value => finish(() => resolve(value)),
      reason => finish(() => reject(reason)),
    )
    timer = window.setTimeout(() => finish(() => reject(new Error(input.timeoutCode))), input.timeoutMs)
  })
}

const browserDecoder: ProductMediaRuntimeDecoderV1 = {
  image(url, timeoutMs) {
    return withTimeout({
      timeoutMs, timeoutCode: 'image-decode-timeout',
      start(resolve, reject) {
        const image = new Image()
        image.onload = () => {
          if (image.naturalWidth < 1 || image.naturalHeight < 1) {
            reject(new Error('image-zero-dimensions')); return
          }
          try {
            const maximumProbeDimension = 512
            const scale = Math.min(1, maximumProbeDimension / Math.max(image.naturalWidth, image.naturalHeight))
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (!context) throw new Error('image-alpha-probe-unavailable')
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
            let hasAlpha = false
            for (let index = 3; index < pixels.length; index += 4) {
              if (pixels[index] < 255) { hasAlpha = true; break }
            }
            resolve({ width: image.naturalWidth, height: image.naturalHeight, hasAlpha })
          } catch (cause) {
            reject(cause instanceof Error ? cause : new Error('image-alpha-probe-failed'))
          }
        }
        image.onerror = () => reject(new Error('image-decode-failed'))
        image.src = url
        return () => { image.onload = null; image.onerror = null; image.src = '' }
      },
    })
  },
  async audio(url, timeoutMs) {
    if (typeof AudioContext === 'undefined') throw new Error('audio-context-unavailable')
    const controller = new AbortController()
    const context = new AudioContext()
    let timer = 0
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort(); reject(new Error('audio-decode-timeout'))
        }, timeoutMs)
      })
      return await Promise.race([timeout, (async () => {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error('audio-blob-fetch-failed')
        const bytes = await response.arrayBuffer()
        const decoded = await context.decodeAudioData(bytes.slice(0))
        const channels = Array.from(
          { length: decoded.numberOfChannels },
          (_, index) => Float32Array.from(decoded.getChannelData(index)),
        )
        return analyzeDecodedProductAudioPcmV1({ channels, sampleRateHz: decoded.sampleRate })
      })()])
    } catch (cause) {
      if (cause instanceof Error && /^[a-z0-9][a-z0-9-]{0,99}$/.test(cause.message)) throw cause
      throw new Error('audio-decode-failed')
    } finally {
      window.clearTimeout(timer)
      controller.abort()
      await context.close().catch(() => undefined)
    }
  },
}

function failureCode(cause: unknown): string {
  const value = cause instanceof Error ? cause.message : String(cause)
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(value) ? value : 'media-decode-failed'
}

/**
 * Decodes every Build Preview media object in the real browser runtime. This
 * is intentionally separate from byte/MIME validation: a commercial package
 * must prove that the browser can actually render or play the exact hashes.
 */
export async function verifyProductMediaRuntimeUrlsV1(input: {
  assets: ProductMediaRuntimeAssetDescriptorV1[]
  urls: Record<string, string>
  environment: ProductPlaythroughBrowserEnvironmentV1
  measuredAt?: number
  timeoutMs?: number
  decoder?: ProductMediaRuntimeDecoderV1
}): Promise<ProductMediaRuntimeMeasurementV1> {
  const decoder = input.decoder ?? browserDecoder
  const timeoutMs = input.timeoutMs ?? 15_000
  const results = await Promise.all([...input.assets]
    .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
    .map(async asset => {
      const mediaClass = asset.mimeType.startsWith('image/') ? 'image' as const
        : asset.mimeType.startsWith('audio/') ? 'audio' as const : null
      const url = input.urls[asset.assetKey]
      const reportedClass: 'image' | 'audio' | 'unsupported' = mediaClass ?? 'unsupported'
      if (!mediaClass || !url) return {
        assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
        mediaClass: reportedClass, status: 'failed' as const,
        decodedWidth: null, decodedHeight: null, decodedDurationMs: null,
        decodedHasAlpha: null, decodedChannelCount: null, decodedSampleRateHz: null,
        integratedLufs: null, truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [],
        failureCode: mediaClass ? 'media-url-missing' : 'media-type-unsupported',
      }
      try {
        if (mediaClass === 'image') {
          const decoded = await decoder.image(url, timeoutMs)
          return {
            assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
            mediaClass, status: 'decoded' as const, decodedWidth: decoded.width,
            decodedHeight: decoded.height, decodedDurationMs: null, decodedHasAlpha: decoded.hasAlpha,
            decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
            truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null,
          }
        }
        const decoded = await decoder.audio(url, timeoutMs)
        return {
          assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
          mediaClass, status: 'decoded' as const, decodedWidth: null, decodedHeight: null,
          decodedDurationMs: decoded.durationMs, decodedHasAlpha: null,
          decodedChannelCount: decoded.channelCount, decodedSampleRateHz: decoded.sampleRateHz,
          integratedLufs: decoded.integratedLufs, truePeakDbtp: decoded.truePeakDbtp,
          loopSeamDbfs: decoded.loopSeamDbfs, policyFailures: [], failureCode: null,
        }
      } catch (cause) {
        return {
          assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
          mediaClass, status: 'failed' as const, decodedWidth: null, decodedHeight: null,
          decodedDurationMs: null, decodedHasAlpha: null, decodedChannelCount: null,
          decodedSampleRateHz: null, integratedLufs: null, truePeakDbtp: null,
          loopSeamDbfs: null, policyFailures: [], failureCode: failureCode(cause),
        }
      }
    }))
  return {
    assets: results,
    environment: structuredClone(input.environment),
    measuredAt: input.measuredAt ?? Date.now(),
  }
}
