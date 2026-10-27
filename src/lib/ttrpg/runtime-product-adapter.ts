/** Product-private runtime policy. Shared runtime dispatches here by product kind. */
import type { ProductRuntimeEvent, ProductRuntimeSession, ProductRuntimeState } from '../types'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { prepareTtrpgOpenBranchStateV1, consumePreparedTtrpgOpenBranchStateV1 } from './open-branch'
import { consumePreparedTtrpgOpenContinuationV1 } from './open-release-continuation'

export const TTRPG_RUNTIME_CONTENT_READER_V1 = Object.freeze({ ttrpgProtocol: 2 as const })

export async function prepareTtrpgRuntimeBranchStateV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; events: ProductRuntimeEvent[]; throughSequence: number
}): Promise<ProductRuntimeState | null> {
  if (!input.state.ttrpg || !('runFormat' in input.state.ttrpg) || input.state.ttrpg.runFormat !== 'open') return null
  return prepareTtrpgOpenBranchStateV1({ ...input, childSessionKey: `ttrpg.session.${crypto.randomUUID()}` })
}

export async function consumeTtrpgRuntimeBranchPreparationV1(
  state: ProductRuntimeState | undefined, runtimeSourceHash: string,
): Promise<void> {
  if (!state?.ttrpg || !('runFormat' in state.ttrpg) || state.ttrpg.runFormat !== 'open') return
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (runtime?.openRun?.releaseContinuation?.plan.childSessionKey === runtime?.sessionKey
    && !runtime?.openRun?.releaseContinuation?.confirmedRef) {
    await consumePreparedTtrpgOpenContinuationV1(state, runtimeSourceHash)
  } else await consumePreparedTtrpgOpenBranchStateV1(state, runtimeSourceHash)
}
