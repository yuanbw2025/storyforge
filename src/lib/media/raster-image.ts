// Container checks run before the platform allocates a decoded bitmap.
// PNG: https://www.w3.org/TR/png-3/
// JPEG: ITU-T T.81. WebP: https://developers.google.com/speed/webp/docs/riff_container
export type RasterImageMimeV1 = 'image/png' | 'image/jpeg' | 'image/webp'
export type RasterImageDimensionsV1 = { mimeType: RasterImageMimeV1; width: number; height: number }

export const MAX_RASTER_IMAGE_BYTES_V1 = 25 * 1024 * 1024
const maxEdge = 16_384
const maxPixels = 32 * 1024 * 1024
const maxFrames = 120
const maxAnimationPixels = 64 * 1024 * 1024

function fail(detail: string): never {
  throw new Error(`[media] 图片${detail}`)
}

export function isRasterImageMimeV1(value: string): value is RasterImageMimeV1 {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp'
}

function dimensionLimit(width: number, height: number): void {
  if (!width || !height || width > maxEdge || height > maxEdge || width * height > maxPixels) {
    fail('尺寸或总像素超出上限（单边 16384、总计 32 Mi 像素）')
  }
}

function animationLimit(width: number, height: number, frames: number): void {
  if (!frames || frames > maxFrames || width * height * frames > maxAnimationPixels) {
    fail('动画帧数或累计像素超出上限')
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit += 1) index = (index >>> 1) ^ (index & 1 ? 0xedb88320 : 0)
  return index
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function fourCC(bytes: Uint8Array, start: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + 4))
}

type PngScanlinesV1 = { idat: Uint8Array<ArrayBuffer>[]; rowSpans: Array<{ count: number; bytes: number }> }
type RasterContainerV1 = RasterImageDimensionsV1 & {
  swappedByExif?: boolean
  animationFrames?: number
  png?: PngScanlinesV1[]
}

function readPng(bytes: Uint8Array<ArrayBuffer>, view: DataView): RasterContainerV1 {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((byte, index) => bytes[index] === byte)) fail('PNG 签名无效')
  let width = 0, height = 0, depth = 0, color = 0, channels = 0, interlace = 0
  let offset = 8, chunks = 0, ended = false, palette = false, idatFinished = false
  let animationFrames = 0, animationControls = 0, animationSequence = 0
  const idat: Uint8Array<ArrayBuffer>[] = []
  const frames: Array<{width: number; height: number; idat: Uint8Array<ArrayBuffer>[]}> = []
  const colorModes: Record<number, { channels: number; depths: number[] }> = {
    0: { channels: 1, depths: [1, 2, 4, 8, 16] },
    2: { channels: 3, depths: [8, 16] },
    3: { channels: 1, depths: [1, 2, 4, 8] },
    4: { channels: 2, depths: [8, 16] },
    6: { channels: 4, depths: [8, 16] },
  }
  while (offset + 12 <= bytes.length) {
    if (++chunks > 16_384) fail('PNG 数据块数量超出上限')
    const length = view.getUint32(offset)
    const type = fourCC(bytes, offset + 4)
    const start = offset + 8, end = start + length
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || end + 4 > bytes.length) fail('PNG 数据块截断或无效')
    if (offset === 8 && type !== 'IHDR') fail('PNG 缺少首个 IHDR 数据块')
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) fail('PNG IHDR 数据块无效')
      width = view.getUint32(start); height = view.getUint32(start + 4)
      dimensionLimit(width, height)
      depth = bytes[start + 8]; color = bytes[start + 9]; interlace = bytes[start + 12]
      const mode = colorModes[color]
      if (!mode?.depths.includes(depth) || bytes[start + 10] || bytes[start + 11] || interlace > 1) {
        fail('PNG 像素格式无效')
      }
      channels = mode.channels
    } else if (type === 'PLTE') {
      if (palette || idat.length || !length || length % 3 || length > 768
        || color === 0 || color === 4 || (color === 3 && length / 3 > 2 ** depth)) fail('PNG 调色板无效')
      palette = true
    } else if (type === 'IDAT') {
      if (idatFinished || (color === 3 && !palette)) fail('PNG 像素数据块顺序无效')
      idat.push(bytes.subarray(start, end))
    } else if (type === 'IEND') {
      if (length || !idat.length || end + 4 !== bytes.length) fail('PNG 结束标记无效')
      ended = true
    } else if (type === 'acTL') {
      if (animationFrames || idat.length || length !== 8) fail('动画 PNG 控制块无效')
      animationFrames = view.getUint32(start)
      animationLimit(width, height, animationFrames)
    } else if (type === 'fcTL') {
      if (!animationFrames || length !== 26 || view.getUint32(start) !== animationSequence++) fail('动画 PNG 帧控制块无效')
      const frameWidth = view.getUint32(start + 4), frameHeight = view.getUint32(start + 8)
      const x = view.getUint32(start + 12), y = view.getUint32(start + 16)
      if (++animationControls > animationFrames || !frameWidth || !frameHeight
        || x + frameWidth > width || y + frameHeight > height || bytes[start + 24] > 2
        || bytes[start + 25] > 1) fail('动画 PNG 帧尺寸或控制参数无效')
      if (idat.length) frames.push({width: frameWidth, height: frameHeight, idat: []})
      else if (animationControls !== 1 || x || y || frameWidth !== width || frameHeight !== height) {
        fail('动画 PNG 默认帧必须匹配画布')
      }
    } else if (type === 'fdAT') {
      const frame = frames[frames.length - 1]
      if (!frame || length < 4 || view.getUint32(start) !== animationSequence++) fail('动画 PNG 帧数据无效')
      frame.idat.push(bytes.subarray(start + 4, end))
    } else if (/^[A-Z]/.test(type)) {
      fail('PNG 含不支持的关键数据块')
    }
    if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) fail('PNG 数据块 CRC 校验失败')
    if (idat.length && type !== 'IDAT') idatFinished = true
    offset = end + 4
    if (ended) break
  }
  if (!ended || animationFrames !== animationControls) fail('PNG 缺少完整像素数据、帧或结束标记')
  // One filter byte per scanline, including each nonempty Adam7 pass.
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const png = [{width, height, idat}, ...frames].map(frame => ({
    idat: frame.idat,
    rowSpans: passes.flatMap(([x, y, stepX, stepY]) => {
      if (x >= frame.width || y >= frame.height) return []
      const columns = Math.ceil((frame.width - x) / stepX), count = Math.ceil((frame.height - y) / stepY)
      return [{ count, bytes: 1 + Math.ceil(columns * channels * depth / 8) }]
    }),
  }))
  return { mimeType: 'image/png', width, height, animationFrames, png }
}

function exifSwapsAxes(bytes: Uint8Array<ArrayBuffer>, start: number, end: number): boolean {
  if (start + 8 > end) return false
  const tiff = new DataView(bytes.buffer, bytes.byteOffset + start, end - start)
  const order = tiff.getUint16(0)
  const littleEndian = order === 0x4949
  if ((!littleEndian && order !== 0x4d4d) || tiff.getUint16(2, littleEndian) !== 42) return false
  const ifd = tiff.getUint32(4, littleEndian)
  if (ifd < 8 || ifd + 2 > tiff.byteLength) return false
  const count = tiff.getUint16(ifd, littleEndian)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + 12 * i
    if (entry + 12 > tiff.byteLength) break
    if (tiff.getUint16(entry, littleEndian) !== 0x0112
      || tiff.getUint16(entry + 2, littleEndian) !== 3 || tiff.getUint32(entry + 4, littleEndian) !== 1) continue
    const orientation = tiff.getUint16(entry + 8, littleEndian)
    return orientation >= 5 && orientation <= 8
  }
  return false
}

function readJpeg(bytes: Uint8Array<ArrayBuffer>, view: DataView): RasterContainerV1 {
  let offset = 2, width = 0, height = 0, scans = 0, segments = 0, swappedByExif = false
  const sofMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
  while (offset < bytes.length) {
    if (++segments > 65_536 || bytes[offset++] !== 0xff) fail('JPEG 标记无效或数量超出上限')
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0xd9) {
      if (!width || !scans || offset !== bytes.length) fail('JPEG 缺少完整帧或结束标记无效')
      return { mimeType: 'image/jpeg', width, height, swappedByExif }
    }
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) {
      fail('JPEG 数据段无效')
    }
    if (marker === 0x01) continue // TEM has no length field.
    const length = view.getUint16(offset), start = offset + 2, end = offset + length
    if (length < 2 || end > bytes.length) fail('JPEG 数据段截断')
    if (sofMarkers.includes(marker)) {
      const precision = bytes[start]
      if (width || length < 11 || length !== 8 + 3 * bytes[start + 5]
        || precision < 2 || precision > 16 || (marker === 0xc0 && precision !== 8)) fail('JPEG 帧头无效')
      height = view.getUint16(start + 1); width = view.getUint16(start + 3)
      dimensionLimit(width, height)
    } else if (marker === 0xe1 && length >= 16 && fourCC(bytes, start) === 'Exif'
      && !bytes[start + 4] && !bytes[start + 5]) {
      swappedByExif ||= exifSwapsAxes(bytes, start + 6, end)
    }
    offset = end
    if (marker !== 0xda) continue
    if (!width || length < 8 || length !== 6 + 2 * bytes[start]) fail('JPEG 扫描头无效')
    scans += 1
    let entropyBytes = 0
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; entropyBytes += 1; continue }
      let next = offset + 1
      while (bytes[next] === 0xff) next += 1
      if (bytes[next] === 0x00) { offset = next + 1; entropyBytes += 1; continue }
      if (bytes[next] >= 0xd0 && bytes[next] <= 0xd7) { offset = next + 1; continue }
      break
    }
    if (!entropyBytes) fail('JPEG 缺少压缩像素数据')
  }
  return fail('JPEG 缺少完整结束标记')
}

function webpFrameSize(bytes: Uint8Array, view: DataView, kind: string, start: number, length: number) {
  if (kind === 'VP8 ') {
    if (length <= 10 || bytes[start] & 1 || bytes[start + 3] !== 0x9d
      || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) fail('WebP VP8 帧头无效')
    const firstPartition = (bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16)) >>> 5
    if (!firstPartition || firstPartition > length - 10) fail('WebP VP8 压缩分区长度无效')
    return { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff }
  }
  if (length <= 5 || bytes[start] !== 0x2f) fail('WebP VP8L 帧头无效')
  const packed = view.getUint32(start + 1, true)
  if (packed >>> 29) fail('WebP VP8L 版本无效')
  return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
}

function readWebp(bytes: Uint8Array<ArrayBuffer>, view: DataView): RasterContainerV1 {
  if (view.getUint32(4, true) !== bytes.length - 8 || fourCC(bytes, 8) !== 'WEBP') fail('WebP 容器长度无效')
  let width = 0, height = 0, canvasWidth = 0, canvasHeight = 0, swappedByExif = false
  let animated = false, hasAnimationHeader = false, animationFrames = 0
  let offset = 12, chunks = 0
  while (offset + 8 <= bytes.length) {
    if (++chunks > 16_384) fail('WebP 数据块数量超出上限')
    const kind = fourCC(bytes, offset)
    const length = view.getUint32(offset + 4, true), start = offset + 8, end = start + length
    if (end + (length & 1) > bytes.length || (length & 1 && bytes[end] !== 0)) fail('WebP 数据块截断或填充无效')
    if (kind === 'VP8X') {
      if (offset !== 12 || length !== 10) fail('WebP 扩展头无效')
      animated = Boolean(bytes[start] & 2)
      canvasWidth = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16)
      canvasHeight = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16)
      dimensionLimit(canvasWidth, canvasHeight)
    } else if (kind === 'ANIM') {
      if (!animated || hasAnimationHeader || length !== 6) fail('动画 WebP 控制块无效')
      hasAnimationHeader = true
    } else if (kind === 'ANMF') {
      if (!hasAnimationHeader || length < 24) fail('动画 WebP 帧数据无效')
      const uint24 = (index: number) => bytes[index] + (bytes[index + 1] << 8) + (bytes[index + 2] << 16)
      const frameWidth = uint24(start + 6) + 1, frameHeight = uint24(start + 9) + 1
      if (uint24(start) * 2 + frameWidth > canvasWidth
        || uint24(start + 3) * 2 + frameHeight > canvasHeight) fail('动画 WebP 帧超出画布')
      animationLimit(canvasWidth, canvasHeight, ++animationFrames)
      let frameOffset = start + 16, hasPixels = false
      while (frameOffset + 8 <= end) {
        if (++chunks > 16_384) fail('WebP 数据块数量超出上限')
        const frameKind = fourCC(bytes, frameOffset)
        const frameLength = view.getUint32(frameOffset + 4, true)
        const frameData = frameOffset + 8, frameEnd = frameData + frameLength
        if (frameEnd + (frameLength & 1) > end) fail('动画 WebP 压缩帧截断')
        if (frameKind === 'VP8 ' || frameKind === 'VP8L') {
          const size = webpFrameSize(bytes, view, frameKind, frameData, frameLength)
          if (hasPixels || size.width !== frameWidth || size.height !== frameHeight) fail('动画 WebP 帧尺寸无效')
          hasPixels = true
        }
        frameOffset = frameEnd + (frameLength & 1)
      }
      if (!hasPixels || frameOffset !== end) fail('动画 WebP 缺少完整压缩帧')
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (animated || width) fail('WebP 包含不相容的静态帧')
      const size = webpFrameSize(bytes, view, kind, start, length)
      width = size.width; height = size.height
      dimensionLimit(width, height)
    } else if (kind === 'EXIF') {
      const tiff = fourCC(bytes, start) === 'Exif' && length >= 6 ? start + 6 : start
      swappedByExif ||= exifSwapsAxes(bytes, tiff, end)
    }
    offset = end + (length & 1)
  }
  if (animated && animationFrames && offset === bytes.length) {
    return { mimeType: 'image/webp', width: canvasWidth, height: canvasHeight, animationFrames, swappedByExif }
  }
  if (offset !== bytes.length || !width || (canvasWidth && (width !== canvasWidth || height !== canvasHeight))) {
    fail('WebP 缺少完整静态帧或画布与帧尺寸不一致')
  }
  return { mimeType: 'image/webp', width, height, swappedByExif }
}

function inspectRasterContainer(data: ArrayBuffer): RasterContainerV1 {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 16 || data.byteLength > MAX_RASTER_IMAGE_BYTES_V1) {
    fail('体积非法或超过 25 MiB')
  }
  const bytes = new Uint8Array(data), view = new DataView(data)
  if (view.getUint32(0) === 0x89504e47) return readPng(bytes, view)
  if (view.getUint16(0) === 0xffd8) return readJpeg(bytes, view)
  if (fourCC(bytes, 0) === 'RIFF') return readWebp(bytes, view)
  return fail('仅支持可验证的 PNG、JPEG、WebP 静态图片')
}

async function verifyPngScanlines({ idat, rowSpans }: PngScanlinesV1): Promise<void> {
  if (typeof DecompressionStream !== 'function') fail('PNG 压缩校验不可用')
  // A browser may display a damaged PNG partially. Validate the full zlib
  // stream (including Adler-32) and its exact bounded scanline shape first.
  const reader = new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  let pass = 0, row = 0, remaining = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let offset = 0
      while (offset < value.length) {
        if (!remaining) {
          const span = rowSpans[pass]
          if (!span || value[offset] > 4) fail('PNG 解压扫描行长度或滤镜无效')
          remaining = span.bytes
          row += 1
          if (row === span.count) { pass += 1; row = 0 }
        }
        const consumed = Math.min(remaining, value.length - offset)
        remaining -= consumed
        offset += consumed
      }
    }
    if (remaining || pass !== rowSpans.length) fail('PNG 解压像素数据截断')
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    if (cause instanceof Error && cause.message.startsWith('[media]')) throw cause
    fail('PNG 压缩像素数据校验失败')
  } finally {
    reader.releaseLock()
  }
}

async function decodeAnimationV1(data: ArrayBuffer, container: RasterContainerV1): Promise<void> {
  if (typeof ImageDecoder !== 'function' || !await ImageDecoder.isTypeSupported(container.mimeType)) {
    fail('动画解码能力不可用；请更换浏览器或提供静态帧')
  }
  let decoder: ImageDecoder
  try { decoder = new ImageDecoder({ data, type: container.mimeType, preferAnimation: true }) }
  catch { return fail('动画解码器无法读取容器') }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('[media] 图片动画解码超时')), 15_000)
  })
  try {
    await Promise.race([timeout, (async () => {
      await Promise.all([decoder.tracks.ready, decoder.completed])
      const frameCount = decoder.tracks.selectedTrack?.frameCount
      if (!frameCount || frameCount !== container.animationFrames) fail('动画实际帧数与容器声明不一致')
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const { image, complete } = await decoder.decode({ frameIndex, completeFramesOnly: true })
        try {
          if (!complete || image.codedWidth !== container.width || image.codedHeight !== container.height) {
            fail('动画帧不完整或尺寸与画布不一致')
          }
        } finally { image.close() }
      }
    })()])
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('[media]')) throw cause
    fail('动画帧解码失败')
  } finally {
    clearTimeout(timer)
    decoder.close()
  }
}

export async function decodeRasterImageV1(data: ArrayBuffer): Promise<RasterImageDimensionsV1> {
  const container = inspectRasterContainer(data)
  const { mimeType, width, height, swappedByExif, png, animationFrames } = container
  for (const scanlines of png ?? []) await verifyPngScanlines(scanlines)
  if (animationFrames) {
    await decodeAnimationV1(data, container)
    return { mimeType, width, height }
  }
  if (typeof createImageBitmap !== 'function') fail('解码能力不可用；请使用支持图片解码的浏览器')
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error('[media] 图片解码超时'))
    }, 15_000)
  })
  const decode = Promise.resolve().then(() => createImageBitmap(new Blob([data], { type: mimeType }))).then(bitmap => {
    if (timedOut) bitmap.close()
    return bitmap
  }, () => fail('解码失败，无法读取像素'))
  const bitmap = await Promise.race([decode, timeout]).finally(() => clearTimeout(timer))
  try {
    const direct = bitmap.width === width && bitmap.height === height
    const oriented = swappedByExif && bitmap.width === height && bitmap.height === width
    if (!direct && !oriented) fail('解码尺寸与容器声明不一致')
    // Keep intrinsic dimensions stable for existing content-addressed rows;
    // EXIF rotation only changes the displayed orientation.
    return { mimeType, width, height }
  } finally {
    bitmap.close()
  }
}
