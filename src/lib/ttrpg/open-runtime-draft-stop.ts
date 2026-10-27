/** Explicitly discard this draft and close its original consultation window; never create or resend. */
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { assertTtrpgOpenSituationHumanGmV1 } from './open-generated-situation-candidate'
import { assertTtrpgOpenEntityCandidateReaderV1 } from './open-entity-candidate'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { readInstanceAgentRunV1, appendAgentRunEventV1, AgentRunStoreError } from '../agent/run/event-store'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { cancelTtrpgOpenPreparedRequestV1, cancelTtrpgOpenCommonOraclePreparedCallV1 } from './open-request-cancellation'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'
import { assertTtrpgOpenCommonOracleCandidateReaderV1 } from './open-common-oracle-candidate'

type DraftPurpose = 'entity' | 'oracle' | 'normalization' | 'common-oracle'
async function owned(input: TtrpgOpenCandidateReadV1, purpose: DraftPurpose) {
  if (purpose === 'common-oracle') await assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  else if (purpose === 'entity') await assertTtrpgOpenEntityCandidateReaderV1(input)
  else await assertTtrpgOpenSituationHumanGmV1(input)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)!
  if (!call || !epoch || epoch.viewerKey !== input.viewerKey || purpose === 'oracle' && (!call.oracleInterpretation?.runtimeReferencePolicy || !epoch.oracleRuntimeReferencePolicy)
    || purpose === 'common-oracle' && (!call.commonOracle || !epoch.commonOracle || epoch.commonOracle.run.runId !== input.runId)
    || purpose === 'normalization' && (!call.supportSlot?.runtimeReferencePolicy || !epoch.normalizationRuntimeReferencePolicy)) throw new Error('原草稿没有本人的准确用途与窗口证明。')
  if (purpose === 'entity' && loaded.runtime.openRun!.entityOperations?.some(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === input.requestKey)) throw new Error('本候选已经保存为待确认计划；请修复原采用回执或明确处置计划，不得改记为放弃请求。')
  if (purpose !== 'entity' && (loaded.runtime.openRun!.oracleReviews?.some(row => row.requestKey === input.requestKey)
    || loaded.runtime.openRun!.factLedger?.entries.some(row => row.modelCandidate?.requestKey === input.requestKey))) throw new Error('原事实候选已明确审阅或确认，请补齐原终验再结束，不能改记为放弃。')
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (snapshot.run.portableRuntimeOriginJson || snapshot.run.productRuntimeSessionId !== input.sessionId || snapshot.run.contractHash !== call.runContractHash) throw new Error(purpose === 'entity'
    ? '实体请求收尾需要准确原本地 Run，不能续用导入授权。' : '实例事实收尾需要准确原本地 Run，不能续用导入授权。')
  await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'finish' })
  await loaded.assertCurrent()
  return { loaded, call, epoch }
}
export async function finishTtrpgOpenEntityDraftV1(input: TtrpgOpenCandidateReadV1 & { decision: 'discard-this-entity-request-and-close-window' }) {
  if (input.decision !== 'discard-this-entity-request-and-close-window') throw new Error('需要明确放弃本实体请求并结束原咨询窗口。')
  return finishDraft(input, 'entity')
}
export async function finishTtrpgOpenOracleInstanceDraftV1(input: TtrpgOpenCandidateReadV1 & { decision: 'discard-this-oracle-instance-request-and-close-window' }) {
  if (input.decision !== 'discard-this-oracle-instance-request-and-close-window') throw new Error('需要明确放弃本次实例事实请求并结束原窗口，保留回答与费用。')
  return finishDraft(input, 'oracle')
}
export async function finishTtrpgOpenNormalizationInstanceDraftV1(input: TtrpgOpenCandidateReadV1 & { decision: 'discard-this-normalization-instance-request-and-close-window' }) {
  if (input.decision !== 'discard-this-normalization-instance-request-and-close-window') throw new Error('需要明确放弃本次实例归一请求并结束原窗口，保留原回答与费用。')
  return finishDraft(input, 'normalization')
}
export async function finishTtrpgOpenCommonOracleDraftV1(input: TtrpgOpenCandidateReadV1 & { decision: 'discard-this-common-oracle-request-and-close-window' }) {
  if (input.decision !== 'discard-this-common-oracle-request-and-close-window') throw new Error('需要明确放弃本次共同事实请求并结束原窗口，保留原回答与费用。')
  return finishDraft(input, 'common-oracle')
}
async function finishDraft(input: TtrpgOpenCandidateReadV1, purpose: DraftPurpose) {
  const f = await owned(input, purpose)
  if (f.call.status === 'dispatched') throw new Error('原请求仍在等待回答，须先恢复原回执或明确记录结果未知。')
  if (f.call.status === 'prepared') await (purpose === 'common-oracle' ? cancelTtrpgOpenCommonOraclePreparedCallV1 : cancelTtrpgOpenPreparedRequestV1)(input)
  if (f.epoch.status === 'active') {
    const version = await readProductRuntimeStateVersion(input.sessionId)
    await closeTtrpgOpenEpochV1({ ...input, commandId: (purpose === 'common-oracle' ? 'common-oracle-draft.stop.' : purpose === 'entity' ? 'entity-draft.stop.' : purpose === 'oracle' ? 'oracle-instance.stop.' : 'normalization-instance.stop.') + f.epoch.epochKey,
      baseSequence: version.sequence, baseStateHash: version.stateHash, epochKey: f.epoch.epochKey,
      ...(purpose === 'common-oracle' ? { commonOracleRequest: { requestKey: input.requestKey, decision: 'discard-this-common-oracle-request-and-close-window' as const } } : {}),
      reason: purpose === 'entity' ? '真人明确放弃本实体提案并结束原咨询窗口；保留回答、用量与未知费用，不创建、不重发。'
        : '真人明确放弃本次实例事实候选并结束原窗口；保留原回答、实际用量与未知费用，不确认、不重发。' })
  }
  await reconcileStopped(input, purpose)
}
/** The saved close receipt, not a timer or model result, authorizes local Run cleanup. */
export async function reconcileTtrpgOpenStoppedEntityV1(input: TtrpgOpenCandidateReadV1) { return reconcileStopped(input, 'entity') }
export async function reconcileTtrpgOpenStoppedOracleInstanceV1(input: TtrpgOpenCandidateReadV1) { return reconcileStopped(input, 'oracle') }
export async function reconcileTtrpgOpenStoppedNormalizationInstanceV1(input: TtrpgOpenCandidateReadV1) { return reconcileStopped(input, 'normalization') }
export async function reconcileTtrpgOpenStoppedCommonOracleV1(input: TtrpgOpenCandidateReadV1) { return reconcileStopped(input, 'common-oracle') }
async function reconcileStopped(input: TtrpgOpenCandidateReadV1, purpose: DraftPurpose) {
  const f = await owned(input, purpose)
  if (f.epoch.status !== 'closed' || !f.epoch.closedRef) throw new Error(purpose === 'entity' ? '原实体请求窗口尚未保存结束决定。' : '原实例事实窗口尚未保存结束决定。')
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return
    if (snapshot.projection.steps[f.call.stepId]?.confirmation === 'adopt') throw new Error(purpose === 'entity' ? '实体候选已进入采用，不得改记为放弃。' : '事实候选已进入确认，不得改记为放弃。')
    try {
      await appendAgentRunEventV1({ ...input, productRuntimeSessionId: input.sessionId, type: 'run.cancelled',
        payload: { reason: (purpose === 'common-oracle' ? 'common-oracle-original-window-closed:' : purpose === 'entity' ? 'entity-original-window-closed:' : purpose === 'oracle' ? 'oracle-instance-original-window-closed:' : 'normalization-instance-original-window-closed:') + f.epoch.closedRef.sessionKey + ':' + f.epoch.closedRef.sequence },
        expectedLastSequence: snapshot.projection.lastSequence })
      return
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict') || attempt === 7) throw error }
  }
}
