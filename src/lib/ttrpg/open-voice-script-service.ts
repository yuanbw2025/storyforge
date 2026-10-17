/** Local human source review only. No model transport, durable job, Blob import,
 * E16 authorization or playback can be obtained from this object. */
import { loadTtrpgOpenAudioReadStateV1, type TtrpgOpenAudioReadInputV1 } from './open-audio-read-state'
import { createTtrpgOpenVoiceScriptV1 } from './open-audio-contract'
import type { TtrpgOpenVoiceScriptV1 } from './open-voice-script-contract'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgAudioAudienceV1 } from './open-audio-runtime'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

export interface TtrpgOpenVoiceScriptReviewV1 {
  schema: 'storyforge.ttrpg-open-voice-script-review'; version: 1; reviewKey: string
  sessionId: number; viewerKey: string; sequence: number; authorizationRevision: number
  script: TtrpgOpenVoiceScriptV1; scriptHash: string; textHash: string
  generationAllowed: false; adoptionAllowed: false
}
const issued = new WeakMap<TtrpgOpenVoiceScriptReviewV1, { inputKey: string; body: string }>()
const snapshot = (input: TtrpgOpenAudioReadInputV1) => ({ scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey })

export async function prepareTtrpgOpenVoiceScriptV1(request: TtrpgOpenAudioReadInputV1 & {
  narrationSourceRef: TtrpgOpenSourceRefV1; audience: TtrpgAudioAudienceV1; privateActorKey: string | null
  decision: 'review-original-narration-for-voice'
}): Promise<TtrpgOpenVoiceScriptReviewV1> {
  p.literal(request.decision, 'review-original-narration-for-voice', 'voice source review')
  const input = snapshot(request), selection = { narrationSourceRef: structuredClone(request.narrationSourceRef), audience: request.audience, privateActorKey: request.privateActorKey }
  const loaded = await loadTtrpgOpenAudioReadStateV1(input)
  const script = createTtrpgOpenVoiceScriptV1({ ...selection, runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey })
  const review: TtrpgOpenVoiceScriptReviewV1 = { schema: 'storyforge.ttrpg-open-voice-script-review', version: 1, reviewKey: crypto.randomUUID(),
    sessionId: input.sessionId, viewerKey: input.viewerKey, sequence: loaded.state.lastSequence, authorizationRevision: loaded.authorization.revision,
    script, scriptHash: await hashCanonicalValue(script), textHash: await sha256Text(script.text), generationAllowed: false, adoptionAllowed: false }
  await loaded.assertCurrent()
  issued.set(review, { inputKey: stable(input), body: stable(review) }); return review
}

/** Re-read the actual owner and source; ordinary text progress need not change
 * an immutable accepted script. A fresh source read still grants no dispatch. */
export async function readTtrpgOpenReviewedVoiceScriptV1(request: TtrpgOpenAudioReadInputV1 & { review: TtrpgOpenVoiceScriptReviewV1 }) {
  const input = snapshot(request), review = request.review, proof = issued.get(review)
  const unchanged = () => !!proof && proof.inputKey === stable(input) && proof.body === stable(review)
  if (!unchanged()) p.fail('请以本人身份重新核对原配音文字与接收者')
  const selected = structuredClone(review.script)
  const loaded = await loadTtrpgOpenAudioReadStateV1(input)
  const current = createTtrpgOpenVoiceScriptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey,
    narrationSourceRef: selected.narrationSourceRef, audience: selected.scope.audience, privateActorKey: selected.scope.privateActorKey })
  if (!unchanged() || loaded.authorization.revision !== review.authorizationRevision || stable(current) !== stable(selected)
    || await hashCanonicalValue(current) !== review.scriptHash || await sha256Text(current.text) !== review.textHash) p.fail('原配音文字、来源、身份或接收者已变化，请重新核对')
  await loaded.assertCurrent()
  if (!unchanged()) p.fail('配音审阅在读取期间已变化，请重新核对')
  return { script: structuredClone(current), scriptHash: review.scriptHash, textHash: review.textHash,
    readEvidence: { sequence: loaded.state.lastSequence, stateHash: loaded.stateHash, sessionKey: loaded.runtime.sessionKey,
      runtimeSourceHash: loaded.session.runtimeSourceHash, authorizationRevision: loaded.authorization.revision },
    generationAllowed: false as const, adoptionAllowed: false as const }
}
