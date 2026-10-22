import type { TtrpgOpenSituationCandidateV1 } from './open-generated-situation-candidate'
import type { TtrpgOpenPublicSituationCandidateV1 } from './open-public-situation-candidate'
import type { TtrpgOpenEntityCandidateV1 } from './open-entity-candidate'
import type { TtrpgOpenKpCandidateV1 } from './open-kp-candidate'
import type { TtrpgOpenBriefCandidateV1 } from './open-brief-candidate'
/** Shared exact-byte evidence verification for closed runtime candidate purposes. */
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import type { TtrpgOpenOracleCandidateV1 } from './open-oracle-candidate'
import type { TtrpgOpenCommonOracleCandidateV1 } from './open-common-oracle-candidate'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { verifyContextGatewayCandidateEvidenceV1 } from '../context-gateway/attempt-evidence'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { ttrpgOpenModelPurposeForSkillV1, type TtrpgOpenModelPurposeV1 } from './open-model-purpose'
import { db } from '../db/schema'
export interface TtrpgOpenCandidateReadV1 {
  scope: WorkspaceScope; sessionId: number; runId: number; requestKey: string; viewerKey: string
}
export type TtrpgOpenRuntimeCandidateV1 = TtrpgOpenIntentCandidateV1 | TtrpgOpenOracleCandidateV1 | TtrpgOpenCommonOracleCandidateV1 | TtrpgOpenKpCandidateV1 | TtrpgOpenBriefCandidateV1 | TtrpgOpenSituationCandidateV1 | TtrpgOpenPublicSituationCandidateV1 | TtrpgOpenEntityCandidateV1
async function assertOracleRuntimeReader(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1) {
  if (purpose !== 'oracle-interpret' && purpose !== 'fact-normalize') return
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(row => row.requestKey === input.requestKey)
  if (call?.oracleInterpretation?.runtimeReferencePolicy || call?.supportSlot?.runtimeReferencePolicy) {
    await (await import('./open-generated-situation-candidate')).assertTtrpgOpenSituationHumanGmV1(input)
  }
}
/** Exact candidate bytes are recoverable even when the final checkpoint write was interrupted. */
export async function readTtrpgOpenRuntimeCandidateV1(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1): Promise<TtrpgOpenRuntimeCandidateV1 | null> {
  if (purpose === 'common-oracle-interpret') await (await import('./open-common-oracle-candidate')).assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  if (purpose === 'entity-proposal') await (await import('./open-entity-candidate')).assertTtrpgOpenEntityCandidateReaderV1(input)
  await assertOracleRuntimeReader(input, purpose)
  if (purpose === 'situation-proposal' || purpose === 'public-situation-proposal') await (await import('./open-generated-situation-candidate')).assertTtrpgOpenSituationHumanGmV1(input)
  return readCandidateArtifact(input, purpose, false)
}

/** Retained bytes only: unfinished evidence must never be treated as an adoptable candidate. */
export async function readTtrpgOpenUnfinishedCandidateArtifactV1(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1) {
  if (purpose === 'common-oracle-interpret') await (await import('./open-common-oracle-candidate')).assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  if (purpose === 'entity-proposal') await (await import('./open-entity-candidate')).assertTtrpgOpenEntityCandidateReaderV1(input)
  await assertOracleRuntimeReader(input, purpose)
  if (purpose === 'situation-proposal' || purpose === 'public-situation-proposal') await (await import('./open-generated-situation-candidate')).assertTtrpgOpenSituationHumanGmV1(input)
  return readCandidateArtifact(input, purpose, true)
}

/** Internal request processor only. Never export these kernel readers from runtime-api or a player projection. */
export async function readTtrpgOpenRuntimeCandidateForKernelV1(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1) { return readCandidateArtifact(input, purpose, false) }
export async function readTtrpgOpenUnfinishedCandidateForKernelV1(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1) { return readCandidateArtifact(input, purpose, true) }

async function readCandidateArtifact(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1, unfinished: boolean): Promise<TtrpgOpenRuntimeCandidateV1 | null> {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (snapshot.run.portableRuntimeOriginJson) throw new Error('[ttrpg-open-candidate] 导入前候选仅供历史复核，请由当前玩家重新提出人工行动')
  if (snapshot.run.productRuntimeSessionId !== input.sessionId) throw new Error('[ttrpg-open-intent] 候选不属于此实例')
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
  const epoch = runtime?.openRun?.coordination.epochs.find(epoch => epoch.epochKey === call?.authorizationEpochKey)
  if (!call || call.runContractHash !== snapshot.run.contractHash || (call?.narrationBinding?.viewerKey ?? epoch?.viewerKey) !== input.viewerKey) throw new Error('[ttrpg-open-intent] 无权读取其他人的候选')
  if (ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose !== purpose) throw new Error('[ttrpg-open-candidate] 候选入口与冻结 Skill 不一致')
  if (call.status !== 'succeeded') return null
  const candidates: TtrpgOpenRuntimeCandidateV1[] = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
    const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })) as TtrpgOpenRuntimeCandidateV1
    if (body.schema !== (purpose === 'common-oracle-interpret' ? 'storyforge.ttrpg-open-common-oracle-candidate' : purpose === 'entity-proposal' ? 'storyforge.ttrpg-open-entity-candidate' : purpose === 'public-situation-proposal' ? 'storyforge.ttrpg-open-public-situation-candidate' : purpose === 'intent' || purpose === 'companion' ? 'storyforge.ttrpg-open-intent-candidate' : purpose === 'situation-proposal' ? 'storyforge.ttrpg-open-situation-candidate' : purpose === 'stage-brief' ? 'storyforge.ttrpg-open-brief-candidate' : purpose === 'kp-narration' ? 'storyforge.ttrpg-open-kp-candidate' : 'storyforge.ttrpg-open-oracle-candidate')) continue
    const { candidateHash, ...payload } = body
    if (body.version !== 1 || body.portable !== false || body.runId !== input.runId || body.productRuntimeSessionId !== input.sessionId
      || body.requestKey !== input.requestKey || body.viewerKey !== input.viewerKey || body.actorKey !== call.actorKey
      || body.epochKey !== call.authorizationEpochKey || body.inputManifestHash !== call.inputManifestHash
      || body.rawResponseHash !== call.responseArtifactHash || body.admissionStateHash !== call.admissionStateHash
      || body.visibilityHash !== call.visibilityHash || body.runtimeSourceHash !== call.runtimeSourceHash
      || await hashCanonicalValue(payload) !== candidateHash) {
      throw new Error('[ttrpg-open-intent] 候选绑定或原始字节已变化')
    }
    if (body.schema === 'storyforge.ttrpg-open-common-oracle-candidate' && (body.basisHash !== call.commonOracle?.basisHash || body.normalizationOf !== undefined)) throw new Error('共同事实候选不能替换原 basis 或冒充事实归一')
    if (!unfinished && !snapshot.events.some(event => event.type === 'candidate.persisted' && event.payload.stepId === call.stepId
      && event.payload.attempt === call.attempt && event.payload.candidateHash === candidateHash)) continue
    if (!unfinished) await verifyContextGatewayCandidateEvidenceV1({ scope: input.scope, runId: input.runId, stepId: call.stepId,
      attempt: call.attempt, candidateHash })
    candidates.push(body)
  }
  if (candidates.length > 1) throw new Error('[ttrpg-open-intent] 同一请求产生了多个候选')
  return candidates[0] ?? null
}

/** Verify retained source, raw response and V3 candidate proof for the same transaction CAS. */
export async function verifyTtrpgOpenRuntimeCandidateEvidenceV1(input: TtrpgOpenCandidateReadV1) {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
  if (!call) throw new Error('[ttrpg-open-intent] 请求账本不存在')
  const evidence = await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'finish' })
  for (const event of evidence.events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    const payload = JSON.parse(event.payloadJson) as { stepId: string; attempt: number; artifactKind: string; contentHash: string; byteLength: number }
    if (payload.stepId !== call.stepId || payload.attempt !== call.attempt) continue
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([input.scope.projectId, payload.artifactKind, payload.contentHash]).first()
    if (!row || row.retentionState !== 'available') throw new Error('[ttrpg-open-intent] 候选提交缺少原始工件')
    const body = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: row.artifactKind,
      contentHash: payload.contentHash })
    if (row.content !== body || row.byteLength !== payload.byteLength) throw new Error('[ttrpg-open-intent] 候选提交字节证据已变化')
    if (!evidence.artifacts.some(previous => previous.id === row.id)) evidence.artifacts.push(row)
  }
  return evidence
}
