/** Repair only the actual committed model memory's terminal receipt; never re-send or duplicate its row. */
import { db } from '../db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenBriefCandidateProofV1 } from './open-brief-candidate'
import { parseTtrpgOpenModelMemoryReceiptV2, type TtrpgOpenModelMemoryReceiptV2 } from './open-model-memory-contract'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashCanonicalValue } from '../agent/run/hash'
import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'

export class TtrpgOpenBriefMemoryReceiptPendingError extends Error {
  readonly code = 'brief-memory-committed-receipt-pending'
  constructor(readonly sessionId: number, readonly eventSequence: number, readonly runId: number, cause: unknown) {
    super(`复盘记忆已保存，终验回执尚未完成；请恢复回执。${cause instanceof Error ? cause.message : ''}`)
  }
}
export async function reconcileTtrpgOpenBriefMemoryRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const { candidate } = await verifyTtrpgOpenBriefCandidateProofV1(input)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const session = loaded.session, runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const row = runtime?.openRun?.memoryReceipts?.find((receipt): receipt is TtrpgOpenModelMemoryReceiptV2 => receipt.version === 2
    && receipt.model.requestKey === input.requestKey && receipt.model.candidateHash === input.candidateHash)
  if (!row || row.sourceRef.sessionKey !== runtime!.sessionKey || row.viewerKey !== input.viewerKey
    || stable(row.model.brief) !== stable(candidate.brief) || stable(row.model.attributions) !== stable(candidate.attributions)
    || row.model.rawResponseHash !== candidate.rawResponseHash || row.model.contextHash !== candidate.visibilityHash) throw new Error('[ttrpg-brief] 终验缺少同候选已提交的模型记忆')
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, row.sourceRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.memory.recorded'
    || stable(parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(event.payloadJson).memory)) !== stable(row)) throw new Error('[ttrpg-brief] 记忆回执没有实际原始事件')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(e => e.sequence <= event.sequence))
  const postStateHash = await hashProductRuntimeStateV1(state), adoptionHash = await hashCanonicalValue({ receipt: row, commandId: event.commandId, postStateHash })
  await loaded.assertCurrent()
  return finalizeTtrpgOpenRuntimeAdoptionV1(input, { candidate, event: { ...event, commandId: event.commandId, baseSequence: event.baseSequence },
    call: runtime!.openRun!.coordination.calls.find(call => call.requestKey === input.requestKey)!, adoptionHash, postStateHash, verifier: 'ttrpg-open-brief-v1',
    verificationSchema: 'storyforge.ttrpg-brief-verification', criteria: [
      { id: 'brief.protocol', status: 'passed', evidenceRefs: [`candidate:${input.candidateHash}`, `raw:${candidate.rawResponseHash}`] },
      { id: 'brief.commit', status: 'passed', evidenceRefs: [`memory:${row.sourceRef.sessionKey}:${row.sourceRef.sequence}`, `adoption:${adoptionHash}`] },
    ] })
}
