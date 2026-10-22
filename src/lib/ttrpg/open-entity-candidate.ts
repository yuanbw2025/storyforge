/** Model-origin evidence stays separate from the human-oracle-proposal V1 contract. */
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import type { TtrpgOpenEntityProposalV1 } from './open-entity-contract'
import type { TtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readTtrpgOpenRuntimeCandidateV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { canonicalStringify as stable } from '../agent/run/hash'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import { reviewTtrpgOpenEntityModelDeliveryV1 } from './open-entity-model-contract'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'

export interface TtrpgOpenEntityCandidateV1 extends Omit<TtrpgOpenIntentCandidateV1, 'schema' | 'intent'> {
  schema: 'storyforge.ttrpg-open-entity-candidate';
  selection: TtrpgOpenEntityModelSelectionV1; proposals: TtrpgOpenEntityProposalV1[] | null;
}
export async function assertTtrpgOpenEntityCandidateReaderV1(input: TtrpgOpenCandidateReadV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)
  assertTtrpgOpenEntityHumanReaderV1(loaded, call, input.viewerKey)
  await loaded.assertCurrent()
}
/** Shared current human permission, before a desk resolves or reads original private Run evidence. */
export function assertTtrpgOpenEntityHumanReaderV1(loaded: Awaited<ReturnType<typeof loadTtrpgOpenMemoryReadStateV1>>,
  call: TtrpgOpenModelCallV1 | undefined, viewerKey: string) {
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)
  if (!loaded.humanHost || !call?.entityProposal || epoch?.viewerKey !== viewerKey
    || call.entityProposal.scope.audience === 'gm-only' && loaded.seat?.role !== 'gm'
    || call.entityProposal.scope.audience === 'private' && loaded.seat?.role !== 'gm'
      && !call.entityProposal.scope.recipientActorKeys.includes(loaded.seat?.actorKey ?? '')) throw new Error('当前无法读取本人的实体候选；原资料保持受限。')
}
export async function readTtrpgOpenEntityCandidateV1(input: TtrpgOpenCandidateReadV1) {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'entity-proposal')
  return candidate?.schema === 'storyforge.ttrpg-open-entity-candidate' ? candidate : null
}
/** Retained exact-byte proof only. Live scope/authorization/epoch preflight remains a separate adoption requirement. */
export async function verifyTtrpgOpenEntityCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const candidate = await readTtrpgOpenEntityCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.proposals?.length
    || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('实体候选缺少原精确正文、没有实体或未通过检查。')
  const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input), snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['cancelled', 'failed'].includes(snapshot.projection.state)
    || Object.values(snapshot.projection.steps).some(step => step.candidateHash === input.candidateHash && step.confirmation === 'reject')) throw new Error('原实体候选已经结束或拒绝。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)!
  const frozen = evidence.artifacts.map(row => { try { return JSON.parse(row.content ?? 'null') as TtrpgOpenInputEvidenceV1 } catch { return null } })
    .find(value => value?.schema === 'storyforge.ttrpg-open-input-evidence' && value.manifest.manifestHash === call.inputManifestHash)
  if (!frozen) throw new Error('实体候选缺少实际完整交付证明。')
  const reads = frozen.preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
    const row = evidence.artifacts.find(r => r.artifactKind === ref.artifactKind && r.contentHash === ref.contentHash)
    if (typeof row?.content !== 'string') throw new Error('实体候选缺少原资料字节。')
    return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: JSON.parse(row.content).content }
  })
  const raw = evidence.artifacts.find(r => r.artifactKind === 'raw-response' && r.contentHash === call.responseArtifactHash)
  if (typeof raw?.content !== 'string') throw new Error('实体候选缺少原始回答。')
  const review = reviewTtrpgOpenEntityModelDeliveryV1(call.entityProposal, reads, JSON.parse(raw.content))
  if (stable(review.selection) !== stable(candidate.selection) || stable(review.proposals) !== stable(candidate.proposals)) throw new Error('实体候选不是原回答及本次完整交付的精确结果。')
  await loaded.assertCurrent()
  return { candidate, evidence, snapshot, loaded, call, epoch }
}
