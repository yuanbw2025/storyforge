import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'
/** Restore the durable adoption receipt from a real committed narration; never re-send or re-write prose. */
import { db } from '../db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenKpCandidateProofV1 } from './open-kp-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { parseTtrpgOpenNarrationReceiptV1, isTtrpgOpenModelNarrationReceiptV1, type TtrpgOpenModelNarrationReceiptV1 } from './open-kp-receipt'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashCanonicalValue } from '../agent/run/hash'
export class TtrpgOpenKpReceiptPendingError extends Error {
  readonly code = 'kp-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number, cause: unknown) { super(`叙述已保存，终验回执尚未完成；请恢复回执。${cause instanceof Error ? cause.message : ''}`) }
}
export async function reconcileTtrpgOpenKpRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const { candidate } = await verifyTtrpgOpenKpCandidateProofV1(input), session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), row = runtime?.openRun?.narrations?.find((r): r is TtrpgOpenModelNarrationReceiptV1 => isTtrpgOpenModelNarrationReceiptV1(r) && r.requestKey === input.requestKey && r.candidateHash === input.candidateHash)
  if (!session || !row || row.sourceRef.sessionKey !== runtime!.sessionKey || stable(row.narration) !== stable(candidate.narration) || stable(row.binding) !== stable(candidate.binding)) throw new Error('[ttrpg-kp] 回执恢复缺少同候选真实已提交叙述')
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, row.sourceRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.narration.accepted' || stable(parseTtrpgOpenNarrationReceiptV1(JSON.parse(event.payloadJson).receipt)) !== stable(row)) throw new Error('[ttrpg-kp] 叙述回执没有实际原始事件')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(e => e.sequence <= event.sequence)), postStateHash = await hashProductRuntimeStateV1(state)
  const adoptionHash = await hashCanonicalValue({ receipt: row, commandId: event.commandId, postStateHash }), verifier = 'ttrpg-open-kp-v1'
  return finalizeTtrpgOpenRuntimeAdoptionV1(input, { candidate, event: { ...event, commandId: event.commandId, baseSequence: event.baseSequence },
    call: runtime!.openRun!.coordination.calls.find(call => call.requestKey === input.requestKey)!, adoptionHash, postStateHash, verifier,
    verificationSchema: 'storyforge.ttrpg-kp-verification',
    criteria: [{ id: 'kp.protocol', status: 'passed', evidenceRefs: [`candidate:${input.candidateHash}`, `raw:${candidate.rawResponseHash}`] },
      { id: 'kp.commit', status: 'passed', evidenceRefs: [`narration:${row.sourceRef.sessionKey}:${row.sourceRef.sequence}`, `adoption:${adoptionHash}`] },
      ...(row.hostingDelegationRef ? [{ id: 'kp.delegation', status: 'passed' as const, evidenceRefs: [`hosting:${row.hostingDelegationRef.sessionKey}:${row.hostingDelegationRef.sequence}`] }] : [])],
    ...(row.hostingDelegationRef ? { decisionAuthority: { kind: 'runtime-delegation', sourceRef: row.hostingDelegationRef } } : {}) })
}
