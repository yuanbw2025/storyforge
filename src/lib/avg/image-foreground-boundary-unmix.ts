import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, matteDeclaredMagentaCharacterBackdropV1 } from '../product-production/character-alpha-matting'

export const AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 = 'storyforge.avg.foreground.declared-magenta-boundary-unmix.v2' as const
const RADIUS = 4
const MAX_BOUNDARY_PIXELS = 200_000
const MAX_COMPOSITE_RESIDUAL = 1.5

export interface AvgForegroundBoundaryUnmixResultV2 {
  data: Uint8ClampedArray
  width: number
  height: number
  algorithm: typeof AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2
  baseAlgorithm: typeof DECLARED_MAGENTA_ALPHA_MATTING_ID_V1
  baseMaskRatio: number
  reservedBorderRatio: number
  clearedPixelCount: number
  translucentPixelCount: number
  opaquePixelCount: number
  correctedPixelCount: number
  unsupportedBoundaryPixelCount: number
  maxCompositeResidual: number
}

/** Numerical tool only. It grants no frozen policy, producer, rights or author
 * acceptance. The original declaration/limits are checked by the exact V1
 * matte. A distinct algorithm ID preserves all original V1 bytes and receipts.
 * Constant local foreground colour is a hypothesis, not semantic hair/text
 * segmentation. Unsupported samples retain their original V1 result.
 *
 * The iterator lets a future verifier yield between bounded rows; the initial
 * V1 mask is still synchronous. Do not claim an end-to-end UI/abort guarantee
 * until a versioned Worker and actual native path have separately passed. */
export function* iterateAvgForegroundBoundaryUnmixV2(input: {
  width: number; height: number; data: Uint8ClampedArray
}): Generator<void, AvgForegroundBoundaryUnmixResultV2, unknown> {
  const { width, height, data } = input
  if (!(data instanceof Uint8ClampedArray) || !(data.buffer instanceof ArrayBuffer)) throw new Error('[avg-foreground] 边缘还原需要独立的 RGBA 来源，不能接受共享像素内存')
  const base = matteDeclaredMagentaCharacterBackdropV1({ width, height, data })
  const source = new Uint8ClampedArray(data), output = new Uint8ClampedArray(base.data)
  const count = width * height, stable = new Uint8Array(count), norm = new Uint32Array(count)
  let band = new Uint8Array(count), nextBand = new Uint8Array(count)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x, offset = pixel * 4
      const red = source[offset] - 255, green = source[offset + 1], blue = source[offset + 2] - 255
      norm[pixel] = red * red + green * green + blue * blue
      if (base.data[offset + 3] === 0) band[pixel] = 1
      if (x === 0 || x + 1 === width || y === 0 || y + 1 === height || norm[pixel] < 80 * 80) continue
      let homogeneous = true
      for (let dy = -1; dy <= 1 && homogeneous; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const at = ((y + dy) * width + x + dx) * 4
        if (Math.abs(source[at] - source[offset]) > 1 || Math.abs(source[at + 1] - source[offset + 1]) > 1
          || Math.abs(source[at + 2] - source[offset + 2]) > 1) { homogeneous = false; break }
      }
      if (homogeneous) stable[pixel] = 1
    }
    if (y % 32 === 31) yield
  }
  for (let pass = 0; pass < RADIUS; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        nextBand[pixel] = band[pixel] || (x > 0 && band[pixel - 1]) || (x + 1 < width && band[pixel + 1])
          || (y > 0 && band[pixel - width]) || (y + 1 < height && band[pixel + width]) ? 1 : 0
      }
      if (y % 32 === 31) yield
    }
    const previous = band; band = nextBand; nextBand = previous
  }
  let candidates = 0
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (band[pixel] && norm[pixel] && !(stable[pixel] && base.data[pixel * 4 + 3] === 255)) candidates += 1
  }
  if (candidates > MAX_BOUNDARY_PIXELS) throw new Error('[avg-foreground] 边缘候选超过明确的新算法上限，保留原件并拒绝本次加工')
  let correctedPixelCount = 0, unsupportedBoundaryPixelCount = 0, maxCompositeResidual = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x, offset = pixel * 4
      if (!band[pixel] || !norm[pixel] || stable[pixel] && base.data[offset + 3] === 255) continue
      const red = source[offset] - 255, green = source[offset + 1], blue = source[offset + 2] - 255
      let bestPixel = -1, bestNorm = -1, bestAlpha = 0, bestResidual = 0
      for (let ay = Math.max(0, y - RADIUS); ay <= Math.min(height - 1, y + RADIUS); ay += 1) {
        for (let ax = Math.max(0, x - RADIUS); ax <= Math.min(width - 1, x + RADIUS); ax += 1) {
          const anchor = ay * width + ax
          if (!stable[anchor] || norm[anchor] <= bestNorm) continue
          const at = anchor * 4, ar = source[at] - 255, ag = source[at + 1], ab = source[at + 2] - 255
          const alpha = (ar * red + ag * green + ab * blue) / norm[anchor]
          if (alpha < 0 || alpha > 1.005) continue
          const residual = Math.max(Math.abs(ar * alpha - red), Math.abs(ag * alpha - green), Math.abs(ab * alpha - blue))
          if (residual > MAX_COMPOSITE_RESIDUAL) continue
          bestPixel = anchor; bestNorm = norm[anchor]; bestAlpha = Math.min(1, alpha); bestResidual = residual
        }
      }
      if (bestPixel < 0) { unsupportedBoundaryPixelCount += 1; continue }
      const at = bestPixel * 4, alpha = Math.round(bestAlpha * 255)
      maxCompositeResidual = Math.max(maxCompositeResidual, bestResidual)
      if (output[offset] === source[at] && output[offset + 1] === source[at + 1]
        && output[offset + 2] === source[at + 2] && output[offset + 3] === alpha) continue
      output[offset] = source[at]; output[offset + 1] = source[at + 1]; output[offset + 2] = source[at + 2]; output[offset + 3] = alpha
      correctedPixelCount += 1
    }
    if (y % 16 === 15) yield
  }
  let clearedPixelCount = 0, translucentPixelCount = 0, opaquePixelCount = 0
  for (let offset = 3; offset < output.length; offset += 4) {
    if (output[offset] === 0) clearedPixelCount += 1
    else if (output[offset] === 255) opaquePixelCount += 1
    else translucentPixelCount += 1
  }
  return { data: output, width, height, algorithm: AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2,
    baseAlgorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, baseMaskRatio: base.removedPixelRatio,
    reservedBorderRatio: base.reservedBorderRatio, clearedPixelCount, translucentPixelCount, opaquePixelCount,
    correctedPixelCount, unsupportedBoundaryPixelCount, maxCompositeResidual }
}

/** Worker-side synchronous numerical entry; no browser, network or DB access. */
export function matteAvgForegroundBoundaryUnmixV2(input: Parameters<typeof iterateAvgForegroundBoundaryUnmixV2>[0]): AvgForegroundBoundaryUnmixResultV2 {
  const steps = iterateAvgForegroundBoundaryUnmixV2(input)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}
