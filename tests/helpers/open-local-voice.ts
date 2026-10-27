import { readFileSync } from 'node:fs'
import { setupAudioRuntimeV1 } from './open-audio-runtime'
import { prepareTtrpgOpenVoiceScriptV1, prepareTtrpgOpenVoiceReadingReviewV1, reserveTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1 as decision } from '../../src/lib/ttrpg/open-voice-execution-input'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

const readingProfile = JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json', 'utf8'))
// A synthetic frontend DTO isolates browser governance. Actual normalization
// and speech quality require the separate pinned CPU/real-audio evidence.
export async function setupLocalVoiceExecutionV1(confirmed = true, humanGm = true) {
  const s = await setupAudioRuntimeV1(humanGm, '编号001。')
  const sourceReview = await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef,
    audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
  const overrides = [{ textOffset: 2, textLength: 3, spokenText: '零零一' }], part = { textOffset: 0, textLength: s.text.length }
  const preview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: await hashCanonicalValue(readingProfile),
    normalizerSha256: readingProfile.normalizerSha256, status: 'ready-for-reading-review', sourceText: s.text, sourceTextSha256: await sha256Text(s.text),
    overrides, readingText: '编号零零一。', normalizedText: '编号零零一.', normalizedTextSha256: await sha256Text('编号零零一.'), issues: [], issueCount: 0,
    issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  const review = await prepareTtrpgOpenVoiceReadingReviewV1({ ...s.owner, sourceReview, part, overrides, preview, decision: 'review-this-local-voice-reading' })
  const requested = await reserveTtrpgOpenVoiceRequestV1({ ...s.owner, review: sourceReview, part, submissionKey: 'execution.original', decision: 'reserve-this-original-voice-part',
    ...(confirmed ? { readingConfirmation: { review, decision: 'confirm-this-exact-local-voice-reading' as const } } : {}) })
  return { ...s, requested, input: { ...s.owner, requestKey: requested.requestKey, decision } }
}
