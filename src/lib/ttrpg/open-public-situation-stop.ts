/** Explicit close is durable before terminal cleanup; neither step renews a model allowance. */
import type { WorkspaceScope } from '../types'
import { assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { readInstanceAgentRunV1, appendAgentRunEventV1, AgentRunStoreError } from '../agent/run/event-store'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'

type Input = { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey?: string }
async function owned(input: Input) {
  const loaded = await assertTtrpgOpenSituationRequesterV1(input), run = loaded.runtime.openRun!
  const epoch = run.coordination.epochs.find(row => row.epochKey === (input.epochKey ?? run.coordination.activeEpochKey))
  if (!epoch?.publicSituation || epoch.triggerKind !== 'request-public-situation' || epoch.viewerKey !== input.viewerKey) throw new Error('没有本人可结束的共同局势窗口')
  const grant = epoch.publicSituation, call = run.coordination.calls.find(row => row.requestKey === grant.basis.requestKey)
  let original: Awaited<ReturnType<typeof readInstanceAgentRunV1>> | undefined
  try { original = await readInstanceAgentRunV1(input.scope, grant.run.runId) } catch { /* A deleted original never acquires a replacement. */ }
  if (original && (original.run.productRuntimeSessionId !== input.sessionId || original.run.contractHash !== grant.run.contractHash
    || original.run.portableRuntimeOriginJson || original.run.contractJson !== grant.run.contractJson)) original = undefined
  return { loaded, run, epoch, grant, call, original }
}
export async function finishTtrpgOpenPublicSituationDraftV1(input: Input) {
  const f = await owned(input)
  if (f.call?.status === 'prepared') {
    // Import never grants dispatch. The established V1 forensic path may only cancel
    // a proven never-dispatched original reservation, with its exact imported owner.
    const historical = f.original ? null : await (await import('./open-run-portability')).readTtrpgOpenImportedCallOwnerV1({
      ...input, requestKey: f.grant.basis.requestKey })
    const runId = f.original?.run.id ?? historical?.runId
    if (!runId) throw new Error('原未发送请求缺少准确历史证明，不能替换原 Run 或猜测零费用')
    await cancelTtrpgOpenPreparedRequestV1({ ...input, runId, requestKey: f.grant.basis.requestKey })
  }
  if (f.epoch.status === 'active') {
    const version = await readProductRuntimeStateVersion(input.sessionId)
    await closeTtrpgOpenEpochV1({ ...input, commandId: 'public-situation.stop.' + f.epoch.epochKey,
      baseSequence: version.sequence, baseStateHash: version.stateHash, epochKey: f.epoch.epochKey,
      reason: '真人明确结束本次共同局势请求；保留原授权、已观察回答及未知费用，不重发。' })
  }
  await reconcileTtrpgOpenStoppedPublicSituationV1({ ...input, epochKey: f.epoch.epochKey })
}
export async function reconcileTtrpgOpenStoppedPublicSituationV1(input: Input & { epochKey: string }) {
  const f = await owned(input)
  if (f.epoch.status !== 'closed' || !f.epoch.closedRef) throw new Error('共同局势结束决定尚未保存')
  if (!f.original || f.run.situationReceipts?.some(row => row.model.requestKey === f.grant.basis.requestKey
    && row.model.runContractHash === f.grant.run.contractHash)) return // Domain adoption wins its race with close.
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, f.grant.run.runId)
    if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)
      || snapshot.projection.steps['ttrpg.open.public-situation-propose']?.confirmation === 'adopt') return
    try {
      await appendAgentRunEventV1({ ...input, runId: f.grant.run.runId, productRuntimeSessionId: input.sessionId,
        type: 'run.cancelled', payload: { reason: 'public-situation-epoch-closed:' + f.epoch.closedRef.sessionKey + ':' + f.epoch.closedRef.sequence },
        expectedLastSequence: snapshot.projection.lastSequence })
      return
    } catch (error) {
      if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') || attempt === 7) throw error
    }
  }
}
export async function readTtrpgOpenPublicSituationStopRepairsV1(input: Omit<Input, 'epochKey'>) {
  const loaded = await assertTtrpgOpenSituationRequesterV1(input), pending: string[] = []
  for (const epoch of loaded.runtime.openRun!.coordination.epochs.filter(row => row.publicSituation && row.viewerKey === input.viewerKey && row.status === 'closed')) {
    const f = await owned({ ...input, epochKey: epoch.epochKey })
    if (f.original && !['completed', 'cancelled', 'failed'].includes(f.original.projection.state)
      && !f.run.situationReceipts?.some(row => row.model.requestKey === f.grant.basis.requestKey && row.model.runContractHash === f.grant.run.contractHash)) pending.push(epoch.epochKey)
  }
  await loaded.assertCurrent()
  return pending
}
