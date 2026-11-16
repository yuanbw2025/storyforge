import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, beforeEach } from 'vitest'

// Happy DOM exposes a bitmap stub. Substitute the already locked pdfjs
// native canvas only in the suites that exercise real raster admission.
export function installRasterDecoderForVitestV1(): void {
  let original: PropertyDescriptor | undefined
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true, writable: true,
      value: async (blob: Blob) => {
        const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
        if (!image.width || !image.height) throw new Error('fixture pixels could not be decoded')
        const probe = createCanvas(1, 1).getContext('2d')
        probe.drawImage(image, 0, 0, 1, 1)
        probe.getImageData(0, 0, 1, 1)
        return { width: image.width, height: image.height, close() { /* native temporary released by GC */ } }
      },
    })
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'createImageBitmap', original)
    else Reflect.deleteProperty(globalThis, 'createImageBitmap')
  })
}

export function encodeFixtureRasterV1(
  width: number, height: number,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
  color = '#405970',
): ArrayBuffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  const data = mimeType === 'image/png' ? canvas.toBuffer(mimeType)
    : mimeType === 'image/jpeg' ? canvas.toBuffer(mimeType, 85) : canvas.toBuffer(mimeType, 85)
  return new Uint8Array(data).buffer
}
