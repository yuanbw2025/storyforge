import { describe, expect, it } from 'vitest'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, matteDeclaredMagentaCharacterBackdropV1,
  matteEdgeConnectedCharacterBackdropV1 } from '../../src/lib/product-production/character-alpha-matting'
import { assertAvgForegroundRequirementBindingV1, compileAvgForegroundRequirementV1, parseAvgForegroundPolicyV1,
  parseAvgImageProcessingRecipe, parseAvgImageProcessingRecipeV1, parseAvgImageProcessingRecipeV2,
  parseAvgImageProcessingPlan, parseAvgImageProcessingPlanV1, type AvgImageProcessingRecipeV1,
  type AvgForegroundPolicyV1 } from '../../src/lib/avg/image-processing-contract'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'

const policy: AvgForegroundPolicyV1 = { schema: 'storyforge.avg.foreground-policy', version: 1,
  method: 'reserved-magenta', reservedColor: '#FF00FF', subjectUsesReservedColor: false,
  algorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, declaration: '明确仅将纯品红及其相近色保留给背景，处理结果仍须独立视觉评审。' }

function requirement(): Pick<AvgVisualProductionRequirementV1, 'mediaKind' | 'consumer' | 'alpha' | 'invariants' | 'forbiddenDepictions'> {
  return { mediaKind: 'character-pose', alpha: 'required', invariants: ['保留白色衬衣和蓝色外套。'], forbiddenDepictions: ['不得新增道具。'],
    consumer: { consumerKey: 'keeper.actor', domain: 'stage', slot: 'actor', subjectKey: 'keeper', sceneKey: 'desk',
      lineKey: null, required: true, fallback: 'none' } }
}
function raster() {
  const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([255, 0, 255, 255], offset)
  for (let y = 5; y < 25; y += 1) for (let x = 6; x < 24; x += 1) data.set([30, 60, 90, 255], (y * width + x) * 4)
  // These interior colours are subject paint. The exact reserved-colour hole
  // is separately removed only under the explicitly declared new policy.
  for (let y = 9; y < 13; y += 1) for (let x = 9; x < 13; x += 1) data.set([200, 40, 190, 255], (y * width + x) * 4)
  data.set([255, 255, 255, 255], (16 * width + 11) * 4)
  data.set([255, 0, 255, 255], (16 * width + 18) * 4)
  return { width, height, data }
}
const pixel = (data: Uint8ClampedArray, x: number, y: number) => Array.from(data.slice((y * 30 + x) * 4, (y * 30 + x) * 4 + 4))

describe('AVG explicit reserved-backdrop foreground foundation', () => {
  const oldRecipe: AvgImageProcessingRecipeV1 = { schema: 'storyforge.avg.image-processing-recipe', version: 1,
    crop: null, width: 576, height: 768, fit: 'contain', anchor: { x: 5000, y: 5000 }, background: null,
    declaration: '保留原图，旧配方仅适配画布。' }

  it('keeps V1 strict and byte-identical while admitting an explicit V2 foreground recipe', () => {
    expect(JSON.stringify(parseAvgImageProcessingRecipe(oldRecipe))).toBe(JSON.stringify(oldRecipe))
    const next = { ...oldRecipe, version: 2, foreground: policy }
    expect(parseAvgImageProcessingRecipe(next)).toEqual(next)
    expect(() => parseAvgImageProcessingRecipeV1(next)).toThrow()
    expect(() => parseAvgImageProcessingRecipeV2(oldRecipe)).toThrow()
    expect(() => parseAvgImageProcessingRecipe({ ...oldRecipe, foreground: policy })).toThrow()
    expect(() => parseAvgImageProcessingRecipeV2({ ...next, background: { red: 255, green: 255, blue: 255, alpha: 128 } })).toThrow(/alpha/)
    // V3 is now registered, but retagging V2 fields cannot create its two-input
    // recipe. Legacy readers remain strict and unknown versions still fail.
    expect(() => parseAvgImageProcessingRecipeV1({ ...next, version: 3 })).toThrow()
    expect(() => parseAvgImageProcessingRecipeV2({ ...next, version: 3 })).toThrow()
    expect(() => parseAvgImageProcessingRecipe({ ...next, version: 3 })).toThrow(/region composite recipe/)
    expect(() => parseAvgImageProcessingRecipe({ ...next, version: 4 })).toThrow(/版本/)
  })

  it('requires a genuine new recipe in a mixed V2 plan and rejects duplicate targets or legacy smuggling', () => {
    const old = { schema: 'storyforge.avg.image-processing-plan', version: 1,
      entries: [{ requirementKey: 'old.canvas', recipe: oldRecipe }] }
    expect(JSON.stringify(parseAvgImageProcessingPlan(old))).toBe(JSON.stringify(old))
    const next = { ...old, version: 2, entries: [...old.entries,
      { requirementKey: 'new.foreground', recipe: { ...oldRecipe, version: 2, foreground: policy } }] }
    expect(parseAvgImageProcessingPlan(next)).toEqual(next)
    expect(() => parseAvgImageProcessingPlanV1(next)).toThrow()
    expect(() => parseAvgImageProcessingPlan({ ...old, version: 2 })).toThrow(/新版本配方/)
    expect(() => parseAvgImageProcessingPlan({ ...next, entries: [...next.entries, next.entries[1]] })).toThrow()
    expect(() => parseAvgImageProcessingPlan({ ...next, version: 1 })).toThrow()
  })

  it('freezes a strict portable policy without unrelated authority or unknown fields', () => {
    expect(parseAvgForegroundPolicyV1(JSON.stringify(policy))).toEqual(policy)
    for (const value of [{ ...policy, subjectUsesReservedColor: true }, { ...policy, version: 2 },
      { ...policy, reservedColor: '#FFFFFF' }, { ...policy, algorithm: 'any-model' }, { ...policy, declaration: '' },
      { ...policy, workId: 9 }, { ...policy, producerAccepted: true }]) expect(() => parseAvgForegroundPolicyV1(value)).toThrow()
  })

  it('makes an immutable, idempotent compiler proposal and rejects an unfrozen request', () => {
    const input = requirement(), before = structuredClone(input)
    expect(() => assertAvgForegroundRequirementBindingV1(policy, input)).toThrow(/冻结/)
    const compiled = compileAvgForegroundRequirementV1(policy, input)
    expect(input).toEqual(before)
    expect(compiled).not.toBe(input)
    expect(compiled.invariants).not.toBe(input.invariants)
    expect(compiled.invariants).toContain(before.invariants[0])
    expect(compiled.forbiddenDepictions).toContain(before.forbiddenDepictions[0])
    expect(() => assertAvgForegroundRequirementBindingV1(policy, compiled)).not.toThrow()
    expect(compileAvgForegroundRequirementV1(policy, compiled)).toEqual(compiled)
    expect(() => assertAvgForegroundRequirementBindingV1(policy, { ...compiled, forbiddenDepictions: before.forbiddenDepictions })).toThrow(/冻结/)
  })

  it('admits declared character identity and item-icon targets without granting background or CG removal', () => {
    const input = requirement()
    expect(() => compileAvgForegroundRequirementV1(policy, { ...input, consumer: { ...input.consumer,
      domain: 'reference', slot: 'identity', sceneKey: null } })).not.toThrow()
    expect(() => compileAvgForegroundRequirementV1(policy, { ...input, mediaKind: 'ui', consumer: { ...input.consumer,
      domain: 'inventory', slot: 'icon', sceneKey: null } })).not.toThrow()
    for (const target of [{ ...input, alpha: 'not-required' as const }, { ...input, mediaKind: 'background' as const,
      consumer: { ...input.consumer, slot: 'background' } }, { ...input, mediaKind: 'cg' as const,
      consumer: { ...input.consumer, domain: 'evidence' as const, slot: 'detail', sceneKey: null } }]) {
      expect(() => compileAvgForegroundRequirementV1(policy, target)).toThrow(/透明前景/)
    }
  })

  it('removes actual backdrop and declared closed holes while preserving interior white and non-key subject paint', () => {
    const input = raster(), original = input.data.slice(), result = matteDeclaredMagentaCharacterBackdropV1(input)
    expect(input.data).toEqual(original)
    expect(pixel(result.data, 0, 0)[3]).toBe(0)
    expect(pixel(result.data, 18, 16)[3]).toBe(0)
    expect(pixel(result.data, 11, 16)).toEqual([255, 255, 255, 255])
    expect(pixel(result.data, 10, 10)).toEqual([200, 40, 190, 255])
    expect(result.algorithm).toBe(DECLARED_MAGENTA_ALPHA_MATTING_ID_V1)
    expect(result.reservedBorderRatio).toBe(1)
    expect(result.clearedPixelCount).toBeGreaterThan(0)
    expect(result.opaquePixelCount).toBeGreaterThan(0)
    expect(result.clearedPixelCount + result.translucentPixelCount + result.opaquePixelCount).toBe(900)
    expect(result.data).not.toBe(input.data)
  })

  it('preserves the original explicitly broad-key behavior for its existing caller', () => {
    const input = raster(), result = matteEdgeConnectedCharacterBackdropV1({ ...input, reservedMagentaBackdrop: true })
    expect(pixel(result.data, 10, 10)[3]).toBe(0)
    expect(pixel(result.data, 11, 16)[3]).toBe(255)
  })

  it('refuses complex or undeclared edge colours without guessing another palette', () => {
    for (const colour of [[255, 255, 255, 255], [30, 60, 90, 255]]) {
      const input = raster()
      for (let x = 0; x < input.width; x += 1) input.data.set(colour, x * 4)
      expect(() => matteDeclaredMagentaCharacterBackdropV1(input)).toThrow(/边缘/)
    }
  })

  it('reports the measured reserved-colour edge coverage when strict intake rejects an image', () => {
    const input = raster()
    for (let x = 0; x < input.width; x += 1) input.data.set([255, 255, 255, 255], x * 4)
    expect(() => matteDeclaredMagentaCharacterBackdropV1(input))
      .toThrow(/纯品红保留底色（边缘精确色键覆盖率 0\.7414，要求至少 0\.9500）/)
  })

  it('refuses existing or padding-only alpha rather than presenting it as new foreground removal', () => {
    const input = raster(); input.data[3] = 0
    expect(() => matteDeclaredMagentaCharacterBackdropV1(input)).toThrow(/不透明原图/)
    expect(matteEdgeConnectedCharacterBackdropV1(input).alreadyTransparent).toBe(true)
  })

  it('rejects empty subjects and malformed or oversized rasters before accepting any result', () => {
    const input = raster()
    for (let offset = 0; offset < input.data.length; offset += 4) input.data.set([255, 0, 255, 255], offset)
    expect(() => matteDeclaredMagentaCharacterBackdropV1(input)).toThrow(/比例异常/)
    expect(() => matteDeclaredMagentaCharacterBackdropV1({ ...input, width: 30.5 })).toThrow(/栅格/)
    expect(() => matteDeclaredMagentaCharacterBackdropV1({ width: 2049, height: 2049, data: new Uint8ClampedArray() })).toThrow(/上限/)
  })
})
