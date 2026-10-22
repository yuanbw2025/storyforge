/** Deterministic next-speaker offer. It neither sends a request nor renews an epoch. */
import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
const KINDS = ['companion-ready', 'human', 'budget', 'model-recovery', 'paused', 'stage-closed', 'branch-recovery'] as const
export interface TtrpgOpenHandoffV1 { sourceRef: TtrpgOpenSourceRefV1; decision: { kind: typeof KINDS[number]; actorKey: string | null } }
export function parseTtrpgOpenHandoffV1(value: unknown): TtrpgOpenHandoffV1 {
  const r = p.record(value, ['sourceRef', 'decision'], 'handoff'), d = p.record(r.decision, ['kind', 'actorKey'], 'next speaker')
  const kind = p.oneOf(d.kind, KINDS, 'handoff kind'), actorKey = p.nullable(d.actorKey, p.key, 'next actor')
  if ((kind === 'companion-ready') !== (actorKey !== null)) p.fail('只有队友待行动可包含下一角色')
  return { sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), decision: { kind, actorKey } }
}
export function evaluateTtrpgOpenHandoffV1(state: ProductRuntimeState, operationKey: string): TtrpgOpenHandoffV1['decision'] {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  const operation = run?.operations.find(o => o.operationKey === operationKey), epoch = run?.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey)
  if (!runtime || !run || !auth || !operation || !epoch) return p.fail('交接需要真实操作与授权窗口')
  const stop = (kind: TtrpgOpenHandoffV1['decision']['kind']): TtrpgOpenHandoffV1['decision'] => ({ kind, actorKey: null })
  if (runtime.product.safety.status !== 'active') return stop('paused')
  if (run.stage.status !== 'open') return stop('stage-closed')
  if (runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))) return stop('branch-recovery')
  if (epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey || epoch.stopReason) return stop('human')
  const budget = ttrpgOpenCallBudgetV1(epoch, run.coordination.calls)
  if (budget.blockedByUnknown || budget.blockedByDenial || budget.pending) return stop('model-recovery')
  if (epoch.successfulActorKeys.length >= epoch.budget.maximumAiActions || budget.countedRequests + 2 > epoch.budget.maximumCalls
    || budget.committedOrReservedTokens >= epoch.budget.maximumTokens || budget.committedOrReservedCostUsd >= epoch.budget.maximumCostUsd) return stop('budget')
  // A previous proposal, even a failed one, is not silently retried or impersonated.
  const seat = auth.selectedActorKeys.map(key => auth.seats.find(s => s.actorKey === key)).find(s => s?.controller === 'ai' && s.consent.aiAdviceAllowed && state.entities[s.actorKey!]?.lifecycleStatus === 'active'
    && !epoch.successfulActorKeys.includes(s.actorKey!) && !run.coordination.calls.some(c => c.authorizationEpochKey === epoch.epochKey && c.actorKey === s.actorKey && c.skillId === 'prose.ttrpg-open-companion'))
  return seat?.actorKey ? { kind: 'companion-ready', actorKey: seat.actorKey } : stop('human')
}
export function applyTtrpgOpenHandoffEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.handoff.offered') return false
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'handoff', 'intent'], 'handoff event')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun
  const operation = run?.operations.find(o => o.operationKey === payload.operationKey), epoch = run?.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey'], 'handoff caller'), handoff = parseTtrpgOpenHandoffV1(payload.handoff)
  if (!runtime || !run || !operation || !epoch || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'handoff'
    || operation.handoff || operation.businessRefs.some(r => r.stepKey === 'handoff') || operation.planHash !== payload.frozenPlanHash
    || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash || intent.viewerKey !== epoch.viewerKey || epoch.status !== 'active'
    || run.coordination.activeEpochKey !== epoch.epochKey || event.actorKey !== 'gm' || event.targetKey !== null
    || handoff.sourceRef.sessionKey !== runtime.sessionKey || handoff.sourceRef.sequence !== event.sequence
    || stable(handoff.decision) !== stable(evaluateTtrpgOpenHandoffV1(state, operation.operationKey))) p.fail('交接不是当前实际结算、真人窗口与硬预算的派生结果')
  state.ttrpg = runtime;operation.handoff = handoff;operation.businessRefs.push({ stepKey: 'handoff', sourceRef: handoff.sourceRef })
  return true
}
