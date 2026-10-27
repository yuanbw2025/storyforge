/** Retained history proves already accepted origin. Only native, physically
 * rechecked original evidence can prepare a first generated E16 command. */
import { db } from '../db/schema'
import type { AgentRunCheckpointRecord } from '../types'
import type { TtrpgOpenAgentEvidenceV1 } from './open-model-call-evidence'
import type { TtrpgOpenVoiceRunSetWitnessV1 } from './open-voice-request-run'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { ttrpgOpenAudioSourceEqualV1 } from './open-audio-contract'
import { ttrpgOpenGeneratedAudioChoiceKeyV1, type TtrpgOpenAudioReceiptV2 } from './open-generated-audio-contract'
import * as p from './open-contract-parse'

export async function ttrpgOpenGeneratedAudioAssetKeyV1(origin: TtrpgOpenAudioReceiptV2['generated']) {
  return ttrpgOpenScopedKeyV1(origin.originSessionKey, 'generated-voice-asset', [origin.originScope.issuerViewerKey, origin.completion.candidateHash, origin.choiceKey])
}
export async function verifyTtrpgOpenGeneratedAudioOriginV1(input: {projectId: number; receipt: TtrpgOpenAudioReceiptV2}) {
  const receipt = structuredClone(input.receipt), g = receipt.generated
  const saved = await (await import('./open-voice-completion-evidence')).readTtrpgOpenVoiceCompletionForKernelV1({projectId: input.projectId,
    requestKey: g.requestKey, sessionKey: g.originSessionKey, runtimeSourceHash: receipt.runtimeSourceHash, completion: g.completion})
  const {choiceKey, ...choiceBody} = g
  if (stable(g.artifactRefs) !== stable(saved.artifactRefs) || stable(g.timeline) !== stable(saved.timeline)
    || stable(g.originScope) !== stable(saved.request.script.scope) || receipt.envelope.event.fallbackText !== saved.request.script.text
    || !ttrpgOpenAudioSourceEqualV1(receipt.request.narrationSourceRef, saved.request.script.narrationSourceRef)
    || receipt.asset.contentHash !== saved.audio.contentHash || receipt.asset.byteSize !== saved.audio.byteLength
    || receipt.asset.mimeType !== saved.audio.mimeType || receipt.asset.durationMs !== saved.audio.durationMs
    || receipt.asset.assetKey !== await ttrpgOpenGeneratedAudioAssetKeyV1(g)
    || choiceKey !== await ttrpgOpenGeneratedAudioChoiceKeyV1(choiceBody, receipt.asset)) p.fail('生成音轨与原完整完成来源、物理音频或明确元数据选择不一致')
  return saved
}

export interface TtrpgOpenGeneratedAudioWitnessV1 {
  runs: TtrpgOpenAgentEvidenceV1[]
  checkpoints: {runId: number; rows: AgentRunCheckpointRecord[]}[]
}
/** Called within the existing formal transaction after its shared Run/evidence
 * checker. No hashing or module load is introduced inside that transaction. */
export async function assertTtrpgOpenGeneratedAudioCheckpointsV1(witness: TtrpgOpenGeneratedAudioWitnessV1) {
  for (const cp of witness.checkpoints) if (stable(await db.agentRunCheckpoints.where('runId').equals(cp.runId).sortBy('id')) !== stable(cp.rows)) p.fail('原配音检查点在正式提交期间发生变化')
}
export async function readTtrpgOpenGeneratedAudioNativeProofV1(input: TtrpgOpenVoiceJobLocatorV1 & {candidateHash: string}) {
  const request = structuredClone(input)
  const [{captureTtrpgOpenVoiceCompletionV1},{loadTtrpgOpenVoiceJobReadStateForKernelV1},{readTtrpgOpenVoiceAuditionBasisForKernelV1},artifacts] = await Promise.all([
    import('./open-voice-completion-evidence'),import('./open-voice-job-read-state'),import('./open-voice-candidate'),import('../memory/artifact-store')])
  const source = await captureTtrpgOpenVoiceCompletionV1(request), physical = await readTtrpgOpenVoiceAuditionBasisForKernelV1(request)
  const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(request)
  if (b.snapshot.projection.state !== 'completed' || b.snapshot.projection.terminalReceiptHash !== source.completion.receiptHash
    || physical.candidate.candidateHash !== source.completion.candidateHash) p.fail('首次采用需要准确本机原任务、本人声明和真实音频终态')
  const bodies = []
  for (const ref of source.artifactRefs) {
    const rows = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([request.scope.projectId,ref.artifactKind,ref.contentHash]).toArray()
    if (rows.length !== 1 || !rows[0].id) p.fail('原准确工件不唯一')
    const row = rows[0], content = await artifacts.readAgentRunArtifactExactV1({projectId: request.scope.projectId,...ref})
    if (row.content !== content || stable(await db.agentRunArtifacts.get(row.id!)) !== stable(row)) p.fail('原准确工件在采用核对期间已变化')
    bodies.push(row)
  }
  const runs: TtrpgOpenAgentEvidenceV1[] = [], checkpoints: TtrpgOpenGeneratedAudioWitnessV1['checkpoints'] = []
  for (const snapshot of [b.original.snapshot,b.snapshot]) {
    const events = await db.agentRunEvents.where('runId').equals(snapshot.run.id).sortBy('sequence')
    const projected = events.map(e => ({version: 1,runId:e.runId,sequence:e.sequence,generation:e.generation,projectId:e.projectId,
      worldGroupId:e.worldGroupId??null,contractHash:e.contractHash,type:e.type,createdAt:e.createdAt,payload:p.json(e.payloadJson)}))
    if (stable(projected) !== stable(snapshot.events) || stable(await db.agentRuns.get(snapshot.run.id)) !== stable(snapshot.run)) p.fail('原父子账本在采用核对期间已变化')
    runs.push({run:snapshot.run,events,artifacts:bodies})
    checkpoints.push({runId:snapshot.run.id,rows:await db.agentRunCheckpoints.where('runId').equals(snapshot.run.id).sortBy('id')})
  }
  const runSet: TtrpgOpenVoiceRunSetWitnessV1 = {sessionId:request.sessionId,rows:await db.agentRuns.where('productRuntimeSessionId').equals(request.sessionId).sortBy('id')}
  // Establish uniqueness once more after collecting exact rows, without a new
  // inference or constructing a replacement execution identity.
  const current = await loadTtrpgOpenVoiceJobReadStateForKernelV1(request)
  if (stable(current.snapshot.run) !== stable(b.snapshot.run) || stable(current.original.snapshot.run) !== stable(b.original.snapshot.run)) p.fail('原配音唯一身份已变化')
  await physical.assertCurrent()
  await b.original.owner.assertCurrent()
  return {source,data:physical.data,witness:{runs,checkpoints},runSet}
}
