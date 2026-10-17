/** An actual accepted original interpretation; a new derivation never resumes its model Run. */
import { setupOracleRuntimeModelV1 } from './open-oracle-runtime-model'
import { openEnvelopeV1 } from './open-ttrpg-session'
import { generateTtrpgOpenOracleCandidateV2 } from '../../src/lib/ttrpg/open-intent-harness'
import { reviewTtrpgOpenOracleCandidateV1, closeTtrpgOpenEpochV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createTtrpgOpenNormalizationRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 } from '../../src/lib/ttrpg/open-coordination'

export async function setupNormalizationRuntimeSourceV1(audience: 'public' | 'party' | 'gm-only' = 'party', configure?: Parameters<typeof setupOracleRuntimeModelV1>[1], options: { selectedCharacterKeys?: string[]; interpretation?: string } = {}) {
  const s = await setupOracleRuntimeModelV1(audience, configure, undefined, { selectedCharacterKeys: options.selectedCharacterKeys })
  const original = await generateTtrpgOpenOracleCandidateV2({ ...s.input,
    runAI: async () => JSON.stringify({ interpretation: options.interpretation ?? '保留这条已接受原解释：该 NPC 对此地点仍不熟悉，事实另行审阅。', facts: [s.fact] }) })
  await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.original.accept'), ...s.resume(original.prepared),
    candidateHash: original.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null,
    choices: [{ proposalIndex: 0, decision: 'discard', reason: '原解释已接受，这条正向关系提案不采用' }] })
  await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.original.close'), viewerKey: s.owner.viewerKey,
    epochKey: original.candidate.epochKey, reason: '原解释审阅完成，归一需要另行明确授权' })
  const state = await readProductRuntimeState(s.f.sessionId), review = state.ttrpg!.openRun!.oracleReviews![0]
  const source = { content: s.f.runtimePackage.ttrpg!, runtimeSourceHash: s.f.session.runtimeSourceHash, runtime: state.ttrpg!,
    reviewSourceRef: review.sourceRef, consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } }
  const fact = { ...s.fact, canonicalValue: false, detail: '整理原已接受解释中该 NPC 尚不熟悉地点的关系。' }
  return { ...s, original, state, review, source, normalizedFact: fact }
}
export async function setupNormalizationRuntimeModelV1(audience: 'public' | 'party' | 'gm-only' = 'party', configure?: Parameters<typeof setupOracleRuntimeModelV1>[1]) {
  const s = await setupNormalizationRuntimeSourceV1(audience, configure), policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(s.source)
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.instance.start'), viewerKey: s.owner.viewerKey,
    triggerKind: 'continue-host', rawInput: TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1, normalizationRuntimeReferencePolicy: policy })
  const input = { ...await openEnvelopeV1(s.f.sessionId, 'normalization.instance.prepare'), ...s.owner, reviewSourceRef: s.review.sourceRef,
    referencePolicy: 'accepted-interpretation-instances-v1' as const, maximumOutputTokens: 1000, maximumCostUsd: 0.2 }
  return { ...s, policy, normalizationInput: input, output: JSON.stringify({ facts: [s.normalizedFact] }) }
}
