import type { MasterCandidatePayload } from '../orchestrator'
import { resolveAgentSkillV1 } from '../skill-registry'
import { isContextGatewayRequiredForWriteTargetV1 } from '../../context-gateway/skill-policy'
import { hashCanonicalValue } from './hash'

export function masterCandidateWriteTargetV1(payload: MasterCandidatePayload): string | undefined {
  if (payload.skillId === 'world-origin.worldview-field' && payload.worldviewField) {
    return `worldviews.${payload.worldviewField}`
  }
  if (payload.skillId === 'world-origin.story-core' && payload.storyCoreField) {
    return `storyCores.${payload.storyCoreField}`
  }
  if (payload.skillId === 'outline.story-arcs') return 'storyArcs.name'
  if (payload.skillId === 'character.create') return 'characters.name'
  if (payload.skillId === 'character.supplement') {
    return `characters.${payload.characterSupplementRequest?.dimensions[0] ?? 'shortDescription'}`
  }
  if (payload.skillId === 'character.lifecycle') return 'characters.narrativeStatus'
  return undefined
}

export function isMasterCandidateContextGatewayRequiredV1(
  payload: MasterCandidatePayload,
): boolean {
  return isContextGatewayRequiredForWriteTargetV1(
    resolveAgentSkillV1(payload.agentId, payload.skillId),
    masterCandidateWriteTargetV1(payload),
  )
}

/**
 * Required-Gateway candidates cannot include evidence produced after their
 * identity is frozen. ContextManifestV3 binds candidateHash first; the
 * independent semantic review and final step receipt then bind that manifest,
 * the candidate text, and their own evidence hashes. Including any of those
 * follow-on artifacts (or their cumulative budget snapshot) in candidateHash
 * would create a hash cycle or make legitimate evidence collection mutate the
 * already-bound candidate identity.
 */
export async function computeMasterCandidateHashV1(
  payload: MasterCandidatePayload,
  draft: string,
): Promise<string> {
  const { candidateHash: _candidateHash, ...withoutCandidateHash } = payload
  if (!isMasterCandidateContextGatewayRequiredV1(payload)) {
    return hashCanonicalValue({ draft, payload: withoutCandidateHash })
  }
  const {
    contextManifestHash: _contextManifestHash,
    semanticReview: _semanticReview,
    teamBudgetEvidence: _teamBudgetEvidence,
    ...gatewayPayload
  } = withoutCandidateHash
  return hashCanonicalValue({ draft, payload: gatewayPayload })
}
