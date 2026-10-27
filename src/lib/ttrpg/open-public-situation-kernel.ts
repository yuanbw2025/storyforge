/** Private deterministic validation data. Never a Context Source or a model message. */
import type { WorkspaceScope } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenPublicSituationContextV1 } from './open-public-situation-context'
import { buildTtrpgOpenSituationBasisFromVerifiedReadV1 } from './open-generated-situation-basis'
import type { TtrpgOpenSituationProposalBasisV1 } from './open-generated-situation-contract'
import type { TtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenPublicSituationKernelV1 {
  schema: 'storyforge.ttrpg-open-public-situation-kernel'; version: 1;
  requestKey: string; authorizationBasisHash: string; visibilityHash: string;
  basis: TtrpgOpenSituationProposalBasisV1;
  resources: Array<{ suffix: string; title: string; mandatory: boolean; value: unknown }>;
}
export async function loadTtrpgOpenPublicSituationKernelV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }, grant: TtrpgOpenPublicSituationAuthorizationV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === loaded.runtime.openRun!.coordination.activeEpochKey)
  if (!epoch?.publicSituation || canonicalStringify(epoch.publicSituation) !== canonicalStringify(grant)) p.fail('共同局势内核缺少本次原授权')
  const context = await loadTtrpgOpenPublicSituationContextV1(input)
  if (context.readEvidence.sequence !== loaded.state.lastSequence || context.readEvidence.stateHash !== loaded.stateHash
    || context.visibilityHash !== grant.basis.sourceVisibilityHash || context.admissionStateHash !== grant.admissionStateHash) p.fail('共同局势内核与原授权来源已变化')
  const { basis } = await buildTtrpgOpenSituationBasisFromVerifiedReadV1(loaded, epoch.epochKey)
  // A3 uses only the exact common identity bodies delivered by this source, never private
  // biographies or a player's unshared action approvals from the internal full-state builder.
  basis.personalizationSources = context.personalization.map(row => row.source)
  const snapshot: TtrpgOpenPublicSituationKernelV1 = { schema: 'storyforge.ttrpg-open-public-situation-kernel', version: 1,
    requestKey: grant.basis.requestKey, authorizationBasisHash: grant.basisHash, visibilityHash: context.visibilityHash,
    basis, resources: context.resources }
  await loaded.assertCurrent()
  return snapshot
}
export async function verifyTtrpgOpenPublicSituationKernelV1(input: {
  snapshot: TtrpgOpenPublicSituationKernelV1; expectedHash: string;
  grant: TtrpgOpenPublicSituationAuthorizationV1; sessionKey: string; epochKey: string; authorizationHash: string;
}) {
  const s = p.record(input.snapshot, ['schema', 'version', 'requestKey', 'authorizationBasisHash', 'visibilityHash', 'basis', 'resources'], 'public situation kernel')
  const snapshot = input.snapshot, grant = input.grant, basis = snapshot.basis
  if (s.schema !== 'storyforge.ttrpg-open-public-situation-kernel' || s.version !== 1
    || await hashCanonicalValue(snapshot) !== input.expectedHash || snapshot.requestKey !== grant.basis.requestKey
    || snapshot.authorizationBasisHash !== grant.basisHash || snapshot.visibilityHash !== grant.basis.sourceVisibilityHash
    || basis.runtimeSourceHash !== grant.basis.runtimeSourceHash || basis.sessionKey !== input.sessionKey
    || basis.authorizationHash !== input.authorizationHash || basis.mechanicalStateHash !== grant.admissionStateHash
    || canonicalStringify([...basis.selectedActorKeys].sort()) !== canonicalStringify(grant.basis.recipientActorKeys)
    || basis.assignedTemplateKey !== `generated.${(await hashCanonicalValue({ sessionKey: input.sessionKey, proposalKey: input.epochKey })).slice(0, 40)}`) {
    p.fail('共同局势原内核快照与本次请求不一致')
  }
  return snapshot
}
