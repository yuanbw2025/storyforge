/** Close the original known request only; imported proof never becomes local execution or cleanup authority. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenCommonOracleCandidateReaderV1 } from './open-common-oracle-candidate'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { assertTtrpgOpenCommonOracleCallOriginV1 } from './open-model-calls'
import { parseTtrpgOpenCommonOracleRequestCloseV1, type TtrpgOpenCommonOracleRequestCloseV1 } from './open-common-oracle-request'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'
import { reconcileTtrpgOpenOracleFactRunV1 } from './open-oracle-adoption'

export async function readTtrpgOpenCommonOracleRequestCloseOwnerV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string; close: TtrpgOpenCommonOracleRequestCloseV1 }) {
  const close = parseTtrpgOpenCommonOracleRequestCloseV1(input.close)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const run = loaded.runtime.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === input.epochKey), grant = epoch?.commonOracle
  const call = run.coordination.calls.find(row => row.requestKey === close.requestKey)
  if (!epoch || !grant || grant.requestKey !== close.requestKey || !call || call.authorizationEpochKey !== epoch.epochKey || epoch.viewerKey !== input.viewerKey
    || ['prepared', 'dispatched'].includes(call.status)) throw new Error('共同事实结束必须先闭合本人的原请求和费用记录')
  assertTtrpgOpenCommonOracleCallOriginV1(loaded.runtime, call)
  const reader = { ...input, runId: grant.run.runId, requestKey: close.requestKey }
  await assertTtrpgOpenCommonOracleCandidateReaderV1(reader)
  const snapshot = await readInstanceAgentRunV1(input.scope, grant.run.runId)
  if (snapshot.run.portableRuntimeOriginJson !== undefined || snapshot.run.productRuntimeSessionId !== input.sessionId
    || snapshot.run.contractJson !== grant.run.contractJson || snapshot.run.contractHash !== grant.run.contractHash) throw new Error('共同事实只能结束准确原本地 Run，不能清理导入或外域记录')
  const reviewed = run.oracleReviews?.some(row => row.requestKey === close.requestKey) || run.factLedger?.entries.some(row => row.modelCandidate?.requestKey === close.requestKey)
  if (close.decision === 'close-this-reviewed-common-oracle-window') {
    const rejected = run.oracleReviews?.some(row => row.requestKey === close.requestKey && row.interpretationDecision === 'reject')
      && snapshot.events.some(event => event.type === 'run.failed' && event.payload.code === 'oracle-interpretation-rejected')
    if (!reviewed || !(snapshot.projection.state === 'completed' || snapshot.projection.state === 'failed' && rejected)) throw new Error('请先恢复本次已审阅共同事实的原终验回执')
  } else if (reviewed || snapshot.projection.steps[call.stepId]?.confirmation === 'adopt' || snapshot.projection.state === 'completed') throw new Error('共同事实已审阅或确认，不能改记为放弃')
  const evidence = await verifyTtrpgOpenModelCallEvidenceV1({ ...reader, call, mode: 'finish' })
  if (stable(evidence.run) !== stable(snapshot.run)) throw new Error('共同事实原 Run 在结束核验期间已经变化')
  await loaded.assertCurrent()
  return { loaded, epoch, grant, call, snapshot, evidence }
}

/** Confirmed/rejected choices remain intact. This repairs terminal bookkeeping before the independent close. */
export async function closeTtrpgOpenReviewedCommonOracleWindowV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string; decision: 'close-this-reviewed-common-oracle-window' }) {
  if (input.decision !== 'close-this-reviewed-common-oracle-window') throw new Error('请明确结束本次已审阅的共同事实窗口')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === input.epochKey), grant = epoch?.commonOracle
  const candidateHash = loaded.runtime.openRun!.oracleReviews?.find(row => row.requestKey === grant?.requestKey)?.candidateHash
    ?? loaded.runtime.openRun!.factLedger?.entries.find(row => row.modelCandidate?.requestKey === grant?.requestKey)?.modelCandidate?.candidateHash
  if (!grant || !candidateHash) throw new Error('共同事实尚未明确审阅或确认，不能冒充已完成')
  await reconcileTtrpgOpenOracleFactRunV1({ ...input, runId: grant.run.runId, requestKey: grant.requestKey, candidateHash })
  const close = { requestKey: grant.requestKey, decision: input.decision }
  const own = await readTtrpgOpenCommonOracleRequestCloseOwnerV1({ ...input, close })
  if (own.epoch.status === 'closed') return { sequence: own.epoch.closedRef!.sequence, epochKey: input.epochKey }
  const event = await closeTtrpgOpenEpochV1({ ...input, commandId: 'common-oracle.reviewed.close.' + input.epochKey,
    baseSequence: own.loaded.state.lastSequence, baseStateHash: own.loaded.stateHash, reason: '真人明确结束本次已审阅共同事实；原决定、回答与费用保持。', commonOracleRequest: close })
  return { sequence: event.sequence, epochKey: input.epochKey }
}
