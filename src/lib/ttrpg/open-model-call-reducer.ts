import { assertTtrpgOpenEntityModelCallOriginV1, assertTtrpgOpenOracleRuntimeCallOriginV1, assertTtrpgOpenCommonOracleCallOriginV1 } from './open-model-calls'
import { assertTtrpgOpenEpochPurposeV1 } from './open-coordination'
/** Pure external-request journal: replay never dispatches a provider or reads evidence storage. */
import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenHostingRequestV1,assertTtrpgOpenHostingDelegationV1 } from './open-hosting-delegation'
import { assertTtrpgOpenNarrationCallV1, assertTtrpgOpenCallReservationV1, assertTtrpgOpenOracleInterpretationSlotV1, assertTtrpgOpenSupportSlotV1, assertTtrpgOpenNormalizationSourceV1, parseTtrpgOpenModelCallV1, updateTtrpgOpenEpochCallTotalsV1 } from './open-model-calls'
import * as p from './open-contract-parse'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { parseTtrpgOpenIntentClarification } from './open-intent-clarification-contract'

export function applyTtrpgOpenModelCallEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type === 'ttrpg.open.intent.clarified') {
    p.exact(payload,['requestKey','viewerKey','clarification','intent'],'intent clarified')
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg),run = runtime?.openRun,auth = runtime?.authorization
    const call = run?.coordination.calls.find(c => c.requestKey === payload.requestKey),epoch = run?.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)
    const entry = parseTtrpgOpenIntentClarification(payload.clarification),rawIntent = p.object(payload.intent,'clarification intent')
    const intent = p.record(rawIntent,['viewerKey','requestKey','candidateHash','selection','expectedCount','effectBindings',
      ...(entry.version === 2 ? ['routingVersion'] : []),
      ...(Object.prototype.hasOwnProperty.call(rawIntent,'discovery') ? ['discovery'] : [])],'clarification intent')
    const records = call?.intentClarifications ?? []
    if (!runtime || !run || !auth || !call || !epoch || call.status !== 'succeeded' || call.intentRejection
      || !['prose.ttrpg-open-intent','prose.ttrpg-open-companion'].includes(call.skillId)
      || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== payload.viewerKey
      || runtime.product.safety.status !== 'active' || run.stage.status !== 'open'
      || entry.viewerKey !== payload.viewerKey || entry.actorKey !== call.actorKey || event.actorKey !== call.actorKey || event.targetKey !== null
      || records.length >= 3 || entry.attempt !== records.length + 1 || entry.sourceRef.sessionKey !== runtime.sessionKey || entry.sourceRef.sequence !== event.sequence
      || intent.requestKey !== call.requestKey || intent.candidateHash !== entry.candidateHash || intent.viewerKey !== entry.viewerKey
      || intent.expectedCount !== records.length || stable(intent.selection) !== stable(entry.selection)
      || entry.version === 2 && intent.routingVersion !== 2
      || entry.request && (stable(intent.effectBindings) !== stable(entry.request.effectBindings) || stable(intent.discovery ?? null) !== stable(entry.request.discovery ?? null))
      || !entry.request && (Object.keys(p.object(intent.effectBindings,'clarified effect bindings')).length > 0 || intent.discovery !== undefined)
      || run.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash)) p.fail('澄清必须绑定原真人、原候选和当前未执行线程，最多三次')
    assertTtrpgOpenModelActorV1(auth,call.skillId,call.actorKey,entry.viewerKey)
    if (entry.sceneScope && state.entities[entry.actorKey]?.locationKey !== entry.sceneScope.locationRef) p.fail('人工澄清的场景范围不是行动者的实际当前场景')
    call.intentClarifications = [...records,entry]
    parseTtrpgOpenModelCallV1(call)
    state.ttrpg = runtime
    return true
  }
  if (event.type === 'ttrpg.open.intent.rejected') {
    p.exact(payload, ['requestKey', 'candidateHash', 'viewerKey', 'sourceRef', 'intent'], 'intent rejected')
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
    const call = run?.coordination.calls.find(c => c.requestKey === payload.requestKey), epoch = run?.coordination.epochs.find(e => e.epochKey === call?.authorizationEpochKey)
    const intent = p.record(payload.intent, ['requestKey', 'candidateHash', 'viewerKey'], 'rejected intent'), sourceRef = p.record(payload.sourceRef, ['sessionKey', 'sequence'], 'rejection source')
    if (!runtime || !run || !auth || !call || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== payload.viewerKey
      || call.status !== 'succeeded' || call.intentRejection || !['prose.ttrpg-open-intent', 'prose.ttrpg-open-companion'].includes(call.skillId)
      || event.actorKey !== call.actorKey || event.targetKey !== null || sourceRef.sessionKey !== runtime.sessionKey || sourceRef.sequence !== event.sequence
      || intent.requestKey !== call.requestKey || intent.candidateHash !== payload.candidateHash || intent.viewerKey !== payload.viewerKey
      || run.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash)) p.fail('拒绝必须绑定当前真人尚未采用的原候选')
    assertTtrpgOpenModelActorV1(auth, call.skillId, call.actorKey, p.key(payload.viewerKey, 'rejecting human'))
    state.ttrpg = runtime;call.intentRejection = { sourceRef: { sessionKey: runtime.sessionKey, sequence: event.sequence }, candidateHash: p.hash(payload.candidateHash, 'rejected candidate') }
    return true
  }
  if (!['ttrpg.open.call.reserved', 'ttrpg.open.call.dispatched', 'ttrpg.open.call.finished'].includes(event.type)) return false
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun || !runtime.authorization) p.fail('模型调用事件需要已启动 open 团局')
  p.exact(p.object(payload, 'call event'), ['call', 'viewerKey', 'intent'], 'call event')
  const call = parseTtrpgOpenModelCallV1(payload.call)
  const coordination = runtime.openRun.coordination
  const epoch = coordination.epochs.find(epoch => epoch.epochKey === call.authorizationEpochKey)
  const seat = runtime.authorization.seats.find(seat => seat.viewerKey === payload.viewerKey)
  if (!epoch || epoch.status !== 'active' || coordination.activeEpochKey !== epoch.epochKey
    || call.createdRef.sessionKey !== runtime.sessionKey || !seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed'
    || (call.narrationBinding?.viewerKey ?? epoch.viewerKey) !== seat.viewerKey || event.actorKey !== call.actorKey) p.fail('模型调用不属于当前真人授权窗口')
  assertTtrpgOpenEpochPurposeV1(epoch, call.skillId);
  assertTtrpgOpenCommonOracleCallOriginV1(runtime, call)
  assertTtrpgOpenOracleRuntimeCallOriginV1(runtime, call)
  assertTtrpgOpenNormalizationSourceV1(runtime, call)
  assertTtrpgOpenModelActorV1(runtime.authorization, call.skillId, call.actorKey,seat.viewerKey)
  const ref = { sessionKey: runtime.sessionKey, sequence: event.sequence }
  const previousIndex = coordination.calls.findIndex(previous => previous.requestKey === call.requestKey)
  assertTtrpgOpenNarrationCallV1(runtime, call, event.type === 'ttrpg.open.call.reserved' ? 'reserve' : event.type === 'ttrpg.open.call.dispatched' ? 'dispatch' : 'finish')
  if (event.type !== 'ttrpg.open.call.finished' && runtime.openRun.stage.status !== 'open' && !call.narrationBinding && call.skillId !== 'prose.ttrpg-open-brief') p.fail('关闭阶段只能续作已提交后果，不能新预留或发送模型请求')
  if (event.type === 'ttrpg.open.call.reserved') {
    if (previousIndex !== -1 || call.status !== 'prepared' || stable(call.createdRef) !== stable(ref)) p.fail('请求预留身份或初始回执无效')
    if (call.hostingDelegationRef) assertTtrpgOpenHostingRequestV1(state,{ epochKey: epoch.epochKey,viewerKey: seat.viewerKey,delegationRef: call.hostingDelegationRef,
      purpose: call.skillId === 'prose.ttrpg-open-companion' ? 'companion' : 'kp-narration',actorKey: call.actorKey,maximumCostUsd: call.reservedCostUsd })
    assertTtrpgOpenEntityModelCallOriginV1(runtime, call)
    if (call.commonOracle) assertTtrpgOpenOracleInterpretationSlotV1(runtime, call.commonOracle.worldTurn)
    if (call.supportSlot) {
      assertTtrpgOpenSupportSlotV1(runtime,call.supportSlot.worldTurn)
      if (call.supportSlot.worldTurn !== runtime.openRun.worldTime.worldTurn) p.fail('辅助槽不是当前世界轮')
    }
    if (call.oracleInterpretation) {
      assertTtrpgOpenOracleInterpretationSlotV1(runtime, call.oracleInterpretation.worldTurn)
      if (call.oracleInterpretation.worldTurn !== runtime.openRun.worldTime.worldTurn
        || !runtime.openRun.oracleReceipts?.some(receipt => stable(receipt.sourceRef) === stable(call.oracleInterpretation!.oracleSourceRef))) p.fail('Oracle 解释未绑定真实咨询或当前世界轮')
    }
    assertTtrpgOpenCallReservationV1({ epoch, calls: coordination.calls, requestKey: call.requestKey,
      inputTokens: call.reservedInputTokens, outputTokens: call.reservedOutputTokens, maximumCostUsd: call.reservedCostUsd })
    coordination.calls.push(call)
  } else {
    const previous = coordination.calls[previousIndex]
    if (!previous) p.fail('派发/完成缺少真实请求预留')
    const { status: _s, dispatchRef: _d, terminalRef: _t, providerRequestId: _p,
      responseArtifactHash: _r, usage: _u, terminalReason: _reason, ...identity } = call
    const { status: _ps, dispatchRef: _pd, terminalRef: _pt, providerRequestId: _pp,
      responseArtifactHash: _pr, usage: _pu, terminalReason: _preason, ...previousIdentity } = previous
    if (stable(identity) !== stable(previousIdentity)) p.fail('请求生命周期不能更换契约、输入或预算')
    if (event.type === 'ttrpg.open.call.dispatched') {
      if (call.hostingDelegationRef) assertTtrpgOpenHostingDelegationV1(state,{ epochKey: epoch.epochKey,viewerKey: seat.viewerKey,delegationRef: call.hostingDelegationRef })
      if (previous.status !== 'prepared' || call.status !== 'dispatched' || stable(call.dispatchRef) !== stable(ref)) p.fail('只能派发一次真实 prepared 请求')
    } else {
      if (!['prepared', 'dispatched'].includes(previous.status) || !['succeeded', 'failed', 'unknown'].includes(call.status)
        || stable(call.terminalRef) !== stable(ref) || stable(call.dispatchRef) !== stable(previous.dispatchRef)
        || (previous.providerRequestId !== null && previous.providerRequestId !== call.providerRequestId)) p.fail('终态必须闭合同一尚未完成的请求')
    }
    coordination.calls[previousIndex] = call
  }
  updateTtrpgOpenEpochCallTotalsV1(epoch, coordination.calls)
  state.ttrpg = runtime
  return true
}
