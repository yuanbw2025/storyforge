/** Retained recap candidate and exact delivered-source proof. No memory or world write. */
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { TtrpgOpenBriefV1, TtrpgOpenBriefAttributionV1 } from './open-brief-contract'
import { parseTtrpgOpenBriefV1, ttrpgOpenDeliveredBriefAttributionsV1 } from './open-brief-output'
import { canonicalStringify } from '../agent/run/hash'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenContextSelectionEvidenceV1 } from './open-context-selection-evidence'
import { readTtrpgOpenRuntimeCandidateV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'

export interface TtrpgOpenBriefCandidateV1 extends Omit<TtrpgOpenIntentCandidateV1, 'schema' | 'intent'> {
  schema: 'storyforge.ttrpg-open-brief-candidate'
  brief: TtrpgOpenBriefV1 | null
  attributions: TtrpgOpenBriefAttributionV1[]
}
export async function readTtrpgOpenBriefCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenBriefCandidateV1 | null> {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'stage-brief')
  return candidate?.schema === 'storyforge.ttrpg-open-brief-candidate' ? candidate : null
}
export async function verifyTtrpgOpenBriefCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string; currentSources?: boolean }) {
  const candidate = await readTtrpgOpenBriefCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.brief
    || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('[ttrpg-brief] 复盘候选需修订、已受阻或不是确认的版本')
  const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input)
  const frozen = evidence.artifacts.map(row => { try { return JSON.parse(row.content ?? 'null') as Partial<TtrpgOpenInputEvidenceV1> } catch { return null } })
    .find(value => value?.schema === 'storyforge.ttrpg-open-input-evidence' && value.manifest?.manifestHash === candidate.inputManifestHash)
  if (!frozen?.preflight) throw new Error('[ttrpg-brief] 缺少原始交付来源证明')
  const reads = frozen.preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
    const row = evidence.artifacts.find(row => row.artifactKind === ref.artifactKind && row.contentHash === ref.contentHash)
    if (!row) throw new Error('[ttrpg-brief] 缺少准确保留的完整读取工件')
    const wrapper = JSON.parse(row.content ?? 'null') as { content: string }
    return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: wrapper.content }
  })
  const attributions = await ttrpgOpenDeliveredBriefAttributionsV1(reads)
  const raw = evidence.artifacts.find(row => row.artifactKind === 'raw-response' && row.contentHash === candidate.rawResponseHash)
  if (!raw || raw.content === null || raw.content === undefined) throw new Error('[ttrpg-brief] 缺少原始回答字节')
  const brief = parseTtrpgOpenBriefV1(JSON.parse(raw.content), attributions)
  if (canonicalStringify(brief) !== canonicalStringify(candidate.brief)
    || canonicalStringify(attributions) !== canonicalStringify(candidate.attributions)) throw new Error('[ttrpg-brief] 复盘正文或原始来源标记与真实回答/交付不一致')
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (Object.values(snapshot.projection.steps).some(step => step.candidateHash === input.candidateHash && step.confirmation === 'reject')) throw new Error('[ttrpg-brief] 已拒绝的复盘不能保存为记忆')
  if (input.currentSources) {
    const call = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
    if (!call) throw new Error('[ttrpg-brief] 原始请求已缺失')
    const bodies = Object.fromEntries(evidence.artifacts.filter(row => typeof row.content === 'string').map(row => [row.contentHash, row.content!]))
    await verifyTtrpgOpenContextSelectionEvidenceV1({ ...input, actorKey: 'gm', skillId: call.skillId, stepId: call.stepId,
      evidence: frozen as TtrpgOpenInputEvidenceV1, snapshot, bodies, sourceKeys: snapshot.contract.permissions.contextSourceKeys, mode: 'dispatch', call })
  }
  return { candidate, evidence, attributions, snapshot }
}
