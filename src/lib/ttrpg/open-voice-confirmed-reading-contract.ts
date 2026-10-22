/** Frozen human reading choice. Archive validation must not reinterpret an old
 * request with today's installed profile. This grants no execution authority. */
import { TTRPG_OPEN_VOICE_READING_LIMITS_V1, ttrpgOpenVoiceReadingTextV1, type TtrpgOpenVoicePronunciationV1, type TtrpgOpenVoiceReadingPreviewV1 } from './open-voice-reading-contract'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_CONFIRM_READING_DECISION_V1 = 'confirm-this-exact-local-voice-reading' as const
/** Keep the complete reading descriptor, not a hash that would depend on an
 * old checkout still being available. Never use an archived descriptor to pick
 * an executable path or grant model permission. */
function parseFrozenReadingProfileV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'profileId', 'assetProfileId', 'assetProfileSha256', 'normalizerPath', 'normalizerSha256',
    'cn2anVersion', 'maxSourceUtf16', 'maxReadingUtf16', 'maxOverrides', 'maxReportedIssues', 'timeoutMs', 'maxPayloadBytes', 'modelInvocationAllowed', 'adoptionAllowed'], 'frozen reading profile')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-local-tts-reading-profile', 'reading profile schema'), version: p.literal(r.version, 1, 'reading profile version'),
    profileId: p.key(r.profileId, 'reading profile id'), assetProfileId: p.key(r.assetProfileId, 'shared asset profile id'), assetProfileSha256: p.hash(r.assetProfileSha256, 'shared asset profile hash'),
    normalizerPath: p.literal(r.normalizerPath, 'melo/text/chinese_mix.py', 'reading normalizer source'), normalizerSha256: p.hash(r.normalizerSha256, 'reading normalizer hash'), cn2anVersion: p.key(r.cn2anVersion, 'number frontend version'),
    maxSourceUtf16: p.literal(r.maxSourceUtf16, TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxSourceUtf16, 'V1 source budget'), maxReadingUtf16: p.literal(r.maxReadingUtf16, TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxReadingUtf16, 'V1 reading budget'),
    maxOverrides: p.literal(r.maxOverrides, TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxOverrides, 'V1 reading choices'), maxReportedIssues: p.literal(r.maxReportedIssues, 64, 'V1 reported issues'),
    timeoutMs: p.literal(r.timeoutMs, 10000, 'V1 reading time bound'), maxPayloadBytes: p.literal(r.maxPayloadBytes, 65536, 'V1 reading byte bound'),
    modelInvocationAllowed: p.literal(r.modelInvocationAllowed, false, 'no reading model authority'), adoptionAllowed: p.literal(r.adoptionAllowed, false, 'no reading adoption authority') }
}
export interface TtrpgOpenConfirmedVoiceReadingV1 {
  schema: 'storyforge.ttrpg-open-confirmed-voice-reading'; version: 1
  decision: typeof TTRPG_OPEN_VOICE_CONFIRM_READING_DECISION_V1
  sourceTextHash: string; profile: ReturnType<typeof parseFrozenReadingProfileV1>; profileHash: string; normalizerSha256: string
  overrides: TtrpgOpenVoicePronunciationV1[]
  normalizedText: string; normalizedTextSha256: string; previewHash: string
}

export function parseTtrpgOpenConfirmedVoiceReadingV1(value: unknown, text: string, textHash: string): TtrpgOpenConfirmedVoiceReadingV1 {
  const r = p.record(value, ['schema', 'version', 'decision', 'sourceTextHash', 'profile', 'profileHash', 'normalizerSha256', 'overrides',
    'normalizedText', 'normalizedTextSha256', 'previewHash'], 'frozen voice reading')
  const { overrides } = ttrpgOpenVoiceReadingTextV1(text, r.overrides), profile = parseFrozenReadingProfileV1(r.profile)
  if (r.sourceTextHash !== textHash || typeof r.normalizedText !== 'string' || !r.normalizedText.trim()
    || r.normalizedText.length > TTRPG_OPEN_VOICE_READING_LIMITS_V1.maxReadingUtf16 || /[\uD800-\uDFFF]/u.test(r.normalizedText)
    || r.normalizerSha256 !== profile.normalizerSha256) p.fail('已确认读法缺少准确原片段、前端描述或完整有限归一文字')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-confirmed-voice-reading', 'frozen reading schema'), version: p.literal(r.version, 1, 'frozen reading version'),
    decision: p.literal(r.decision, TTRPG_OPEN_VOICE_CONFIRM_READING_DECISION_V1, 'explicit reading confirmation'),
    sourceTextHash: p.hash(r.sourceTextHash, 'frozen reading source hash'), profile, profileHash: p.hash(r.profileHash, 'frozen reading profile'),
    normalizerSha256: p.hash(r.normalizerSha256, 'frozen reading normalizer'), overrides, normalizedText: r.normalizedText,
    normalizedTextSha256: p.hash(r.normalizedTextSha256, 'frozen normalized hash'), previewHash: p.hash(r.previewHash, 'frozen preview hash') }
}

/** Verify historical bytes independently of the current installed frontend.
 * Dispatch must additionally match a supported product profile and recompute. */
export async function verifyTtrpgOpenConfirmedVoiceReadingV1(value: unknown, text: string, textHash: string) {
  const reading = parseTtrpgOpenConfirmedVoiceReadingV1(structuredClone(value), text, textHash)
  const { readingText } = ttrpgOpenVoiceReadingTextV1(text, reading.overrides)
  const preview: TtrpgOpenVoiceReadingPreviewV1 = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1,
    profileHash: reading.profileHash, normalizerSha256: reading.normalizerSha256, status: 'ready-for-reading-review',
    sourceText: text, sourceTextSha256: reading.sourceTextHash, overrides: reading.overrides, readingText,
    normalizedText: reading.normalizedText, normalizedTextSha256: reading.normalizedTextSha256, issues: [], issueCount: 0,
    issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  if (await sha256Text(text) !== reading.sourceTextHash || await sha256Text(reading.normalizedText) !== reading.normalizedTextSha256
    || await hashCanonicalValue(reading.profile) !== reading.profileHash
    || await hashCanonicalValue(preview) !== reading.previewHash) p.fail('原已确认读法、归一字节或前端版本证明已变化')
  return { reading, preview }
}
