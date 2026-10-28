import { assertAvgRegionCompositeRasterV1 } from './image-region-composite-contract'

/** Narrow lossless codec for local composition, not a general PNG decoder.
 * RGB/RGBA 8-bit, non-interlaced, untagged/sRGB only; unsupported semantics fail.
 * W3C PNG 3 §§6.2, 9, 10, 11; WHATWG Compression Standard (deflate/zlib).
 * No Canvas premultiplication, third-party codec, model or network operation. */
export const AVG_STRAIGHT_PNG_CODEC_V1 = 'storyforge.avg.png.rgba8-streams.v1' as const
const MAX_PNG_BYTES = 32 * 1024 * 1024
const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let c = value
  for (let bit = 0; bit < 8; bit++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function aborted() { return new DOMException('AVG straight PNG aborted', 'AbortError') }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw aborted() }
function concat(chunks: readonly Uint8Array[], length = chunks.reduce((sum, p) => sum + p.length, 0)): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index++) result[4 + index] = type.charCodeAt(index)
  result.set(data, 8); view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
  return result
}
async function transform(data: Uint8Array<ArrayBuffer>, mode: 'compress' | 'decompress', maximum: number, signal?: AbortSignal) {
  checkAbort(signal)
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') throw new Error('[avg-png] 当前环境缺少有界原生 deflate 流')
  let position = 0
  const source = new ReadableStream<BufferSource>({ pull(controller) {
    checkAbort(signal)
    if (position === data.length) { controller.close(); return }
    controller.enqueue(data.subarray(position, position + 16384)); position += Math.min(16384, data.length - position)
  } })
  const reader = source.pipeThrough(mode === 'compress' ? new CompressionStream('deflate') : new DecompressionStream('deflate')).getReader()
  let length = 0, complete = false, timedOut = false
  const chunks: Uint8Array[] = [], cancel = () => { void reader.cancel().catch(() => undefined) }
  const timer = setTimeout(() => { timedOut = true; cancel() }, 20_000)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      checkAbort(signal)
      const result = await reader.read()
      checkAbort(signal)
      if (timedOut) throw new Error('[avg-png] 本地 deflate 超时')
      if (result.done) { complete = true; break }
      length += result.value.byteLength
      if (length > maximum) throw new Error('[avg-png] 解码/编码字节超过准确上限')
      chunks.push(result.value)
    }
    return concat(chunks, length)
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel)
    if (!complete) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

interface Header { width: number; height: number; channels: 3 | 4 }
function parseHeader(data: Uint8Array): Header {
  if (data.length !== 13) throw new Error('[avg-png] IHDR 长度无效')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const width = view.getUint32(0), height = view.getUint32(4), color = data[9]
  assertAvgRegionCompositeRasterV1(width, height, width * height * 4)
  if (data[8] !== 8 || (color !== 2 && color !== 6) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
    throw new Error('[avg-png] 仅支持非交错 RGB/RGBA8；不隐式转换位深或色彩')
  }
  return { width, height, channels: color === 2 ? 3 : 4 }
}
function parseChunks(data: Uint8Array): { header: Header; compressed: Uint8Array<ArrayBuffer> } {
  if (data.length < 57 || data.length > MAX_PNG_BYTES || SIGNATURE.some((value, i) => data[i] !== value)) throw new Error('[avg-png] PNG 签名或字节预算无效')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), idat: Uint8Array[] = []
  let offset = 8, header: Header | null = null, seenEnd = false, idatEnded = false, srgb = false, chunkCount = 0
  while (offset + 12 <= data.length) {
    if (++chunkCount > 16384) throw new Error('[avg-png] chunk 数量超过预算')
    const length = view.getUint32(offset), end = offset + length + 12
    if (end > data.length || length > MAX_PNG_BYTES) throw new Error('[avg-png] chunk 越界')
    const typeBytes = data.subarray(offset + 4, offset + 8), type = String.fromCharCode(...typeBytes), body = data.subarray(offset + 8, end - 4)
    if (!/^[A-Za-z]{4}$/.test(type) || (typeBytes[2] & 32) || crc32(data.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('[avg-png] chunk 名称/CRC 无效')
    if (seenEnd || (!header && type !== 'IHDR')) throw new Error('[avg-png] chunk 顺序无效')
    if (type === 'IHDR') {
      if (header || offset !== 8) throw new Error('[avg-png] 重复 IHDR')
      header = parseHeader(body)
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('[avg-png] IDAT 必须连续')
      idat.push(body)
    } else if (type === 'IEND') {
      if (length !== 0 || !idat.length || end !== data.length) throw new Error('[avg-png] IEND/尾随数据无效')
      seenEnd = true
    } else {
      if (idat.length) idatEnded = true
      if (type === 'sRGB') {
        if (srgb || idat.length || body.length !== 1 || body[0] > 3) throw new Error('[avg-png] sRGB 声明无效')
        srgb = true
      } else if (!(typeBytes[0] & 32) || ['tRNS', 'acTL', 'fcTL', 'fdAT', 'iCCP', 'gAMA', 'cHRM', 'cICP', 'sBIT', 'mDCV', 'cLLI', 'eXIf'].includes(type)) {
        throw new Error('[avg-png] 不支持该关键 chunk、颜色/透明或动画语义')
      }
    }
    offset = end
  }
  if (!header || !seenEnd || offset !== data.length) throw new Error('[avg-png] PNG 未完整结束')
  return { header, compressed: concat(idat) }
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
  return da <= db && da <= dc ? a : db <= dc ? b : c
}
function unfilter(filtered: Uint8Array, header: Header, signal?: AbortSignal): Uint8ClampedArray<ArrayBuffer> {
  const stride = header.width * header.channels, rows = new Uint8Array(stride * header.height)
  const rgba = new Uint8ClampedArray(header.width * header.height * 4)
  for (let y = 0; y < header.height; y++) {
    checkAbort(signal)
    const filter = filtered[y * (stride + 1)]
    if (filter > 4) throw new Error('[avg-png] 未登记的 PNG filter')
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= header.channels ? rows[i - header.channels] : 0,
        b = y ? rows[i - stride] : 0, c = y && x >= header.channels ? rows[i - stride - header.channels] : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c)
      rows[i] = (filtered[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  for (let pixel = 0; pixel < header.width * header.height; pixel++) {
    const source = pixel * header.channels, target = pixel * 4
    rgba[target] = rows[source]; rgba[target + 1] = rows[source + 1]; rgba[target + 2] = rows[source + 2]
    rgba[target + 3] = header.channels === 4 ? rows[source + 3] : 255
  }
  return rgba
}
export async function decodeAvgStraightPngV1(data: ArrayBuffer, signal?: AbortSignal) {
  checkAbort(signal)
  if (!(data instanceof ArrayBuffer)) throw new Error('[avg-png] 只接受独占 ArrayBuffer')
  const { header, compressed } = parseChunks(new Uint8Array(data)), expected = (header.width * header.channels + 1) * header.height
  const rows = await transform(compressed, 'decompress', expected, signal)
  if (rows.length !== expected) throw new Error('[avg-png] 解码扫描线长度与准确画布不符')
  return { width: header.width, height: header.height, rgba: unfilter(rows, header, signal), codec: AVG_STRAIGHT_PNG_CODEC_V1 }
}
export async function encodeAvgStraightPngV1(input: { width: number; height: number; rgba: Uint8ClampedArray; signal?: AbortSignal }): Promise<ArrayBuffer> {
  checkAbort(input.signal)
  if (!(input.rgba instanceof Uint8ClampedArray) || !(input.rgba.buffer instanceof ArrayBuffer)
    || input.rgba.byteOffset !== 0 || input.rgba.buffer.byteLength !== input.rgba.byteLength) throw new Error('[avg-png] 只接受独占 RGBA8 ArrayBuffer')
  assertAvgRegionCompositeRasterV1(input.width, input.height, input.rgba.byteLength)
  const stride = input.width * 4, filtered = new Uint8Array((stride + 1) * input.height)
  for (let y = 0; y < input.height; y++) {
    checkAbort(input.signal)
    filtered[y * (stride + 1)] = 1 // Lossless Sub filter, including straight alpha.
    for (let x = 0; x < stride; x++) filtered[y * (stride + 1) + x + 1] = (input.rgba[y * stride + x] - (x < 4 ? 0 : input.rgba[y * stride + x - 4])) & 255
  }
  const compressed = await transform(filtered, 'compress', MAX_PNG_BYTES - 70, input.signal)
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer)
  view.setUint32(0, input.width); view.setUint32(4, input.height); ihdr[8] = 8; ihdr[9] = 6
  const result = concat([SIGNATURE, chunk('IHDR', ihdr), chunk('sRGB', new Uint8Array([0])), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())])
  checkAbort(input.signal)
  if (result.byteLength > MAX_PNG_BYTES) throw new Error('[avg-png] PNG 成品超过字节上限')
  return result.buffer
}
