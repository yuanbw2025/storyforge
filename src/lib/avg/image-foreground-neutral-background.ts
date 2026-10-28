import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash, avgNumber, avgRecord } from './protocol-validation'
import { assertAvgForegroundRasterV1 } from './image-foreground-worker-protocol'
import { AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6 } from './image-foreground-contract'

export const AVG_NEUTRAL_BACKGROUND_RULE_V1 = AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6
export const AVG_NEUTRAL_BACKGROUND_MAX_MASK_REMOVAL_V1 = 0.15
export interface AvgNeutralBackgroundSourceV1 {
  median: [number, number, number]
  borderP99Deviation: number
  radius: number
  borderCoverage: number
  floodPixelCount: number
  floodMaskSha256: string
}
export interface AvgNeutralBackgroundObservationV1 extends AvgNeutralBackgroundSourceV1 {
  rule: typeof AVG_NEUTRAL_BACKGROUND_RULE_V1
  removedMaskPixelCount: number
}
const yieldHost = () => new Promise<void>(resolve => {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve() }
  channel.port2.postMessage(0)
})
function atRank(histogram: Uint32Array, index: number): number {
  let count = 0
  for (let value = 0; value < histogram.length; value++) { count += histogram[value]!; if (count > index) return value }
  throw new Error('[avg-neutral-background] 边缘统计不足')
}
/** Pure source analysis. Four-connected colour continuity can remove an open
 * background gap while leaving an enclosed similarly-coloured shirt alone.
 * It has no model, store, candidate, author or adoption authority. */
export async function deriveAvgNeutralBackgroundV1(input: { width: number; height: number; rgba: Uint8ClampedArray; signal?: AbortSignal }) {
  const { width, height, signal } = input, started = performance.now()
  const active = () => {
    if (signal?.aborted) throw new DOMException('Neutral background analysis aborted', 'AbortError')
    if (performance.now() - started > 20_000) throw new Error('[avg-neutral-background] 背景分析超时；原件保留且不自动重试')
  }
  active()
  if (!(input.rgba instanceof Uint8ClampedArray)) throw new Error('[avg-neutral-background] 原图必须为 RGBA 字节')
  assertAvgForegroundRasterV1(width, height, input.rgba.byteLength)
  const rgba = input.rgba.slice(), pixels = width * height, border: number[] = []
  for (let x = 0; x < width; x++) { border.push(x, (height - 1) * width + x) }
  for (let y = 0; y < height; y++) { border.push(y * width, y * width + width - 1) }
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  for (const index of border) for (let channel = 0; channel < 3; channel++) histograms[channel]![rgba[index * 4 + channel]!]!++
  const median = histograms.map(hist => (atRank(hist, Math.floor((border.length - 1) / 2)) + atRank(hist, Math.floor(border.length / 2))) / 2) as [number, number, number]
  if (Math.min(...median) < 180 || Math.max(...median) - Math.min(...median) > 8) throw new Error('[avg-neutral-background] 原图边缘不是均匀亮灰底色')
  const deviations = new Uint32Array(511)
  for (const index of border) {
    const offset = index * 4
    const delta = Math.max(...median.map((value, channel) => Math.abs(rgba[offset + channel]! - value)))
    deviations[Math.round(delta * 2)]!++
  }
  const borderP99Deviation = atRank(deviations, Math.floor((99 * border.length + 99) / 100) - 1) / 2
  if (borderP99Deviation > 10) throw new Error('[avg-neutral-background] 原图边缘颜色不够稳定，拒绝推断背景')
  const radius = Math.max(8, 2 * borderP99Deviation + 4), allowed = new Uint8Array(pixels), rgb = new Uint8Array(pixels * 3)
  for (let begin = 0; begin < pixels; begin += 65_536) {
    const end = Math.min(pixels, begin + 65_536)
    for (let index = begin; index < end; index++) {
      const offset = index * 4, r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!
      if (rgba[offset + 3] !== 255) throw new Error('[avg-neutral-background] 原件已有透明度；不能重分割隐藏颜色')
      rgb[index * 3] = r; rgb[index * 3 + 1] = g; rgb[index * 3 + 2] = b
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 8 && Math.max(Math.abs(r - median[0]), Math.abs(g - median[1]), Math.abs(b - median[2])) <= radius) allowed[index] = 1
    }
    if (end < pixels) await yieldHost()
    active()
  }
  const borderCoverage = border.reduce((count, index) => count + allowed[index]!, 0) / border.length
  if (borderCoverage < 0.95) throw new Error('[avg-neutral-background] 可确认的亮灰背景未覆盖95%边缘')
  const flood = new Uint8Array(pixels), queue = new Uint32Array(pixels)
  let head = 0, tail = 0
  const push = (index: number) => { if (allowed[index] && !flood[index]) { flood[index] = 1; queue[tail++] = index } }
  for (const index of border) push(index)
  while (head < tail) {
    const until = Math.min(tail, head + 65_536)
    while (head < until) {
      const index = queue[head++]!, x = index % width
      if (x > 0) push(index - 1)
      if (x + 1 < width) push(index + 1)
      if (index >= width) push(index - width)
      if (index + width < pixels) push(index + width)
    }
    if (head < tail) await yieldHost()
    active()
  }
  if (tail === pixels) throw new Error('[avg-neutral-background] 整幅原图都被识别为背景；不产出空主体')
  const [floodMaskSha256, sourcePixelHash] = await Promise.all([sha256MediaData(flood.buffer), sha256MediaData(rgb.buffer)])
  active()
  return { flood, sourcePixelHash, observation: { median, borderP99Deviation, radius, borderCoverage,
    floodPixelCount: tail, floodMaskSha256 } satisfies AvgNeutralBackgroundSourceV1 }
}
export function parseAvgNeutralBackgroundObservationV1(value: unknown, width: number, height: number, maskCoverage: number): AvgNeutralBackgroundObservationV1 {
  const r = avgRecord(value, ['rule', 'median', 'borderP99Deviation', 'radius', 'borderCoverage', 'floodPixelCount', 'floodMaskSha256', 'removedMaskPixelCount'], 'neutral background observation')
  if (r.rule !== AVG_NEUTRAL_BACKGROUND_RULE_V1 || !Array.isArray(r.median) || r.median.length !== 3) throw new Error('[avg-neutral-background] 未登记的背景统计')
  const median = r.median.map((v, i) => avgNumber(v, `background.median.${i}`, 180, 255, false)) as [number, number, number]
  const borderP99Deviation = avgNumber(r.borderP99Deviation, 'background.borderP99Deviation', 0, 10, false)
  const radius = avgNumber(r.radius, 'background.radius', 8, 24)
  const borderCoverage = avgNumber(r.borderCoverage, 'background.borderCoverage', 0.95, 1, false), borderCount = 2 * (width + height)
  const pixels = width * height, selectedPixels = Math.round(maskCoverage * pixels)
  if (median.some(v => !Number.isInteger(v * 2)) || Math.max(...median) - Math.min(...median) > 8
    || !Number.isInteger(borderP99Deviation * 2) || radius !== Math.max(8, 2 * borderP99Deviation + 4)
    || Math.abs(borderCoverage * borderCount - Math.round(borderCoverage * borderCount)) > 0.000001) throw new Error('[avg-neutral-background] 背景估色与固定规则不符')
  const floodPixelCount = avgNumber(r.floodPixelCount, 'background.floodPixelCount', 1, pixels - 1)
  const removedMaskPixelCount = avgNumber(r.removedMaskPixelCount, 'background.removedMaskPixelCount', 0,
    Math.min(floodPixelCount, Math.floor(selectedPixels * AVG_NEUTRAL_BACKGROUND_MAX_MASK_REMOVAL_V1)))
  return { rule: AVG_NEUTRAL_BACKGROUND_RULE_V1, median, borderP99Deviation, radius, borderCoverage,
    floodPixelCount, floodMaskSha256: avgHash(r.floodMaskSha256, 'background.floodMaskSha256'), removedMaskPixelCount }
}
