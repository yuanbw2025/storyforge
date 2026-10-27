import { readTtrpgOpenImportedCallOwnerV1 } from './open-run-portability'
/** A human can cancel a genuinely un-dispatched request; its counted slot is retained. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { finishTtrpgOpenModelCallV1 } from './runtime-commands'
import { appendAgentRunEventV1, readInstanceAgentRunV1, AgentRunStoreError } from '../agent/run/event-store'
type PreparedCancellationInputV1 = { scope: WorkspaceScope; sessionId: number; viewerKey: string; runId: number; requestKey: string }
export async function cancelTtrpgOpenPreparedRequestV1(input: PreparedCancellationInputV1) {
  return cancelPrepared(input, false)
}
/** Common requests save the call receipt, then the window close, then the local Run terminal receipt. */
export async function cancelTtrpgOpenCommonOraclePreparedCallV1(input: PreparedCancellationInputV1) {
  return cancelPrepared(input, true)
}
async function cancelPrepared(input: PreparedCancellationInputV1, common: boolean) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), call = runtime?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
  if (!call || call.status !== 'prepared' && !(call.status === 'failed' && call.terminalReason === 'cancelled-before-dispatch' && !call.dispatchRef)) throw new Error('只能取消确实尚未发送的请求；已发送或未知结果必须核对原请求')
  if (Boolean(call.commonOracle) !== common) throw new Error('共同事实取消须按其原本地 Run 和窗口顺序结束，其他请求不能借用')
  const currentRun = await readInstanceAgentRunV1(input.scope, input.runId)
  if (common && currentRun.run.portableRuntimeOriginJson !== undefined) throw new Error('导入的共同事实原请求不能恢复本地取消执行权')
  const imported = currentRun.run.portableRuntimeOriginJson !== undefined ? await readTtrpgOpenImportedCallOwnerV1(input) : null
  if (currentRun.run.contractHash !== call.runContractHash && !imported) throw new Error('取消需要原始请求的准确运行证明')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const event = await finishTtrpgOpenModelCallV1({ ...input, commandId: 'human-cancel-prepared', baseSequence: version.sequence, baseStateHash: version.stateHash,
    status: 'failed', responseArtifactHash: null, usage: { source: 'unknown', inputTokens: 0, outputTokens: 0, actualCostUsd: 0 }, terminalReason: 'cancelled-before-dispatch' })
  if (common) return event
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    if (snapshot.run.productRuntimeSessionId !== input.sessionId || (snapshot.run.contractHash !== call.runContractHash && snapshot.run.contractHash !== imported?.evidence.run.contractHash)) throw new Error('取消回执不属于原运行实例')
    if (snapshot.projection.state === 'cancelled' || snapshot.projection.state === 'failed') return event
    if (snapshot.projection.state === 'completed') throw new Error('已完成的运行不能改写成未发送取消')
    try {
      await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type: 'run.cancelled',
        payload: { reason: `human-cancelled-before-dispatch:${runtime!.sessionKey}:${event.sequence}` }, expectedLastSequence: snapshot.projection.lastSequence })
      return event
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict')) throw error }
  }
  throw new Error('请求已取消，运行回执仍需补齐；不会重新发送')
}
