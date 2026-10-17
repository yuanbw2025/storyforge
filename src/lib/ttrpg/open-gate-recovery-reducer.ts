import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenGateRecoveryV1, settleTtrpgOpenGateRecoveryV1, stopTtrpgOpenGateRecoveryV1 } from './open-gate-recovery'
import * as p from './open-contract-parse'
export function applyTtrpgOpenGateRecoveryEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.gates.recovered','ttrpg.open.gates.recovery-stopped'].includes(event.type)) return false
  p.exact(payload,['operationKey','frozenPlanHash','receipt','intent'],'gate recovery event')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, receipt = parseTtrpgOpenGateRecoveryV1(payload.receipt)
  const stopping = event.type === 'ttrpg.open.gates.recovery-stopped'
  const intent = p.record(payload.intent,['operationKey','frozenPlanHash','viewerKey',...(stopping ? [] : ['evaluationRef','evaluationBasisHash','gateKey','actorKey'])],'gate recovery intent')
  const seat = runtime.authorization?.seats.find(s => s.viewerKey === intent.viewerKey)
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || event.actorKey !== seat.actorKey
    || intent.operationKey !== payload.operationKey || intent.frozenPlanHash !== payload.frozenPlanHash
    || receipt.operationKey !== payload.operationKey || receipt.frozenPlanHash !== payload.frozenPlanHash || event.targetKey !== receipt.actorKey) p.fail('恢复必须来自真实真人与冻结操作')
  if (!stopping && (stable(intent.evaluationRef) !== stable(receipt.evaluationRef) || intent.evaluationBasisHash !== receipt.evaluationBasisHash || intent.gateKey !== receipt.gateKey || intent.actorKey !== receipt.actorKey)) p.fail('修复不是该次真实失败评估')
  const settled = stopping ? stopTtrpgOpenGateRecoveryV1({ state,operationKey: receipt.operationKey,viewerKey: p.key(intent.viewerKey,'stop viewer'),sequence: event.sequence })
    : settleTtrpgOpenGateRecoveryV1({ state,operationKey: receipt.operationKey,viewerKey: p.key(intent.viewerKey,'recovery viewer'),sequence: event.sequence,recoveryKey: receipt.recoveryKey,publicFieldsHash: receipt.publicFieldsHash })
  if (stable(settled.receipt) !== stable(receipt)) p.fail('恢复回执不是实际冻结队列/证据/停止结果')
  state.ttrpg = settled.runtime
  return true
}
