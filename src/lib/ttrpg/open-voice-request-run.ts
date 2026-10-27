/** Zero-model parent records the human intent. A future audio worker needs a
 * separately governed lineage Run after a terminal intent receipt; this Run has no AI context or write permission. */
import { verifyTtrpgOpenConfirmedVoiceReadingV1 } from './open-voice-confirmed-reading-contract'
import { db } from '../db/schema'
import type { WorkspaceScope, AgentRunRecord } from '../types'
import type { TtrpgOpenVoiceRequestV1 } from './open-voice-request-contract'
import { TTRPG_OPEN_VOICE_REQUEST_STEP_V1, ttrpgOpenVoiceRequestInputV1 } from './open-voice-request-contract'
import { acceptAgentRunContract } from '../agent/run/contract'
import { canonicalStringify } from '../agent/run/hash'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type { TtrpgOpenAgentEvidenceV1 } from './open-model-call-evidence'
import * as p from './open-contract-parse'

export const ttrpgOpenVoiceIntentObjectiveV1 = (requestKey: string) => 'ttrpg.open.voice-intent:' + requestKey
export function ttrpgOpenVoiceIntentContractV1(input: { scope: WorkspaceScope; sessionId: number; row: TtrpgOpenVoiceRequestV1 }) {
  const { row } = input
  return { version: 1 as const, objective: ttrpgOpenVoiceIntentObjectiveV1(row.requestKey), workflowKind: 'direct-generation' as const,
    scope: { projectId: input.scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: input.sessionId,
      baseSequence: row.readEvidence.sequence, stateHash: row.readEvidence.stateHash, visibilityHash: row.scriptHash, releaseHash: row.script.runtimeSourceHash } },
    permissions: { contextSourceKeys: [], writeTargets: [] }, runtimeBindingHash: row.inputArtifactHash,
    budget: { maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'voice.intent-recorded', kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: 'voice.intent-terminal', kind: 'terminal' as const, verifier: 'ttrpg.open.voice-intent-v1', criterionIds: ['voice.intent-recorded'] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const } }
}
export interface TtrpgOpenVoiceRunSetWitnessV1 { sessionId: number; rows: AgentRunRecord[] }
export async function verifyTtrpgOpenVoiceIntentRunV1(input: { scope: WorkspaceScope; sessionId: number; row: TtrpgOpenVoiceRequestV1; phase?: 'reserve' | 'cancel' | 'finalize' }) {
  const rows = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).sortBy('id')
  const matches = rows.filter(r => r.contractHash === input.row.runContractHash && JSON.parse(r.contractJson).objective === ttrpgOpenVoiceIntentObjectiveV1(input.row.requestKey))
  if (matches.length !== 1 || matches[0].portableRuntimeOriginJson !== undefined) p.fail('配音请求需要唯一原本地 Run；导入记录不能获得执行权')
  const snapshot = await readInstanceAgentRunV1(input.scope, matches[0].id!), run = snapshot.run
  if (input.row.reading !== undefined) {
    const { row } = input
    await verifyTtrpgOpenConfirmedVoiceReadingV1(row.reading, row.script.text.slice(row.part.textOffset, row.part.textOffset + row.part.textLength), row.part.textHash)
  }
  const expected = await acceptAgentRunContract(ttrpgOpenVoiceIntentContractV1(input))
  const phase = input.phase ?? 'reserve', step = snapshot.projection.steps[TTRPG_OPEN_VOICE_REQUEST_STEP_V1]
  if (run.contractHash !== input.row.runContractHash || run.contractHash !== expected.contractHash
    || run.contractJson !== canonicalStringify(expected.contract) || run.productRuntimeSessionId !== input.sessionId
    || (phase === 'reserve' ? step?.status !== 'running' || snapshot.projection.state !== 'running'
      : !['running', 'succeeded'].includes(step?.status ?? '') || !['running', 'verifying', 'completed'].includes(snapshot.projection.state))
    || rows.some(r => r.parentRunId === run.id) && (phase !== 'finalize' || snapshot.projection.state !== 'completed') || snapshot.events.some(e => e.type === 'model.requested' || e.type === 'model.responded' || e.type === 'tool.called' || e.type === 'tool.returned')) p.fail('原配音意图已结束、已发送或具有子任务，不能作为未发送请求处理')
  const content = canonicalStringify(ttrpgOpenVoiceRequestInputV1(input.row))
  const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'source-snapshot', input.row.inputArtifactHash]).first()
  if (!artifact || artifact.retentionState !== 'available' || artifact.content !== content
    || await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: input.row.inputArtifactHash }) !== content
    || !snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === TTRPG_OPEN_VOICE_REQUEST_STEP_V1 && e.payload.attempt === 1
      && e.payload.artifactKind === 'source-snapshot' && e.payload.contentHash === input.row.inputArtifactHash && e.payload.byteLength === artifact.byteLength)) p.fail('配音请求缺少原完整输入工件')
  const events = await db.agentRunEvents.where('runId').equals(run.id).sortBy('sequence')
  if (events.length !== snapshot.events.length || events.some((e, i) => canonicalStringify(JSON.parse(e.payloadJson)) !== canonicalStringify(snapshot.events[i].payload))) p.fail('配音原 Run 证据在读取期间已变化')
  const evidence: TtrpgOpenAgentEvidenceV1 = { run, events, artifacts: [artifact] }
  return { snapshot, evidence, witness: { sessionId: input.sessionId, rows } }
}
