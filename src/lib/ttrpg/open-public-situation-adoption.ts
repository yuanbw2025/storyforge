/** One original human delegation permits deterministic AI-host adoption, never a human-review claim. */
import { db } from '../db/schema'
import type { ProductRuntimeSession, ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { verifyTtrpgOpenPublicSituationCandidateProofV1 } from './open-public-situation-candidate'
import { verifyTtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization-proof'
import { loadTtrpgOpenPublicSituationKernelV1 } from './open-public-situation-kernel'
import { reviewTtrpgOpenGeneratedSituationProposalV1 } from './open-generated-situation-contract'
import { parseTtrpgOpenSessionSituationReceiptV2, parseTtrpgOpenSituationArtifactRefsV1 } from './open-session-situation-contract'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { freezeTtrpgOpenRunOriginForExportV1, parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'

export type TtrpgOpenPublicSituationAdoptionInputV1 = TtrpgOpenCandidateReadV1 & {
  candidateHash: string; templateHash: string; authorizationBasisHash: string;
}
export async function prepareTtrpgOpenPublicSituationAdoptionV1(input: TtrpgOpenPublicSituationAdoptionInputV1, context: {
  state: ProductRuntimeState; session: ProductRuntimeSession; sequence: number; content: TtrpgRuntimeContentV2;
}) {
  const proof = await verifyTtrpgOpenPublicSituationCandidateProofV1(input), { candidate, epoch } = proof
  const grant = epoch.publicSituation
  if (!grant || grant.basisHash !== input.authorizationBasisHash || grant.run.runId !== input.runId
    || grant.basis.delegation.decision !== 'adopt-this-one-candidate') throw new Error('本次请求没有授权 AI 主持采用这一个共同候选')
  await verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: grant, phase: 'adopt' })
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg)!, run = runtime.openRun!, auth = runtime.authorization!
  const gm = auth.seats.find(row => row.role === 'gm'), seat = auth.seats.find(row => row.viewerKey === input.viewerKey)
  if (!gm || gm.controller !== 'ai' || !gm.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed || !seat
    || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || seat.seatKey !== epoch.triggeredBySeatKey
    || run.situationReceipts?.some(row => row.model.requestKey === input.requestKey)
    || candidate.runtimeSourceHash !== context.session.runtimeSourceHash || context.content.campaign.gmMode !== 'ai') throw new Error('本次共同局势采用需要当前 AI GM 和原真人主持的一次委托')
  const current = await loadTtrpgOpenPublicSituationKernelV1({ ...input, actorKey: 'gm' }, grant)
  if (stable(proof.loaded.state) !== stable(context.state) || current.visibilityHash !== candidate.visibilityHash
    || current.basis.mechanicalStateHash !== candidate.admissionStateHash) throw new Error('共同局势采用期间来源、授权或实际局面已变化')
  const review = await reviewTtrpgOpenGeneratedSituationProposalV1({ value: JSON.parse(proof.raw), basis: current.basis })
  const templateHash = await hash(review.proposal.template)
  if (!review.evaluation.accepted || stable(review) !== stable(candidate.review) || templateHash !== input.templateHash) throw new Error('共同局势未通过当前完整预检或不是原精确候选')
  const runOriginJson = await freezeTtrpgOpenRunOriginForExportV1(input.runId, { contractHash: proof.run.run.contractHash, lastSequence: proof.run.run.lastSequence })
  if (!runOriginJson) throw new Error('共同局势采用缺少原始 Run 的可保留证据')
  const origin = await parseTtrpgOpenRunOriginV1(runOriginJson)
  const artifactRefs = parseTtrpgOpenSituationArtifactRefsV1(origin.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    ? [{ artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }] : []))
  const body = { schema: 'storyforge.ttrpg-open-session-situation' as const, version: 2 as const,
    sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, authorizationRef: epoch.startedRef,
    runtimeSourceHash: context.session.runtimeSourceHash, acceptedAtWorldTurn: run.worldTime.worldTurn,
    template: review.proposal.template, templateHash, personalizationSourceKeys: review.proposal.personalizationSourceKeys, runOriginJson, artifactRefs,
    ...(current.basis.runtimeEntityReferences ? { runtimeEntityReferences: current.basis.runtimeEntityReferences } : {}),
    model: { requestKey: input.requestKey, epochKey: epoch.epochKey, runContractHash: proof.run.run.contractHash,
      candidateHash: candidate.candidateHash, rawResponseHash: candidate.rawResponseHash, inputManifestHash: candidate.inputManifestHash,
      contextHash: candidate.visibilityHash, basisHash: review.basisHash, proposalHash: review.proposalHash, referencesHash: await hash(candidate.references) },
    disclosure: { kind: 'ai-host-once-authorized' as const, scope: 'this-one-common-candidate' as const,
      viewerKey: input.viewerKey, seatKey: seat.seatKey, authorizationHash: epoch.authorizationHash, templateHash,
      gmSeatKey: gm.seatKey, gmSeatRevision: gm.revision, authorization: grant } }
  const receipt = parseTtrpgOpenSessionSituationReceiptV2({ ...body, receiptHash: await hash(body) })
  await verifyTtrpgOpenSessionSituationHashesV1([receipt])
  await proof.loaded.assertCurrent()
  return { actorKey: 'gm', targetKey: receipt.template.templateKey, payload: { receipt, frozenContent: context.content }, agentEvidence: proof.evidence }
}

/** The actual domain receipt wins even if safety changes or its original window closes afterwards. */
export async function reconcileTtrpgOpenPublicSituationRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const proof = await verifyTtrpgOpenPublicSituationCandidateProofV1(input), candidate = proof.candidate
  const session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const receipt = runtime?.openRun?.situationReceipts?.find(row => row.model.requestKey === input.requestKey && row.model.candidateHash === input.candidateHash)
  if (!session || receipt?.version !== 2 || receipt.sourceRef.sessionKey !== runtime!.sessionKey
    || receipt.disclosure.viewerKey !== input.viewerKey || receipt.disclosure.authorization.run.runId !== input.runId
    || stable(receipt.template) !== stable(candidate.review!.proposal.template) || receipt.model.rawResponseHash !== candidate.rawResponseHash
    || receipt.model.referencesHash !== await hash(candidate.references) || receipt.model.proposalHash !== candidate.review!.proposalHash) throw new Error('共同局势终验缺少原本地候选实际已提交的本次采用回执')
  await verifyTtrpgOpenSessionSituationHashesV1([receipt])
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, receipt.sourceRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.situation.accepted'
    || stable(parseTtrpgOpenSessionSituationReceiptV2(JSON.parse(event.payloadJson).receipt)) !== stable(receipt)) throw new Error('共同局势终验缺少准确的原采用事件')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(row => row.sequence <= event.sequence))
  const postStateHash = await hashProductRuntimeStateV1(state), adoptionHash = await hash({ receipt, commandId: event.commandId, postStateHash })
  return finalizeTtrpgOpenRuntimeAdoptionV1(input, { candidate, call: proof.call,
    event: { ...event, commandId: event.commandId, baseSequence: event.baseSequence }, adoptionHash, postStateHash,
    verifier: 'ttrpg-open-public-situation-propose-v2', verificationSchema: 'storyforge.ttrpg-public-situation-verification',
    criteria: [
      { id: 'public-situation.protocol', status: 'passed', evidenceRefs: ['candidate:' + input.candidateHash, 'raw:' + candidate.rawResponseHash] },
      { id: 'public-situation.commit', status: 'passed', evidenceRefs: ['situation:' + receipt.sourceRef.sessionKey + ':' + receipt.sourceRef.sequence, 'adoption:' + adoptionHash] },
      { id: 'public-situation.delegation', status: 'passed', evidenceRefs: ['ai-host-once-authorized:' + receipt.disclosure.authorization.basisHash, 'template:' + receipt.templateHash] },
    ], decisionAuthority: { kind: 'ai-host-once-authorized', sourceRef: receipt.sourceRef } })
}
