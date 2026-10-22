/** Dedicated local speech input. The original registered source and its
 * explicit reading transform remain distinct; no prompt or executable path. */
import { currentTtrpgOpenVoiceProductProfileV1, parseTtrpgOpenOriginalVoiceProfileV1 } from './open-voice-product-profile'
import type { TtrpgNarratorVoiceV1 } from './narration-listening-preferences'
import readingProfile from '../../../scripts/ttrpg-local-tts/reading-profile.json'
import type { TtrpgOpenVoiceRequestV1 } from './open-voice-request-contract'
import { verifyTtrpgOpenConfirmedVoiceReadingV1 } from './open-voice-confirmed-reading-contract'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 = 'ttrpg.open.local-voice'
export const TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1 = 'ttrpg.open.local-voice.v1'
export const TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1 = 'prepare-this-confirmed-local-voice-execution'

export async function createTtrpgOpenVoiceExecutionInputForKernelV1(input: {
  row: TtrpgOpenVoiceRequestV1; sourceText: string; intentReceiptHash: string; intentVerificationArtifactHash: string
  voice?: TtrpgNarratorVoiceV1; originalProfile?: unknown
}) {
  const row = structuredClone(input.row), sourceText = input.sourceText
  const profile = input.originalProfile === undefined ? currentTtrpgOpenVoiceProductProfileV1(input.voice) : parseTtrpgOpenOriginalVoiceProfileV1(input.originalProfile)
  if (!row.reading) p.fail('原请求没有明确确认的读法，旧意图不能自动升级为语音执行')
  const { reading } = await verifyTtrpgOpenConfirmedVoiceReadingV1(row.reading, sourceText, row.part.textHash)
  if (sourceText !== row.script.text.slice(row.part.textOffset, row.part.textOffset + row.part.textLength)
    || await sha256Text(sourceText) !== row.part.textHash
    || canonicalStringify(reading.profile) !== canonicalStringify(readingProfile)
    || profile.readingProfileId !== reading.profile.profileId || profile.assetProfileId !== reading.profile.assetProfileId
    || profile.assetProfileSha256 !== reading.profile.assetProfileSha256
    || profile.maxSourceUtf16 !== reading.profile.maxSourceUtf16 || profile.maxReadingUtf16 !== reading.profile.maxReadingUtf16
    || profile.requiredAuthority !== 'original-durable-voice-execution-v1' || profile.network !== 'disabled'
    || !profile.readingRecomputationRequired || profile.automaticRetryAllowed || profile.adoptionAllowed) p.fail('当前产品语音版本不支持原读法或准确来源，保留历史并重新审阅')
  return { schema: 'storyforge.ttrpg-open-voice-execution-input' as const, version: 1 as const,
    requestKey: row.requestKey, decision: TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1,
    intent: { inputArtifactHash: row.inputArtifactHash, receiptHash: p.hash(input.intentReceiptHash, 'original voice intent receipt'),
      verificationArtifactHash: p.hash(input.intentVerificationArtifactHash, 'original voice verification artifact') },
    source: { text: sourceText, textHash: row.part.textHash, scriptHash: row.scriptHash, part: row.part,
      narrationSourceRef: row.script.narrationSourceRef, reservationSourceRef: row.sourceRef, scope: row.script.scope },
    reading, profile: structuredClone(profile), profileHash: await hashCanonicalValue(profile) }
}
export type TtrpgOpenVoiceExecutionInputV1 = Awaited<ReturnType<typeof createTtrpgOpenVoiceExecutionInputForKernelV1>>
