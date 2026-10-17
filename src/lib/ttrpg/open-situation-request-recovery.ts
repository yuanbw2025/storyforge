/** Explicit bookkeeping repair of an original request. No transport, credentials or renewed budget. */
import type { TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { assertTtrpgOpenSituationHumanGmV1, assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { readInstanceAgentRunV1, appendAgentRunEventV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { estimateTokens } from '../ai/context-budget'
import { readProductRuntimeStateVersion, readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { finishTtrpgOpenModelCallV1 } from './runtime-commands'
import { recoverTtrpgOpenSituationCandidateV1, recoverTtrpgOpenPublicSituationCandidateV1, recoverTtrpgOpenRuntimeCandidateV1 } from './open-intent-harness'
import { finishTtrpgOpenSituationDraftV1 } from './open-generated-situation-stop'
import { finishTtrpgOpenPublicSituationDraftV1 } from './open-public-situation-stop'
import { finishTtrpgOpenEntityDraftV1 } from './open-entity-stop'
import { finishTtrpgOpenOracleInstanceDraftV1, finishTtrpgOpenNormalizationInstanceDraftV1, finishTtrpgOpenCommonOracleDraftV1 } from './open-runtime-draft-stop'
import { assertTtrpgOpenCommonOracleCandidateReaderV1 } from './open-common-oracle-candidate'
import { assertTtrpgOpenEntityCandidateReaderV1 } from './open-entity-candidate'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'

type RecoveryPurpose = boolean | 'entity' | 'oracle' | 'normalization' | 'common-oracle'
async function owned(input: TtrpgOpenCandidateReadV1, publicSituation: RecoveryPurpose = false) {
  if (publicSituation === 'common-oracle') await assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  if (publicSituation === 'entity') await assertTtrpgOpenEntityCandidateReaderV1(input)
  if (publicSituation === 'oracle' || publicSituation === 'normalization') await assertTtrpgOpenSituationHumanGmV1(input)
  const loaded = await assertTtrpgOpenSituationRequesterV1(input), run = loaded.runtime.openRun!
  const call = run.coordination.calls.find(c => c.requestKey === input.requestKey)
  const epoch = call && run.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (!call || call.skillId !== (publicSituation === 'common-oracle' ? 'prose.ttrpg-open-common-oracle-interpret' : publicSituation === 'entity' ? 'prose.ttrpg-open-entity-propose' : publicSituation === 'oracle' ? 'prose.ttrpg-open-oracle-interpret' : publicSituation === 'normalization' ? 'prose.ttrpg-open-fact-normalize' : publicSituation ? 'prose.ttrpg-open-public-situation-propose' : 'prose.ttrpg-open-situation-propose')
    || !epoch || (publicSituation === 'common-oracle' ? !epoch.commonOracle || !call.commonOracle || epoch.commonOracle.run.runId !== input.runId : publicSituation === 'entity' ? isTtrpgOpenPassiveEpochV1(epoch) : publicSituation === 'oracle' ? !epoch.oracleRuntimeReferencePolicy || !call.oracleInterpretation?.runtimeReferencePolicy : publicSituation === 'normalization' ? !epoch.normalizationRuntimeReferencePolicy || !call.supportSlot?.runtimeReferencePolicy : epoch.triggerKind !== (publicSituation ? 'request-public-situation' : 'request-situation')) || epoch.viewerKey !== input.viewerKey
    || snapshot.run.portableRuntimeOriginJson !== undefined || snapshot.run.contractHash !== call.runContractHash
    || snapshot.run.productRuntimeSessionId !== input.sessionId
    || call.status === 'dispatched' && (epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey)) {
    throw new Error('原局势请求没有本人的本地准确运行与授权证明')
  }
  await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'finish' })
  await loaded.assertCurrent()
  return { loaded, call, epoch, snapshot }
}
async function command(input: TtrpgOpenCandidateReadV1) {
  const version = await readProductRuntimeStateVersion(input.sessionId)
  return { ...input, commandId: 'situation.original-request.repair', baseSequence: version.sequence, baseStateHash: version.stateHash }
}
/** Internally reads original private bytes; returns only the existing opaque requester summary. */
export async function repairTtrpgOpenSituationResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  return repairOriginalResponse(input, false)
}
export async function repairTtrpgOpenPublicSituationResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  return repairOriginalResponse(input, true)
}
export async function repairTtrpgOpenEntityResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  return repairOriginalResponse(input, 'entity')
}
export async function repairTtrpgOpenOracleInstanceResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  return repairOriginalResponse(input, 'oracle')
}
export async function repairTtrpgOpenNormalizationInstanceResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  return repairOriginalResponse(input, 'normalization')
}
export async function repairTtrpgOpenCommonOracleResponseReceiptV1(input: TtrpgOpenCandidateReadV1) {
  const candidate = await repairOriginalResponse(input, 'common-oracle')
  if (candidate && candidate.schema !== 'storyforge.ttrpg-open-common-oracle-candidate') throw new Error('原共同事实回答不能修复为其他用途候选')
  return candidate
}
function repairOriginalResponse(input: TtrpgOpenCandidateReadV1, publicSituation: 'entity' | 'oracle' | 'normalization' | 'common-oracle'): ReturnType<typeof recoverTtrpgOpenRuntimeCandidateV1>
function repairOriginalResponse(input: TtrpgOpenCandidateReadV1, publicSituation: boolean): ReturnType<typeof recoverTtrpgOpenSituationCandidateV1>
async function repairOriginalResponse(input: TtrpgOpenCandidateReadV1, publicSituation: RecoveryPurpose) {
  const recover = typeof publicSituation === 'string' ? recoverTtrpgOpenRuntimeCandidateV1 : publicSituation ? recoverTtrpgOpenPublicSituationCandidateV1 : recoverTtrpgOpenSituationCandidateV1
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      let actualHash: string | null = null
      try {
        const f = await owned(input, publicSituation), { call, snapshot } = f
        if (call.status === 'succeeded') return await recover(input)
        if (call.status !== 'dispatched') throw new Error('只有原已发送、尚未终态的回答可以补齐')
        const refs = snapshot.events.flatMap(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response'
          && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt ? [e.payload] : [])
        const hashes = [...new Set(refs.map(r => r.contentHash))]
        if (hashes.length !== 1) throw new Error('原请求缺少唯一完整回答，不能猜测或另选版本')
        actualHash = hashes[0]!
        const raw = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: actualHash })
        if (refs.some(r => r.byteLength !== new TextEncoder().encode(raw).byteLength)) throw new Error('原回答字节不完整')
        const responded = snapshot.events.filter(e => e.type === 'model.responded' && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt)
        if (responded.some(e => e.type === 'model.responded' && e.payload.outputHash !== actualHash)) throw new Error('原模型回答回执存在冲突')
        if (!responded.length) await appendAgentRunEventV1({ ...input, productRuntimeSessionId: input.sessionId, type: 'model.responded',
          payload: { stepId: call.stepId, attempt: call.attempt, outputHash: actualHash }, expectedLastSequence: snapshot.projection.lastSequence })
        const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })) as { messages?: Array<{ content: string }> }
        if (!Array.isArray(rendered.messages) || rendered.messages.some(m => typeof m.content !== 'string')) throw new Error('缺少原始完整请求正文')
        const inputTokens = estimateTokens(rendered.messages.map(m => m.content).join('\n')), outputTokens = estimateTokens(raw)
        await finishTtrpgOpenModelCallV1({ ...await command(input), status: 'succeeded', responseArtifactHash: actualHash,
          usage: { source: 'estimated', inputTokens, outputTokens, actualCostUsd: null },
          terminalReason: inputTokens > call.reservedInputTokens || outputTokens > call.reservedOutputTokens ? 'token-budget-overrun' : 'response-recorded-after-interruption' })
        return await recover(input)
      } catch (error) {
        // A live executor may have won with its actual usage. Never replace that receipt with estimates.
        const latest = actualHash ? parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey) : undefined
        if (actualHash && latest?.status === 'succeeded' && latest.responseArtifactHash === actualHash) return await recover(input)
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (!['sequence_conflict', 'sequence-conflict'].includes(code) || attempt === 5) throw error
      }
    }
    throw new Error('原运行持续推进，请重新读取')
  } catch { throw new Error('原回答回执尚未恢复，请保留原记录；没有再次发送或公开私域正文。') }
}

/** Human decision ends waiting, not the external provider request or its possible charge. */
export async function abandonTtrpgOpenSituationWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, false)
}
export async function abandonTtrpgOpenPublicSituationWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, true)
}
export async function abandonTtrpgOpenEntityWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, 'entity')
}
export async function abandonTtrpgOpenOracleInstanceWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, 'oracle')
}
export async function abandonTtrpgOpenNormalizationInstanceWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, 'normalization')
}
export async function abandonTtrpgOpenCommonOracleWaitV1(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }) {
  return abandonOriginalWait(input, 'common-oracle')
}
async function abandonOriginalWait(input: TtrpgOpenCandidateReadV1 & { decision: 'abandon-wait-as-unknown' }, publicSituation: RecoveryPurpose) {
  if (input.decision !== 'abandon-wait-as-unknown') throw new Error('需要本人明确结束等待并保留未知结果与费用。')
  try {
    const f = await owned(input, publicSituation)
    if (f.call.status === 'dispatched') await finishTtrpgOpenModelCallV1({ ...await command(input), status: 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'human-abandoned-unobserved-request' })
    else if (f.call.status !== 'unknown') throw new Error('已有明确终态，不能改记为结果未知')
    if (publicSituation === 'common-oracle') return await finishTtrpgOpenCommonOracleDraftV1({ ...input, decision: 'discard-this-common-oracle-request-and-close-window' })
    if (publicSituation === 'normalization') return await finishTtrpgOpenNormalizationInstanceDraftV1({ ...input, decision: 'discard-this-normalization-instance-request-and-close-window' })
    if (publicSituation === 'oracle') return await finishTtrpgOpenOracleInstanceDraftV1({ ...input, decision: 'discard-this-oracle-instance-request-and-close-window' })
    if (publicSituation === 'entity') return await finishTtrpgOpenEntityDraftV1({ ...input, decision: 'discard-this-entity-request-and-close-window' })
    return await (publicSituation ? finishTtrpgOpenPublicSituationDraftV1 : finishTtrpgOpenSituationDraftV1)({ ...input, epochKey: f.epoch.epochKey })
  } catch { throw new Error('原请求尚未结束。已有回答时请恢复原回答回执；原请求不会重发，费用保持实际记录。') }
}
