import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
/** Real terminal and per-player gate evidence. Diagnostics remain author-only. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSituationFrozenContentV1 } from './open-situation-runtime'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { ttrpgOpenSessionFactsV1 } from './open-fact-ledger'
import { ttrpgOpenActorKnowsEvidenceV1 } from './open-knowledge'
import { evaluateTtrpgOpenRuntimeGatesV1, evaluateTtrpgOpenStageClosureV1, TTRPG_OPEN_GATE_KEYS, type TtrpgOpenRuntimeGateEvaluationV1, type TtrpgOpenGateResultV1 } from './open-gates'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
export interface TtrpgOpenTerminalDecisionV1 {
  status: 'actionable' | 'stage-closed' | 'safety-paused' | 'maximum-reached' | 'closure-available'; worldTurn: number; stageRevision: string;
  closure: { eligible: boolean; reason: 'trigger' | 'maximum-world-turns' | 'not-eligible'; triggerKey: string | null; summaryPrompt: string | null; maximumReached: boolean; evidence: string[] }
}
export interface TtrpgOpenTerminalReceiptV1 {
  sourceRef: TtrpgOpenSourceRefV1; ruleSourceRef: TtrpgOpenSourceRefV1; frozenContent: TtrpgRuntimeContentV2; contentHash: string; runtimeSourceHash: string; decision: TtrpgOpenTerminalDecisionV1
}
export interface TtrpgOpenGateReceiptV1 {
  sourceRef: TtrpgOpenSourceRefV1; ruleSourceRef: TtrpgOpenSourceRefV1; terminalRef: TtrpgOpenSourceRefV1; authorizationEpochKey: string;
  actorKey: string; viewerKey: string; evaluationBasisJson: string; result: TtrpgOpenRuntimeGateEvaluationV1
}
function currentStageRevision(runtime: import('./open-runtime-contract').TtrpgRuntimeStateV2): string {
  const run = runtime.openRun!, latest = run.stageOpenings?.[run.stageOpenings.length - 1]?.plan, continued = run.releaseContinuation;
  if (!continued) return latest?.stageRevision ?? `stage.${run.stage.openedAtWorldTurn}`;
  const origin = continued.confirmedRef;
  const rank = (sessionKey: string) => sessionKey === runtime.sessionKey ? (runtime.branchLineage?.ancestors.length ?? 0) : (runtime.branchLineage?.ancestors.findIndex(a => a.sessionKey === sessionKey) ?? -1);
  if (latest && origin && (rank(latest.sessionKey) > rank(origin.sessionKey)
    || latest.sessionKey === origin.sessionKey && latest.plannedSourceRef.sequence > origin.sequence)) return latest.stageRevision;
  return `stage.opening.${continued.plan.planHash}`;
}
export function evaluateTtrpgOpenTerminalV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2): TtrpgOpenTerminalDecisionV1 {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, closure = evaluateTtrpgOpenStageClosureV1({ stageClosurePolicy: content.campaign.stageClosurePolicy,
    predicateContext: ttrpgOpenPredicateContextV1(state, content), worldTurn: run.worldTime.worldTurn })
  const status = run.stage.status === 'closed' ? 'stage-closed' : runtime.product.safety.status !== 'active' ? 'safety-paused'
    : closure.maximumReached ? 'maximum-reached' : closure.eligible ? 'closure-available' : 'actionable'
  return { status, worldTurn: run.worldTime.worldTurn, stageRevision: currentStageRevision(runtime), closure }
}
export function parseTtrpgOpenTerminalReceiptV1(value: unknown): TtrpgOpenTerminalReceiptV1 {
  const r = p.record(value, ['sourceRef', 'ruleSourceRef', 'frozenContent', 'contentHash', 'runtimeSourceHash', 'decision'], 'terminal receipt')
  const d = p.record(r.decision, ['status', 'worldTurn', 'stageRevision', 'closure'], 'terminal decision'), c = p.record(d.closure, ['eligible', 'reason', 'triggerKey', 'summaryPrompt', 'maximumReached', 'evidence'], 'closure decision')
  const closure = { eligible: p.bool(c.eligible, 'closure eligibility'), reason: p.oneOf(c.reason, ['trigger', 'maximum-world-turns', 'not-eligible'], 'closure reason'),
    triggerKey: p.nullable(c.triggerKey, p.key, 'closure trigger'), summaryPrompt: p.nullable(c.summaryPrompt, p.text, 'closure prompt'), maximumReached: p.bool(c.maximumReached, 'maximum reached'), evidence: p.list(c.evidence, 'closure evidence', v => p.text(v, 'closure evidence'), 10000, 1) }
  if (closure.eligible !== (closure.reason !== 'not-eligible') || closure.maximumReached !== (closure.reason === 'maximum-world-turns')
    || (closure.reason === 'trigger') !== (closure.triggerKey !== null && closure.summaryPrompt !== null)) p.fail('阶段判定字段互相矛盾')
  return { sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef), frozenContent: parseTtrpgOpenSituationFrozenContentV1(r.frozenContent),
    contentHash: p.hash(r.contentHash, 'terminal content hash'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'terminal source hash'),
    decision: { status: p.oneOf(d.status, ['actionable', 'stage-closed', 'safety-paused', 'maximum-reached', 'closure-available'], 'terminal status'), worldTurn: p.integer(d.worldTurn, 'terminal turn'), stageRevision: p.key(d.stageRevision, 'stage revision'), closure } }
}
function parseGateResult(value: unknown): TtrpgOpenGateResultV1 {
  const r = p.record(value, ['applicability', 'passed', 'evidence', 'viewerKey', 'stageRevision', 'evaluationBasisHash'], 'gate result')
  const applicability = p.oneOf(r.applicability, ['applicable', 'not-applicable'], 'gate applicability'), passed = p.nullable(r.passed, p.bool, 'gate pass')
  if (applicability === 'not-applicable' ? passed !== null : passed === null) p.fail('不适用门不能伪装通过')
  return { applicability, passed, evidence: p.list(r.evidence, 'gate evidence', v => p.text(v, 'gate evidence'), 10000, 1), viewerKey: p.nullable(r.viewerKey, p.key, 'gate viewer'),
    stageRevision: p.key(r.stageRevision, 'gate stage revision'), evaluationBasisHash: p.nullable(r.evaluationBasisHash, p.hash, 'gate basis hash') }
}
export function parseTtrpgOpenGateReceiptV1(value: unknown): TtrpgOpenGateReceiptV1 {
  const r = p.record(value, ['sourceRef', 'ruleSourceRef', 'terminalRef', 'authorizationEpochKey', 'actorKey', 'viewerKey', 'evaluationBasisJson', 'result'], 'gate receipt')
  if (typeof r.evaluationBasisJson !== 'string') p.fail('门依据必须是实际 JSON 字符串')
  p.object(p.json(r.evaluationBasisJson), 'gate basis')
  const e = p.record(r.result, ['results', 'gates', 'consecutiveFailures', 'recovery', 'requestAuthorReview', 'allApplicablePassed', 'viewerKey', 'stageRevision', 'evaluationBasisHash'], 'gate evaluation')
  const results = p.record(e.results, TTRPG_OPEN_GATE_KEYS, 'four gate results'), counts = p.record(e.consecutiveFailures, TTRPG_OPEN_GATE_KEYS, 'four gate counters'), recoveries = p.record(e.recovery, TTRPG_OPEN_GATE_KEYS, 'four gate recoveries')
  const parsed = Object.fromEntries(TTRPG_OPEN_GATE_KEYS.map(key => [key, parseGateResult(results[key])])) as Record<typeof TTRPG_OPEN_GATE_KEYS[number], TtrpgOpenGateResultV1>
  const consecutiveFailures = Object.fromEntries(TTRPG_OPEN_GATE_KEYS.map(key => [key, p.integer(counts[key], 'gate failures')])) as TtrpgOpenRuntimeGateEvaluationV1['consecutiveFailures']
  const recovery = Object.fromEntries(TTRPG_OPEN_GATE_KEYS.map(key => [key, p.oneOf(recoveries[key], ['none', 'request-author-review'], 'gate recovery')])) as TtrpgOpenRuntimeGateEvaluationV1['recovery']
  const requestAuthorReview = p.list(e.requestAuthorReview, 'author review gates', v => p.oneOf(v, TTRPG_OPEN_GATE_KEYS, 'author gate'), 4)
  const viewerKey = p.key(r.viewerKey, 'gate receipt viewer'), stageRevision = p.key(e.stageRevision, 'gate receipt stage'), evaluationBasisHash = p.hash(e.evaluationBasisHash, 'gate evaluation basis'), allApplicablePassed = p.bool(e.allApplicablePassed, 'all applicable gates pass')
  if (stable(e.gates) !== stable(parsed) || e.viewerKey !== viewerKey || Object.values(parsed).some(g => g.viewerKey !== viewerKey || g.stageRevision !== stageRevision || g.evaluationBasisHash !== evaluationBasisHash)
    || allApplicablePassed !== Object.values(parsed).every(g => g.applicability === 'not-applicable' || g.passed === true)
    || requestAuthorReview.length !== new Set(requestAuthorReview).size || stable(requestAuthorReview) !== stable(TTRPG_OPEN_GATE_KEYS.filter(key => recovery[key] === 'request-author-review'))) p.fail('门结果元数据或诊断相互矛盾')
  return { sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef), terminalRef: parseTtrpgOpenSourceRefV1(r.terminalRef), authorizationEpochKey: p.key(r.authorizationEpochKey, 'gate epoch'),
    actorKey: p.key(r.actorKey, 'gate actor'), viewerKey, evaluationBasisJson: r.evaluationBasisJson, result: { results: parsed, gates: structuredClone(parsed), consecutiveFailures, recovery, requestAuthorReview, allApplicablePassed, viewerKey, stageRevision, evaluationBasisHash } }
}
export function ttrpgOpenGateBasisJsonV1(state: ProductRuntimeState): string {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!
  return stable({ entities: state.entities, product: runtime.product, authorization: runtime.authorization, worldTime: run.worldTime, stage: run.stage,
    situations: run.situations, ...(run.situationReceipts ? { sessionSituationRefs: run.situationReceipts.map(r => ({ templateKey: r.template.templateKey, receiptHash: r.receiptHash })) } : {}), clocks: run.clocks, fronts: run.fronts, pressureSignals: run.pressureSignals ?? [], factLedger: run.factLedger ?? null, knowledge: run.knowledge })
}
export function ttrpgOpenGateHumanActorsV1(runtime: TtrpgRuntimeStateV2): Array<{ actorKey: string; viewerKey: string }> {
  const auth = runtime.authorization ?? p.fail('门检查需要真实当前授权')
  return auth.seats.filter(s => s.role === 'player' && s.controller !== 'ai' && s.assignmentState === 'claimed' && s.actorKey && auth.selectedActorKeys.includes(s.actorKey)).map(s => ({ actorKey: s.actorKey!, viewerKey: s.viewerKey }))
}
export function evaluateTtrpgOpenPlayerGatesV1(input: { state: ProductRuntimeState; terminal: TtrpgOpenTerminalReceiptV1; actorKey: string; viewerKey: string; basisHash: string }): TtrpgOpenRuntimeGateEvaluationV1 {
  return evaluatePlayerGates({ state: input.state, content: input.terminal.frozenContent,
    actorKey: input.actorKey, viewerKey: input.viewerKey, basisHash: input.basisHash })
}

/** Pure prospective validation only; no invented rule/terminal receipt or start authority. */
export function evaluateTtrpgOpenNextStagePlayerGatesV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2;
  actorKey: string; viewerKey: string; basisHash: string; openingRevision: string }): TtrpgOpenRuntimeGateEvaluationV1 {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg), run = runtime?.openRun
  if (!runtime || !run || run.stage.status !== 'open' || runtime.product.safety.status !== 'active'
    || run.stage.openedAtWorldTurn !== run.worldTime.worldTurn
    || evaluateTtrpgOpenTerminalV1(input.state, input.content).closure.maximumReached
    || !/^stage\.opening\.[0-9a-f]{64}$/.test(input.openingRevision)) p.fail('下一阶段检查需要准确拟开局、独立版本和原单局额度')
  p.hash(input.basisHash, 'next stage gate basis')
  return evaluatePlayerGates(input, input.openingRevision)
}

function evaluatePlayerGates(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2;
  actorKey: string; viewerKey: string; basisHash: string }, openingRevision?: string): TtrpgOpenRuntimeGateEvaluationV1 {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg)!, run = runtime.openRun!, content = input.content, auth = runtime.authorization!
  if (!ttrpgOpenGateHumanActorsV1(runtime).some(s => s.actorKey === input.actorKey && s.viewerKey === input.viewerKey)) p.fail('四门只检查该窗口真实回应的真人角色')
  const seat = auth.seats.find(s => s.viewerKey === input.viewerKey)!, context = ttrpgOpenPredicateContextV1(input.state, content)
  const known = (ref: string) => ttrpgOpenActorKnowsEvidenceV1(run.knowledge, input.actorKey, ref)
  const campaign = structuredClone(ttrpgOpenSituationCatalogV1(content.campaign, run).validationView)
  // G2 sees genuine observed grants. GM-only/private disclosures to someone else and hearsay never become objective proof.
  for (const template of campaign.situationTemplates) for (const evidence of template.evidence) {
    if (!known(evidence.clueRef)) { evidence.audience = 'gm-only'; evidence.knownByActorKeys = [] }
    else { evidence.audience = 'private'; evidence.knownByActorKeys = [input.actorKey] }
  }
  // A visible point with no currently usable suggested method is not a playable exit.
  const available = new Set(context.actors?.[input.actorKey]?.abilityKeys ?? [])
  for (const template of campaign.situationTemplates) for (const point of template.interventionPoints) {
    if (!ttrpgOpenSessionSituationActorAccessV1(run, template.templateKey, input.actorKey)
      || !point.suggestedActionKeys.some(key => available.has(key))) point.requiresPredicate = { op: 'not', of: { op: 'world-turn-at-least', value: 0 } }
  }
  const active = run.situations.active.map(i => ({ ...i, discoveredEvidenceRefs: i.discoveredEvidenceRefs.filter(known) }))
  const previous = [...(run.gateReceipts ?? [])].reverse().find(r => r.actorKey === input.actorKey)
  const terminal = evaluateTtrpgOpenTerminalV1(input.state, content)
  const pressure = { clocks: context.pressure.clocks, fronts: Object.fromEntries(run.fronts.map(f => [f.frontKey, { ...context.pressure.fronts[f.frontKey], currentStageKey: f.stageKey, defeated: f.defeated,
    telegraphWorldTurns: Object.fromEntries([...(run.pressureSignals ?? []).filter(s => s.frontKey === f.frontKey && (s.audience === 'public' || s.recipientActorKeys.includes(input.actorKey))).map(s => [s.telegraphKey, s.worldTurn] as const),
      ...(run.pressureCycles ?? []).flatMap(c => c.frontReceipts.filter(r => r.kind === 'telegraph' && r.frontKey === f.frontKey && (r.audience === 'public' || r.recipientActorKeys.includes(input.actorKey))).map(r => [r.definitionKey!, r.atWorldTurn] as const))]) }])) }
  const result = evaluateTtrpgOpenRuntimeGatesV1({ campaign, situations: { active }, pressure, worldTurn: run.worldTime.worldTurn, predicateContext: { ...context, pressure },
    viewer: { actorKey: input.actorKey, viewerKey: seat.viewerKey }, viewerKey: seat.viewerKey, actorKey: input.actorKey,
    stageStatus: terminal.status === 'stage-closed' ? 'closed' : terminal.status === 'safety-paused' || terminal.status === 'maximum-reached' ? 'paused' : 'active',
    stageRevision: openingRevision ?? terminal.stageRevision, evaluationBasisHash: input.basisHash, sessionFacts: ttrpgOpenSessionFactsV1(run.factLedger),
    previousGateResults: previous?.result.results, consecutiveFailures: previous?.result.consecutiveFailures })
  // The old pure helper labels G1/G2 with actorKey. The durable contract binds the actual seat viewer instead.
  for (const key of TTRPG_OPEN_GATE_KEYS) result.results[key] = { ...result.results[key], viewerKey: seat.viewerKey }
  result.gates = structuredClone(result.results)
  return result
}
