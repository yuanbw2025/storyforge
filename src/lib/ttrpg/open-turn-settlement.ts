/** Pure identity for each paid turn's actual owner checkpoint. */
import type { TtrpgOpenOperationV1 } from './open-operation'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
export type TtrpgOpenTurnOwnerV1 = 'pressure' | 'situations'
export function ttrpgOpenTurnOwnerStepV1(operation: TtrpgOpenOperationV1,owner: TtrpgOpenTurnOwnerV1): string {
  const step = operation.plannedSteps[operation.receipts.length]
  if (!step || step.kind !== owner) throw new Error('[ttrpg-turn] 当前不是所请求的逐轮 owner 步骤')
  return step.stepKey
}
export function ttrpgOpenTurnCycleMetadataV1(operation: TtrpgOpenOperationV1,owner: TtrpgOpenTurnOwnerV1) {
  return operation.settlementOrder ? { operationStepKey: ttrpgOpenTurnOwnerStepV1(operation,owner) } : {}
}
export function ttrpgOpenTurnCycleMatchesV1(cycle: { ruleSourceRef: TtrpgOpenSourceRefV1; operationStepKey?: string },operation: TtrpgOpenOperationV1,
  source: TtrpgOpenSourceRefV1,owner: TtrpgOpenTurnOwnerV1): boolean {
  const step = operation.plannedSteps[operation.receipts.length]
  return cycle.ruleSourceRef.sessionKey === source.sessionKey && cycle.ruleSourceRef.sequence === source.sequence
    && (!operation.settlementOrder ? cycle.operationStepKey === undefined : step?.kind === owner && cycle.operationStepKey === step.stepKey)
}
export function ttrpgOpenTurnCycleIdentityV1(cycle: { ruleSourceRef: TtrpgOpenSourceRefV1; operationStepKey?: string }): string {
  return JSON.stringify([cycle.ruleSourceRef.sessionKey,cycle.ruleSourceRef.sequence,cycle.operationStepKey ?? null])
}
