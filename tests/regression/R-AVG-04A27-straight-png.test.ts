// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { decodeAvgStraightPngV1, encodeAvgStraightPngV1 } from '../../src/lib/avg/image-straight-png'
import vectors from '../fixtures/avg-region-png/external-vectors-v1.json'
import negatives from '../fixtures/avg-region-png/negative-v1.json'

const bytes = (encoded: string): ArrayBuffer => new Uint8Array(Buffer.from(encoded, 'base64')).buffer
function pngImageData(data: ArrayBuffer) {
  const view = new DataView(data), array = new Uint8Array(data), chunks: Uint8Array[] = []
  for (let offset = 8; offset < data.byteLength;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...array.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') chunks.push(array.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  return inflateSync(Buffer.concat(chunks))
}
describe('AVG straight-alpha PNG codec — bounded experimental subset', () => {
  it.each(vectors)('decodes independent Pillow-verified color channels=$channels / filter=$filter, across IDAT boundaries', async vector => {
    const decoded = await decodeAvgStraightPngV1(bytes(vector.pngBase64))
    expect(decoded.width).toBe(vector.width); expect(decoded.height).toBe(vector.height)
    expect(Array.from(decoded.rgba)).toEqual(vector.expectedRgba)
  })
  it('preserves invisible RGB and low alpha in the encoded PNG, independently inflated by node:zlib', async () => {
    const vector = vectors.find(v => v.channels === 4 && v.filter === 1)!
    const rgba = new Uint8ClampedArray(vector.expectedRgba)
    const encoded = await encodeAvgStraightPngV1({ width: vector.width, height: vector.height, rgba })
    expect(pngImageData(encoded)).toEqual(Buffer.from(vector.expectedRgbaSubBase64, 'base64'))
    const decoded = await decodeAvgStraightPngV1(encoded)
    expect(Array.from(decoded.rgba)).toEqual(vector.expectedRgba)
    expect(Array.from(rgba)).toEqual(vector.expectedRgba)
  })
  it.each(Object.entries(negatives))('rejects %s without interpreting unsupported semantics or oversized output', async (_name, data) => {
    await expect(decodeAvgStraightPngV1(bytes(data))).rejects.toThrow()
  })
  it('rejects a corrupt CRC, incomplete PNG and incorrect RGBA input length', async () => {
    const encoded = bytes(vectors[0].pngBase64), corrupted = encoded.slice(0)
    new Uint8Array(corrupted)[29] ^= 1
    await expect(decodeAvgStraightPngV1(corrupted)).rejects.toThrow(/CRC/)
    await expect(decodeAvgStraightPngV1(encoded.slice(0, -1))).rejects.toThrow()
    await expect(encodeAvgStraightPngV1({ width: 7, height: 5, rgba: new Uint8ClampedArray(139) })).rejects.toThrow(/RGBA/)
  })
  it('honors pre-cancel and stream cancellation; neither returns a late PNG', async () => {
    const vector = vectors[5], rgba = new Uint8ClampedArray(vector.expectedRgba), controller = new AbortController()
    const pending = encodeAvgStraightPngV1({ width: vector.width, height: vector.height, rgba, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    await expect(decodeAvgStraightPngV1(bytes(vector.pngBase64), controller.signal)).rejects.toThrow(/aborted/)
  })
  it('rejects wrong byte types and shared/hidden backing storage before native compression', async () => {
    const wrong = new Uint16Array(70) as unknown as Uint8ClampedArray
    const hidden = new Uint8ClampedArray(144).subarray(4)
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(140))
    for (const rgba of [wrong, hidden, shared]) await expect(encodeAvgStraightPngV1({ width: 7, height: 5, rgba })).rejects.toThrow(/ArrayBuffer/)
    await expect(decodeAvgStraightPngV1(new SharedArrayBuffer(64) as ArrayBuffer)).rejects.toThrow(/ArrayBuffer/)
  })
  it('bounds container chunk count before allocating millions of tiny IDAT views', async () => {
    const original = Buffer.from(vectors[0].pngBase64, 'base64')
    const firstIdatLength = original.readUInt32BE(33)
    const firstIdat = original.subarray(33, 45 + firstIdatLength)
    const crowded = Buffer.concat([original.subarray(0, 33), ...Array<Buffer>(16385).fill(firstIdat), original.subarray(-12)])
    await expect(decodeAvgStraightPngV1(new Uint8Array(crowded).buffer)).rejects.toThrow(/chunk.*预算/)
  })
})
