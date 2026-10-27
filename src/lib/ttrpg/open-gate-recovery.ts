import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1, ttrpgOpenSessionSituationDiscoveryPolicyV1 } from './open-session-situation-catalog'
/** Bounded real recovery. Receipts record admission/knowledge, never a replacement gate boolean. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenGateBasisJsonV1, ttrpgOpenGateHumanActorsV1 } from './open-terminal-gates'
import { TTRPG_OPEN_GATE_KEYS, type TtrpgOpenGateKeyV1 } from './open-gates'
import { sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { settleTtrpgOpenSituationQueueV1, ttrpgOpenSituationGateContextV1 } from './open-situation-runtime'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { ttrpgOpenActorKnowsEvidenceV1, parseTtrpgOpenKnowledgeEntryV1, ttrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export interface TtrpgOpenGateRecoveryV1 {
  recoveryKey: string; sourceRef: TtrpgOpenSourceRefV1; operationKey: string; frozenPlanHash: string; authorizationEpochKey: string;
  actorKey: string; viewerKey: string; gateKey: TtrpgOpenGateKeyV1; evaluationRef: TtrpgOpenSourceRefV1; evaluationBasisHash: string;
  action: 'queue' | 'evidence' | 'none'; targetRef: string | null;
  result: 'activated' | 'retained' | 'duplicate' | 'rejected' | 'observed' | 'unavailable'; reason: string | null;
  publicFieldsHash: string | null; publicFieldsJson: string | null;
  stoppedRef: TtrpgOpenSourceRefV1 | null; failedEvaluationRefs: TtrpgOpenSourceRefV1[]; stopReason: string | null;
}
export function parseTtrpgOpenGateRecoveryV1(value: unknown): TtrpgOpenGateRecoveryV1 {
  const r = p.record(value, ['recoveryKey','sourceRef','operationKey','frozenPlanHash','authorizationEpochKey','actorKey','viewerKey','gateKey','evaluationRef','evaluationBasisHash','action','targetRef','result','reason','publicFieldsHash','publicFieldsJson','stoppedRef','failedEvaluationRefs','stopReason'], 'gate recovery')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), evaluationRef = parseTtrpgOpenSourceRefV1(r.evaluationRef)
  const action = p.oneOf(r.action, ['queue','evidence','none'], 'recovery action'), result = p.oneOf(r.result, ['activated','retained','duplicate','rejected','observed','unavailable'], 'recovery result')
  const targetRef = p.nullable(r.targetRef, p.key, 'recovery target'), publicFieldsHash = p.nullable(r.publicFieldsHash, p.hash, 'recovered fields hash'), publicFieldsJson = p.nullable(r.publicFieldsJson, p.text, 'recovered fields')
  const stoppedRef = p.nullable(r.stoppedRef, parseTtrpgOpenSourceRefV1, 'recovery stop'), failedEvaluationRefs = p.list(r.failedEvaluationRefs, 'failed evaluations', parseTtrpgOpenSourceRefV1, 1000), stopReason = p.nullable(r.stopReason, p.text, 'recovery stop reason')
  if (new Set(failedEvaluationRefs.map(ref => `${ref.sessionKey}:${ref.sequence}`)).size !== failedEvaluationRefs.length) p.fail('停止评估来源重复')
  if (sourceRef.sessionKey !== evaluationRef.sessionKey || evaluationRef.sequence >= sourceRef.sequence
    || action === 'none' && (targetRef !== null || result !== 'unavailable') || action !== 'none' && targetRef === null
    || action === 'queue' && !['activated','retained','duplicate','rejected'].includes(result)
    || (action === 'evidence') !== (result === 'observed' && publicFieldsHash !== null && publicFieldsJson !== null)
    || action !== 'evidence' && (publicFieldsHash !== null || publicFieldsJson !== null)
    || (stoppedRef === null) !== (failedEvaluationRefs.length === 0 && stopReason === null)
    || stoppedRef && (stopReason === null || stoppedRef.sessionKey !== sourceRef.sessionKey || stoppedRef.sequence <= sourceRef.sequence || failedEvaluationRefs.some(f => f.sessionKey !== sourceRef.sessionKey || f.sequence >= stoppedRef.sequence))) p.fail('恢复回执的真实来源/结果/停止不闭合')
  return { recoveryKey: p.key(r.recoveryKey,'recovery key'), sourceRef, operationKey: p.key(r.operationKey,'recovery operation'), frozenPlanHash: p.hash(r.frozenPlanHash,'recovery plan'), authorizationEpochKey: p.key(r.authorizationEpochKey,'recovery epoch'),
    actorKey: p.key(r.actorKey,'recovery actor'), viewerKey: p.key(r.viewerKey,'recovery viewer'), gateKey: p.oneOf(r.gateKey,TTRPG_OPEN_GATE_KEYS,'recovery gate'), evaluationRef, evaluationBasisHash: p.hash(r.evaluationBasisHash,'recovery basis'),
    action, targetRef, result, reason: p.nullable(r.reason,p.text,'recovery reason'), publicFieldsHash, publicFieldsJson, stoppedRef, failedEvaluationRefs, stopReason }
}
export function ttrpgOpenGateRecoveryBasisV1(state: ProductRuntimeState, operationKey: string) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, operation = run.operations.find(o => o.operationKey === operationKey) ?? p.fail('恢复操作不存在')
  const rule = run.ruleReceipts.find(r => r.operationKey === operationKey) ?? p.fail('恢复没有真实规则来源'), logical = ttrpgOpenPressureRuleSourceV1(rule)
  const terminal = run.terminalReceipts?.find(t => sameTtrpgOpenPressureSourceV1(t.ruleSourceRef, logical)) ?? p.fail('恢复没有真实终态来源')
  const epoch = run.coordination.epochs.find(e => e.epochKey === operation.authorizationEpochKey) ?? p.fail('恢复窗口不存在')
  const basis = ttrpgOpenGateBasisJsonV1(state)
  const evaluations = ttrpgOpenGateHumanActorsV1(runtime).map(h => [...(run.gateReceipts ?? [])].reverse().find(r => r.actorKey === h.actorKey && r.viewerKey === h.viewerKey && r.authorizationEpochKey === epoch.epochKey && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, logical) && r.evaluationBasisJson === basis))
  if (operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'gates' || run.stage.status !== 'open' || evaluations.some(r => !r)) p.fail('必须先完成当前真实真人质量门评估')
  return { runtime, run, operation, terminal, epoch, evaluations: evaluations.filter((r): r is NonNullable<typeof r> => Boolean(r)) }
}
export function chooseTtrpgOpenGateRecoveryV1(state: ProductRuntimeState, operationKey: string) {
  const b = ttrpgOpenGateRecoveryBasisV1(state,operationKey)
  const ordered = [...b.evaluations].sort((a,c) => Number(c.viewerKey === b.epoch.viewerKey) - Number(a.viewerKey === b.epoch.viewerKey) || (a.actorKey < c.actorKey ? -1 : a.actorKey > c.actorKey ? 1 : 0))
  for (const evaluation of ordered) for (const key of TTRPG_OPEN_GATE_KEYS) if (evaluation.result.results[key].applicability === 'applicable' && evaluation.result.results[key].passed === false) return { evaluation,gateKey: key }
  return null
}
export function planTtrpgOpenGateRecoveryV1(state: ProductRuntimeState, operationKey: string) {
  const b = ttrpgOpenGateRecoveryBasisV1(state,operationKey), selected = chooseTtrpgOpenGateRecoveryV1(state,operationKey) ?? p.fail('当前没有失败的质量门')
  if (b.epoch.status !== 'active' || b.run.coordination.activeEpochKey !== b.epoch.epochKey || b.runtime.product.safety.status !== 'active' || b.epoch.reservedCalls) p.fail('恢复需要未暂停且调用已闭合的实际窗口')
  if (b.run.gateRecoveries?.some(r => r.operationKey === operationKey && r.authorizationEpochKey === b.epoch.epochKey)) p.fail('同一操作窗口只允许一次局部恢复')
  const actorKey = selected.evaluation.actorKey
  if (selected.gateKey === 'exit-exists') {
    const first = [...b.run.situations.queued].sort((a,c) => a.queuePosition! - c.queuePosition!)[0]
    return { ...b, ...selected, action: first ? 'queue' as const : 'none' as const, targetRef: first?.situationKey ?? null }
  }
  if (selected.gateKey === 'hypothesis-formable') {
    const content = b.terminal.frozenContent, context = ttrpgOpenSituationGateContextV1(state,content,actorKey)
    for (const instance of b.run.situations.active) {
      if (!ttrpgOpenSessionSituationActorAccessV1(b.run, instance.templateKey, actorKey)) continue
      const template = ttrpgOpenSituationCatalogV1(content.campaign, b.run).byKey.get(instance.templateKey)!
      const owner = b.run.situationReceipts?.find(row => row.template.templateKey === instance.templateKey)
      for (const evidence of template.evidence) if (!evidence.isRequired && evidence.discoveryPolicy.failForwardEffectPlanRef !== null
        && ttrpgOpenSessionSituationDiscoveryPolicyV1(owner, evidence.discoveryPolicy).allowedAudience !== 'gm-only'
        && (evidence.discoveryPolicy.allowedAudience === 'public' || ttrpgOpenSessionSituationDiscoveryPolicyV1(owner, evidence.discoveryPolicy).recipientActorKeys.includes(actorKey))
        && evidence.discoveryPolicy.preconditions.every(predicate => evaluateTtrpgPredicateV1(predicate,context))
        && evidence.coversObstacleKeys.some(key => !instance.satisfiedObstacleKeys.includes(key)) && !ttrpgOpenActorKnowsEvidenceV1(b.run.knowledge,actorKey,evidence.clueRef)) {
        return { ...b, ...selected, action: 'evidence' as const, targetRef: evidence.clueRef }
      }
    }
  }
  return { ...b, ...selected, action: 'none' as const, targetRef: null }
}
export function settleTtrpgOpenGateRecoveryV1(input: { state: ProductRuntimeState; operationKey: string; viewerKey: string; recoveryKey: string; sequence: number; publicFieldsHash: string | null }) {
  const planned = planTtrpgOpenGateRecoveryV1(input.state,input.operationKey), { evaluation, gateKey, action, targetRef } = planned
  if (input.viewerKey !== evaluation.viewerKey) {
    assertTtrpgOpenHumanHostV1(planned.runtime.authorization!,input.viewerKey)
    if (gateKey === 'hypothesis-formable') p.fail('补充线索需要该真人亲自请求，不由主持人代为确认')
  }
  let state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!
  state.ttrpg = runtime
  const sourceRef = { sessionKey: runtime.sessionKey, sequence: input.sequence }
  let result: TtrpgOpenGateRecoveryV1['result'] = 'unavailable', reason: string | null = '当前没有满足冻结约束的局部恢复', publicFieldsJson: string | null = null
  if (action === 'queue') {
    const settled = settleTtrpgOpenSituationQueueV1({ state,content: planned.terminal.frozenContent,actorKey: evaluation.actorKey,situationKey: targetRef!,sequence: input.sequence })
    state = settled.state;runtime = settled.runtime;result = settled.result.transition;reason = settled.result.reason
  } else if (action === 'evidence') {
    const content = planned.terminal.frozenContent, evidence = ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).templates.flatMap(t => t.evidence).find(e => e.clueRef === targetRef)!
    const entry = parseTtrpgOpenKnowledgeEntryV1({ knowledgeKey: input.recoveryKey, evidenceRef: evidence.clueRef, sourceFactRefs: evidence.sourceFactRefs, sourceResourceRefs: evidence.sourceResourceRefs,
      acquisitionRef: sourceRef, audience: 'private', recipientActorKeys: [evaluation.actorKey], publicFieldsHash: p.hash(input.publicFieldsHash,'real recovery fields hash'), reliability: 'observed' })
    if (runtime.openRun!.knowledge.some(k => k.knowledgeKey === entry.knowledgeKey)) p.fail('恢复知识身份重复')
    runtime.openRun!.knowledge.push(entry)
    for (const instance of runtime.openRun!.situations.active.filter(i => ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).byKey.get(i.templateKey)?.evidence.some(e => e.clueRef === evidence.clueRef))) if (!instance.discoveredEvidenceRefs.includes(evidence.clueRef)) instance.discoveredEvidenceRefs.push(evidence.clueRef)
    result = 'observed';reason = null;publicFieldsJson = stable(ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).validationView,evidence.clueRef))
  }
  const receipt = parseTtrpgOpenGateRecoveryV1({ recoveryKey: input.recoveryKey,sourceRef,operationKey: planned.operation.operationKey,frozenPlanHash: planned.operation.planHash,authorizationEpochKey: planned.epoch.epochKey,
    actorKey: evaluation.actorKey,viewerKey: input.viewerKey,gateKey,evaluationRef: evaluation.sourceRef,evaluationBasisHash: evaluation.result.evaluationBasisHash,
    action,targetRef,result,reason,publicFieldsHash: action === 'evidence' ? input.publicFieldsHash : null,publicFieldsJson,stoppedRef: null,failedEvaluationRefs: [],stopReason: null })
  runtime.openRun!.gateRecoveries = [...(runtime.openRun!.gateRecoveries ?? []),receipt]
  return { state, runtime, receipt }
}
export function stopTtrpgOpenGateRecoveryV1(input: { state: ProductRuntimeState; operationKey: string; viewerKey: string; sequence: number }) {
  const b = ttrpgOpenGateRecoveryBasisV1(input.state,input.operationKey), attempt = b.run.gateRecoveries?.find(r => r.operationKey === input.operationKey && r.authorizationEpochKey === b.epoch.epochKey)
  const failed = b.evaluations.filter(r => !r.result.allApplicablePassed)
  if (!attempt || attempt.stoppedRef || !failed.length || b.epoch.reservedCalls || b.epoch.status !== 'active' || b.run.coordination.activeEpochKey !== b.epoch.epochKey) p.fail('停止必须引用一次实际恢复后仍失败的当前评估')
  if (![attempt.viewerKey,b.epoch.viewerKey].includes(input.viewerKey)) assertTtrpgOpenHumanHostV1(b.runtime.authorization!,input.viewerKey)
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, epoch = run.coordination.epochs.find(e => e.epochKey === b.epoch.epochKey)!, record = run.gateRecoveries!.find(r => r.recoveryKey === attempt.recoveryKey)!
  state.ttrpg = runtime
  const ref = { sessionKey: runtime.sessionKey,sequence: input.sequence }, reason = '局部恢复后仍无安全可继续的真实路径；停止本轮授权并保留已提交业务'
  record.stoppedRef = ref;record.failedEvaluationRefs = failed.map(r => r.sourceRef);record.stopReason = reason
  epoch.status = 'closed';epoch.closedRef = ref;epoch.stopReason = reason;run.coordination.activeEpochKey = null
  return { state,runtime,receipt: parseTtrpgOpenGateRecoveryV1(record) }
}
