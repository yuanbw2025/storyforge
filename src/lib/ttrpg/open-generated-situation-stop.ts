/** The durable epoch-close decision authorizes bounded terminal cleanup, never another model send. */
import type { WorkspaceScope } from '../types'
import { assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { readTtrpgOpenModelCallRunsV1 } from './open-model-call-evidence'
import { appendAgentRunEventV1, readInstanceAgentRunV1, AgentRunStoreError } from '../agent/run/event-store'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'

type Input = { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey?: string }
async function owned(input: Input) {
  // Requester authority needs no candidate content, Run id or model-reading grant.
  const loaded = await assertTtrpgOpenSituationRequesterV1(input)
  const run = loaded.runtime.openRun!, epoch = run.coordination.epochs.find(e => e.epochKey === (input.epochKey ?? run.coordination.activeEpochKey))
  if (!epoch || epoch.triggerKind !== 'request-situation' || epoch.viewerKey !== input.viewerKey) throw new Error('没有本人可结束的局势生成窗口。')
  const calls = run.coordination.calls.filter(c => c.authorizationEpochKey === epoch.epochKey)
  const rows = await readTtrpgOpenModelCallRunsV1({ ...input, calls })
  return { loaded, run, epoch, calls, rows }
}
export async function finishTtrpgOpenSituationDraftV1(input: Input) {
  const f = await owned(input)
  for (const call of f.calls.filter(c => c.status === 'prepared')) {
    const owner = f.rows.find(r => r.contractHash === call.runContractHash)
    if (!owner?.id || owner.portableRuntimeOriginJson) throw new Error('请先通过原请求处理历史未发送记录。')
    await cancelTtrpgOpenPreparedRequestV1({ ...input, runId: owner.id, requestKey: call.requestKey })
  }
  if (f.epoch.status === 'active') {
    const version = await readProductRuntimeStateVersion(input.sessionId)
    await closeTtrpgOpenEpochV1({ ...input, commandId: 'situation.stop.' + f.epoch.epochKey,
      baseSequence: version.sequence, baseStateHash: version.stateHash, epochKey: f.epoch.epochKey,
      reason: '真人明确结束本次局势拟定；保留原请求、原始回答和未知费用，不重发。' })
  }
  await reconcileTtrpgOpenStoppedSituationV1({ ...input, epochKey: f.epoch.epochKey })
}
export async function reconcileTtrpgOpenStoppedSituationV1(input: Input & { epochKey: string }) {
  const f = await owned(input)
  if (f.epoch.status !== 'closed' || !f.epoch.closedRef) throw new Error('局势结束决定尚未保存。')
  for (const call of f.calls) {
    if (f.run.situationReceipts?.some(r => r.model.requestKey === call.requestKey && r.model.runContractHash === call.runContractHash)) continue // domain commit wins even before Run confirmation
    const owner = f.rows.find(r => r.contractHash === call.runContractHash)
    if (!owner?.id || owner.portableRuntimeOriginJson) continue // imported original output remains historical
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await readInstanceAgentRunV1(input.scope, owner.id)
      if (snapshot.run.productRuntimeSessionId !== input.sessionId || snapshot.run.contractHash !== call.runContractHash) throw new Error('局势收尾不属于原始运行。')
      if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)
        || snapshot.projection.steps[call.stepId]?.confirmation === 'adopt') break
      try {
        await appendAgentRunEventV1({ ...input, runId: owner.id, productRuntimeSessionId: input.sessionId,
          type: 'run.cancelled', payload: { reason: 'situation-epoch-closed:' + f.epoch.closedRef.sessionKey + ':' + f.epoch.closedRef.sequence },
          expectedLastSequence: snapshot.projection.lastSequence })
        break
      } catch (error) {
        if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') || attempt === 7) throw error
      }
    }
  }
}
export async function readTtrpgOpenSituationStopRepairsV1(input: Omit<Input, 'epochKey'>) {
  const loaded = await assertTtrpgOpenSituationRequesterV1(input)
  const run = loaded.runtime.openRun!, epochs = run.coordination.epochs.filter(e => e.triggerKind === 'request-situation' && e.viewerKey === input.viewerKey && e.status === 'closed')
  if (!epochs.length) return []
  const epochKeys = new Set(epochs.map(e => e.epochKey)), calls = run.coordination.calls.filter(c => epochKeys.has(c.authorizationEpochKey))
  const rows = await readTtrpgOpenModelCallRunsV1({ ...input, calls })
  const adopted = new Set(run.situationReceipts?.map(r => r.model.runContractHash) ?? [])
  const unfinished = new Set(rows.filter(r => !adopted.has(r.contractHash) && !r.portableRuntimeOriginJson && !['completed', 'cancelled', 'failed'].includes(r.status)).map(r => r.contractHash))
  const pending = new Set(calls.filter(c => unfinished.has(c.runContractHash)).map(c => c.authorizationEpochKey))
  return epochs.filter(e => pending.has(e.epochKey)).map(e => e.epochKey)
}
