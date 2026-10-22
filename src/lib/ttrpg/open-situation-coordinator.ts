import type { TtrpgOpenOperationResumeV1 } from './runtime-commands'
import { ttrpgOpenTurnCycleMatchesV1 } from './open-turn-settlement'
import { currentTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectReviewCurrentV1 } from './open-pressure-effect'
import { ttrpgOpenSituationEffectWorkV1 } from './open-situation-cycle'
/** Explicit bounded maintenance; reload reads never authorize or execute a command. */
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { nextTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationCycleActionKeyV1 } from './open-situation-cycle'
import { advanceTtrpgOpenSituationsV1, applyTtrpgOpenSituationEffectV1, completeTtrpgOpenOperationStepV1, ttrpgOpenOperationCommandIdV1 } from './runtime-commands'
export async function resumeTtrpgOpenSituationsV1(input: TtrpgOpenOperationResumeV1) {
  for (let attempt = 0; attempt < 10001; attempt++) {
    const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), operation = runtime?.openRun?.operations.find(o => o.operationKey === input.operationKey)
    if (!runtime || !operation || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg-situation] 维护操作或冻结计划不存在')
    const next = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing' || next?.kind !== 'situations') return { status: operation.status, nextStepKey: next?.stepKey ?? null }
    const receipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey)!
    const cycle = runtime.openRun!.situationCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'situations'))
    const action = cycle && nextTtrpgOpenSituationCycleActionV1(state, cycle)
    const work = action?.kind === 'work' ? cycle!.work.find(w => w.workKey === action.workKey)! : null
    if (work?.kind === 'effect') {
      const review = currentTtrpgOpenPressureEffectReviewV1(ttrpgOpenSituationEffectWorkV1(work))
      if (review?.status === 'approved' && ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, operation.authorizationEpochKey, review)) {
        const version = await readProductRuntimeStateVersion(input.sessionId)
        await applyTtrpgOpenSituationEffectV1({ ...input, baseSequence: version.sequence, baseStateHash: version.stateHash, cycleKey: cycle!.cycleKey, workKey: work.workKey, reviewKey: review.reviewKey,
          commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, `situations.work.${work.workKey}.${review.reviewKey}.apply`) })
        continue
      }
    }
    if (work?.kind === 'effect') return { status: 'awaiting-consequence', nextStepKey: next.stepKey, workKeys: cycle!.work.filter(w => !w.completedRef).map(w => w.workKey) }
    const key = operation.businessRefs.some(r => r.stepKey === next.stepKey) ? `${next.stepKey}.receipt` : ttrpgOpenSituationCycleActionKeyV1(action ?? null, cycle,next.stepKey)
    const version = await readProductRuntimeStateVersion(input.sessionId), command = { ...input, ...version, baseSequence: version.sequence, baseStateHash: version.stateHash,
      commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, key) }
    if (key === `${next.stepKey}.receipt`) await completeTtrpgOpenOperationStepV1({ ...command, stepKey: next.stepKey })
    else await advanceTtrpgOpenSituationsV1(command)
  }
  throw new Error('[ttrpg-situation] 维护恢复超过有界上限')
}
