import { evaluateTtrpgPredicateV1 } from './predicate'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'
import { clock as parseClock, front as parseFront } from './open-content-situations'
import type {
  TtrpgOpenCampaignClockV1,
  TtrpgOpenCampaignFrontV1,
  TtrpgPredicateV1,
} from './open-contract'
import {
  advanceTtrpgWorldTimeV1,
  canAdvanceTtrpgWorldTurnV1,
} from './world-time'
import type {
  TtrpgWorldTimeAdvanceReason,
  TtrpgWorldTimeV1,
} from './world-time'

const CLOCK_TRIGGER_SOURCES = [
  'author-trigger',
  'auto-failed-check',
  'auto-idle',
  'auto-oracle-no',
  'auto-stage-close',
  'escalation',
  'situation-outcome',
] as const

const PRESSURE_SIGNAL_KEYS = ['actionKey', 'failedCheck', 'oracleNo', 'stageClosed'] as const
const AUTO_TRIGGER_KEYS = {
  failedCheck: 'auto-failed-check',
  idle: 'auto-idle',
  oracleNo: 'auto-oracle-no',
  stageClose: 'auto-stage-close',
} as const

export const TTRPG_PRESSURE_CLOCK_TRIGGER_SOURCES = CLOCK_TRIGGER_SOURCES
export type TtrpgPressureClockTriggerSourceV1 = typeof CLOCK_TRIGGER_SOURCES[number]

export interface TtrpgPressureClockStateV1 {
  value: number
  lastAdvancedSequence: number
  lastAdvancedWorldTurn: number
}

export interface TtrpgPressureFrontStateV1 {
  currentStageKey: string | null
  telegraphWorldTurns: Readonly<Record<string, number>>
  defeated: boolean
}

export interface TtrpgPressureStateV1 {
  clocks: Readonly<Record<string, TtrpgPressureClockStateV1>>
  fronts: Readonly<Record<string, TtrpgPressureFrontStateV1>>
}

export interface TtrpgPressureClockTickV1 {
  clockKey: string
  delta: number
  triggerSource: TtrpgPressureClockTriggerSourceV1
  triggerKey: string
  valueBefore: number
  valueAfter: number
  atWorldTurn: number
}

export interface TtrpgPressureWorldTurnSignalV1 {
  actionKey?: string | null
  failedCheck?: boolean
  oracleNo?: boolean
  stageClosed?: boolean
}

export interface TtrpgPressureClockAutoAdvanceInputV1 {
  clock: TtrpgOpenCampaignClockV1
  clockState: TtrpgPressureClockStateV1
  worldTime: TtrpgWorldTimeV1
  signal?: TtrpgPressureWorldTurnSignalV1
  predicateContext?: TtrpgPredicateEvaluationContextV1
}

export interface TtrpgPressureWorldTurnInputV1 {
  worldTime: TtrpgWorldTimeV1
  reason: unknown
  byEventSequence: number
  clocks: readonly TtrpgOpenCampaignClockV1[]
  clockStates: Readonly<Record<string, TtrpgPressureClockStateV1>>
  signal?: TtrpgPressureWorldTurnSignalV1
  predicateContext?: TtrpgPredicateEvaluationContextV1
}

export interface TtrpgPressureWorldTurnEvaluationV1 {
  worldTime: TtrpgWorldTimeV1
  ticks: readonly TtrpgPressureClockTickV1[]
}

export interface TtrpgPressureFrontTelegraphInputV1 {
  front: TtrpgOpenCampaignFrontV1
  frontState: TtrpgPressureFrontStateV1
  telegraphKey: string
  audience: unknown
  worldTime: TtrpgWorldTimeV1
}

export interface TtrpgPressureFrontTelegraphV1 {
  frontKey: string
  telegraphKey: string
  audience: 'party' | 'public'
  telegraphWorldTurn: number
}

export interface TtrpgPressureFrontAdvanceInputV1 {
  front: TtrpgOpenCampaignFrontV1
  frontState: TtrpgPressureFrontStateV1
  clockStates: Readonly<Record<string, TtrpgPressureClockStateV1>>
  stageKey: string
  worldTime: TtrpgWorldTimeV1
}

export interface TtrpgPressureTelegraphEvidenceV1 {
  telegraphKey: string
  telegraphWorldTurn: number
  minLeadWorldTurns: number
}

export interface TtrpgPressureFrontAdvanceV1 {
  frontKey: string
  stageKey: string
  effectPlanRef: string | null
  telegraphEvidence: readonly TtrpgPressureTelegraphEvidenceV1[]
}

export interface TtrpgPressureFrontDefeatInputV1 {
  front: TtrpgOpenCampaignFrontV1
  frontState: TtrpgPressureFrontStateV1
  predicateContext: TtrpgPredicateEvaluationContextV1
}

export interface TtrpgPressureFrontDefeatV1 {
  frontKey: string
  satisfiedPredicates: readonly TtrpgPredicateV1[]
}

function fail(message: string): never {
  throw new Error(`[ttrpg-pressure] ${message}`)
}

function integer(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail(`${label}必须是${minimum}..${maximum}的安全整数`)
  }
  return Number(value)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail(`${label}必须是非空字符串`)
  return value
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return fail(`${label}必须是boolean`)
  return value
}

function assertClockState(
  clock: TtrpgOpenCampaignClockV1,
  state: TtrpgPressureClockStateV1,
  label = `clocks.${clock.clockKey}`,
): void {
  integer(state.value, `${label}.value`, 0, clock.maximum)
  integer(state.lastAdvancedSequence, `${label}.lastAdvancedSequence`, -1)
  integer(state.lastAdvancedWorldTurn, `${label}.lastAdvancedWorldTurn`, 0)
}

function assertFrontState(
  front: TtrpgOpenCampaignFrontV1,
  state: TtrpgPressureFrontStateV1,
  label = `fronts.${front.frontKey}`,
): void {
  if (state.currentStageKey !== null && !front.escalationStages.some(stage => stage.stageKey === state.currentStageKey)) {
    fail(`${label}.currentStageKey引用未知stage`)
  }
  for (const [telegraphKey, worldTurn] of Object.entries(state.telegraphWorldTurns)) {
    if (!front.telegraph.some(telegraph => telegraph.telegraphKey === telegraphKey)) {
      fail(`${label}.telegraphWorldTurns引用未知telegraph`)
    }
    integer(worldTurn, `${label}.telegraphWorldTurns.${telegraphKey}`, 0)
  }
  assertBoolean(state.defeated, `${label}.defeated`)
}

function assertSignal(signal: TtrpgPressureWorldTurnSignalV1 | undefined): Required<TtrpgPressureWorldTurnSignalV1> {
  const value = signal ?? {}
  for (const key of Object.keys(value)) {
    if (!(PRESSURE_SIGNAL_KEYS as readonly string[]).includes(key)) fail(`signal字段不在闭集:${key}`)
  }
  if (value.actionKey !== undefined && value.actionKey !== null) text(value.actionKey, 'signal.actionKey')
  return {
    actionKey: value.actionKey ?? null,
    failedCheck: value.failedCheck === undefined ? false : assertBoolean(value.failedCheck, 'signal.failedCheck'),
    oracleNo: value.oracleNo === undefined ? false : assertBoolean(value.oracleNo, 'signal.oracleNo'),
    stageClosed: value.stageClosed === undefined ? false : assertBoolean(value.stageClosed, 'signal.stageClosed'),
  }
}

function checkedClock(value: TtrpgOpenCampaignClockV1): TtrpgOpenCampaignClockV1 {
  return parseClock(value, 'pressure.clock')
}

function checkedFront(value: TtrpgOpenCampaignFrontV1): TtrpgOpenCampaignFrontV1 {
  return parseFront(value, 'pressure.front')
}

function clockStateEntries(
  clocks: readonly TtrpgOpenCampaignClockV1[],
  states: Readonly<Record<string, TtrpgPressureClockStateV1>>,
): Array<[TtrpgOpenCampaignClockV1, TtrpgPressureClockStateV1]> {
  const definitions = clocks.map(checkedClock)
  const keys = new Set<string>()
  for (const clock of definitions) {
    if (keys.has(clock.clockKey)) fail(`clockKey重复:${clock.clockKey}`)
    keys.add(clock.clockKey)
    const state = states[clock.clockKey]
    if (!state) fail(`缺少clock运行状态:${clock.clockKey}`)
    assertClockState(clock, state)
  }
  for (const key of Object.keys(states)) {
    if (!keys.has(key)) fail(`clock运行状态引用未知clock:${key}`)
  }
  return definitions.map(clock => [clock, states[clock.clockKey]])
}

function nextClockTick(
  clock: TtrpgOpenCampaignClockV1,
  state: TtrpgPressureClockStateV1,
  amount: number,
  triggerSource: TtrpgPressureClockTriggerSourceV1,
  triggerKey: string,
  worldTurn: number,
): TtrpgPressureClockTickV1 | null {
  integer(amount, 'delta', 1, clock.maximum)
  if (state.value >= clock.maximum) return null
  const delta = Math.min(clock.maximum - state.value, amount)
  if (delta <= 0) return null
  return {
    clockKey: clock.clockKey,
    delta,
    triggerSource,
    triggerKey: text(triggerKey, 'triggerKey'),
    valueBefore: state.value,
    valueAfter: state.value + delta,
    atWorldTurn: integer(worldTurn, 'atWorldTurn', 0),
  }
}

function conditionMatches(
  trigger: TtrpgOpenCampaignClockV1['advanceTriggers'][number],
  signal: Required<TtrpgPressureWorldTurnSignalV1>,
  context: TtrpgPredicateEvaluationContextV1 | undefined,
): boolean {
  if (trigger.actionKey !== null && trigger.actionKey !== signal.actionKey) return false
  if (trigger.condition !== null) {
    if (!context) fail(`trigger.condition需要predicateContext:${trigger.triggerKey}`)
    if (!evaluateTtrpgPredicateV1(trigger.condition, context)) return false
  }
  return true
}

function autoTicksForClock(
  input: TtrpgPressureClockAutoAdvanceInputV1,
): readonly TtrpgPressureClockTickV1[] {
  const clock = checkedClock(input.clock)
  assertClockState(clock, input.clockState)
  if (!canAdvanceTtrpgWorldTurnV1(input.worldTime.lastAdvanceReason)) {
    return fail(`autoAdvance必须绑定已推进的worldTurn:${String(input.worldTime.lastAdvanceReason)}`)
  }
  const signal = assertSignal(input.signal)
  const ticks: TtrpgPressureClockTickV1[] = []
  let value = input.clockState.value
  const idleWorldTurns = input.worldTime.worldTurn - input.clockState.lastAdvancedWorldTurn
  if (idleWorldTurns < 0) fail('worldTurn不能早于lastAdvancedWorldTurn')

  const candidates: Array<{
    amount: number
    triggerSource: TtrpgPressureClockTriggerSourceV1
    triggerKey: string
  }> = []
  for (const trigger of clock.advanceTriggers) {
    if (conditionMatches(trigger, signal, input.predicateContext)) {
      candidates.push({ amount: trigger.amount, triggerSource: 'author-trigger', triggerKey: trigger.triggerKey })
    }
  }
  if (signal.failedCheck && clock.autoAdvance.onFailedCheck > 0) {
    candidates.push({ amount: clock.autoAdvance.onFailedCheck, triggerSource: 'auto-failed-check', triggerKey: AUTO_TRIGGER_KEYS.failedCheck })
  }
  if (clock.autoAdvance.onIdleWorldTurns > 0 && idleWorldTurns >= clock.autoAdvance.onIdleWorldTurns) {
    candidates.push({ amount: 1, triggerSource: 'auto-idle', triggerKey: AUTO_TRIGGER_KEYS.idle })
  }
  if (signal.oracleNo && clock.autoAdvance.onOracleNo > 0) {
    candidates.push({ amount: clock.autoAdvance.onOracleNo, triggerSource: 'auto-oracle-no', triggerKey: AUTO_TRIGGER_KEYS.oracleNo })
  }
  if ((signal.stageClosed || input.worldTime.lastAdvanceReason === 'stage-close') && clock.autoAdvance.onStageClose > 0) {
    candidates.push({ amount: clock.autoAdvance.onStageClose, triggerSource: 'auto-stage-close', triggerKey: AUTO_TRIGGER_KEYS.stageClose })
  }

  for (const candidate of candidates) {
    const tick = nextClockTick(
      clock,
      { ...input.clockState, value },
      candidate.amount,
      candidate.triggerSource,
      candidate.triggerKey,
      input.worldTime.worldTurn,
    )
    if (tick) {
      ticks.push(tick)
      value = tick.valueAfter
    }
  }
  return ticks
}

export function parseTtrpgPressureClockV1(value: unknown): TtrpgOpenCampaignClockV1 {
  return parseClock(value, 'pressure.clock')
}

export function parseTtrpgPressureFrontV1(value: unknown): TtrpgOpenCampaignFrontV1 {
  return parseFront(value, 'pressure.front')
}

export function createTtrpgPressureStateV1(
  clocks: readonly TtrpgOpenCampaignClockV1[],
  fronts: readonly TtrpgOpenCampaignFrontV1[],
): TtrpgPressureStateV1 {
  const clockStates: Record<string, TtrpgPressureClockStateV1> = {}
  for (const rawClock of clocks) {
    const clock = checkedClock(rawClock)
    if (clockStates[clock.clockKey]) fail(`clockKey重复:${clock.clockKey}`)
    clockStates[clock.clockKey] = {
      value: clock.initialValue,
      lastAdvancedSequence: -1,
      lastAdvancedWorldTurn: 0,
    }
  }

  const frontStates: Record<string, TtrpgPressureFrontStateV1> = {}
  for (const rawFront of fronts) {
    const front = checkedFront(rawFront)
    if (frontStates[front.frontKey]) fail(`frontKey重复:${front.frontKey}`)
    frontStates[front.frontKey] = {
      currentStageKey: null,
      telegraphWorldTurns: {},
      defeated: false,
    }
  }
  return { clocks: clockStates, fronts: frontStates }
}

export function evaluateTtrpgClockAutoAdvanceV1(
  input: TtrpgPressureClockAutoAdvanceInputV1,
): readonly TtrpgPressureClockTickV1[] {
  return autoTicksForClock(input)
}

export function evaluateTtrpgPressureOnWorldTurnV1(
  input: TtrpgPressureWorldTurnInputV1,
): TtrpgPressureWorldTurnEvaluationV1 {
  const worldTime = advanceTtrpgWorldTimeV1({
    worldTime: input.worldTime,
    reason: input.reason,
    byEventSequence: input.byEventSequence,
  })
  const entries = clockStateEntries(input.clocks, input.clockStates)
  const signal = assertSignal(input.signal)
  const predicateContext = input.predicateContext
    ? {
        ...input.predicateContext,
        worldTurn: worldTime.worldTurn,
        pressure: {
          ...input.predicateContext.pressure,
          clocks: Object.fromEntries(entries.map(([clock, state]) => [clock.clockKey, { value: state.value }])),
        },
      }
    : undefined
  const ticks = entries.flatMap(([clock, clockState]) => autoTicksForClock({
    clock,
    clockState,
    worldTime,
    signal,
    predicateContext,
  }))
  return { worldTime, ticks }
}

export function evaluateTtrpgFrontTelegraphV1(
  input: TtrpgPressureFrontTelegraphInputV1,
): TtrpgPressureFrontTelegraphV1 {
  const front = checkedFront(input.front)
  assertFrontState(front, input.frontState)
  const telegraph = front.telegraph.find(candidate => candidate.telegraphKey === input.telegraphKey)
  if (!telegraph) fail(`telegraphKey不在front:${input.telegraphKey}`)
  if (telegraph.audience !== 'party' && telegraph.audience !== 'public') {
    fail(`telegraph audience必须为party/public:${input.telegraphKey}`)
  }
  if (input.audience !== telegraph.audience) fail(`telegraph audience与冻结字段不一致:${input.telegraphKey}`)
  return {
    frontKey: front.frontKey,
    telegraphKey: telegraph.telegraphKey,
    audience: telegraph.audience,
    telegraphWorldTurn: integer(input.worldTime.worldTurn, 'telegraphWorldTurn', 0),
  }
}

function predicateContextWithFront(
  context: TtrpgPredicateEvaluationContextV1,
  front: TtrpgOpenCampaignFrontV1,
  state: TtrpgPressureFrontStateV1,
): TtrpgPredicateEvaluationContextV1 {
  return {
    ...context,
    pressure: {
      ...context.pressure,
      fronts: {
        ...context.pressure.fronts,
        [front.frontKey]: {
          currentStageKey: state.currentStageKey,
          escalationStages: front.escalationStages.map(stage => ({ stageKey: stage.stageKey })),
        },
      },
    },
  }
}

export function evaluateTtrpgFrontAdvanceV1(
  input: TtrpgPressureFrontAdvanceInputV1,
): TtrpgPressureFrontAdvanceV1 {
  const front = checkedFront(input.front)
  assertFrontState(front, input.frontState)
  if (input.frontState.defeated) fail(`front已经defeated:${front.frontKey}`)
  const currentIndex = input.frontState.currentStageKey === null
    ? -1
    : front.escalationStages.findIndex(stage => stage.stageKey === input.frontState.currentStageKey)
  if (currentIndex < -1) fail(`currentStageKey无效:${String(input.frontState.currentStageKey)}`)
  const stageIndex = front.escalationStages.findIndex(stage => stage.stageKey === input.stageKey)
  if (stageIndex < 0) fail(`stageKey不在front:${input.stageKey}`)
  if (stageIndex !== currentIndex + 1) fail(`front stage必须按严格顺序推进:${input.stageKey}`)
  const stage = front.escalationStages[stageIndex]
  const clockState = input.clockStates[stage.clockKey]
  if (!clockState) fail(`缺少stage clock运行状态:${stage.clockKey}`)
  integer(clockState.value, `clocks.${stage.clockKey}.value`, 0)
  if (clockState.value < stage.atClockValue) fail(`clock未达到stage阈值:${stage.stageKey}`)
  const currentWorldTurn = integer(input.worldTime.worldTurn, 'currentWorldTurn', 0)
  const telegraphEvidence = front.telegraph
    .filter(telegraph => telegraph.beforeStageKey === stage.stageKey)
    .filter(telegraph => {
      if (telegraph.audience !== 'party' && telegraph.audience !== 'public') {
        fail(`telegraph audience必须为party/public:${telegraph.telegraphKey}`)
      }
      const telegraphWorldTurn = input.frontState.telegraphWorldTurns[telegraph.telegraphKey]
      if (telegraphWorldTurn === undefined) return false
      integer(telegraphWorldTurn, `telegraphWorldTurns.${telegraph.telegraphKey}`, 0)
      return currentWorldTurn - telegraphWorldTurn >= telegraph.minLeadWorldTurns
    })
    .map(telegraph => ({
      telegraphKey: telegraph.telegraphKey,
      telegraphWorldTurn: input.frontState.telegraphWorldTurns[telegraph.telegraphKey],
      minLeadWorldTurns: telegraph.minLeadWorldTurns,
    }))
  if (telegraphEvidence.length === 0) fail(`front升级缺少满足提前轮次的征兆:${stage.stageKey}`)
  return {
    frontKey: front.frontKey,
    stageKey: stage.stageKey,
    effectPlanRef: stage.effectPlanRef,
    telegraphEvidence,
  }
}

export function evaluateTtrpgFrontDefeatV1(
  input: TtrpgPressureFrontDefeatInputV1,
): TtrpgPressureFrontDefeatV1 {
  const front = checkedFront(input.front)
  assertFrontState(front, input.frontState)
  if (input.frontState.defeated) fail(`front已经defeated:${front.frontKey}`)
  const context = predicateContextWithFront(input.predicateContext, front, input.frontState)
  const results = front.defeatPredicates.map(predicate => evaluateTtrpgPredicateV1(predicate, context))
  if (!results.every(Boolean)) fail(`defeatPredicates未全部满足:${front.frontKey}`)
  return {
    frontKey: front.frontKey,
    satisfiedPredicates: front.defeatPredicates,
  }
}

export type { TtrpgWorldTimeAdvanceReason }
