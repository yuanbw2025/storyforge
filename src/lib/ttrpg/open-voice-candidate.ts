/** Original raw → checked review candidate. No fetch, inference, Blob import,
 * audition receipt, quota or E16/adoption write is granted here. */
import { AgentRunStoreError, appendAgentRunEventV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointV1, verifyAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseCreativeAudioArtifactV1, type CreativeArtifactIssueV1 } from '../agent/creative-reliability'
import { AgentRunArtifactStoreError, readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { loadTtrpgOpenVoiceRawBasisForKernelV1 } from './open-voice-raw-basis'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import { verifyTtrpgOpenVoiceRawResultForKernelV1, TtrpgOpenVoiceResultErrorV1 } from './open-voice-result'
import * as p from './open-contract-parse'

type Basis = Awaited<ReturnType<typeof loadTtrpgOpenVoiceRawBasisForKernelV1>>
type Verified = Awaited<ReturnType<typeof verifyTtrpgOpenVoiceRawResultForKernelV1>>
async function build(b: Basis,includeAuditionBytes = false) {
  const reading = b.original.request.reading
  if (!b.raw || !b.responded || !reading || !b.sourceContent) p.fail('请先明确取回并完整记录原始返回；候选不会查询或重发')
  let verified: Verified | null = null
  try {
    verified = await verifyTtrpgOpenVoiceRawResultForKernelV1(b.raw.content,{ ...b.identity,
      profile: p.object(p.json(b.sourceContent),'original input').profile, sourceTextHash: b.original.request.part.textHash,
      originalPart: b.original.request.part, normalizedText: reading.normalizedText, normalizedTextSha256: reading.normalizedTextSha256, previewHash: reading.previewHash })
  } catch (error) { if (!(error instanceof TtrpgOpenVoiceResultErrorV1)) throw error }
  const issues: CreativeArtifactIssueV1[] = !verified ? [{ version: 1, code: 'ttrpg-local-voice-output-invalid', severity: 'error', disposition: 'blocking',
    path: 'raw-response', message: '原返回未通过准确输入、物理音频或片段证据校验。原文保留，不重发或采用。', suggestedAction: 'replan', evidenceRefs: [b.raw.hash], deterministic: true }]
    : verified.cancellationRequested ? [{ version: 1, code: 'ttrpg-local-voice-first-delivery-stop', severity: 'warning', disposition: 'advisory', path: 'raw-response',
      message: '首次交付时已有停止请求；试听与采用仍须独立确认，当前停止状态另行核查。', suggestedAction: 'none', evidenceRefs: [b.raw.hash], deterministic: true }] : []
  const artifact = parseCreativeAudioArtifactV1({ schema: 'storyforge.creative-audio-artifact', version: 1, policyVersion: 'creative-audio-reliability-v1', modality: 'audio',
    status: !verified ? 'blocked' : issues.length ? 'usable-with-warnings' : 'ready',
    evidence: { inputArtifactHash: b.inputArtifactHash, contextManifestHash: b.manifestHash, rawResponseArtifactHash: b.raw.hash }, audio: verified?.audio ?? null, issues,
    requestEvidence: { kind: 'original-audio-request', provider: 'local-offline', model: p.text(p.object(p.object(p.json(b.sourceContent),'original input').profile,'original profile').profileId,'original voice model',240),
      outputHash: b.raw.hash, latencyMs: verified?.metrics.wallMs ?? null }, humanListening: 'unproven', adoptionAllowed: false, automaticRetryAllowed: false })
  const validation = verified ? { resultHash: verified.resultHash, timeline: verified.timeline, usage: verified.usage, metrics: verified.metrics,
    completionEvidence: verified.completionEvidence, cancellationRequestedAtFirstDelivery: verified.cancellationRequested } : null
  const body = { schema: 'storyforge.ttrpg-open-voice-candidate' as const, version: 1 as const, portable: false as const,
    runId: b.snapshot.run.id!, runContractHash: b.snapshot.run.contractHash, productRuntimeSessionId: b.input.sessionId, viewerKey: b.input.viewerKey,
    requestKey: b.input.requestKey, profileHash: b.identity.profileHash, artifact, validation }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  await b.original.owner.assertCurrent()
  return { candidate, content: canonicalStringify(candidate), auditionData: includeAuditionBytes && verified ? verified.bytes : null }
}
export type TtrpgOpenVoiceCandidateV1 = Awaited<ReturnType<typeof build>>['candidate']
async function retained(b: Basis) {
  const records = b.snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
    && e.payload.stepId === stepId && e.payload.attempt === 1 && e.payload.contentHash !== b.inputArtifactHash)
  if (records.length > 1) p.fail('原语音候选工件重复，保留并停止')
  const event = records[0]
  return event?.type === 'evidence.artifact.recorded' ? readAgentRunArtifactExactV1({ projectId: b.input.scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }) : null
}
async function receipts(b: Basis,candidate: TtrpgOpenVoiceCandidateV1) {
  const events = b.snapshot.events.filter(e => e.type === 'candidate.persisted')
  if (events.length > 1 || events.some(e => e.type !== 'candidate.persisted' || e.payload.stepId !== stepId || e.payload.attempt !== 1
    || e.payload.candidateHash !== candidate.candidateHash || !e.payload.requiresConfirmation)) p.fail('原语音候选回执冲突')
  const candidateEvent = events[0]
  let checkpoint = false
  for (const row of await db.agentRunCheckpoints.where('runId').equals(b.snapshot.run.id!).toArray()) {
    const value: unknown = row.resumePayloadJson === null ? null : p.json(row.resumePayloadJson)
    if (!value || typeof value !== 'object' || !('schema' in value) || value.schema !== 'storyforge.ttrpg-open-voice-candidate-review') continue
    const body = p.record(value,['schema','version','candidateHash','inputArtifactHash','rawResponseArtifactHash'],'original candidate checkpoint')
    if (body.version !== 1 || body.candidateHash !== candidate.candidateHash || body.inputArtifactHash !== b.inputArtifactHash
      || body.rawResponseArtifactHash !== candidate.artifact.evidence.rawResponseArtifactHash
      || !await verifyAgentRunCheckpointV1(b.input.scope,row.id!,{productRuntimeSessionId: b.input.sessionId})) p.fail('原音频候选检查点不一致')
    if (candidateEvent && row.throughSequence >= candidateEvent.sequence && b.snapshot.events.some(e => e.type === 'checkpoint.created'
      && e.payload.checkpointHash === row.checkpointHash && e.payload.throughSequence === row.throughSequence)) checkpoint = true
  }
  return { persisted: events.length === 1, checkpoint }
}
export async function readTtrpgOpenVoiceCandidateV1(request: TtrpgOpenVoiceJobLocatorV1) {
  const b = await loadTtrpgOpenVoiceRawBasisForKernelV1(structuredClone(request)), content = await retained(b)
  if (content === null) {
    if (b.snapshot.events.some(e => e.type === 'candidate.persisted')) p.fail('原候选回执已有但正文证明缺失，不能重建')
    return null
  }
  const built = await build(b)
  if (content !== built.content) p.fail('已保存候选与原准确证据不一致，不能覆盖')
  const receipt = await receipts(b,built.candidate)
  await b.original.owner.assertCurrent()
  return { candidate: built.candidate, complete: receipt.persisted && receipt.checkpoint, generationAllowed: false as const, adoptionAllowed: false as const }
}
/** Internal actual-byte handoff only; the public audition service owns its
 * local lifetime. Nothing here creates a listening/adoption receipt. */
export async function readTtrpgOpenVoiceAuditionBasisForKernelV1(request: TtrpgOpenVoiceJobLocatorV1 & { candidateHash: string }) {
  const input = structuredClone(request);p.hash(input.candidateHash,'exact voice audition candidate')
  const b = await loadTtrpgOpenVoiceRawBasisForKernelV1(input), content = await retained(b), built = await build(b,true)
  const receipt = await receipts(b,built.candidate)
  if (b.original.owner.runtime.product.safety.status !== 'active' || content !== built.content || built.candidate.candidateHash !== input.candidateHash
    || !receipt.persisted || !receipt.checkpoint || !built.auditionData || !built.candidate.validation
    || !['ready','usable-with-warnings'].includes(built.candidate.artifact.status)) p.fail('本次原候选尚不能试听；核对原证据、本人权限和当前安全状态')
  await b.original.owner.assertCurrent()
  const proof = { content: built.content, candidate: built.candidate, ledgerHash: await hashCanonicalValue([b.snapshot,b.original.snapshot]) }
  return { basis: b,candidate: built.candidate,data: built.auditionData,timeline: built.candidate.validation.timeline,
    assertCurrent: () => assertAuditionEvidence(input,proof) }
}
/** Close the prepare → observer gap using original evidence, without decoding
 * PCM again or retaining another raw/base64 copy for the preview lifetime. */
async function assertAuditionEvidence(input: TtrpgOpenVoiceJobLocatorV1, proof: {content: string;candidate: TtrpgOpenVoiceCandidateV1;ledgerHash: string}) {
  const b = await readTtrpgOpenVoiceCandidateRetentionForKernelV1(input,proof.candidate)
  if (canonicalStringify(proof.candidate) !== proof.content || await hashCanonicalValue([b.snapshot,b.original.snapshot]) !== proof.ledgerHash
    || b.original.owner.runtime.product.safety.status !== 'active') p.fail('试听的原证据或安全状态已变化')
}
/** Retention/CAS proof only, never a physical validation or adoption grant.
 * Callers first obtain a fully checked original candidate, then may recheck its
 * immutable body/inputs/checkpoint while appending their own evidence events. */
export async function readTtrpgOpenVoiceCandidateRetentionForKernelV1(input: TtrpgOpenVoiceJobLocatorV1,candidate: TtrpgOpenVoiceCandidateV1) {
  const b = await loadTtrpgOpenVoiceRawBasisForKernelV1(input), content = await retained(b)
  if (content !== canonicalStringify(candidate) || candidate.runId !== b.snapshot.run.id || candidate.runContractHash !== b.snapshot.run.contractHash
    || candidate.requestKey !== b.input.requestKey || candidate.viewerKey !== b.input.viewerKey || candidate.productRuntimeSessionId !== b.input.sessionId
    || candidate.profileHash !== b.identity.profileHash || candidate.artifact.evidence.inputArtifactHash !== b.inputArtifactHash
    || candidate.artifact.evidence.contextManifestHash !== b.manifestHash || candidate.artifact.evidence.rawResponseArtifactHash !== b.raw?.hash || !b.responded) p.fail('原候选的准确正文、来源或运行已变化')
  const receipt = await receipts(b,candidate)
  if (!receipt.persisted || !receipt.checkpoint) p.fail('原候选的专属检查点或保存证明已不可用')
  await b.original.owner.assertCurrent()
  return b
}
export async function prepareTtrpgOpenVoiceCandidateV1(request: TtrpgOpenVoiceJobLocatorV1 & { decision: 'review-this-original-local-voice-result' }) {
  const input = structuredClone(request); p.literal(input.decision,'review-this-original-local-voice-result','explicit original audio review')
  // Decode/scan up to 100 MiB once per explicit action. Ledger CAS retries
  // recheck fresh owner and exact immutable evidence, not the physical PCM.
  const first = await loadTtrpgOpenVoiceRawBasisForKernelV1(input), built = await build(first)
  for (let attempt = 0; attempt < 12; attempt++) {
    const b = attempt === 0 ? first : await loadTtrpgOpenVoiceRawBasisForKernelV1(input)
    if (b.snapshot.run.id !== built.candidate.runId || b.snapshot.run.contractHash !== built.candidate.runContractHash
      || b.inputArtifactHash !== first.inputArtifactHash || b.manifestHash !== first.manifestHash
      || b.raw?.hash !== built.candidate.artifact.evidence.rawResponseArtifactHash || !b.responded) p.fail('审阅中的原准确输入/返回或谱系已经变化')
    const content = await retained(b)
    if (content !== null && content !== built.content) p.fail('已有原语音候选与准确返回不一致，保留原状')
    const receipt = await receipts(b,built.candidate), state = b.snapshot.projection.state
    if (content === null && receipt.persisted) p.fail('原候选回执已有但正文证明缺失，不能重建')
    if (content !== null && receipt.persisted && receipt.checkpoint) {
      await b.original.owner.assertCurrent()
      return { candidate: built.candidate, generationAllowed: false as const, adoptionAllowed: false as const }
    }
    if (!['running','awaiting_confirmation'].includes(state)) p.fail('请先明确恢复原返回记账，不自动续接已暂停或终态 Run')
    await b.original.owner.assertCurrent()
    const owner = { scope: input.scope, productRuntimeSessionId: input.sessionId, runId: b.snapshot.run.id! }, expectedLastSequence = b.snapshot.projection.lastSequence
    try {
      if (content === null) { await recordAgentRunArtifactV1({ ...owner, stepId, attempt: 1, artifactKind: 'source-snapshot', content: built.content, expectedLastSequence }); continue }
      if (!receipt.persisted) { await appendAgentRunEventV1({ ...owner, type: 'candidate.persisted', payload: { stepId,attempt: 1,candidateHash: built.candidate.candidateHash,requiresConfirmation: true },expectedLastSequence }); continue }
      await createAgentRunCheckpointV1({ ...owner, expectedLastSequence, resumePayload: { schema: 'storyforge.ttrpg-open-voice-candidate-review', version: 1,
        candidateHash: built.candidate.candidateHash, inputArtifactHash: b.inputArtifactHash, rawResponseArtifactHash: built.candidate.artifact.evidence.rawResponseArtifactHash } })
    } catch (error) {
      if (error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict') continue
      if (error instanceof AgentRunStoreError && error.code === 'sequence_conflict') continue
      throw error
    }
  }
  p.fail('原音频审阅持续竞争，请明确继续同一候选；没有重发模型')
}
