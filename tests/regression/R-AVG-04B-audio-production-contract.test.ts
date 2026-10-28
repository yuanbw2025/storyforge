import { describe, expect, it } from 'vitest'
import { parseAvgAudioProductionProcessingPlanV1, assertAvgAudioProcessingPlanTargetsV1,
  type AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'
import { parseAvgAuthorVoiceChoiceV2, parseAvgAuthorSoundChoiceV2 } from '../../src/lib/avg/processed-audio-choice-contract'
import { parseAvgAuthorVoiceChoiceV1 } from '../../src/lib/avg/voice-choice-contract'
import { parseAvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'
import { parseAvgSoundPlanV1 } from '../../src/lib/avg/sound-plan-contract'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgVoiceConfigurationFixtureV1 } from '../helpers/avg-voice-production-fixture'

const recipe = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const,
  gainMilliDb: -4320, maximumDurationMs: 120_000, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
  timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration: '明确降低音乐响度；不伪造听感、来源或采用。' }
const plan = (): AvgAudioProductionProcessingPlanV1 => ({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
  entries: [{ domain: 'sound', requirementKey: 'desk.bgm', recipe: { ...recipe } }] })

describe('AVG formal audio processing proposals and strict successor choices', () => {
  it('snapshots only explicitly selected requirements and keeps the semantic sound plan separate', async () => {
    const p = plan(), parsed = parseAvgAudioProductionProcessingPlanV1(JSON.stringify(p))
    expect(parsed).toEqual(p); p.entries[0].recipe.gainMilliDb = -1000; expect(parsed.entries[0].recipe.gainMilliDb).toBe(-4320)
    const original = await avgSoundPlanningFixtureV1()
    expect(parseAvgSoundPlanV1(original.plan)).toEqual(original.plan)
    expect(() => parseAvgSoundPlanV1(parsed)).toThrow()
    expect(() => parseAvgSoundPlanV1({ ...original.plan, audioProcessing: parsed })).toThrow()
  })
  it.each(['empty', 'duplicate', 'permission', 'unknown-version', 'invalid-domain', 'hidden-resampling'] as const)('rejects %s rather than granting processing authority', invalid => {
    const p: any = plan()
    if (invalid === 'empty') p.entries = []
    if (invalid === 'duplicate') p.entries.push(structuredClone(p.entries[0]))
    if (invalid === 'permission') p.authorized = true
    if (invalid === 'unknown-version') p.version = 2
    if (invalid === 'invalid-domain') p.entries[0].domain = 'image'
    if (invalid === 'hidden-resampling') p.entries[0].recipe.sampleRatePolicy = '48000'
    expect(() => parseAvgAudioProductionProcessingPlanV1(p)).toThrow()
  })
  it('requires one exact frozen target and leaves legitimate original OGG requirements intact', () => {
    const targets = [{ domain: 'sound' as const, requirementKey: 'desk.bgm', kind: 'bgm' as const, mimeType: 'audio/wav' as const },
      { domain: 'sound' as const, requirementKey: 'desk.sfx', kind: 'sfx' as const, mimeType: 'audio/ogg' as const }]
    const before = structuredClone(targets)
    expect(assertAvgAudioProcessingPlanTargetsV1(plan(), targets)).toEqual(plan()); expect(targets).toEqual(before)
    expect(() => assertAvgAudioProcessingPlanTargetsV1(plan(), targets.slice(1))).toThrow(/缺失/)
    expect(() => assertAvgAudioProcessingPlanTargetsV1(plan(), [...targets, targets[0]])).toThrow(/重复/)
    expect(() => assertAvgAudioProcessingPlanTargetsV1(plan(), [{ ...targets[0], kind: 'voice' }])).toThrow(/域/)
    const ogg = plan(); ogg.entries[0].requirementKey = 'desk.sfx'
    expect(() => assertAvgAudioProcessingPlanTargetsV1(ogg, targets)).toThrow(/OGG/); expect(targets).toEqual(before)
  })
  it.each(['voice', 'sound'] as const)('keeps %s V1 strict and binds V2 to a distinct raw, derivative, recipe and review', async domain => {
    const original = domain === 'voice' ? (await avgVoiceConfigurationFixtureV1()).choices[0] : (await avgSoundPlanningFixtureV1()).choices[0]
    const v1 = domain === 'voice' ? parseAvgAuthorVoiceChoiceV1 : parseAvgAuthorSoundChoiceV1
    const v2 = domain === 'voice' ? parseAvgAuthorVoiceChoiceV2 : parseAvgAuthorSoundChoiceV2
    const before = structuredClone(original), hash = 'b'.repeat(64)
    const selected = { ...original, version: 2, processed: { artifactKey: `avg.${domain}.processed.${original.requirementKey}`, version: 2,
      contentHash: hash, recipeHash: 'c'.repeat(64), receiptHash: 'd'.repeat(64) },
    asset: { ...original.asset, contentHash: hash, blobContentHash: hash } }
    const parsed = v2(selected)
    expect(parsed.raw).toEqual(original.raw); expect(parsed.processed.contentHash).toBe(hash); expect(parsed.review).toEqual(original.review)
    expect(v1(original)).toEqual(original); expect(() => v1(selected)).toThrow(); expect(() => v2(original)).toThrow()
    expect(original).toEqual(before)
    // This parser establishes structure only. An old review of the original
    // hash cannot become a derived audition without the future actual reader.
    expect(() => v2({ ...selected, asset: original.asset })).toThrow(/加工WAV/)
    expect(() => v2({ ...selected, processed: { ...selected.processed, artifactKey: selected.raw.artifactKey } })).toThrow(/同一需求/)
    expect(() => v2({ ...selected, raw: { ...selected.raw, artifactKey: `avg.${domain}.raw.foreign` } })).toThrow(/同一需求/)
    expect(() => v2({ ...selected, review: { ...selected.review, artifactKey: 'avg.review.audio.foreign' } })).toThrow(/同一需求/)
    expect(() => v2({ ...selected, processed: { ...selected.processed, receiptHash: '' } })).toThrow()
    expect(() => v2({ ...selected, approved: true })).toThrow()
    expect(() => v2({ ...selected, asset: { ...selected.asset, blobContentHash: original.raw.contentHash } })).toThrow(/stage asset.*hash/)
  })
})
