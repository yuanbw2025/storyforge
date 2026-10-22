import { describe, expect, it } from 'vitest'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, matteDeclaredMagentaCharacterBackdropV1 } from '../../src/lib/product-production/character-alpha-matting'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2, iterateAvgForegroundBoundaryUnmixV2,
  matteAvgForegroundBoundaryUnmixV2 } from '../../src/lib/avg/image-foreground-boundary-unmix'

function frame(color: readonly number[] = [200, 149, 99]) {
  const width = 100, height = 80, data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < data.length; at += 4) data.set([255, 0, 255, 255], at)
  for (let y = 20; y < 60; y += 1) for (let x = 20; x < 80; x += 1) data.set([...color, 255], (y * width + x) * 4)
  for (let y = 21; y < 59; y += 1) for (const x of [19, 80]) {
    data.set([Math.round(color[0] * 0.25 + 255 * 0.75), Math.round(color[1] * 0.25),
      Math.round(color[2] * 0.25 + 255 * 0.75), 255], (y * width + x) * 4)
  }
  return { width, height, data }
}
const pixel = (f: { data: Uint8ClampedArray; width: number }, x: number, y: number) => [...f.data.slice((y * f.width + x) * 4, (y * f.width + x) * 4 + 4)]

describe('AVG distinct boundary-unmix.v2 numerical candidate, without production authority', () => {
  it.each([[200, 149, 99], [83, 122, 114], [240, 240, 240]])('recovers a known 25 percent composite onto magenta while preserving its solid colour %j', (...color) => {
    const input = frame(color), original = input.data.slice(), result = matteAvgForegroundBoundaryUnmixV2(input)
    expect(pixel(result, 19, 40).slice(0, 3)).toEqual(color)
    expect(pixel(result, 19, 40)[3]).toBeGreaterThanOrEqual(63)
    expect(pixel(result, 19, 40)[3]).toBeLessThanOrEqual(65)
    expect(pixel(result, 50, 40)).toEqual([...color, 255])
    expect(pixel(result, 0, 0)[3]).toBe(0)
    expect(input.data).toEqual(original)
    expect(result.clearedPixelCount + result.translucentPixelCount + result.opaquePixelCount).toBe(input.width * input.height)
    expect(result.correctedPixelCount).toBeGreaterThan(0)
    expect(result.maxCompositeResidual).toBeLessThanOrEqual(1.5)
  })

  it('keeps the old algorithm and exact result available as a separate immutable baseline', () => {
    const input = frame(), before = matteDeclaredMagentaCharacterBackdropV1(input), next = matteAvgForegroundBoundaryUnmixV2(input)
    expect(before.algorithm).toBe(DECLARED_MAGENTA_ALPHA_MATTING_ID_V1)
    expect(next.algorithm).toBe(AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2)
    expect(next.algorithm).not.toBe(before.algorithm)
    expect(next.baseAlgorithm).toBe(before.algorithm)
    expect(matteDeclaredMagentaCharacterBackdropV1(input).data).toEqual(before.data)
    expect(pixel({ data: before.data, width: input.width }, 19, 40)[3]).toBe(255)
    expect(pixel(next, 19, 40)[3]).toBeLessThan(255)
  })

  it('snapshots original pixels before yielding so later caller mutation cannot change its computation', () => {
    const input = frame(), expected = matteAvgForegroundBoundaryUnmixV2(input), steps = iterateAvgForegroundBoundaryUnmixV2(input)
    let step = steps.next(); expect(step.done).toBe(false)
    input.data.fill(0)
    while (!step.done) step = steps.next()
    expect(step.value).toEqual(expected)
  })

  it('keeps the original matte when no reliable nearby colour anchor exists', () => {
    const input = frame(), x = 8, y = 8
    input.data.set([30, 50, 70, 255], (y * input.width + x) * 4)
    const base = matteDeclaredMagentaCharacterBackdropV1(input), next = matteAvgForegroundBoundaryUnmixV2(input)
    expect(next.unsupportedBoundaryPixelCount).toBeGreaterThan(0)
    expect(pixel(next, x, y)).toEqual(pixel({ data: base.data, width: input.width }, x, y))
    expect(next.maxCompositeResidual).toBeLessThanOrEqual(1.5)
  })

  it('refuses ambiguous alpha, undeclared borders and oversized input under the original strict physical bounds', () => {
    const partial = frame(); partial.data[3] = 0
    expect(() => matteAvgForegroundBoundaryUnmixV2(partial)).toThrow(/不透明/)
    const wrong = frame(); wrong.data.fill(240)
    for (let at = 3; at < wrong.data.length; at += 4) wrong.data[at] = 255
    expect(() => matteAvgForegroundBoundaryUnmixV2(wrong)).toThrow(/保留底色/)
    expect(() => matteAvgForegroundBoundaryUnmixV2({ width: 2049, height: 2048, data: new Uint8ClampedArray(0) })).toThrow(/上限/)
    expect(() => matteAvgForegroundBoundaryUnmixV2({ width: 100, height: 80, data: new Uint8ClampedArray(new SharedArrayBuffer(100 * 80 * 4)) })).toThrow(/共享/)
  })
})
