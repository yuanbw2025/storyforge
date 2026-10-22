import type { TtrpgOpenOperationResumeV1 } from './runtime-commands'
import { ttrpgOpenTurnCycleMatchesV1 } from './open-turn-settlement'
import { currentTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectReviewCurrentV1 } from './open-pressure-effect'
/** Bounded, explicit pressure continuation. Old mandatory downstream owners remain visible. */
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { advanceTtrpgOpenPressureV1, applyTtrpgOpenPressureEffectV1, completeTtrpgOpenPressureSituationV1, ttrpgOpenOperationCommandIdV1, completeTtrpgOpenOperationStepV1 } from './runtime-commands'
import { nextTtrpgOpenPressureActionV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { pressureActionKeyV1 } from './open-pressure-reducer'
export async function resumeTtrpgOpenPressureV1(input: TtrpgOpenOperationResumeV1) {
  for (let attempt = 0; attempt < 20001; attempt++) {
    const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
    const operation = runtime?.openRun?.operations.find(o => o.operationKey === input.operationKey)
    if (!runtime || !operation || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg-pressure] 压力操作或冻结计划不存在')
    const next = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing' || next?.kind !== 'pressure') return { status: operation.status, nextStepKey: next?.stepKey ?? null }
    const receipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey)!
    const cycle = runtime.openRun!.pressureCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure'))
    const pending = cycle?.work.find(w => !w.completedRef)
    if (pending) {
      if (pending.situationTemplateKey) {
        const version = await readProductRuntimeStateVersion(input.sessionId)
        await completeTtrpgOpenPressureSituationV1({ ...input, cycleKey: cycle!.cycleKey, workKey: pending.workKey,
          commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, `pressure.work.${pending.workKey}.situation`),
          baseSequence: version.sequence, baseStateHash: version.stateHash })
        continue
      }
      const review = currentTtrpgOpenPressureEffectReviewV1(pending)
      if (pending.templateKey && review?.status === 'approved' && ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, operation.authorizationEpochKey, review)) {
        const version = await readProductRuntimeStateVersion(input.sessionId)
        await applyTtrpgOpenPressureEffectV1({ ...input, cycleKey: cycle!.cycleKey, workKey: pending.workKey, reviewKey: review.reviewKey,
          commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, `pressure.work.${pending.workKey}.${review.reviewKey}.apply`),
          baseSequence: version.sequence, baseStateHash: version.stateHash })
        continue
      }
      return { status: 'awaiting-consequence', workKeys: cycle!.work.filter(w => !w.completedRef).map(w => w.workKey), nextStepKey: next.stepKey }
    }
    const action = cycle && nextTtrpgOpenPressureActionV1(state, cycle)
    const key = operation.businessRefs.some(r => r.stepKey === next.stepKey) ? `${next.stepKey}.receipt` : !cycle ? `${next.stepKey}.plan` : action ? pressureActionKeyV1(action,next.stepKey) : `${next.stepKey}.settled`
    const version = await readProductRuntimeStateVersion(input.sessionId)
    const command = { ...input, commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, key), baseSequence: version.sequence, baseStateHash: version.stateHash }
    if (key === `${next.stepKey}.receipt`) await completeTtrpgOpenOperationStepV1({ ...command, stepKey: next.stepKey })
    else await advanceTtrpgOpenPressureV1(command)
  }
  throw new Error('[ttrpg-pressure] 压力恢复超过冻结内容的有界上限')
}
