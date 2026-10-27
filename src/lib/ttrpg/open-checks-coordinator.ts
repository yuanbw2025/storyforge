import type { TtrpgOpenOperationResumeV1 } from './runtime-commands'
import { currentTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectReviewCurrentV1 } from './open-pressure-effect'
/** Explicit bounded terminal/gate continuation. Read status never executes a recovery. */
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { stopTtrpgOpenOperationGateRecoveryV1 } from './runtime-commands'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { evaluateTtrpgOpenTerminalV1, ttrpgOpenGateBasisJsonV1, ttrpgOpenGateHumanActorsV1 } from './open-terminal-gates'
import { evaluateTtrpgOpenOperationTerminalV1, evaluateTtrpgOpenOperationGatesV1, advanceTtrpgOpenStageClosureV1, applyTtrpgOpenStageEffectV1, completeTtrpgOpenOperationStepV1, ttrpgOpenOperationCommandIdV1 } from './runtime-commands'
export async function resumeTtrpgOpenChecksV1(input: TtrpgOpenOperationResumeV1) {
  for (let attempt = 0; attempt < 2001; attempt++) {
    const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, operation = run?.operations.find(o => o.operationKey === input.operationKey)
    if (!runtime || !run || !operation || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg-checks] 当前操作或冻结计划不存在')
    if (run.gateRecoveries?.some(r => r.operationKey === operation.operationKey && r.stoppedRef)) return { status: 'gate-recovery-stopped', nextStepKey: 'gates' }
    const step = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing' || !step || !['terminal', 'gates'].includes(step.kind)) return { status: operation.status, nextStepKey: step?.stepKey ?? null }
    const version = await readProductRuntimeStateVersion(input.sessionId)
    const envelope = async (key: string) => ({ ...input, commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, key), baseSequence: version.sequence, baseStateHash: version.stateHash })
    if (operation.businessRefs.some(r => r.stepKey === step.stepKey)) {
      await completeTtrpgOpenOperationStepV1({ ...await envelope(`${step.stepKey}.receipt`), stepKey: step.stepKey }); continue
    }
    if (step.kind === 'terminal') { await evaluateTtrpgOpenOperationTerminalV1(await envelope('terminal')); continue }
    const rule = run.ruleReceipts.find(r => r.operationKey === operation.operationKey)!, logical = ttrpgOpenPressureRuleSourceV1(rule)
    const terminal = run.terminalReceipts?.find(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical))
    if (!terminal) throw new Error('[ttrpg-checks] 四门缺少真实终态回执')
    const decision = evaluateTtrpgOpenTerminalV1(state, terminal.frozenContent)
    if (decision.status === 'closure-available' || decision.status === 'maximum-reached') return { status: 'awaiting-stage-closure', nextStepKey: 'gates', terminalStatus: decision.status }
    const closure = run.stageClosures?.find(c => sameTtrpgOpenPressureSourceV1(c.ruleSourceRef, logical))
    if (closure && !closure.completedRef) {
      const work = closure.work.find(w => !w.completedRef)
      if (work) {
        const review = currentTtrpgOpenPressureEffectReviewV1(work)
        if (review?.status !== 'approved' || !ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, operation.authorizationEpochKey, review)) return { status: 'awaiting-stage-consequence', nextStepKey: 'gates' }
        await applyTtrpgOpenStageEffectV1({ ...await envelope(`stage.work.${work.workKey}.${review.reviewKey}.apply`), cycleKey: closure.cycleKey, workKey: work.workKey, reviewKey: review.reviewKey })
      } else {
        const tick = closure.ticks.find(t => !t.completedRef)
        await advanceTtrpgOpenStageClosureV1({ ...await envelope(tick ? `stage.clock.${tick.clockKey}` : 'stage.settled'), cycleKey: closure.cycleKey })
      }
      continue
    }
    const humans = ttrpgOpenGateHumanActorsV1(runtime), basis = ttrpgOpenGateBasisJsonV1(state)
    if (!humans.length) return { status: 'awaiting-human-response', nextStepKey: 'gates' }
    const pending = humans.find(h => !run.gateReceipts?.some(r => r.actorKey === h.actorKey && r.viewerKey === h.viewerKey && r.authorizationEpochKey === operation.authorizationEpochKey
      && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical) && r.evaluationBasisJson === basis))
    if (pending) {
      const count = run.gateReceipts?.filter(r => r.actorKey === pending.actorKey && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical)).length ?? 0
      await evaluateTtrpgOpenOperationGatesV1({ ...await envelope(`gates.${pending.actorKey}.${count}`), actorKey: pending.actorKey }); continue
    }
    const failed = humans.filter(h => !run.gateReceipts!.some(r => r.actorKey === h.actorKey && r.authorizationEpochKey === operation.authorizationEpochKey
      && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical) && r.evaluationBasisJson === basis && r.result.allApplicablePassed))
    if (failed.length) {
      if (run.gateRecoveries?.some(r => r.operationKey === operation.operationKey && r.authorizationEpochKey === operation.authorizationEpochKey)) {
        await stopTtrpgOpenOperationGateRecoveryV1(await envelope('gates.recovery.stop'))
        return { status: 'gate-recovery-stopped', nextStepKey: 'gates' }
      }
      return { status: 'awaiting-gate-recovery', nextStepKey: 'gates' }
    }
    await evaluateTtrpgOpenOperationGatesV1({ ...await envelope('gates.settled'), actorKey: null })
  }
  throw new Error('[ttrpg-checks] 运行检查超过真实席位有界上限')
}
