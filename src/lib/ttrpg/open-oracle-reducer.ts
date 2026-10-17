import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenOracleReceiptV1, assertTtrpgOpenOracleCallerV1 } from './open-oracle-contract'
import * as p from './open-contract-parse'

export function applyTtrpgOpenOracleEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.oracle.consulted') return false
  p.exact(payload, ['receipt', 'intent'], 'oracle consulted')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, authorization = runtime?.authorization
  if (!runtime || !run || !authorization) p.fail('Oracle 需要已启动且授权的团局')
  const receipt = parseTtrpgOpenOracleReceiptV1(payload.receipt)
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === receipt.authorizationEpochKey)
  const previous = [...(run.oracleReceipts ?? [])].reverse().find(previous => previous.resolution.outcome.oracleKey === receipt.resolution.outcome.oracleKey)
  const actorKey = assertTtrpgOpenOracleCallerV1({ authorization, viewerKey: receipt.viewerKey,
    askedBy: receipt.resolution.outcome.askedBy, audience: receipt.audience })
  const intent = p.record(payload.intent, ['viewerKey', 'askedBy', 'oracleKey', 'question', 'likelihoodTierKey'], 'oracle intent')
  const table = receipt.frozenRulePack.oracles.find(table => table.oracleKey === receipt.resolution.outcome.oracleKey)!
  if (!epoch || epoch.status !== 'active' || isTtrpgOpenPassiveEpochV1(epoch) || run.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== receipt.viewerKey
    || run.stage.status !== 'open' || runtime.product.safety.status !== 'active' || run.consultedThisWorldTurn >= 2
    || run.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))
    || runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))
    || event.actorKey !== actorKey || event.targetKey !== null || receipt.sourceRef.sessionKey !== runtime.sessionKey || receipt.sourceRef.sequence !== event.sequence
    || receipt.resolution.rollReceipt.commandId !== event.commandId || receipt.worldTurn !== run.worldTime.worldTurn
    || receipt.resolution.rollReceipt.rulePackContentHash !== runtime.product.rulePackContentHash
    || receipt.resolution.outcome.chaosValueAtRoll !== (table.chaosCoupled ? run.chaos.value : null)
    || stable(receipt.previousOracleRef) !== stable(previous?.sourceRef ?? null)
    || intent.viewerKey !== receipt.viewerKey || intent.askedBy !== receipt.resolution.outcome.askedBy
    || intent.oracleKey !== receipt.resolution.outcome.oracleKey || intent.question !== receipt.resolution.outcome.question
    || (intent.likelihoodTierKey !== null && intent.likelihoodTierKey !== receipt.resolution.outcome.likelihoodTierKey)) p.fail('Oracle 活动窗口、预算、来源或真实原始结果不一致')
  run.oracleReceipts = [...(run.oracleReceipts ?? []), receipt]
  run.consultedThisWorldTurn += 1
  state.ttrpg = runtime
  return true
}
