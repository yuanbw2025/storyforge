/** Pure operation identity readers shared by replay and live commands. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgOpenEntityPlan } from './open-entity-contract'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { fail } from './open-contract-parse'
export function ttrpgOpenEntityOperationBasisV1(state: ProductRuntimeState, operationKey: string, planHash: string) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  const operation = run?.entityOperations?.find(row => row.plan.operationKey === operationKey)
  if (!runtime || !run || !auth || !operation || operation.plan.planHash !== planHash) return fail('实体原计划不存在或版本已变化')
  return { runtime, run, auth, operation, plan: operation.plan }
}
export function assertTtrpgOpenEntityPlanEnvelopeV1(plan: TtrpgOpenEntityPlan, input: { sequence: number; sessionKey: string; viewerKey: string; commandId: string }) {
  if (plan.proposedRef.sessionKey !== input.sessionKey || plan.proposedRef.sequence !== input.sequence || plan.viewerKey !== input.viewerKey || plan.rootCommandId !== input.commandId) fail('实体计划没有真实原事件身份')
}
