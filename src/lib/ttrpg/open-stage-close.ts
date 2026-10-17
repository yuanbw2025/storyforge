/** Actual explicit closure; its clocks and effects stay separately replayable and recoverable. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSituationFrozenContentV1 } from './open-situation-runtime'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenPressureEffectReviewV1, type TtrpgOpenConsequenceEffectWorkV1 } from './open-pressure-effect'
import { evaluateTtrpgOpenTerminalV1 } from './open-terminal-gates'
import { changeTtrpgOpenChaosV1 } from './open-chaos'
import * as p from './open-contract-parse'
export interface TtrpgOpenStageClosureV1 {
  cycleKey: string; stageIndex: number; ruleSourceRef: TtrpgOpenSourceRefV1; sourceRef: TtrpgOpenSourceRefV1; terminalRef: TtrpgOpenSourceRefV1;
  frozenContent: TtrpgRuntimeContentV2; contentHash: string; runtimeSourceHash: string; atWorldTurn: number;
  summary: { text: string; audience: 'gm-only' }; triggerKey: string | null; maximumReached: boolean;
  ticks: Array<{ clockKey: string; before: number; after: number; causeRef: TtrpgOpenSourceRefV1; completedRef: TtrpgOpenSourceRefV1 | null }>;
  work: TtrpgOpenConsequenceEffectWorkV1[]; completedRef: TtrpgOpenSourceRefV1 | null
}
export function parseTtrpgOpenStageClosureV1(value: unknown): TtrpgOpenStageClosureV1 {
  const r = p.record(value, ['cycleKey', 'stageIndex', 'ruleSourceRef', 'sourceRef', 'terminalRef', 'frozenContent', 'contentHash', 'runtimeSourceHash', 'atWorldTurn', 'summary', 'triggerKey', 'maximumReached', 'ticks', 'work', 'completedRef'], 'stage closure')
  const frozenContent = parseTtrpgOpenSituationFrozenContentV1(r.frozenContent), summary = p.record(r.summary, ['text', 'audience'], 'stage private summary')
  const ticks = p.list(r.ticks, 'stage close clocks', v => {
    const t = p.record(v, ['clockKey', 'before', 'after', 'causeRef', 'completedRef'], 'stage close tick'), clockKey = p.key(t.clockKey, 'stage clock')
    const clock = frozenContent.campaign.clocks.find(c => c.clockKey === clockKey) ?? p.fail('阶段时钟不在冻结内容')
    const before = p.integer(t.before, 'stage clock before', 0, clock.maximum), after = p.integer(t.after, 'stage clock after', 0, clock.maximum)
    if (after !== Math.min(clock.maximum, before + clock.autoAdvance.onStageClose) || after <= before) p.fail('阶段时钟不是冻结 onStageClose 变化')
    return { clockKey, before, after, causeRef: parseTtrpgOpenSourceRefV1(t.causeRef), completedRef: p.nullable(t.completedRef, parseTtrpgOpenSourceRefV1, 'stage clock receipt') }
  }, 10000)
  if (new Set(ticks.map(t => t.clockKey)).size !== ticks.length || ticks.some((t, i) => t.completedRef && ticks.slice(0, i).some(prior => !prior.completedRef))) p.fail('阶段时钟必须有序且唯一')
  const work = p.list(r.work, 'stage completion effects', v => {
    const raw = p.object(v, 'stage effect'), hasReviews = Object.prototype.hasOwnProperty.call(raw, 'effectReviews')
    const w = p.record(v, ['workKey', 'templateKey', 'situationTemplateKey', 'causeRef', 'completedRef', ...(hasReviews ? ['effectReviews'] : [])], 'stage effect')
    const templateKey = p.key(w.templateKey, 'stage effect template');p.literal(w.situationTemplateKey, null, 'stage effect owner')
    if (!frozenContent.campaign.effectPlanTemplates.some(t => t.planKey === templateKey)) p.fail('阶段完成效果未冻结')
    const effectReviews = hasReviews ? p.list(w.effectReviews, 'stage approval revisions', parseTtrpgOpenPressureEffectReviewV1, 1000, 1) : undefined
    if (effectReviews?.some((review, i) => review.revision !== i + 1 || i < effectReviews.length - 1 && !['rejected', 'stale', 'unpayable'].includes(review.status))) p.fail('阶段效果必须保留真实修订')
    return { workKey: p.key(w.workKey, 'stage effect key'), templateKey, situationTemplateKey: null, causeRef: parseTtrpgOpenSourceRefV1(w.causeRef), completedRef: p.nullable(w.completedRef, parseTtrpgOpenSourceRefV1, 'stage effect receipt'), ...(effectReviews ? { effectReviews } : {}) }
  }, 10000)
  if (new Set(work.map(w => w.workKey)).size !== work.length || work.some((w, i) => w.completedRef && work.slice(0, i).some(prior => !prior.completedRef))) p.fail('阶段效果必须有序且唯一')
  const completedRef = p.nullable(r.completedRef, parseTtrpgOpenSourceRefV1, 'stage settlement receipt')
  if (completedRef && (ticks.some(t => !t.completedRef) || work.some(w => !w.completedRef))) p.fail('阶段仍有实际时钟或效果待办')
  const triggerKey = p.nullable(r.triggerKey, p.key, 'stage trigger'), maximumReached = p.bool(r.maximumReached, 'stage maximum')
  if (maximumReached ? triggerKey !== null : !frozenContent.campaign.stageClosurePolicy.triggers.some(t => t.triggerKey === triggerKey)) p.fail('阶段收束来源无效')
  return { cycleKey: p.key(r.cycleKey, 'stage closure key'), stageIndex: p.integer(r.stageIndex, 'stage index'), ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef), sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), terminalRef: parseTtrpgOpenSourceRefV1(r.terminalRef), frozenContent,
    contentHash: p.hash(r.contentHash, 'stage content hash'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'stage source hash'), atWorldTurn: p.integer(r.atWorldTurn, 'stage turn'),
    summary: { text: p.text(summary.text, 'explicit stage summary'), audience: p.literal(summary.audience, 'gm-only', 'stage summary audience') }, triggerKey, maximumReached, ticks, work, completedRef }
}
export function planTtrpgOpenStageClosureTicksV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2, causeRef: TtrpgOpenSourceRefV1): TtrpgOpenStageClosureV1['ticks'] {
  const run = parseTtrpgRuntimeStateV2(state.ttrpg)!.openRun!
  return content.campaign.clocks.flatMap(definition => {
    const current = run.clocks.find(c => c.clockKey === definition.clockKey) ?? p.fail('阶段时钟未物化')
    const after = Math.min(definition.maximum, current.value + definition.autoAdvance.onStageClose)
    return after > current.value ? [{ clockKey: definition.clockKey, before: current.value, after, causeRef, completedRef: null }] : []
  })
}
export function settleTtrpgOpenStageClockV1(input: { state: ProductRuntimeState; closure: TtrpgOpenStageClosureV1; sequence: number }) {
  const state = structuredClone(input.state), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, run = runtime.openRun!, closure = structuredClone(input.closure)
  state.ttrpg = runtime
  if (closure.completedRef || closure.work.some(w => !w.completedRef)) p.fail('阶段时钟前仍有未完成效果')
  const tick = closure.ticks.find(t => !t.completedRef) ?? p.fail('阶段没有未完成时钟')
  const clock = run.clocks.find(c => c.clockKey === tick.clockKey) ?? p.fail('阶段实际时钟不存在'), sourceRef = { sessionKey: runtime.sessionKey, sequence: input.sequence }
  if (clock.value !== tick.before) p.fail('阶段时钟真实前值已变化，不得回填/重扣')
  const crossed = tick.before < clock.maximum && tick.after === clock.maximum
  clock.value = tick.after; clock.completed = tick.after === clock.maximum; clock.lastAdvancedWorldTurn = closure.atWorldTurn; tick.completedRef = sourceRef
  if (crossed) {
    changeTtrpgOpenChaosV1(run, 'clock-complete', input.sequence)
    const definition = closure.frozenContent.campaign.clocks.find(c => c.clockKey === tick.clockKey)!
    if (definition.onCompleteEffectPlanRef) closure.work.push({ workKey: `stage.clock.${tick.clockKey}.effect`, templateKey: definition.onCompleteEffectPlanRef, situationTemplateKey: null, causeRef: sourceRef, completedRef: null })
  }
  return { runtime, closure: parseTtrpgOpenStageClosureV1(closure), result: { clockKey: tick.clockKey, before: tick.before, after: tick.after, crossed, atWorldTurn: closure.atWorldTurn, causeRef: tick.causeRef } }
}
export function assertTtrpgOpenStageClosureEligibleV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2) {
  const decision = evaluateTtrpgOpenTerminalV1(state, content)
  if (!['closure-available', 'maximum-reached'].includes(decision.status)) p.fail('当前阶段未满足真实收束条件')
  return decision
}

/** A closed child can settle a captured suffix; it cannot reopen free action or time. */
export function ttrpgOpenClosedStageRecoveryAllowedV1(runtime: import('./open-runtime-contract').TtrpgRuntimeStateV2, triggerKind: string): boolean {
  return triggerKind === 'continue-host' && runtime.openRun?.stage.status === 'closed' && !!runtime.openRun.stageClosures?.length
    && !!runtime.branchLineage?.recoveryTasks.some(t => ['awaiting-authorization', 'ready'].includes(t.status) && t.remainingStepKeys.length > 0
      && t.remainingStepKeys.every(key => ['terminal', 'gates', 'narration', 'handoff'].includes(key)))
}

export function ttrpgOpenStageClosureOriginV1(closure: TtrpgOpenStageClosureV1) {
  const { ticks, work: _work, completedRef: _completed, ...origin } = closure
  return { ...origin, ticks: ticks.map(({ completedRef: _receipt, ...tick }) => tick) }
}
