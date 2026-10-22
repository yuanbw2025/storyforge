import { assertTtrpgFeedbackOutcomeConsistentV2 } from './action-feedback'
/** Replay a real confirmed candidate. Prose writes cannot change facts, grants, time or resources. */
import type { ProductRuntimeState, ProductRuntimeEvent } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { parseTtrpgOpenNarrationReceiptV1, isTtrpgOpenModelNarrationReceiptV1, type TtrpgOpenHumanNarrationReceiptV1 } from './open-kp-receipt'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import * as p from './open-contract-parse'
import { assertTtrpgOpenDelegatedNarrationV1 } from './open-hosting-delegation'
export function applyTtrpgOpenNarrationEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.narration.accepted', 'ttrpg.open.narration.recorded'].includes(event.type)) return false
  p.exact(payload, ['operationKey', 'frozenPlanHash', 'receipt', 'intent'], 'KP accepted')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) p.fail('KP 叙述需要真实授权团局')
  state.ttrpg = runtime
  const receipt = parseTtrpgOpenNarrationReceiptV1(payload.receipt), n = receipt.binding, operation = run.operations.find(o => o.operationKey === payload.operationKey)
  if (event.type === 'ttrpg.open.narration.recorded') {
    const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'text', 'reason'], 'human narration intent')
    if (isTtrpgOpenModelNarrationReceiptV1(receipt)) p.fail('人工叙述不能冒充模型候选')
    assertTtrpgOpenHumanHostV1(auth, p.key(intent.viewerKey, 'human host'))
    const expected = createTtrpgOpenHumanNarrationReceiptV1(state, { operationKey: p.key(payload.operationKey, 'manual narration operation'), viewerKey: p.key(intent.viewerKey, 'human host'),
      text: p.text(intent.text, 'human narration', 16000), reason: receipt.reason, sequence: event.sequence })
    if (!operation || payload.frozenPlanHash !== operation.planHash || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash || intent.reason !== receipt.reason
      || event.actorKey !== 'gm' || event.targetKey !== null || stable(expected) !== stable(receipt)) p.fail('人工叙述必须绑定当前真实结算、接收者与原调用记录')
    run.narrations = [...(run.narrations ?? []), receipt];operation.businessRefs.push({ stepKey: 'narration', sourceRef: receipt.sourceRef })
    return true
  }
  if (!isTtrpgOpenModelNarrationReceiptV1(receipt)) p.fail('模型采用不能伪造人工来源')
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), call = run.coordination.calls.find(c => c.requestKey === receipt.requestKey)
  const intent = p.record(payload.intent, ['operationKey', 'frozenPlanHash', 'viewerKey', 'requestKey', 'candidateHash',...(receipt.hostingDelegationRef ? ['hostingDelegationRef'] : [])], 'KP confirmation intent')
  if (receipt.hostingDelegationRef) {
    if (!epoch || stable(intent.hostingDelegationRef) !== stable(receipt.hostingDelegationRef)) p.fail('KP 系统采用的委托来源不一致')
    assertTtrpgOpenDelegatedNarrationV1(state,{ epochKey: epoch.epochKey,viewerKey: p.key(intent.viewerKey,'delegating host'),delegationRef: receipt.hostingDelegationRef,requestKey: receipt.requestKey })
  }
  assertTtrpgOpenModelActorV1(auth, 'prose.ttrpg-open-kp', 'gm', p.key(intent.viewerKey, 'KP human confirmer'))
  if (!operation || !epoch || !call || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'narration'
    || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || call.authorizationEpochKey !== epoch.epochKey || call.status !== 'succeeded' || call.skillId !== 'prose.ttrpg-open-kp'
    || stable(call.narrationBinding) !== stable(n) || n.operationKey !== operation.operationKey || n.frozenPlanHash !== operation.planHash
    || payload.frozenPlanHash !== operation.planHash || receipt.sourceRef.sessionKey !== runtime.sessionKey || receipt.sourceRef.sequence !== event.sequence
    || receipt.rawResponseHash !== call.responseArtifactHash || receipt.runContractHash !== call.runContractHash || receipt.inputManifestHash !== call.inputManifestHash || receipt.contextHash !== call.visibilityHash
    || stable(receipt.recipientActorKeys) !== stable([...auth.selectedActorKeys].sort()) || intent.operationKey !== operation.operationKey || intent.frozenPlanHash !== operation.planHash
    || intent.viewerKey !== n.viewerKey || intent.requestKey !== receipt.requestKey || intent.candidateHash !== receipt.candidateHash || event.actorKey !== 'gm' || event.targetKey !== null
    || run.narrations?.some(r => r.binding.operationKey === n.operationKey || isTtrpgOpenModelNarrationReceiptV1(r) && r.requestKey === receipt.requestKey)) p.fail('KP 叙述不是当前实际请求、候选、接收者或本窗口确认')
  run.narrations = [...(run.narrations ?? []), receipt]; operation.businessRefs.push({ stepKey: 'narration', sourceRef: receipt.sourceRef })
  return true
}

/** Actual human-host replacement; all prior requests and charges remain in their original journal. */
export function createTtrpgOpenHumanNarrationReceiptV1(state: ProductRuntimeState, input: { operationKey: string; viewerKey: string; text: string; reason: TtrpgOpenHumanNarrationReceiptV1['reason']; sequence: number }): TtrpgOpenHumanNarrationReceiptV1 {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  const operation = run?.operations.find(o => o.operationKey === input.operationKey), epoch = run?.coordination.epochs.find(e => e.epochKey === operation?.authorizationEpochKey), rule = run?.ruleReceipts.find(r => r.operationKey === input.operationKey)
  if (!runtime || !run || !auth || !operation || !epoch || !rule || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'narration'
    || operation.businessRefs.some(r => r.stepKey === 'narration') || run.narrations?.some(r => r.binding.operationKey === input.operationKey)
    || runtime.product.safety.status !== 'active' || epoch.status !== 'active' || epoch.epochKey !== run.coordination.activeEpochKey) p.fail('只有本窗口已完成结算/检查的行动可以补写一次人工叙述')
  assertTtrpgOpenHumanHostV1(auth, input.viewerKey)
  const calls = run.coordination.calls.filter(c => c.authorizationEpochKey === epoch.epochKey)
  if (calls.some(c => c.status === 'prepared' || c.status === 'dispatched')) p.fail('仍有已准备或已发送请求，请先停止/核对原请求，不能与人工叙述并行')
  const previousRequests = calls.filter(c => c.narrationBinding?.operationKey === operation.operationKey).map(c => ({ requestKey: c.requestKey, status: p.oneOf(c.status, ['succeeded', 'failed', 'unknown'], 'original terminal request'), terminalRef: c.terminalRef!, responseArtifactHash: c.responseArtifactHash })).sort((a, b) => a.requestKey.localeCompare(b.requestKey))
  const text = input.text.trim().normalize('NFC')
  if (operation.plan.rollVisibility === 'public') assertTtrpgFeedbackOutcomeConsistentV2(text, rule.result.outcome)
  const receipt = parseTtrpgOpenNarrationReceiptV1({ sourceKind: 'human', sourceRef: { sessionKey: runtime.sessionKey, sequence: input.sequence },
    binding: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, ruleSourceRef: ttrpgOpenPressureRuleSourceV1(rule), viewerKey: input.viewerKey, audience: 'party' },
    authorizationRef: auth.sourceRef, recipientActorKeys: [...auth.selectedActorKeys].sort(), reason: input.reason,
    narration: { paragraphs: text.split(/\n\s*\n/).filter(Boolean).map(text => ({ text, sourceKeys: ['action.receipt'] })) }, allowedSourceKeys: ['action.receipt'],
    basis: { outcome: operation.plan.rollVisibility === 'public' ? rule.result.outcome : 'not-public', paidWorldTurns: operation.plan.timeCostWorldTurns, previousRequests } })
  if (isTtrpgOpenModelNarrationReceiptV1(receipt)) return p.fail('人工来源解析失败')
  return receipt
}
