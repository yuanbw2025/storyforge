/** One receipt factory for the live original and its retained history. Neither
 * path grants runtime adoption or turns a declaration into independent QA. */
import type { AnyAgentRunEventV1, VerificationReceiptV1 } from '../types'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import type { TtrpgOpenVoiceQualityReviewV1 } from './open-voice-review-contract'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_GENERATION_VERIFIER_V1 = 'ttrpg.open.local-voice-v1'
export const TTRPG_OPEN_VOICE_GENERATION_VERIFICATION_SCHEMA_V1 = 'storyforge.ttrpg-open-voice-generation-verification'
export function ttrpgOpenVoiceQualityConfirmationV1(candidateHash: string, reviewArtifactHash: string) {
  return { stepId, candidateHash, decision: 'adopt' as const, reviewItemId: 'voice-quality:' + reviewArtifactHash,
    reviewDecision: 'acknowledged' as const, note: '原音频候选的本人试听声明；不代表音轨采用或独立真人验收。' }
}

export async function buildTtrpgOpenVoiceGenerationVerificationV1(request: {
  runId: number; generation: number; contractHash: string; events: readonly AnyAgentRunEventV1[]
  inputArtifactHash: string; requestKey: string; lineage: NonNullable<VerificationReceiptV1['lineage']>
  review: TtrpgOpenVoiceQualityReviewV1; reviewArtifactHash: string
}) {
  const input = structuredClone(request)
  const { review, reviewArtifactHash } = input
  const contexts = input.events.filter(e => e.type === 'context.assembled')
  if (contexts.length !== 1 || contexts[0].payload.stepId !== stepId || contexts[0].payload.attempt !== 1) p.fail('原生成终验缺少唯一实际 Manifest')
  const requested = input.events.filter(e => e.type === 'model.requested'), responded = input.events.filter(e => e.type === 'model.responded')
  if (requested.length !== 1 || requested[0].payload.stepId !== stepId || requested[0].payload.attempt !== 1 || requested[0].payload.bindingHash !== input.inputArtifactHash
    || responded.length !== 1 || responded[0].payload.stepId !== stepId || responded[0].payload.attempt !== 1) p.fail('原生成终验缺少唯一准确步骤的实际派发和返回')
  const { createVerificationReceiptV1 } = await import('../agent/run/verification-receipt')
  const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: input.generation,
    contractHash: input.contractHash, contextManifestHashes: [contexts[0].payload.manifestHash], candidateHashes: [review.candidateHash],
    adoptionEventIds: [], postStateHash: review.runtimeReadEvidence.stateHash, verifierSetVersion: TTRPG_OPEN_VOICE_GENERATION_VERIFIER_V1,
    acceptedAt: review.reviewedAt, lineage: input.lineage,
    criteria: [{ id: 'voice.audio-candidate', status: 'passed', evidenceRefs: ['candidate:' + review.candidateHash,
      'raw:' + responded[0].payload.outputHash, 'source:' + review.sourceEvidenceArtifactHash,
      'review:' + reviewArtifactHash, 'audio:' + review.audioContentHash] }] })
  const body = { schema: TTRPG_OPEN_VOICE_GENERATION_VERIFICATION_SCHEMA_V1, version: 1,
    requestKey: input.requestKey, reviewArtifactHash, receipt }
  return { receipt, content: stable(body), artifactHash: await hash(body) }
}
