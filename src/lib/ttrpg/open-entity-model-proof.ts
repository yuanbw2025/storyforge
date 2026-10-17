/** Original model provenance may be replayed or inherited, never renewed as a live permission. */
import type { TtrpgOpenEntityPlanV2 } from './open-entity-contract'
import { parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { parseAgentRunContract } from '../agent/run/contract'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { parseTtrpgOpenEntityArtifactRefsV1 } from './open-entity-model-origin-contract'
import * as p from './open-contract-parse'

export async function verifyTtrpgOpenEntityModelOriginV1(plan: TtrpgOpenEntityPlanV2) {
  const proof = plan.modelOrigin, call = proof.call, origin = await parseTtrpgOpenRunOriginV1(proof.runOriginJson)
  const contract = parseAgentRunContract(JSON.parse(origin.contractJson)), binding = contract.executionBindings?.[0]
  const refs = parseTtrpgOpenEntityArtifactRefsV1(origin.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    ? [{ artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }] : []))
  const bindingHash = await (await import('./open-model-call-evidence')).ttrpgOpenCallBindingHashV1({
    sessionKey: call.createdRef.sessionKey, actorKey: call.actorKey, authorizationEpochKey: call.authorizationEpochKey,
    admissionStateHash: call.admissionStateHash, visibilityHash: call.visibilityHash, runtimeSourceHash: call.runtimeSourceHash,
    entityProposal: call.entityProposal })
  if (origin.version !== 1 || origin.sessionKey !== plan.proposedRef.sessionKey || origin.contractHash !== call.runContractHash
    || binding?.skillId !== 'prose.ttrpg-open-entity-propose' || binding.stepId !== call.stepId
    || contract.runtimeBindingHash !== bindingHash || contract.scope.runtime?.releaseHash !== plan.runtimeSourceHash
    || contract.scope.runtime?.visibilityHash !== call.visibilityHash || stable(refs) !== stable(proof.artifactRefs)
    || call.entityProposal!.scope.scopeKey !== 'entity-scope.' + (await hash({ audience: call.entityProposal!.scope.audience,
      recipientActorKeys: call.entityProposal!.scope.recipientActorKeys })).slice(0, 40)
    || !origin.events.some(e => e.type === 'model.requested' && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt && e.payload.bindingHash === call.requestHash)
    || !origin.events.some(e => e.type === 'model.responded' && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt && e.payload.outputHash === call.responseArtifactHash)
    || !origin.events.some(e => e.type === 'candidate.persisted' && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt && e.payload.candidateHash === proof.candidateHash)) p.fail('模型实体计划缺少准确的原 Skill、Run、候选、回答或交付范围证据')
}
