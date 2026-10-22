import { describe, expect, it } from 'vitest'
import wire from '../../scripts/ttrpg-local-tts/product-profile-v2.json'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { parseTtrpgOpenAudioRequestV1 } from '../../src/lib/ttrpg/open-audio-contract'
import { validateTtrpgVoiceTimelineV1 } from '../../src/lib/ttrpg/open-audio-runtime'
import { parseTtrpgOpenGeneratedVoiceTimelineV1, verifyTtrpgOpenGeneratedVoiceTimelineV1,
  verifyTtrpgOpenVoiceSampleClockV1, ttrpgOpenVoiceReadingPositionV1, TTRPG_OPEN_VOICE_TIMING_LIMITS_V1,
  type TtrpgOpenGeneratedVoiceTimelineV1 } from '../../src/lib/ttrpg/open-voice-timeline-contract'

// Protocol timing only; these declared sample counts do not prove actual PCM,
// a real model, listening, rights, acceptance or an E16 commit.
async function fixture() {
  const source = '前文🙂。\n\n编号1000。\n\n后文 e\u0301。', partText = '编号1000。', texts = ['编号', '一千.']
  const normalizedText = texts.join(''), counts = [22051, 22050]
  const timeline: TtrpgOpenGeneratedVoiceTimelineV1 = { schema: 'storyforge.ttrpg-open-generated-voice-timeline', version: 1,
    sourceTextHash: await sha256Text(source), sourceTextLengthUtf16: source.length,
    normalizedText, normalizedTextSha256: await sha256Text(normalizedText),
    clock: { kind: 'normalized-reading-segments', wordAlignmentProvided: false,
      originalPart: { textOffset: source.indexOf(partText), textLength: partText.length, textHash: await sha256Text(partText) },
      sampleRate: 44100, samples: counts.reduce((n, count) => n + count, 0), segments: [] } }
  for (const [index, text] of texts.entries()) timeline.clock.segments.push({ index,
    readingOffsetUtf16: texts.slice(0, index).join('').length, readingLengthUtf16: text.length, textSha256: await sha256Text(text),
    sampleOffset: counts.slice(0, index).reduce((n, count) => n + count, 0), sampleCount: counts[index], gain: 1 })
  const media = { mimeType: 'audio/wav', byteSize: 44 + timeline.clock.samples * 2, durationMs: Math.round(timeline.clock.samples * 1000 / 44100) }
  return { source, partText, timeline, media }
}
describe('R-TTRPGOPEN10 truthful generated sample timeline', () => {
  it('binds the entire exact source, selected original part, different normalized reading and actual sample clock', async () => {
    const f = await fixture(), before = canonicalStringify(f)
    const checked = await verifyTtrpgOpenGeneratedVoiceTimelineV1(f.timeline, f.source, f.media)
    expect(checked).toEqual(f.timeline); expect(checked.clock).not.toBe(f.timeline.clock)
    expect(checked.clock.originalPart.textLength).not.toBe(checked.normalizedText.length)
    expect(f.source).toContain('e\u0301'); expect(checked.sourceTextHash).not.toBe(await sha256Text(f.source.normalize('NFC')))
    expect(canonicalStringify(f)).toBe(before)
    expect(Object.keys(checked)).not.toContain('marks'); expect(Object.keys(checked.clock)).not.toContain('granularity')
  })
  it('freezes the V1 physical bounds independently of future installation descriptors', () => {
    const l = TTRPG_OPEN_VOICE_TIMING_LIMITS_V1
    expect(Object.isFrozen(l)).toBe(true)
    expect([l.maxPartUtf16, l.maxReadingUtf16, l.maxSegmentUtf16, l.maxSegments, l.sampleRate, l.maxSamples, l.maxSegmentSamples])
      .toEqual([wire.maxSourceUtf16, wire.maxReadingUtf16, wire.maxSegmentUtf16, wire.maxSegments, wire.sampleRate, wire.sampleRate * wire.maxAudioSeconds, wire.sampleRate * wire.maxSegmentAudioSeconds])
  })
  it.each([
    ['extra authority', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, adoptionAllowed: true })],
    ['wrong version', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, version: 2 })],
    ['source hash', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, sourceTextHash: '0'.repeat(64) })],
    ['source length', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, sourceTextLengthUtf16: t.sourceTextLengthUtf16 - 1 })],
    ['part hash', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, originalPart: { ...t.clock.originalPart, textHash: '0'.repeat(64) } } })],
    ['part offset', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, originalPart: { ...t.clock.originalPart, textOffset: t.clock.originalPart.textOffset + 1 } } })],
    ['reading hash', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, normalizedTextSha256: '0'.repeat(64) })],
    ['reading replacement', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, normalizedText: '替换的读法' })],
    ['fake word alignment', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, wordAlignmentProvided: true } })],
    ['wrong sample rate', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, sampleRate: 22050 } })],
    ['missing sample', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, samples: t.clock.samples + 1 } })],
    ['clock injection', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, marks: [] } })],
    ['empty segments', (t: TtrpgOpenGeneratedVoiceTimelineV1) => ({ ...t, clock: { ...t.clock, segments: [] } })],
  ])('rejects %s rather than granting generated-timeline authority', async (_label, change) => {
    const f = await fixture()
    await expect(verifyTtrpgOpenGeneratedVoiceTimelineV1(change(f.timeline), f.source, f.media)).rejects.toThrow()
  })
  it.each(['index', 'readingOffsetUtf16', 'readingLengthUtf16', 'sampleOffset', 'sampleCount', 'textSha256', 'gain'] as const)('rejects corrupted segment %s', async field => {
    const f = await fixture(), segment = f.timeline.clock.segments[1]
    if (field === 'textSha256') segment[field] = '0'.repeat(64)
    else segment[field] += 1
    await expect(verifyTtrpgOpenGeneratedVoiceTimelineV1(f.timeline, f.source, f.media)).rejects.toThrow()
  })
  it.each([{ mimeType: 'audio/ogg' }, { byteSize: 42 }, { durationMs: null }, { durationMs: 2000 }])('rejects mismatched physical declaration %j', async mismatch => {
    const f = await fixture()
    await expect(verifyTtrpgOpenGeneratedVoiceTimelineV1(f.timeline, f.source, { ...f.media, ...mismatch })).rejects.toThrow()
  })
  it('does not accept a recomputed full hash with a source range cutting a surrogate pair', async () => {
    const f = await fixture(), index = f.source.indexOf('🙂')
    f.timeline.clock.originalPart = { textOffset: index + 1, textLength: 1, textHash: await sha256Text(f.source.slice(index + 1, index + 2)) }
    await expect(verifyTtrpgOpenGeneratedVoiceTimelineV1(f.timeline, f.source, f.media)).rejects.toThrow()
  })
  it('does not split a spoken surrogate pair even with rehashed segments', async () => {
    const f = await fixture(), c = f.timeline.clock, text = '🙂.'
    c.segments[0] = { ...c.segments[0], readingLengthUtf16: 1, textSha256: await sha256Text(text.slice(0, 1)) }
    c.segments[1] = { ...c.segments[1], readingOffsetUtf16: 1, readingLengthUtf16: 2, textSha256: await sha256Text(text.slice(1)) }
    await expect(verifyTtrpgOpenVoiceSampleClockV1(c, text)).rejects.toThrow()
  })
  it('bounds individual segments, total text, original range and physical samples', async () => {
    const f = await fixture()
    for (const changed of [
      { ...f.timeline, normalizedText: '字'.repeat(4001) },
      { ...f.timeline, sourceTextLengthUtf16: 16015 },
      { ...f.timeline, clock: { ...f.timeline.clock, samples: 44100 * 900 + 1 } },
      { ...f.timeline, clock: { ...f.timeline.clock, originalPart: { ...f.timeline.clock.originalPart, textLength: 2001 } } },
      { ...f.timeline, clock: { ...f.timeline.clock, segments: Array(65).fill(f.timeline.clock.segments[0]) } },
    ]) expect(() => parseTtrpgOpenGeneratedVoiceTimelineV1(changed)).toThrow()
  })
  it('captures closed data before async hashes so a caller cannot substitute source/timing/media mid-check', async () => {
    const f = await fixture(), expected = structuredClone(f.timeline), media = { ...f.media }
    const pending = verifyTtrpgOpenGeneratedVoiceTimelineV1(f.timeline, f.source, f.media)
    f.timeline.clock.segments[0].textSha256 = '0'.repeat(64); f.timeline.normalizedText = '晚到替换'; f.media.durationMs = 2000
    expect(await pending).toEqual(expected)
    expect(await verifyTtrpgOpenGeneratedVoiceTimelineV1(expected, f.source, media)).toEqual(expected)
  })
  it('uses exact sample boundaries and permits navigation from ended playback without inventing an active word', async () => {
    const { clock } = (await fixture()).timeline, split = clock.segments[1].sampleOffset
    expect(ttrpgOpenVoiceReadingPositionV1(clock, (split - .25) / 44100)).toEqual({ active: 0, previous: -1, next: 1 })
    expect(ttrpgOpenVoiceReadingPositionV1(clock, split / 44100)).toEqual({ active: 1, previous: 0, next: -1 })
    expect(ttrpgOpenVoiceReadingPositionV1(clock, clock.samples / 44100)).toEqual({ active: -1, previous: 1, next: -1 })
    for (const seconds of [-1, NaN, Infinity]) expect(ttrpgOpenVoiceReadingPositionV1(clock, seconds)).toEqual({ active: -1, previous: -1, next: 0 })
  })
  it('leaves legacy char/word bytes and hashes unchanged; a generated clock cannot enter that parser or upload origin', async () => {
    const f = await fixture(), legacy = { granularity: 'word' as const, marks: [{ textOffset: 0, textLength: 2, startMs: 0, durationMs: 100 }], speakerVoiceId: 'ZH', styleKey: null, styleDegree: null }
    const before = canonicalStringify(legacy), hash = await hashCanonicalValue(legacy)
    expect(validateTtrpgVoiceTimelineV1(legacy, '原文')).toEqual(legacy)
    expect(canonicalStringify(validateTtrpgVoiceTimelineV1(legacy, '原文'))).toBe(before)
    expect(await hashCanonicalValue(validateTtrpgVoiceTimelineV1(legacy, '原文'))).toBe(hash)
    expect(() => validateTtrpgVoiceTimelineV1(f.timeline, f.source)).toThrow()
    const request = { action: 'play', channel: 'voice', audience: 'party', privateActorKey: null, narrationSourceRef: { sessionKey: 'session.original', sequence: 1 }, fade: 0,
      voiceTimeline: legacy, media: { kind: 'generated', submissionKey: 'candidate.original' } }
    expect(() => parseTtrpgOpenAudioRequestV1(request)).toThrow()
    expect(() => parseTtrpgOpenAudioRequestV1({ ...request, media: { kind: 'upload', submissionKey: 'manual.original' }, voiceTimeline: f.timeline })).toThrow()
  })
})
