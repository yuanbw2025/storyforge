/** Generation ends at a proven proposal admission, independently of later risk and settlement. */
import { db } from '../db/schema'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents,hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenIntentCandidateProofV1 } from './open-intent-candidate'
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { parseTtrpgOpenOperationV1,assertTtrpgOpenOperationIntentCallV1 } from './open-operation'
import { finalizeTtrpgOpenRuntimeAdoptionV1 } from './open-runtime-adoption'
import { hashCanonicalValue } from '../agent/run/hash'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1 } from './open-authorization'
import { hashTtrpgOpenIntentClarificationV1 } from './open-intent-clarification-contract'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'

export class TtrpgOpenIntentReceiptPendingError extends Error {
  readonly code = 'intent-committed-receipt-pending'
  constructor(readonly sessionId: number,readonly eventSequence: number,readonly runId: number,readonly cause: unknown) {
    super('行动提案已保存，生成任务的终验回执尚未完成；请补齐原回执。')
  }
}
export async function reconcileTtrpgOpenIntentRunV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }): Promise<string> {
  const { candidate } = await verifyTtrpgOpenIntentCandidateProofV1(input),session = await db.productRuntimeSessions.get(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg),run = runtime?.openRun,auth = runtime?.authorization
  const call = run?.coordination.calls.find(c => c.requestKey === input.requestKey),epoch = run?.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)
  const matches = run?.operations.filter(o => o.intentEvidence?.runContractHash === call?.runContractHash) ?? [],operation = matches[0]
  if (!session || !runtime || !auth || !call || !epoch || epoch.viewerKey !== input.viewerKey || matches.length !== 1
    || !operation?.intentEvidence || operation.inheritance || operation.startedRef.sessionKey !== runtime.sessionKey
    || operation.intentEvidence.candidateHash !== input.candidateHash || operation.intentEvidence.rawResponseHash !== candidate.rawResponseHash
    || operation.intentEvidence.inputManifestHash !== candidate.inputManifestHash || operation.authorizationEpochKey !== candidate.epochKey
    || operation.plan.request.actorKey !== candidate.actorKey) throw Error('原行动提案缺少同候选、角色、窗口和团局的真实准入事件')
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: auth,participants: await readTtrpgSessionParticipantsV2(input.sessionId),viewerKey: input.viewerKey })
  assertTtrpgOpenOperationIntentCallV1(operation,run!.coordination.calls)
  for (const entry of call.intentClarifications ?? []) if (entry.candidateHash !== candidate.candidateHash
    || entry.threadKey !== candidate.intent!.clarificationThreadKey || entry.viewerKey !== input.viewerKey
    || await hashTtrpgOpenIntentClarificationV1(entry) !== entry.clarificationHash) throw Error('原人工补充的版本或完整字节已变化')
  const event = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId,operation.startedRef.sequence]).first()
  if (!event || typeof event.commandId !== 'string' || typeof event.baseSequence !== 'number' || event.type !== 'ttrpg.open.operation.started'
    || event.commandId !== operation.rootCommandId || event.actorKey !== candidate.actorKey || event.targetKey !== operation.plan.request.targetKey) throw Error('行动提案回执没有原始准入事件')
  const payload = JSON.parse(event.payloadJson),admission = parseTtrpgOpenOperationV1(payload.operation,runtime.sessionKey)
  if (admission.operationKey !== operation.operationKey || admission.planHash !== operation.planHash || admission.riskHash !== operation.riskHash
    || stable(admission.intentEvidence) !== stable(operation.intentEvidence) || stable(admission.plan) !== stable(operation.plan)
    || admission.status !== 'awaiting-approval' || payload.intent?.viewerKey !== input.viewerKey || payload.intent?.requestKey !== input.requestKey
    || payload.intent?.clarificationHash !== admission.intentEvidence?.clarificationRef?.clarificationHash
    || await hashProductProductionValueV2(admission.plan) !== admission.planHash) throw Error('保存的准入计划、原候选或来源证据不一致')
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  const prefix = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson),events.filter(e => e.sequence < event.sequence))
  if (await ttrpgOpenMechanicalStateHashV1(prefix) !== candidate.admissionStateHash
    || admission.plan.mechanicalStateHash !== candidate.admissionStateHash) throw Error('原提案不属于准入当时的准确机械状态')
  const state = replayProductRuntimeEvents(prefix,[event])
  const replayed = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun?.operations.find(o => o.operationKey === admission.operationKey)
  if (stable(replayed) !== stable(admission)) throw Error('原准入事件不能回放成准确的待批准提案')
  const postStateHash = await hashProductRuntimeStateV1(state),adoptionHash = await hashCanonicalValue({ admission,commandId: event.commandId,postStateHash })
  const delegation = admission.intentEvidence!.hostingDelegationRef
  return finalizeTtrpgOpenRuntimeAdoptionV1(input,{ candidate,call,event: { ...event,commandId: event.commandId,baseSequence: event.baseSequence },
    adoptionHash,postStateHash,verifier: 'ttrpg-open-intent-admission-v1',verificationSchema: 'storyforge.ttrpg-intent-admission-verification',
    decisionAuthority: delegation ? { kind: 'runtime-delegation',sourceRef: delegation } : { kind: 'human-intent-start',sourceRef: admission.startedRef },
    criteria: [{ id: 'intent.protocol',status: 'passed',evidenceRefs: [`candidate:${input.candidateHash}`,`raw:${candidate.rawResponseHash}`] },
      { id: 'intent.admission',status: 'passed',evidenceRefs: [`proposal:${runtime.sessionKey}:${event.sequence}`,`adoption:${adoptionHash}`] },
      ...(admission.intentEvidence!.clarificationRef ? [{ id: 'intent.clarification',status: 'passed' as const,evidenceRefs: [`clarification:${admission.intentEvidence!.clarificationRef.clarificationHash}`] }] : []),
      ...(delegation ? [{ id: 'intent.delegation',status: 'passed' as const,evidenceRefs: [`hosting:${delegation.sessionKey}:${delegation.sequence}`] }] : [])] })
}
