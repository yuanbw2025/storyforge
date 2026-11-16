import { crc32 } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { db } from '../../src/lib/db/schema'
import {
  mediaObjectDataUrlV1, prepareMediaBlobV1, putPreparedMediaBlobV1,
  putVerifiedMediaBlobV1, readVerifiedMediaBlobV1, sha256BinaryV1,
} from '../../src/lib/media/blob-store'
import { encodeFixtureRasterV1, installRasterDecoderForVitestV1 } from '../helpers/raster-decoder-vitest'

installRasterDecoderForVitestV1()

function signatureOnlyPng(): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 1024)
  view.setUint32(20, 1536)
  return bytes.buffer
}

function editPngChunk(data: ArrayBuffer, name: string, mutate: (bytes: Uint8Array, offset: number) => void,
  fixCrc: boolean): ArrayBuffer {
  const bytes = new Uint8Array(data.slice(0)), view = new DataView(bytes.buffer)
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const end = offset + 8 + length
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === name) {
      mutate(bytes, offset + 8)
      if (fixCrc) view.setUint32(end, crc32(bytes.subarray(offset + 4, end)))
      return bytes.buffer
    }
    offset = end + 4
  }
  throw new Error('fixture PNG missing ' + name)
}

it('rejects the historical 32-byte fake PNG before preparing storage', async () => {
  await expect(prepareMediaBlobV1(signatureOnlyPng())).rejects.toThrow(/图片/u)
})

it.each(['image/png', 'image/jpeg', 'image/webp'] as const)(
  'decodes actual %s pixels and checks dimensions; rejects truncated bytes', async mimeType => {
    const data = encodeFixtureRasterV1(9, 16, mimeType)
    const result = await prepareMediaBlobV1(data)
    expect(result).toMatchObject({ mimeType, width: 9, height: 16, contentHash: await sha256BinaryV1(data) })
    expect(result.data).toEqual(data)
    await expect(prepareMediaBlobV1(data.slice(0, -3))).rejects.toThrow(/图片/u)
  },
)

it('rejects CRC damage, bad zlib with corrected CRC, false size and excessive pixels before bitmap allocation', async () => {
  const data = encodeFixtureRasterV1(9, 16)
  const decode = vi.spyOn(globalThis, 'createImageBitmap')
  try {
    const crcDamage = editPngChunk(data, 'IDAT', (bytes, at) => { bytes[at] ^= 1 }, false)
    const badCompression = editPngChunk(data, 'IDAT', (bytes, at) => { bytes[at] = 0 }, true)
    const fakeHeight = editPngChunk(data, 'IHDR', (bytes, at) => {
      new DataView(bytes.buffer).setUint32(at + 4, 64)
    }, true)
    const excessivePixels = editPngChunk(data, 'IHDR', (bytes, at) => {
      const view = new DataView(bytes.buffer)
      view.setUint32(at, 12_000); view.setUint32(at + 4, 12_000)
    }, true)
    await expect(prepareMediaBlobV1(crcDamage)).rejects.toThrow('CRC')
    await expect(prepareMediaBlobV1(badCompression)).rejects.toThrow('压缩')
    await expect(prepareMediaBlobV1(fakeHeight)).rejects.toThrow('截断')
    await expect(prepareMediaBlobV1(excessivePixels)).rejects.toThrow('总像素')
    expect(decode).not.toHaveBeenCalled()
  } finally { decode.mockRestore() }
})

it('rejects invalid coding parameters inside otherwise intact JPEG and WebP containers', async () => {
  const jpeg = new Uint8Array(encodeFixtureRasterV1(9, 16, 'image/jpeg'))
  const sof = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xc0)
  expect(sof).toBeGreaterThan(0)
  // An impossible JPEG sample precision in a complete SOF; lengths and EOI remain valid.
  jpeg[sof + 4] = 255
  await expect(prepareMediaBlobV1(jpeg.buffer)).rejects.toThrow('JPEG 帧头无效')

  const webp = new Uint8Array(encodeFixtureRasterV1(9, 16, 'image/webp'))
  const view = new DataView(webp.buffer)
  for (let offset = 12; offset + 8 < webp.length;) {
    const kind = String.fromCharCode(...webp.subarray(offset, offset + 4))
    const length = view.getUint32(offset + 4, true)
    if (kind === 'VP8 ') {
      webp[offset + 8] |= 0xe0
      webp[offset + 9] = 0xff
      webp[offset + 10] = 0xff
      break
    }
    if (kind === 'VP8L') {
      webp[offset + 12] |= 0xe0
      break
    }
    offset += 8 + length + (length & 1)
  }
  await expect(prepareMediaBlobV1(webp.buffer)).rejects.toThrow(/WebP.*(分区|版本)/u)
})

it('fails closed without a real bitmap, and closes a bitmap that arrives after the timeout', async () => {
  const data = encodeFixtureRasterV1(9, 16, 'image/jpeg')
  const original = globalThis.createImageBitmap
  try {
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: undefined })
    await expect(prepareMediaBlobV1(data)).rejects.toThrow('解码能力不可用')
    vi.useFakeTimers()
    let finish!: (bitmap: ImageBitmap) => void
    const close = vi.fn()
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true,
      value: () => new Promise<ImageBitmap>(resolve => { finish = resolve }),
    })
    const rejection = expect(prepareMediaBlobV1(data)).rejects.toThrow('解码超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    finish({ width: 9, height: 16, close } as ImageBitmap)
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true, value: original })
  }
})

it('stores only a verified immutable snapshot; keeps historical bad bytes on failed reads', async () => {
  const {scope} = await createWorkspace({
    name: '042 isolated media', genres: ['other'], status: 'drafting', description: '',
    targetWordCount: 5_000, enableMultiWorld: false,
  }, {kind: 'novel', novelProfile: 'short'})
  const fake = signatureOnlyPng()
  await expect(putVerifiedMediaBlobV1({scope, data: fake})).rejects.toThrow(/图片/u)
  expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
  const data = encodeFixtureRasterV1(1024, 1536)
  const before = data.slice(0)
  const prepared = await prepareMediaBlobV1(data)
  new Uint8Array(data).fill(0)
  new Uint8Array(prepared.data).fill(0)
  await expect(putPreparedMediaBlobV1(scope, { ...prepared })).rejects.toThrow('尚未经共享解码')
  const row = await putPreparedMediaBlobV1(scope, prepared)
  expect(row.data).toEqual(before)
  expect((await readVerifiedMediaBlobV1({scope, blobObjectId: row.id})).data).toEqual(before)

  const damaged = { data: fake, byteSize: fake.byteLength, contentHash: await sha256BinaryV1(fake) }
  await db.mediaBlobObjects.update(row.id, damaged)
  await expect(readVerifiedMediaBlobV1({scope, blobObjectId: row.id})).rejects.toThrow(/图片/u)
  await expect(mediaObjectDataUrlV1({scope, blobObjectId: row.id})).rejects.toThrow(/图片/u)
  expect(await db.mediaBlobObjects.get(row.id)).toMatchObject(damaged)
})

const apngFixture = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAEAAAAAwAAAAAAAAAAAAEACgAAzHMM+wAAABBJREFUeJxjuCOnAUcMODkAEboNmfVnZD4AAAAaZmNUTAAAAAEAAAAEAAAAAwAAAAAAAAAAAAEACgAAVwDmLwAAABRmZEFUAAAAAnicY5A8EQVHDDg5AB0YDsVni2y7AAAAAElFTkSuQmCC'), value => value.charCodeAt(0)).buffer

it('requires animation capability and bounds frame count before opening the decoder', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder')
  try {
    Object.defineProperty(globalThis, 'ImageDecoder', {configurable: true, value: undefined})
    await expect(prepareMediaBlobV1(apngFixture())).rejects.toThrow('动画解码能力不可用')
    const excessiveFrames = editPngChunk(apngFixture(), 'acTL', (bytes, at) => {
      new DataView(bytes.buffer).setUint32(at, 121)
    }, true)
    await expect(prepareMediaBlobV1(excessiveFrames)).rejects.toThrow('动画帧数或累计像素超出上限')
  } finally {
    if (original) Object.defineProperty(globalThis, 'ImageDecoder', original)
    else Reflect.deleteProperty(globalThis, 'ImageDecoder')
  }
})

it('rejects corrupted second-frame PNG compression even with a correct frame CRC', async () => {
  const malformed = editPngChunk(apngFixture(), 'fdAT', (bytes, at) => { bytes[at + 4] = 0 }, true)
  await expect(prepareMediaBlobV1(malformed)).rejects.toThrow('压缩像素数据校验失败')
})

it('rejects an incomplete second frame and releases both decoded frames and the decoder', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder')
  const releaseFrame = vi.fn()
  const releaseDecoder = vi.fn()
  const decode = vi.fn(async ({frameIndex}: {frameIndex: number}) => ({
    complete: frameIndex === 0,
    image: {codedWidth: 4, codedHeight: 3, close: releaseFrame},
  }))
  class IncompleteAnimationDecoder {
    static async isTypeSupported() { return true }
    readonly completed = Promise.resolve()
    readonly tracks = {ready: Promise.resolve(), selectedTrack: {frameCount: 2}}
    readonly decode = decode
    readonly close = releaseDecoder
  }
  try {
    Object.defineProperty(globalThis, 'ImageDecoder', {configurable: true, value: IncompleteAnimationDecoder})
    await expect(prepareMediaBlobV1(apngFixture())).rejects.toThrow('动画帧不完整')
    expect(decode.mock.calls).toEqual([
      [{frameIndex: 0, completeFramesOnly: true}], [{frameIndex: 1, completeFramesOnly: true}],
    ])
    expect(releaseFrame).toHaveBeenCalledTimes(2)
    expect(releaseDecoder).toHaveBeenCalledOnce()
  } finally {
    if (original) Object.defineProperty(globalThis, 'ImageDecoder', original)
    else Reflect.deleteProperty(globalThis, 'ImageDecoder')
  }
})
