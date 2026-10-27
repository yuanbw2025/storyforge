/** Exact history of a completed read-only generator. Callers of the archive
 * reader must already own its retained reference. Archives grant no access,
 * model execution, new personal declaration or runtime adoption authority. */
import { canonicalStringify as stable } from '../agent/run/hash'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { buildMemorySettlementReceiptFromFrozenLedgerV1, hashMemoryArtifactIndexV1 } from '../memory/settlement-core'
import { verifyRecordedMemorySettlementV1 } from '../agent/run/event-store'
import type { ExactRunArtifactIdentityV1 } from '../types'
import { parseTtrpgOpenVoiceCompletionV1, type TtrpgOpenVoiceCompletionV1 } from './open-voice-completion-contract'
import { parseTtrpgOpenVoiceArchivedRunForKernelV1 as log, readTtrpgOpenVoiceSourceEvidenceForKernelV1 } from './open-voice-source-evidence'
import { readTtrpgOpenVoiceCandidateReviewV1 } from './open-voice-review-service'
import { loadTtrpgOpenVoiceJobReadStateForKernelV1, type TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import { parseTtrpgOpenVoiceQualityReviewV1 } from './open-voice-review-contract'
import { buildTtrpgOpenVoiceGenerationVerificationV1, ttrpgOpenVoiceQualityConfirmationV1,
  TTRPG_OPEN_VOICE_GENERATION_VERIFIER_V1 as verifier } from './open-voice-generation-verification'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import * as p from './open-contract-parse'

type Log = Awaited<ReturnType<typeof log>>
async function frozenSettlement(snapshot: Log, identity: {worldCode: string; workCode: string}) {
  const recorded = snapshot.events.filter(e => e.type === 'memory.settlement.recorded')
  const created = snapshot.events[0]
  if (recorded.length !== 1 || created?.type !== 'run.created' || snapshot.projection.state !== 'completed') p.fail('原配音历史缺少唯一真实终态记忆结算')
  const event = recorded[0], receipt = await buildMemorySettlementReceiptFromFrozenLedgerV1({
    snapshot: { run: {id: snapshot.runId, contractHash: snapshot.contractHash, createdAt: created.createdAt},
      contract: snapshot.contract, events: snapshot.events, projection: snapshot.projection },
    identity, workspaceDirty: event.payload.workspaceDirty, evaluatedAt: event.createdAt })
  const expected = { receiptHash: receipt.receiptHash, terminalReceiptHash: receipt.terminalReceiptHash, state: receipt.state,
    contextManifestHashes: receipt.contextManifestHashes, adoptionHashes: receipt.adoptionHashes,
    artifactIndexHash: await hashMemoryArtifactIndexV1(receipt.artifactRefs), workspaceDirty: receipt.workspaceDirty }
  if (stable(event.payload) !== stable(expected)) p.fail('原配音历史记忆结算与同一权威投影不一致')
  return event
}

export async function readTtrpgOpenVoiceCompletionForKernelV1(input: {
  projectId: number; requestKey: string; sessionKey: string; runtimeSourceHash: string; completion: TtrpgOpenVoiceCompletionV1
}) {
  const expected = structuredClone(input), completion = parseTtrpgOpenVoiceCompletionV1(expected.completion)
  const source = await readTtrpgOpenVoiceSourceEvidenceForKernelV1({ ...expected,
    evidenceArtifactHash: completion.sourceEvidenceArtifactHash, candidateHash: completion.candidateHash })
  const capsuleContent = await readAgentRunArtifactExactV1({ projectId: expected.projectId, artifactKind: 'source-snapshot', contentHash: completion.sourceEvidenceArtifactHash })
  const capsule = p.object(p.json(capsuleContent), 'completed original source capsule'), prefix = await log(capsule.execution), intent = await log(capsule.intent)
  const tail = p.list(p.json(completion.completionEventsJson), 'completed original tail', e => e, 128, 1)
  const execution = await log({ ...p.object(capsule.execution, 'original execution prefix'), events: [...prefix.events, ...tail] })
  if (intent.events.length + execution.events.length > 4096) p.fail('完整原父子语音历史超限，不截断证据')
  const events = execution.events.slice(prefix.events.length), end = events[events.length - 2], settlement = events[events.length - 1]
  if (!events.length || events.some(e => !['evidence.artifact.recorded','confirmation.recorded','step.succeeded',
    'verification.started','verification.accepted','memory.settlement.recorded'].includes(e.type))
    || end?.type !== 'verification.accepted' || settlement?.type !== 'memory.settlement.recorded'
    || end.payload.receiptHash !== completion.receiptHash || settlement.createdAt !== end.createdAt
    || execution.projection.state !== 'completed' || execution.projection.terminalReceiptHash !== completion.receiptHash) p.fail('原语音完成尾部缺少准确终验与原子记忆结算')

  const roots = new Map(source.artifactRefs.map(ref => [ref.artifactKind + ':' + ref.contentHash, ref]))
  const bodies = new Map<string, string>()
  for (const e of events) if (e.type === 'evidence.artifact.recorded') {
    const artifactKind = p.oneOf(e.payload.artifactKind, ['source-snapshot','context-manifest','raw-response'], 'completed original artifact kind')
    const ref = {artifactKind, contentHash: e.payload.contentHash}
    const content = await readAgentRunArtifactExactV1({projectId: expected.projectId, ...ref})
    if (new TextEncoder().encode(content).length !== e.payload.byteLength) p.fail('原完成工件与实际记录字节不一致')
    roots.set(artifactKind + ':' + ref.contentHash, ref); bodies.set(artifactKind + ':' + ref.contentHash, content)
  }
  if (roots.size > 64) p.fail('完成来源超过现有准确引用预算，不静默丢弃')
  function artifact(contentHash: string) {
    const found = events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot' && e.payload.contentHash === contentHash)
    if (found.length !== 1 || found[0].type !== 'evidence.artifact.recorded' || found[0].payload.stepId != null || found[0].payload.attempt != null) p.fail('原完成工件缺少唯一独立实际记录')
    const content = bodies.get('source-snapshot:' + contentHash)
    if (content === undefined || stable(p.json(content)) !== content) p.fail('原完成工件不是准确规范正文')
    return {event: found[0], content}
  }
  const sourceEvent = artifact(completion.sourceEvidenceArtifactHash), reviewed = artifact(completion.reviewArtifactHash)
  const verified = artifact(completion.verificationArtifactHash), review = parseTtrpgOpenVoiceQualityReviewV1(p.json(reviewed.content))
  if (review.candidateHash !== completion.candidateHash || review.sourceEvidenceArtifactHash !== completion.sourceEvidenceArtifactHash
    || review.runId !== execution.runId || review.contractHash !== execution.contractHash || review.reviewedAt !== reviewed.event.createdAt
    || review.reviewer.viewerKey !== source.request.script.scope.issuerViewerKey || review.reviewer.seatKey !== source.request.script.scope.issuerSeatKey
    || review.audioContentHash !== source.audio.contentHash || review.sourceTextHash !== source.request.textHash
    || review.normalizedTextSha256 !== source.request.reading!.normalizedTextSha256
    || review.runtimeReadEvidence.sessionKey !== source.request.script.sessionKey || review.runtimeReadEvidence.runtimeSourceHash !== source.request.script.runtimeSourceHash
    || review.runtimeReadEvidence.sequence < source.request.sourceRef.sequence) p.fail('原完成声明与准确候选、本人或来源不一致')
  if (stable(execution.contract.acceptance) !== stable([{id: 'voice.audio-candidate', kind: 'deterministic-check', required: true}])
    || stable(execution.contract.verificationPlan) !== stable([{id: 'voice.audio-terminal', kind: 'terminal', verifier, criterionIds: ['voice.audio-candidate']}])) p.fail('原完成不是冻结的只读生成终验合同')
  const parent = execution.contract.lineage!.parent!
  const proof = await buildTtrpgOpenVoiceGenerationVerificationV1({runId: execution.runId, generation: execution.projection.generation,
    contractHash: execution.contractHash, events: execution.events, inputArtifactHash: p.hash(execution.contract.runtimeBindingHash, 'original completed input'),
    requestKey: source.request.requestKey, lineage: parent, review, reviewArtifactHash: completion.reviewArtifactHash})
  if (proof.artifactHash !== completion.verificationArtifactHash || proof.content !== verified.content || proof.receipt.receiptHash !== completion.receiptHash) p.fail('原完成终验正文与同一验收工厂不一致')
  const confirms = execution.events.filter(e => e.type === 'confirmation.recorded'), successes = execution.events.filter(e => e.type === 'step.succeeded')
  const starts = execution.events.filter(e => e.type === 'verification.started'), ends = execution.events.filter(e => e.type === 'verification.accepted')
  const step = execution.projection.steps[stepId]
  if (confirms.length !== 1 || stable(confirms[0].payload) !== stable(ttrpgOpenVoiceQualityConfirmationV1(completion.candidateHash, completion.reviewArtifactHash))
    || successes.length !== 1 || successes[0].payload.stepId !== stepId || successes[0].payload.attempt !== 1 || successes[0].payload.outputHash !== completion.candidateHash
    || starts.length !== 1 || starts[0].payload.verifierSetVersion !== verifier || ends.length !== 1 || !step || step.status !== 'succeeded' || step.outputHash !== completion.candidateHash
    || !(sourceEvent.event.sequence < reviewed.event.sequence && reviewed.event.sequence < confirms[0].sequence
      && confirms[0].sequence < successes[0].sequence && successes[0].sequence < starts[0].sequence
      && starts[0].sequence < verified.event.sequence && verified.event.sequence < end.sequence)) p.fail('原完成缺少实际本人确认、步骤与终验顺序')
  const manifestRef = prefix.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-manifest')
  if (manifestRef?.type !== 'evidence.artifact.recorded') p.fail('原完成缺少冻结身份的实际 Manifest')
  const manifest = p.object(p.json(await readAgentRunArtifactExactV1({projectId: expected.projectId,
    artifactKind: 'context-manifest', contentHash: manifestRef.payload.contentHash})), 'completed original manifest')
  const scope = p.object(manifest.scope, 'original manifest identity'), identity = {
    worldCode: p.text(scope.worldCode, 'original frozen world code', 160), workCode: p.text(scope.workCode, 'original frozen work code', 160) }
  await frozenSettlement(intent, identity)
  if ((await frozenSettlement(execution, identity)).sequence !== settlement.sequence) p.fail('原完成尾部不是实际结算切点')
  const artifactRefs: ExactRunArtifactIdentityV1[] = [...roots.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,ref]) => ref)
  return { completion, request: source.request, timeline: source.timeline, audio: source.audio, review, artifactRefs,
    archiveOnly: true as const, generationAllowed: false as const, adoptionAllowed: false as const,
    independentListening: 'unproven' as const, physicalAudioRechecked: false as const, runtimePostStateReplayed: false as const }
}

/** Observe the native original only. A completed read-only generator remains
 * completed; capture adds no Run, artifact, event, media or runtime write. */
export async function captureTtrpgOpenVoiceCompletionV1(request: TtrpgOpenVoiceJobLocatorV1 & {candidateHash: string}) {
  const input = structuredClone(request), reviewed = await readTtrpgOpenVoiceCandidateReviewV1(input)
  if (!reviewed?.complete || !reviewed.verificationArtifactHash || !reviewed.receiptHash) p.fail('请先完成原候选的本人审阅与实际生成终验')
  const b = await loadTtrpgOpenVoiceJobReadStateForKernelV1(input)
  for (const s of [b.snapshot, b.original.snapshot]) {
    if (s.run.createdAt !== s.events[0]?.createdAt) p.fail('原任务创建时间与真实创建事件不一致')
    await verifyRecordedMemorySettlementV1({scope: input.scope, snapshot: s})
  }
  const capsule = p.object(p.json(await readAgentRunArtifactExactV1({projectId: input.scope.projectId,
    artifactKind: 'source-snapshot', contentHash: reviewed.review.sourceEvidenceArtifactHash})), 'native completed source capsule')
  const prefix = await log(capsule.execution), intent = await log(capsule.intent)
  if (prefix.runId !== b.snapshot.run.id || prefix.contractHash !== b.snapshot.run.contractHash
    || intent.runId !== b.original.snapshot.run.id || intent.contractHash !== b.original.snapshot.run.contractHash
    || stable(b.snapshot.events.slice(0, prefix.events.length)) !== stable(prefix.events)
    || stable(b.original.snapshot.events.slice(0, intent.events.length)) !== stable(intent.events)) p.fail('原完成捕获缺少准确父子事件前缀')
  const settled = b.snapshot.events.filter(e => e.type === 'memory.settlement.recorded')
  if (settled.length !== 1 || settled[0].sequence <= prefix.events.length) p.fail('原完成缺少唯一已观察的结算切点')
  const completion = parseTtrpgOpenVoiceCompletionV1({schema: 'storyforge.ttrpg-open-voice-generation-completion', version: 1,
    sourceEvidenceArtifactHash: reviewed.review.sourceEvidenceArtifactHash, candidateHash: input.candidateHash,
    reviewArtifactHash: reviewed.reviewArtifactHash, verificationArtifactHash: reviewed.verificationArtifactHash, receiptHash: reviewed.receiptHash,
    completionEventsJson: stable(b.snapshot.events.slice(prefix.events.length, settled[0].sequence))})
  const result = await readTtrpgOpenVoiceCompletionForKernelV1({projectId: input.scope.projectId, requestKey: input.requestKey,
    sessionKey: b.original.request.script.sessionKey, runtimeSourceHash: b.original.request.script.runtimeSourceHash, completion})
  await b.original.owner.assertCurrent()
  return result
}
