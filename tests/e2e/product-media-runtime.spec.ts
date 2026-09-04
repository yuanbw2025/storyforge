import { expect, test } from '@playwright/test'

test('真实 Chromium 解码透明 PNG 与 PCM WAV，并产出可审计媒体指标', async ({ page, browserName }) => {
  await page.goto('./')

  const measurement = await page.evaluate(async currentBrowserName => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ verifyProductMediaRuntimeUrlsV1 }, { ensureGeneratedCharacterAlphaV1 }] = await Promise.all([
      importer('/storyforge/src/lib/product-production/media-runtime-verifier.ts'),
      importer('/storyforge/src/lib/product-production/character-alpha-matting.ts'),
    ])

    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 3
    const context = canvas.getContext('2d')
    if (!context) throw new Error('测试浏览器不支持 Canvas 2D')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(255, 0, 0, 0.5)'
    context.fillRect(1, 1, 2, 1)
    const imageBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('PNG 编码失败')),
      'image/png',
    ))

    const sampleRate = 48_000
    const channelCount = 2
    const sampleCount = sampleRate
    const bytesPerSample = 2
    const pcmBytes = sampleCount * channelCount * bytesPerSample
    const wav = new ArrayBuffer(44 + pcmBytes)
    const view = new DataView(wav)
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
    }
    writeAscii(0, 'RIFF')
    view.setUint32(4, 36 + pcmBytes, true)
    writeAscii(8, 'WAVE')
    writeAscii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channelCount, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true)
    view.setUint16(32, channelCount * bytesPerSample, true)
    view.setUint16(34, bytesPerSample * 8, true)
    writeAscii(36, 'data')
    view.setUint32(40, pcmBytes, true)
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const value = Math.round(Math.sin(2 * Math.PI * 440 * sample / sampleRate) * 0.1 * 32_767)
      for (let channel = 0; channel < channelCount; channel += 1) {
        view.setInt16(44 + (sample * channelCount + channel) * bytesPerSample, value, true)
      }
    }
    const audioBlob = new Blob([wav], { type: 'audio/wav' })

    const characterCanvas = document.createElement('canvas')
    characterCanvas.width = 20
    characterCanvas.height = 20
    const characterContext = characterCanvas.getContext('2d', { willReadFrequently: true })
    if (!characterContext) throw new Error('测试浏览器不支持角色 Canvas 2D')
    for (let y = 0; y < 20; y += 1) for (let x = 0; x < 20; x += 1) {
      characterContext.fillStyle = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? '#cccccc' : '#ffffff'
      characterContext.fillRect(x, y, 1, 1)
    }
    characterContext.fillStyle = '#1e3c78'
    characterContext.fillRect(6, 4, 8, 15)
    characterContext.fillStyle = '#ffffff'
    characterContext.fillRect(9, 8, 2, 4)
    const characterBlob = await new Promise<Blob>((resolve, reject) => characterCanvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('角色 PNG 编码失败')),
      'image/png',
    ))
    const alphaMatting = await ensureGeneratedCharacterAlphaV1(
      await characterBlob.arrayBuffer(),
      'image/png',
    )
    const mattedBitmap = await createImageBitmap(new Blob([alphaMatting.data], { type: 'image/png' }))
    const mattedCanvas = document.createElement('canvas')
    mattedCanvas.width = mattedBitmap.width
    mattedCanvas.height = mattedBitmap.height
    const mattedContext = mattedCanvas.getContext('2d', { willReadFrequently: true })
    if (!mattedContext) throw new Error('测试浏览器不支持抠图结果 Canvas 2D')
    mattedContext.drawImage(mattedBitmap, 0, 0)
    const mattedPixels = mattedContext.getImageData(0, 0, 20, 20).data
    mattedBitmap.close()

    const imageUrl = URL.createObjectURL(imageBlob)
    const audioUrl = URL.createObjectURL(audioBlob)
    const mattedUrl = URL.createObjectURL(new Blob([alphaMatting.data], { type: 'image/png' }))
    try {
      const runtimeMeasurement = await verifyProductMediaRuntimeUrlsV1({
        assets: [
          {
            assetKey: 'image.alpha-probe', contentHash: 'a'.repeat(64), mimeType: 'image/png',
            width: 4, height: 3, durationMs: null,
          },
          {
            assetKey: 'audio.pcm-probe', contentHash: 'b'.repeat(64), mimeType: 'audio/wav',
            width: null, height: null, durationMs: 1_000,
          },
          {
            assetKey: 'image.matted-character', contentHash: 'c'.repeat(64), mimeType: 'image/png',
            width: 20, height: 20, durationMs: null,
          },
        ],
        urls: {
          'image.alpha-probe': imageUrl,
          'audio.pcm-probe': audioUrl,
          'image.matted-character': mattedUrl,
        },
        environment: {
          browserName: currentBrowserName,
          browserVersion: navigator.userAgent,
          platform: navigator.platform || 'desktop',
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
        measuredAt: 1_787_300_000_000,
        timeoutMs: 10_000,
      })
      return {
        runtimeMeasurement,
        alphaMatting: {
          changed: alphaMatting.changed,
          mimeType: 'image/png',
          width: alphaMatting.width,
          height: alphaMatting.height,
          removedPixelRatio: alphaMatting.removedPixelRatio,
          mattingId: alphaMatting.mattingId,
          cornerAlpha: mattedPixels[3],
          internalWhiteAlpha: mattedPixels[((9 * 20 + 9) * 4) + 3],
        },
      }
    } finally {
      URL.revokeObjectURL(imageUrl)
      URL.revokeObjectURL(audioUrl)
      URL.revokeObjectURL(mattedUrl)
    }
  }, browserName)

  expect(measurement.runtimeMeasurement.assets).toHaveLength(3)
  expect(measurement.runtimeMeasurement.assets[0]).toMatchObject({
    assetKey: 'audio.pcm-probe', mediaClass: 'audio', status: 'decoded',
    decodedDurationMs: 1_000, decodedChannelCount: 2, decodedSampleRateHz: 48_000,
    failureCode: null,
  })
  expect(measurement.runtimeMeasurement.assets[0].integratedLufs).toBeGreaterThan(-40)
  expect(measurement.runtimeMeasurement.assets[0].integratedLufs).toBeLessThan(0)
  expect(measurement.runtimeMeasurement.assets[0].truePeakDbtp).toBeLessThan(-10)
  expect(measurement.runtimeMeasurement.assets[0].loopSeamDbfs).toBeLessThan(-30)
  expect(measurement.runtimeMeasurement.assets[1]).toMatchObject({
    assetKey: 'image.alpha-probe', mediaClass: 'image', status: 'decoded',
    decodedWidth: 4, decodedHeight: 3, decodedHasAlpha: true, failureCode: null,
  })
  expect(measurement.runtimeMeasurement.assets[2]).toMatchObject({
    assetKey: 'image.matted-character', mediaClass: 'image', status: 'decoded',
    decodedWidth: 20, decodedHeight: 20, decodedHasAlpha: true, failureCode: null,
  })
  expect(measurement.alphaMatting).toMatchObject({
    changed: true,
    mimeType: 'image/png',
    width: 20,
    height: 20,
    mattingId: 'storyforge.character-alpha.edge-connected.v1',
    cornerAlpha: 0,
    internalWhiteAlpha: 255,
  })
  expect(measurement.alphaMatting.removedPixelRatio).toBeGreaterThan(0.4)
})
