import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { parseAvgAudioProductionProcessingPlanV1, parseAvgAudioProductionProcessingPlanV2,
  parseAvgAudioProductionProcessingPlan, assertAvgAudioProcessingPlanTargetsV1, assertAvgAudioProcessingPlanTargets,
  type AvgAudioProductionProcessingPlanV1, type AvgAudioProductionProcessingPlanV2 } from '../../src/lib/avg/audio-production-contract'
import type { AvgAudioProcessingRecipeV2 } from '../../src/lib/avg/audio-processing-contract-v2'

const recipe1 = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const,
  gainMilliDb: -6000, maximumDurationMs: 1000, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
  timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration: '原版明确增益；不改变源权利或审听状态。' }
const recipe2 = (): AvgAudioProcessingRecipeV2 => ({ ...recipe1, version: 2, sampleRatePolicy: 'explicit', targetSampleRateHz: 24000,
  resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
  dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } })
const plan1 = (): AvgAudioProductionProcessingPlanV1 => ({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
  entries: [{ domain: 'voice', requirementKey: 'fixture.line', recipe: structuredClone(recipe1) }] })
const plan2 = (): AvgAudioProductionProcessingPlanV2 => ({ schema: 'storyforge.avg.audio-production-processing-plan', version: 2,
  entries: [...plan1().entries, { domain: 'sound', requirementKey: 'fixture.bgm', recipe: recipe2() }] })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Plan codecs cannot contact providers') }))
  vi.stubGlobal('Worker', vi.fn(() => { throw new Error('Plan codecs cannot create Workers') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(Worker).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

describe('AVG explicit audio processing plan V2 with strict legacy dispatch', () => {
  it('preserves exact V1 JSON and checker output through the new dispatcher', () => {
    const input = plan1(), encoded = canonicalProductProductionJsonV2(input)
    expect(canonicalProductProductionJsonV2(parseAvgAudioProductionProcessingPlanV1(encoded))).toBe(encoded)
    expect(canonicalProductProductionJsonV2(parseAvgAudioProductionProcessingPlan(encoded))).toBe(encoded)
    const targets = [{ domain: 'voice' as const, requirementKey: 'fixture.line', kind: 'voice' as const, mimeType: 'audio/wav' as const }]
    expect(assertAvgAudioProcessingPlanTargets(input, targets)).toEqual(assertAvgAudioProcessingPlanTargetsV1(input, targets))
    expect(input).toEqual(plan1())
  })

  it('retains mixed exact recipe versions in V2 and captures independent author inputs', () => {
    const input = plan2(), before = structuredClone(input), parsed = parseAvgAudioProductionProcessingPlan(JSON.stringify(input))
    expect(parsed).toEqual(before); expect(parsed.entries.map(e => e.recipe.version)).toEqual([1, 2])
    input.entries[0].recipe.gainMilliDb = 0
    const second = input.entries[1].recipe
    if (second.version !== 2 || !second.dynamics) throw new Error('Expected V2 fixture')
    second.dynamics.releaseMs = 100
    expect(parsed).toEqual(before)
    expect(parseAvgAudioProductionProcessingPlanV2(before)).toEqual(before)
  })

  it('does not relabel an all-V1 plan, admit V2 recipes into V1, or guess unknown plan versions', () => {
    expect(() => parseAvgAudioProductionProcessingPlanV1(plan2())).toThrow()
    expect(() => parseAvgAudioProductionProcessingPlanV1({ ...plan1(), entries: [plan2().entries[1]] })).toThrow()
    expect(() => parseAvgAudioProductionProcessingPlanV2(plan1())).toThrow()
    expect(() => parseAvgAudioProductionProcessingPlan({ ...plan1(), version: 2 })).toThrow(/V2配方/)
    expect(() => parseAvgAudioProductionProcessingPlan({ ...plan2(), version: 3 })).toThrow()
    expect(() => parseAvgAudioProductionProcessingPlan({ ...plan2(), version: '2' })).toThrow()
  })

  it.each(['empty', 'duplicate', 'extra-plan', 'extra-entry', 'unknown-domain', 'unknown-recipe', 'rate', 'limiter'] as const)('rejects %s without broadening production or processing authority', mode => {
    const input: any = plan2()
    if (mode === 'empty') input.entries = []
    if (mode === 'duplicate') input.entries.push(structuredClone(input.entries[1]))
    if (mode === 'extra-plan') input.authorized = true
    if (mode === 'extra-entry') input.entries[1].producerReceiptHash = 'a'.repeat(64)
    if (mode === 'unknown-domain') input.entries[1].domain = 'image'
    if (mode === 'unknown-recipe') input.entries[1].recipe.version = 3
    if (mode === 'rate') { input.entries[1].recipe.sampleRatePolicy = 'preserve'; input.entries[1].recipe.targetSampleRateHz = 48000 }
    if (mode === 'limiter') input.entries[1].recipe.dynamics.commercialQuality = true
    expect(() => parseAvgAudioProductionProcessingPlan(input)).toThrow()
  })

  it('requires each exact same-domain WAV target and rejects missing/duplicate targets or implicit OGG conversion', () => {
    const input = plan2(), targets = [
      { domain: 'voice' as const, requirementKey: 'fixture.line', kind: 'voice' as const, mimeType: 'audio/wav' as const },
      { domain: 'sound' as const, requirementKey: 'fixture.bgm', kind: 'bgm' as const, mimeType: 'audio/wav' as const },
    ], before = structuredClone(targets)
    expect(assertAvgAudioProcessingPlanTargets(input, targets)).toEqual(input)
    expect(() => assertAvgAudioProcessingPlanTargets(input, targets.slice(0, 1))).toThrow(/缺失/)
    expect(() => assertAvgAudioProcessingPlanTargets(input, [...targets, targets[1]])).toThrow(/重复/)
    expect(() => assertAvgAudioProcessingPlanTargets(input, [targets[0], { ...targets[1], kind: 'voice' }])).toThrow(/域/)
    expect(() => assertAvgAudioProcessingPlanTargets(input, [targets[0], { ...targets[1], mimeType: 'audio/ogg' }])).toThrow(/OGG/)
    expect(targets).toEqual(before)
  })

  it('preserves same textual keys in distinct domains while enforcing the unchanged 100-entry bound', () => {
    const input = plan2(); input.entries[1].requirementKey = input.entries[0].requirementKey
    expect(parseAvgAudioProductionProcessingPlan(input).entries).toHaveLength(2)
    const bounded = { ...plan2(), entries: Array.from({ length: 100 }, (_, index) => ({
      domain: 'sound', requirementKey: `fixture.${index}`, recipe: recipe2(),
    })) }
    expect(parseAvgAudioProductionProcessingPlan(bounded).entries).toHaveLength(100)
    expect(() => parseAvgAudioProductionProcessingPlan({ ...bounded, entries: [...bounded.entries, { ...bounded.entries[0], requirementKey: 'fixture.extra' }] })).toThrow()
  })
})
