import { parseTtrpgOpenSessionSituationRefsV1, type TtrpgOpenSessionSituationRefV1 } from './open-session-situation-catalog'
import { ttrpgOpenTurnCycleIdentityV1 } from './open-turn-settlement'
import { parseTtrpgOpenSituationWorkActionV1, type TtrpgOpenSituationWorkActionV1 } from './open-situation-runtime'
import { parseTtrpgOpenPressureEffectReviewV1, type TtrpgOpenPressureEffectReviewV1 } from './open-pressure-effect'
/** Durable pressure work from an actual settled action. No provider, DB or mutable world reads. */
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgFrozenRuntimeContentV1, isTtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenOperationV1, TtrpgOpenRuleReceiptV1 } from './open-operation'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan'
import { ttrpgDegreeSucceededV2 } from './runtime-state'
import { evaluateTtrpgClockAutoAdvanceV1, type TtrpgPressureClockTickV1 } from './pressure-runtime'
import { evaluateTtrpgPredicateV1 } from './predicate'
import * as p from './open-contract-parse'

export interface TtrpgOpenPressureWorkV1 {
  workKey: string
  templateKey: string | null
  situationTemplateKey: string | null
  causeRef: TtrpgOpenSourceRefV1
  completedRef: TtrpgOpenSourceRefV1 | null
  effectReviews?: TtrpgOpenPressureEffectReviewV1[]
  situationAction?: TtrpgOpenSituationWorkActionV1
  situationDisposition?: 'activated' | 'queued' | 'existing' | 'resolved' | 'rejected'
}
export interface TtrpgOpenPressureFrontReceiptV1 {
  kind: 'telegraph' | 'advanced' | 'defeated'; frontKey: string; definitionKey: string | null
  atWorldTurn: number; audience: 'party' | 'public' | null; recipientActorKeys: string[]; sourceRef: TtrpgOpenSourceRefV1
}
export interface TtrpgOpenPressureCycleV1 {
  operationStepKey?: string
  sessionSituationRefs?: TtrpgOpenSessionSituationRefV1[]
  cycleKey: string
  ruleSourceRef: TtrpgOpenSourceRefV1
  startedRef: TtrpgOpenSourceRefV1
  frozenContent: TtrpgRuntimeContentV2
  contentHash: string
  runtimeSourceHash: string
  tickQueue: TtrpgPressureClockTickV1[]
  tickRefs: TtrpgOpenSourceRefV1[]
  consumedOracleRefs: TtrpgOpenSourceRefV1[]
  frontReceipts: TtrpgOpenPressureFrontReceiptV1[]
  work: TtrpgOpenPressureWorkV1[]
  completedRef: TtrpgOpenSourceRefV1 | null
}
export function parseTtrpgOpenPressureCycleV1(value: unknown): TtrpgOpenPressureCycleV1 {
  const hasStep = Object.prototype.hasOwnProperty.call(p.object(value,'pressure cycle'),'operationStepKey')
  const hasRefs = Object.prototype.hasOwnProperty.call(p.object(value, 'pressure cycle'), 'sessionSituationRefs')
  const r = p.record(value, [...(hasStep ? ['operationStepKey'] : []), ...(hasRefs ? ['sessionSituationRefs'] : []),'cycleKey', 'ruleSourceRef', 'startedRef', 'frozenContent', 'contentHash', 'runtimeSourceHash', 'tickQueue', 'tickRefs', 'consumedOracleRefs', 'frontReceipts', 'work', 'completedRef'], 'pressure cycle')
  const sessionSituationRefs = hasRefs ? parseTtrpgOpenSessionSituationRefsV1(r.sessionSituationRefs) : undefined
  const operationStepKey = hasStep ? p.key(r.operationStepKey,'pressure owner step') : undefined
  if (operationStepKey && !/^pressure\.(?:[1-9]|10)$/.test(operationStepKey)) p.fail('压力 owner 必须是实际逐轮步骤')
  const raw = p.object(r.frozenContent, 'pressure content'), world = p.object(p.object(raw.campaign, 'pressure campaign').sourceWorld, 'pressure world')
  const content = parseTtrpgFrozenRuntimeContentV1(r.frozenContent, p.hash(world.contentHash, 'pressure world hash'))
  if (!isTtrpgRuntimeContentV2(content)) p.fail('压力只读取冻结 open 内容')
  const tickQueue = p.list(r.tickQueue, 'pressure ticks', value => {
    const t = p.record(value, ['clockKey', 'delta', 'triggerSource', 'triggerKey', 'valueBefore', 'valueAfter', 'atWorldTurn'], 'pressure tick')
    const clockKey = p.key(t.clockKey, 'pressure clock'), clock = content.campaign.clocks.find(c => c.clockKey === clockKey) ?? p.fail('压力时钟不在冻结内容')
    const before = p.integer(t.valueBefore, 'clock before', 0, clock.maximum), after = p.integer(t.valueAfter, 'clock after', 0, clock.maximum), delta = p.integer(t.delta, 'clock delta', 1, clock.maximum)
    if (after !== before + delta) p.fail('压力推进数值不一致')
    return { clockKey, delta, triggerSource: p.oneOf(t.triggerSource, ['author-trigger', 'auto-failed-check', 'auto-idle', 'auto-oracle-no', 'auto-stage-close', 'escalation', 'situation-outcome'], 'pressure trigger'),
      triggerKey: p.key(t.triggerKey, 'pressure trigger key'), valueBefore: before, valueAfter: after, atWorldTurn: p.integer(t.atWorldTurn, 'pressure turn') }
  }, 10000)
  const tickRefs = p.list(r.tickRefs, 'pressure tick sources', parseTtrpgOpenSourceRefV1, tickQueue.length)
  const frontReceipts = p.list(r.frontReceipts, 'pressure front receipts', value => {
    const f = p.record(value, ['kind', 'frontKey', 'definitionKey', 'atWorldTurn', 'audience', 'recipientActorKeys', 'sourceRef'], 'pressure front receipt')
    const frontKey = p.key(f.frontKey, 'pressure front'), front = content.campaign.fronts.find(front => front.frontKey === frontKey) ?? p.fail('压力威胁不存在')
    const kind = p.oneOf(f.kind, ['telegraph', 'advanced', 'defeated'], 'pressure front kind'), definitionKey = p.nullable(f.definitionKey, p.key, 'pressure definition')
    const audience = p.nullable(f.audience, (v, l) => p.oneOf(v, ['party', 'public'], l), 'pressure front audience')
    const recipientActorKeys = p.keys(f.recipientActorKeys, 'pressure signal recipients', 1000)
    if (kind === 'telegraph' ? !front.telegraph.some(t => t.telegraphKey === definitionKey && t.audience === audience) : audience !== null || recipientActorKeys.length || (kind === 'advanced' ? !front.escalationStages.some(s => s.stageKey === definitionKey) : definitionKey !== null)) p.fail('压力威胁回执不属于冻结定义')
    return { kind, frontKey, definitionKey, atWorldTurn: p.integer(f.atWorldTurn, 'pressure front turn'), audience, recipientActorKeys, sourceRef: parseTtrpgOpenSourceRefV1(f.sourceRef) }
  }, 10000)
  const work = p.list(r.work, 'pressure consequences', value => {
    const hasReviews = Object.prototype.hasOwnProperty.call(p.object(value, 'pressure work'), 'effectReviews')
    const w = p.record(value, ['workKey', 'templateKey', 'situationTemplateKey', 'causeRef', 'completedRef', ...(hasReviews ? ['effectReviews'] : []), ...(Object.prototype.hasOwnProperty.call(p.object(value, 'pressure work'), 'situationAction') ? ['situationAction'] : []), ...(Object.prototype.hasOwnProperty.call(p.object(value, 'pressure work'), 'situationDisposition') ? ['situationDisposition'] : [])], 'pressure consequence')
    const templateKey = p.nullable(w.templateKey, p.key, 'pressure effect template'), situationTemplateKey = p.nullable(w.situationTemplateKey, p.key, 'pressure situation template')
    if (templateKey === null && situationTemplateKey === null || templateKey !== null && !content.campaign.effectPlanTemplates.some(t => t.planKey === templateKey)
      || situationTemplateKey !== null && !content.campaign.situationTemplates.some(t => t.templateKey === situationTemplateKey) && !sessionSituationRefs?.some(r => r.templateKey === situationTemplateKey)) p.fail('压力后果缺少冻结 owner 引用')
    const situationAction = Object.prototype.hasOwnProperty.call(w, 'situationAction') ? parseTtrpgOpenSituationWorkActionV1(w.situationAction) : undefined
    if (situationAction && !situationTemplateKey) p.fail('局势待办必须有真实模板')
    const situationDisposition = Object.prototype.hasOwnProperty.call(w, 'situationDisposition') ? p.oneOf(w.situationDisposition, ['activated', 'queued', 'existing', 'resolved', 'rejected'], 'situation disposition') : undefined
    if (situationDisposition && (!situationTemplateKey || w.completedRef === null)) p.fail('局势处置必须有实际局势待办完成事件')
    const effectReviews = hasReviews ? p.list(w.effectReviews, 'pressure effect reviews', parseTtrpgOpenPressureEffectReviewV1, 1000, 1) : undefined
    if (effectReviews && (!templateKey || effectReviews.some((r, i) => r.revision !== i + 1 || (i < effectReviews.length - 1 && !['rejected', 'stale', 'unpayable'].includes(r.status))))) p.fail('压力后果修订必须保留拒绝或过期记录')
    return { workKey: p.key(w.workKey, 'pressure work key'), templateKey, situationTemplateKey,
      causeRef: parseTtrpgOpenSourceRefV1(w.causeRef), completedRef: w.completedRef === null ? null : parseTtrpgOpenSourceRefV1(w.completedRef), ...(effectReviews ? { effectReviews } : {}), ...(situationAction ? { situationAction } : {}), ...(situationDisposition ? { situationDisposition } : {}) }
  }, 10000)
  if (new Set(work.map(w => w.workKey)).size !== work.length) p.fail('压力后果身份重复')
  const completedRef = r.completedRef === null ? null : parseTtrpgOpenSourceRefV1(r.completedRef)
  if (completedRef && (tickRefs.length !== tickQueue.length || work.some(w => !w.completedRef))) p.fail('压力仍有待办，不得伪造完成')
  return { ...(sessionSituationRefs ? { sessionSituationRefs } : {}), ...(operationStepKey ? { operationStepKey } : {}),cycleKey: p.key(r.cycleKey, 'pressure cycle key'), ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef), startedRef: parseTtrpgOpenSourceRefV1(r.startedRef),
    frozenContent: content, contentHash: p.hash(r.contentHash, 'pressure content hash'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'pressure runtime hash'), tickQueue, tickRefs, frontReceipts,
    consumedOracleRefs: p.list(r.consumedOracleRefs, 'pressure oracle sources', parseTtrpgOpenSourceRefV1, 1000), work, completedRef }
}
export function ttrpgOpenPressureRuleSourceV1(receipt: TtrpgOpenRuleReceiptV1): TtrpgOpenSourceRefV1 {
  return receipt.inheritedFrom?.originalSourceRef ?? receipt.sourceRef
}
export function sameTtrpgOpenPressureSourceV1(a: TtrpgOpenSourceRefV1, b: TtrpgOpenSourceRefV1) { return a.sessionKey === b.sessionKey && a.sequence === b.sequence }
export function planTtrpgOpenPressureTicksV1(input: { state: ProductRuntimeState; operation: TtrpgOpenOperationV1; receipt: TtrpgOpenRuleReceiptV1; content: TtrpgRuntimeContentV2 }) {
  const runtime = parseTtrpgRuntimeStateV2(input.state.ttrpg), run = runtime?.openRun
  if (!runtime || !run || input.receipt.operationKey !== input.operation.operationKey || input.receipt.frozenPlanHash !== input.operation.planHash) p.fail('压力需要当前操作的真实检定')
  const consumed = run.pressureCycles?.flatMap(c => c.consumedOracleRefs) ?? []
  const oracleRefs = (run.oracleReceipts ?? []).filter(r => !consumed.some(s => sameTtrpgOpenPressureSourceV1(s, r.sourceRef))
    && ['no', 'no-but'].includes(String(r.resolution.outcome.rawResult))).map(r => r.sourceRef)
  const ticks: TtrpgPressureClockTickV1[] = []
  const states = Object.fromEntries(run.clocks.map(c => [c.clockKey, { value: c.value, lastAdvancedSequence: -1, lastAdvancedWorldTurn: c.lastAdvancedWorldTurn ?? 0 }]))
  // Old journals retain their batch checkpoint; new multi-turn journals only
  // plan the actually paid current turn after earlier consequences settled.
  const step = input.operation.plannedSteps[input.operation.receipts.length]
  const interleaved = input.operation.settlementOrder === 'per-world-turn-v1'
  const turnCount = interleaved ? 1 : input.operation.plan.timeCostWorldTurns
  if (interleaved && (step?.kind !== 'pressure' || !step.tickIndex
    || !input.operation.pressureTurnConditions?.some(t => t.tickIndex === step.tickIndex && t.worldTurn === run.worldTime.worldTurn))) p.fail('逐轮压力必须接真实当前耗时回执')
  const firstTurn = run.worldTime.worldTurn - turnCount + 1
  if (firstTurn < 0) p.fail('压力耗时无法对应真实世界轮次')
  const turns = turnCount ? Array.from({ length: turnCount }, (_, i) => firstTurn + i) : [run.worldTime.worldTurn]
  for (const [index, turn] of turns.entries()) {
    const basis = input.operation.pressureTurnConditions?.find(t => t.worldTurn === turn)
    const atTurn = structuredClone(input.state)
    if (basis) atTurn.ttrpg!.product.conditions = structuredClone(basis.conditions)
    const sensitive = (predicate: import('./open-contract').TtrpgPredicateV1): boolean => predicate.op === 'ability-available' || (predicate.op === 'all' || predicate.op === 'any' ? predicate.of.some(sensitive) : predicate.op === 'not' ? sensitive(predicate.of) : false)
    if (!basis && turnCount > 1 && input.content.campaign.clocks.some(c => c.advanceTriggers.some(t => t.condition && sensitive(t.condition)))) p.fail('旧耗时没有逐轮能力状态依据，需要从真实事件恢复，不能用最终状态回填')
    const turnRuntime = parseTtrpgRuntimeStateV2(atTurn.ttrpg)!
    turnRuntime.openRun!.worldTime.worldTurn = turn
    atTurn.ttrpg = turnRuntime
    const context = ttrpgOpenPredicateContextV1(atTurn, input.content)
    const first = interleaved ? step.tickIndex === 1 : index === 0
    const signals = { actionKey: first ? input.operation.plan.request.ruleKey : null,
      failedCheck: first && input.receipt.result.outcome !== 'automatic' && !ttrpgDegreeSucceededV2(input.receipt.result.outcome) }
    for (const clock of input.content.campaign.clocks) {
      // Oracle causes are independent: each true negative is consumed once, even with a zero policy.
      const sequences = [{ ...signals, oracleNo: false }, ...first ? oracleRefs.map(() => ({ actionKey: null, failedCheck: false, oracleNo: true })) : []]
      for (const [signalIndex, signal] of sequences.entries()) {
        const definition = signalIndex ? { ...clock, advanceTriggers: [], autoAdvance: { ...clock.autoAdvance, onIdleWorldTurns: 0 } }
          : turnCount ? clock : { ...clock, autoAdvance: { ...clock.autoAdvance, onIdleWorldTurns: 0 } }
        const current = states[clock.clockKey] ?? p.fail('压力时钟未物化')
        const evaluated = evaluateTtrpgClockAutoAdvanceV1({ clock: definition, clockState: current,
          worldTime: { ...run.worldTime, worldTurn: turn, lastAdvanceReason: 'game-action' }, signal,
          predicateContext: { ...context, worldTurn: turn, pressure: { ...context.pressure, clocks: Object.fromEntries(Object.entries(states).map(([key, s]) => [key, { value: s.value }])) } } })
        ticks.push(...evaluated)
        if (evaluated.length) states[clock.clockKey] = { ...current, value: evaluated[evaluated.length - 1].valueAfter, lastAdvancedWorldTurn: turn }
      }
    }
  }
  return { tickQueue: ticks, consumedOracleRefs: oracleRefs }
}

export function ttrpgOpenPressureRuntimeProjectionV1(state: ProductRuntimeState) {
  const run = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun ?? p.fail('压力团局不存在')
  return { clocks: Object.fromEntries(run.clocks.map(c => [c.clockKey, { value: c.value, lastAdvancedSequence: -1, lastAdvancedWorldTurn: c.lastAdvancedWorldTurn ?? 0 }])),
    fronts: Object.fromEntries(run.fronts.map(f => [f.frontKey, { currentStageKey: f.stageKey, defeated: f.defeated, telegraphWorldTurns: f.telegraphWorldTurns ?? {} }])) }
}
export type TtrpgOpenPressureActionV1 = { kind: 'tick'; tickIndex: number } | { kind: 'telegraph'; frontKey: string; telegraphKey: string }
  | { kind: 'advance'; frontKey: string; stageKey: string } | { kind: 'defeat'; frontKey: string }
export function nextTtrpgOpenPressureActionV1(state: ProductRuntimeState, cycle: TtrpgOpenPressureCycleV1): TtrpgOpenPressureActionV1 | null {
  if (cycle.completedRef) return null
  if (cycle.work.some(w => !w.completedRef)) return null
  if (cycle.tickRefs.length < cycle.tickQueue.length) return { kind: 'tick', tickIndex: cycle.tickRefs.length }
  const run = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun ?? p.fail('压力团局不存在')
  const projection = ttrpgOpenPressureRuntimeProjectionV1(state), context = ttrpgOpenPredicateContextV1(state, cycle.frozenContent)
  for (const front of cycle.frozenContent.campaign.fronts) {
    const current = projection.fronts[front.frontKey] ?? p.fail('威胁未物化')
    if (current.defeated) continue
    if (front.defeatPredicates.every(predicate => evaluateTtrpgPredicateV1(predicate, context))) return { kind: 'defeat', frontKey: front.frontKey }
    const stage = front.escalationStages[(current.currentStageKey === null ? -1 : front.escalationStages.findIndex(s => s.stageKey === current.currentStageKey)) + 1]
    if (!stage) continue
    const signals = front.telegraph.filter(t => t.beforeStageKey === stage.stageKey)
    const lead = signals.some(t => current.telegraphWorldTurns[t.telegraphKey] !== undefined && run.worldTime.worldTurn - current.telegraphWorldTurns[t.telegraphKey] >= t.minLeadWorldTurns)
    if (lead && projection.clocks[stage.clockKey]?.value >= stage.atClockValue) return { kind: 'advance', frontKey: front.frontKey, stageKey: stage.stageKey }
    const missing = signals.find(t => current.telegraphWorldTurns[t.telegraphKey] === undefined)
    if (missing) return { kind: 'telegraph', frontKey: front.frontKey, telegraphKey: missing.telegraphKey }
  }
  return null
}

export function assertTtrpgOpenPressureHistoryV1(runtime: import('./open-runtime-contract').TtrpgRuntimeStateV2): void {
  const run = runtime.openRun
  if (!run) return
  const cycles = run.pressureCycles ?? [], key = (r: TtrpgOpenSourceRefV1) => `${r.sessionKey}:${r.sequence}`
  if (new Set(cycles.map(c => c.cycleKey)).size !== cycles.length || new Set(cycles.map(ttrpgOpenTurnCycleIdentityV1)).size !== cycles.length) p.fail('压力周期或规则来源重复')
  const signals = run.pressureSignals ?? []
  if (new Set(signals.map(s => `${s.frontKey}:${s.telegraphKey}`)).size !== signals.length) p.fail('征兆不得重复发布')
  for (const signal of signals) {
    if (signal.worldTurn > run.worldTime.worldTurn || signal.sourceRef.sessionKey !== runtime.sessionKey && !runtime.branchLineage?.ancestors.some(a => a.sessionKey === signal.sourceRef.sessionKey
      && a.throughSequence >= signal.sourceRef.sequence && a.snapshot.openRun?.pressureSignals?.some(s => stable(s) === stable(signal)))) p.fail('征兆缺少实际祖先投放来源')
  }
  const visibleSignals = [...signals.map(s => ({ frontKey: s.frontKey, telegraphKey: s.telegraphKey, worldTurn: s.worldTurn })),
    ...cycles.flatMap(c => c.frontReceipts.filter(r => r.kind === 'telegraph').map(r => ({ frontKey: r.frontKey, telegraphKey: r.definitionKey!, worldTurn: r.atWorldTurn })))]
  for (const front of run.fronts) {
    for (const [telegraphKey, turn] of Object.entries(front.telegraphWorldTurns ?? {})) if (!visibleSignals.some(s => s.frontKey === front.frontKey && s.telegraphKey === telegraphKey && s.worldTurn === turn)) p.fail('威胁提前轮次必须来自真实征兆投放')
  }
  const oracleSources = new Set((run.oracleReceipts ?? []).filter(r => ['no', 'no-but'].includes(String(r.resolution.outcome.rawResult))).map(r => key(r.sourceRef)))
  const consumed = new Set<string>()
  for (const cycle of cycles) {
    for (const ref of cycle.consumedOracleRefs) {
      if (!oracleSources.has(key(ref)) || consumed.has(key(ref))) p.fail('压力 Oracle 来源不真实或重复消费')
      consumed.add(key(ref))
    }
    const original = runtime.branchLineage?.ancestors.flatMap(a => a.snapshot.openRun?.pressureCycles ?? []).find(c => c.cycleKey === cycle.cycleKey)
    const fields = (c: TtrpgOpenPressureCycleV1) => ({ ...(c.operationStepKey ? { operationStepKey: c.operationStepKey } : {}),ruleSourceRef: c.ruleSourceRef, startedRef: c.startedRef, frozenContent: c.frozenContent,
      contentHash: c.contentHash, runtimeSourceHash: c.runtimeSourceHash, tickQueue: c.tickQueue, consumedOracleRefs: c.consumedOracleRefs })
    if (cycle.startedRef.sessionKey !== runtime.sessionKey && (!original || stable(fields(cycle)) !== stable(fields(original)))) p.fail('继承压力周期缺少冻结祖先计划')
    if (cycle.startedRef.sessionKey === runtime.sessionKey && !run.ruleReceipts.some(r => sameTtrpgOpenPressureSourceV1(ttrpgOpenPressureRuleSourceV1(r), cycle.ruleSourceRef))) p.fail('压力周期缺少本地实际裁定')
    const inherited = (ref: TtrpgOpenSourceRefV1, matches: (c: TtrpgOpenPressureCycleV1) => boolean) => {
      if (ref.sessionKey === runtime.sessionKey) return
      if (!runtime.branchLineage?.ancestors.some(a => a.sessionKey === ref.sessionKey && a.throughSequence >= ref.sequence
        && a.snapshot.openRun?.pressureCycles?.some(c => c.cycleKey === cycle.cycleKey && matches(c)))) p.fail('压力来源不在真实祖先切点内')
    }
    cycle.tickRefs.forEach((ref, index) => inherited(ref, c => Boolean(c.tickRefs[index] && sameTtrpgOpenPressureSourceV1(c.tickRefs[index], ref))))
    cycle.frontReceipts.forEach(receipt => inherited(receipt.sourceRef, c => c.frontReceipts.some(r => stable(r) === stable(receipt))))
    cycle.work.forEach(work => inherited(work.causeRef, c => c.work.some(w => w.workKey === work.workKey && w.templateKey === work.templateKey && w.situationTemplateKey === work.situationTemplateKey && sameTtrpgOpenPressureSourceV1(w.causeRef, work.causeRef))))
    for (const work of cycle.work) {
      for (const review of work.effectReviews ?? []) for (const decision of review.decisions) inherited(decision.sourceRef, c => c.work.some(w => w.workKey === work.workKey && w.effectReviews?.some(r => r.reviewKey === review.reviewKey && r.riskHash === review.riskHash && r.decisions.some(d => stable(d) === stable(decision)))))
      if (work.completedRef) inherited(work.completedRef, c => c.work.some(w => w.workKey === work.workKey && w.completedRef && sameTtrpgOpenPressureSourceV1(w.completedRef, work.completedRef!)))
    }
    if (cycle.completedRef) inherited(cycle.completedRef, c => Boolean(c.completedRef && sameTtrpgOpenPressureSourceV1(c.completedRef, cycle.completedRef!)))
  }
}

export interface TtrpgOpenPressureSignalV1 {
  sourceRef: TtrpgOpenSourceRefV1; frontKey: string; telegraphKey: string; worldTurn: number
  audience: 'party' | 'public'; recipientActorKeys: string[]; signalText: string
  frozenContent: TtrpgRuntimeContentV2; contentHash: string; runtimeSourceHash: string
}
export function parseTtrpgOpenPressureSignalV1(value: unknown): TtrpgOpenPressureSignalV1 {
  const s = p.record(value, ['sourceRef', 'frontKey', 'telegraphKey', 'worldTurn', 'audience', 'recipientActorKeys', 'signalText', 'frozenContent', 'contentHash', 'runtimeSourceHash'], 'pressure signal')
  const raw = p.object(s.frozenContent, 'pressure signal content'), world = p.object(p.object(raw.campaign, 'pressure signal campaign').sourceWorld, 'pressure signal world')
  const content = parseTtrpgFrozenRuntimeContentV1(s.frozenContent, p.hash(world.contentHash, 'signal world hash'))
  if (!isTtrpgRuntimeContentV2(content)) p.fail('征兆仅支持冻结 open 来源')
  const frontKey = p.key(s.frontKey, 'signal front'), telegraphKey = p.key(s.telegraphKey, 'signal key')
  const definition = content.campaign.fronts.find(f => f.frontKey === frontKey)?.telegraph.find(t => t.telegraphKey === telegraphKey)
  const audience = p.oneOf(s.audience, ['party', 'public'], 'signal audience'), signalText = p.text(s.signalText, 'signal text')
  if (!definition || definition.audience !== audience || definition.signalText !== signalText) p.fail('征兆必须使用冻结作者文本及真实受众')
  return { sourceRef: parseTtrpgOpenSourceRefV1(s.sourceRef), frontKey, telegraphKey, worldTurn: p.integer(s.worldTurn, 'signal turn'), audience,
    recipientActorKeys: p.keys(s.recipientActorKeys, 'signal recipients', 1000), signalText, frozenContent: content,
    contentHash: p.hash(s.contentHash, 'signal content hash'), runtimeSourceHash: p.hash(s.runtimeSourceHash, 'signal runtime hash') }
}

export function assertTtrpgOpenPressureGmV1(authorization: import('./open-authorization').TtrpgOpenAuthorizationV1, viewerKey: string) {
  const seat = authorization.seats.find(s => s.viewerKey === viewerKey), gm = authorization.seats.find(s => s.role === 'gm')
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || !gm
    || (gm.controller === 'ai' ? seat.seatKey !== authorization.completedBySeatKey : seat.role !== 'gm')) p.fail('征兆发布需要真人 GM 或 AI GM 模式的 Session Zero 确认者')
  return seat
}
