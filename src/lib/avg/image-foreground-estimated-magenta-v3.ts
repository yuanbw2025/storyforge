/** Explicit, local recovery for a mostly uniform but slightly shifted magenta
 * backdrop. This is a separate algorithm from exact-key V1 and boundary
 * unmix V2; it never changes the frozen provider request or accepts uncertain
 * borders. The output remains a candidate for visual review and adoption. */
export const AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3 = 'storyforge.avg.foreground.estimated-magenta-edge-unmix.v3' as const
export const AVG_FOREGROUND_ESTIMATED_MAGENTA_BASE_ID_V3 = 'storyforge.avg.foreground.estimated-magenta-edge-mask.v3' as const
const MAX_PIXELS = 4 * 1024 * 1024
const MAX_BOUNDARY_PIXELS = 200_000

export interface AvgForegroundEstimatedMagentaResultV3 {
  data: Uint8ClampedArray
  width: number
  height: number
  algorithm: typeof AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3
  baseAlgorithm: typeof AVG_FOREGROUND_ESTIMATED_MAGENTA_BASE_ID_V3
  backdropColor: { red: number; green: number; blue: number }
  backdropBorderCoverage: number
  algorithmMaskRatio: number
  clearedPixelCount: number
  translucentPixelCount: number
  opaquePixelCount: number
  correctedPixelCount: number
  unsupportedBoundaryPixelCount: number
  maxCompositeResidual: number
}

function fail(message: string): never { throw new Error(`[avg-foreground] ${message}`) }
function borderPixels(width: number, height: number) {
  const pixels: number[] = []
  for (let x = 0; x < width; x += 1) {
    pixels.push(x, (height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) pixels.push(y * width, y * width + width - 1)
  return pixels
}
function distanceSquared(data: Uint8ClampedArray, pixel: number, color: readonly number[]) {
  const offset = pixel * 4, dr = data[offset] - color[0], dg = data[offset + 1] - color[1], db = data[offset + 2] - color[2]
  return dr * dr + dg * dg + db * db
}
function inferBackdrop(data: Uint8ClampedArray, borders: number[]) {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>()
  for (const pixel of borders) {
    const offset = pixel * 4, key = `${data[offset] >> 4}:${data[offset + 1] >> 4}:${data[offset + 2] >> 4}`
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bucket.count += 1; bucket.red += data[offset]; bucket.green += data[offset + 1]; bucket.blue += data[offset + 2]
    buckets.set(key, bucket)
  }
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0]
  if (!dominant) fail('无法读取原图边缘底色')
  const color = [Math.round(dominant.red / dominant.count), Math.round(dominant.green / dominant.count), Math.round(dominant.blue / dominant.count)]
  const chromaRed = color[0] - color[1], chromaBlue = color[2] - color[1]
  if (Math.min(chromaRed, chromaBlue) < 45 || Math.abs(chromaRed - chromaBlue) > 115 || Math.min(color[0], color[2]) < 145) {
    fail('边缘主色不属于明确的品红色系；保留原图并拒绝估色加工')
  }
  let covered = 0
  for (const pixel of borders) {
    const offset = pixel * 4, r = data[offset] - data[offset + 1], b = data[offset + 2] - data[offset + 1]
    const sameFamily = Math.min(r, b) >= 35 && Math.abs(r - b) <= 135
    if (sameFamily && distanceSquared(data, pixel, color) <= 72 * 72) covered += 1
  }
  const coverage = covered / borders.length
  if (coverage < 0.85) fail(`品红系边缘覆盖率不足:${coverage.toFixed(4)}，要求至少0.8500`)
  return { color, coverage }
}
function followsBackdropHue(data: Uint8ClampedArray, pixel: number, background: readonly number[]) {
  const offset = pixel * 4, baseR = background[0] - background[1], baseB = background[2] - background[1]
  const red = data[offset] - data[offset + 1], blue = data[offset + 2] - data[offset + 1]
  const baseNorm = Math.hypot(baseR, baseB), norm = Math.hypot(red, blue)
  if (norm < 24 || baseNorm < 1) return false
  const cosine = (baseR * red + baseB * blue) / (baseNorm * norm)
  return cosine >= 0.985 && Math.min(red, blue) >= 15
}
function isBackgroundCandidate(data: Uint8ClampedArray, pixel: number, color: readonly number[]) {
  return distanceSquared(data, pixel, color) <= 78 * 78 || followsBackdropHue(data, pixel, color)
}

/** Deterministic numeric primitive only: no model, DB, rights, producer,
 * adoption, or preview authority. Background pixels must connect to the edge;
 * a homogeneous magenta-family shadow is removed with that same connected
 * mask. Local colour unmix changes only the narrow observed boundary band. */
export function matteAvgForegroundEstimatedMagentaV3(input: {
  width: number; height: number; data: Uint8ClampedArray
}): AvgForegroundEstimatedMagentaResultV3 {
  const { width, height, data: source } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > 10_000 || height > 10_000 || width * height > MAX_PIXELS
    || !(source instanceof Uint8ClampedArray) || source.length !== width * height * 4 || !(source.buffer instanceof ArrayBuffer)) {
    fail('估色前景所需的独立 RGBA 栅格或像素上限无效')
  }
  for (let offset = 3; offset < source.length; offset += 4) if (source[offset] !== 255) {
    fail('估色前景仅接受不透明原图；已有透明像素须使用其他明确来源')
  }
  const borders = borderPixels(width, height), { color: background, coverage } = inferBackdrop(source, borders)
  const count = width * height, removed = new Uint8Array(count), queue = new Uint32Array(count)
  let head = 0, tail = 0
  const enqueue = (pixel: number) => {
    if (removed[pixel] || !isBackgroundCandidate(source, pixel, background)) return
    removed[pixel] = 1; queue[tail++] = pixel
  }
  for (const pixel of borders) enqueue(pixel)
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }
  const maskRatio = tail / count
  if (maskRatio < 0.05 || maskRatio > 0.92) fail(`估色背景移除比例异常:${maskRatio.toFixed(4)}`)

  const horizontalBand = new Uint8Array(count), band = new Uint8Array(count), stable = new Uint8Array(count), output = new Uint8ClampedArray(source)
  const radius = 4
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    if (removed[pixel]) { output[pixel * 4 + 3] = 0; continue }
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = x + dx
      if (sx >= 0 && sx < width && removed[y * width + sx]) { horizontalBand[pixel] = 1; break }
    }
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x
    if (removed[pixel]) continue
    for (let dy = -radius; dy <= radius; dy += 1) {
      const sy = y + dy
      if (sy >= 0 && sy < height && horizontalBand[sy * width + x]) { band[pixel] = 1; break }
    }
    if (!band[pixel]) stable[pixel] = 1
  }
  let boundaryCandidates = 0
  for (let pixel = 0; pixel < count; pixel += 1) if (band[pixel]) boundaryCandidates += 1
  if (boundaryCandidates > MAX_BOUNDARY_PIXELS) fail('估色边缘候选超过明确的本地上限')

  let correctedPixelCount = 0, unsupportedBoundaryPixelCount = 0, maxCompositeResidual = 0
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (!band[pixel]) continue
    const x = pixel % width, y = Math.floor(pixel / width), offset = pixel * 4
    let best = -1, bestNorm = -1, bestAlpha = 0, bestResidual = 0
    for (let ay = Math.max(0, y - radius); ay <= Math.min(height - 1, y + radius); ay += 1) {
      for (let ax = Math.max(0, x - radius); ax <= Math.min(width - 1, x + radius); ax += 1) {
        const anchor = ay * width + ax
        if (!stable[anchor]) continue
        const at = anchor * 4
        const fr = source[at] - background[0], fg = source[at + 1] - background[1], fb = source[at + 2] - background[2]
        const norm = fr * fr + fg * fg + fb * fb
        if (norm <= bestNorm || norm < 70 * 70) continue
        const cr = source[offset] - background[0], cg = source[offset + 1] - background[1], cb = source[offset + 2] - background[2]
        const alpha = (fr * cr + fg * cg + fb * cb) / norm
        if (alpha <= 0.02 || alpha >= 0.995) continue
        const residual = Math.max(Math.abs(fr * alpha - cr), Math.abs(fg * alpha - cg), Math.abs(fb * alpha - cb))
        if (residual > 12) continue
        best = anchor; bestNorm = norm; bestAlpha = alpha; bestResidual = residual
      }
    }
    if (best < 0) { unsupportedBoundaryPixelCount += 1; continue }
    const at = best * 4
    output[offset] = source[at]; output[offset + 1] = source[at + 1]; output[offset + 2] = source[at + 2]
    output[offset + 3] = Math.round(bestAlpha * 255)
    correctedPixelCount += 1; maxCompositeResidual = Math.max(maxCompositeResidual, bestResidual)
  }
  let clearedPixelCount = 0, translucentPixelCount = 0, opaquePixelCount = 0
  for (let offset = 3; offset < output.length; offset += 4) {
    if (output[offset] === 0) clearedPixelCount += 1
    else if (output[offset] === 255) opaquePixelCount += 1
    else translucentPixelCount += 1
  }
  if (!clearedPixelCount || !opaquePixelCount || correctedPixelCount + unsupportedBoundaryPixelCount > MAX_BOUNDARY_PIXELS) {
    fail('估色处理没有形成有效透明前景与保留主体')
  }
  return { data: output, width, height, algorithm: AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3,
    baseAlgorithm: AVG_FOREGROUND_ESTIMATED_MAGENTA_BASE_ID_V3,
    backdropColor: { red: background[0], green: background[1], blue: background[2] },
    backdropBorderCoverage: coverage, algorithmMaskRatio: maskRatio, clearedPixelCount, translucentPixelCount,
    opaquePixelCount, correctedPixelCount, unsupportedBoundaryPixelCount, maxCompositeResidual }
}
