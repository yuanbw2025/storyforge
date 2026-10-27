/** Isolated browser persistence fixture. The reading DTO is synthetic; this
 * helper does not run the normalizer, speech model, or author's browser data. */
import profile from '../../scripts/ttrpg-local-tts/reading-profile.json'
import { setupAudioRuntimeV1 } from './open-audio-runtime'
import { prepareTtrpgOpenVoiceScriptV1, prepareTtrpgOpenVoiceReadingReviewV1, reserveTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

export async function setupConfirmedVoiceExecutionRuntimeV1() {
  const s = await setupAudioRuntimeV1(true, '编号001。'), part = { textOffset: 0, textLength: s.text.length }
  const sourceReview = await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef,
    audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
  const overrides = [{ textOffset: 2, textLength: 3, spokenText: '零零一' }]
  const preview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: await hashCanonicalValue(profile), normalizerSha256: profile.normalizerSha256,
    status: 'ready-for-reading-review', sourceText: s.text, sourceTextSha256: await sha256Text(s.text), overrides, readingText: '编号零零一。', normalizedText: '编号零零一.',
    normalizedTextSha256: await sha256Text('编号零零一.'), issues: [], issueCount: 0, issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  const review = await prepareTtrpgOpenVoiceReadingReviewV1({ ...s.owner, sourceReview, part, overrides, preview, decision: 'review-this-local-voice-reading' })
  const original = await reserveTtrpgOpenVoiceRequestV1({ ...s.owner, review: sourceReview, part, submissionKey: 'native.voice.execution',
    decision: 'reserve-this-original-voice-part', readingConfirmation: { review, decision: 'confirm-this-exact-local-voice-reading' } })
  return { owner: s.owner, requestKey: original.requestKey }
}
