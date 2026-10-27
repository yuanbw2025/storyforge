/** Closed request evidence, not a live permission. A domain event must verify the real seat,
 * original window and source before freezing it; parsing or hashing this object grants nothing. */
import * as p from './open-contract-parse'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { parseTtrpgOpenSituationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'

export const TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1 = Object.freeze({
  purpose: 'public-situation-generation' as const,
  sharingDecision: 'share-this-request-with-current-party' as const,
  delegationDecisions: Object.freeze(['draft-only', 'adopt-this-one-candidate'] as const),
  maximumCandidates: 1 as const, maximumCalls: 1 as const, maximumAiActions: 0 as const,
  parsingThisEvidenceGrantsNoLiveAuthority: true,
})

export function parseTtrpgOpenPublicSituationRequestBasisV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'purpose', 'scope', 'sessionKey', 'runtimeSourceHash', 'authorizationRevision',
    'requester', 'authorizationEpochKey', 'requestKey', 'readEvidence', 'recipientActorKeys', 'sourceVisibilityHash', 'sharedRequest', 'delegation',
    ...(value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'runtimeEntityReferencePolicy') ? ['runtimeEntityReferencePolicy'] : [])], 'public situation request basis')
  const scope = p.record(r.scope, ['projectId', 'worldId', 'workId', 'sessionId'], 'public request scope')
  const requester = p.record(r.requester, ['viewerKey', 'seatKey', 'seatRevision'], 'public requester')
  const read = p.record(r.readEvidence, ['sequence', 'stateHash'], 'public request read')
  const shared = p.record(r.sharedRequest, ['text', 'inputHash', 'decision'], 'shared request')
  const delegation = p.record(r.delegation, ['decision', 'maximumCandidates', 'maximumCalls', 'maximumAiActions'], 'public delegation')
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'public recipients', 1000, 1)
  if (recipientActorKeys.join('\n') !== [...recipientActorKeys].sort().join('\n')) p.fail('public recipients: 必须按实际角色排序')
  // Preserve the actual wire input, including whitespace; normalization must not bless different bytes.
  if (typeof shared.text !== 'string' || !shared.text.trim() || shared.text.length > 20_000) p.fail('shared request: 输入为空或过长')
  const runtimeEntityReferencePolicy = Object.prototype.hasOwnProperty.call(r, 'runtimeEntityReferencePolicy') ? parseTtrpgOpenSituationRuntimeReferencePolicyV1(r.runtimeEntityReferencePolicy) : undefined
  if (runtimeEntityReferencePolicy && (runtimeEntityReferencePolicy.consumer !== 'common-party' || runtimeEntityReferencePolicy.references.runtimeSourceHash !== r.runtimeSourceHash)) p.fail('共同局势实例策略不属于本次共同用途或冻结来源')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-public-situation-request-basis', 'public request schema'),
    version: p.literal(r.version, 1, 'public request version'),
    purpose: p.literal(r.purpose, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.purpose, 'public request purpose'),
    scope: { projectId: p.integer(scope.projectId, 'project', 1), worldId: p.integer(scope.worldId, 'world', 1),
      workId: p.integer(scope.workId, 'work', 1), sessionId: p.integer(scope.sessionId, 'session', 1) },
    sessionKey: p.key(r.sessionKey, 'public request session'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'public request source'),
    authorizationRevision: p.integer(r.authorizationRevision, 'public authorization revision', 1),
    requester: { viewerKey: p.key(requester.viewerKey, 'public requester viewer'), seatKey: p.key(requester.seatKey, 'public requester seat'),
      seatRevision: p.integer(requester.seatRevision, 'public requester revision', 1) },
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'public request epoch'), requestKey: p.key(r.requestKey, 'public request key'),
    readEvidence: { sequence: p.integer(read.sequence, 'public read sequence'), stateHash: p.hash(read.stateHash, 'public read state') },
    recipientActorKeys, sourceVisibilityHash: p.hash(r.sourceVisibilityHash, 'public source visibility'),
    sharedRequest: { text: shared.text, inputHash: p.hash(shared.inputHash, 'shared input hash'),
      decision: p.literal(shared.decision, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.sharingDecision, 'shared input decision') },
    delegation: { decision: p.oneOf(delegation.decision, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.delegationDecisions, 'public delegation decision'),
      maximumCandidates: p.literal(delegation.maximumCandidates, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.maximumCandidates, 'public candidate limit'),
      maximumCalls: p.literal(delegation.maximumCalls, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.maximumCalls, 'public call limit'),
      maximumAiActions: p.literal(delegation.maximumAiActions, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1.maximumAiActions, 'public action limit') },
    ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}) }
}
export type TtrpgOpenPublicSituationRequestBasisV1 = ReturnType<typeof parseTtrpgOpenPublicSituationRequestBasisV1>
export async function hashTtrpgOpenPublicSituationRequestBasisV1(value: unknown): Promise<string> {
  const basis = parseTtrpgOpenPublicSituationRequestBasisV1(value)
  if (basis.sharedRequest.inputHash !== await sha256Text(basis.sharedRequest.text)) p.fail('shared request: 输入哈希不一致')
  return hashCanonicalValue(basis)
}
