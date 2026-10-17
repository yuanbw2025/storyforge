const WORLD_TIME_REASONS = [
  'game-action',
  'ai-companion-action',
  'idle-tick',
  'front-escalation',
  'situation-maintenance',
  'stage-close',
] as const

export const TTRPG_WORLD_TIME_REASONS = WORLD_TIME_REASONS
export type TtrpgWorldTimeAdvanceReason = typeof WORLD_TIME_REASONS[number]

export interface TtrpgWorldTimeV1 {
  worldTurn: number
  lastAdvancedByEventSequence: number
  lastAdvanceReason: TtrpgWorldTimeAdvanceReason | null
}

export interface TtrpgWorldTimeAdvanceInputV1 {
  worldTime: TtrpgWorldTimeV1
  reason: unknown
  byEventSequence: number
}

function fail(message: string): never {
  throw new Error(`[ttrpg-world-time] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}必须是对象`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return fail(`${label}必须是 JSON 对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(`${label}字段不符合合同:${actual.join(',')}`)
  }
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) return fail(`${label}必须是安全整数`)
  return Number(value)
}

function parseWorldTime(value: unknown): TtrpgWorldTimeV1 {
  const row = record(value, 'worldTime')
  exact(row, ['worldTurn', 'lastAdvancedByEventSequence', 'lastAdvanceReason'], 'worldTime')
  const worldTurn = integer(row.worldTurn, 'worldTime.worldTurn', 0)
  const lastAdvancedByEventSequence = integer(row.lastAdvancedByEventSequence, 'worldTime.lastAdvancedByEventSequence', -1)
  const lastAdvanceReason = row.lastAdvanceReason
  if (lastAdvanceReason !== null && !canAdvanceTtrpgWorldTurnV1(lastAdvanceReason)) {
    return fail('worldTime.lastAdvanceReason不在白名单')
  }
  return { worldTurn, lastAdvancedByEventSequence, lastAdvanceReason }
}

export function canAdvanceTtrpgWorldTurnV1(reason: unknown): reason is TtrpgWorldTimeAdvanceReason {
  return typeof reason === 'string' && WORLD_TIME_REASONS.includes(reason as TtrpgWorldTimeAdvanceReason)
}

export function createTtrpgWorldTimeV1(): TtrpgWorldTimeV1 {
  return { worldTurn: 0, lastAdvancedByEventSequence: -1, lastAdvanceReason: null }
}

export function advanceTtrpgWorldTimeV1(input: TtrpgWorldTimeAdvanceInputV1): TtrpgWorldTimeV1
export function advanceTtrpgWorldTimeV1(
  worldTime: TtrpgWorldTimeV1,
  reason: unknown,
  byEventSequence: number,
): TtrpgWorldTimeV1
export function advanceTtrpgWorldTimeV1(
  worldTime: TtrpgWorldTimeV1,
  byEventSequence: number,
  reason: unknown,
): TtrpgWorldTimeV1
export function advanceTtrpgWorldTimeV1(
  inputOrWorldTime: TtrpgWorldTimeAdvanceInputV1 | TtrpgWorldTimeV1,
  reasonOrSequence?: unknown,
  sequenceOrReason?: unknown,
): TtrpgWorldTimeV1 {
  let worldTime: unknown
  let reason: unknown
  let byEventSequence: unknown
  if (reasonOrSequence === undefined && sequenceOrReason === undefined) {
    const input = record(inputOrWorldTime, 'advanceTtrpgWorldTimeV1')
    exact(input, ['worldTime', 'reason', 'byEventSequence'], 'advanceTtrpgWorldTimeV1')
    worldTime = input.worldTime
    reason = input.reason
    byEventSequence = input.byEventSequence
  } else if (typeof reasonOrSequence === 'number') {
    worldTime = inputOrWorldTime
    byEventSequence = reasonOrSequence
    reason = sequenceOrReason
  } else {
    worldTime = inputOrWorldTime
    reason = reasonOrSequence
    byEventSequence = sequenceOrReason
  }

  const current = parseWorldTime(worldTime)
  if (!canAdvanceTtrpgWorldTurnV1(reason)) {
    fail(`reason不允许推进worldTurn:${String(reason)}`)
  }
  const sequence = integer(byEventSequence, 'byEventSequence', 0)
  if (sequence <= current.lastAdvancedByEventSequence) {
    fail(`byEventSequence必须严格递增:${sequence}`)
  }
  return {
    worldTurn: current.worldTurn + 1,
    lastAdvancedByEventSequence: sequence,
    lastAdvanceReason: reason,
  }
}
