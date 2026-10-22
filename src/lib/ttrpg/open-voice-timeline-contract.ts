/** Historical generated speech timing. Parsing verifies data only: it grants
 * no listening, media import, E16, model or candidate-adoption authority.
 * Keep the legacy char/word timeline and raw candidate bytes unchanged. */
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

// V1 wire limits are immutable, independent of the currently installed worker.
// The complete source bound is the original 16000-body/eight-paragraph contract.
export const TTRPG_OPEN_VOICE_TIMING_LIMITS_V1 = Object.freeze({
  maxOriginalUtf16: 16014, maxPartUtf16: 2000, maxReadingUtf16: 4000,
  maxSegmentUtf16: 200, maxSegments: 64, sampleRate: 44100,
  maxSamples: 44100 * 900, maxSegmentSamples: 44100 * 60,
})
export interface TtrpgOpenVoiceSampleClockV1 {
  kind: 'normalized-reading-segments'; wordAlignmentProvided: false
  originalPart: { textOffset: number; textLength: number; textHash: string }
  sampleRate: 44100; samples: number
  segments: { index: number; readingOffsetUtf16: number; readingLengthUtf16: number; textSha256: string;
    sampleOffset: number; sampleCount: number; gain: number }[]
}
export interface TtrpgOpenGeneratedVoiceTimelineV1 {
  schema: 'storyforge.ttrpg-open-generated-voice-timeline'; version: 1
  sourceTextHash: string; sourceTextLengthUtf16: number
  normalizedText: string; normalizedTextSha256: string
  clock: TtrpgOpenVoiceSampleClockV1
}
export const TTRPG_OPEN_VOICE_TIMING_LIMITS_V2 = Object.freeze({
  ...TTRPG_OPEN_VOICE_TIMING_LIMITS_V1, maxSegmentUtf16: 100, sampleRate: 24000,
  maxSamples: 24000 * 900, maxSegmentSamples: 24000 * 60,
})
export interface TtrpgOpenVoiceSampleClockV2 extends Omit<TtrpgOpenVoiceSampleClockV1, 'sampleRate'> { sampleRate: 24000 }
export interface TtrpgOpenGeneratedVoiceTimelineV2 extends Omit<TtrpgOpenGeneratedVoiceTimelineV1, 'version' | 'clock'> {
  version: 2; clock: TtrpgOpenVoiceSampleClockV2
}
export type TtrpgOpenGeneratedVoiceTimeline = TtrpgOpenGeneratedVoiceTimelineV1 | TtrpgOpenGeneratedVoiceTimelineV2
const limits = TTRPG_OPEN_VOICE_TIMING_LIMITS_V1
function exactText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\uD800-\uDFFF]/u.test(value)) p.fail(`${label}: 原文字节为空、超限或含不完整 UTF-16 字符`)
  return value
}
function boundary(text: string, offset: number): boolean {
  return !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]))
}
/** Same byte shape as the retained raw candidate's clock. No text normalization
 * or interpolation from original characters to spoken characters is allowed. */
function parseClock(value: unknown, readingText: string, version: 1 | 2): TtrpgOpenVoiceSampleClockV1 | TtrpgOpenVoiceSampleClockV2 {
  const limits = version === 1 ? TTRPG_OPEN_VOICE_TIMING_LIMITS_V1 : TTRPG_OPEN_VOICE_TIMING_LIMITS_V2
  const text = exactText(readingText, 'actual normalized reading', limits.maxReadingUtf16)
  const r = p.record(value, ['kind', 'wordAlignmentProvided', 'originalPart', 'sampleRate', 'samples', 'segments'], 'generated voice sample clock')
  const part = p.record(r.originalPart, ['textOffset', 'textLength', 'textHash'], 'generated voice original part')
  const originalPart = { textOffset: p.integer(part.textOffset, 'original part offset', 0, limits.maxOriginalUtf16),
    textLength: p.integer(part.textLength, 'original part length', 1, limits.maxPartUtf16), textHash: p.hash(part.textHash, 'original part hash') }
  if (originalPart.textOffset + originalPart.textLength > limits.maxOriginalUtf16) p.fail('原配音片段超出完整叙述的版本边界')
  const samples = p.integer(r.samples, 'actual total samples', 1, limits.maxSamples)
  let offset = 0, sample = 0
  const segments = p.list(r.segments, 'actual generated reading segments', (value, label) => {
    const s = p.record(value, ['index', 'readingOffsetUtf16', 'readingLengthUtf16', 'textSha256', 'sampleOffset', 'sampleCount', 'gain'], label)
    const index = p.integer(s.index, 'actual segment index', 0, limits.maxSegments - 1)
    const readingLengthUtf16 = p.integer(s.readingLengthUtf16, 'actual segment reading length', 1, limits.maxSegmentUtf16)
    const sampleCount = p.integer(s.sampleCount, 'actual segment sample count', 1, limits.maxSegmentSamples)
    const readingOffsetUtf16 = p.integer(s.readingOffsetUtf16, 'actual reading offset', 0, text.length)
    const sampleOffset = p.integer(s.sampleOffset, 'actual sample offset', 0, samples)
    if (readingOffsetUtf16 !== offset || sampleOffset !== sample || !boundary(text, offset + readingLengthUtf16)) p.fail('实际朗读片段必须按原样连续覆盖文字与样本，不能拆开 UTF-16 字符')
    offset += readingLengthUtf16; sample += sampleCount
    if (offset > text.length || sample > samples) p.fail('实际朗读片段超出完整文字或物理样本')
    return { index, readingOffsetUtf16, readingLengthUtf16, textSha256: p.hash(s.textSha256, 'actual segment text hash'),
      sampleOffset, sampleCount, gain: p.number(s.gain, 'actual segment gain', Number.MIN_VALUE, 1) }
  }, limits.maxSegments, 1)
  if (offset !== text.length || sample !== samples || segments.some((s, index) => s.index !== index)) p.fail('实际朗读时钟未完整覆盖归一文字或物理样本')
  return { kind: p.literal(r.kind, 'normalized-reading-segments', 'actual segment clock kind'),
    wordAlignmentProvided: p.literal(r.wordAlignmentProvided, false, 'no word alignment'), originalPart,
    sampleRate: p.literal(r.sampleRate, limits.sampleRate, 'V1 sample rate'), samples, segments }
}
export function parseTtrpgOpenVoiceSampleClockV1(value: unknown, readingText: string): TtrpgOpenVoiceSampleClockV1 {
  return parseClock(value, readingText, 1) as TtrpgOpenVoiceSampleClockV1
}
export function parseTtrpgOpenVoiceSampleClockV2(value: unknown, readingText: string): TtrpgOpenVoiceSampleClockV2 {
  return parseClock(value, readingText, 2) as TtrpgOpenVoiceSampleClockV2
}
export async function verifyTtrpgOpenVoiceSampleClockV2(value: unknown, readingText: string): Promise<TtrpgOpenVoiceSampleClockV2> {
  const clock = parseTtrpgOpenVoiceSampleClockV2(value, readingText)
  for (const s of clock.segments) if (await sha256Text(readingText.slice(s.readingOffsetUtf16, s.readingOffsetUtf16 + s.readingLengthUtf16)) !== s.textSha256) p.fail('实际朗读片段与原准确文字 hash 不一致')
  return clock
}
export async function verifyTtrpgOpenVoiceSampleClockV1(value: unknown, readingText: string): Promise<TtrpgOpenVoiceSampleClockV1> {
  const clock = parseTtrpgOpenVoiceSampleClockV1(value, readingText)
  for (const s of clock.segments) if (await sha256Text(readingText.slice(s.readingOffsetUtf16, s.readingOffsetUtf16 + s.readingLengthUtf16)) !== s.textSha256) p.fail('实际朗读片段与原准确文字 hash 不一致')
  return clock
}

/** Self-contained timing for a future accepted receipt. The full original prose
 * remains the fallback; only originalPart is spoken, in normalizedText units. */
export function parseTtrpgOpenGeneratedVoiceTimelineV1(value: unknown): TtrpgOpenGeneratedVoiceTimelineV1 {
  const r = p.record(value, ['schema', 'version', 'sourceTextHash', 'sourceTextLengthUtf16', 'normalizedText', 'normalizedTextSha256', 'clock'], 'generated voice timeline')
  const normalizedText = exactText(r.normalizedText, 'exact normalized reading', limits.maxReadingUtf16)
  const clock = parseTtrpgOpenVoiceSampleClockV1(r.clock, normalizedText)
  const sourceTextLengthUtf16 = p.integer(r.sourceTextLengthUtf16, 'complete source length', 1, limits.maxOriginalUtf16)
  if (clock.originalPart.textOffset + clock.originalPart.textLength > sourceTextLengthUtf16) p.fail('实际配音片段不能冒充或超出原完整叙述')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-generated-voice-timeline', 'generated timeline schema'),
    version: p.literal(r.version, 1, 'generated timeline version'), sourceTextHash: p.hash(r.sourceTextHash, 'complete original prose hash'), sourceTextLengthUtf16,
    normalizedText, normalizedTextSha256: p.hash(r.normalizedTextSha256, 'complete normalized reading hash'), clock }
}
export async function verifyTtrpgOpenGeneratedVoiceTimelineV1(value: unknown, originalText: string, media: {
  mimeType: string; byteSize: number; durationMs: number | null
}): Promise<TtrpgOpenGeneratedVoiceTimelineV1> {
  // Capture the closed data and physical declaration before the first await.
  const t = parseTtrpgOpenGeneratedVoiceTimelineV1(value), text = exactText(originalText, 'complete original prose', limits.maxOriginalUtf16)
  const { mimeType, byteSize, durationMs } = media, { originalPart, samples, sampleRate } = t.clock
  const end = originalPart.textOffset + originalPart.textLength
  if (t.sourceTextLengthUtf16 !== text.length || !boundary(text, originalPart.textOffset) || !boundary(text, end)
    || !text.slice(originalPart.textOffset, end).trim() || mimeType !== 'audio/wav' || byteSize !== 44 + samples * 2
    || durationMs !== Math.round(samples * 1000 / sampleRate)) p.fail('配音时间轴与准确原文范围或物理 WAV 声明不一致')
  if (await sha256Text(text) !== t.sourceTextHash || await sha256Text(text.slice(originalPart.textOffset, end)) !== originalPart.textHash
    || await sha256Text(t.normalizedText) !== t.normalizedTextSha256) p.fail('配音原文、片段或归一读法的准确 hash 不一致')
  await verifyTtrpgOpenVoiceSampleClockV1(t.clock, t.normalizedText)
  return t
}

/** Explicit new physical version; never reinterpret a historical V1 clock. */
export function parseTtrpgOpenGeneratedVoiceTimeline(value: unknown): TtrpgOpenGeneratedVoiceTimeline {
  const r = p.object(value, 'generated voice timeline')
  if (r.version === 1) return parseTtrpgOpenGeneratedVoiceTimelineV1(value)
  if (r.version !== 2) p.fail('未知配音时间轴版本')
  p.record(r, ['schema', 'version', 'sourceTextHash', 'sourceTextLengthUtf16', 'normalizedText', 'normalizedTextSha256', 'clock'], 'native generated voice timeline')
  const normalizedText = exactText(r.normalizedText, 'exact normalized reading', limits.maxReadingUtf16)
  const clock = parseTtrpgOpenVoiceSampleClockV2(r.clock, normalizedText)
  const sourceTextLengthUtf16 = p.integer(r.sourceTextLengthUtf16, 'complete source length', 1, limits.maxOriginalUtf16)
  if (clock.originalPart.textOffset + clock.originalPart.textLength > sourceTextLengthUtf16) p.fail('实际配音片段超出原完整叙述')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-generated-voice-timeline', 'generated timeline schema'), version: 2,
    sourceTextHash: p.hash(r.sourceTextHash, 'complete original prose hash'), sourceTextLengthUtf16, normalizedText,
    normalizedTextSha256: p.hash(r.normalizedTextSha256, 'complete normalized reading hash'), clock }
}
export async function verifyTtrpgOpenGeneratedVoiceTimeline(value: unknown, originalText: string, media: {
  mimeType: string; byteSize: number; durationMs: number | null
}): Promise<TtrpgOpenGeneratedVoiceTimeline> {
  const t = parseTtrpgOpenGeneratedVoiceTimeline(value)
  if (t.version === 1) return verifyTtrpgOpenGeneratedVoiceTimelineV1(t, originalText, media)
  const text = exactText(originalText, 'complete original prose', limits.maxOriginalUtf16)
  const { mimeType, byteSize, durationMs } = media, { originalPart, samples, sampleRate } = t.clock
  const end = originalPart.textOffset + originalPart.textLength
  if (t.sourceTextLengthUtf16 !== text.length || !boundary(text, originalPart.textOffset) || !boundary(text, end)
    || !text.slice(originalPart.textOffset, end).trim() || mimeType !== 'audio/wav' || byteSize !== 44 + samples * 2
    || durationMs !== Math.round(samples * 1000 / sampleRate)) p.fail('配音时间轴与原文范围或物理 WAV 不一致')
  if (await sha256Text(text) !== t.sourceTextHash || await sha256Text(text.slice(originalPart.textOffset, end)) !== originalPart.textHash
    || await sha256Text(t.normalizedText) !== t.normalizedTextSha256) p.fail('配音原文、片段或归一读法的准确 hash 不一致')
  await verifyTtrpgOpenVoiceSampleClockV2(t.clock, t.normalizedText)
  return t
}

/** Positions in the actual sample clock, never rounded millisecond marks or
 * guessed original-text offsets. Ended/invalid playback has no active segment. */
export function ttrpgOpenVoiceReadingPositionV1(clock: TtrpgOpenVoiceSampleClockV1 | TtrpgOpenVoiceSampleClockV2, seconds: number) {
  const sample = seconds * clock.sampleRate
  if (!Number.isFinite(sample) || sample < 0) return { active: -1, previous: -1, next: 0 }
  const next = clock.segments.findIndex(s => s.sampleOffset > sample)
  const active = sample >= clock.samples ? -1 : clock.segments.findIndex(s => sample >= s.sampleOffset && sample < s.sampleOffset + s.sampleCount)
  return { active, previous: active >= 0 ? active - 1 : clock.segments.length - 1, next }
}
