/** Domain adoption and terminal repair remain separate; neither path sends a model request. */
import { db } from '../db/schema'
import type { ProductRuntimeSession, ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { assertTtrpgOpenSituationHumanGmV1, verifyTtrpgOpenSituationCandidateProofV1 } from './open-generated-situation-candidate'
import { loadTtrpgOpenSituationKernelInputV1 } from './open-generated-situation-context'
import { reviewTtrpgOpenGeneratedSituationProposalV1 } from './open-generated-situation-contract'
import { parseTtrpgOpenSessionSituationReceiptV1, parseTtrpgOpenSituationArtifactRefsV1 } from './open-session-situation-contract'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'
import { freezeTtrpgOpenRunOriginForExportV1, parseTtrpgOpenRunOriginV1 } from './open-run-portability'

export type TtrpgOpenSituationAdoptionInputV1 = TtrpgOpenCandidateReadV1 & { candidateHash: string; templateHash: string; disclosure: 'player-and-discovery-text-reviewed' }
export class TtrpgOpenSituationReceiptPendingError extends Error {
  readonly code = 'situation-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number) {
    super('局势定义已采用，原运行终验回执尚待补齐；无需再次生成或采用。')
  }
}
/** Called only inside the existing formal command preflight and its shared evidence CAS. */
export async function prepareTtrpgOpenSituationAdoptionV1(input: TtrpgOpenSituationAdoptionInputV1, context: {
  state: ProductRuntimeState; session: ProductRuntimeSession; sequence: number; content: TtrpgRuntimeContentV2;
}) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const proof = await verifyTtrpgOpenSituationCandidateProofV1(input), candidate = proof.candidate
  const current = await loadTtrpgOpenSituationKernelInputV1({ ...input, actorKey: 'gm' })
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg)!, run = runtime.openRun!, auth = runtime.authorization!
  const epoch = run.coordination.epochs.find(e => e.epochKey === candidate.epochKey), seat = auth.seats.find(s => s.viewerKey === input.viewerKey)
  const templateHash = await hash(candidate.review!.proposal.template)
  if (input.disclosure !== 'player-and-discovery-text-reviewed' || input.templateHash !== templateHash
    || !epoch || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey || epoch.viewerKey !== input.viewerKey
    || !seat || seat.role !== 'gm' || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.seatKey !== epoch.triggeredBySeatKey
    || candidate.admissionStateHash !== current.context.admissionStateHash || candidate.visibilityHash !== current.context.visibilityHash
    || candidate.runtimeSourceHash !== context.session.runtimeSourceHash || stable(current.loaded.state) !== stable(context.state)) {
    throw new Error('局势采用需要当前真人 GM 对精确正文的明确披露；来源、权限或原窗口已变化时请重新拟定。')
  }
  const raw = proof.evidence.artifacts.find(r => r.artifactKind === 'raw-response' && r.contentHash === candidate.rawResponseHash)
  if (!raw?.content) throw new Error('局势采用缺少原始回答')
  const review = await reviewTtrpgOpenGeneratedSituationProposalV1({ value: JSON.parse(raw.content), basis: current.basis })
  if (!review.evaluation.accepted || stable(review) !== stable(candidate.review)) throw new Error('局势采用未通过当前完整确定性预检')
  const runOriginJson = await freezeTtrpgOpenRunOriginForExportV1(input.runId, { contractHash: proof.run.run.contractHash, lastSequence: proof.run.run.lastSequence })
  if (!runOriginJson) throw new Error('局势采用缺少可搬运的原始 Run 证据')
  const origin = await parseTtrpgOpenRunOriginV1(runOriginJson)
  const artifactRefs = parseTtrpgOpenSituationArtifactRefsV1(origin.events.flatMap(e => e.type === 'evidence.artifact.recorded'
    ? [{ artifactKind: e.payload.artifactKind, contentHash: e.payload.contentHash }] : []))
  const body = { schema: 'storyforge.ttrpg-open-session-situation' as const, version: 1 as const,
    sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, authorizationRef: epoch.startedRef,
    runtimeSourceHash: context.session.runtimeSourceHash, acceptedAtWorldTurn: run.worldTime.worldTurn,
    template: review.proposal.template, templateHash, personalizationSourceKeys: review.proposal.personalizationSourceKeys, runOriginJson, artifactRefs,
    ...(current.basis.runtimeEntityReferences ? { runtimeEntityReferences: current.basis.runtimeEntityReferences } : {}),
    model: { requestKey: input.requestKey, epochKey: epoch.epochKey, runContractHash: proof.evidence.run.contractHash,
      candidateHash: candidate.candidateHash, rawResponseHash: candidate.rawResponseHash, inputManifestHash: candidate.inputManifestHash,
      contextHash: candidate.visibilityHash, basisHash: review.basisHash, proposalHash: review.proposalHash, referencesHash: await hash(candidate.references) },
    disclosure: { kind: 'human-gm-reviewed' as const, viewerKey: input.viewerKey, seatKey: seat.seatKey,
      authorizationHash: epoch.authorizationHash, templateHash, scope: input.disclosure } }
  const receipt = parseTtrpgOpenSessionSituationReceiptV1({ ...body, receiptHash: await hash(body) })
  await current.loaded.assertCurrent()
  return { actorKey: 'gm', targetKey: receipt.template.templateKey,
    payload: { receipt, frozenContent: context.content }, agentEvidence: proof.evidence }
}

export async function reconcileTtrpgOpenSituationRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const proof = await verifyTtrpgOpenSituationCandidateProofV1(input), candidate = proof.candidate
  const session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const receipt = runtime?.openRun?.situationReceipts?.find(r => r.model.requestKey === input.requestKey && r.model.candidateHash === input.candidateHash)
  if (!session || !receipt || receipt.sourceRef.sessionKey !== runtime!.sessionKey || receipt.disclosure.viewerKey !== input.viewerKey
    || stable(receipt.template) !== stable(candidate.review!.proposal.template) || receipt.model.rawResponseHash !== candidate.rawResponseHash
    || receipt.model.referencesHash !== await hash(candidate.references) || receipt.model.proposalHash !== candidate.review!.proposalHash) throw new Error('局势终验缺少同候选实际已提交的采用回执')
  await verifyTtrpgOpenSessionSituationHashesV1([receipt])
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, receipt.sourceRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.situation.accepted'
    || stable(parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)) !== stable(receipt)) throw new Error('局势终验没有实际原始采用事件')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(e => e.sequence <= event.sequence))
  const postStateHash = await hashProductRuntimeStateV1(state), adoptionHash = await hash({ receipt, commandId: event.commandId, postStateHash })
  return finalizeTtrpgOpenRuntimeAdoptionV1(input, { candidate, event: { ...event, commandId: event.commandId, baseSequence: event.baseSequence },
    call: runtime!.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!, adoptionHash, postStateHash,
    verifier: 'ttrpg-open-situation-propose-v1', verificationSchema: 'storyforge.ttrpg-situation-verification', criteria: [
      { id: 'situation.protocol', status: 'passed', evidenceRefs: ['candidate:' + input.candidateHash, 'raw:' + candidate.rawResponseHash] },
      { id: 'situation.commit', status: 'passed', evidenceRefs: ['situation:' + receipt.sourceRef.sessionKey + ':' + receipt.sourceRef.sequence, 'adoption:' + adoptionHash] },
      { id: 'situation.disclosure', status: 'passed', evidenceRefs: ['human-gm-reviewed:' + receipt.templateHash] },
    ], decisionAuthority: { kind: 'human-gm-disclosure', sourceRef: receipt.sourceRef } })
}
