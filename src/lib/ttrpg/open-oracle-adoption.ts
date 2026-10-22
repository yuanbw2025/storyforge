/** Reconcile a real E5 into the Instance Harness; this function never writes another runtime fact. */
import { db } from '../db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenOracleCandidateProofV1 } from './open-oracle-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { parseTtrpgOpenOracleReviewV1, verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
import { parseTtrpgOpenFactEntryV1, ttrpgOpenOracleFactProposalFromFactV1 } from './open-fact-ledger'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { AgentRunStoreError, readInstanceAgentRunV1, appendAgentRunEventV1, appendRuntimeCandidateAdoptedV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1, parseVerificationReceiptV1, verifyVerificationReceiptIntegrityV1 } from '../agent/run/verification-receipt'
import { AgentRunArtifactStoreError, recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'

const ORACLE_VERIFIER = 'ttrpg-open-oracle-interpret-v1'
export class TtrpgOpenOracleReceiptPendingError extends Error {
  readonly code: string
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number, cause: unknown, kind: 'fact' | 'review' = 'fact') {
    super(`确认已提交，但终验回执尚未完成；请恢复回执。${cause instanceof Error ? cause.message : ''}`)
    this.name = 'TtrpgOpenOracleReceiptPendingError'
    this.code = `oracle-${kind}-committed-receipt-pending`
  }
}
export async function reconcileTtrpgOpenOracleFactRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const { candidate } = await verifyTtrpgOpenOracleCandidateProofV1(input)
  const session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const reviews = runtime?.openRun?.oracleReviews?.filter(review => review.requestKey === input.requestKey && review.candidateHash === input.candidateHash) ?? []
  const review = reviews[0]
  const common = candidate.schema === 'storyforge.ttrpg-open-common-oracle-candidate'
  const VERIFIER = common ? 'ttrpg-open-common-oracle-interpret-v1' : candidate.normalizationOf ? 'ttrpg-open-fact-normalize-v1' : ORACLE_VERIFIER
  const entries = runtime?.openRun?.factLedger?.entries.filter(entry => entry.modelCandidate?.requestKey === input.requestKey
    && entry.modelCandidate.candidateHash === input.candidateHash) ?? []
  if (!session || reviews.length > 1 || (!review && entries.length !== 1)) throw new Error('[ttrpg-open-oracle] 终验需要唯一真实已确认事实或完整审阅，不能从候选直接宣布成功')
  const entry = entries[0], sourceRef = review?.sourceRef ?? entry.sourceRef
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const factEvent = events.find(event => event.sequence === sourceRef.sequence)
  if (!factEvent || !factEvent.commandId || factEvent.baseSequence == null || sourceRef.sessionKey !== runtime!.sessionKey) throw new Error('[ttrpg-open-oracle] 终验缺少真实提交事件')
  if (review) {
    await verifyTtrpgOpenOracleReviewHashesV1([review])
    if (factEvent.type !== 'ttrpg.open.oracle.reviewed' || review.viewerKey !== input.viewerKey
      || await hashCanonicalValue(parseTtrpgOpenOracleReviewV1(JSON.parse(factEvent.payloadJson).review)) !== await hashCanonicalValue(review)
      || await hashCanonicalValue(review.proposals) !== await hashCanonicalValue(candidate.facts) || review.interpretation !== candidate.interpretation) {
      throw new Error('[ttrpg-open-oracle] 终验完整审阅与真实候选或提交字节不一致')
    }
  } else if (factEvent.type !== 'ttrpg.fact.asserted' || entry.viewerKey !== input.viewerKey
    || await hashCanonicalValue(parseTtrpgOpenFactEntryV1(JSON.parse(factEvent.payloadJson).entry)) !== await hashCanonicalValue(entry)
    || await hashCanonicalValue(ttrpgOpenOracleFactProposalFromFactV1(entry.fact)) !== await hashCanonicalValue(candidate.facts![entry.modelCandidate!.proposalIndex])) {
    throw new Error('[ttrpg-open-oracle] 终验事实、真人确认与实际 E5 字节不一致')
  }
  const postState = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(event => event.sequence <= factEvent.sequence))
  const postStateHash = await hashProductRuntimeStateV1(postState)
  const adoptionHash = await hashCanonicalValue({ candidateHash: input.candidateHash, ...(review ? { review } : { fact: entry }),
    commandId: factEvent.commandId, resultingSequence: factEvent.sequence, postStateHash })
  const rejectionArtifact = review?.interpretationDecision === 'reject'
    ? JSON.stringify({ schema: 'storyforge.ttrpg-oracle-review-rejection', version: 1, review, postStateHash }) : ''
  const rejectionArtifactHash = rejectionArtifact ? await sha256Text(rejectionArtifact) : null
  // Only local journal CAS conflicts are retried. There is no transport or another E5 in this loop.
  for (let transition = 0; transition < 12; transition += 1) {
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    const call = runtime!.openRun!.coordination.calls.find(call => call.requestKey === input.requestKey)!
    const step = snapshot.projection.steps[call.stepId]
    const adopted = snapshot.events.find(event => event.type === 'runtime.candidate.adopted' && event.payload.candidateHash === input.candidateHash)
    if (adopted?.type === 'runtime.candidate.adopted' && (adopted.payload.adoptionHash !== adoptionHash
      || adopted.payload.resultingSequence !== factEvent.sequence || adopted.payload.commandIds.join(',') !== factEvent.commandId)) {
      throw new Error('[ttrpg-open-oracle] 终验不能更换已采用的事实事件')
    }
    const append = (type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) => appendAgentRunEventV1({
      scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type, payload,
      expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
    try {
      if (review?.interpretationDecision === 'reject') {
        const retained = snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'source-snapshot'
          && event.payload.contentHash === rejectionArtifactHash)
        if (!retained) {
          await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
            artifactKind: 'source-snapshot', content: rejectionArtifact, stepId: call.stepId, attempt: call.attempt,
            expectedLastSequence: snapshot.projection.lastSequence }); continue
        }
        await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: rejectionArtifactHash! })
        if (!step.confirmation) { await append('confirmation.recorded', { stepId: call.stepId, candidateHash: input.candidateHash, decision: 'reject' }); continue }
        if (step.confirmation !== 'reject') throw new Error('[ttrpg-open-oracle] 拒绝审阅不能变成采用')
        if (snapshot.projection.state === 'failed' && snapshot.events.some(event => event.type === 'run.failed' && event.payload.code === 'oracle-interpretation-rejected')) return review.reviewHash
        await append('run.failed', { code: 'oracle-interpretation-rejected', retryable: false }); continue
      }
      if (!step.confirmation) {
        await append('confirmation.recorded', { stepId: call.stepId, candidateHash: input.candidateHash, decision: 'adopt' }); continue
      }
      if (step.confirmation !== 'adopt') throw new Error('[ttrpg-open-oracle] 已拒绝候选不能签发成功回执')
      if (!adopted) {
        await appendRuntimeCandidateAdoptedV1({ scope: input.scope, runId: input.runId, expectedLastSequence: snapshot.projection.lastSequence,
          payload: { stepId: call.stepId, candidateHash: input.candidateHash, adoptionHash, commandIds: [factEvent.commandId],
            baseSequence: factEvent.baseSequence, resultingSequence: factEvent.sequence } }); continue
      }
      if (step.status !== 'succeeded') {
        await append('step.succeeded', { stepId: call.stepId, attempt: call.attempt, outputHash: adoptionHash }); continue
      }
      if (snapshot.projection.state === 'running') {
        await append('verification.started', { verifierSetVersion: VERIFIER }); continue
      }
      if (!['verifying', 'completed'].includes(snapshot.projection.state)) throw new Error('[ttrpg-open-oracle] 运行不在可恢复终验状态')
      const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: snapshot.projection.generation,
        contractHash: snapshot.run.contractHash, contextManifestHashes: snapshot.events.filter(event => event.type === 'context.assembled' && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt).slice(-1).map(event => event.type === 'context.assembled' ? event.payload.manifestHash : candidate.inputManifestHash),
        candidateHashes: [input.candidateHash], adoptionEventIds: [], postStateHash, verifierSetVersion: VERIFIER,
        criteria: [{ id: common ? 'common-oracle.protocol' : candidate.normalizationOf ? 'fact.protocol' : 'oracle.protocol', status: 'passed', evidenceRefs: [`candidate:${input.candidateHash}`, `raw:${candidate.rawResponseHash}`] },
          { id: review ? 'oracle.review.commit' : 'oracle.fact.commit', status: 'passed', evidenceRefs: [`${review ? 'review' : 'E5'}:${sourceRef.sessionKey}:${factEvent.sequence}`, `adoption:${adoptionHash}`] }],
        acceptedAt: factEvent.createdAt })
      let retained = false
      for (const event of snapshot.events) {
        if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot') continue
        const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
          artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })) as { schema?: string; receipt?: unknown; adoptionHash?: string }
        if (body.schema !== 'storyforge.ttrpg-oracle-fact-verification') continue
        const saved = parseVerificationReceiptV1(body.receipt)
        if (body.adoptionHash !== adoptionHash || !await verifyVerificationReceiptIntegrityV1(saved) || saved.receiptHash !== receipt.receiptHash) {
          throw new Error('[ttrpg-open-oracle] 已保存终验回执与真实事实不一致')
        }
        retained = true
      }
      if (!retained) {
        if (snapshot.projection.state === 'completed') throw new Error('[ttrpg-open-oracle] 完成运行缺少可回读终验工件')
        await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
          artifactKind: 'source-snapshot', content: JSON.stringify({ schema: 'storyforge.ttrpg-oracle-fact-verification', version: 1, adoptionHash, receipt }),
          stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence }); continue
      }
      if (snapshot.projection.state === 'completed') {
        if (snapshot.projection.terminalReceiptHash !== receipt.receiptHash) throw new Error('[ttrpg-open-oracle] 终态 hash 与实际回执不一致')
        return receipt.receiptHash
      }
      await append('verification.accepted', { receiptHash: receipt.receiptHash })
    } catch (error) {
      const journalConflict = error instanceof AgentRunStoreError && error.code === 'sequence_conflict'
      const artifactConflict = error instanceof AgentRunArtifactStoreError && error.code === 'sequence-conflict'
      if (!journalConflict && !artifactConflict) throw error
    }
  }
  throw new Error('[ttrpg-open-oracle] 终验存在持续并发竞争，已保留 E5，请稍后恢复确认回执')
}
