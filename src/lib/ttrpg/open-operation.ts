import { parseTtrpgOpenPrivateChoiceDisclosureV1,type TtrpgOpenPrivateChoiceDisclosureV1 } from './open-private-choice-contract'
import { parseTtrpgOpenHandoffV1, type TtrpgOpenHandoffV1 } from './open-handoff'
import { parseTtrpgOpenCompanionPreauthorizationV1, type TtrpgOpenCompanionPreauthorizationV1 } from './open-companion-preauthorization'
/** Pure operation journal: only frozen plans, authority decisions and real event references. */
import type { TtrpgRuntimeState } from '../types'
import type { TtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { parseTtrpgMechanicalResultV1 } from './rule-action-mechanical'
import { parseTtrpgOpenRulePlanV1, type TtrpgOpenRulePlanV1 } from './open-rule-plan'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'

export const TTRPG_OPEN_POST_OWNER_STEPS = ['pressure', 'situations', 'terminal', 'gates', 'narration', 'handoff'] as const
export type TtrpgOpenOperationStepKindV1 = 'rule' | 'mechanics' | 'effect' | 'knowledge' | 'time' | typeof TTRPG_OPEN_POST_OWNER_STEPS[number]
export interface TtrpgOpenOperationStepV1 { stepKey: string; kind: TtrpgOpenOperationStepKindV1; tickIndex: number | null }
export interface TtrpgOpenOperationApprovalV1 {
  actorKey: string; approverSeatKey: string; viewerKey: string; decision: 'approve' | 'reject'; sourceRef: TtrpgOpenSourceRefV1
}
export interface TtrpgOpenOperationReceiptV1 { stepKey: string; businessRef: TtrpgOpenSourceRefV1; completedRef: TtrpgOpenSourceRefV1 }
export interface TtrpgOpenDiscoveryChoiceV1 {
  templateKey: string; alternativeKey: string; selectionRef: TtrpgOpenSourceRefV1
}
export interface TtrpgOpenOperationV1 {
  settlementOrder?: 'per-world-turn-v1'
  privateChoiceDisclosures?: TtrpgOpenPrivateChoiceDisclosureV1[]
  operationKey: string
  rootCommandId: string
  inputHash: string
  planHash: string
  riskHash: string
  authorizationEpochKey: string
  startedRef: TtrpgOpenSourceRefV1
  status: 'awaiting-approval' | 'executing' | 'rejected' | 'stale' | 'completed'
  plan: TtrpgOpenRulePlanV1
  plannedSteps: TtrpgOpenOperationStepV1[]
  approvals: TtrpgOpenOperationApprovalV1[]
  handoff?: TtrpgOpenHandoffV1
  preauthorization?: TtrpgOpenCompanionPreauthorizationV1
  businessRefs: Array<{ stepKey: string; sourceRef: TtrpgOpenSourceRefV1 }>
  receipts: TtrpgOpenOperationReceiptV1[]
  completedRef: TtrpgOpenSourceRefV1 | null
  pendingChoice: { templateKey: string; selectedAlternativeKey: string | null; selectionRef: TtrpgOpenSourceRefV1 | null } | null
  pressureTurnConditions?: Array<{ tickIndex: number; worldTurn: number; sourceRef: TtrpgOpenSourceRefV1; conditions: TtrpgRuntimeState['product']['conditions'] }>
  discoveryChoices?: TtrpgOpenDiscoveryChoiceV1[]
  intentEvidence?: {
    sourceRef: TtrpgOpenSourceRefV1; candidateHash: string; runContractHash: string; inputManifestHash: string; rawResponseHash: string
    hostingDelegationRef?: TtrpgOpenSourceRefV1
  }
  inheritance?: {
    taskKey: string; ancestorSessionKey: string; ancestorOperationKey: string
    coveredStepKeys: string[]; ruleCauseRef: TtrpgOpenSourceRefV1; originalRuleRef: TtrpgOpenSourceRefV1
    selectedAlternativeKey: string | null
    discoveryChoices?: Array<{ templateKey: string; alternativeKey: string }>
  }
}
export interface TtrpgOpenRuleReceiptV1 {
  operationKey: string; sourceRef: TtrpgOpenSourceRefV1; frozenPlanHash: string; result: TtrpgMechanicalResultV1
  inheritedFrom?: { originalSourceRef: TtrpgOpenSourceRefV1 }
}
export function assertTtrpgOpenOperationIntentCallV1(operation: TtrpgOpenOperationV1, calls: readonly TtrpgOpenModelCallV1[]): void {
  const evidence = operation.intentEvidence
  if (!evidence) return
  if (!calls.some(call => call.status === 'succeeded' && !call.intentRejection && call.actorKey === operation.plan.request.actorKey
    && call.authorizationEpochKey === operation.authorizationEpochKey && call.runContractHash === evidence.runContractHash
    && call.inputManifestHash === evidence.inputManifestHash && call.responseArtifactHash === evidence.rawResponseHash
    && (!evidence.hostingDelegationRef || call.skillId === 'prose.ttrpg-open-companion' && JSON.stringify(call.hostingDelegationRef) === JSON.stringify(evidence.hostingDelegationRef))
    && call.terminalRef?.sessionKey === evidence.sourceRef.sessionKey && call.terminalRef.sequence === evidence.sourceRef.sequence)) {
    p.fail('意图候选没有同角色/窗口/原始响应的真实终态请求')
  }
}
export function ttrpgOpenOperationStepsV1(plan: TtrpgOpenRulePlanV1,settlementOrder?: TtrpgOpenOperationV1['settlementOrder']): TtrpgOpenOperationStepV1[] {
  return [
    { stepKey: 'rule', kind: 'rule', tickIndex: null },
    { stepKey: 'mechanics', kind: 'mechanics', tickIndex: null },
    ...(plan.effectTemplates.length ? [{ stepKey: 'effect', kind: 'effect' as const, tickIndex: null }] : []),
    ...(plan.discoveryPlan ? [{ stepKey: 'knowledge', kind: 'knowledge' as const, tickIndex: null }] : []),
    ...Array.from({ length: plan.timeCostWorldTurns }, (_, index) => [
      { stepKey: `time.${index + 1}`, kind: 'time' as const, tickIndex: index + 1 },
      ...(settlementOrder ? ['pressure','situations'].map(kind => ({ stepKey: `${kind}.${index + 1}`,kind: kind as 'pressure' | 'situations',tickIndex: index + 1 })) : []),
    ]).flat(),
    ...TTRPG_OPEN_POST_OWNER_STEPS.filter(kind => !settlementOrder || !['pressure','situations'].includes(kind)).map(kind => ({ stepKey: kind, kind, tickIndex: null })),
  ]
}
export function parseTtrpgOpenOperationV1(value: unknown, sessionKey?: string): TtrpgOpenOperationV1 {
  const hasOrder = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'settlementOrder')
  const hasPrivateChoices = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'privateChoiceDisclosures')
  const hasInheritance = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'inheritance')
  const hasPressureTurns = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'pressureTurnConditions')
  const hasDiscoveryChoices = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discoveryChoices')
  const hasHandoff = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'handoff')
  const hasPreauthorization = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'preauthorization')
  const hasIntentEvidence = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'intentEvidence')
  const r = p.record(value, ['operationKey', 'rootCommandId', 'inputHash', 'planHash', 'riskHash', 'authorizationEpochKey',
    'startedRef', 'status', 'plan', ...(hasOrder ? ['settlementOrder'] : []), 'plannedSteps', 'approvals', 'businessRefs', 'receipts', 'completedRef', 'pendingChoice', ...(hasPrivateChoices ? ['privateChoiceDisclosures'] : []),
    ...(hasHandoff ? ['handoff'] : []), ...(hasPreauthorization ? ['preauthorization'] : []), ...(hasInheritance ? ['inheritance'] : []), ...(hasIntentEvidence ? ['intentEvidence'] : []), ...(hasDiscoveryChoices ? ['discoveryChoices'] : []), ...(hasPressureTurns ? ['pressureTurnConditions'] : [])], 'operation')
  const plan = parseTtrpgOpenRulePlanV1(r.plan)
  const settlementOrder = hasOrder ? p.literal(r.settlementOrder,'per-world-turn-v1','settlement order') as 'per-world-turn-v1' : undefined
  if (settlementOrder && plan.timeCostWorldTurns < 2) p.fail('逐轮结算版本只用于多轮行动')
  const startedRef = parseTtrpgOpenSourceRefV1(r.startedRef)
  const privateChoiceDisclosures = hasPrivateChoices ? p.list(r.privateChoiceDisclosures,'private choice disclosures',parseTtrpgOpenPrivateChoiceDisclosureV1,100,0) : undefined
  if (privateChoiceDisclosures?.some((d,index) => d.body.planHash !== r.planHash || d.body.riskHash !== r.riskHash || d.body.authorizationEpochKey !== r.authorizationEpochKey
    || d.body.actorKey !== plan.request.actorKey || d.sourceRef.sessionKey !== startedRef.sessionKey || d.sourceRef.sequence <= startedRef.sequence
    || d.body.ruleSourceRef.sessionKey !== startedRef.sessionKey || d.body.ruleSourceRef.sequence >= d.sourceRef.sequence
    || index > 0 && d.sourceRef.sequence <= privateChoiceDisclosures[index - 1].sourceRef.sequence)) p.fail('保密告知必须引用本操作的实际有序裁定与来源')

  const intentEvidence = hasIntentEvidence ? (() => {
    const hasDelegation = Object.prototype.hasOwnProperty.call(p.object(r.intentEvidence,'intent evidence'),'hostingDelegationRef')
    const e = p.record(r.intentEvidence, ['sourceRef', 'candidateHash', 'runContractHash', 'inputManifestHash', 'rawResponseHash',...(hasDelegation ? ['hostingDelegationRef'] : [])], 'intent evidence')
    const sourceRef = parseTtrpgOpenSourceRefV1(e.sourceRef)
    const hostingDelegationRef = hasDelegation ? parseTtrpgOpenSourceRefV1(e.hostingDelegationRef) : undefined
    if (hostingDelegationRef && (plan.request.controllerMode !== 'ai' || hostingDelegationRef.sessionKey !== sourceRef.sessionKey
      || hostingDelegationRef.sequence >= sourceRef.sequence)) p.fail('队友系统提案必须绑定真实先前委托，不能冒充真人意图')
    if (hasInheritance || sourceRef.sessionKey !== startedRef.sessionKey || sourceRef.sequence >= startedRef.sequence) {
      p.fail('当前意图候选必须引用本团局已提交响应；继承操作保留祖先原证据')
    }
    return { ...(hostingDelegationRef ? { hostingDelegationRef } : {}),sourceRef, candidateHash: p.hash(e.candidateHash, 'candidate hash'), runContractHash: p.hash(e.runContractHash, 'intent run'),
      inputManifestHash: p.hash(e.inputManifestHash, 'intent input'), rawResponseHash: p.hash(e.rawResponseHash, 'intent raw response') }
  })() : undefined
  const inheritance = hasInheritance ? (() => {
    const hasChoices = Object.prototype.hasOwnProperty.call(p.object(r.inheritance, 'inheritance'), 'discoveryChoices')
    const i = p.record(r.inheritance, ['taskKey', 'ancestorSessionKey', 'ancestorOperationKey', 'coveredStepKeys',
      'ruleCauseRef', 'originalRuleRef', 'selectedAlternativeKey', ...(hasChoices ? ['discoveryChoices'] : [])], 'operation inheritance')
    const coveredStepKeys = p.keys(i.coveredStepKeys, 'covered business steps', 100, 1)
    const full = ttrpgOpenOperationStepsV1(plan,settlementOrder)
    const ruleCauseRef = parseTtrpgOpenSourceRefV1(i.ruleCauseRef), originalRuleRef = parseTtrpgOpenSourceRefV1(i.originalRuleRef)
    if (coveredStepKeys.length > full.length || coveredStepKeys.some((key, index) => key !== full[index].stepKey)
      || ruleCauseRef.sessionKey !== startedRef.sessionKey || ruleCauseRef.sequence >= startedRef.sequence
      || originalRuleRef.sessionKey === startedRef.sessionKey) p.fail('继承必须覆盖真实业务前缀并引用本地继承回执')
    const discoveryChoices = hasChoices ? p.list(i.discoveryChoices, 'inherited discovery choices', value => {
      const c = p.record(value, ['templateKey', 'alternativeKey'], 'inherited discovery choice')
      const templateKey = p.key(c.templateKey, 'discovery choice template'), alternativeKey = p.key(c.alternativeKey, 'discovery alternative')
      if (!plan.discoveryPlan?.effectTemplates.find(template => template.planKey === templateKey)?.alternatives.some(a => a.alternativeKey === alternativeKey)) p.fail('继承发现选择不属于冻结选项')
      return { templateKey, alternativeKey }
    }, 2, 1) : undefined
    if (discoveryChoices && new Set(discoveryChoices.map(c => c.templateKey)).size !== discoveryChoices.length) p.fail('继承发现选择重复')
    return { taskKey: p.key(i.taskKey, 'inherit task'), ancestorSessionKey: p.key(i.ancestorSessionKey, 'inherit ancestor'),
      ancestorOperationKey: p.key(i.ancestorOperationKey, 'ancestor operation'), coveredStepKeys, ruleCauseRef, originalRuleRef,
      selectedAlternativeKey: p.nullable(i.selectedAlternativeKey, p.key, 'inherited alternative'), ...(discoveryChoices ? { discoveryChoices } : {}) }
  })() : undefined
  const preauthorization = hasPreauthorization ? parseTtrpgOpenCompanionPreauthorizationV1(r.preauthorization) : undefined
  if (preauthorization && (!intentEvidence || preauthorization.candidateHash !== intentEvidence.candidateHash || plan.request.controllerMode !== 'ai' || preauthorization.sourceRef.sessionKey !== startedRef.sessionKey || preauthorization.sourceRef.sequence <= startedRef.sequence || preauthorization.authorizationRef.sessionKey !== startedRef.sessionKey || preauthorization.authorizationRef.sequence >= startedRef.sequence || plan.requiredApprovals.length !== 1 || plan.requiredApprovals[0].actorKey !== plan.request.actorKey)) p.fail('预授权必须绑定实际 AI 候选、原真人同意及当前系统准入事件')
  const status = p.oneOf(r.status, ['awaiting-approval', 'executing', 'rejected', 'stale', 'completed'], 'operation status')
  const completedRef = r.completedRef === null ? null : parseTtrpgOpenSourceRefV1(r.completedRef)
  const pendingChoice = r.pendingChoice === null ? null : (() => {
    const c = p.record(r.pendingChoice, ['templateKey', 'selectedAlternativeKey', 'selectionRef'], 'pending effect choice')
    const templateKey = p.key(c.templateKey, 'choice template')
    const template = plan.effectTemplates.find(template => template.planKey === templateKey)
    const selectedAlternativeKey = p.nullable(c.selectedAlternativeKey, p.key, 'selected alternative')
    const selectionRef = c.selectionRef === null ? null : parseTtrpgOpenSourceRefV1(c.selectionRef)
    if (!template?.alternatives.length || (selectedAlternativeKey === null) !== (selectionRef === null)
      || (selectedAlternativeKey !== null && !template.alternatives.some(alternative => alternative.alternativeKey === selectedAlternativeKey))) p.fail('待选后果不属于冻结选项')
    return { templateKey, selectedAlternativeKey, selectionRef }
  })()
  const discoveryChoices = hasDiscoveryChoices ? p.list(r.discoveryChoices, 'discovery choices', value => {
    const c = p.record(value, ['templateKey', 'alternativeKey', 'selectionRef'], 'discovery choice')
    const templateKey = p.key(c.templateKey, 'discovery choice template'), alternativeKey = p.key(c.alternativeKey, 'discovery alternative')
    if (!plan.discoveryPlan?.effectTemplates.find(template => template.planKey === templateKey)?.alternatives.some(a => a.alternativeKey === alternativeKey)) p.fail('发现选择不属于冻结选项')
    return { templateKey, alternativeKey, selectionRef: parseTtrpgOpenSourceRefV1(c.selectionRef) }
  }, 2, 1) : undefined
  if (discoveryChoices && new Set(discoveryChoices.map(c => c.templateKey)).size !== discoveryChoices.length) p.fail('发现选择重复')
  const pressureTurnConditions = hasPressureTurns ? p.list(r.pressureTurnConditions, 'pressure turn conditions', value => {
    const t = p.record(value, ['tickIndex', 'worldTurn', 'sourceRef', 'conditions'], 'pressure turn basis')
    const conditions = Object.fromEntries(Object.entries(p.object(t.conditions, 'pressure conditions')).map(([actor, raw]) => [p.key(actor, 'condition actor'), p.list(raw, 'condition list', value => {
      const c = p.record(value, ['conditionKey', 'stacks', 'duration'], 'pressure condition')
      return { conditionKey: p.key(c.conditionKey, 'condition key'), stacks: p.integer(c.stacks, 'condition stacks', 1, 1000), duration: p.nullable(c.duration, (v, l) => p.integer(v, l, 1, 1000000), 'condition duration') }
    }, 1000)]))
    return { tickIndex: p.integer(t.tickIndex, 'pressure tick index', 1, plan.timeCostWorldTurns), worldTurn: p.integer(t.worldTurn, 'pressure world turn'), sourceRef: parseTtrpgOpenSourceRefV1(t.sourceRef), conditions }
  }, 10, 1) : undefined
  if (pressureTurnConditions && (new Set(pressureTurnConditions.map(t => t.tickIndex)).size !== pressureTurnConditions.length || pressureTurnConditions.some((t, i) => i && t.tickIndex <= pressureTurnConditions[i - 1].tickIndex))) p.fail('压力轮次依据必须按实际耗时有序且唯一')
  const plannedSteps = p.list(r.plannedSteps, 'plannedSteps', value => {
    const s = p.record(value, ['stepKey', 'kind', 'tickIndex'], 'planned step')
    return { stepKey: p.key(s.stepKey, 'stepKey'), kind: p.oneOf(s.kind, ['rule', 'mechanics', 'effect', 'knowledge', 'time', ...TTRPG_OPEN_POST_OWNER_STEPS], 'step kind'),
      tickIndex: p.nullable(s.tickIndex, (v, l) => p.integer(v, l, 1, 10), 'tick index') }
  }, 4096, inheritance ? 0 : 1)
  if (JSON.stringify(plannedSteps) !== JSON.stringify(ttrpgOpenOperationStepsV1(plan,settlementOrder).slice(inheritance?.coveredStepKeys.length ?? 0))) p.fail('冻结操作步骤不一致')
  const approvals = p.list(r.approvals, 'approvals', value => {
    const a = p.record(value, ['actorKey', 'approverSeatKey', 'viewerKey', 'decision', 'sourceRef'], 'approval')
    return { actorKey: p.key(a.actorKey, 'approval actor'), approverSeatKey: p.key(a.approverSeatKey, 'approver seat'),
      viewerKey: p.key(a.viewerKey, 'viewerKey'), decision: p.oneOf(a.decision, ['approve', 'reject'], 'decision'), sourceRef: parseTtrpgOpenSourceRefV1(a.sourceRef) }
  }, 1000)
  const businessRefs = p.list(r.businessRefs, 'businessRefs', value => {
    const b = p.record(value, ['stepKey', 'sourceRef'], 'business ref')
    return { stepKey: p.key(b.stepKey, 'stepKey'), sourceRef: parseTtrpgOpenSourceRefV1(b.sourceRef) }
  }, 4096)
  const receipts = p.list(r.receipts, 'receipts', value => {
    const s = p.record(value, ['stepKey', 'businessRef', 'completedRef'], 'step receipt')
    return { stepKey: p.key(s.stepKey, 'stepKey'), businessRef: parseTtrpgOpenSourceRefV1(s.businessRef), completedRef: parseTtrpgOpenSourceRefV1(s.completedRef) }
  }, 4096)
  if (pressureTurnConditions?.some(t => t.sourceRef.sessionKey === startedRef.sessionKey
    ? t.sourceRef.sequence <= startedRef.sequence || !businessRefs.some(b => b.stepKey === `time.${t.tickIndex}` && b.sourceRef.sequence === t.sourceRef.sequence)
    : !inheritance?.coveredStepKeys.includes(`time.${t.tickIndex}`))) p.fail('压力轮次依据必须引用实际本地或继承耗时事件')
  if (new Set(approvals.map(a => a.actorKey)).size !== approvals.length || new Set(businessRefs.map(b => b.stepKey)).size !== businessRefs.length
    || new Set(receipts.map(s => s.stepKey)).size !== receipts.length
    || (sessionKey !== undefined && startedRef.sessionKey !== sessionKey)
    || [...approvals.map(a => a.sourceRef), ...businessRefs.map(b => b.sourceRef), ...receipts.flatMap(s => [s.businessRef, s.completedRef]), ...(completedRef ? [completedRef] : []), ...(pendingChoice?.selectionRef ? [pendingChoice.selectionRef] : []), ...(discoveryChoices?.map(c => c.selectionRef) ?? [])]
      .some(ref => ref.sessionKey !== startedRef.sessionKey || ref.sequence <= startedRef.sequence)
    || businessRefs.some(b => !plannedSteps.some(s => s.stepKey === b.stepKey))
    || receipts.some(s => !businessRefs.some(b => b.stepKey === s.stepKey && b.sourceRef.sequence === s.businessRef.sequence)
      || s.completedRef.sequence <= s.businessRef.sequence)
    || ((status === 'completed') !== (completedRef !== null))) p.fail('operation 回执/来源/终态不一致')
  if (receipts.some((receipt, index) => receipt.stepKey !== plannedSteps[index]?.stepKey)) p.fail('步骤回执必须按冻结顺序完成')
  if (businessRefs.some((business, index) => business.stepKey !== plannedSteps[index]?.stepKey
      || (index > 0 && business.sourceRef.sequence <= receipts[index - 1]?.completedRef.sequence))
    || businessRefs.length < receipts.length || businessRefs.length > receipts.length + 1
    || approvals.some(approval => !plan.requiredApprovals.some(required => required.actorKey === approval.actorKey && required.allowedSeatKeys.includes(approval.approverSeatKey)))
    || (['executing', 'completed'].includes(status) && !preauthorization && !plan.requiredApprovals.every(required => approvals.some(approval => approval.actorKey === required.actorKey && approval.decision === 'approve')))
    || (status === 'rejected' && !approvals.some(approval => approval.decision === 'reject'))
    || (['awaiting-approval', 'rejected', 'stale'].includes(status) && (businessRefs.length > 0 || pendingChoice !== null || Boolean(discoveryChoices)))
    || (completedRef !== null && (receipts.length !== plannedSteps.length
      || completedRef.sequence <= (receipts[receipts.length - 1]?.completedRef.sequence ?? startedRef.sequence)))) p.fail('操作状态与批准/有序业务证据不一致')
  const handoff = hasHandoff ? parseTtrpgOpenHandoffV1(r.handoff) : undefined
  if (handoff && (handoff.sourceRef.sessionKey !== startedRef.sessionKey || !businessRefs.some(b => b.stepKey === 'handoff' && b.sourceRef.sequence === handoff.sourceRef.sequence))) p.fail('交接必须引用本操作真实有序业务事件')
  return { operationKey: p.key(r.operationKey, 'operationKey'), rootCommandId: p.key(r.rootCommandId, 'rootCommandId'),
    inputHash: p.hash(r.inputHash, 'inputHash'), planHash: p.hash(r.planHash, 'planHash'), riskHash: p.hash(r.riskHash, 'riskHash'),
    ...(settlementOrder ? { settlementOrder } : {}), authorizationEpochKey: p.key(r.authorizationEpochKey, 'epochKey'), startedRef, status, plan, plannedSteps,
    approvals, businessRefs, receipts, completedRef, pendingChoice, ...(hasPrivateChoices ? { privateChoiceDisclosures } : {}), ...(handoff ? { handoff } : {}), ...(preauthorization ? { preauthorization } : {}), ...(inheritance ? { inheritance } : {}), ...(intentEvidence ? { intentEvidence } : {}), ...(discoveryChoices ? { discoveryChoices } : {}), ...(pressureTurnConditions ? { pressureTurnConditions } : {}) }
}
export function parseTtrpgOpenRuleReceiptV1(value: unknown): TtrpgOpenRuleReceiptV1 {
  const hasInheritance = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'inheritedFrom')
  const r = p.record(value, ['operationKey', 'sourceRef', 'frozenPlanHash', 'result', ...(hasInheritance ? ['inheritedFrom'] : [])], 'rule receipt')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef)
  const inheritedFrom = hasInheritance ? (() => {
    const i = p.record(r.inheritedFrom, ['originalSourceRef'], 'rule origin')
    const originalSourceRef = parseTtrpgOpenSourceRefV1(i.originalSourceRef)
    if (originalSourceRef.sessionKey === sourceRef.sessionKey) p.fail('继承裁定必须保留祖先随机来源')
    return { originalSourceRef }
  })() : undefined
  return { operationKey: p.key(r.operationKey, 'operationKey'), sourceRef,
    frozenPlanHash: p.hash(r.frozenPlanHash, 'frozenPlanHash'), result: parseTtrpgMechanicalResultV1(r.result),
    ...(inheritedFrom ? { inheritedFrom } : {}) }
}
export function ttrpgOpenOperationRuleCauseV1(operation: TtrpgOpenOperationV1): TtrpgOpenSourceRefV1 | null {
  return operation.businessRefs.find(ref => ref.stepKey === 'rule')?.sourceRef ?? operation.inheritance?.ruleCauseRef ?? null
}
export function nextTtrpgOpenOperationStepV1(operation: TtrpgOpenOperationV1): TtrpgOpenOperationStepV1 | null {
  return operation.plannedSteps[operation.receipts.length] ?? null
}
