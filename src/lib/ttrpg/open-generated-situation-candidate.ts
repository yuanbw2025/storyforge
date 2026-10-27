/** Private candidate proof and deliberately opaque human-fallback progress. No adoption authority. */
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import { type TtrpgOpenCandidateReadV1, readTtrpgOpenRuntimeCandidateV1, readTtrpgOpenRuntimeCandidateForKernelV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1 } from './open-runtime-candidate'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalStringify } from '../agent/run/hash'
import { reviewTtrpgOpenDeliveredSituationV1, verifyTtrpgOpenSituationKernelSnapshotV1, type TtrpgOpenSituationKernelSnapshotV1, type TtrpgOpenSituationReferenceProofV1 } from './open-generated-situation-delivery'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import type { TtrpgOpenEpochV1 } from './open-coordination'

type Review = Awaited<ReturnType<typeof reviewTtrpgOpenDeliveredSituationV1>>['review']
export interface TtrpgOpenSituationCandidateV1 extends Omit<TtrpgOpenIntentCandidateV1, 'schema' | 'intent'> {
  schema: 'storyforge.ttrpg-open-situation-candidate';
  review: Review | null; references: TtrpgOpenSituationReferenceProofV1[];
}
export async function assertTtrpgOpenSituationHumanGmV1(input: Pick<TtrpgOpenCandidateReadV1, 'scope' | 'sessionId' | 'viewerKey'>) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost || loaded.seat?.role !== 'gm' || loaded.seat.controller === 'ai') throw new Error('局势候选原文仅允许当前真人 GM 读取；兼任主持只能查看请求状态。')
  await loaded.assertCurrent()
}
export async function readTtrpgOpenSituationCandidateV1(input: TtrpgOpenCandidateReadV1) {
  const value = await readTtrpgOpenRuntimeCandidateV1(input, 'situation-proposal')
  return value?.schema === 'storyforge.ttrpg-open-situation-candidate' ? value : null
}
/** Fixed schema: no private title, source keys, raw text, issues, messages or prepared input. */
export function projectTtrpgOpenSituationCandidateSummaryV1(candidate: TtrpgOpenSituationCandidateV1, stopped = false, adopted = false) {
  return { schema: 'storyforge.ttrpg-open-situation-candidate-summary' as const, version: 1 as const,
    runId: candidate.runId, requestKey: candidate.requestKey, candidateHash: candidate.candidateHash,
    status: candidate.artifact.status, stopped, ...(adopted ? { adopted: true as const } : {}), requiresExplicitAcceptance: !stopped && !adopted, grantsGmRead: false as const }
}
/** Current host status authority is separate from private GM-content read authority. */
export async function assertTtrpgOpenSituationRequesterV1(input: Pick<TtrpgOpenCandidateReadV1, 'scope' | 'sessionId' | 'viewerKey'>) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  assertTtrpgOpenHumanHostV1(loaded.authorization, input.viewerKey)
  return loaded
}
export async function readTtrpgOpenSituationCandidateSummaryV1(input: TtrpgOpenCandidateReadV1) {
  try {
    const loaded = await assertTtrpgOpenSituationRequesterV1(input)
    const value = await readTtrpgOpenRuntimeCandidateForKernelV1(input, 'situation-proposal')
    const run = await readInstanceAgentRunV1(input.scope, input.runId)
    const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === value?.epochKey)
    const stopped = epoch?.status === 'closed' || ['cancelled', 'failed'].includes(run.projection.state)
    const adopted = loaded.runtime.openRun!.situationReceipts?.some(r => r.model.requestKey === input.requestKey && r.model.candidateHash === value?.candidateHash) ?? false
    await loaded.assertCurrent()
    return value?.schema === 'storyforge.ttrpg-open-situation-candidate' ? projectTtrpgOpenSituationCandidateSummaryV1(value, stopped, adopted) : null
  } catch { throw new Error('当前无法读取本人的局势候选状态；原始私域资料保持受限。') }
}
/** Internal only: bound immutable validation data is NOT model-delivered evidence. */
export async function readTtrpgOpenSituationKernelSnapshotV1(input: TtrpgOpenCandidateReadV1, call: TtrpgOpenModelCallV1, epoch: TtrpgOpenEpochV1) {
  const run = await readInstanceAgentRunV1(input.scope, input.runId), found = new Map<string, TtrpgOpenSituationKernelSnapshotV1>()
  for (const event of run.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
    const value = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }))
    if (value.schema === 'storyforge.ttrpg-open-situation-kernel-snapshot') found.set(event.payload.contentHash, value)
  }
  if (found.size !== 1) throw new Error('局势原请求缺少唯一内部验证快照')
  return verifyTtrpgOpenSituationKernelSnapshotV1({ snapshot: [...found.values()][0], admissionStateHash: call.admissionStateHash,
    visibilityHash: call.visibilityHash, runtimeSourceHash: call.runtimeSourceHash, sessionKey: call.createdRef.sessionKey,
    epochKey: epoch.epochKey, authorizationHash: epoch.authorizationHash })
}
export async function verifyTtrpgOpenSituationCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const candidate = await readTtrpgOpenSituationCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.review
    || !candidate.review.evaluation.accepted || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('局势候选缺少准确原文、未通过检查或不是当前版本')
  const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input), run = await readInstanceAgentRunV1(input.scope, input.runId)
  if (['cancelled', 'failed'].includes(run.projection.state)) throw new Error('局势原请求已经结束，不能作为待采用候选。')
  if (Object.values(run.projection.steps).some(s => s.candidateHash === input.candidateHash && s.confirmation === 'reject')) throw new Error('局势候选已明确拒绝')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)!
  const kernel = await readTtrpgOpenSituationKernelSnapshotV1(input, call, epoch)
  const frozen = evidence.artifacts.map(r => { try { return JSON.parse(r.content ?? 'null') as TtrpgOpenInputEvidenceV1 } catch { return null } })
    .find(v => v?.schema === 'storyforge.ttrpg-open-input-evidence' && v.manifest.manifestHash === call.inputManifestHash)
  if (!frozen) throw new Error('局势候选缺少原始输入证明')
  const reads = frozen.preflight.artifacts.filter(r => r.role === 'source-snapshot').map(ref => {
    const row = evidence.artifacts.find(r => r.artifactKind === ref.artifactKind && r.contentHash === ref.contentHash)
    if (!row?.content) throw new Error('局势候选缺少原完整读取')
    return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: JSON.parse(row.content).content }
  })
  const raw = evidence.artifacts.find(r => r.artifactKind === 'raw-response' && r.contentHash === call.responseArtifactHash)
  if (typeof raw?.content !== 'string') throw new Error('局势候选缺少原始回复')
  const actual = await reviewTtrpgOpenDeliveredSituationV1({ value: JSON.parse(raw.content), snapshot: kernel, reads })
  if (canonicalStringify(actual.review) !== canonicalStringify(candidate.review)
    || canonicalStringify(actual.references) !== canonicalStringify(candidate.references)) throw new Error('局势候选与原始回复或完整交付来源不一致')
  await loaded.assertCurrent()
  return { candidate, evidence, run, kernel }
}
