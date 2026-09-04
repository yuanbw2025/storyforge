export const CHARACTER_ALPHA_MATTING_ID_V1 = 'storyforge.character-alpha.edge-connected.v1'

export interface CharacterAlphaMattingResultV1 {
  data: ArrayBuffer
  width: number
  height: number
  changed: boolean
  removedPixelRatio: number
  mattingId: typeof CHARACTER_ALPHA_MATTING_ID_V1
}

interface RgbaRasterV1 {
  width: number
  height: number
  data: Uint8ClampedArray
}

function fail(message: string): never {
  throw new Error(`[product-character-alpha] ${message}`)
}

function squaredDistance(data: Uint8ClampedArray, offset: number, color: readonly number[]): number {
  const red = data[offset] - color[0]
  const green = data[offset + 1] - color[1]
  const blue = data[offset + 2] - color[2]
  return red * red + green * green + blue * blue
}

function borderOffsets(width: number, height: number): number[] {
  const offsets: number[] = []
  for (let x = 0; x < width; x += 1) {
    offsets.push(x * 4)
    if (height > 1) offsets.push(((height - 1) * width + x) * 4)
  }
  for (let y = 1; y < height - 1; y += 1) {
    offsets.push((y * width) * 4)
    if (width > 1) offsets.push((y * width + width - 1) * 4)
  }
  return offsets
}

function openForegroundMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const eroded = new Uint8Array(mask.length)
  for (let y = radius; y < height - radius; y += 1) for (let x = radius; x < width - radius; x += 1) {
    let keep = true
    for (let dy = -radius; dy <= radius && keep; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (!mask[(y + dy) * width + x + dx]) { keep = false; break }
    }
    if (keep) eroded[y * width + x] = 1
  }
  const opened = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let keep = false
    for (let dy = -radius; dy <= radius && !keep; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const sampleX = x + dx; const sampleY = y + dy
      if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height
        && eroded[sampleY * width + sampleX]) { keep = true; break }
    }
    if (keep) opened[y * width + x] = 1
  }
  return opened
}

/**
 * Removes only backdrop-colored pixels connected to the canvas edge. This is
 * intentionally narrower than global chroma-keying: a white shirt or paper in
 * the middle of the character remains opaque because it is not edge-connected.
 */
export function matteEdgeConnectedCharacterBackdropV1(input: RgbaRasterV1): {
  data: Uint8ClampedArray
  removedPixelRatio: number
  alreadyTransparent: boolean
} {
  const { width, height } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > 10_000 || height > 10_000 || input.data.length !== width * height * 4) {
    fail('RGBA 栅格无效')
  }
  const data = new Uint8ClampedArray(input.data)
  let transparent = 0
  for (let offset = 3; offset < data.length; offset += 4) if (data[offset] < 250) transparent += 1
  if (transparent / (width * height) >= 0.001) {
    return { data, removedPixelRatio: transparent / (width * height), alreadyTransparent: true }
  }

  const borders = borderOffsets(width, height)
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>()
  for (const offset of borders) {
    const key = `${data[offset] >> 4}:${data[offset + 1] >> 4}:${data[offset + 2] >> 4}`
    const current = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    current.count += 1
    current.red += data[offset]
    current.green += data[offset + 1]
    current.blue += data[offset + 2]
    buckets.set(key, current)
  }
  const ranked = [...buckets.values()].sort((left, right) => right.count - left.count)
  const palette: number[][] = []
  let covered = 0
  for (const bucket of ranked) {
    if (palette.length >= 4 || bucket.count / borders.length < 0.03) break
    palette.push([
      Math.round(bucket.red / bucket.count),
      Math.round(bucket.green / bucket.count),
      Math.round(bucket.blue / bucket.count),
    ])
    covered += bucket.count
    if (covered / borders.length >= 0.78) break
  }
  if (palette.length === 0 || covered / borders.length < 0.45) fail('边缘背景色不稳定，拒绝自动抠图')

  const maximumDistanceSquared = 34 * 34
  const distanceAt = (pixelIndex: number) => {
    const offset = pixelIndex * 4
    return Math.min(...palette.map(color => squaredDistance(data, offset, color)))
  }
  const pixelCount = width * height
  const removed = new Uint8Array(pixelCount)
  const queue = new Uint32Array(pixelCount)
  let head = 0
  let tail = 0
  const enqueue = (pixelIndex: number) => {
    if (removed[pixelIndex] || distanceAt(pixelIndex) > maximumDistanceSquared) return
    removed[pixelIndex] = 1
    queue[tail++] = pixelIndex
  }
  for (const offset of borders) enqueue(offset / 4)
  while (head < tail) {
    const pixel = queue[head++]
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }
  const edgeRemovedPixelRatio = tail / pixelCount
  if (edgeRemovedPixelRatio < 0.05 || edgeRemovedPixelRatio > 0.92) {
    fail(`自动抠图移除比例异常:${edgeRemovedPixelRatio.toFixed(4)}`)
  }
  const edgeRemoved = removed.slice()
  // Agnes can paint thin checker/grid strokes that are detached from the
  // canvas edge. A small morphological opening removes those strokes without
  // globally keying neutral colours inside the character (shirts, paper, eyes).
  const foreground = new Uint8Array(pixelCount)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) foreground[pixel] = removed[pixel] ? 0 : 1
  const openedForeground = openForegroundMask(foreground, width, height, Math.max(width, height) >= 640 ? 2 : 1)
  let finalRemoved = 0
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!openedForeground[pixel]) { removed[pixel] = 1; finalRemoved += 1 }
  }
  const removedPixelRatio = finalRemoved / pixelCount
  if (removedPixelRatio > 0.92) {
    fail(`自动去网格后主体占比异常:${removedPixelRatio.toFixed(4)}`)
  }
  const opaqueDistance = 34
  const transparentDistance = 20
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!removed[pixel]) continue
    if (!edgeRemoved[pixel]) { data[pixel * 4 + 3] = 0; continue }
    const distance = Math.sqrt(distanceAt(pixel))
    data[pixel * 4 + 3] = distance <= transparentDistance
      ? 0
      : Math.round(Math.min(1, (distance - transparentDistance) / (opaqueDistance - transparentDistance)) * 255)
  }
  return { data, removedPixelRatio, alreadyTransparent: false }
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('[product-character-alpha] PNG 编码失败')),
    'image/png',
  ))
}

/** Browser-only governed post-process used before character media is frozen. */
export async function ensureGeneratedCharacterAlphaV1(data: ArrayBuffer, mimeType: string): Promise<CharacterAlphaMattingResultV1> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) fail('输入 MIME 不支持抠图')
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') fail('浏览器图片抠图能力不可用')
  const bitmap = await createImageBitmap(new Blob([data], { type: mimeType }))
  try {
    if (bitmap.width < 2 || bitmap.height < 2 || bitmap.width > 10_000 || bitmap.height > 10_000) {
      fail('解码图片尺寸无效')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) fail('Canvas 2D 不可用')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const matte = matteEdgeConnectedCharacterBackdropV1({
      width: bitmap.width, height: bitmap.height, data: pixels.data,
    })
    if (matte.alreadyTransparent) return {
      data: data.slice(0), width: bitmap.width, height: bitmap.height,
      changed: false, removedPixelRatio: matte.removedPixelRatio,
      mattingId: CHARACTER_ALPHA_MATTING_ID_V1,
    }
    pixels.data.set(matte.data)
    context.putImageData(pixels, 0, 0)
    const encoded = await (await canvasBlob(canvas)).arrayBuffer()
    return {
      data: encoded, width: bitmap.width, height: bitmap.height,
      changed: true, removedPixelRatio: matte.removedPixelRatio,
      mattingId: CHARACTER_ALPHA_MATTING_ID_V1,
    }
  } finally {
    bitmap.close()
  }
}
