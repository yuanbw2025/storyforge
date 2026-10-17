import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
/** Actual situation admission/terminal owner, with frozen causes and persistent knowledge. */
import type { ProductRuntimeState } from '../types'
import { parseTtrpgFrozenRuntimeContentV1, isTtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgRuntimeStateV2, TtrpgOpenSituationRuntimeStateV1 } from './open-runtime-contract'
import { parseTtrpgRuntimeStateV2, parseTtrpgOpenSituationRuntimeStateV1 } from './open-runtime-contract'
import type { TtrpgOpenPressureCycleV1, TtrpgOpenPressureWorkV1 } from './open-pressure-cycle'
import { sameTtrpgOpenPressureSourceV1 } from './open-pressure-cycle'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { instantiateTtrpgSituationV1, assertTtrpgSituationInstanceGatesV1, evaluateTtrpgSituationMaintenanceV1 } from './situation-engine'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'
import * as p from './open-contract-parse'

export type TtrpgOpenSituationWorkActionV1 = { kind: 'activate'; activationReason: 'front-escalation' | 'consequence' }
  | { kind: 'resolve-front-defeated'; situationKey: string; frontKey: string }
export interface TtrpgOpenSituationHistoryV1 { sourceRef: TtrpgOpenSourceRefV1; causeRef: TtrpgOpenSourceRefV1; instance: TtrpgOpenSituationRuntimeStateV1 }
export function parseTtrpgOpenSituationWorkActionV1(value: unknown): TtrpgOpenSituationWorkActionV1 {
  const r = p.object(value, 'situation work action')
  if (r.kind === 'activate') {
    p.exact(r, ['kind', 'activationReason'], 'situation activation work')
    return { kind: 'activate', activationReason: p.oneOf(r.activationReason, ['front-escalation', 'consequence'], 'situation activation reason') }
  }
  p.exact(r, ['kind', 'situationKey', 'frontKey'], 'situation defeat cleanup')
  return { kind: p.literal(r.kind, 'resolve-front-defeated', 'situation work kind'), situationKey: p.key(r.situationKey, 'situation instance'), frontKey: p.key(r.frontKey, 'situation defeated front') }
}
export function parseTtrpgOpenSituationHistoryV1(value: unknown): TtrpgOpenSituationHistoryV1 {
  const r = p.record(value, ['sourceRef', 'causeRef', 'instance'], 'situation history')
  const instance = parseTtrpgOpenSituationRuntimeStateV1(r.instance, 'terminal situation')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef)
  if (!['resolved', 'expired'].includes(instance.status) || instance.resolvedAtSequence !== sourceRef.sequence || instance.queuePosition !== null) p.fail('局势终态必须由真实处置事件保存')
  return { sourceRef, causeRef: parseTtrpgOpenSourceRefV1(r.causeRef), instance }
}
export function ttrpgOpenSituationGateContextV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2, actorKey: string): TtrpgPredicateEvaluationContextV1 {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, context = ttrpgOpenPredicateContextV1(state, content)
  const signals = [...(run.pressureSignals ?? []).map(s => ({ frontKey: s.frontKey, key: s.telegraphKey, turn: s.worldTurn, audience: s.audience, recipients: s.recipientActorKeys })),
    ...(run.pressureCycles ?? []).flatMap(c => c.frontReceipts.filter(r => r.kind === 'telegraph').map(r => ({ frontKey: r.frontKey, key: r.definitionKey!, turn: r.atWorldTurn, audience: r.audience, recipients: r.recipientActorKeys })))]
  return { ...context,
    // Truth stays unchanged for I1. I2 must honor the captured recipients of an old party fact.
    sessionFacts: context.sessionFacts.map(f => ({ ...f, ...('audience' in f && f.audience === 'party' ? { audience: 'private' } : {}) })),
    pressure: { ...context.pressure, fronts: Object.fromEntries(Object.entries(context.pressure.fronts).map(([key, front]) => [key, { ...front,
      telegraphWorldTurns: Object.fromEntries(signals.filter(s => s.frontKey === key && (s.audience === 'public' || s.recipients.includes(actorKey))).map(s => [s.key, s.turn])) }])) },
  }
}
export function ttrpgOpenSituationWorkActionV1(runtime: TtrpgRuntimeStateV2, cycle: TtrpgOpenPressureCycleV1, work: TtrpgOpenPressureWorkV1): TtrpgOpenSituationWorkActionV1 {
  if (!work.situationTemplateKey || work.templateKey) p.fail('该待办不是局势 owner')
  const cause = cycle.frontReceipts.find(r => sameTtrpgOpenPressureSourceV1(r.sourceRef, work.causeRef)) ?? p.fail('局势后果缺少实际威胁事件')
  const front = cycle.frozenContent.campaign.fronts.find(f => f.frontKey === cause.frontKey) ?? p.fail('局势后果威胁不在冻结内容')
  const expected = cause.kind === 'advanced' && front.escalationStages.find(s => s.stageKey === cause.definitionKey)?.newSituationTemplateKey === work.situationTemplateKey
    ? { kind: 'activate' as const, activationReason: 'front-escalation' as const } : null
  if (work.situationAction) {
    const action = work.situationAction
    if (action.kind === 'activate' ? !expected || action.activationReason !== expected.activationReason
      : cause.kind !== 'defeated' || action.frontKey !== front.frontKey || !runtime.openRun?.fronts.find(f => f.frontKey === action.frontKey)?.defeated) p.fail('局势待办类型不是实际冻结威胁后果')
    return action
  }
  if (expected) return expected
  if (cause.kind !== 'defeated') p.fail('旧局势待办没有可恢复的真实后果')
  const candidates = [...runtime.openRun!.situations.active, ...runtime.openRun!.situations.queued].filter(i => i.templateKey === work.situationTemplateKey)
  if (candidates.length !== 1) p.fail('旧击败待办不能推断唯一实例，需要明确处置')
  return { kind: 'resolve-front-defeated', situationKey: candidates[0].situationKey, frontKey: front.frontKey }
}
export type TtrpgOpenSituationWorkResultV1 = { transition: 'activated' | 'queued' | 'existing' | 'resolved'; instance: TtrpgOpenSituationRuntimeStateV1 }
  | { transition: 'rejected'; instance: null; rejection: { templateKey: string; violatedRule: string } }
export function settleTtrpgOpenSituationWorkV1(input: { state: ProductRuntimeState; cycle: TtrpgOpenPressureCycleV1; work: TtrpgOpenPressureWorkV1;
  actorKey: string; sequence: number; instanceKey: string; recordRejection?: boolean }) {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, content = input.cycle.frozenContent
  state.ttrpg = runtime
  const template = ttrpgOpenSituationCatalogV1(content.campaign, run).templates.find(t => t.templateKey === input.work.situationTemplateKey) ?? p.fail('冻结局势模板不存在')
  const action = ttrpgOpenSituationWorkActionV1(runtime, input.cycle, input.work)
  let result: TtrpgOpenSituationWorkResultV1
  if (action.kind === 'activate') {
    return admitTtrpgOpenSituationV1({ state, content, templateKey: template.templateKey, actorKey: input.actorKey,
      sequence: input.sequence, instanceKey: input.instanceKey, activationReason: action.activationReason, recordRejection: input.recordRejection })
  } else {
    const instance = [...run.situations.active, ...run.situations.queued].find(i => i.situationKey === action.situationKey) ?? p.fail('击败清理实例不存在')
    if (instance.templateKey !== template.templateKey || template.driverBinding.kind !== 'front' || template.driverBinding.frontKey !== action.frontKey
      || !run.fronts.find(f => f.frontKey === action.frontKey)?.defeated) p.fail('击败不能清理其他驱动者或未击败威胁的局势')
    const activeView = { ...instance, status: 'active' as const }
    const maintained = evaluateTtrpgSituationMaintenanceV1({ template, instance: activeView, worldTurn: run.worldTime.worldTurn, resolvedAtSequence: input.sequence,
      resolutionKind: 'front-defeated', predicateContext: ttrpgOpenPredicateContextV1(state, content), activeInstances: run.situations.active, queuedTemplateKeys: [], templateContext: ttrpgOpenSituationCatalogV1(content.campaign, run).validationView })
    const terminal = parseTtrpgOpenSituationRuntimeStateV1({ ...maintained.instance, queuePosition: null }, 'defeated front situation')
    run.situations.active = run.situations.active.filter(i => i.situationKey !== instance.situationKey)
    run.situations.queued = run.situations.queued.filter(i => i.situationKey !== instance.situationKey)
    run.situations.cooldowns[template.templateKey] = maintained.cooldownUntilWorldTurn!
    run.situations.history = [...(run.situations.history ?? []), { sourceRef: { sessionKey: runtime.sessionKey, sequence: input.sequence }, causeRef: input.work.causeRef, instance: terminal }]
    // The E12 source already changes chaos. E11 front-defeated cleanup never changes it again.
    result = { transition: 'resolved', instance: terminal }
  }
  return { state, runtime, result }
}

export function parseTtrpgOpenSituationFrozenContentV1(value: unknown): TtrpgRuntimeContentV2 {
  const raw = p.object(value, 'situation frozen content'), world = p.object(p.object(raw.campaign, 'situation frozen campaign').sourceWorld, 'situation world')
  const content = parseTtrpgFrozenRuntimeContentV1(value, p.hash(world.contentHash, 'situation world hash'))
  if (!isTtrpgRuntimeContentV2(content)) return p.fail('局势只读冻结 open 版本')
  return content
}

export function ttrpgOpenSituationProjectionActorV1(runtime: TtrpgRuntimeStateV2, starterActorKey: string | null): string {
  const auth = runtime.authorization ?? p.fail('实例门需要真实角色授权')
  if (starterActorKey && auth.selectedActorKeys.includes(starterActorKey)) return starterActorKey
  return auth.seats.find(s => s.role === 'player' && s.controller !== 'ai' && auth.selectedActorKeys.includes(s.actorKey ?? ''))?.actorKey
    ?? auth.selectedActorKeys[0] ?? p.fail('实例门没有当前玩家投影')
}

/** Shared pure I1-I7 admission; each caller must validate its actual causal owner first. */
export function admitTtrpgOpenSituationV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2; templateKey: string; actorKey: string;
  sequence: number; instanceKey: string; activationReason: 'front-escalation' | 'consequence' | 'session-generation'; recordRejection?: boolean }): { state: ProductRuntimeState; runtime: TtrpgRuntimeStateV2; result: TtrpgOpenSituationWorkResultV1 } {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, content = input.content
  state.ttrpg = runtime
  const template = ttrpgOpenSituationCatalogV1(content.campaign, run).templates.find(t => t.templateKey === input.templateKey) ?? p.fail('冻结准入模板不存在')
    const existing = [...run.situations.active, ...run.situations.queued].find(i => i.templateKey === template.templateKey)
    if (existing) return { state, runtime, result: { transition: 'existing' as const, instance: existing } }
    let queued = false
    try { assertTtrpgSituationInstanceGatesV1({ template, predicateContext: ttrpgOpenSituationGateContextV1(state, content, input.actorKey), actorKey: input.actorKey,
      activeInstances: run.situations.active, cooldownUntilWorldTurn: run.situations.cooldowns, worldTurn: run.worldTime.worldTurn, templateContext: ttrpgOpenSituationCatalogV1(content.campaign, run).validationView, rulePack: content.rulePack.content }) }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/I[1-5]:/.test(message)) {
        if (!input.recordRejection) throw error
        const violatedRule = message.replace(/^\[ttrpg-situation\] /, '')
        run.failures = [...run.failures, { failureKey: input.instanceKey, atSequence: input.sequence, atWorldTurn: run.worldTime.worldTurn,
          category: 'situation-rejected' as const, violatedRule }].slice(-200)
        return { state, runtime, result: { transition: 'rejected' as const, instance: null, rejection: { templateKey: template.templateKey, violatedRule } } }
      }
      if (!/I[67]:/.test(message)) throw error
      queued = true
    }
    const base = instantiateTtrpgSituationV1({ template, activatedAtSequence: input.sequence, activatedAtWorldTurn: run.worldTime.worldTurn, activationReason: input.activationReason })
    const instance = parseTtrpgOpenSituationRuntimeStateV1({ ...base, situationKey: p.key(input.instanceKey, 'qualified situation instance'),
      status: queued ? 'queued' : 'active', queuePosition: queued ? Math.max(-1, ...run.situations.queued.map(i => i.queuePosition!)) + 1 : null }, 'actual admitted situation')
    if ([...run.situations.active, ...run.situations.queued, ...(run.situations.history ?? []).map(h => h.instance)].some(i => i.situationKey === instance.situationKey)) p.fail('局势实例身份重复')
    if (queued) run.situations.queued.push(instance); else run.situations.active.push(instance)
    const result: TtrpgOpenSituationWorkResultV1 = { transition: queued ? 'queued' : 'activated', instance }

    return { state, runtime, result }
}

/** Shared real FIFO owner; recovery and normal maintenance use the same admission semantics. */
export function settleTtrpgOpenSituationQueueV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2; actorKey: string; situationKey: string; sequence: number }) {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, content = input.content
  state.ttrpg = runtime
  const first = [...run.situations.queued].sort((a, b) => a.queuePosition! - b.queuePosition!)[0]
  if (first?.situationKey !== input.situationKey) p.fail('只能处理实际 FIFO 首项')
    const instance = run.situations.queued.find(i => i.situationKey === input.situationKey) ?? p.fail('FIFO 项不存在')
    const template = ttrpgOpenSituationCatalogV1(content.campaign, run).templates.find(t => t.templateKey === instance.templateKey) ?? p.fail('队列模板不存在')
    const actorKey = input.actorKey
    let transition: 'activated' | 'retained' | 'duplicate' | 'rejected' = 'activated', reason: string | null = null
    try { assertTtrpgSituationInstanceGatesV1({ template, predicateContext: ttrpgOpenSituationGateContextV1(state, content, actorKey), actorKey, worldTurn: run.worldTime.worldTurn,
      activeInstances: run.situations.active, cooldownUntilWorldTurn: run.situations.cooldowns, templateContext: ttrpgOpenSituationCatalogV1(content.campaign, run).validationView, rulePack: content.rulePack.content }) }
    catch (error) {
      reason = error instanceof Error ? error.message : String(error)
      // Evaluate all failed gates: a capacity failure never hides a semantic rejection.
      transition = /I[1-4]:/.test(reason) ? 'rejected' : /I5:/.test(reason) ? 'duplicate' : /I[67]:/.test(reason) ? 'retained' : p.fail(reason)
    }
    let activated: TtrpgOpenSituationRuntimeStateV1 | null = null
    if (transition === 'activated') {
      // Queued rows are reservations. Their deadline begins only at genuine active admission.
      activated = parseTtrpgOpenSituationRuntimeStateV1({ ...instantiateTtrpgSituationV1({ template, activatedAtSequence: input.sequence,
        activatedAtWorldTurn: run.worldTime.worldTurn, activationReason: instance.activationReason }), situationKey: instance.situationKey, status: 'active', queuePosition: null }, 'FIFO admission')
      run.situations.active.push(activated)
    }
    if (transition !== 'retained') run.situations.queued = run.situations.queued.filter(i => i.situationKey !== instance.situationKey)
    if (transition === 'rejected' || transition === 'retained') run.failures = [...run.failures, { failureKey: `queue.${input.sequence}`, atSequence: input.sequence,
      atWorldTurn: run.worldTime.worldTurn, category: transition === 'rejected' ? 'situation-rejected' as const : 'situation-capacity' as const, violatedRule: reason! }].slice(-200)
    return { state, runtime, result: { transition, situationKey: instance.situationKey, instance: activated, reason } }
}
