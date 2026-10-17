import type { TtrpgOpenOperationResumeV1 } from './runtime-commands'
/** Full deterministic settlement. Model generation and human decisions stay explicit stops. */
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { resumeTtrpgOpenOperationV1 } from './open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from './open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from './open-situation-coordinator'
import { resumeTtrpgOpenChecksV1 } from './open-checks-coordinator'
import { offerTtrpgOpenHandoffV1, ttrpgOpenOperationCommandIdV1 } from './runtime-commands'
export async function resumeTtrpgOpenPlayV1(input: TtrpgOpenOperationResumeV1) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
    const operation = runtime?.openRun?.operations.find(o => o.operationKey === input.operationKey)
    if (!runtime || !operation || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg-play] 恢复操作或冻结计划已变化')
    const step = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing') return { status: operation.status, nextStepKey: step?.stepKey ?? null, ...(operation.handoff ? { handoff: operation.handoff.decision } : {}) }
    if (runtime.product.safety.status !== 'active') return { status: 'paused', nextStepKey: step?.stepKey ?? null }
    if (step?.kind === 'narration' && !operation.businessRefs.some(r => r.stepKey === step.stepKey)) return { status: 'awaiting-narration', nextStepKey: step.stepKey }
    if (step?.kind === 'handoff' && !operation.businessRefs.some(r => r.stepKey === step.stepKey)) {
      const version = await readProductRuntimeStateVersion(input.sessionId)
      await offerTtrpgOpenHandoffV1({ ...input, commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, 'handoff'), baseSequence: version.sequence, baseStateHash: version.stateHash });continue
    }
    const result = step?.kind === 'pressure' ? await resumeTtrpgOpenPressureV1(input)
      : step?.kind === 'situations' ? await resumeTtrpgOpenSituationsV1(input)
      : step && ['terminal', 'gates'].includes(step.kind) ? await resumeTtrpgOpenChecksV1(input)
      : await resumeTtrpgOpenOperationV1(input)
    const after = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!.openRun!.operations.find(o => o.operationKey === input.operationKey)!
    if (nextTtrpgOpenOperationStepV1(after)?.stepKey === step?.stepKey && after.status === operation.status) return result
  }
  throw new Error('[ttrpg-play] 单次恢复超过有限 owner 链上限')
}
