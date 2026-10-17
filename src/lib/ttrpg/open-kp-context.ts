import type { TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
export { parseTtrpgOpenNarrationBindingV1, type TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
/** KP sees a party intersection of actual player projections, never the GM Oracle head. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { loadTtrpgOpenKpPartyProjectionV1 } from './open-player-context'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationRowsCurrentV1 } from './open-authorization'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
export async function loadTtrpgOpenKpContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-kp] KP 请求必须使用明确主持身份')
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-kp] Instance 不是跑团')
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  if (source.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('[ttrpg-kp] 实例来源不一致')
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content)) throw new Error('[ttrpg-kp] KP 只读冻结 open 内容')
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, auth = runtime?.authorization
  if (!runtime || !run || !auth) throw new Error('[ttrpg-kp] 团局尚未授权')
  const operation = run.operations.find(o => o.status === 'executing' && nextTtrpgOpenOperationStepV1(o)?.kind === 'narration')
  if (!operation || operation.businessRefs.some(r => r.stepKey === 'narration') || run.coordination.activeEpochKey !== operation.authorizationEpochKey || runtime.product.safety.status !== 'active') throw new Error('[ttrpg-kp] KP 只能接在本窗口实际结算和运行检查之后')
  const rule = run.ruleReceipts.find(r => r.operationKey === operation.operationKey)
  if (!rule) throw new Error('[ttrpg-kp] 叙述缺少真实规则裁定')
  const recipients = [...auth.selectedActorKeys].sort()
  const common = await loadTtrpgOpenKpPartyProjectionV1(input)
  const { actorsHere: actors, initialObservations: initial, knowledge, sessionFacts, pressureSignals: signals } = common.view
  const visibleActorKeys = new Set(actors.map(actor => actor.actorKey))
  const entries = [
    { sourceKey: 'action.receipt', kind: 'rule-receipt', value: { actorKey: visibleActorKeys.has(operation.plan.request.actorKey) ? operation.plan.request.actorKey : null,
      result: operation.plan.rollVisibility === 'public' ? rule.result.outcome : 'not-public', paidWorldTurns: operation.plan.timeCostWorldTurns } },
    ...initial.map((value, i) => ({ sourceKey: `initial.${i}`, kind: 'release-observation', value })),
    ...knowledge.map((value, i) => ({ sourceKey: `knowledge.${i}`, kind: 'known-evidence', value })),
    ...sessionFacts.map((value, i) => ({ sourceKey: `fact.${i}`, kind: 'confirmed-session-fact', value })),
    ...signals.map((value, i) => ({ sourceKey: `signal.${i}`, kind: 'published-telegraph', value })),
  ]
  const binding: Omit<TtrpgOpenNarrationBindingV1, 'viewerKey'> = { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, ruleSourceRef: ttrpgOpenPressureRuleSourceV1(rule), audience: 'party' }
  const promptBinding = { operationKey: binding.operationKey, frozenPlanHash: binding.frozenPlanHash, audience: binding.audience }
  const contract = { schema: 'storyforge.ttrpg-open-kp-contract', version: 1, binding: promptBinding, allowedSourceKeys: entries.map(e => e.sourceKey),
    output: { paragraphs: [{ text: '叙述', sourceKeys: ['action.receipt'] }] }, factsAndMechanicalWritesForbidden: true, unknownReferencesForbidden: true,
    recipientSetFrozen: true, onlyPartyIntersection: true, noGmSecretsOrOtherActorPrivate: true }
  const packet = { schema: 'storyforge.ttrpg-open-kp-input', version: 1, binding: promptBinding, recipientActorKeys: recipients,
    phase: { status: run.stage.status, worldTurn: run.worldTime.worldTurn }, actors, entries: entries.map(entry => ({ ...entry, value: stripProofMetadata(entry.value) })) }
  const resources = [{ suffix: 'kp-contract', title: 'KP 只读叙述与引用合同', value: contract, mandatory: true },
    { suffix: 'kp-input', title: '实际结算与共同可见资料', value: packet, mandatory: true }]
  const modernResources = [
    { suffix: 'kp-contract.v2', title: 'KP 只读叙述与实际交付引用合同', mandatory: true,
      value: { ...contract, version: 2, allowedSourceKeys: ['action.receipt'], additionalCitationsOnlyFromDeliveredEntries: true } },
    { suffix: 'kp-input.v2', title: '本次结算、共同可见场景与阶段', mandatory: true,
      value: { ...packet, version: 2, entries: packet.entries.filter(entry => entry.sourceKey === 'action.receipt') } },
    ...packet.entries.filter(entry => entry.sourceKey !== 'action.receipt').map(entry => ({
      suffix: `kp-entry.${entry.sourceKey}`, title: `共同可见来源 · ${entry.sourceKey}`, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-kp-delivered-entry', version: 1, entry } })),
  ]
  const visibilityHash = await hashProductProductionValueV2({ contract, packet }), admissionStateHash = await hashProductProductionValueV2({ binding, visibilityHash })
  const stateHash = await hashProductRuntimeStateV1(state), head = await readProductRuntimeStateVersion(input.sessionId)
  if (head.sequence !== state.lastSequence || head.stateHash !== stateHash || common.readEvidence.sequence !== state.lastSequence || common.readEvidence.stateHash !== stateHash
    || common.readEvidence.runtimeSourceHash !== session.runtimeSourceHash || stable(common.recipientActorKeys) !== stable(recipients)) throw new TtrpgOpenReadConflictV1('[ttrpg-kp] 读取期间结算或接收者视图发生变化')
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: auth, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  return { resources, modernResources, predicateFacts: { worldFacts: initial, sessionFacts }, binding, visibilityHash, admissionStateHash, readEvidence: { sequence: state.lastSequence, stateHash, runtimeSourceHash: session.runtimeSourceHash, sessionKey: runtime.sessionKey } }
}

function stripProofMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProofMetadata)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['sourceRef', 'acquisitionRef', 'retiredRef', 'knownByActorKeys', 'origin', 'sourceSessionKey', 'sourceSequence'].includes(key)).map(([key, v]) => [key, stripProofMetadata(v)]))
}

