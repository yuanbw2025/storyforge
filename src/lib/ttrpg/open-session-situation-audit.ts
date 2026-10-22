/** Historical private read only. Parent deletion/import never restores the old Run's live authority. */
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenSituationCandidateV1 } from './open-generated-situation-candidate'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { TtrpgOpenSituationKernelSnapshotV1 } from './open-generated-situation-delivery'
import { assertTtrpgOpenSituationHumanGmV1 } from './open-generated-situation-candidate'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { verifyContextManifestIntegrityV2 } from '../agent/run/context-manifest'
import { reviewTtrpgOpenDeliveredSituationV1, verifyTtrpgOpenSituationKernelSnapshotV1 } from './open-generated-situation-delivery'

export async function readTtrpgOpenSessionSituationAuditV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; templateKey: string }) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const receipt = loaded.runtime.openRun!.situationReceipts?.find(r => r.template.templateKey === input.templateKey)
  if (!receipt) throw new Error('本团局没有该已采用局势')
  if (receipt.version !== 1) throw new Error('AI 主持本次采用使用专用共同局势审计，不转换为真人私域审阅')
  const origin = await parseTtrpgOpenRunOriginV1(receipt.runOriginJson)
  const refs = origin.events.flatMap(e => e.type === 'evidence.artifact.recorded' ? [e.payload] : [])
  const bodies = new Map<string, string>()
  for (const ref of refs) {
    const key = ref.artifactKind + ':' + ref.contentHash
    const content = bodies.get(key) ?? await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: ref.artifactKind, contentHash: ref.contentHash })
    if (new TextEncoder().encode(content).byteLength !== ref.byteLength) throw new Error('局势历史审计缺少原始完整工件')
    bodies.set(key, content)
  }
  const snapshots = [...bodies.entries()].filter(([key]) => key.startsWith('source-snapshot:')).map(([, body]) => {
    try { return JSON.parse(body) } catch { return null }
  })
  const candidates = snapshots.filter((s): s is TtrpgOpenSituationCandidateV1 => s?.schema === 'storyforge.ttrpg-open-situation-candidate')
  const kernels = snapshots.filter((s): s is TtrpgOpenSituationKernelSnapshotV1 => s?.schema === 'storyforge.ttrpg-open-situation-kernel-snapshot')
  const inputs = snapshots.filter((s): s is TtrpgOpenInputEvidenceV1 => s?.schema === 'storyforge.ttrpg-open-input-evidence' && s.manifest.manifestHash === receipt.model.inputManifestHash)
  if (candidates.length !== 1 || kernels.length !== 1 || inputs.length !== 1) throw new Error('局势历史缺少唯一原始候选、资料或验证快照')
  const candidate = candidates[0], evidence = inputs[0], { candidateHash, ...body } = candidate
  if (candidateHash !== receipt.model.candidateHash || await hash(body) !== candidateHash || candidate.runId !== origin.sourceRunId
    || candidate.productRuntimeSessionId !== origin.sourceSessionId || candidate.requestKey !== receipt.model.requestKey
    || candidate.rawResponseHash !== receipt.model.rawResponseHash || candidate.inputManifestHash !== receipt.model.inputManifestHash
    || candidate.runtimeSourceHash !== receipt.runtimeSourceHash || candidate.admissionStateHash !== receipt.model.basisHash
    || candidate.visibilityHash !== receipt.model.contextHash || evidence.manifest.runId !== origin.sourceRunId
    || evidence.manifest.scope.projectId !== origin.sourceProjectId || evidence.manifest.scope.workspaceUid !== origin.workspaceUid
    || evidence.manifest.scope.worldCode !== origin.worldCode || evidence.manifest.scope.workCode !== origin.workCode
    || !await verifyContextManifestIntegrityV2(evidence.manifest)) throw new Error('局势历史候选、资料与原 Run 不一致')
  const kernel = await verifyTtrpgOpenSituationKernelSnapshotV1({ snapshot: kernels[0], admissionStateHash: receipt.model.basisHash,
    visibilityHash: receipt.model.contextHash, runtimeSourceHash: receipt.runtimeSourceHash, sessionKey: origin.sessionKey,
    epochKey: receipt.model.epochKey, authorizationHash: receipt.disclosure.authorizationHash })
  const reads = evidence.preflight.artifacts.filter(r => r.role === 'source-snapshot').map(r => {
    const source = bodies.get(r.artifactKind + ':' + r.contentHash)
    if (!source) throw new Error('局势历史缺少原始完整交付正文')
    return { sourceKey: r.sourceKey, resourceKey: r.resourceKey, content: JSON.parse(source).content }
  })
  const rawResponse = bodies.get('raw-response:' + receipt.model.rawResponseHash)
  if (rawResponse === undefined) throw new Error('局势历史缺少原始回答')
  const actual = await reviewTtrpgOpenDeliveredSituationV1({ value: JSON.parse(rawResponse), snapshot: kernel, reads })
  if (stable(actual.review) !== stable(candidate.review) || stable(actual.references) !== stable(candidate.references)
    || actual.review.proposalHash !== receipt.model.proposalHash || await hash(actual.references) !== receipt.model.referencesHash
    || stable(actual.review.proposal.template) !== stable(receipt.template)) throw new Error('局势审计原始回答、交付来源或采用正文不一致')
  await loaded.assertCurrent()
  return { historical: true as const, grantsSend: false as const, grantsAcceptance: false as const, receipt, originalRun: origin, candidate, rawResponse }
}
