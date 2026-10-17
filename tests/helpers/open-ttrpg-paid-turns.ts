/** Test continuation through real paid-turn owners; no authority or state writes here. */
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
export async function settleOpenPaidTurnsV1(input: Parameters<typeof resumeTtrpgOpenOperationV1>[0]) {
  for (let i = 0;i < 64;i++) {
    const before = await readProductRuntimeState(input.sessionId),operation = parseTtrpgRuntimeStateV2(before.ttrpg)!.openRun!.operations.find(o => o.operationKey === input.operationKey)!
    const step = nextTtrpgOpenOperationStepV1(operation)
    if (operation.status !== 'executing' || !step || ['terminal','gates','narration','handoff'].includes(step.kind)) return { status: operation.status,nextStepKey: step?.stepKey ?? null }
    const result = step.kind === 'pressure' ? await resumeTtrpgOpenPressureV1(input) : step.kind === 'situations' ? await resumeTtrpgOpenSituationsV1(input) : await resumeTtrpgOpenOperationV1(input)
    if (['awaiting-consequence','awaiting-choice','paused'].includes(result.status) || (await readProductRuntimeState(input.sessionId)).lastSequence === before.lastSequence) return result
  }
  throw new Error('Paid-turn fixture continuation exceeded the frozen operation step bound')
}
