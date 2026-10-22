/** A local CPU text preview is evidence for human review, never execution
 * authority. The eventual speech worker must recompute the frozen reading. */
import profile from '../../../scripts/ttrpg-local-tts/reading-profile.json'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_READING_LIMITS_V1 = { maxSourceUtf16: 2000, maxReadingUtf16: 4000, maxOverrides: 64 } as const
export interface TtrpgOpenVoicePronunciationV1 { textOffset: number; textLength: number; spokenText: string }
export interface TtrpgOpenVoiceReadingPreviewV1 {
  schema: 'storyforge.ttrpg-local-tts-reading-preview'; version: 1
  profileHash: string; normalizerSha256: string
  status: 'needs-reading-choice' | 'ready-for-reading-review'
  sourceText: string; sourceTextSha256: string; overrides: TtrpgOpenVoicePronunciationV1[]
  readingText: string; normalizedText: string | null; normalizedTextSha256: string | null
  issues: { code: 'unsupported-script' | 'unsupported-character' | 'ambiguous-number'; textOffset: number; textLength: number }[]
  issueCount: number; issueOffsetsReferTo: 'readingText-utf16'
  modelCalled: false; generationAllowed: false; adoptionAllowed: false; network: 'disabled'
}

export function ttrpgOpenVoiceReadingTextV1(text: string, raw: unknown): { overrides: TtrpgOpenVoicePronunciationV1[]; readingText: string } {
  if (typeof text !== 'string' || !text.trim() || text.length > TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxSourceUtf16 || /[\uD800-\uDFFF]/u.test(text)) p.fail('朗读来源须是有限且完整的原文字符')
  const boundary = (offset: number) => !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]))
  let cursor = 0, readingText = ''
  const overrides = p.list(raw, 'explicit pronunciation choices', value => {
    const row = p.record(value, ['textOffset', 'textLength', 'spokenText'], 'pronunciation choice')
    const textOffset = p.integer(row.textOffset, 'pronunciation offset', cursor, text.length)
    const textLength = p.integer(row.textLength, 'pronunciation range', 1, text.length)
    if (textOffset + textLength > text.length || !boundary(textOffset) || !boundary(textOffset + textLength)
      || typeof row.spokenText !== 'string' || !row.spokenText.trim() || row.spokenText.length > TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxReadingUtf16
      || /[\uD800-\uDFFF]/u.test(row.spokenText)) p.fail('读法须指向有序、不重叠且完整的原文范围')
    readingText += text.slice(cursor, textOffset) + row.spokenText; cursor = textOffset + textLength
    return { textOffset, textLength, spokenText: row.spokenText }
  }, TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxOverrides, 0)
  readingText += text.slice(cursor)
  if (readingText.length > TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxReadingUtf16) p.fail('展开读法超出独立文字预算')
  return { overrides, readingText }
}

export async function verifyTtrpgOpenVoiceReadingPreviewV1(value: unknown, text: string, rawOverrides: unknown): Promise<TtrpgOpenVoiceReadingPreviewV1> {
  const expected = ttrpgOpenVoiceReadingTextV1(text, rawOverrides)
  const r = p.record(structuredClone(value), ['schema', 'version', 'profileHash', 'normalizerSha256', 'status', 'sourceText', 'sourceTextSha256', 'overrides',
    'readingText', 'normalizedText', 'normalizedTextSha256', 'issues', 'issueCount', 'issueOffsetsReferTo', 'modelCalled', 'generationAllowed', 'adoptionAllowed', 'network'], 'local reading preview')
  if (profile.version !== 1 || profile.maxSourceUtf16 !== TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxSourceUtf16
    || profile.maxReadingUtf16 !== TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxReadingUtf16 || profile.maxOverrides !== TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxOverrides
    || profile.modelInvocationAllowed !== false || profile.adoptionAllowed !== false || r.sourceText !== text || r.readingText !== expected.readingText
    || r.sourceTextSha256 !== await sha256Text(text) || r.profileHash !== await hashCanonicalValue(profile) || r.normalizerSha256 !== profile.normalizerSha256
    || JSON.stringify(ttrpgOpenVoiceReadingTextV1(text, r.overrides).overrides) !== JSON.stringify(expected.overrides)) p.fail('朗读预览与原文、明确读法或固定前端版本不一致')
  const issueCount = p.integer(r.issueCount, 'reading issue count', 0, profile.maxReadingUtf16 * 3)
  const issues = p.list(r.issues, 'reading issues', value => {
    const row = p.record(value, ['code', 'textOffset', 'textLength'], 'reading issue')
    const textOffset = p.integer(row.textOffset, 'reading issue offset', 0, expected.readingText.length)
    const textLength = p.integer(row.textLength, 'reading issue range', 1, expected.readingText.length)
    if (textOffset + textLength > expected.readingText.length) p.fail('朗读问题不在原准确读法范围内')
    return { code: p.oneOf(row.code, ['unsupported-script', 'unsupported-character', 'ambiguous-number'] as const, 'reading issue code'), textOffset, textLength }
  }, Math.min(issueCount, profile.maxReportedIssues), Math.min(issueCount, profile.maxReportedIssues))
  const status = p.oneOf(r.status, ['needs-reading-choice', 'ready-for-reading-review'] as const, 'reading preview status')
  let normalizedText: string | null = null, normalizedTextSha256: string | null = null
  if (status === 'needs-reading-choice') {
    if (!issueCount || r.normalizedText !== null || r.normalizedTextSha256 !== null) p.fail('待处理读法不能成为可朗读结果')
  } else {
    if (issueCount || typeof r.normalizedText !== 'string' || !r.normalizedText.trim() || r.normalizedText.length > profile.maxReadingUtf16
      || /[\uD800-\uDFFF]/u.test(r.normalizedText) || r.normalizedTextSha256 !== await sha256Text(r.normalizedText)) p.fail('归一朗读须保留准确有限文字和哈希')
    normalizedText = r.normalizedText; normalizedTextSha256 = r.normalizedTextSha256 as string
  }
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-local-tts-reading-preview', 'reading preview schema'), version: p.literal(r.version, 1, 'reading preview version'),
    profileHash: r.profileHash as string, normalizerSha256: r.normalizerSha256 as string, status, sourceText: text, sourceTextSha256: r.sourceTextSha256 as string,
    overrides: expected.overrides, readingText: expected.readingText, normalizedText, normalizedTextSha256, issues, issueCount,
    issueOffsetsReferTo: p.literal(r.issueOffsetsReferTo, 'readingText-utf16', 'reading issue coordinate system'), modelCalled: p.literal(r.modelCalled, false, 'no reading model'),
    generationAllowed: p.literal(r.generationAllowed, false, 'no reading generation'), adoptionAllowed: p.literal(r.adoptionAllowed, false, 'no reading adoption'),
    network: p.literal(r.network, 'disabled', 'offline reading frontend') }
}
