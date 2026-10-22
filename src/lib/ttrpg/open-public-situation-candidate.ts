/** Public-input drafting still produces unrevealed GM-owned candidate material. */
import type { TtrpgOpenSituationCandidateV1 } from './open-generated-situation-candidate'
import { assertTtrpgOpenSituationHumanGmV1, assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { readTtrpgOpenRuntimeCandidateV1, readTtrpgOpenRuntimeCandidateForKernelV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1 } from './open-runtime-candidate'
import type { TtrpgOpenPublicSituationReferenceV1 } from './open-public-situation-delivery'
import { verifyTtrpgOpenPublicSituationKernelV1, type TtrpgOpenPublicSituationKernelV1 } from './open-public-situation-kernel'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { TtrpgOpenEpochV1 } from './open-coordination'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { canonicalStringify } from '../agent/run/hash'
import { reviewTtrpgOpenDeliveredPublicSituationV1 } from './open-public-situation-delivery'

export interface TtrpgOpenPublicSituationCandidateV1 extends Omit<TtrpgOpenSituationCandidateV1, 'schema' | 'references'> {
  schema: 'storyforge.ttrpg-open-public-situation-candidate';
  references: TtrpgOpenPublicSituationReferenceV1[];
}
export async function readTtrpgOpenPublicSituationCandidateV1(input: TtrpgOpenCandidateReadV1) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const value = await readTtrpgOpenRuntimeCandidateV1(input, 'public-situation-proposal')
  return value?.schema === 'storyforge.ttrpg-open-public-situation-candidate' ? value : null
}
export function projectTtrpgOpenPublicSituationCandidateSummaryV1(candidate: TtrpgOpenPublicSituationCandidateV1, stopped = false, adopted = false) {
  return { schema: 'storyforge.ttrpg-open-public-situation-candidate-summary' as const, version: 1 as const,
    runId: candidate.runId, requestKey: candidate.requestKey, candidateHash: candidate.candidateHash,
    status: candidate.artifact.status, stopped, adopted, requiresExplicitAcceptance: !stopped && !adopted, grantsGmRead: false as const }
}
export async function readTtrpgOpenPublicSituationCandidateSummaryV1(input: TtrpgOpenCandidateReadV1) {
  try {
    const loaded = await assertTtrpgOpenSituationRequesterV1(input)
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(input, 'public-situation-proposal')
    if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate') return null
    const original = await readInstanceAgentRunV1(input.scope, input.runId)
    const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === candidate.epochKey)
    const adopted = loaded.runtime.openRun!.situationReceipts?.some(row => row.model.requestKey === input.requestKey && row.model.candidateHash === candidate.candidateHash) ?? false
    await loaded.assertCurrent()
    return projectTtrpgOpenPublicSituationCandidateSummaryV1(candidate, epoch?.status === 'closed' || ['failed', 'cancelled'].includes(original.projection.state), adopted)
  } catch { throw new Error('当前无法读取本人的共同局势候选状态；原始候选资料保持受限。') }
}
/** Internal exact bytes only. Caller has verified the original call and input evidence. */
export async function readTtrpgOpenPublicSituationKernelSnapshotV1(input: TtrpgOpenCandidateReadV1,
  call: TtrpgOpenModelCallV1, epoch: TtrpgOpenEpochV1, evidence: TtrpgOpenInputEvidenceV1) {
  const hash = evidence.publicKernelHash
  const run = await readInstanceAgentRunV1(input.scope, input.runId)
  if (!hash || !epoch.publicSituation || !run.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt
    && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === hash)) throw new Error('共同局势原请求缺少绑定内核工件')
  const snapshot = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
    artifactKind: 'source-snapshot', contentHash: hash })) as TtrpgOpenPublicSituationKernelV1
  return verifyTtrpgOpenPublicSituationKernelV1({ snapshot, expectedHash: hash, grant: epoch.publicSituation,
    sessionKey: call.createdRef.sessionKey, epochKey: epoch.epochKey, authorizationHash: epoch.authorizationHash })
}

/** Kernel-only proof. Host status authority does not expose the unrevealed candidate or private snapshot. */
export async function verifyTtrpgOpenPublicSituationCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const loaded = await assertTtrpgOpenSituationRequesterV1(input)
  const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(input, 'public-situation-proposal')
  if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate' || candidate.candidateHash !== input.candidateHash
    || !candidate.review?.evaluation.accepted || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('共同局势候选不属于原请求或未通过完整检查')
  const run = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['failed', 'cancelled'].includes(run.projection.state)
    || run.projection.steps['ttrpg.open.public-situation-propose']?.confirmation === 'reject') throw new Error('共同局势原候选已经结束或拒绝')
  const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input)
  const call = loaded.runtime.openRun!.coordination.calls.find(row => row.requestKey === input.requestKey)!
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)!
  const frozen = evidence.artifacts.map(row => {
    try { return JSON.parse(row.content ?? 'null') as TtrpgOpenInputEvidenceV1 } catch { return null }
  }).find(row => row?.schema === 'storyforge.ttrpg-open-input-evidence' && row.manifest.manifestHash === call.inputManifestHash)
  if (!frozen) throw new Error('共同局势原请求缺少完整输入证明')
  const kernel = await readTtrpgOpenPublicSituationKernelSnapshotV1(input, call, epoch, frozen)
  const reads = frozen.preflight.artifacts.filter(row => row.role === 'source-snapshot').map(ref => {
    const row = evidence.artifacts.find(row => row.artifactKind === ref.artifactKind && row.contentHash === ref.contentHash)
    if (!row?.content) throw new Error('共同局势缺少原完整读取正文')
    return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: JSON.parse(row.content).content }
  })
  const raw = evidence.artifacts.find(row => row.artifactKind === 'raw-response' && row.contentHash === candidate.rawResponseHash)
  if (typeof raw?.content !== 'string') throw new Error('共同局势缺少原始回答')
  const actual = await reviewTtrpgOpenDeliveredPublicSituationV1({ value: JSON.parse(raw.content), snapshot: kernel, reads })
  if (canonicalStringify(actual.review) !== canonicalStringify(candidate.review)
    || canonicalStringify(actual.references) !== canonicalStringify(candidate.references)) throw new Error('共同局势候选与原始回答或实际完整投影不一致')
  await loaded.assertCurrent()
  return { loaded, candidate, run, evidence, kernel, call, epoch, raw: raw.content }
}
