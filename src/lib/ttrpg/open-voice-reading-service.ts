/** Review a CPU frontend response against an actual accepted narration. A
 * serialized preview is untrusted evidence, not a model execution capability. */
import { readTtrpgOpenReviewedVoiceScriptV1, type TtrpgOpenVoiceScriptReviewV1 } from './open-voice-script-service'
import { parseTtrpgOpenVoicePartV1 } from './open-voice-request-contract'
import { ttrpgOpenVoiceReadingTextV1, verifyTtrpgOpenVoiceReadingPreviewV1, type TtrpgOpenVoiceReadingPreviewV1, type TtrpgOpenVoicePronunciationV1 } from './open-voice-reading-contract'
import type { TtrpgOpenAudioReadInputV1 } from './open-audio-read-state'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'
import { requestText } from './open-local-voice-transport'
import readingProfile from '../../../scripts/ttrpg-local-tts/reading-profile.json'

export interface TtrpgOpenVoiceReadingReviewV1 {
  schema: 'storyforge.ttrpg-open-voice-reading-review'; version: 1; reviewKey: string
  scriptHash: string; part: { textOffset: number; textLength: number; textHash: string }
  preview: TtrpgOpenVoiceReadingPreviewV1; previewHash: string
  generationAllowed: false; adoptionAllowed: false
}
const issued = new WeakMap<TtrpgOpenVoiceReadingReviewV1, { input: TtrpgOpenAudioReadInputV1; source: TtrpgOpenVoiceScriptReviewV1; body: string }>()
const owner = (input: TtrpgOpenAudioReadInputV1) => ({ scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey })

/** Explicit CPU-only preflight, always tied to the actual human source review.
 * No model reservation, job, generation, repair or retry endpoint is called. */
export async function previewTtrpgOpenVoiceReadingV1(request: TtrpgOpenAudioReadInputV1 & {
  sourceReview: TtrpgOpenVoiceScriptReviewV1; part: { textOffset: number; textLength: number }
  overrides: TtrpgOpenVoicePronunciationV1[]; decision: 'preview-this-original-voice-reading'; signal?: AbortSignal
}) {
  const input = owner(request), sourceReview = request.sourceReview, part = structuredClone(request.part), overrides = structuredClone(request.overrides), signal = request.signal
  p.literal(request.decision,'preview-this-original-voice-reading','explicit CPU reading preview')
  const source = await readTtrpgOpenReviewedVoiceScriptV1({ ...input,review: sourceReview })
  const text = source.script.text.slice(part.textOffset,part.textOffset + part.textLength)
  parseTtrpgOpenVoicePartV1({ ...part,textHash: await sha256Text(text) },source.script.text)
  ttrpgOpenVoiceReadingTextV1(text,overrides)
  signal?.throwIfAborted()
  const raw = await requestText('/storyforge/local-tts/v1/reading-preview',{ method: 'POST',body: JSON.stringify({ decision: 'preview-this-original-voice-reading',
    input: { schema: 'storyforge.ttrpg-local-tts-reading-input',version: 1,text,overrides } }) },signal,readingProfile.maxPayloadBytes,readingProfile.timeoutMs + 2000)
  signal?.throwIfAborted()
  return prepareTtrpgOpenVoiceReadingReviewV1({ ...input,sourceReview,part,overrides,preview: JSON.parse(raw),decision: 'review-this-local-voice-reading' })
}

export async function prepareTtrpgOpenVoiceReadingReviewV1(input: TtrpgOpenAudioReadInputV1 & {
  sourceReview: TtrpgOpenVoiceScriptReviewV1; part: { textOffset: number; textLength: number }
  overrides: TtrpgOpenVoicePronunciationV1[]; preview: unknown; decision: 'review-this-local-voice-reading'
}): Promise<TtrpgOpenVoiceReadingReviewV1> {
  p.literal(input.decision, 'review-this-local-voice-reading', 'explicit local reading review')
  const request = owner(input), source = input.sourceReview, selection = structuredClone(input.part), rawPreview = structuredClone(input.preview), overrides = structuredClone(input.overrides)
  const read = await readTtrpgOpenReviewedVoiceScriptV1({ ...request, review: source })
  const text = read.script.text.slice(selection.textOffset, selection.textOffset + selection.textLength)
  const part = parseTtrpgOpenVoicePartV1({ ...selection, textHash: await sha256Text(text) }, read.script.text)
  const preview = await verifyTtrpgOpenVoiceReadingPreviewV1(rawPreview, text, overrides)
  const review: TtrpgOpenVoiceReadingReviewV1 = { schema: 'storyforge.ttrpg-open-voice-reading-review', version: 1, reviewKey: crypto.randomUUID(),
    scriptHash: read.scriptHash, part, preview, previewHash: await hashCanonicalValue(preview), generationAllowed: false, adoptionAllowed: false }
  await readTtrpgOpenReviewedVoiceScriptV1({ ...request, review: source })
  issued.set(review, { input: request, source, body: canonicalStringify(review) })
  return review
}

export async function readTtrpgOpenReviewedVoiceReadingV1(input: TtrpgOpenAudioReadInputV1 & { review: TtrpgOpenVoiceReadingReviewV1 }) {
  const request = owner(input), review = input.review, proof = issued.get(review)
  const unchanged = () => !!proof && canonicalStringify(proof.input) === canonicalStringify(request) && proof.body === canonicalStringify(review)
  if (!proof || !unchanged()) p.fail('请以本人身份重新核对原文与本机读法')
  const source = await readTtrpgOpenReviewedVoiceScriptV1({ ...request, review: proof.source })
  if (!unchanged() || source.scriptHash !== review.scriptHash) p.fail('原文、接收者、身份或朗读审阅已变化')
  return { ...source, part: structuredClone(review.part), preview: structuredClone(review.preview), previewHash: review.previewHash,
    generationAllowed: false as const, adoptionAllowed: false as const }
}
