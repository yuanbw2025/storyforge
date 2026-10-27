/** Historical output belongs to its original human. Reading never restores an executable candidate. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenModelCallV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1, type TtrpgOpenAuthorizationV1 } from './open-authorization'
import { ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose'
import { readTtrpgOpenImportedCallOwnerV1, parseTtrpgOpenRunOriginV1 } from './open-run-portability'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { assertTtrpgOpenAgentEvidenceUnchangedV1 } from './open-model-call-evidence'

/** Current human read authority is independent of permission to send another model request. */
function assertHistoricalReader(authorization: TtrpgOpenAuthorizationV1, call: TtrpgOpenModelCallV1, viewerKey: string) {
  if (call.skillId === 'prose.ttrpg-open-public-situation-propose' || call.skillId === 'prose.ttrpg-open-entity-propose') throw new Error('[ttrpg-imported-response] 共同局势历史需要独立定义审计，不能经旧回答入口转换或执行')
  const requester = authorization.seats.find(seat => seat.viewerKey === viewerKey)
  if (!requester || requester.controller === 'ai' || requester.assignmentState !== 'claimed') throw new Error('[ttrpg-imported-response] 需要当前本人已认领的真人席位')
  if (ttrpgOpenModelPurposeForSkillV1(call.skillId).actorRole === 'gm') {
    assertTtrpgOpenHumanHostV1(authorization, viewerKey)
    if (call.skillId === 'prose.ttrpg-open-situation-propose' && requester.role !== 'gm') throw new Error('局势私域历史只允许当前真人 GM 读取')
    if (call.actorKey !== 'gm') throw new Error('[ttrpg-imported-response] 原回答的主持角色无效')
  } else {
    const actor = authorization.seats.find(seat => seat.actorKey === call.actorKey)
    if (!actor || !authorization.selectedActorKeys.includes(call.actorKey) || (requester.actorKey !== call.actorKey
      && (!['ai', 'hybrid'].includes(actor.controller) || !authorization.approvalBindings.some(binding => binding.companionActorKey === call.actorKey
        && binding.approverSeatKeys.includes(requester.seatKey))))) throw new Error('[ttrpg-imported-response] 当前没有该角色的历史复核权限')
  }
}

type HistoricalInput = { scope: WorkspaceScope; sessionId: number; viewerKey: string }
export type TtrpgOpenHistoricalResponseV1 = Awaited<ReturnType<typeof readTtrpgOpenHistoricalResponseV1>>

/** Metadata only; the explicit open action performs full exact-byte verification. */
export async function listTtrpgOpenHistoricalResponsesV1(input: HistoricalInput) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.authorization || !runtime.openRun) return []
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
    participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
  const origins = await Promise.all((await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray())
    .filter(row => row.id != null && row.portableRuntimeOriginJson).map(async row => ({ runId: row.id!, origin: await parseTtrpgOpenRunOriginV1(row.portableRuntimeOriginJson!) })))
  const result: Array<{ runId: number; requestKey: string; purpose: string }> = []
  for (const call of runtime.openRun.coordination.calls) {
    const purpose = ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose
    if (purpose === 'public-situation-proposal' || purpose === 'entity-proposal' || purpose === 'common-oracle-interpret') continue // Independent public-definition audit does not inherit the old raw-response desk.
    const epoch = runtime.openRun.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
    if (call.status !== 'succeeded' || !call.responseArtifactHash || (call.narrationBinding?.viewerKey ?? epoch?.viewerKey) !== input.viewerKey) continue
    try { assertHistoricalReader(runtime.authorization, call, input.viewerKey) } catch { continue }
    const owners = origins.filter(row => row.origin.sessionKey === runtime.sessionKey && row.origin.contractHash === call.runContractHash
      && row.origin.events.some(event => event.type === 'model.requested' && event.payload.stepId === call.stepId
        && event.payload.attempt === call.attempt && event.payload.bindingHash === call.requestHash))
    if (owners.length > 1) throw new Error('[ttrpg-imported-response] 原回答不能唯一定位')
    if (owners.length) result.push({ runId: owners[0].runId, requestKey: call.requestKey,
      purpose: ({ intent: '行动建议', companion: '队友行动', 'kp-narration': 'KP 叙述', 'stage-brief': '阶段复盘', 'situation-proposal': '私域局势候选', 'oracle-interpret': 'Oracle 解释', 'fact-normalize': '事实整理' })[purpose] })
  }
  return result
}

/** No AI/configuration access, new Run, candidate materialization, adoption or budget write. */
export async function readTtrpgOpenHistoricalResponseV1(input: HistoricalInput & { runId: number; requestKey: string }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const before = await readProductRuntimeStateVersion(input.sessionId)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(row => row.requestKey === input.requestKey)
  const epoch = runtime?.openRun?.coordination.epochs.find(row => row.epochKey === call?.authorizationEpochKey)
  if (!runtime?.authorization || !call || call.status !== 'succeeded' || !call.responseArtifactHash || !call.terminalRef
    || !call.usage || call.usage.inputTokens === null || call.usage.outputTokens === null
    || (call.narrationBinding?.viewerKey ?? epoch?.viewerKey) !== input.viewerKey) throw new Error('[ttrpg-imported-response] 缺少本人原始成功回答及用量')
  const authorize = async () => {
    assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization!,
      participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
    assertHistoricalReader(runtime.authorization!, call, input.viewerKey)
  }
  await authorize()
  const owner = await readTtrpgOpenImportedCallOwnerV1(input)
  if (!owner) throw new Error('[ttrpg-imported-response] 缺少可回读的原始运行证明')
  const terminal = await db.productRuntimeEvents.where('[sessionId+sequence]').equals([input.sessionId, call.terminalRef.sequence]).first()
  const originalTerminal = terminal?.type === 'ttrpg.open.call.finished' ? JSON.parse(terminal.payloadJson) : null
  // A later explicit rejection does not rewrite the original successful transport receipt.
  const transportIdentity = (value: TtrpgOpenModelCallV1) => { const copy = { ...value };delete copy.intentRejection;return copy }
  if (call.terminalRef.sessionKey !== runtime.sessionKey || originalTerminal?.viewerKey !== input.viewerKey
    || stable(transportIdentity(parseTtrpgOpenModelCallV1(originalTerminal.call))) !== stable(transportIdentity(call))) throw new Error('[ttrpg-imported-response] 成功状态与实际原始事件不一致')
  const responded = owner.origin.events.filter(event => event.type === 'model.responded' && event.payload.stepId === call.stepId
    && event.payload.attempt === call.attempt && event.payload.outputHash === call.responseArtifactHash)
  const receipts = owner.origin.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response'
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt && event.payload.contentHash === call.responseArtifactHash)
  if (responded.length !== 1 || receipts.length !== 1) throw new Error('[ttrpg-imported-response] 缺少同一次实际响应与工件回执')
  const text = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: call.responseArtifactHash })
  await assertTtrpgOpenAgentEvidenceUnchangedV1(owner.evidence)
  await authorize()
  if (stable(before) !== stable(await readProductRuntimeStateVersion(input.sessionId))) throw new Error('[ttrpg-imported-response] 读取期间团局已变化，请重新打开')
  return { requestKey: call.requestKey, rawResponseHash: call.responseArtifactHash, originHash: owner.origin.originHash,
    text, usage: structuredClone(call.usage), executable: false as const }
}
