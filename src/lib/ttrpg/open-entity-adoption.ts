/** A human may adopt one exact model candidate as a pending plan. F13 still needs every affected approval. */
import type { ProductRuntimeSession, ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { verifyTtrpgOpenEntityCandidateProofV1 } from './open-entity-candidate'
import { loadTtrpgOpenEntityContextV1 } from './open-entity-context'
import { createTtrpgOpenEntityPlanV2 } from './open-entity-plan'
import { parseTtrpgOpenEntityPlanV2 } from './open-entity-contract'
import { parseTtrpgOpenEntityArtifactRefsV1 } from './open-entity-model-origin-contract'
import { verifyTtrpgOpenEntityPlanHashesV1 } from './open-entity-proof'
import { freezeTtrpgOpenRunOriginForExportV1, parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { canonicalStringify as stable, hashCanonicalValue as hash } from '../agent/run/hash'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'
import { db } from '../db/schema'

export type TtrpgOpenEntityAdoptionInputV1 = TtrpgOpenCandidateReadV1 & {
  candidateHash: string; decision: 'reviewed-this-model-entity-candidate';
}
export class TtrpgOpenEntityReceiptPendingError extends Error {
  readonly code = 'entity-plan-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number) {
    super('实体待确认计划已保存，原模型采用回执尚待补齐；无需再次生成或采用，尚未创建实体。')
  }
}
export async function prepareTtrpgOpenEntityAdoptionV1(input: TtrpgOpenEntityAdoptionInputV1, context: {
  state: ProductRuntimeState; session: ProductRuntimeSession; sequence: number; content: TtrpgRuntimeContentV2; commandId: string;
}) {
  if (input.decision !== 'reviewed-this-model-entity-candidate') throw new Error('请明确审阅原模型实体候选。')
  const proof = await verifyTtrpgOpenEntityCandidateProofV1(input), { candidate, loaded, call, epoch } = proof
  const run = loaded.runtime.openRun!, current = await loadTtrpgOpenEntityContextV1({ ...input, actorKey: 'gm' })
  if (!epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== input.viewerKey
    || stable(loaded.state) !== stable(context.state) || current.visibilityHash !== candidate.visibilityHash
    || current.admissionStateHash !== candidate.admissionStateHash || candidate.runtimeSourceHash !== context.session.runtimeSourceHash
    || run.entityOperations?.some(row => row.plan.version === 2 && row.plan.modelOrigin.call.requestKey === input.requestKey)) throw new Error('实体采用的原窗口、来源、机械状态或授权已经变化。')
  const runOriginJson = await freezeTtrpgOpenRunOriginForExportV1(input.runId, { contractHash: proof.snapshot.run.contractHash, lastSequence: proof.snapshot.run.lastSequence })
  if (!runOriginJson) throw new Error('实体采用缺少可保留的原 Run 证据。')
  const origin = await parseTtrpgOpenRunOriginV1(runOriginJson)
  const plan = await createTtrpgOpenEntityPlanV2({ ...context, runtimeSourceHash: context.session.runtimeSourceHash,
    viewerKey: input.viewerKey, oracleSourceRef: candidate.selection.oracleSourceRef, proposals: candidate.proposals!, previousOperations: run.entityOperations ?? [] }, {
    schema: 'storyforge.ttrpg-open-entity-model-origin', version: 1, call, candidateHash: candidate.candidateHash, runOriginJson,
    artifactRefs: parseTtrpgOpenEntityArtifactRefsV1(origin.events.flatMap(e => e.type === 'evidence.artifact.recorded'
      ? [{ artifactKind: e.payload.artifactKind, contentHash: e.payload.contentHash }] : [])) })
  await verifyTtrpgOpenEntityPlanHashesV1([{ plan, approvals: [], resolution: null }], context.content)
  await loaded.assertCurrent()
  return { actorKey: loaded.seat!.actorKey ?? 'gm', targetKey: plan.operationKey, payload: { plan }, agentEvidence: proof.evidence }
}
/** The committed domain event wins after pause, disposal or window close. Repair never re-adopts or creates. */
export async function reconcileTtrpgOpenEntityRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const proof = await verifyTtrpgOpenEntityCandidateProofV1(input)
  const session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const operation = runtime?.openRun?.entityOperations?.find(row => row.plan.version === 2
    && row.plan.modelOrigin.call.requestKey === input.requestKey && row.plan.modelOrigin.candidateHash === input.candidateHash)
  if (!session || operation?.plan.version !== 2 || operation.plan.proposedRef.sessionKey !== runtime!.sessionKey
    || operation.plan.viewerKey !== input.viewerKey || stable(operation.plan.modelOrigin.call) !== stable(proof.call)
    || stable(operation.plan.items.map(row => row.proposal)) !== stable(proof.candidate.proposals)) throw new Error('实体采用终验缺少准确原本地候选的实际待确认计划。')
  const plan = operation.plan
  await verifyTtrpgOpenEntityPlanHashesV1([operation])
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, plan.proposedRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.entity.model-proposed'
    || stable(parseTtrpgOpenEntityPlanV2(JSON.parse(event.payloadJson).plan)) !== stable(plan)) throw new Error('实体采用终验缺少准确原领域事件。')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(row => row.sequence <= event.sequence))
  const postStateHash = await hashProductRuntimeStateV1(state), adoptionHash = await hash({ plan, commandId: event.commandId, postStateHash })
  return finalizeTtrpgOpenRuntimeAdoptionV1(input, { candidate: proof.candidate, call: proof.call,
    event: { ...event, commandId: event.commandId, baseSequence: event.baseSequence }, adoptionHash, postStateHash,
    verifier: 'ttrpg-open-entity-plan-v2', verificationSchema: 'storyforge.ttrpg-entity-plan-verification',
    criteria: [
      { id: 'entity.protocol', status: 'passed', evidenceRefs: ['candidate:' + input.candidateHash, 'raw:' + proof.candidate.rawResponseHash] },
      { id: 'entity.plan', status: 'passed', evidenceRefs: ['pending-plan:' + plan.planHash, 'adoption:' + adoptionHash] },
      { id: 'entity.authority', status: 'passed', evidenceRefs: ['human-reviewed-model-candidate:' + plan.viewerKey, 'scope:' + proof.candidate.selection.scope.scopeKey, 'creation-still-requires-all-approvals'] },
    ], decisionAuthority: { kind: 'human-reviewed-model-entity-plan', sourceRef: plan.proposedRef } })
}
